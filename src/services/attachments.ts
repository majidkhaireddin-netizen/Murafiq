import type { AllowedAttachmentMimeType, MeetingAttachment } from '../types/index.ts';
import {
  isPresignedUrlExpired,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';
import {
  deleteMeetingAttachmentMetadata,
  getCurrentUserIdToken,
  saveMeetingAttachmentMetadata,
} from './firebase.ts';

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
  saveMetadata: (attachment: MeetingAttachment) => Promise<void>;
}

export interface AttachmentDeleteDeps {
  isOnline: () => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
  deleteMetadata: (meetingId: string, attachmentId: string) => Promise<void>;
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

interface CachedDownloadEntry {
  url: string;
  expiresAt: string;
}

const downloadUrlMemoryCache = new Map<string, CachedDownloadEntry>();

export function clearAttachmentDownloadCache(): void {
  downloadUrlMemoryCache.clear();
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
  saveMetadata: saveMeetingAttachmentMetadata,
};

const defaultDeleteDeps: AttachmentDeleteDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
  deleteMetadata: deleteMeetingAttachmentMetadata,
};

export type UploadStage =
  | 'validating'
  | 'requesting_url'
  | 'uploading'
  | 'verifying'
  | 'saving_metadata';

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

  await deps.putFileToPresignedUrl({
    uploadUrl: presign.uploadUrl,
    file,
    contentType: presign.requiredHeaders['Content-Type'],
    onProgress,
    signal,
  });

  onProgress?.(100);
  onStageChange?.('verifying');

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

  const completedAttachment = await parseJsonApiResponse<MeetingAttachment>(completeRes);

  onStageChange?.('saving_metadata');

  try {
    await deps.saveMetadata(completedAttachment);
    return completedAttachment;
  } catch (firestoreErr: any) {
    // Cleanup orphaned B2 object if Firestore metadata save fails
    try {
      await deps.fetchApi('/api/attachments/cleanup-uncommitted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          meetingId,
          attachmentId: completedAttachment.id,
        }),
      });
    } catch {
      // Best-effort cleanup; surface honest error below
    }

    throw new AttachmentClientError(
      'FIRESTORE_METADATA_SAVE_FAILED',
      'تم رفع الملف للسحابة لكن تعذر حفظ بياناته في قاعدة البيانات. تم تنظيف الملف غير المثبت؛ يرجى المحاولة مرة أخرى.',
      500
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

export async function getFreshPresignedDownloadUrl(params: {
  meetingId: string;
  attachmentId: string;
  disposition: 'inline' | 'attachment';
  forceRefresh?: boolean;
}): Promise<PresignDownloadResponse> {
  const { meetingId, attachmentId, disposition, forceRefresh = false } = params;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AttachmentClientError(
      'OFFLINE_BLOCKED',
      'عرض أو تنزيل المرفقات يتطلب اتصالاً نشطاً بالإنترنت.'
    );
  }

  const cacheKey = `${meetingId}:${attachmentId}:${disposition}`;
  if (!forceRefresh) {
    const cached = downloadUrlMemoryCache.get(cacheKey);
    if (cached && !isPresignedUrlExpired(cached.expiresAt, Date.now(), 10_000)) {
      return {
        attachmentId,
        downloadUrl: cached.url,
        expiresAt: cached.expiresAt,
        disposition,
      };
    }
  }

  const idToken = await getCurrentUserIdToken();
  const res = await fetch('/api/attachments/presign-download', {
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
  downloadUrlMemoryCache.set(cacheKey, {
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

  // ONLY delete Firestore metadata AFTER Backblaze B2 object deletion succeeds
  await deps.deleteMetadata(meetingId, attachmentId);

  downloadUrlMemoryCache.delete(`${meetingId}:${attachmentId}:inline`);
  downloadUrlMemoryCache.delete(`${meetingId}:${attachmentId}:attachment`);
}

export async function deleteMeetingAttachment(params: {
  meetingId: string;
  attachmentId: string;
}): Promise<void> {
  return deleteMeetingAttachmentWithDeps(params, defaultDeleteDeps);
}
