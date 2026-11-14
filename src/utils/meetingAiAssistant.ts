import type {
  ActionItem,
  AiDecisionConfidence,
  AiFollowUpSuggestion,
  AiMeetingInputAgendaItem,
  AiMeetingInputParticipant,
  AiMeetingInputPayload,
  AiOpenPoint,
  AiOpenPointCategory,
  AiSectionInclusionKey,
  AiSectionInclusionSelection,
  AiSuggestedActionItem,
  AiSuggestedDecision,
  AiSuggestedSummary,
  Meeting,
  MeetingAiAnalysisResult,
  TaskPriority,
} from '../types/index.ts';
import {
  addDecisionToList,
  createLinkedMeetingTask,
  getEffectiveParticipants,
  isMinutesLocked,
  normalizeAgendaOrder,
  normalizeTaskTitle,
  redactTemporaryAttachmentUrls,
} from './meetingMinutes.ts';

export const MAX_AI_TOTAL_INPUT_CHARS = 24000;
export const MAX_AI_DECISIONS = 12;
export const MAX_AI_ACTION_ITEMS = 15;
export const MAX_AI_OPEN_QUESTIONS = 12;
export const MAX_AI_FOLLOWUPS = 6;
export const AI_ANALYSIS_TIMEOUT_MS = 25000;
export const AI_RATE_LIMIT_WINDOW_MS = 60000;
export const AI_RATE_LIMIT_MAX_REQUESTS = 10;

export const DEFAULT_AI_SECTION_SELECTION: AiSectionInclusionSelection = {
  title: true,
  agenda: true,
  discussions: true,
  legacyNotes: true,
  participants: true,
  additionalNotes: true,
  existingTasks: true,
};

export const AI_SECTION_LABELS: {
  key: AiSectionInclusionKey;
  labelAr: string;
  labelEn: string;
}[] = [
  { key: 'title', labelAr: 'عنوان اللقاء وتاريخه والعميل', labelEn: 'Title, date & client name' },
  { key: 'agenda', labelAr: 'جدول الأعمال وملاحظات البنود', labelEn: 'Agenda items & notes' },
  { key: 'discussions', labelAr: 'ملخص المناقشات المنظّم', labelEn: 'Discussion summary' },
  { key: 'legacyNotes', labelAr: 'الملاحظات النصية الإضافية / السابقة', labelEn: 'Legacy meeting notes' },
  { key: 'participants', labelAr: 'أسماء المشاركين وأدوارهم', labelEn: 'Participants list' },
  { key: 'additionalNotes', labelAr: 'الملاحظات الإضافية في المحضر', labelEn: 'Additional minutes notes' },
  { key: 'existingTasks', labelAr: 'المهام المرتبطة الحالية (لتفادي التكرار)', labelEn: 'Existing linked tasks' },
];

export const DISALLOWED_AI_CONTROL_FIELDS = new Set([
  'uid',
  'userid',
  'ownerid',
  'firestorepath',
  'targetpath',
  'collectionpath',
  'role',
  'isadmin',
  'attachments',
  'files',
  'downloadurl',
  'presignedurl',
  'signedurl',
  'storagekey',
  'apikey',
  'geminiapikey',
  'token',
  'idtoken',
]);

export function redactSensitiveAiText(text: string): string {
  if (!text) return '';
  return redactTemporaryAttachmentUrls(text)
    .replace(
      /https?:\/\/[^\s"'<>]*(?:backblazeb2\.com|b2_download_file_by_id)[^\s"'<>]*/gi,
      '[رابط ملف محذوف لأسباب الخصوصية]'
    )
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[مفتاح محذوف]')
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, '[رمز مصادقة محذوف]')
    .trim();
}

