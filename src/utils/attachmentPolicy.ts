import type { AllowedAttachmentMimeType } from '../types/index.ts';

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const PRESIGNED_UPLOAD_TTL_SECONDS = 120;
export const PRESIGNED_DOWNLOAD_TTL_SECONDS = 180;

export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly AllowedAttachmentMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ALLOWED_EXTENSIONS_BY_MIME: Record<AllowedAttachmentMimeType, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

export const BLOCKED_DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.pif',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.php',
  '.py',
  '.rb',
  '.pl',
  '.jar',
  '.apk',
  '.app',
  '.dmg',
  '.dll',
  '.so',
  '.dylib',
]);

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidResourceId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

export function extractFileExtension(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(lastDot);
}

export function sanitizeAttachmentFileName(fileName: string): string {
  // Strip directory components and control chars while keeping Arabic/Latin filename readability
  const baseName = fileName.replace(/[/\\]/g, '_').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!baseName) return 'attachment';
  return baseName.slice(0, 200);
}

export interface AttachmentValidationResult {
  valid: boolean;
  normalizedContentType?: AllowedAttachmentMimeType;
  sanitizedFileName?: string;
  errorCode?:
    | 'INVALID_FILENAME'
    | 'BLOCKED_EXECUTABLE_OR_SCRIPT'
    | 'UNSUPPORTED_TYPE'
    | 'EXTENSION_MISMATCH'
    | 'INVALID_SIZE'
    | 'FILE_TOO_LARGE';
  errorArabic?: string;
}

export function validateAttachmentFileRequest(params: {
  fileName: unknown;
  contentType: unknown;
  sizeBytes: unknown;
}): AttachmentValidationResult {
  const { fileName, contentType, sizeBytes } = params;

  if (typeof fileName !== 'string' || fileName.trim().length === 0 || fileName.length > 255) {
    return {
      valid: false,
      errorCode: 'INVALID_FILENAME',
      errorArabic: 'اسم الملف غير صالح أو يتجاوز الحد المسموح (255 حرفاً).',
    };
  }

  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return {
      valid: false,
      errorCode: 'INVALID_FILENAME',
      errorArabic: 'اسم الملف يحتوي على رموز مسار غير مسموح بها.',
    };
  }

  const ext = extractFileExtension(fileName);
  if (ext && BLOCKED_DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      errorCode: 'BLOCKED_EXECUTABLE_OR_SCRIPT',
      errorArabic:
        'يُمنع رفع الملفات التنفيذية أو ملفات HTML/JavaScript/SVG لأسباب أمنية. يُسمح فقط بـ JPEG وPNG وWebP وPDF.',
    };
  }

  const normalizedMime =
    typeof contentType === 'string' ? contentType.trim().toLowerCase().split(';')[0] : '';

  if (
    !ALLOWED_ATTACHMENT_MIME_TYPES.includes(normalizedMime as AllowedAttachmentMimeType)
  ) {
    return {
      valid: false,
      errorCode: 'UNSUPPORTED_TYPE',
      errorArabic:
        'نوع الملف غير مدعوم. الأنواع المسموح بها في الإصدار الأول هي: JPEG وPNG وWebP وPDF فقط.',
    };
  }

  const typedMime = normalizedMime as AllowedAttachmentMimeType;
  const allowedExts = ALLOWED_EXTENSIONS_BY_MIME[typedMime];
  if (!ext || !allowedExts.includes(ext)) {
    return {
      valid: false,
      errorCode: 'EXTENSION_MISMATCH',
      errorArabic:
        'امتداد الملف لا يطابق نوعه المعلن. يرجى اختيار ملف صحيح بصيغة JPG أو PNG أو WebP أو PDF.',
    };
  }

  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return {
      valid: false,
      errorCode: 'INVALID_SIZE',
      errorArabic: 'حجم الملف غير صالح أو أن الملف فارغ.',
    };
  }

  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      errorCode: 'FILE_TOO_LARGE',
      errorArabic: 'يتجاوز حجم الملف الحد الأقصى المسموح به وهو 10 ميجابايت (10 MB).',
    };
  }

  return {
    valid: true,
    normalizedContentType: typedMime,
    sanitizedFileName: sanitizeAttachmentFileName(fileName),
  };
}

/**
 * Verifies real binary magic bytes for supported formats (JPEG, PNG, WebP, PDF)
 * so disguised executables or HTML/JS files cannot pass validation.
 */
export function verifyMagicBytes(
  headerBytes: Uint8Array,
  expectedMimeType: AllowedAttachmentMimeType
): boolean {
  if (!(headerBytes instanceof Uint8Array) || headerBytes.length < 4) {
    return false;
  }

  if (expectedMimeType === 'image/jpeg') {
    return headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff;
  }

  if (expectedMimeType === 'image/png') {
    if (headerBytes.length < 8) return false;
    return (
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47 &&
      headerBytes[4] === 0x0d &&
      headerBytes[5] === 0x0a &&
      headerBytes[6] === 0x1a &&
      headerBytes[7] === 0x0a
    );
  }

  if (expectedMimeType === 'image/webp') {
    if (headerBytes.length < 12) return false;
    // "RIFF" .... "WEBP"
    return (
      headerBytes[0] === 0x52 &&
      headerBytes[1] === 0x49 &&
      headerBytes[2] === 0x46 &&
      headerBytes[3] === 0x46 &&
      headerBytes[8] === 0x57 &&
      headerBytes[9] === 0x45 &&
      headerBytes[10] === 0x42 &&
      headerBytes[11] === 0x50
    );
  }

  if (expectedMimeType === 'application/pdf') {
    if (headerBytes.length < 5) return false;
    // "%PDF-"
    return (
      headerBytes[0] === 0x25 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x44 &&
      headerBytes[3] === 0x46 &&
      headerBytes[4] === 0x2d
    );
  }

  return false;
}

/**
 * Strictly constructs the isolated Backblaze B2 object key.
 * Server ALWAYS builds this from verified token uid + validated meetingId + server-generated attachmentId.
 */
export function buildAttachmentStorageKey(params: {
  uid: string;
  meetingId: string;
  attachmentId: string;
}): string {
  const { uid, meetingId, attachmentId } = params;
  if (!isValidResourceId(uid) || !isValidResourceId(meetingId) || !isValidResourceId(attachmentId)) {
    throw new Error('Invalid resource identifier for attachment storage key.');
  }
  return `users/${uid}/meetings/${meetingId}/attachments/${attachmentId}`;
}

export function parseAttachmentStorageKey(storageKey: string): {
  uid: string;
  meetingId: string;
  attachmentId: string;
} | null {
  if (typeof storageKey !== 'string') return null;
  const match = storageKey.match(
    /^users\/([a-zA-Z0-9_-]{1,128})\/meetings\/([a-zA-Z0-9_-]{1,128})\/attachments\/([a-zA-Z0-9_-]{1,128})$/
  );
  if (!match) return null;
  return {
    uid: match[1],
    meetingId: match[2],
    attachmentId: match[3],
  };
}

export function isImageMimeType(contentType: string): boolean {
  return contentType === 'image/jpeg' || contentType === 'image/png' || contentType === 'image/webp';
}

export function isPresignedUrlExpired(expiresAtIso: string, nowMs: number = Date.now(), skewMs: number = 5000): boolean {
  const expMs = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expMs)) return true;
  return nowMs + skewMs >= expMs;
}

export function formatFileSizeArabic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 بايت';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}
