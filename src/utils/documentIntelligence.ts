import type {
  AllowedAttachmentMimeType,
  AiDecisionConfidence,
  AiOpenPoint,
  AiOpenPointCategory,
  DocumentAiAnalysisMode,
  DocumentAiAnalysisRequest,
  DocumentAiAnalysisResult,
  DocumentAiComprehensiveSummary,
  DocumentAiImportantDate,
  DocumentAiQuestionAnswer,
  DocumentAiSuggestedDecision,
  DocumentAiSuggestedTask,
  MeetingAttachment,
  TaskPriority,
} from '../types/index.ts';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  isValidResourceId,
} from './attachmentPolicy.ts';
import {
  detectDisallowedAiFields,
  isValidIsoDateOnly,
  redactSensitiveAiText,
} from './meetingAiAssistant.ts';

export const DOCUMENT_AI_SUPPORTED_MIME_TYPES: readonly AllowedAttachmentMimeType[] =
  ALLOWED_ATTACHMENT_MIME_TYPES;
export const DOCUMENT_AI_MAX_SIZE_BYTES = MAX_ATTACHMENT_SIZE_BYTES;
export const DOCUMENT_AI_MAX_QUESTION_CHARS = 1000;
export const DOCUMENT_AI_TIMEOUT_MS = 45000;
export const DOCUMENT_AI_RATE_LIMIT_WINDOW_MS = 60000;
export const DOCUMENT_AI_RATE_LIMIT_MAX_REQUESTS = 5;

export const DOCUMENT_AI_MAX_KEY_POINTS = 15;
export const DOCUMENT_AI_MAX_DECISIONS = 12;
export const DOCUMENT_AI_MAX_TASKS = 15;
export const DOCUMENT_AI_MAX_DATES = 12;
export const DOCUMENT_AI_MAX_OPEN_QUESTIONS = 12;
export const DOCUMENT_AI_MAX_LIMITATIONS = 8;
export const DOCUMENT_AI_MAX_EVIDENCE = 6;

export const DOCUMENT_AI_ADDITIONAL_SPOOF_FIELDS = new Set([
  'uid',
  'userid',
  'ownerid',
  'storagekey',
  'b2key',
  'objectkey',
  'bucket',
  'path',
  'filepath',
  'firestorepath',
  'targetpath',
  'collectionpath',
  'downloadurl',
  'uploadurl',
  'presignedurl',
  'signedurl',
  'uploadstatus',
  'deletestatus',
  'bytes',
  'filebytes',
  'filecontent',
  'base64',
  'dataurl',
  'inlinedata',
  'role',
  'isadmin',
  'apikey',
  'geminiapikey',
  'token',
  'idtoken',
]);

