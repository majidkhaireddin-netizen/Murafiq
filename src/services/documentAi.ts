import type {
  AllowedAttachmentMimeType,
  DocumentAiAnalysisMode,
  DocumentAiAnalysisResult,
} from '../types/index.ts';
import {
  sanitizeDocumentAnalysisRequest,
  validateAndNormalizeDocumentAiResult,
} from '../utils/documentIntelligence.ts';
import { getCurrentUserIdToken } from './firebase.ts';

export class DocumentAiClientError extends Error {
  code: string;
  statusCode?: number;

  constructor(code: string, messageArabic: string, statusCode?: number) {
    super(messageArabic);
    this.name = 'DocumentAiClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RequestDocumentAiDeps {
  isOnline: () => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
}

const defaultDocumentAiDeps: RequestDocumentAiDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
};

export interface RequestDocumentAnalysisParams {
  meetingId: string;
  attachmentId: string;
  fileName: string;
  contentType: AllowedAttachmentMimeType;
  sizeBytes: number;
  analysisMode: DocumentAiAnalysisMode;
  question?: string;
  signal?: AbortSignal;
}

export async function requestDocumentAnalysisWithDeps(
  params: RequestDocumentAnalysisParams,
  deps: RequestDocumentAiDeps
): Promise<DocumentAiAnalysisResult> {
  if (!deps.isOnline()) {
    throw new DocumentAiClientError(
      'OFFLINE_BLOCKED',
      'تحليل المرفقات بالذكاء الاصطناعي يتطلب اتصالاً نشطاً بالإنترنت. تبقى ملاحظاتك ومحررك متاحة محلياً دون اتصال.'
    );
  }

  const sanitized = sanitizeDocumentAnalysisRequest({
    meetingId: params.meetingId,
    attachmentId: params.attachmentId,
    analysisMode: params.analysisMode,
    ...(params.question !== undefined ? { question: params.question } : {}),
  });

  if (!sanitized.ok) {
    throw new DocumentAiClientError(
      sanitized.errorCode,
      sanitized.messageArabic,
      sanitized.statusCode
    );
  }

  const idToken = await deps.getIdToken();

  let res: Response;
  try {
    res = await deps.fetchApi('/api/ai/document-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      // Strictly send identifiers + mode + optional question ONLY — never bytes, URLs, or storageKeys
      body: JSON.stringify(sanitized.request),
      signal: params.signal,
    });
  } catch (err: any) {
    if (params.signal?.aborted || err?.name === 'AbortError') {
      throw new DocumentAiClientError('AI_ABORTED', 'تم إلغاء تحليل المرفق بناءً على طلبك.');
    }
    throw new DocumentAiClientError(
      'NETWORK_ERROR',
      'تعذر الاتصال بخادم التطبيق لتحليل المستند. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
    );
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const code = typeof body?.error === 'string' ? body.error : `HTTP_${res.status}`;
    const fallbackByStatus =
      res.status === 401
        ? 'انتهت جلسة المصادقة. أعد تسجيل الدخول بحساب Google ثم حاول مرة أخرى.'
        : res.status === 403
        ? 'غير مصرح لك بتحليل هذا المرفق.'
        : res.status === 404
        ? 'لم يتم العثور على المرفق في سجل هذا اللقاء أو التخزين السحابي.'
        : res.status === 409
        ? 'المرفق لم يكتمل رفعه بعد أو يوجد طلب تحليل قيد التنفيذ حالياً.'
        : res.status === 410
        ? 'هذا المرفق محذوف أو قيد الحذف ولا يمكن تحليله.'
        : res.status === 413
        ? 'يتجاوز حجم المرفق الحد الأقصى المسموح به للتحليل الذكي (10 ميجابايت).'
        : res.status === 415
        ? 'صيغة هذا الملف غير مدعومة للتحليل الذكي.'
        : res.status === 422
        ? 'تعذر التحقق من سلامة محتوى الملف لتحليله.'
        : res.status === 429
        ? 'تم تجاوز الحد المؤقت لطلبات تحليل المستندات. انتظر قليلاً ثم أعد المحاولة.'
        : res.status === 503
        ? 'خدمة تحليل المستندات أو التخزين السحابي غير مهيأة على الخادم حالياً.'
        : res.status === 504
        ? 'استغرق تحليل المستند وقتاً أطول من المعتاد. يرجى المحاولة مجدداً.'
        : 'تعذر إتمام تحليل المرفق عبر الخادم. يمكنك إعادة المحاولة لاحقاً.';

    const messageArabic =
      typeof body?.messageArabic === 'string' && body.messageArabic.trim()
        ? body.messageArabic
        : fallbackByStatus;

    throw new DocumentAiClientError(code, messageArabic, res.status);
  }

  try {
    return validateAndNormalizeDocumentAiResult(body, {
      model: typeof body?.model === 'string' ? body.model : 'gemini-4-hydrogen',
      meetingId: params.meetingId,
      attachmentId: params.attachmentId,
      fileName: typeof body?.fileName === 'string' && body.fileName ? body.fileName : params.fileName,
      contentType: params.contentType,
      sizeBytes: typeof body?.sizeBytes === 'number' ? body.sizeBytes : params.sizeBytes,
      analysisMode: params.analysisMode,
      question: params.question,
      analysisId: typeof body?.analysisId === 'string' ? body.analysisId : undefined,
      generatedAt: typeof body?.generatedAt === 'string' ? body.generatedAt : undefined,
    });
  } catch {
    throw new DocumentAiClientError(
      'INVALID_AI_RESPONSE',
      'وصلت استجابة غير متوافقة من خدمة تحليل المستندات. لم يتم تعديل بياناتك، ويمكنك إعادة المحاولة.',
      502
    );
  }
}

export async function requestDocumentAnalysis(
  params: RequestDocumentAnalysisParams
): Promise<DocumentAiAnalysisResult> {
  return requestDocumentAnalysisWithDeps(params, defaultDocumentAiDeps);
}
