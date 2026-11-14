import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AiMeetingInputPayload, MeetingAiAnalysisResult } from '../types/index.ts';
import { isValidResourceId } from '../utils/attachmentPolicy.ts';
import {
  AI_RATE_LIMIT_MAX_REQUESTS,
  AI_RATE_LIMIT_WINDOW_MS,
  detectDisallowedAiFields,
  sanitizeIncomingAiPayload,
} from '../utils/meetingAiAssistant.ts';
import {
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';
import {
  analyzeMeetingWithGemini,
  GeminiServiceError,
} from './geminiMeetingAssistant.ts';

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
  nowMs?: () => number;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export function createAiRouter(customDeps: AiRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner =
    customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const analyzeMeeting = customDeps.analyzeMeeting ?? analyzeMeetingWithGemini;
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
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
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
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية الوصول إليه.',
        });
        return;
      }
    } catch (ownerErr: any) {
      const msg = String(ownerErr?.message || '');
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
    } catch (err: any) {
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

  return router;
}
