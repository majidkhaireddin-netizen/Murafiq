import type {
  ActionItem,
  AiSectionInclusionSelection,
  Meeting,
  MeetingAiAnalysisResult,
} from '../types/index.ts';
import {
  buildMeetingAiInputBundle,
  validateAndNormalizeMeetingAiAnalysis,
} from '../utils/meetingAiAssistant.ts';
import { getCurrentUserIdToken } from './firebase.ts';

export class MeetingAiClientError extends Error {
  code: string;
  statusCode?: number;

  constructor(code: string, messageArabic: string, statusCode?: number) {
    super(messageArabic);
    this.name = 'MeetingAiClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RequestMeetingAiDeps {
  isOnline: () => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
}

const defaultRequestDeps: RequestMeetingAiDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
};

export async function requestMeetingAiSuggestionsWithDeps(
  params: {
    meeting: Meeting;
    tasks: ActionItem[];
    clientName?: string;
    includedSections: AiSectionInclusionSelection;
    signal?: AbortSignal;
  },
  deps: RequestMeetingAiDeps
): Promise<MeetingAiAnalysisResult> {
  if (!deps.isOnline()) {
    throw new MeetingAiClientError(
      'OFFLINE_BLOCKED',
      'تحليل الاجتماع بالذكاء الاصطناعي يتطلب اتصالاً نشطاً بالإنترنت. تبقى بيانات اجتماعك ومحررك متاحة محلياً دون اتصال.'
    );
  }

  const bundle = buildMeetingAiInputBundle({
    meeting: params.meeting,
    tasks: params.tasks,
    clientName: params.clientName,
    includedSections: params.includedSections,
  });

  if (!bundle.hasSubstantiveContent) {
    throw new MeetingAiClientError(
      'AI_INPUT_EMPTY',
      'النص المحدد قصير جداً ولا يكفي للتحليل. أضف ملاحظات أو جدول أعمال أو فعّل مزيداً من الأقسام.',
      400
    );
  }

  if (bundle.exceedsLimit) {
    throw new MeetingAiClientError(
      'AI_INPUT_TOO_LARGE',
      'يتجاوز حجم النص المحدد الحد المسموح للتحليل. استبعد بعض الأقسام من المعاينة ثم أعد المحاولة.',
      413
    );
  }

  const idToken = await deps.getIdToken();

  let res: Response;
  try {
    res = await deps.fetchApi('/api/ai/meeting-suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(bundle.payload),
      signal: params.signal,
    });
  } catch (err: any) {
    if (params.signal?.aborted || err?.name === 'AbortError') {
      throw new MeetingAiClientError('AI_ABORTED', 'تم إلغاء تحليل الاجتماع.');
    }
    throw new MeetingAiClientError(
      'NETWORK_ERROR',
      'تعذر الاتصال بخادم التطبيق لتحليل الاجتماع. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
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
    const messageArabic =
      typeof body?.messageArabic === 'string' && body.messageArabic.trim()
        ? body.messageArabic
        : res.status === 401
        ? 'انتهت جلسة المصادقة. أعد تسجيل الدخول بحساب Google ثم حاول مرة أخرى.'
        : res.status === 403
        ? 'غير مصرح لك بتحليل هذا اللقاء.'
        : res.status === 429
        ? 'تم تجاوز الحد المؤقت لطلبات التحليل. انتظر قليلاً ثم أعد المحاولة.'
        : res.status === 503
        ? 'خدمة الذكاء الاصطناعي غير مفعّلة على الخادم حالياً.'
        : 'تعذر إتمام تحليل الاجتماع عبر الخادم. يمكنك إعادة المحاولة لاحقاً.';
    throw new MeetingAiClientError(code, messageArabic, res.status);
  }

  const validAgendaIds = new Set((params.meeting.agendaItems || []).map((a) => a.id));
  try {
    return validateAndNormalizeMeetingAiAnalysis(body, {
      model: typeof body?.model === 'string' ? body.model : 'gemini-4-hydrogen',
      validAgendaItemIds: validAgendaIds,
      analysisId: typeof body?.analysisId === 'string' ? body.analysisId : undefined,
      generatedAt: typeof body?.generatedAt === 'string' ? body.generatedAt : undefined,
    });
  } catch {
    throw new MeetingAiClientError(
      'INVALID_AI_RESPONSE',
      'وصلت استجابة غير متوافقة من خدمة التحليل الذكي. لم يتم تعديل بياناتك، ويمكنك إعادة المحاولة.',
      502
    );
  }
}

export async function requestMeetingAiSuggestions(params: {
  meeting: Meeting;
  tasks: ActionItem[];
  clientName?: string;
  includedSections: AiSectionInclusionSelection;
  signal?: AbortSignal;
}): Promise<MeetingAiAnalysisResult> {
  return requestMeetingAiSuggestionsWithDeps(params, defaultRequestDeps);
}
