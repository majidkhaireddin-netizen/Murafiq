import * as crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type {
  AllowedAttachmentMimeType,
  MeetingAttachment,
  UploadIntentRecord,
} from '../types/index.ts';
import {
  buildAttachmentStorageKey,
  isValidResourceId,
  MAX_ATTACHMENT_SIZE_BYTES,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  PRESIGNED_UPLOAD_TTL_SECONDS,
  UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
  UPLOAD_COMMIT_LEASE_MS,
  UPLOAD_INTENT_GRACE_MS,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';
import { createBackblazeB2StorageService, type B2StorageService } from './b2Storage.ts';
import {
  createFirebaseAttachmentMetadataStore,
  verifyAttachmentOwnershipInNamedDb,
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  type AttachmentMetadataStore,
  type MeetingAttachmentRecordCheck,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';

export interface SweepExpiredUploadIntentsResult {
  scanned: number;
  cleaned: number;
  skipped: number;
  failed: number;
  cleanedAttachmentIds: string[];
  skippedAttachmentIds: string[];
  failedAttachmentIds: string[];
}

/**
 * Multi-instance-safe server sweeper for expired, uncommitted UploadIntents.
 * Uses Firestore transactional state transitions ('pending' -> 'cleaning' -> 'abandoned')
 * so neither actively committing uploads nor already committed attachments can ever be deleted.
 */
export async function sweepExpiredUploadIntents(params: {
  candidates: UploadIntentRecord[];
  metadataStore: AttachmentMetadataStore;
  storage: B2StorageService;
  nowMs?: number;
  safetyBufferMs?: number;
}): Promise<SweepExpiredUploadIntentsResult> {
  const {
    candidates,
    metadataStore,
    storage,
    nowMs = Date.now(),
    safetyBufferMs = UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
  } = params;
  const nowIso = new Date(nowMs).toISOString();

  const result: SweepExpiredUploadIntentsResult = {
    scanned: candidates.length,
    cleaned: 0,
    skipped: 0,
    failed: 0,
    cleanedAttachmentIds: [],
    skippedAttachmentIds: [],
    failedAttachmentIds: [],
  };

  for (const candidate of candidates) {
    const claim = await metadataStore.claimIntentForExpirationCleanup({
      uid: candidate.userId,
      meetingId: candidate.meetingId,
      attachmentId: candidate.attachmentId,
      nowMs,
      nowIso,
      safetyBufferMs,
    });

    if (claim.outcome !== 'claimed' || !claim.intent) {
      result.skipped += 1;
      result.skippedAttachmentIds.push(candidate.attachmentId);
      continue;
    }

    const expectedKey = buildAttachmentStorageKey({
      uid: claim.intent.userId,
      meetingId: claim.intent.meetingId,
      attachmentId: claim.intent.attachmentId,
    });

    try {
      await storage.deleteObject(expectedKey);
      await metadataStore.finalizeExpiredIntentCleanup({
        uid: claim.intent.userId,
        meetingId: claim.intent.meetingId,
        attachmentId: claim.intent.attachmentId,
        nowIso,
      });
      result.cleaned += 1;
      result.cleanedAttachmentIds.push(claim.intent.attachmentId);
    } catch {
      await metadataStore
        .releaseExpiredIntentCleaningOnFailure({
          uid: claim.intent.userId,
          meetingId: claim.intent.meetingId,
          attachmentId: claim.intent.attachmentId,
          nowIso,
        })
        .catch(() => {});
      result.failed += 1;
      result.failedAttachmentIds.push(claim.intent.attachmentId);
    }
  }

  return result;
}

export interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export interface AttachmentsRouterDeps {
  verifyBearerToken?: (authHeader: string | undefined) => Promise<VerifiedFirebaseUser>;
  verifyMeetingOwnership?: (params: { uid: string; meetingId: string; idToken: string }) => Promise<boolean>;
  verifyAttachmentOwnership?: (params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    idToken: string;
  }) => Promise<MeetingAttachmentRecordCheck>;
  metadataStore?: AttachmentMetadataStore;
  storageService?: B2StorageService;
  generateAttachmentId?: () => string;
  now?: () => number;
  enableScheduledSweepEndpoint?: boolean;
  scheduledSweepSecret?: string;
}

function rejectIfCallerTriedPathOrUidSpoofing(
  body: Record<string, unknown>,
  verifiedUid: string
): string | null {
  if (
    body.storageKey !== undefined ||
    body.objectKey !== undefined ||
    body.path !== undefined ||
    body.bucket !== undefined
  ) {
    return 'يُمنع تحديد مسار الملف أو الـ Bucket من جهة العميل؛ يولّد الخادم المسار تلقائياً.';
  }

  if (body.uploadStatus !== undefined || body.deleteStatus !== undefined) {
    return 'يُمنع تحديد حالة الاعتماد أو الحذف من جهة العميل؛ الخادم هو الجهة الموثوقة لإدارة الحالة.';
  }

  const claimedUid = body.uid ?? body.userId ?? body.ownerId;
  if (claimedUid !== undefined && claimedUid !== verifiedUid) {
    return 'مرفوض: لا يُسمح بطلب أو تعديل مرفقات تخص حساباً آخر.';
  }

  return null;
}

function encodeRfc5987HeaderValue(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function handleServerConfigOrAccessError(
  err: any,
  res: Response,
  fallbackStatus: number,
  fallbackCode: string,
  fallbackArabic: string
): void {
  const msg = String(err?.message || '');
  if (msg.startsWith('FORBIDDEN:')) {
    res.status(403).json({
      error: 'FORBIDDEN',
      messageArabic: 'تم رفض الوصول إلى بيانات اللقاء.',
    });
    return;
  }
  if (msg.startsWith('FIREBASE_ADMIN_NOT_CONFIGURED:')) {
    res.status(503).json({
      error: 'FIREBASE_ADMIN_NOT_CONFIGURED',
      messageArabic:
        'تعذر إتمام العملية لأن صلاحيات خادم Firebase Admin غير مهيأة بعد للوصول إلى قاعدة البيانات المسماة.',
    });
    return;
  }
  res.status(fallbackStatus).json({
    error: fallbackCode,
    messageArabic: fallbackArabic,
  });
}

async function readBinaryBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength > maxBytes) {
      const err: any = new Error('FILE_TOO_LARGE');
      err.statusCode = 413;
      throw err;
    }
    return new Uint8Array(req.body);
  }
  if (req.body instanceof Uint8Array) {
    if (req.body.byteLength > maxBytes) {
      const err: any = new Error('FILE_TOO_LARGE');
      err.statusCode = 413;
      throw err;
    }
    return req.body;
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const fail = (err: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        req.pause();
        const err: any = new Error('FILE_TOO_LARGE');
        err.statusCode = 413;
        fail(err);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(new Uint8Array(Buffer.concat(chunks, totalBytes)));
    };

    const onError = (err: Error) => {
      fail(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Per-attachment async lock queue so overlapping complete-upload, cleanup-uncommitted,
 * relay-upload, and delete operations on the same attachment execute strictly sequentially.
 */
function createAttachmentLockManager() {
  const tails = new Map<string, Promise<unknown>>();

  return async function withAttachmentLock<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev = tails.get(key) || Promise.resolve();
    const next = prev.then(
      () => fn(),
      () => fn()
    );
    const tailCleanup = next.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tailCleanup);
    try {
      return await next;
    } finally {
      if (tails.get(key) === tailCleanup) {
        tails.delete(key);
      }
    }
  };
}

export function createAttachmentsRouter(customDeps: AttachmentsRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner = customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const verifyAttachmentOwner =
    customDeps.verifyAttachmentOwnership ?? verifyAttachmentOwnershipInNamedDb;
  const metadataStore = customDeps.metadataStore ?? createFirebaseAttachmentMetadataStore();
  const storage = customDeps.storageService ?? createBackblazeB2StorageService();
  const generateId =
    customDeps.generateAttachmentId ??
    (() => `att_${crypto.randomUUID().replace(/-/g, '')}`);
  const nowMs = customDeps.now ?? (() => Date.now());
  const withAttachmentLock = createAttachmentLockManager();

  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
          messageArabic: 'يجب تسجيل الدخول بحساب Google الموثّق للوصول إلى مرفقات اللقاءات.',
          detail: process.env.NODE_ENV === 'test' ? msg : undefined,
        });
        return;
      }

      res.status(500).json({
        error: 'AUTH_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من جلسة المصادقة على الخادم مؤقتاً. يرجى المحاولة مرة أخرى.',
        detail: process.env.NODE_ENV === 'test' ? msg : undefined,
      });
    }
  };

  /**
   * Prepared scheduled cleanup endpoint for Cloud Scheduler / internal cron.
   * Disabled by default until product owner explicitly activates ENABLE_EXPIRED_INTENT_SWEEP_ENDPOINT=true
   * and sets a high-entropy CLEANUP_SWEEP_SECRET.
   */
  router.post('/sweep-expired-scheduled', async (req: Request, res: Response) => {
    const isEnabled =
      customDeps.enableScheduledSweepEndpoint ??
      process.env.ENABLE_EXPIRED_INTENT_SWEEP_ENDPOINT === 'true';

    if (!isEnabled) {
      res.status(403).json({
        error: 'SCHEDULED_SWEEP_DISABLED',
        messageArabic:
          'مسار التنظيف المجدول التلقائي غير مفعّل بعد بانتظار اعتماد مالك المنتج.',
      });
      return;
    }

    const expectedSecret =
      (customDeps.scheduledSweepSecret ?? process.env.CLEANUP_SWEEP_SECRET ?? '').trim();
    const providedSecret = String(req.header('x-murafiq-cleanup-secret') || '').trim();

    if (expectedSecret.length < 16 || !providedSecret) {
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        messageArabic: 'مفقود رمز التحقق المجدول للتنظيف.',
      });
      return;
    }

    const a = Buffer.from(expectedSecret, 'utf8');
    const b = Buffer.from(providedSecret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        messageArabic: 'رمز التحقق المجدول غير صالح.',
      });
      return;
    }

    if (!storage.isConfigured()) {
      res.status(503).json({
        error: 'STORAGE_NOT_CONFIGURED',
        messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
      });
      return;
    }

    try {
      const candidates = await metadataStore.listPendingUploadIntentsGlobal({ limit: 50 });
      const sweepRes = await sweepExpiredUploadIntents({
        candidates,
        metadataStore,
        storage,
        nowMs: nowMs(),
      });
      res.json(sweepRes);
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'SCHEDULED_SWEEP_FAILED',
        'تعذر تنفيذ التنظيف المجدول للعمليات المنتهية.'
      );
    }
  });

  router.use(requireAuth);

  // 1. Issue short-lived S3 Presigned PUT URL and record a server-authoritative UploadIntent
  router.post('/presign-upload', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId)) {
        res.status(400).json({
          error: 'INVALID_MEETING_ID',
          messageArabic: 'معرّف اللقاء غير صالح.',
        });
        return;
      }

      const fileValidation = validateAttachmentFileRequest({
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
      });

      if (!fileValidation.valid || !fileValidation.normalizedContentType || !fileValidation.sanitizedFileName) {
        res.status(400).json({
          error: fileValidation.errorCode || 'VALIDATION_FAILED',
          messageArabic: fileValidation.errorArabic || 'بيانات الملف المراد رفعه غير صالحة.',
        });
        return;
      }

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId: body.meetingId,
        idToken: req.authUser!.idToken,
      });

      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية إضافة مرفقات إليه.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic:
            'خدمة تخزين Backblaze B2 غير مفعّلة بعد على الخادم (مفاتيح B2 غير متوفرة في Secrets).',
        });
        return;
      }

      const attachmentId = generateId();
      const storageKey = buildAttachmentStorageKey({
        uid,
        meetingId: body.meetingId,
        attachmentId,
      });

      const currentMs = nowMs();
      const nowIso = new Date(currentMs).toISOString();
      const intentExpiresAt = new Date(currentMs + UPLOAD_INTENT_GRACE_MS).toISOString();
      const intent: UploadIntentRecord = {
        attachmentId,
        userId: uid,
        meetingId: body.meetingId,
        fileName: fileValidation.sanitizedFileName,
        contentType: fileValidation.normalizedContentType,
        sizeBytes: body.sizeBytes as number,
        storageKey,
        bucket: storage.getBucketName ? storage.getBucketName() : 'Murafiq',
        status: 'pending',
        expiresAt: intentExpiresAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const createIntentResult = await metadataStore.createUploadIntent(intent);
      if (createIntentResult.outcome === 'meeting_not_found') {
        res.status(404).json({
          error: 'MEETING_NOT_FOUND',
          messageArabic: 'تعذر بدء رفع المرفق لأن اللقاء غير موجود أو تم حذفه.',
        });
        return;
      }
      if (createIntentResult.outcome === 'forbidden') {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية إضافة مرفقات إلى هذا اللقاء.',
        });
        return;
      }

      const presigned = await storage.createPresignedUploadUrl({
        key: storageKey,
        contentType: fileValidation.normalizedContentType,
        sizeBytes: body.sizeBytes as number,
        expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
      });

      res.json({
        attachmentId,
        meetingId: body.meetingId,
        fileName: fileValidation.sanitizedFileName,
        contentType: fileValidation.normalizedContentType,
        sizeBytes: body.sizeBytes,
        storageKey,
        uploadUrl: presigned.uploadUrl,
        expiresAt: presigned.expiresAt,
        expiresInSeconds: presigned.expiresInSeconds,
        requiredHeaders: {
          'Content-Type': fileValidation.normalizedContentType,
        },
      });
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'PRESIGN_UPLOAD_FAILED',
        'تعذر تجهيز رابط الرفع الآمن من الخادم. حاول مرة أخرى.'
      );
    }
  });

  // 2. Server-authoritative B2 object verification & transactional Firestore attachment commit
  router.post('/complete-upload', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId) || !isValidResourceId(body.attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
        });
        return;
      }

      const meetingId = body.meetingId;
      const attachmentId = body.attachmentId;

      const fileValidation = validateAttachmentFileRequest({
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
      });

      if (!fileValidation.valid || !fileValidation.normalizedContentType || !fileValidation.sanitizedFileName) {
        res.status(400).json({
          error: fileValidation.errorCode || 'VALIDATION_FAILED',
          messageArabic: fileValidation.errorArabic || 'بيانات المرفق غير صالحة.',
        });
        return;
      }

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });

      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية على هذا اللقاء.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const lockKey = `${uid}:${meetingId}:${attachmentId}`;
      const result = await withAttachmentLock(lockKey, async () => {
        const currentMs = nowMs();
        const claimIso = new Date(currentMs).toISOString();

        // Transactional lease claim prevents any concurrent sweeper across server instances
        // from deleting the B2 object while this instance verifies and commits it.
        const claim = await metadataStore.claimIntentForCommit({
          uid,
          meetingId,
          attachmentId,
          nowMs: currentMs,
          nowIso: claimIso,
          leaseDurationMs: UPLOAD_COMMIT_LEASE_MS,
          expectedFileName: fileValidation.sanitizedFileName,
          expectedContentType: fileValidation.normalizedContentType,
          expectedSizeBytes: body.sizeBytes as number,
        });

        if (claim.outcome === 'already_committed' && claim.record) {
          return { status: 200 as const, body: claim.record };
        }
        if (claim.outcome === 'intent_not_found') {
          return {
            status: 404 as const,
            body: {
              error: 'UPLOAD_INTENT_NOT_FOUND',
              messageArabic: 'مرفوض: لا يوجد إذن رفع موثق لهذه العملية.',
            },
          };
        }
        if (claim.outcome === 'intent_mismatch') {
          return {
            status: 403 as const,
            body: {
              error: 'UPLOAD_INTENT_MISMATCH',
              messageArabic: 'مرفوض: بيانات الملف أو الحساب لا تطابق إذن الرفع المصرح به.',
            },
          };
        }
        if (claim.outcome === 'intent_abandoned') {
          return {
            status: 409 as const,
            body: {
              error: 'UPLOAD_INTENT_ABANDONED',
              messageArabic: 'تم إلغاء أو إنهاء عملية الرفع هذه مسبقاً. يرجى بدء رفع جديد.',
            },
          };
        }
        if (claim.outcome === 'commit_in_progress') {
          return {
            status: 409 as const,
            body: {
              error: 'UPLOAD_COMMIT_IN_PROGRESS',
              messageArabic: 'جاري التحقق من نفس المرفق وتثبيته حالياً، يرجى الانتظار لحظة ثم المحاولة.',
            },
          };
        }

        const intent = claim.intent!;

        const storageKey = buildAttachmentStorageKey({
          uid,
          meetingId,
          attachmentId,
        });

        let verification;
        try {
          // Verify B2 object existence, exact size, and binary Magic Bytes
          verification = await storage.verifyUploadedObject({
            key: storageKey,
            expectedContentType: intent.contentType,
            expectedSizeBytes: intent.sizeBytes,
          });
        } catch (verifyErr) {
          await metadataStore
            .releaseIntentCommitLease?.({
              uid,
              meetingId,
              attachmentId,
              nowIso: new Date(nowMs()).toISOString(),
            })
            .catch(() => {});
          throw verifyErr;
        }

        if (!verification.verified) {
          // verifyUploadedObject already removed any invalid B2 object, so we can safely release guard
          await metadataStore
            .markUploadIntentAbandonedIfPending({
              uid,
              meetingId,
              attachmentId,
              nowIso: new Date(nowMs()).toISOString(),
              releaseGuard: true,
              cleanupReason: 'verification_failed',
            })
            .catch(() => {});

          return {
            status: 422 as const,
            body: {
              error: 'UPLOAD_VERIFICATION_FAILED',
              messageArabic:
                verification.reasonArabic ||
                'فشل التحقق من الملف المرفوع في Backblaze B2. يرجى إعادة المحاولة.',
            },
          };
        }

        const nowIso = new Date(nowMs()).toISOString();
        const attachmentPayload: MeetingAttachment = {
          id: attachmentId,
          userId: uid,
          meetingId,
          fileName: intent.fileName,
          contentType: intent.contentType,
          sizeBytes: verification.sizeBytes,
          storageKey,
          storageProvider: 'backblaze_b2',
          uploadStatus: 'completed',
          deleteStatus: 'active',
          etag: verification.etag,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const commitRes = await metadataStore.commitAttachmentFromIntent({
          uid,
          meetingId,
          attachmentId,
          attachment: attachmentPayload,
          nowIso,
        });

        if (commitRes.outcome === 'committed' || commitRes.outcome === 'already_committed') {
          return {
            status: 200 as const,
            body: commitRes.record!,
          };
        }

        if (commitRes.outcome === 'intent_abandoned') {
          return {
            status: 409 as const,
            body: {
              error: 'UPLOAD_INTENT_ABANDONED',
              messageArabic: 'تم إلغاء عملية الرفع قبل التثبيت. يرجى إعادة رفع الملف.',
            },
          };
        }

        return {
          status: 404 as const,
          body: {
            error: 'UPLOAD_INTENT_NOT_FOUND',
            messageArabic: 'تعذر العثور على إذن الرفع أثناء التثبيت.',
          },
        };
      });

      res.status(result.status).json(result.body);
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'COMPLETE_UPLOAD_FAILED',
        'حدث خطأ أثناء التحقق من اكتمال رفع المرفق وحفظه في قاعدة البيانات.'
      );
    }
  });

  // 3. Issue short-lived S3 Presigned GET URL for viewing or downloading an attachment
  router.post('/presign-download', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId) || !isValidResourceId(body.attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
        });
        return;
      }

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId: body.meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية الوصول إلى مرفقات هذا اللقاء.',
        });
        return;
      }

      const attCheck = await verifyAttachmentOwner({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
        idToken: req.authUser!.idToken,
      });

      if (!attCheck.exists) {
        res.status(404).json({
          error: 'ATTACHMENT_NOT_FOUND',
          messageArabic: 'المرفق المطلوب غير موجود أو لا يخص حسابك.',
        });
        return;
      }

      if (attCheck.deleteStatus === 'b2_deleted') {
        res.status(410).json({
          error: 'ATTACHMENT_BEING_DELETED',
          messageArabic: 'تمت إزالة هذا المرفق من التخزين السحابي وهو بانتظار استكمال حذف السجل.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const expectedKey = buildAttachmentStorageKey({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
      });

      if (attCheck.storageKey && attCheck.storageKey !== expectedKey) {
        res.status(403).json({
          error: 'STORAGE_KEY_MISMATCH',
          messageArabic: 'مسار الملف المحفوظ لا يطابق مسار الحساب المصرح به.',
        });
        return;
      }

      const disposition = body.disposition === 'attachment' ? 'attachment' : 'inline';
      const contentType =
        (attCheck.contentType as AllowedAttachmentMimeType) ||
        validateAttachmentFileRequest({
          fileName: attCheck.fileName || 'file.pdf',
          contentType: attCheck.contentType || 'application/pdf',
          sizeBytes: 1024,
        }).normalizedContentType ||
        ('application/pdf' as AllowedAttachmentMimeType);

      const presigned = await storage.createPresignedDownloadUrl({
        key: expectedKey,
        fileName: attCheck.fileName || 'attachment',
        contentType,
        disposition,
        expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
      });

      res.json({
        downloadUrl: presigned.downloadUrl,
        expiresAt: presigned.expiresAt,
        expiresInSeconds: presigned.expiresInSeconds,
      });
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'PRESIGN_DOWNLOAD_FAILED',
        'تعذر إنشاء رابط عرض أو تنزيل مؤقت للمرفق.'
      );
    }
  });

  // 4. Server-coordinated recoverable deletion of attachment from B2 and named Firestore DB
  router.post('/delete', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId) || !isValidResourceId(body.attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
        });
        return;
      }

      const meetingId = body.meetingId;
      const attachmentId = body.attachmentId;

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية حذف مرفقات هذا اللقاء.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const lockKey = `${uid}:${meetingId}:${attachmentId}`;
      const result = await withAttachmentLock(lockKey, async () => {
        // Check attachment record in named DB via trusted store
        let attCheck: MeetingAttachmentRecordCheck;
        try {
          attCheck = await metadataStore.getAttachmentRecord({
            uid,
            meetingId,
            attachmentId,
          });
        } catch (err: any) {
          if (String(err?.message || '').startsWith('FIREBASE_ADMIN_NOT_CONFIGURED:')) {
            throw err;
          }
          attCheck = await verifyAttachmentOwner({
            uid,
            meetingId,
            attachmentId,
            idToken: req.authUser!.idToken,
          });
        }

        if (!attCheck.exists) {
          // Idempotent duplicate delete check: if intent is already marked deleted, return clean 200
          const existingIntent = await metadataStore
            .getUploadIntent({ uid, meetingId, attachmentId })
            .catch(() => null);
          if (existingIntent?.status === 'deleted') {
            return {
              status: 200 as const,
              body: {
                deleted: true,
                alreadyDeleted: true,
                attachmentId,
              },
            };
          }

          return {
            status: 404 as const,
            body: {
              error: 'ATTACHMENT_NOT_FOUND',
              messageArabic: 'المرفق غير موجود في سجلات هذا اللقاء.',
            },
          };
        }

        const expectedKey = buildAttachmentStorageKey({
          uid,
          meetingId,
          attachmentId,
        });

        if (attCheck.storageKey && attCheck.storageKey !== expectedKey) {
          return {
            status: 403 as const,
            body: {
              error: 'STORAGE_KEY_MISMATCH',
              messageArabic: 'مسار الملف المحفوظ لا يطابق مسار الحساب المصرح به.',
            },
          };
        }

        const currentDeleteStatus = attCheck.deleteStatus || 'active';

        // Step A: Delete from B2 unless a previous recoverable pass already confirmed B2 deletion
        if (currentDeleteStatus !== 'b2_deleted') {
          await metadataStore.updateAttachmentDeleteStatus({
            uid,
            meetingId,
            attachmentId,
            deleteStatus: 'deleting',
            updatedAt: new Date(nowMs()).toISOString(),
          });

          try {
            await storage.deleteObject(expectedKey);
          } catch {
            const failMsg =
              'تعذر حذف الملف من التخزين السحابي (Backblaze B2). تم الإبقاء على سجل المرفق لتتمكن من إعادة المحاولة بأمان.';
            await metadataStore
              .updateAttachmentDeleteStatus({
                uid,
                meetingId,
                attachmentId,
                deleteStatus: 'delete_failed',
                deleteErrorArabic: failMsg,
                updatedAt: new Date(nowMs()).toISOString(),
              })
              .catch(() => {});

            return {
              status: 502 as const,
              body: {
                error: 'B2_DELETE_FAILED',
                recoverable: true,
                deleteStatus: 'delete_failed',
                messageArabic: failMsg,
              },
            };
          }

          // Record transitional state so retry skips/survives even if Firestore delete fails next
          await metadataStore
            .updateAttachmentDeleteStatus({
              uid,
              meetingId,
              attachmentId,
              deleteStatus: 'b2_deleted',
              deleteErrorArabic: '',
              updatedAt: new Date(nowMs()).toISOString(),
            })
            .catch(() => {});
        }

        // Step B: Finalize Firestore metadata deletion on the named DB
        try {
          await metadataStore.finalizeAttachmentDeletion({
            uid,
            meetingId,
            attachmentId,
            nowIso: new Date(nowMs()).toISOString(),
          });
        } catch {
          return {
            status: 502 as const,
            body: {
              error: 'FIRESTORE_DELETE_INCOMPLETE',
              recoverable: true,
              deleteStatus: 'b2_deleted',
              messageArabic:
                'تم حذف الملف من التخزين السحابي، لكن تعذر حذف سجله من قاعدة البيانات. أعد الضغط على حذف لإكمال التنظيف.',
            },
          };
        }

        return {
          status: 200 as const,
          body: {
            deleted: true,
            attachmentId,
            storageKey: expectedKey,
            versioningNoteArabic:
              'تم حذف المرفق وسجله من قاعدة البيانات، وأُرسل أمر حذف الإصدار الحالي إلى Backblaze B2.',
          },
        };
      });

      res.status(result.status).json(result.body);
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'DELETE_ATTACHMENT_FAILED',
        'تعذر إتمام حذف المرفق من الخادم. يمكنك إعادة المحاولة لاحقاً.'
      );
    }
  });

  // 5. Hardened cleanup of uncommitted B2 objects (NEVER deletes committed attachments)
  router.post('/cleanup-uncommitted', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId) || !isValidResourceId(body.attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف غير صالح.',
        });
        return;
      }

      const meetingId = body.meetingId;
      const attachmentId = body.attachmentId;

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية تنظيف هذا المرفق.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة.',
        });
        return;
      }

      const lockKey = `${uid}:${meetingId}:${attachmentId}`;
      const result = await withAttachmentLock(lockKey, async () => {
        const markRes = await metadataStore.markUploadIntentAbandonedIfPending({
          uid,
          meetingId,
          attachmentId,
          nowIso: new Date(nowMs()).toISOString(),
          releaseGuard: false,
          cleanupReason: 'client_abandoned',
        });

        if (markRes.outcome === 'already_committed') {
          return {
            status: 409 as const,
            body: {
              error: 'ATTACHMENT_ALREADY_COMMITTED',
              messageArabic: 'مرفوض: المرفق معتمد ومحفوظ بالفعل ولا يمكن حذفه عبر مسار التنظيف المؤقت.',
            },
          };
        }

        if (markRes.outcome === 'not_found') {
          return {
            status: 404 as const,
            body: {
              error: 'UPLOAD_INTENT_NOT_FOUND',
              messageArabic: 'لا توجد عملية رفع مؤقتة غير معتمدة لهذا المعرّف.',
            },
          };
        }

        const expectedKey = buildAttachmentStorageKey({
          uid,
          meetingId,
          attachmentId,
        });

        await storage.deleteObject(expectedKey);
        await metadataStore.releaseIntentFromGuard({
          uid,
          meetingId,
          attachmentId,
          nowIso: new Date(nowMs()).toISOString(),
        });
        return {
          status: 200 as const,
          body: {
            cleanedUp: true,
            alreadyCleaned: markRes.outcome === 'already_abandoned',
            attachmentId,
          },
        };
      });

      res.status(result.status).json(result.body);
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        502,
        'CLEANUP_FAILED',
        'تعذر تنظيف الملف المؤقت من Backblaze B2.'
      );
    }
  });

  // 5b. Owner-triggered safe cleanup of expired, uncommitted UploadIntents on a specific meeting
  router.post('/cleanup-expired', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId)) {
        res.status(400).json({
          error: 'INVALID_MEETING_ID',
          messageArabic: 'معرّف اللقاء غير صالح.',
        });
        return;
      }

      const meetingId = body.meetingId;
      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية تنظيف مرفقات هذا اللقاء.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const candidates = await metadataStore.listPendingUploadIntentsForMeeting({
        uid,
        meetingId,
      });
      const sweepRes = await sweepExpiredUploadIntents({
        candidates,
        metadataStore,
        storage,
        nowMs: nowMs(),
      });

      res.json(sweepRes);
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        500,
        'CLEANUP_EXPIRED_FAILED',
        'تعذر تنظيف عمليات الرفع المنتهية غير المكتملة.'
      );
    }
  });

  // 6. Same-origin authenticated upload relay fallback (used when B2 bucket CORS blocks direct browser PUT)
  router.put('/relay-upload', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const queryObj = (req.query || {}) as Record<string, unknown>;
      const spoofCheckObj: Record<string, unknown> = {
        ...queryObj,
        storageKey: req.headers['x-storage-key'] ?? queryObj.storageKey,
        objectKey: req.headers['x-object-key'] ?? queryObj.objectKey,
        path: req.headers['x-path'] ?? queryObj.path,
        bucket: req.headers['x-bucket'] ?? queryObj.bucket,
        uid: req.headers['x-uid'] ?? queryObj.uid,
        userId: req.headers['x-user-id'] ?? queryObj.userId,
        uploadStatus: req.headers['x-upload-status'] ?? queryObj.uploadStatus,
        deleteStatus: req.headers['x-delete-status'] ?? queryObj.deleteStatus,
      };
      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(spoofCheckObj, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      const meetingId = req.header('x-meeting-id');
      const attachmentId = req.header('x-attachment-id');
      const rawEncodedName = req.header('x-file-name') || '';
      let decodedFileName = '';
      try {
        decodedFileName = rawEncodedName ? decodeURIComponent(rawEncodedName) : '';
      } catch {
        res.status(400).json({
          error: 'INVALID_FILENAME',
          messageArabic: 'اسم الملف في الترويسة غير صالح.',
        });
        return;
      }

      if (!isValidResourceId(meetingId) || !isValidResourceId(attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
        });
        return;
      }

      const contentTypeHeader = req.header('content-type') || '';
      const declaredSizeHeader = Number(req.header('content-length') || '0');
      const sizeForPrecheck =
        Number.isFinite(declaredSizeHeader) && declaredSizeHeader > 0
          ? declaredSizeHeader
          : 1;

      const preValidation = validateAttachmentFileRequest({
        fileName: decodedFileName,
        contentType: contentTypeHeader,
        sizeBytes: sizeForPrecheck,
      });

      if (!preValidation.valid || !preValidation.normalizedContentType || !preValidation.sanitizedFileName) {
        const status = preValidation.errorCode === 'FILE_TOO_LARGE' ? 413 : 400;
        res.status(status).json({
          error: preValidation.errorCode || 'VALIDATION_FAILED',
          messageArabic: preValidation.errorArabic || 'بيانات الملف المرفوع غير صالحة.',
        });
        return;
      }

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });

      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية إضافة مرفقات إليه.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const intent = await metadataStore.getUploadIntent({
        uid,
        meetingId,
        attachmentId,
      });
      if (!intent) {
        res.status(404).json({
          error: 'UPLOAD_INTENT_NOT_FOUND',
          messageArabic: 'مرفوض: لا يوجد إذن رفع موثق لهذه العملية.',
        });
        return;
      }
      if (intent.status !== 'pending') {
        res.status(409).json({
          error: 'UPLOAD_INTENT_NOT_PENDING',
          messageArabic: 'عملية الرفع هذه لم تعد في حالة انتظار الرفع.',
        });
        return;
      }
      if (
        intent.userId !== uid ||
        intent.meetingId !== meetingId ||
        intent.fileName !== preValidation.sanitizedFileName ||
        intent.contentType !== preValidation.normalizedContentType
      ) {
        res.status(403).json({
          error: 'UPLOAD_INTENT_MISMATCH',
          messageArabic: 'بيانات الملف لا تطابق إذن الرفع المصرح به.',
        });
        return;
      }

      const bodyBytes = await readBinaryBodyCapped(req, MAX_ATTACHMENT_SIZE_BYTES);
      const actualValidation = validateAttachmentFileRequest({
        fileName: preValidation.sanitizedFileName,
        contentType: preValidation.normalizedContentType,
        sizeBytes: bodyBytes.byteLength,
      });

      if (!actualValidation.valid) {
        const status = actualValidation.errorCode === 'FILE_TOO_LARGE' ? 413 : 400;
        res.status(status).json({
          error: actualValidation.errorCode || 'VALIDATION_FAILED',
          messageArabic: actualValidation.errorArabic || 'حجم الملف غير صالح.',
        });
        return;
      }

      if (bodyBytes.byteLength !== intent.sizeBytes) {
        res.status(400).json({
          error: 'SIZE_MISMATCH',
          messageArabic: 'حجم الملف المرسل لا يطابق الحجم المسجل في إذن الرفع.',
        });
        return;
      }

      if (!verifyMagicBytes(bodyBytes.subarray(0, 16), preValidation.normalizedContentType)) {
        res.status(422).json({
          error: 'MAGIC_BYTES_MISMATCH',
          messageArabic:
            'المحتوى الفعلي للملف لا يطابق صيغته المعلنة (JPEG/PNG/WebP/PDF). تم حظر الرفع لحماية النظام.',
        });
        return;
      }

      const storageKey = buildAttachmentStorageKey({
        uid,
        meetingId,
        attachmentId,
      });

      const uploaded = await storage.uploadObject({
        key: storageKey,
        contentType: preValidation.normalizedContentType,
        body: bodyBytes,
      });

      res.json({
        uploaded: true,
        attachmentId,
        storageKey,
        sizeBytes: bodyBytes.byteLength,
        etag: uploaded.etag,
      });
    } catch (err: any) {
      if (err?.statusCode === 413 || err?.message === 'FILE_TOO_LARGE') {
        res.status(413).json({
          error: 'FILE_TOO_LARGE',
          messageArabic: 'يتجاوز حجم الملف الحد الأقصى المسموح به وهو 10 ميجابايت (10 MB).',
        });
        return;
      }
      handleServerConfigOrAccessError(
        err,
        res,
        502,
        'RELAY_UPLOAD_FAILED',
        'تعذر تمرير الملف إلى خادم التخزين السحابي. يرجى المحاولة مرة أخرى.'
      );
    }
  });

  // 7. Same-origin authenticated download/view relay fallback
  router.post('/relay-download', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const spoofError = rejectIfCallerTriedPathOrUidSpoofing(body, uid);
      if (spoofError) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: spoofError });
        return;
      }

      if (!isValidResourceId(body.meetingId) || !isValidResourceId(body.attachmentId)) {
        res.status(400).json({
          error: 'INVALID_RESOURCE_ID',
          messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
        });
        return;
      }

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId: body.meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية الوصول إلى مرفقات هذا اللقاء.',
        });
        return;
      }

      const attCheck = await verifyAttachmentOwner({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
        idToken: req.authUser!.idToken,
      });

      if (!attCheck.exists) {
        res.status(404).json({
          error: 'ATTACHMENT_NOT_FOUND',
          messageArabic: 'المرفق المطلوب غير موجود أو لا يخص حسابك.',
        });
        return;
      }

      if (attCheck.deleteStatus === 'b2_deleted') {
        res.status(410).json({
          error: 'ATTACHMENT_BEING_DELETED',
          messageArabic: 'تمت إزالة هذا المرفق من التخزين السحابي وهو بانتظار استكمال حذف السجل.',
        });
        return;
      }

      if (!storage.isConfigured()) {
        res.status(503).json({
          error: 'STORAGE_NOT_CONFIGURED',
          messageArabic: 'خدمة Backblaze B2 غير مفعّلة على الخادم.',
        });
        return;
      }

      const expectedKey = buildAttachmentStorageKey({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
      });

      if (attCheck.storageKey && attCheck.storageKey !== expectedKey) {
        res.status(403).json({
          error: 'STORAGE_KEY_MISMATCH',
          messageArabic: 'مسار الملف المحفوظ لا يطابق مسار الحساب المصرح به.',
        });
        return;
      }

      const validatedMeta = validateAttachmentFileRequest({
        fileName: attCheck.fileName || 'attachment.pdf',
        contentType: attCheck.contentType || 'application/pdf',
        sizeBytes: 1024,
      });

      if (!validatedMeta.valid || !validatedMeta.normalizedContentType) {
        res.status(403).json({
          error: 'UNSUPPORTED_STORED_TYPE',
          messageArabic: 'نوع المرفق المسجل غير مسموح بعرضه.',
        });
        return;
      }

      const obj = await storage.downloadObject(expectedKey);
      const disp = body.disposition === 'attachment' ? 'attachment' : 'inline';
      const fileName = attCheck.fileName || validatedMeta.sanitizedFileName || 'attachment';
      const safeFallbackName = fileName.replace(/[^\w.\- ]+/g, '_') || 'attachment';

      res.setHeader('Content-Type', validatedMeta.normalizedContentType);
      res.setHeader(
        'Content-Disposition',
        `${disp}; filename="${safeFallbackName}"; filename*=UTF-8''${encodeRfc5987HeaderValue(fileName)}`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.status(200).send(Buffer.from(obj.bytes));
    } catch (err: any) {
      handleServerConfigOrAccessError(
        err,
        res,
        502,
        'RELAY_DOWNLOAD_FAILED',
        'تعذر جلب المرفق من التخزين السحابي عبر الخادم.'
      );
    }
  });

  return router;
}