export function detectDocumentAiSpoofingFields(body: unknown, depth = 0): string | null {
  if (depth > 5 || body === null || body === undefined) return null;
  if (Array.isArray(body)) {
    for (const entry of body) {
      const hit = detectDocumentAiSpoofingFields(entry, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof body !== 'object') return null;

  for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
    if (DOCUMENT_AI_ADDITIONAL_SPOOF_FIELDS.has(key.toLowerCase())) {
      return key;
    }
    const nested = detectDocumentAiSpoofingFields(val, depth + 1);
    if (nested) return nested;
  }

  return detectDisallowedAiFields(body, depth);
}

export function isSupportedDocumentAiMime(mime: unknown): mime is AllowedAttachmentMimeType {
  if (typeof mime !== 'string') return false;
  const norm = mime.trim().toLowerCase().split(';')[0];
  return DOCUMENT_AI_SUPPORTED_MIME_TYPES.includes(norm as AllowedAttachmentMimeType);
}

export function getDocumentTypeArabicLabel(mime: string): string {
  const norm = (mime || '').trim().toLowerCase();
  if (norm === 'application/pdf') return 'مستند PDF';
  if (norm === 'image/jpeg') return 'صورة JPEG';
  if (norm === 'image/png') return 'صورة PNG';
  if (norm === 'image/webp') return 'صورة WebP';
  return 'ملف غير مدعوم';
}

export function isAttachmentSupportedForDocumentAi(
  att: Pick<MeetingAttachment, 'contentType' | 'sizeBytes' | 'uploadStatus' | 'deleteStatus'>
): { supported: boolean; reasonArabic?: string } {
  if (att.deleteStatus && att.deleteStatus !== 'active') {
    return {
      supported: false,
      reasonArabic: 'هذا المرفق قيد الحذف أو تمت إزالته من التخزين السحابي ولا يمكن تحليله.',
    };
  }
  if (att.uploadStatus !== 'completed') {
    return {
      supported: false,
      reasonArabic: 'المرفق لم يكتمل رفعه واعتماده على الخادم بعد.',
    };
  }
  if (!isSupportedDocumentAiMime(att.contentType)) {
    return {
      supported: false,
      reasonArabic: 'صيغة هذا الملف غير مدعومة للتحليل الذكي. الصيغ المدعومة حالياً: PDF وJPEG وPNG وWebP فقط.',
    };
  }
  if (
    typeof att.sizeBytes !== 'number' ||
    !Number.isFinite(att.sizeBytes) ||
    att.sizeBytes <= 0 ||
    att.sizeBytes > DOCUMENT_AI_MAX_SIZE_BYTES
  ) {
    return {
      supported: false,
      reasonArabic: 'حجم المرفق غير صالح أو يتجاوز الحد الأقصى المسموح لتحليل المستندات (10 ميجابايت).',
    };
  }
  return { supported: true };
}

export function sanitizeDocumentAnalysisRequest(raw: unknown):
  | {
      ok: true;
      request: DocumentAiAnalysisRequest;
    }
  | {
      ok: false;
      statusCode: number;
      errorCode: string;
      messageArabic: string;
    } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_DOCUMENT_AI_REQUEST',
      messageArabic: 'صيغة طلب تحليل المستند غير صالحة.',
    };
  }

  const spoofHit = detectDocumentAiSpoofingFields(raw);
  if (spoofHit) {
    return {
      ok: false,
      statusCode: 403,
      errorCode: 'FORBIDDEN',
      messageArabic:
        'مرفوض: يُمنع تمرير معرّفات الحسابات أو مسارات التخزين أو الروابط المؤقتة أو محتوى الملف من الواجهة.',
    };
  }

  const obj = raw as Record<string, unknown>;

  if (!isValidResourceId(obj.meetingId) || !isValidResourceId(obj.attachmentId)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_RESOURCE_ID',
      messageArabic: 'معرّف اللقاء أو المرفق غير صالح.',
    };
  }

  const analysisMode: DocumentAiAnalysisMode | null =
    obj.analysisMode === 'comprehensive' || obj.analysisMode === 'question'
      ? obj.analysisMode
      : null;

  if (!analysisMode) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_ANALYSIS_MODE',
      messageArabic: 'نوع التحليل المطلوب غير صالح (يُسمح بالتحليل الشامل أو طرح سؤال محدد).',
    };
  }

  let question: string | undefined;
  if (analysisMode === 'question') {
    const rawQ = typeof obj.question === 'string' ? redactSensitiveAiText(obj.question) : '';
    if (rawQ.length < 2) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'EMPTY_DOCUMENT_QUESTION',
        messageArabic: 'يرجى كتابة سؤال واضح حول المستند قبل بدء التحليل.',
      };
    }
    if (rawQ.length > DOCUMENT_AI_MAX_QUESTION_CHARS) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'QUESTION_TOO_LONG',
        messageArabic: `يتجاوز السؤال الحد الأقصى المسموح (${DOCUMENT_AI_MAX_QUESTION_CHARS} حرفاً). يرجى اختصاره ثم إعادة المحاولة.`,
      };
    }
    question = rawQ;
  }

  return {
    ok: true,
    request: {
      meetingId: obj.meetingId,
      attachmentId: obj.attachmentId,
      analysisMode,
      ...(question ? { question } : {}),
    },
  };
}

const GENERIC_UNKNOWN_OWNER_VALUES = new Set([
  'غير محدد',
  'مجهول',
  'لا يوجد',
  'غير معروف',
  'unknown',
  'n/a',
  'na',
  'tbd',
  'none',
  '-',
]);

function cleanOwnerName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = redactSensitiveAiText(raw).slice(0, 120);
  if (!cleaned) return undefined;
  if (GENERIC_UNKNOWN_OWNER_VALUES.has(cleaned.toLowerCase())) return undefined;
  return cleaned;
}