export function detectDisallowedAiFields(body: unknown, depth = 0): string | null {
  if (depth > 5 || body === null || body === undefined) return null;
  if (Array.isArray(body)) {
    for (const item of body) {
      const hit = detectDisallowedAiFields(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof body !== 'object') return null;

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (DISALLOWED_AI_CONTROL_FIELDS.has(key.toLowerCase())) {
      return key;
    }
    const nested = detectDisallowedAiFields(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function computeAiPayloadCharCount(payload: AiMeetingInputPayload): number {
  let count = 0;
  if (payload.meetingTitle) count += payload.meetingTitle.length;
  if (payload.meetingDateIso) count += payload.meetingDateIso.length;
  if (payload.clientName) count += payload.clientName.length;
  if (payload.discussionSummary) count += payload.discussionSummary.length;
  if (payload.legacyNotes) count += payload.legacyNotes.length;
  if (payload.minutesAdditionalNotes) count += payload.minutesAdditionalNotes.length;

  for (const p of payload.participants || []) {
    count += (p.name?.length || 0) + (p.role?.length || 0);
  }
  for (const a of payload.agendaItems || []) {
    count += (a.title?.length || 0) + (a.notes?.length || 0);
  }
  for (const t of payload.existingTasksSummary || []) {
    count += t.length;
  }
  return count;
}

export interface MeetingAiInputBundle {
  payload: AiMeetingInputPayload;
  totalChars: number;
  exceedsLimit: boolean;
  hasSubstantiveContent: boolean;
  previewText: string;
}

export function formatAiInputPreviewText(payload: AiMeetingInputPayload): string {
  const lines: string[] = [];
  if (payload.meetingTitle) {
    lines.push(`عنوان اللقاء: ${payload.meetingTitle}`);
  }
  if (payload.meetingDateIso) {
    lines.push(`تاريخ اللقاء المرجعي: ${formatMeetingDateContextForAi(payload.meetingDateIso)}`);
  }
  if (payload.clientName) {
    lines.push(`اسم العميل: ${payload.clientName}`);
  }
  if (payload.participants && payload.participants.length > 0) {
    lines.push('');
    lines.push('المشاركون:');
    payload.participants.forEach((p, idx) => {
      const party = p.party === 'internal' ? 'داخلي' : 'خارجي';
      lines.push(`${idx + 1}. ${p.name}${p.role ? ` (${p.role})` : ''} — ${party}`);
    });
  }
  if (payload.agendaItems && payload.agendaItems.length > 0) {
    lines.push('');
    lines.push('جدول الأعمال:');
    payload.agendaItems.forEach((a) => {
      lines.push(`${a.order}. ${a.title}`);
      if (a.notes) lines.push(`   ملاحظة: ${a.notes}`);
    });
  }
  if (payload.discussionSummary) {
    lines.push('');
    lines.push('ملخص المناقشات:');
    lines.push(payload.discussionSummary);
  }
  if (payload.legacyNotes) {
    lines.push('');
    lines.push('الملاحظات النصية:');
    lines.push(payload.legacyNotes);
  }
  if (payload.minutesAdditionalNotes) {
    lines.push('');
    lines.push('ملاحظات إضافية:');
    lines.push(payload.minutesAdditionalNotes);
  }
  if (payload.existingTasksSummary && payload.existingTasksSummary.length > 0) {
    lines.push('');
    lines.push('المهام المرتبطة الحالية (للمقارنة ومنع التكرار):');
    payload.existingTasksSummary.forEach((t, idx) => {
      lines.push(`${idx + 1}. ${t}`);
    });
  }

  return lines.join('\n').trim();
}

export function buildMeetingAiInputBundle(params: {
  meeting: Meeting;
  tasks: ActionItem[];
  clientName?: string;
  includedSections: AiSectionInclusionSelection;
}): MeetingAiInputBundle {
  const { meeting, tasks, clientName, includedSections } = params;
  const activeKeys = (Object.keys(includedSections) as AiSectionInclusionKey[]).filter(
    (k) => Boolean(includedSections[k])
  );

  const payload: AiMeetingInputPayload = {
    meetingId: meeting.id,
    includedSections: activeKeys,
  };

  if (includedSections.title) {
    const cleanTitle = redactSensitiveAiText(meeting.title || '').slice(0, 200);
    if (cleanTitle) payload.meetingTitle = cleanTitle;
    if (meeting.dateTime) payload.meetingDateIso = meeting.dateTime.slice(0, 50);
    payload.meetingType = meeting.type;
    const cleanClient = redactSensitiveAiText(clientName || '').slice(0, 150);
    if (cleanClient) payload.clientName = cleanClient;
  }

  if (includedSections.participants) {
    const participants: AiMeetingInputParticipant[] = getEffectiveParticipants(meeting)
      .slice(0, 40)
      .map((p) => {
        const clean: AiMeetingInputParticipant = {
          name: redactSensitiveAiText(p.name).slice(0, 120),
          party: p.party === 'internal' ? 'internal' : 'external',
        };
        if (p.role) {
          const r = redactSensitiveAiText(p.role).slice(0, 100);
          if (r) clean.role = r;
        }
        return clean;
      })
      .filter((p) => p.name.length > 0);
    if (participants.length > 0) payload.participants = participants;
  }

  if (includedSections.agenda) {
    const agendaItems: AiMeetingInputAgendaItem[] = normalizeAgendaOrder(meeting.agendaItems || [])
      .slice(0, 40)
      .map((item) => {
        const clean: AiMeetingInputAgendaItem = {
          id: item.id,
          order: item.order,
          title: redactSensitiveAiText(item.title).slice(0, 200),
        };
        if (item.notes) {
          const n = redactSensitiveAiText(item.notes).slice(0, 1500);
          if (n) clean.notes = n;
        }
        return clean;
      })
      .filter((a) => a.title.length > 0);
    if (agendaItems.length > 0) payload.agendaItems = agendaItems;
  }

  if (includedSections.discussions && meeting.discussionSummary?.trim()) {
    const clean = redactSensitiveAiText(meeting.discussionSummary).slice(0, 15000);
    if (clean) payload.discussionSummary = clean;
  }

  if (includedSections.legacyNotes && meeting.notes?.trim()) {
    const clean = redactSensitiveAiText(meeting.notes).slice(0, 10000);
    if (clean) payload.legacyNotes = clean;
  }

  if (includedSections.additionalNotes && meeting.minutesAdditionalNotes?.trim()) {
    const clean = redactSensitiveAiText(meeting.minutesAdditionalNotes).slice(0, 5000);
    if (clean) payload.minutesAdditionalNotes = clean;
  }

  if (includedSections.existingTasks) {
    const linked = tasks
      .filter((t) => t.meetingId === meeting.id && t.status !== 'cancelled')
      .slice(0, 30)
      .map((t) => redactSensitiveAiText(t.title).slice(0, 200))
      .filter((t) => t.length > 0);
    if (linked.length > 0) payload.existingTasksSummary = linked;
  }

  const totalChars = computeAiPayloadCharCount(payload);
  const substantiveText = [
    payload.discussionSummary || '',
    payload.legacyNotes || '',
    payload.minutesAdditionalNotes || '',
    ...(payload.agendaItems || []).map((a) => `${a.title} ${a.notes || ''}`),
  ]
    .join(' ')
    .replace(/\s+/g, '');

  const fallbackMetaText = `${payload.meetingTitle || ''}`.replace(/\s+/g, '');
  const hasSubstantiveContent =
    substantiveText.length >= 8 || (fallbackMetaText.length >= 6 && (payload.participants?.length || 0) > 0);

  return {
    payload,
    totalChars,
    exceedsLimit: totalChars > MAX_AI_TOTAL_INPUT_CHARS,
    hasSubstantiveContent,
    previewText: formatAiInputPreviewText(payload),
  };
}

export function sanitizeIncomingAiPayload(raw: unknown): {
  ok: true;
  payload: AiMeetingInputPayload;
  totalChars: number;
} | {
  ok: false;
  statusCode: number;
  errorCode: string;
  messageArabic: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'INVALID_AI_PAYLOAD',
      messageArabic: 'صيغة بيانات تحليل الاجتماع غير صالحة.',
    };
  }

  const disallowed = detectDisallowedAiFields(raw);
  if (disallowed) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'DISALLOWED_AI_INPUT_FIELD',
      messageArabic:
        'يُمنع إرسال حقول التحكم أو المرفقات أو المفاتيح الحساسة ضمن طلب التحليل الذكي.',
    };
  }

  const obj = raw as Record<string, unknown>;
  const meetingId = typeof obj.meetingId === 'string' ? obj.meetingId.trim() : '';
  const allowedSectionKeys = new Set<AiSectionInclusionKey>(
    AI_SECTION_LABELS.map((s) => s.key)
  );
  const includedSections = Array.isArray(obj.includedSections)
    ? obj.includedSections.filter(
        (k): k is AiSectionInclusionKey => typeof k === 'string' && allowedSectionKeys.has(k as AiSectionInclusionKey)
      )
    : [];

  const payload: AiMeetingInputPayload = {
    meetingId,
    includedSections,
  };

  if (typeof obj.meetingTitle === 'string' && obj.meetingTitle.trim()) {
    payload.meetingTitle = redactSensitiveAiText(obj.meetingTitle).slice(0, 200);
  }
  if (typeof obj.meetingDateIso === 'string' && obj.meetingDateIso.trim()) {
    payload.meetingDateIso = obj.meetingDateIso.trim().slice(0, 50);
  }
  if (
    obj.meetingType === 'in_person' ||
    obj.meetingType === 'phone' ||
    obj.meetingType === 'video' ||
    obj.meetingType === 'chat'
  ) {
    payload.meetingType = obj.meetingType;
  }
  if (typeof obj.clientName === 'string' && obj.clientName.trim()) {
    payload.clientName = redactSensitiveAiText(obj.clientName).slice(0, 150);
  }
  if (typeof obj.discussionSummary === 'string' && obj.discussionSummary.trim()) {
    payload.discussionSummary = redactSensitiveAiText(obj.discussionSummary).slice(0, 15000);
  }
  if (typeof obj.legacyNotes === 'string' && obj.legacyNotes.trim()) {
    payload.legacyNotes = redactSensitiveAiText(obj.legacyNotes).slice(0, 10000);
  }
  if (typeof obj.minutesAdditionalNotes === 'string' && obj.minutesAdditionalNotes.trim()) {
    payload.minutesAdditionalNotes = redactSensitiveAiText(obj.minutesAdditionalNotes).slice(0, 5000);
  }

  if (Array.isArray(obj.participants)) {
    const cleanParts: AiMeetingInputParticipant[] = [];
    for (const entry of obj.participants.slice(0, 40)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const name = typeof e.name === 'string' ? redactSensitiveAiText(e.name).slice(0, 120) : '';
      if (!name) continue;
      const role = typeof e.role === 'string' ? redactSensitiveAiText(e.role).slice(0, 100) : '';
      cleanParts.push({
        name,
        ...(role ? { role } : {}),
        party: e.party === 'internal' ? 'internal' : 'external',
      });
    }
    if (cleanParts.length > 0) payload.participants = cleanParts;
  }

  if (Array.isArray(obj.agendaItems)) {
    const cleanAgenda: AiMeetingInputAgendaItem[] = [];
    for (const entry of obj.agendaItems.slice(0, 40)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const title = typeof e.title === 'string' ? redactSensitiveAiText(e.title).slice(0, 200) : '';
      if (!title) continue;
      const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 64) : `ag-${cleanAgenda.length + 1}`;
      const order = typeof e.order === 'number' && Number.isFinite(e.order) ? Math.max(1, Math.round(e.order)) : cleanAgenda.length + 1;
      const notes = typeof e.notes === 'string' ? redactSensitiveAiText(e.notes).slice(0, 1500) : '';
      cleanAgenda.push({
        id,
        order,
        title,
        ...(notes ? { notes } : {}),
      });
    }
    if (cleanAgenda.length > 0) payload.agendaItems = cleanAgenda;
  }

  if (Array.isArray(obj.existingTasksSummary)) {
    const cleanTasks = obj.existingTasksSummary
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .slice(0, 30)
      .map((t) => redactSensitiveAiText(t).slice(0, 200))
      .filter((t) => t.length > 0);
    if (cleanTasks.length > 0) payload.existingTasksSummary = cleanTasks;
  }

  const totalChars = computeAiPayloadCharCount(payload);
  if (totalChars > MAX_AI_TOTAL_INPUT_CHARS) {
    return {
      ok: false,
      statusCode: 413,
      errorCode: 'AI_INPUT_TOO_LARGE',
      messageArabic: `يتجاوز نص الاجتماع المحدد الحد الأقصى المسموح للتحليل (${MAX_AI_TOTAL_INPUT_CHARS.toLocaleString('en-US')} حرفاً). يرجى استبعاد بعض الأقسام أو تقليص النص.`,
    };
  }

  const substantiveChars = [
    payload.discussionSummary || '',
    payload.legacyNotes || '',
    payload.minutesAdditionalNotes || '',
    ...(payload.agendaItems || []).map((a) => `${a.title} ${a.notes || ''}`),
    payload.meetingTitle || '',
  ]
    .join('')
    .replace(/\s+/g, '').length;

  if (substantiveChars < 6) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: 'AI_INPUT_EMPTY',
      messageArabic: 'لا يوجد نص كافٍ في الأقسام المحددة لتحليل الاجتماع.',
    };
  }

  return { ok: true, payload, totalChars };
}

