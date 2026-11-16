import type {
  CommunicationDraftRequest,
  CommunicationDraftResult,
} from '../types/index.ts';
import { getCurrentUserIdToken } from './firebase.ts';

export class CommunicationAiClientError extends Error {
  code: string;
  statusCode?: number;

  constructor(code: string, messageArabic: string, statusCode?: number) {
    super(messageArabic);
    this.name = 'CommunicationAiClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RequestCommunicationAiDeps {
  isOnline: () => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  fetchApi: typeof fetch;
}

const defaultDeps: RequestCommunicationAiDeps = {
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  getIdToken: (forceRefresh) => getCurrentUserIdToken(forceRefresh),
  fetchApi: (...args) => fetch(...args),
};

export async function requestCommunicationDraft(
  params: {
    request: CommunicationDraftRequest;
    contextData: {
      clientName?: string;
      companyName?: string;
      contactName?: string;
      opportunityTitle?: string;
      opportunityValue?: string;
      nextAction?: string;
    };
    signal?: AbortSignal;
  },
  deps: RequestCommunicationAiDeps = defaultDeps
): Promise<CommunicationDraftResult> {
  if (!deps.isOnline()) {
    throw new CommunicationAiClientError(
      'OFFLINE_BLOCKED',
      'صياغة المراسلات بالذكاء الاصطناعي تتطلب اتصالاً نشطاً بالإنترنت. تظل القوالب والمسودات المحلية متاحة دون اتصال.'
    );
  }

  const idToken = await deps.getIdToken();
  if (!idToken) {
    throw new CommunicationAiClientError(
      'UNAUTHENTICATED',
      'يجب تسجيل الدخول بحساب Google الموثّق لاستخدام مساعد المراسلات الذكي.',
      401
    );
  }

  let res: Response;
  try {
    res = await deps.fetchApi('/api/ai/communication-draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        request: params.request,
        contextData: params.contextData,
      }),
      signal: params.signal,
    });
  } catch (err: unknown) {
    if (params.signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
      throw new CommunicationAiClientError('AI_ABORTED', 'تم إلغاء طلب صياغة المراسلة بناءً على طلبك.');
    }
    throw new CommunicationAiClientError(
      'NETWORK_ERROR',
      'تعذر الاتصال بخادم التطبيق لصياغة المراسلة. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
    );
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { error: 'INVALID_JSON', messageArabic: 'استجابة غير صالحة من الخادم.' };
  }

  if (!res.ok) {
    const msg = typeof data.messageArabic === 'string' ? data.messageArabic : 'تعذر إتمام الصياغة الذكية.';
    const code = typeof data.error === 'string' ? data.error : 'COMMUNICATION_DRAFT_FAILED';
    throw new CommunicationAiClientError(code, msg, res.status);
  }

  return data as unknown as CommunicationDraftResult;
}