function normalizePriority(raw: unknown): TaskPriority {
  if (raw === 'urgent' || raw === 'high' || raw === 'medium' || raw === 'low') {
    return raw;
  }
  return 'medium';
}

function normalizeConfidence(raw: unknown): AiDecisionConfidence {
  return raw === 'explicit' ? 'explicit' : 'needs_confirmation';
}

function normalizeOpenPointCategory(raw: unknown): AiOpenPointCategory {
  if (raw === 'ambiguity' || raw === 'risk') return raw;
  return 'open_question';
}

function sanitizeStringArray(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const items: string[] = [];
  for (const entry of raw.slice(0, maxItems)) {
    if (typeof entry !== 'string') continue;
    const clean = redactSensitiveAiText(entry).slice(0, maxLen);
    if (clean) items.push(clean);
  }
  return items;
}

export function validateAndNormalizeDocumentAiResult(
  raw: unknown,
  context: {
    model: string;
    meetingId: string;
    attachmentId: string;
    fileName: string;
    contentType: AllowedAttachmentMimeType;
    sizeBytes: number;
    analysisMode: DocumentAiAnalysisMode;
    question?: string;
    analysisId?: string;
    generatedAt?: string;
  }
): DocumentAiAnalysisResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_AI_RESPONSE: الاستجابة الواردة من نموذج تحليل المستندات ليست كائناً صالحاً.');
  }

  const obj = raw as Record<string, unknown>;
  const warningsArabic: string[] = [];
  const limitations = sanitizeStringArray(obj.limitations, DOCUMENT_AI_MAX_LIMITATIONS, 320);

  if (context.analysisMode === 'question') {
    const answerText =
      typeof obj.answer === 'string' ? redactSensitiveAiText(obj.answer).slice(0, 4000) : '';
    if (!answerText) {
      throw new Error('INVALID_AI_RESPONSE: إجابة النموذج على السؤال المحدد فارغة أو غير مكتملة.');
    }
    const supportingEvidence = sanitizeStringArray(
      obj.supportingEvidence,
      DOCUMENT_AI_MAX_EVIDENCE,
      350
    );
    const insufficientInformation =
      Boolean(obj.insufficientInformation) || supportingEvidence.length === 0;

    if (insufficientInformation) {
      warningsArabic.push(
        'لم يحتوِ المرفق على معلومات قاطعة وكافية للإجابة الكاملة عن السؤال؛ التزمت الإجابة بما هو ظاهر في المستند فقط.'
      );
    }

    const questionAnswer: DocumentAiQuestionAnswer = {
      question: redactSensitiveAiText(context.question || '').slice(0, DOCUMENT_AI_MAX_QUESTION_CHARS),
      answer: answerText,
      supportingEvidence,
      insufficientInformation,
    };

    return {
      analysisId: context.analysisId || `doc-ai-${Date.now()}`,
      generatedAt: context.generatedAt || new Date().toISOString(),
      model: context.model,
      meetingId: context.meetingId,
      attachmentId: context.attachmentId,
      fileName: context.fileName,
      contentType: context.contentType,
      sizeBytes: context.sizeBytes,
      analysisMode: 'question',
      keyPoints: [],
      decisions: [],
      suggestedTasks: [],
      importantDates: [],
      openQuestions: [],
      questionAnswer,
      limitations,
      warningsArabic,
    };
  }

  // Comprehensive mode
  if (!obj.summary || typeof obj.summary !== 'object' || Array.isArray(obj.summary)) {
    throw new Error('INVALID_AI_RESPONSE: استجابة التحليل الشامل تفتقر إلى قسم الملخص.');
  }

  const rawSummary = obj.summary as Record<string, unknown>;
  const overview =
    typeof rawSummary.overview === 'string'
      ? redactSensitiveAiText(rawSummary.overview).slice(0, 2500)
      : '';
  const documentTypeLabel =
    typeof rawSummary.documentTypeLabel === 'string'
      ? redactSensitiveAiText(rawSummary.documentTypeLabel).slice(0, 120) || undefined
      : undefined;
  const mainSubject =
    typeof rawSummary.mainSubject === 'string'
      ? redactSensitiveAiText(rawSummary.mainSubject).slice(0, 250) || undefined
      : undefined;

  const keyPoints = sanitizeStringArray(obj.keyPoints, DOCUMENT_AI_MAX_KEY_POINTS, 350);

  if (!overview && keyPoints.length === 0) {
    throw new Error('INVALID_AI_RESPONSE: ملخص المستند المستخرج فارغ.');
  }

  if (
    !Array.isArray(obj.keyPoints) ||
    !Array.isArray(obj.decisions) ||
    !Array.isArray(obj.suggestedTasks) ||
    !Array.isArray(obj.importantDates) ||
    !Array.isArray(obj.openQuestions)
  ) {
    throw new Error('INVALID_AI_RESPONSE: القوائم المستخرجة من تحليل المستند غير مكتملة أو غير مطابقة للمخطط.');
  }

  const insufficientInfo = Boolean(rawSummary.insufficientInfo);
  if (insufficientInfo) {
    warningsArabic.push(
      'محتوى المرفق مختصر أو غير واضح جزئياً؛ التزمت النتائج بما أمكن قراءته بوضوح من المستند فقط.'
    );
  }

  const summary: DocumentAiComprehensiveSummary = {
    overview: overview || 'المعلومات المقروءة من المرفق مختصرة وتحتاج مراجعتك.',
    ...(documentTypeLabel ? { documentTypeLabel } : {}),
    ...(mainSubject ? { mainSubject } : {}),
    insufficientInfo,
  };

  const decisions: DocumentAiSuggestedDecision[] = [];
  for (let i = 0; i < Math.min(obj.decisions.length, DOCUMENT_AI_MAX_DECISIONS); i++) {
    const rawDec = obj.decisions[i];
    if (!rawDec || typeof rawDec !== 'object') continue;
    const d = rawDec as Record<string, unknown>;
    const text = typeof d.text === 'string' ? redactSensitiveAiText(d.text).slice(0, 500) : '';
    if (text.length < 3) continue;
    const ownerName = cleanOwnerName(d.ownerName);
    const sourceEvidence =
      typeof d.sourceEvidence === 'string'
        ? redactSensitiveAiText(d.sourceEvidence).slice(0, 260) || undefined
        : undefined;

    decisions.push({
      id: `doc-dec-${i + 1}`,
      text,
      confidence: normalizeConfidence(d.confidence),
      ...(ownerName ? { ownerName } : {}),
      ...(sourceEvidence ? { sourceEvidence } : {}),
    });
  }
  if (obj.decisions.length > DOCUMENT_AI_MAX_DECISIONS) {
    warningsArabic.push(`تم عرض أهم ${DOCUMENT_AI_MAX_DECISIONS} قرارات مقترحة من المستند.`);
  }

  const suggestedTasks: DocumentAiSuggestedTask[] = [];
  for (let i = 0; i < Math.min(obj.suggestedTasks.length, DOCUMENT_AI_MAX_TASKS); i++) {
    const rawT = obj.suggestedTasks[i];
    if (!rawT || typeof rawT !== 'object') continue;
    const t = rawT as Record<string, unknown>;
    const title = typeof t.title === 'string' ? redactSensitiveAiText(t.title).slice(0, 250) : '';
    if (title.length < 2) continue;
    const ownerName = cleanOwnerName(t.ownerName);
    const hasValidDue = isValidIsoDateOnly(t.dueDate);
    const dueDate = hasValidDue ? (t.dueDate as string).trim() : undefined;
    const description =
      typeof t.description === 'string'
        ? redactSensitiveAiText(t.description).slice(0, 1500) || undefined
        : undefined;
    const sourceEvidence =
      typeof t.sourceEvidence === 'string'
        ? redactSensitiveAiText(t.sourceEvidence).slice(0, 260) || undefined
        : undefined;

    suggestedTasks.push({
      id: `doc-task-${i + 1}`,
      title,
      ...(description ? { description } : {}),
      ...(ownerName ? { ownerName } : {}),
      ...(dueDate ? { dueDate } : {}),
      priority: normalizePriority(t.priority),
      needsDueDateConfirmation: Boolean(t.needsDueDateConfirmation) || !hasValidDue,
      needsOwnerConfirmation: Boolean(t.needsOwnerConfirmation) || !ownerName,
      ...(sourceEvidence ? { sourceEvidence } : {}),
    });
  }
  if (obj.suggestedTasks.length > DOCUMENT_AI_MAX_TASKS) {
    warningsArabic.push(`تم عرض أهم ${DOCUMENT_AI_MAX_TASKS} مهام مقترحة من المستند.`);
  }

  const importantDates: DocumentAiImportantDate[] = [];
  for (let i = 0; i < Math.min(obj.importantDates.length, DOCUMENT_AI_MAX_DATES); i++) {
    const rawDate = obj.importantDates[i];
    if (!rawDate || typeof rawDate !== 'object') continue;
    const dt = rawDate as Record<string, unknown>;
    const label = typeof dt.label === 'string' ? redactSensitiveAiText(dt.label).slice(0, 240) : '';
    if (label.length < 2) continue;
    const hasValidIso = isValidIsoDateOnly(dt.dateIso);
    const dateIso = hasValidIso ? (dt.dateIso as string).trim() : undefined;
    const rawDateText =
      typeof dt.rawDateText === 'string'
        ? redactSensitiveAiText(dt.rawDateText).slice(0, 120) || undefined
        : undefined;
    const sourceEvidence =
      typeof dt.sourceEvidence === 'string'
        ? redactSensitiveAiText(dt.sourceEvidence).slice(0, 220) || undefined
        : undefined;

    importantDates.push({
      id: `doc-date-${i + 1}`,
      label,
      ...(dateIso ? { dateIso } : {}),
      ...(rawDateText ? { rawDateText } : {}),
      needsDateConfirmation: Boolean(dt.needsDateConfirmation) || !hasValidIso,
      ...(sourceEvidence ? { sourceEvidence } : {}),
    });
  }

  const openQuestions: AiOpenPoint[] = [];
  for (let i = 0; i < Math.min(obj.openQuestions.length, DOCUMENT_AI_MAX_OPEN_QUESTIONS); i++) {
    const rawQ = obj.openQuestions[i];
    if (!rawQ || typeof rawQ !== 'object') continue;
    const q = rawQ as Record<string, unknown>;
    const text = typeof q.text === 'string' ? redactSensitiveAiText(q.text).slice(0, 400) : '';
    if (text.length < 3) continue;
    openQuestions.push({
      id: `doc-open-${i + 1}`,
      text,
      category: normalizeOpenPointCategory(q.category),
    });
  }

  return {
    analysisId: context.analysisId || `doc-ai-${Date.now()}`,
    generatedAt: context.generatedAt || new Date().toISOString(),
    model: context.model,
    meetingId: context.meetingId,
    attachmentId: context.attachmentId,
    fileName: context.fileName,
    contentType: context.contentType,
    sizeBytes: context.sizeBytes,
    analysisMode: 'comprehensive',
    summary,
    keyPoints,
    decisions,
    suggestedTasks,
    importantDates,
    openQuestions,
    limitations,
    warningsArabic,
  };
}

export function buildStructuredDocumentSummaryText(result: DocumentAiAnalysisResult): string {
  const parts: string[] = [];
  const docTag = `تحليل مرفق: ${result.fileName}`;
  if (result.analysisMode === 'question' && result.questionAnswer) {
    parts.push(`${docTag}\nالسؤال: ${result.questionAnswer.question}`);
    parts.push(`الإجابة المستخلصة من المرفق:\n${result.questionAnswer.answer}`);
    if (result.questionAnswer.supportingEvidence.length > 0) {
      parts.push(
        `أدلة من المستند:\n${result.questionAnswer.supportingEvidence
          .map((e) => `- ${e}`)
          .join('\n')}`
      );
    }
    return parts.join('\n\n').trim();
  }

  if (result.summary?.overview?.trim()) {
    parts.push(`${docTag}\n${result.summary.overview.trim()}`);
  }
  if (result.keyPoints.length > 0) {
    parts.push(`أبرز النقاط المستخرجة:\n${result.keyPoints.map((p) => `- ${p}`).join('\n')}`);
  }
  return parts.join('\n\n').trim();
}