export function formatMeetingDateContextForAi(dateTimeIso?: string): string {
  if (!dateTimeIso) return 'غير محدد';
  const parsed = new Date(dateTimeIso);
  if (Number.isNaN(parsed.getTime())) {
    const datePart = dateTimeIso.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : 'غير محدد';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dayName = dayNamesAr[parsed.getDay()];
  return `${yyyy}-${mm}-${dd} (${dayName})`;
}

export function isValidIsoDateOnly(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
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

function cleanSuggestedOwner(raw: unknown): string | undefined {
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

export function validateAndNormalizeMeetingAiAnalysis(
  raw: unknown,
  context: {
    model: string;
    validAgendaItemIds?: Set<string>;
    analysisId?: string;
    generatedAt?: string;
  }
): MeetingAiAnalysisResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_AI_RESPONSE: الاستجابة الواردة من الذكاء الاصطناعي ليست كائناً صالحاً.');
  }

  const obj = raw as Record<string, unknown>;
  if (!obj.summary || typeof obj.summary !== 'object' || Array.isArray(obj.summary)) {
    throw new Error('INVALID_AI_RESPONSE: استجابة الذكاء الاصطناعي تفتقر إلى قسم الملخص البنيوي.');
  }

  const rawSummary = obj.summary as Record<string, unknown>;
  const overview =
    typeof rawSummary.overview === 'string'
      ? redactSensitiveAiText(rawSummary.overview).slice(0, 1500)
      : '';
  const mainTopics = Array.isArray(rawSummary.mainTopics)
    ? rawSummary.mainTopics
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 10)
        .map((x) => redactSensitiveAiText(x).slice(0, 300))
        .filter(Boolean)
    : [];
  const keyOutcomes = Array.isArray(rawSummary.keyOutcomes)
    ? rawSummary.keyOutcomes
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 10)
        .map((x) => redactSensitiveAiText(x).slice(0, 300))
        .filter(Boolean)
    : [];
  const nextDirection =
    typeof rawSummary.nextDirection === 'string'
      ? redactSensitiveAiText(rawSummary.nextDirection).slice(0, 800)
      : '';

  if (!overview && mainTopics.length === 0 && keyOutcomes.length === 0 && !nextDirection) {
    throw new Error('INVALID_AI_RESPONSE: ملخص الذكاء الاصطناعي فارغ أو غير مكتمل.');
  }

  const insufficientInfo = Boolean(rawSummary.insufficientInfo);
  const summary: AiSuggestedSummary = {
    overview: overview || 'المعلومات المتوفرة مختصرة وتحتاج لاستكمال التفاصيل في المحضر.',
    mainTopics,
    keyOutcomes,
    nextDirection: nextDirection || 'لم يتضح توجه قادم محدد من النص المرسل.',
    insufficientInfo,
  };

  if (
    !Array.isArray(obj.decisions) ||
    !Array.isArray(obj.actionItems) ||
    !Array.isArray(obj.openQuestions) ||
    !Array.isArray(obj.followUpSuggestions)
  ) {
    throw new Error('INVALID_AI_RESPONSE: تنسيق القوائم المستخرجة من الذكاء الاصطناعي غير مطابق للمخطط المطلوب.');
  }

  const validAgendaIds = context.validAgendaItemIds;
  const resolveAgendaId = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
    const trimmed = candidate.trim().slice(0, 64);
    if (validAgendaIds && validAgendaIds.size > 0 && !validAgendaIds.has(trimmed)) {
      return undefined;
    }
    return trimmed;
  };

  const warningsArabic: string[] = [];
  if (insufficientInfo) {
    warningsArabic.push(
      'الملاحظات المحددة قصيرة أو غير كافية لاستخلاص تفاصيل كاملة؛ التزمت النتائج بالمعلومات الصريحة فقط.'
    );
  }

  const decisions: AiSuggestedDecision[] = [];
  for (let i = 0; i < Math.min(obj.decisions.length, MAX_AI_DECISIONS); i++) {
    const rawDec = obj.decisions[i];
    if (!rawDec || typeof rawDec !== 'object') continue;
    const d = rawDec as Record<string, unknown>;
    const text = typeof d.text === 'string' ? redactSensitiveAiText(d.text).slice(0, 500) : '';
    if (text.length < 3) continue;
    const ownerName = cleanSuggestedOwner(d.ownerName);
    const agendaItemId = resolveAgendaId(d.agendaItemId);
    const sourceExcerpt =
      typeof d.sourceExcerpt === 'string'
        ? redactSensitiveAiText(d.sourceExcerpt).slice(0, 220) || undefined
        : undefined;

    decisions.push({
      id: `ai-dec-${i + 1}`,
      text,
      confidence: normalizeConfidence(d.confidence),
      ...(ownerName ? { ownerName } : {}),
      ...(agendaItemId ? { agendaItemId } : {}),
      ...(sourceExcerpt ? { sourceExcerpt } : {}),
    });
  }
  if (obj.decisions.length > MAX_AI_DECISIONS) {
    warningsArabic.push(`تم عرض أهم ${MAX_AI_DECISIONS} قراراً مستخرجاً حفاظاً على وضوح المراجعة.`);
  }

  const actionItems: AiSuggestedActionItem[] = [];
  for (let i = 0; i < Math.min(obj.actionItems.length, MAX_AI_ACTION_ITEMS); i++) {
    const rawItem = obj.actionItems[i];
    if (!rawItem || typeof rawItem !== 'object') continue;
    const t = rawItem as Record<string, unknown>;
    const title = typeof t.title === 'string' ? redactSensitiveAiText(t.title).slice(0, 250) : '';
    if (title.length < 2) continue;

    const ownerName = cleanSuggestedOwner(t.ownerName);
    const hasValidDueDate = isValidIsoDateOnly(t.dueDate);
    const dueDate = hasValidDueDate ? (t.dueDate as string).trim() : undefined;
    const needsDueDateConfirmation = Boolean(t.needsDueDateConfirmation) || !hasValidDueDate;
    const needsOwnerConfirmation = Boolean(t.needsOwnerConfirmation) || !ownerName;
    const description =
      typeof t.description === 'string'
        ? redactSensitiveAiText(t.description).slice(0, 1500) || undefined
        : undefined;
    const agendaItemId = resolveAgendaId(t.agendaItemId);

    actionItems.push({
      id: `ai-task-${i + 1}`,
      title,
      ...(description ? { description } : {}),
      ...(ownerName ? { ownerName } : {}),
      ...(dueDate ? { dueDate } : {}),
      priority: normalizePriority(t.priority),
      needsDueDateConfirmation,
      needsOwnerConfirmation,
      ...(agendaItemId ? { agendaItemId } : {}),
    });
  }
  if (obj.actionItems.length > MAX_AI_ACTION_ITEMS) {
    warningsArabic.push(`تم اقتصار المهام المقترحة على ${MAX_AI_ACTION_ITEMS} مهمة في هذه الجلسة.`);
  }

  const openQuestions: AiOpenPoint[] = [];
  for (let i = 0; i < Math.min(obj.openQuestions.length, MAX_AI_OPEN_QUESTIONS); i++) {
    const rawQ = obj.openQuestions[i];
    if (!rawQ || typeof rawQ !== 'object') continue;
    const q = rawQ as Record<string, unknown>;
    const text = typeof q.text === 'string' ? redactSensitiveAiText(q.text).slice(0, 400) : '';
    if (text.length < 3) continue;
    openQuestions.push({
      id: `ai-open-${i + 1}`,
      text,
      category: normalizeOpenPointCategory(q.category),
    });
  }

  const followUpSuggestions: AiFollowUpSuggestion[] = [];
  for (let i = 0; i < Math.min(obj.followUpSuggestions.length, MAX_AI_FOLLOWUPS); i++) {
    const rawF = obj.followUpSuggestions[i];
    if (!rawF || typeof rawF !== 'object') continue;
    const f = rawF as Record<string, unknown>;
    const actionText =
      typeof f.actionText === 'string' ? redactSensitiveAiText(f.actionText).slice(0, 400) : '';
    if (actionText.length < 3) continue;
    const hasValidDate = isValidIsoDateOnly(f.suggestedDate);
    const suggestedDate = hasValidDate ? (f.suggestedDate as string).trim() : undefined;
    const suggestedQuestions = Array.isArray(f.suggestedQuestions)
      ? f.suggestedQuestions
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 5)
          .map((x) => redactSensitiveAiText(x).slice(0, 250))
          .filter(Boolean)
      : [];

    followUpSuggestions.push({
      id: `ai-followup-${i + 1}`,
      actionText,
      ...(suggestedDate ? { suggestedDate } : {}),
      needsDateConfirmation: Boolean(f.needsDateConfirmation) || !hasValidDate,
      suggestedQuestions,
    });
  }

  return {
    analysisId: context.analysisId || `ai-${Date.now()}`,
    generatedAt: context.generatedAt || new Date().toISOString(),
    model: context.model,
    summary,
    decisions,
    actionItems,
    openQuestions,
    followUpSuggestions,
    warningsArabic,
  };
}

