import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  AllowedAttachmentMimeType,
  DocumentAiAnalysisMode,
  DocumentAiAnalysisResult,
} from '../types/index.ts';
import {
  buildAttachmentStorageKey,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';
import {
  DOCUMENT_AI_MAX_SIZE_BYTES,
  DOCUMENT_AI_RATE_LIMIT_MAX_REQUESTS,
  DOCUMENT_AI_RATE_LIMIT_WINDOW_MS,
  isSupportedDocumentAiMime,
  sanitizeDocumentAnalysisRequest,
} from '../utils/documentIntelligence.ts';
import {
  createBackblazeB2StorageService,
  type B2StorageService,
} from './b2Storage.ts';
import {
  verifyAttachmentOwnershipInNamedDb,
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  type MeetingAttachmentRecordCheck,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';
import {
  analyzeDocumentWithGemini,
} from './geminiDocumentAssistant.ts';
import {
  GeminiServiceError,
  readGeminiApiKeyFromEnv,
} from './geminiMeetingAssistant.ts';

export interface DocumentAiRouterDeps {
  verifyBearerToken?: (authHeader: string | undefined) => Promise<VerifiedFirebaseUser>;
  verifyMeetingOwnership?: (params: {
    uid: string;
    meetingId: string;
    idToken: string;
  }) => Promise<boolean>;
  verifyAttachmentOwnership?: (params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    idToken: string;
  }) => Promise<MeetingAttachmentRecordCheck>;
  storage?: Pick<B2StorageService, 'isConfigured' | 'downloadObject'>;
  isGeminiConfigured?: () => boolean;
  analyzeDocument?: (params: {
    meetingId: string;
    attachmentId: string;
    fileName: string;
    contentType: AllowedAttachmentMimeType;
    sizeBytes: number;
    bytes: Uint8Array;
    analysisMode: DocumentAiAnalysisMode;
    question?: string;
    signal?: AbortSignal;
  }) => Promise<DocumentAiAnalysisResult>;
  nowMs?: () => number;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export function createDocumentAiRouter(customDeps: DocumentAiRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner =
    customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const verifyAttachmentOwner =
    customDeps.verifyAttachmentOwnership ?? verifyAttachmentOwnershipInNamedDb;
  const storage = customDeps.storage ?? createBackblazeB2StorageService();
  const analyzeDocument = customDeps.analyzeDocument ?? analyzeDocumentWithGemini;
  const checkGeminiConfigured =
    customDeps.isGeminiConfigured ??
    (() => Boolean(customDeps.analyzeDocument) || readGeminiApiKeyFromEnv() !== null);
  const nowMs = customDeps.nowMs ?? (() => Date.now());
  const rateLimitMax = customDeps.rateLimitMaxRequests ?? DOCUMENT_AI_RATE_LIMIT_MAX_REQUESTS;
  const rateLimitWindow = customDeps.rateLimitWindowMs ?? DOCUMENT_AI_RATE_LIMIT_WINDOW_MS;

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
          messageArabic: 'يجب تسجيل الدخول بحساب Google الموثّق لاستخدام تحليل المستندات الذكي.',
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

  router.post('/document-analysis', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.authUser!.uid;
    const rawBody = req.body;

    // 1. Validate request shape & reject uid/storageKey/url/bytes spoofing BEFORE DB lookups
    const sanitizedReq = sanitizeDocumentAnalysisRequest(rawBody);
    if (!sanitizedReq.ok) {
      res.status(sanitizedReq.statusCode).json({
        error: sanitizedReq.errorCode,
        messageArabic: sanitizedReq.messageArabic,
      });
      return;
    }

    const { meetingId, attachmentId, analysisMode, question } = sanitizedReq.request;

    // 2. Verify meeting ownership inside named Firestore database
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

    // 3. Verify authoritative attachment metadata record inside named Firestore database
    let attCheck: MeetingAttachmentRecordCheck;
    try {
      attCheck = await verifyAttachmentOwner({
        uid,
        meetingId,
        attachmentId,
        idToken: req.authUser!.idToken,
      });
    } catch (attErr: any) {
      const msg = String(attErr?.message || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'تم رفض الوصول إلى بيانات هذا المرفق.',
        });
        return;
      }
      res.status(503).json({
        error: 'ATTACHMENT_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من سجل المرفق على الخادم حالياً.',
      });
      return;
    }

    if (!attCheck.exists) {
      res.status(404).json({
        error: 'ATTACHMENT_NOT_FOUND',
        messageArabic: 'سجل المرفق غير موجود داخل هذا اللقاء أو تمت إزالته.',
      });
      return;
    }

    if (attCheck.meetingId && attCheck.meetingId !== meetingId) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'المرفق المطلوب لا يتبع هذا اللقاء.',
      });
      return;
    }

    // Reject deleted or mid-deletion attachments
    if (attCheck.deleteStatus && attCheck.deleteStatus !== 'active') {
      res.status(410).json({
        error: 'ATTACHMENT_DELETED',
        messageArabic: 'هذا المرفق محذوف أو قيد الحذف من التخزين السحابي ولا يمكن تحليله.',
      });
      return;
    }

    // Reject uncommitted / still-uploading attachments
    const effectiveUploadStatus = attCheck.uploadStatus ?? attCheck.record?.uploadStatus;
    if (effectiveUploadStatus !== 'completed') {
      res.status(409).json({
        error: 'ATTACHMENT_NOT_COMMITTED',
        messageArabic: 'لم يكتمل رفع واعتماد هذا المرفق بعد، ولا يمكن تحليله قبل اكتماله.',
      });
      return;
    }

    // Verify canonical server-derived storage key isolation
    const expectedKey = buildAttachmentStorageKey({ uid, meetingId, attachmentId });
    if (attCheck.storageKey && attCheck.storageKey !== expectedKey) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'مفتاح تخزين المرفق لا يطابق مسار العزل الخاص بحسابك.',
      });
      return;
    }

    // Validate MIME & declared size
    const rawMime = (attCheck.contentType || '').trim().toLowerCase().split(';')[0];
    if (!isSupportedDocumentAiMime(rawMime)) {
      res.status(415).json({
        error: 'UNSUPPORTED_DOCUMENT_TYPE',
        messageArabic:
          'صيغة هذا المرفق غير مدعومة للتحليل الذكي. الصيغ المدعومة: PDF وJPEG وPNG وWebP فقط.',
      });
      return;
    }
    const contentType: AllowedAttachmentMimeType = rawMime;

    const declaredSize = attCheck.sizeBytes ?? attCheck.record?.sizeBytes;
    if (
      typeof declaredSize !== 'number' ||
      !Number.isFinite(declaredSize) ||
      declaredSize <= 0 ||
      declaredSize > DOCUMENT_AI_MAX_SIZE_BYTES
    ) {
      res.status(413).json({
        error: 'DOCUMENT_TOO_LARGE',
        messageArabic:
          'حجم المرفق يتجاوز الحد الأقصى المسموح لتحليل المستندات (10 ميجابايت) أو غير صالح.',
      });
      return;
    }

    // 4. Verify required server services before hitting B2 or Gemini
    if (!storage.isConfigured()) {
      res.status(503).json({
        error: 'B2_NOT_CONFIGURED',
        messageArabic: 'مفاتيح التخزين السحابي Backblaze B2 غير مضبوطة على الخادم بعد.',
      });
      return;
    }

    if (!checkGeminiConfigured()) {
      res.status(503).json({
        error: 'GEMINI_NOT_CONFIGURED',
        messageArabic:
          'خدمة تحليل المستندات الذكي غير مفعّلة بعد على الخادم لعدم توفر مفتاح GEMINI_API_KEY في متغيرات البيئة.',
      });
      return;
    }

    // 5. Per-uid sliding-window rate limiting
    const currentNow = nowMs();
    const recent = (requestTimestampsByUid.get(uid) || []).filter(
      (ts) => currentNow - ts < rateLimitWindow
    );
    if (recent.length >= rateLimitMax) {
      requestTimestampsByUid.set(uid, recent);
      res.status(429).json({
        error: 'DOCUMENT_AI_RATE_LIMITED',
        messageArabic:
          'تم إرسال عدد كبير من طلبات تحليل المستندات خلال دقيقة واحدة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
      });
      return;
    }
    recent.push(currentNow);
    requestTimestampsByUid.set(uid, recent);

    // 6. Prevent duplicate simultaneous analysis for the same attachment
    const inFlightKey = `doc:${uid}:${meetingId}:${attachmentId}`;
    if (inFlightKeys.has(inFlightKey)) {
      res.status(409).json({
        error: 'DOCUMENT_AI_IN_PROGRESS',
        messageArabic: 'يوجد تحليل قيد التنفيذ حالياً لهذا المرفق. يرجى الانتظار أو إلغاء الطلب السابق.',
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
      // 7. Download attachment bytes server-side strictly from B2 using server-built key
      let downloaded: { bytes: Uint8Array; contentType?: string; contentLength: number };
      try {
        downloaded = await storage.downloadObject(expectedKey);
      } catch (b2Err: any) {
        const status = b2Err?.$metadata?.httpStatusCode;
        const name = String(b2Err?.name || b2Err?.Code || '');
        const msg = String(b2Err?.message || '');
        if (msg.startsWith('FILE_TOO_LARGE:')) {
          res.status(413).json({
            error: 'DOCUMENT_TOO_LARGE',
            messageArabic:
              'يتجاوز حجم المرفق الفعلي الحد الأقصى المسموح به للتحليل الذكي (10 ميجابايت).',
          });
          return;
        }
        if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') {
          res.status(404).json({
            error: 'B2_OBJECT_NOT_FOUND',
            messageArabic: 'الملف غير موجود في التخزين السحابي الخاص أو تمت إزالته.',
          });
          return;
        }
        res.status(502).json({
          error: 'B2_DOWNLOAD_FAILED',
          messageArabic: 'تعذر جلب محتوى المرفق من التخزين السحابي على الخادم.',
        });
        return;
      }

      if (res.writableEnded || requestAbortController.signal.aborted) {
        return;
      }

      const bytes = downloaded.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0) {
        res.status(422).json({
          error: 'EMPTY_DOCUMENT_FILE',
          messageArabic: 'الملف المسترجع من التخزين فارغ ولا يحتوي على بيانات قابلة للتحليل.',
        });
        return;
      }

      if (bytes.byteLength > DOCUMENT_AI_MAX_SIZE_BYTES) {
        res.status(413).json({
          error: 'DOCUMENT_TOO_LARGE',
          messageArabic:
            'يتجاوز حجم الملف الفعلي الحد الأقصى المسموح به للتحليل الذكي (10 ميجابايت).',
        });
        return;
      }

      // 8. Verify real binary header (magic bytes) before sending to Gemini
      if (!verifyMagicBytes(bytes.subarray(0, 16), contentType)) {
        res.status(422).json({
          error: 'MAGIC_BYTES_MISMATCH',
          messageArabic:
            'توقيع الملف الثنائي الفعلي لا يطابق صيغته المسجلة؛ تم إيقاف التحليل لحماية النظام.',
        });
        return;
      }

      // 9. Call Gemini multimodal analyzer
      const fileName = attCheck.fileName || attachmentId;
      const result = await analyzeDocument({
        meetingId,
        attachmentId,
        fileName,
        contentType,
        sizeBytes: bytes.byteLength,
        bytes,
        analysisMode,
        question,
        signal: requestAbortController.signal,
      });

      if (res.writableEnded || requestAbortController.signal.aborted) {
        return;
      }

      res.json(result);
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
        error: 'DOCUMENT_AI_FAILED',
        messageArabic: 'تعذر إتمام تحليل المرفق عبر المساعد الذكي حالياً.',
      });
    } finally {
      inFlightKeys.delete(inFlightKey);
      res.off('close', onResponseClose);
    }
  });

  return router;
}
