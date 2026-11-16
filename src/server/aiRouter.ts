import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  AiBriefingInputPayload,
  AiMeetingInputPayload,
  CommunicationDraftRequest,
  CommunicationDraftResult,
  MeetingAiAnalysisResult,
  MeetingAiBriefingResult,
} from '../types/index.ts';
import { isValidResourceId } from '../utils/attachmentPolicy.ts';
import {
  AI_RATE_LIMIT_MAX_REQUESTS,
  AI_RATE_LIMIT_WINDOW_MS,
  detectDisallowedAiFields,
  sanitizeIncomingAiPayload,
} from '../utils/meetingAiAssistant.ts';
import { sanitizeIncomingAiBriefingPayload } from '../utils/meetingPreparation.ts';
import {
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  verifyCommunicationContextOwnershipInNamedDb,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';
import {
  analyzeMeetingWithGemini,
  GeminiServiceError,
  generateMeetingBriefingWithGemini,
} from './geminiMeetingAssistant.ts';
import { generateCommunicationDraftWithGemini } from './communicationAiService.ts';

export interface AiRouterDeps {
  verifyBearerToken?: (authHeader: string | undefined) => Promise<VerifiedFirebaseUser>;
  verifyMeetingOwnership?: (params: {
    uid: string;
    meetingId: string;
    idToken: string;
  }) => Promise<boolean>;
  analyzeMeeting?: (params: {
    payload: AiMeetingInputPayload;
    signal?: AbortSignal;
  }) => Promise<MeetingAiAnalysisResult>;
  generateBriefing?: (params: {
    payload: AiBriefingInputPayload;
    signal?: AbortSignal;
  }) => Promise<MeetingAiBriefingResult>;
  generateCommunicationDraft?: (params: {
    request: CommunicationDraftRequest;
    contextData: {
      clientName?: string;
      companyName?: string;
      contactName?: string;
      opportunityTitle?: string;
      opportunityValue?: string;
      nextAction?: string;
    };
    signal?: AbortSignal;
  }) => Promise<CommunicationDraftResult>;
  nowMs?: () => number;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
  verifyCommunicationContextOwnership?: (params: {
    uid: string;
    clientId: string;
    contactId?: string;
    opportunityId?: string;
    meetingId?: string;
    idToken: string;
  }) => Promise<boolean>;
}

interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export function createAiRouter(customDeps: AiRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner =
    customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const verifyCommOwner =
    customDeps.verifyCommunicationContextOwnership ?? verifyCommunicationContextOwnershipInNamedDb;
  const analyzeMeeting = customDeps.analyzeMeeting ?? analyzeMeetingWithGemini;
  const generateBriefing = customDeps.generateBriefing ?? generateMeetingBriefingWithGemini;
  const generateDraft =
    customDeps.generateCommunicationDraft ?? generateCommunicationDraftWithGemini;
  const nowMs = customDeps.nowMs ?? (() => Date.now());
  const rateLimitMax = customDeps.rateLimitMaxRequests ?? AI_RATE_LIMIT_MAX_REQUESTS;
  const rateLimitWindow = customDeps.rateLimitWindowMs ?? AI_RATE_LIMIT_WINDOW_MS;

  // Per-uid sliding window rate limiter + per-(uid:meetingId) in-flight deduplication
  const requestTimestampsByUid = new Map<string, number[]>();
  const inFlightKeys = new Set<string>();

  const requireAuth = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      req.authUser = user;
      next();
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string } | null;
      const code = String(errObj?.code || '');
      const msg = String(errObj?.message || '');
      const isAuthFailure =
        msg.startsWith('UNAUTHENTICATED:') ||
        (code.startsWith('auth/') && code !== 'auth/internal-error');

      if (isAuthFailure) {
        res.status(401).json({
          error: 'UNAUTHENTICATED',
          messageArabic: 'يجب تسجيل الدخول بحساب Google الموثّق لاستخدام المساعد الذكي.',
        });
        return;
      }

      res.status(500).json({
        error: 'AUTH_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من جلسة المصادقة على الخادم مؤقتاً.',
      });
    }
  };

  router.use(requireAuth);

  router.post('/meeting-suggestions', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser!.uid;
    const body = (req.body || {}) as Record<string, unknown>;

    // 1. Reject explicit uid/userId/ownerId spoofing immediately
    const claimedUid = body.uid ?? body.userId ?? body.ownerId;
    if (claimedUid !== undefined && claimedUid !== uid) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'مرفوض: لا يُسمح بطلب تحليل ذكي لاجتماع يخص حساباً آخر.',
      });
      return;
    }

    // 2. Reject any disallowed control, secret, or Backblaze B2 attachment fields
    const disallowedField = detectDisallowedAiFields(body);
    if (disallowedField) {
      res.status(400).json({
        error: 'DISALLOWED_AI_INPUT_FIELD',
        messageArabic:
          'مرفوض: يُمنع إرسال المرفقات السحابية أو الروابط المؤقتة أو حقول التحكم في طلب التحليل.',
      });
      return;
    }

    // 3. Validate meetingId
    if (!isValidResourceId(body.meetingId)) {
      res.status(400).json({
        error: 'INVALID_MEETING_ID',
        messageArabic: 'معرّف اللقاء غير صالح.',
      });
      return;
    }
    const meetingId = body.meetingId;

    // 4. Validate and sanitize selected meeting text + size limit
    const sanitized = sanitizeIncomingAiPayload(body);
    if (!sanitized.ok) {
      res.status(sanitized.statusCode).json({
        error: sanitized.errorCode,
        messageArabic: sanitized.messageArabic,
      });
      return;
    }

    // 5. Verify meeting ownership inside named Firestore database ONLY
    try {
      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });
      if (ownsMeeting === false) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية الوصول إليه.',
        });
        return;
      }
    } catch (ownerErr: unknown) {
      const msg = ownerErr instanceof Error ? ownerErr.message : String(ownerErr || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'تم رفض الوصول إلى سجل هذا اللقاء.',
        });
        return;
      }
      res.status(503).json({
        error: 'OWNERSHIP_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من ملكية اللقاء على الخادم حالياً.',
      });
      return;
    }

    // 6. Per-uid sliding-window rate limit check
    const currentNow = nowMs();
    const recent = (requestTimestampsByUid.get(uid) || []).filter(
      (ts) => currentNow - ts < rateLimitWindow
    );
    if (recent.length >= rateLimitMax) {
      requestTimestampsByUid.set(uid, recent);
      res.status(429).json({
        error: 'AI_RATE_LIMITED',
        messageArabic:
          'تم إرسال عدد كبير من طلبات التحليل خلال دقيقة واحدة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
      });
      return;
    }
    recent.push(currentNow);
    requestTimestampsByUid.set(uid, recent);

    // 7. Prevent duplicate simultaneous analysis for the same user & meeting
    const inFlightKey = `${uid}:${meetingId}`;
    if (inFlightKeys.has(inFlightKey)) {
      res.status(409).json({
        error: 'AI_ANALYSIS_IN_PROGRESS',
        messageArabic: 'يوجد تحليل قيد التنفيذ حالياً لهذا اللقاء. يرجى الانتظار أو إلغاء الطلب السابق.',
      });
      return;
    }
    inFlightKeys.add(inFlightKey);

    const requestAbortController = new AbortController();
    const onResponseClose = () => {
      if (!res.writableEnded) {
        requestAbortController.abort();
      }
    };
    res.on('close', onResponseClose);

    try {
      const analysis = await analyzeMeeting({
        payload: sanitized.payload,
        signal: requestAbortController.signal,
      });

      if (res.writableEnded || requestAbortController.signal.aborted) {
        return;
      }

      res.json(analysis);
    } catch (err: unknown) {
      if (res.writableEnded) return;

      if (err instanceof GeminiServiceError) {
        res.status(err.statusCode).json({
          error: err.errorCode,
          messageArabic: err.message,
        });
        return;
      }

      res.status(502).json({
        error: 'AI_ANALYSIS_FAILED',
        messageArabic: 'تعذر إتمام تحليل الاجتماع عبر المساعد الذكي حالياً.',
      });
    } finally {
      inFlightKeys.delete(inFlightKey);
      res.off('close', onResponseClose);
    }
  });

  router.post('/meeting-briefing', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser!.uid;
    const body = (req.body || {}) as Record<string, unknown>;

    // 1. Reject explicit uid/userId/ownerId spoofing immediately
    const claimedUid = body.uid ?? body.userId ?? body.ownerId;
    if (claimedUid !== undefined && claimedUid !== uid) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'مرفوض: لا يُسمح بطلب تحضير ذكي لاجتماع يخص حساباً آخر.',
      });
      return;
    }

    // 2. Reject any disallowed control, secret, or Backblaze B2 attachment fields
    const disallowedField = detectDisallowedAiFields(body);
    if (disallowedField) {
      res.status(400).json({
        error: 'DISALLOWED_AI_INPUT_FIELD',
        messageArabic:
          'مرفوض: يُمنع إرسال المرفقات السحابية أو الروابط المؤقتة أو حقول التحكم في طلب التحضير الذكي.',
      });
      return;
    }

    // 3. Validate meetingId
    if (!isValidResourceId(body.meetingId)) {
      res.status(400).json({
        error: 'INVALID_MEETING_ID',
        messageArabic: 'معرّف اللقاء غير صالح.',
      });
      return;
    }
    const meetingId = body.meetingId;

    // 4. Validate and sanitize briefing payload
    const sanitized = sanitizeIncomingAiBriefingPayload(body);
    if (!sanitized.ok) {
      res.status(400).json({
        error: 'INVALID_BRIEFING_PAYLOAD',
        messageArabic: sanitized.errorArabic,
      });
      return;
    }

    // 5. Verify meeting ownership inside named Firestore database ONLY
    try {
      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية الوصول إليه.',
        });
        return;
      }
    } catch (ownerErr: unknown) {
      const msg = ownerErr instanceof Error ? ownerErr.message : String(ownerErr || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'تم رفض الوصول إلى سجل هذا اللقاء.',
        });
        return;
      }
      res.status(503).json({
        error: 'OWNERSHIP_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من ملكية اللقاء على الخادم حالياً.',
      });
      return;
    }

    // 6. Per-uid sliding-window rate limit check
    const currentNow = nowMs();
    const recent = (requestTimestampsByUid.get(uid) || []).filter(
      (ts) => currentNow - ts < rateLimitWindow
    );
    if (recent.length >= rateLimitMax) {
      requestTimestampsByUid.set(uid, recent);
      res.status(429).json({
        error: 'AI_RATE_LIMITED',
        messageArabic:
          'تم إرسال عدد كبير من الطلبات خلال دقيقة واحدة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
      });
      return;
    }
    recent.push(currentNow);
    requestTimestampsByUid.set(uid, recent);

    // 7. Prevent duplicate simultaneous briefing requests for the same user & meeting
    const inFlightKey = `briefing:${uid}:${meetingId}`;
    if (inFlightKeys.has(inFlightKey)) {
      res.status(409).json({
        error: 'AI_BRIEFING_IN_PROGRESS',
        messageArabic: 'يوجد طلب تحضير ذكي قيد التنفيذ حالياً لهذا اللقاء. يرجى الانتظار أو إلغاء الطلب السابق.',
      });
      return;
    }
    inFlightKeys.add(inFlightKey);

    const requestAbortController = new AbortController();
    const onResponseClose = () => {
      if (!res.writableEnded) {
        requestAbortController.abort();
      }
    };
    res.on('close', onResponseClose);

    try {
      const briefing = await generateBriefing({
        payload: sanitized.data,
        signal: requestAbortController.signal,
      });

      if (res.writableEnded || requestAbortController.signal.aborted) {
        return;
      }

      res.json(briefing);
    } catch (err: unknown) {
      if (res.writableEnded) return;

      if (err instanceof GeminiServiceError) {
        res.status(err.statusCode).json({
          error: err.errorCode,
          messageArabic: err.message,
        });
        return;
      }

      res.status(502).json({
        error: 'AI_BRIEFING_FAILED',
        messageArabic: 'تعذر إتمام التحضير الذكي المتقدم عبر المساعد حالياً.',
      });
    } finally {
      inFlightKeys.delete(inFlightKey);
      res.off('close', onResponseClose);
    }
  });

  const ALLOWED_COMM_CHANNELS = new Set([
    'phone_call',
    'whatsapp',
    'email',
    'in_person_visit',
    'video_call',
    'other',
  ]);
  const ALLOWED_COMM_TONES = new Set(['formal', 'friendly', 'concise', 'executive']);
  const ALLOWED_COMM_GRANULARITIES = new Set(['short', 'detailed', 'bullet_points']);
  const ALLOWED_COMM_CONTEXT_KEYS = new Set([
    'clientName',
    'companyName',
    'contactName',
    'contactTitle',
    'opportunityTitle',
    'opportunityValue',
    'nextAction',
    'meetingTitle',
  ]);

  router.post('/communication-draft', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser!.uid;
    const body = (req.body || {}) as Record<string, unknown>;

    const claimedUid = body.uid ?? body.userId ?? body.ownerId;
    if (claimedUid !== undefined && claimedUid !== uid) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'مرفوض: لا يُسمح بطلب صياغة ذكية لحساب آخر.',
      });
      return;
    }

    const disallowedField = detectDisallowedAiFields(body);
    if (disallowedField) {
      res.status(400).json({
        error: 'DISALLOWED_AI_INPUT_FIELD',
        messageArabic: 'مرفوض: يُمنع إرسال المرفقات السحابية أو حقول التحكم.',
      });
      return;
    }

    if (body.request && typeof body.request === 'object') {
      const nestedDisallowed = detectDisallowedAiFields(body.request as Record<string, unknown>);
      if (nestedDisallowed) {
        res.status(400).json({
          error: 'DISALLOWED_AI_INPUT_FIELD',
          messageArabic: 'مرفوض: يُمنع إرسال المرفقات السحابية أو حقول التحكم.',
        });
        return;
      }
    }

    if (body.contextData !== undefined) {
      if (
        typeof body.contextData !== 'object' ||
        body.contextData === null ||
        Array.isArray(body.contextData)
      ) {
        res.status(400).json({
          error: 'INVALID_CONTEXT_DATA',
          messageArabic: 'بيانات السياق المرفقة غير صالحة.',
        });
        return;
      }
      const ctxRecord = body.contextData as Record<string, unknown>;
      const nestedCtxDisallowed = detectDisallowedAiFields(ctxRecord);
      if (nestedCtxDisallowed) {
        res.status(400).json({
          error: 'DISALLOWED_AI_INPUT_FIELD',
          messageArabic: 'مرفوض: يُمنع إرسال المرفقات السحابية أو حقول التحكم.',
        });
        return;
      }
      for (const [k, v] of Object.entries(ctxRecord)) {
        if (!ALLOWED_COMM_CONTEXT_KEYS.has(k)) {
          res.status(400).json({
            error: 'DISALLOWED_CONTEXT_DATA_FIELD',
            messageArabic: 'يحتوي طلب الصياغة على حقول سياق غير مسموح بها.',
          });
          return;
        }
        if (v !== undefined && (typeof v !== 'string' || v.length > 300)) {
          res.status(400).json({
            error: 'INVALID_CONTEXT_DATA_VALUE',
            messageArabic: 'أحد حقول السياق يتجاوز الطول المسموح به أو ليس نصاً صالحاً.',
          });
          return;
        }
      }
    }

    const requestPayload = (body.request || body) as CommunicationDraftRequest;
    if (
      !requestPayload ||
      typeof requestPayload.channel !== 'string' ||
      !ALLOWED_COMM_CHANNELS.has(requestPayload.channel)
    ) {
      res.status(400).json({
        error: 'INVALID_COMMUNICATION_DRAFT_REQUEST',
        messageArabic: 'بيانات طلب الصياغة غير صالحة أو قناة التواصل غير مشخصة.',
      });
      return;
    }

    if (
      requestPayload.tone !== undefined &&
      (typeof requestPayload.tone !== 'string' || !ALLOWED_COMM_TONES.has(requestPayload.tone))
    ) {
      res.status(400).json({
        error: 'INVALID_COMMUNICATION_DRAFT_TONE',
        messageArabic: 'نبرة الرسالة المحددة غير صالحة.',
      });
      return;
    }

    if (
      requestPayload.granularity !== undefined &&
      (typeof requestPayload.granularity !== 'string' ||
        !ALLOWED_COMM_GRANULARITIES.has(requestPayload.granularity))
    ) {
      res.status(400).json({
        error: 'INVALID_COMMUNICATION_DRAFT_GRANULARITY',
        messageArabic: 'مستوى تفصيل الرسالة غير صالح.',
      });
      return;
    }

    if (
      requestPayload.customPrompt !== undefined &&
      (typeof requestPayload.customPrompt !== 'string' || requestPayload.customPrompt.length > 500)
    ) {
      res.status(400).json({
        error: 'INVALID_CUSTOM_PROMPT',
        messageArabic: 'التوجيه الإضافي غير صالح أو يتجاوز الحد المسموح (500 حرف).',
      });
      return;
    }

    const clientId = requestPayload.clientId || (body.clientId as string);
    if (!isValidResourceId(clientId)) {
      res.status(400).json({
        error: 'INVALID_CLIENT_ID',
        messageArabic: 'معرّف العميل غير صالح.',
      });
      return;
    }

    const contactId = requestPayload.contactId || (body.contactId as string | undefined);
    const opportunityId = requestPayload.opportunityId || (body.opportunityId as string | undefined);
    const meetingId = requestPayload.meetingId || (body.meetingId as string | undefined);

    if (contactId && !isValidResourceId(contactId)) {
      res.status(400).json({ error: 'INVALID_CONTACT_ID', messageArabic: 'معرّف جهة الاتصال غير صالح.' });
      return;
    }
    if (opportunityId && !isValidResourceId(opportunityId)) {
      res.status(400).json({ error: 'INVALID_OPPORTUNITY_ID', messageArabic: 'معرّف الفرصة غير صالح.' });
      return;
    }
    if (meetingId && !isValidResourceId(meetingId)) {
      res.status(400).json({ error: 'INVALID_MEETING_ID', messageArabic: 'معرّف اللقاء غير صالح.' });
      return;
    }

    try {
      const ownsContext = await verifyCommOwner({
        uid,
        clientId,
        ...(contactId ? { contactId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(meetingId ? { meetingId } : {}),
        idToken: req.authUser!.idToken,
      });
      if (!ownsContext) {
        res.status(403).json({
          error: 'CLIENT_ACCESS_DENIED',
          messageArabic: 'العميل أو السجلات المرتبطة غير موجودة أو لا تملك صلاحية الوصول إليها.',
        });
        return;
      }
    } catch (ownerErr: unknown) {
      const msg = ownerErr instanceof Error ? ownerErr.message : String(ownerErr || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'تم رفض الوصول إلى سجل العميل أو السجلات المرتبطة.',
        });
        return;
      }
      res.status(503).json({
        error: 'OWNERSHIP_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من ملكية البيانات على الخادم حالياً.',
      });
      return;
    }

    const currentNow = nowMs();
    const recent = (requestTimestampsByUid.get(uid) || []).filter(
      (ts) => currentNow - ts < rateLimitWindow
    );
    if (recent.length >= rateLimitMax) {
      requestTimestampsByUid.set(uid, recent);
      res.status(429).json({
        error: 'AI_RATE_LIMITED',
        messageArabic: 'تم إرسال عدد كبير من طلبات المراسلة الذكية. يرجى الانتظار قليلاً.',
      });
      return;
    }
    recent.push(currentNow);
    requestTimestampsByUid.set(uid, recent);

    const inFlightKey = `comm:${uid}:${clientId}`;
    if (inFlightKeys.has(inFlightKey)) {
      res.status(409).json({
        error: 'AI_DRAFT_IN_PROGRESS',
        messageArabic: 'يوجد طلب صياغة قيد التنفيذ لهذا العميل حالياً.',
      });
      return;
    }
    inFlightKeys.add(inFlightKey);

    const rawContext = (body.contextData || {}) as Record<string, string | undefined>;
    const contextData: {
      clientName?: string;
      companyName?: string;
      contactName?: string;
      opportunityTitle?: string;
      opportunityValue?: string;
      nextAction?: string;
    } = {
      ...(rawContext.clientName ? { clientName: rawContext.clientName.trim().slice(0, 200) } : {}),
      ...(rawContext.companyName ? { companyName: rawContext.companyName.trim().slice(0, 200) } : {}),
      ...(rawContext.contactName ? { contactName: rawContext.contactName.trim().slice(0, 200) } : {}),
      ...(rawContext.opportunityTitle
        ? { opportunityTitle: rawContext.opportunityTitle.trim().slice(0, 200) }
        : {}),
      ...(rawContext.opportunityValue
        ? { opportunityValue: rawContext.opportunityValue.trim().slice(0, 120) }
        : {}),
      ...(rawContext.nextAction ? { nextAction: rawContext.nextAction.trim().slice(0, 300) } : {}),
    };

    const requestAbortController = new AbortController();
    const onResponseClose = () => {
      if (!res.writableEnded) {
        requestAbortController.abort();
      }
    };
    res.on('close', onResponseClose);

    try {
      const draftResult = await generateDraft({
        request: requestPayload,
        contextData,
        signal: requestAbortController.signal,
      });

      if (res.writableEnded || requestAbortController.signal.aborted) {
        return;
      }

      res.json(draftResult);
    } catch (err: unknown) {
      if (res.writableEnded) return;

      if (err instanceof GeminiServiceError) {
        res.status(err.statusCode).json({
          error: err.errorCode,
          messageArabic: err.message,
        });
        return;
      }

      res.status(502).json({
        error: 'COMMUNICATION_DRAFT_FAILED',
        messageArabic: 'تعذر توليد مسودة المراسلة الذكية حالياً.',
      });
    } finally {
      inFlightKeys.delete(inFlightKey);
      res.off('close', onResponseClose);
    }
  });

  return router;
}