export function buildStructuredMeetingSummaryText(summary: AiSuggestedSummary): string {
  const parts: string[] = [];
  if (summary.overview.trim()) {
    parts.push(`النظرة العامة: ${summary.overview.trim()}`);
  }
  if (summary.mainTopics.length > 0) {
    parts.push(`أبرز الموضوعات:\n${summary.mainTopics.map((t) => `- ${t}`).join('\n')}`);
  }
  if (summary.keyOutcomes.length > 0) {
    parts.push(`أهم النتائج والاتجاهات:\n${summary.keyOutcomes.map((o) => `- ${o}`).join('\n')}`);
  }
  if (summary.nextDirection.trim()) {
    parts.push(`التوجه القادم: ${summary.nextDirection.trim()}`);
  }
  return parts.join('\n\n').trim();
}

export const MINUTES_LOCKED_AI_EDIT_MESSAGE_AR =
  'هذا المحضر مضبوط على حالة «نهائي». لإضافة الملخص أو القرارات أو تعديل موعد المتابعة داخل المحضر، أعد فتح المحضر للتعديل أولاً (بينما يظل إنشاء المهام المرتبطة المستقلة متاحاً).';

export function applyAiSummaryToMeeting(
  meeting: Meeting,
  summaryText: string,
  mode: 'append' | 'replace' = 'append'
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (isMinutesLocked(meeting)) {
    return {
      ok: false,
      reasonArabic: MINUTES_LOCKED_AI_EDIT_MESSAGE_AR,
    };
  }

  const clean = redactSensitiveAiText(summaryText).slice(0, 15000);
  if (!clean) {
    return {
      ok: false,
      reasonArabic: 'نص الملخص فارغ ولا يمكن إضافته.',
    };
  }

  const existing = (meeting.discussionSummary || '').trim();
  const nextDiscussionSummary =
    mode === 'replace' || !existing
      ? clean
      : existing.includes(clean)
      ? existing
      : `${existing}\n\n${clean}`.slice(0, 15000);

  return {
    ok: true,
    meeting: {
      ...meeting,
      discussionSummary: nextDiscussionSummary,
      // Strictly preserve legacy `notes` untouched
      notes: meeting.notes ?? '',
      updatedAt: new Date().toISOString(),
    },
  };
}

