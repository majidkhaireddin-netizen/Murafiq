import type { MeetingAttachment } from '../types/index.ts';
import {
  isPresignedUrlExpired,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';
import {
  clearAttachmentDownloadCache,
  getCachedPresignedDownloadUrl,
  invalidateAttachmentDownloadCacheEntry,
  setCachedPresignedDownloadUrl,
} from '../utils/attachmentDownloadCache.ts';
import { getAuthenticatedUid, getCurrentUserIdToken } from './firebase.ts';

export { clearAttachmentDownloadCache };

export interface PresignUploadResponse {
  attachmentId: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: {
    'Content-Type': string;
  };
}

export interface PresignDownloadResponse {
  attachmentId: string;
  downloadUrl: string;
  expiresAt: string;
  disposition: 'inline' | 'attachment';
}

export interface AttachmentUploadDeps {
  isOnline: () => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
  readHeaderBytes: (file: File) => Promise<Uint8Array>;
  putFileToPresignedUrl: (params: {
    uploadUrl: string;
    file: File;
    contentType: string;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }) => Promise<{ etag?: string }>;
  putFileViaRelay?: (params: {
    meetingId: string;
    attachmentId: string;
    fileName: string;
    file: File;
    contentType: string;
    idToken: string;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }) => Promise<{ etag?: string }>;
}

export interface AttachmentDownloadDeps {
  isOnline: () => boolean;
  getUid: () => string;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
  nowMs?: () => number;
}

export interface AttachmentDeleteDeps {
  isOnline: () => boolean;
  getUid?: () => string;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
}

export class AttachmentClientError extends Error {
  code: string;
  statusCode?: number;

  constructor(code: string, messageArabic: string, statusCode?: number) {
    super(messageArabic);
    this.name = 'AttachmentClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function readBrowserFileHeaderBytes(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, 16);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

function uploadFileViaXhr(params: {
  uploadUrl: string;
  file: File;
  contentType: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<{ etag?: string }> {
  const { uploadUrl, file, contentType, onProgress, signal } = params;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.timeout = 120_000;

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort errors
      }
      reject(new AttachmentClientError('UPLOAD_ABORTED', 'تم إلغاء رفع المرفق.'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const rawEtag = xhr.getResponseHeader('ETag') || undefined;
        resolve({ etag: rawEtag ? rawEtag.replace(/"/g, '') : undefined });
        return;
      }

      if (xhr.status === 403) {
        reject(
          new AttachmentClientError(
            'PRESIGNED_URL_EXPIRED_OR_FORBIDDEN',
            'انتهت صلاحية رابط الرفع المؤقت أو تم رفضه من خادم التخزين. يرجى إعادة المحاولة.',
            403
          )
        );
        return;
      }

      reject(
        new AttachmentClientError(
          'B2_UPLOAD_FAILED',
          `فشل رفع الملف إلى التخزين السحابي (رمز الاستجابة: ${xhr.status}).`,
          xhr.status
        )
      );
    };

    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new AttachmentClientError(
          'NETWORK_ERROR',
          'انقطع الاتصال بالشبكة أثناء رفع الملف. تحقق من الإنترنت أو إعدادات CORS في Backblaze B2 ثم أعد المحاولة.'
        )
      );
    };

    xhr.ontimeout = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new AttachmentClientError(
          'UPLOAD_TIMEOUT',
          'انتهت مهلة رفع الملف. يرجى التحقق من سرعة الإنترنت والمحاولة مرة أخرى.'
        )
      );
    };

    xhr.send(file);
  });
}

function uploadFileViaRelayXhr(params: {
  meetingId: string;
  attachmentId: string;
  fileName: string;
  file: File;
  contentType: string;
  idToken: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<{ etag?: string }> {
  const { meetingId, attachmentId, fileName, file, contentType, idToken, onProgress, signal } = params;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/attachments/relay-upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-meeting-id', meetingId);
    xhr.setRequestHeader('x-attachment-id', attachmentId);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(fileName));
    xhr.timeout = 120_000;

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort errors
      }
      reject(new AttachmentClientError('UPLOAD_ABORTED', 'تم إلغاء رفع المرفق.'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      let payload: any = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: payload?.etag });
        return;
      }
      reject(
        new AttachmentClientError(
          payload?.error || 'RELAY_UPLOAD_FAILED',
          payload?.messageArabic || `فشل رفع الملف عبر الخادم (${xhr.status}).`,
          xhr.status
        )
      );
    };

    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new AttachmentClientError(
          'NETWORK_ERROR',
          'تعذر الاتصال بخادم التطبيق لرفع المرفق. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.'
        )
      );
    };

    xhr.ontimeout = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new AttachmentClientError(
          'UPLOAD_TIMEOUT',
          'انتهت مهلة رفع الملف. يرجى التحقق من سرعة الإنترنت والمحاولة مرة أخرى.'
        )
      );
    };

    xhr.send(file);
  });
}

