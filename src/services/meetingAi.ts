import type {
  ActionItem,
  AiBriefingSectionSelection,
  AiSectionInclusionSelection,
  Meeting,
  MeetingAiAnalysisResult,
  MeetingAiBriefingResult,
  MeetingPreparationBrief,
} from '../types/index.ts';
import {
  buildMeetingAiInputBundle,
  validateAndNormalizeMeetingAiAnalysis,
} from '../utils/meetingAiAssistant.ts';
import {
  buildMeetingAiBriefingInputBundle,
  validateAndNormalizeMeetingBriefingAi,
} from '../utils/meetingPreparation.ts';
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

export async function requestMeetingAiBriefingWithDeps(
  params: {
    brief: MeetingPreparationBrief;
    includedSections: AiBriefingSectionSelection;
    signal?: AbortSignal;
  },
  deps: RequestMeetingAiDeps
): Promise<MeetingAiBriefingResult> {
  if (!deps.isOnline()) {
    throw new MeetingAiClientError(
      'OFFLINE_BLOCKED',
      'التحضير المتقدم بالذكاء الاصطناعي يتطلب اتصالاً نشطاً بالإنترنت. يبقى التحضير الذكي المباشر متاحاً بالكامل دون اتصال.'
    );
  }

  if (params.brief.isMeetingCancelled) {
    throw new MeetingAiClientError(
      'CANCELLED_MEETING_BLOCKED',
      'هذا الاجتماع في حالة «ملغاة» (للقراءة فقط) ولا يمكن تشغيل التحضير المتقدم له.',
      400
    );
  }

  const bundle = buildMeetingAiBriefingInputBundle(params.brief, params.includedSections);
  if (bundle.charCount < 15) {
    throw new MeetingAiClientError(
      'AI_INPUT_EMPTY',
      'يرجى تحديد قسم واحد على الأقل يحتوي على بيانات كافية لإعداد التحضير المتقدم.',
      400
    );
  }

  const idToken = await deps.getIdToken();

  let res: Response;
  try {
    res = await deps.fetchApi('/api/ai/meeting-briefing', {
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
      throw new MeetingAiClientError('AI_ABORTED', 'تم إلغاء طلب التحضير الذكي المتقدم.');
    }
    throw new MeetingAiClientError(
      'NETWORK_ERROR',
      'تعذر الاتصال بخادم التطبيق لإعداد التحضير المتقدم. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
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
        ? 'غير مصرح لك بالوصول إلى هذا اللقاء.'
        : res.status === 429
        ? 'تم تجاوز الحد المؤقت للطلبات. انتظر قليلاً ثم أعد المحاولة.'
        : res.status === 503
        ? 'خدمة الذكاء الاصطناعي غير مفعّلة على الخادم حالياً.'
        : 'تعذر إتمام التحضير المتقدم عبر الخادم. يمكنك الاعتماد على التحضير الذكي المباشر أو المحاولة لاحقاً.';
    throw new MeetingAiClientError(code, messageArabic, res.status);
  }

  const validated = validateAndNormalizeMeetingBriefingAi(body, {
    modelUsed: typeof body?.modelUsed === 'string' ? body.modelUsed : 'gemini-4-hydrogen',
    generatedAt: typeof body?.generatedAt === 'string' ? body.generatedAt : undefined,
  });

  if (!validated.ok) {
    throw new MeetingAiClientError('INVALID_AI_RESPONSE', validated.errorArabic, 502);
  }

  return validated.data;
}

export async function requestMeetingAiBriefing(params: {
  brief: MeetingPreparationBrief;
  includedSections: AiBriefingSectionSelection;
  signal?: AbortSignal;
}): Promise<MeetingAiBriefingResult> {
  return requestMeetingAiBriefingWithDeps(params, defaultRequestDeps);
}