export function approveAiDecisionIntoMeeting(
  meeting: Meeting,
  input: { text: string; agendaItemId?: string; ownerName?: string }
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (isMinutesLocked(meeting)) {
    return {
      ok: false,
      reasonArabic: MINUTES_LOCKED_AI_EDIT_MESSAGE_AR,
    };
  }

  const cleanText = redactSensitiveAiText(input.text).slice(0, 500);
  if (cleanText.length < 3) {
    return {
      ok: false,
      reasonArabic: 'نص القرار قصير جداً لاعتماده في المحضر.',
    };
  }

  const existingDecisions = meeting.decisions || [];
  const norm = normalizeTaskTitle(cleanText);
  const alreadyExists = existingDecisions.some((d) => normalizeTaskTitle(d.text) === norm);
  if (alreadyExists) {
    return {
      ok: false,
      reasonArabic: 'يوجد قرار مطابق مسجل مسبقاً في هذا المحضر.',
    };
  }

  const nextDecisions = addDecisionToList(existingDecisions, {
    text: cleanText,
    agendaItemId: input.agendaItemId,
    ownerName: input.ownerName,
  });

  return {
    ok: true,
    meeting: {
      ...meeting,
      decisions: nextDecisions,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function applyAiFollowUpDateToMeeting(
  meeting: Meeting,
  dateOrDateTime: string
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (isMinutesLocked(meeting)) {
    return {
      ok: false,
      reasonArabic: MINUTES_LOCKED_AI_EDIT_MESSAGE_AR,
    };
  }

  const trimmed = (dateOrDateTime || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      reasonArabic: 'يرجى تحديد تاريخ متابعة صالح قبل الاعتماد.',
    };
  }

  const normalizedDateTime = isValidIsoDateOnly(trimmed) ? `${trimmed}T10:00` : trimmed.slice(0, 50);

  return {
    ok: true,
    meeting: {
      ...meeting,
      followUpDateTime: normalizedDateTime,
      isFollowUpScheduled: true,
      updatedAt: new Date().toISOString(),
    },
  };
}

export interface ApproveSuggestedTaskInput {
  id?: string;
  title: string;
  description?: string;
  ownerName?: string;
  dueDate?: string;
  priority?: TaskPriority;
}

export async function approveAiSuggestedTask(params: {
  candidate: ApproveSuggestedTaskInput;
  meeting: Meeting;
  existingTasks: ActionItem[];
  saveTaskFn: (task: ActionItem) => Promise<void> | void;
}): Promise<
  | { ok: true; task: ActionItem }
  | { ok: false; reasonArabic: string; isDuplicate?: boolean; duplicateTask?: ActionItem }
> {
  const { candidate, meeting, existingTasks, saveTaskFn } = params;
  const descriptionParts: string[] = [];
  if (candidate.description?.trim()) {
    descriptionParts.push(redactSensitiveAiText(candidate.description));
  }
  if (candidate.ownerName?.trim()) {
    const ownerTag = `المسؤول المقترح: ${redactSensitiveAiText(candidate.ownerName)}`;
    if (!descriptionParts.some((p) => p.includes(candidate.ownerName!.trim()))) {
      descriptionParts.push(ownerTag);
    }
  }

  const created = createLinkedMeetingTask(
    {
      meetingId: meeting.id,
      clientId: meeting.clientId,
      title: redactSensitiveAiText(candidate.title),
      description: descriptionParts.join(' — ') || undefined,
      dueDate: isValidIsoDateOnly(candidate.dueDate) ? candidate.dueDate : undefined,
      priority: normalizePriority(candidate.priority),
    },
    existingTasks
  );

  if (!created.ok) {
    return {
      ok: false,
      reasonArabic: created.reasonArabic,
      isDuplicate: Boolean(created.duplicateTask),
      duplicateTask: created.duplicateTask,
    };
  }

  try {
    await saveTaskFn(created.task);
    return { ok: true, task: created.task };
  } catch (err: any) {
    return {
      ok: false,
      reasonArabic:
        err?.message || 'تعذر حفظ المهمة على الخادم أو محلياً. يمكنك إعادة المحاولة لهذه المهمة فقط.',
    };
  }
}

export interface BatchTaskApprovalResult {
  succeededIds: string[];
  skippedDuplicateIds: string[];
  failedItems: { id: string; reasonArabic: string }[];
  createdTasks: ActionItem[];
}

export async function approveSuggestedTasksSequentially(params: {
  candidates: (ApproveSuggestedTaskInput & { id: string })[];
  meeting: Meeting;
  initialExistingTasks: ActionItem[];
  alreadyApprovedIds?: Set<string>;
  saveTaskFn: (task: ActionItem) => Promise<void> | void;
}): Promise<BatchTaskApprovalResult> {
  const { candidates, meeting, initialExistingTasks, alreadyApprovedIds, saveTaskFn } = params;
  const workingTasks = [...initialExistingTasks];
  const succeededIds: string[] = [];
  const skippedDuplicateIds: string[] = [];
  const failedItems: { id: string; reasonArabic: string }[] = [];
  const createdTasks: ActionItem[] = [];

  for (const candidate of candidates) {
    if (alreadyApprovedIds?.has(candidate.id)) {
      continue;
    }

    const res = await approveAiSuggestedTask({
      candidate,
      meeting,
      existingTasks: workingTasks,
      saveTaskFn,
    });

    if (res.ok) {
      succeededIds.push(candidate.id);
      createdTasks.push(res.task);
      workingTasks.unshift(res.task);
    } else if (res.isDuplicate) {
      skippedDuplicateIds.push(candidate.id);
    } else {
      failedItems.push({ id: candidate.id, reasonArabic: res.reasonArabic });
    }
  }

  return {
    succeededIds,
    skippedDuplicateIds,
    failedItems,
    createdTasks,
  };
}
