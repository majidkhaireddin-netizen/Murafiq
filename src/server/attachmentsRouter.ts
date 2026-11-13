import * as crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  buildAttachmentStorageKey,
  isValidResourceId,
  MAX_ATTACHMENT_SIZE_BYTES,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  PRESIGNED_UPLOAD_TTL_SECONDS,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';
import { createBackblazeB2StorageService, type B2StorageService } from './b2Storage.ts';
import {
  verifyAttachmentOwnershipInNamedDb,
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  type MeetingAttachmentRecordCheck,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';

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
  storageService?: B2StorageService;
  generateAttachmentId?: () => string;
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

export function createAttachmentsRouter(customDeps: AttachmentsRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner = customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const verifyAttachmentOwner =
    customDeps.verifyAttachmentOwnership ?? verifyAttachmentOwnershipInNamedDb;
  const storage = customDeps.storageService ?? createBackblazeB2StorageService();
  const generateId =
    customDeps.generateAttachmentId ??
    (() => `att_${crypto.randomUUID().replace(/-/g, '')}`);

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

  router.use(requireAuth);

  // 1. Issue short-lived S3 Presigned PUT URL for uploading a validated file
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
      const msg = String(err?.message || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({ error: 'FORBIDDEN', messageArabic: 'تم رفض الوصول إلى بيانات اللقاء.' });
        return;
      }
      res.status(500).json({
        error: 'PRESIGN_UPLOAD_FAILED',
        messageArabic: 'تعذر تجهيز رابط الرفع الآمن من الخادم. حاول مرة أخرى.',
      });
    }
  });

  // 2. Verify uploaded object in Backblaze B2 (existence, exact size, magic bytes) before Firestore commit
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
        meetingId: body.meetingId,
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

      const storageKey = buildAttachmentStorageKey({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
      });

      const verification = await storage.verifyUploadedObject({
        key: storageKey,
        expectedContentType: fileValidation.normalizedContentType,
        expectedSizeBytes: body.sizeBytes as number,
      });

      if (!verification.verified) {
        res.status(422).json({
          error: 'UPLOAD_VERIFICATION_FAILED',
          messageArabic:
            verification.reasonArabic ||
            'فشل التحقق من الملف المرفوع في Backblaze B2. يرجى إعادة المحاولة.',
        });
        return;
      }

      res.json({
        id: body.attachmentId,
        userId: uid,
        meetingId: body.meetingId,
        fileName: fileValidation.sanitizedFileName,
        contentType: fileValidation.normalizedContentType,
        sizeBytes: verification.sizeBytes,
        storageKey,
        storageProvider: 'backblaze_b2',
        uploadStatus: 'completed',
        etag: verification.etag,
        createdAt: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({
        error: 'COMPLETE_UPLOAD_FAILED',
        messageArabic: 'حدث خطأ أثناء التحقق من اكتمال رفع المرفق.',
      });
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
        (attCheck.contentType as any) ||
        validateAttachmentFileRequest({
          fileName: attCheck.fileName || 'file.pdf',
          contentType: attCheck.contentType || 'application/pdf',
          sizeBytes: 1024,
        }).normalizedContentType ||
        'application/octet-stream';

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
    } catch {
      res.status(500).json({
        error: 'PRESIGN_DOWNLOAD_FAILED',
        messageArabic: 'تعذر إنشاء رابط عرض أو تنزيل مؤقت للمرفق.',
      });
    }
  });

  // 4. Delete attachment object from Backblaze B2 (must succeed before Firestore metadata deletion)
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

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId: body.meetingId,
        idToken: req.authUser!.idToken,
      });
      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'مرفوض: لا تملك صلاحية حذف مرفقات هذا اللقاء.',
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
          messageArabic: 'المرفق غير موجود في سجلات هذا اللقاء.',
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

      try {
        await storage.deleteObject(expectedKey);
      } catch {
        res.status(502).json({
          error: 'B2_DELETE_FAILED',
          messageArabic:
            'فشل حذف الملف من خادم التخزين (Backblaze B2). لم يتم مسح سجل المرفق لتجنب ترك ملفات يتيمة.',
        });
        return;
      }

      res.json({
        deleted: true,
        attachmentId: body.attachmentId,
        storageKey: expectedKey,
        versioningNoteArabic:
          'تم إرسال أمر الحذف للإصدار الحالي في Backblaze B2 (قد تبقى إصدارات سابقة مخفية إذا كان Versioning مفعّلاً على الـ Bucket وفق سياسات دورة الحياة).',
      });
    } catch {
      res.status(500).json({
        error: 'DELETE_ATTACHMENT_FAILED',
        messageArabic: 'تعذر إتمام حذف المرفق من الخادم.',
      });
    }
  });

  // 5. Cleanup uncommitted B2 object if Firestore metadata save fails right after B2 upload
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

      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId: body.meetingId,
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

      const expectedKey = buildAttachmentStorageKey({
        uid,
        meetingId: body.meetingId,
        attachmentId: body.attachmentId,
      });

      await storage.deleteObject(expectedKey);
      res.json({ cleanedUp: true, attachmentId: body.attachmentId });
    } catch {
      res.status(502).json({
        error: 'CLEANUP_FAILED',
        messageArabic: 'تعذر تنظيف الملف المؤقت من Backblaze B2.',
      });
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
      res.status(502).json({
        error: 'RELAY_UPLOAD_FAILED',
        messageArabic: 'تعذر تمرير الملف إلى خادم التخزين السحابي. يرجى المحاولة مرة أخرى.',
      });
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
    } catch {
      res.status(502).json({
        error: 'RELAY_DOWNLOAD_FAILED',
        messageArabic: 'تعذر جلب المرفق من التخزين السحابي عبر الخادم.',
      });
    }
  });

  return router;
}