async function parseJsonApiResponse<T>(res: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const code = payload?.error || payload?.code || `HTTP_${res.status}`;
    const msg =
      payload?.messageArabic ||
      (res.status === 401
        ? 'انتهت جلسة تسجيل الدخول. يرجى إعادة تسجيل الدخول والمحاولة مرة أخرى.'
        : res.status === 403
        ? 'غير مصرح لك بتنفيذ هذه العملية على هذا اللقاء.'
        : `تعذر إتمام الطلب على الخادم (${res.status}).`);
    throw new AttachmentClientError(code, msg, res.status);
  }

  return payload as T;
}

const defaultUploadDeps: AttachmentUploadDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
  readHeaderBytes: readBrowserFileHeaderBytes,
  putFileToPresignedUrl: uploadFileViaXhr,
  putFileViaRelay: uploadFileViaRelayXhr,
};

const defaultDownloadDeps: AttachmentDownloadDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getUid: () => getAuthenticatedUid(),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
};

const defaultDeleteDeps: AttachmentDeleteDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getUid: () => getAuthenticatedUid(),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
};

export type UploadStage =
  | 'validating'
  | 'requesting_url'
  | 'uploading'
  | 'verifying'
  | 'saving_metadata';

async function cleanupUncommittedBestEffort(params: {
  fetchApi: typeof fetch;
  idToken: string;
  meetingId: string;
  attachmentId: string;
}) {
  try {
    await params.fetchApi('/api/attachments/cleanup-uncommitted', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.idToken}`,
      },
      body: JSON.stringify({
        meetingId: params.meetingId,
        attachmentId: params.attachmentId,
      }),
    });
  } catch {
    // Best-effort cleanup only; server guards prevent deleting any committed object
  }
}

export async function uploadMeetingAttachmentWithDeps(
  params: {
    meetingId: string;
    file: File;
    onProgress?: (percent: number) => void;
    onStageChange?: (stage: UploadStage) => void;
    signal?: AbortSignal;
  },
  deps: AttachmentUploadDeps
): Promise<MeetingAttachment> {
  const { meetingId, file, onProgress, onStageChange, signal } = params;

  if (!deps.isOnline()) {
    throw new AttachmentClientError(
      'OFFLINE_BLOCKED',
      'رفع المرفقات يتطلب اتصالاً نشطاً بالإنترنت. لا يتم تخزين المرفقات الحساسة محلياً دون اتصال.'
    );
  }

  onStageChange?.('validating');

  const validation = validateAttachmentFileRequest({
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });

  if (!validation.valid || !validation.normalizedContentType || !validation.sanitizedFileName) {
    throw new AttachmentClientError(
      validation.errorCode || 'INVALID_FILE',
      validation.errorArabic || 'الملف غير صالح للرفع.',
      400
    );
  }

  const headerBytes = await deps.readHeaderBytes(file);
  if (!verifyMagicBytes(headerBytes, validation.normalizedContentType)) {
    throw new AttachmentClientError(
      'MAGIC_BYTES_MISMATCH',
      'المحتوى الفعلي للملف لا يطابق صيغته المعلنة (JPEG/PNG/WebP/PDF). تم حظر الرفع لأسباب أمنية.',
      400
    );
  }

  onStageChange?.('requesting_url');
  const idToken = await deps.getIdToken();

  const presignRes = await deps.fetchApi('/api/attachments/presign-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      meetingId,
      fileName: validation.sanitizedFileName,
      contentType: validation.normalizedContentType,
      sizeBytes: file.size,
    }),
    signal,
  });

  const presign = await parseJsonApiResponse<PresignUploadResponse>(presignRes);

  if (isPresignedUrlExpired(presign.expiresAt, Date.now(), 2000)) {
    throw new AttachmentClientError(
      'PRESIGNED_URL_EXPIRED',
      'انتهت صلاحية رابط الرفع قبل بدء الإرسال. يرجى المحاولة مجدداً.'
    );
  }

  onStageChange?.('uploading');
  onProgress?.(0);

  try {
    await deps.putFileToPresignedUrl({
      uploadUrl: presign.uploadUrl,
      file,
      contentType: presign.requiredHeaders['Content-Type'],
      onProgress,
      signal,
    });
  } catch (uploadErr: any) {
    const isCorsOrDirectNetworkFailure =
      uploadErr instanceof AttachmentClientError &&
      uploadErr.code === 'NETWORK_ERROR' &&
      deps.isOnline() &&
      typeof deps.putFileViaRelay === 'function';

    if (!isCorsOrDirectNetworkFailure) {
      // Upload was aborted or failed before server completion -> safe to clean up uncommitted intent
      if (deps.isOnline()) {
        await cleanupUncommittedBestEffort({
          fetchApi: deps.fetchApi,
          idToken,
          meetingId,
          attachmentId: presign.attachmentId,
        });
      }
      throw uploadErr;
    }

    try {
      // Seamless same-origin authenticated upload relay fallback when B2 CORS blocks direct browser PUT
      onProgress?.(0);
      await deps.putFileViaRelay!({
        meetingId,
        attachmentId: presign.attachmentId,
        fileName: validation.sanitizedFileName,
        file,
        contentType: validation.normalizedContentType,
        idToken,
        onProgress,
        signal,
      });
    } catch (relayErr) {
      if (deps.isOnline()) {
        await cleanupUncommittedBestEffort({
          fetchApi: deps.fetchApi,
          idToken,
          meetingId,
          attachmentId: presign.attachmentId,
        });
      }
      throw relayErr;
    }
  }

  onProgress?.(100);
  onStageChange?.('verifying');

  // Server-authoritative verification + Firestore metadata commit (with 1 safe idempotent retry on lost response)
  const callCompleteUpload = async (): Promise<MeetingAttachment> => {
    const completeRes = await deps.fetchApi('/api/attachments/complete-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        meetingId,
        attachmentId: presign.attachmentId,
        fileName: validation.sanitizedFileName,
        contentType: validation.normalizedContentType,
        sizeBytes: file.size,
      }),
    });
    return parseJsonApiResponse<MeetingAttachment>(completeRes);
  };

  onStageChange?.('saving_metadata');

  try {
    return await callCompleteUpload();
  } catch (err: any) {
    const isTransientLostResponse =
      !(err instanceof AttachmentClientError) ||
      err.statusCode === 502 ||
      err.statusCode === 504;

    // IMPORTANT (Req C.8): NEVER invoke cleanup-uncommitted when commit response may have succeeded on the server!
    if (isTransientLostResponse && deps.isOnline()) {
      try {
        return await callCompleteUpload();
      } catch (retryErr: any) {
        if (retryErr instanceof AttachmentClientError) {
          throw retryErr;
        }
        throw new AttachmentClientError(
          'COMPLETE_UPLOAD_UNCERTAIN',
          'انقطع الاتصال أثناء تأكيد حفظ المرفق على الخادم. إذا لم يظهر المرفق في القائمة بعد ثوانٍ، يرجى إعادة المحاولة بأمان دون حذف الملف.',
          502
        );
      }
    }

    if (err instanceof AttachmentClientError) {
      throw err;
    }

    throw new AttachmentClientError(
      'COMPLETE_UPLOAD_UNCERTAIN',
      'تعذر تأكيد استلام استجابة الخادم لحفظ المرفق. يرجى التحقق من قائمة المرفقات أو إعادة المحاولة.',
      502
    );
  }
}

export async function uploadMeetingAttachment(params: {
  meetingId: string;
  file: File;
  onProgress?: (percent: number) => void;
  onStageChange?: (stage: UploadStage) => void;
  signal?: AbortSignal;
}): Promise<MeetingAttachment> {
  return uploadMeetingAttachmentWithDeps(params, defaultUploadDeps);
}

export async function getFreshPresignedDownloadUrlWithDeps(
  params: {
    meetingId: string;
    attachmentId: string;
    disposition: 'inline' | 'attachment';
    forceRefresh?: boolean;
  },
  deps: AttachmentDownloadDeps
): Promise<PresignDownloadResponse> {
  const { meetingId, attachmentId, disposition, forceRefresh = false } = params;

  if (!deps.isOnline()) {
    throw new AttachmentClientError(
      'OFFLINE_BLOCKED',
      'عرض أو تنزيل المرفقات يتطلب اتصالاً نشطاً بالإنترنت.'
    );
  }

  let uid = '';
  try {
    uid = deps.getUid();
  } catch {
    clearAttachmentDownloadCache();
    throw new AttachmentClientError(
      'UNAUTHENTICATED',
      'يجب تسجيل الدخول بحساب Google الموثّق للوصول إلى المرفقات.',
      401
    );
  }

  const now = deps.nowMs ? deps.nowMs() : Date.now();
  if (!forceRefresh) {
    const cached = getCachedPresignedDownloadUrl({
      uid,
      meetingId,
      attachmentId,
      disposition,
      nowMs: now,
    });
    if (cached) {
      return {
        attachmentId,
        downloadUrl: cached.downloadUrl,
        expiresAt: cached.expiresAt,
        disposition,
      };
    }
  }

  const idToken = await deps.getIdToken();
  const res = await deps.fetchApi('/api/attachments/presign-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      meetingId,
      attachmentId,
      disposition,
    }),
  });

  const data = await parseJsonApiResponse<{
    downloadUrl: string;
    expiresAt: string;
    expiresInSeconds?: number;
  }>(res);

  setCachedPresignedDownloadUrl({
    uid,
    meetingId,
    attachmentId,
    disposition,
    url: data.downloadUrl,
    expiresAt: data.expiresAt,
  });

  return {
    attachmentId,
    downloadUrl: data.downloadUrl,
    expiresAt: data.expiresAt,
    disposition,
  };
}

export async function getFreshPresignedDownloadUrl(params: {
  meetingId: string;
  attachmentId: string;
  disposition: 'inline' | 'attachment';
  forceRefresh?: boolean;
}): Promise<PresignDownloadResponse> {
  return getFreshPresignedDownloadUrlWithDeps(params, defaultDownloadDeps);
}

export async function fetchAttachmentBlobViaRelay(params: {
  meetingId: string;
  attachmentId: string;
  disposition: 'inline' | 'attachment';
}): Promise<{ blobUrl: string; revoke: () => void }> {
  const { meetingId, attachmentId, disposition } = params;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AttachmentClientError(
      'OFFLINE_BLOCKED',
      'عرض أو تنزيل المرفقات يتطلب اتصالاً نشطاً بالإنترنت.'
    );
  }

  const idToken = await getCurrentUserIdToken();
  const res = await fetch('/api/attachments/relay-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      meetingId,
      attachmentId,
      disposition,
    }),
  });

  if (!res.ok) {
    return parseJsonApiResponse<never>(res);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  return {
    blobUrl,
    revoke: () => URL.revokeObjectURL(blobUrl),
  };
}

export async function deleteMeetingAttachmentWithDeps(
  params: { meetingId: string; attachmentId: string },
  deps: AttachmentDeleteDeps
): Promise<void> {
  const { meetingId, attachmentId } = params;

  if (!deps.isOnline()) {
    throw new AttachmentClientError(
      'OFFLINE_BLOCKED',
      'حذف المرفقات يتطلب اتصالاً نشطاً بالإنترنت لضمان إزالتها من التخزين السحابي أولاً.'
    );
  }

  const idToken = await deps.getIdToken();
  const res = await deps.fetchApi('/api/attachments/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      meetingId,
      attachmentId,
    }),
  });

  await parseJsonApiResponse<{ deleted: boolean }>(res);

  let uid: string | null = null;
  try {
    uid = deps.getUid ? deps.getUid() : null;
  } catch {
    uid = null;
  }
  invalidateAttachmentDownloadCacheEntry({ uid, meetingId, attachmentId });
}

export async function deleteMeetingAttachment(params: {
  meetingId: string;
  attachmentId: string;
}): Promise<void> {
  return deleteMeetingAttachmentWithDeps(params, defaultDeleteDeps);
}
