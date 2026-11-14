import type {
  ActionItem,
  Client,
  ClientContact,
  HighlightSegment,
  Meeting,
  Note,
  Opportunity,
  SearchCollectionsLoadedState,
  SearchExecutionResult,
  SearchFilterState,
  SearchMatchTier,
  SearchRecordType,
  SearchResultItem,
  TaskPriority,
} from '../types/index.ts';
import {
  OPPORTUNITY_STAGE_CONFIG,
  OPPORTUNITY_TYPE_LABELS,
  isOpportunityOpen,
} from './opportunities.ts';
import {
  calendarDaysDiff,
  extractZonedCalendarParts,
  resolveCalendarParts,
} from './followUpEngine.ts';

export const DEFAULT_SEARCH_FILTERS: SearchFilterState = {
  recordType: 'all',
  clientId: 'all',
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
  status: 'all',
  priority: 'all',
  tag: 'all',
  opportunityState: 'all',
};

export const MAX_SEARCH_RESULTS_DEFAULT = 60;

export const SEARCH_RECORD_TYPE_LABELS: Record<
  SearchRecordType,
  { ar: string; en: string }
> = {
  client: { ar: 'عميل', en: 'Client' },
  contact: { ar: 'جهة اتصال', en: 'Contact' },
  meeting: { ar: 'اجتماع', en: 'Meeting' },
  task: { ar: 'مهمة', en: 'Task' },
  note: { ar: 'ملاحظة', en: 'Note' },
  opportunity: { ar: 'فرصة عمل', en: 'Opportunity' },
};

const CLIENT_STATUS_LABELS_AR: Record<string, string> = {
  lead: 'عميل محتمل',
  initial_contact: 'تواصل أولي',
  active: 'نشط',
  follow_up_needed: 'يحتاج متابعة',
  inactive: 'غير نشط',
};

const MEETING_STATUS_LABELS_AR: Record<string, string> = {
  draft: 'مسودة',
  confirmed: 'مؤكد',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};

const TASK_STATUS_LABELS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const DIACRITICS_AND_TATWEEL_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Converts a single character to its normalized search equivalent.
 * Returns empty string if the character is a diacritic or tatweel to be stripped.
 */
function normalizeSingleChar(ch: string): string {
  const code = ch.charCodeAt(0);

  // Strip Arabic Tashkeel / Diacritics & Tatweel
  if (
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06ed) ||
    code === 0x0640
  ) {
    return '';
  }

  // Normalize Alef variants (أ إ آ ٱ -> ا)
  if (ch === 'أ' || ch === 'إ' || ch === 'آ' || ch === 'ٱ') {
    return 'ا';
  }

  // Normalize Teh Marbuta (ة -> ه) for search equivalence
  if (ch === 'ة') {
    return 'ه';
  }

  // Normalize Alef Maksura (ى -> ي)
  if (ch === 'ى' || ch === 'ئ') {
    return ch === 'ى' ? 'ي' : ch;
  }

  // Normalize Eastern Arabic-Indic digits (٠-٩) -> 0-9
  if (code >= 0x0660 && code <= 0x0669) {
    return String(code - 0x0660);
  }

  // Normalize Extended Arabic-Indic digits (۰-۹) -> 0-9
  if (code >= 0x06f0 && code <= 0x06f9) {
    return String(code - 0x06f0);
  }

  // Normalize whitespace to single space
  if (/\s/.test(ch)) {
    return ' ';
  }

  return ch.toLowerCase();
}

/**
 * Normalizes Arabic and English text for search comparison without mutating original stored text.
 * Handles:
 * - Alef variants (أ، إ، آ، ٱ -> ا)
 * - Teh Marbuta (ة -> ه)
 * - Alef Maksura (ى -> ي)
 * - Arabic diacritics/tashkeel removal
 * - Tatweel (ـ) removal
 * - Arabic-Indic & Extended Arabic-Indic numerals -> ASCII 0-9
 * - Lowercase & whitespace collapse
 */
export function normalizeArabicSearchText(input: string | undefined | null): string {
  if (!input) return '';
  const raw = String(input);
  let out = '';
  let prevWasSpace = true; // Leading spaces trimmed

  for (let i = 0; i < raw.length; i++) {
    const norm = normalizeSingleChar(raw[i]);
    if (!norm) continue;
    if (norm === ' ') {
      if (!prevWasSpace) {
        out += ' ';
        prevWasSpace = true;
      }
    } else {
      out += norm;
      prevWasSpace = false;
    }
  }

  return out.endsWith(' ') ? out.slice(0, -1) : out;
}

interface NormalizedWithMap {
  normalized: string;
  /** For each character index in `normalized`, stores [origStart, origEndExclusive] */
  charMap: Array<[number, number]>;
}

function normalizeWithIndexMap(original: string): NormalizedWithMap {
  let normalized = '';
  const charMap: Array<[number, number]> = [];
  let prevWasSpace = true;

  for (let i = 0; i < original.length; i++) {
    const norm = normalizeSingleChar(original[i]);
    if (!norm) {
      // Attach diacritic/tatweel span to previous mapped char if present
      if (charMap.length > 0 && !prevWasSpace) {
        charMap[charMap.length - 1][1] = i + 1;
      }
      continue;
    }
    if (norm === ' ') {
      if (!prevWasSpace) {
        normalized += ' ';
        charMap.push([i, i + 1]);
        prevWasSpace = true;
      } else if (charMap.length > 0) {
        charMap[charMap.length - 1][1] = i + 1;
      }
    } else {
      normalized += norm;
      charMap.push([i, i + 1]);
      prevWasSpace = false;
    }
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    charMap.pop();
  }

  return { normalized, charMap };
}

/**
 * Splits `originalText` into safe plain-text `{ text, matched }` segments for rendering
 * highlighted matches via React elements (`<mark>`) WITHOUT `dangerouslySetInnerHTML`.
 * Preserves original text (including diacritics, tatweel, and HTML-like characters as plain text).
 */
export function extractHighlightSegments(
  originalText: string,
  query: string
): HighlightSegment[] {
  const safeOriginal = String(originalText ?? '');
  if (!safeOriginal) return [];

  const normQuery = normalizeArabicSearchText(query);
  if (!normQuery) {
    return [{ text: safeOriginal, matched: false }];
  }

  const { normalized, charMap } = normalizeWithIndexMap(safeOriginal);
  if (!normalized) {
    return [{ text: safeOriginal, matched: false }];
  }

  const matchIdx = normalized.indexOf(normQuery);
  if (matchIdx === -1) {
    return [{ text: safeOriginal, matched: false }];
  }

  const matchEndIdx = matchIdx + normQuery.length - 1;
  const origStart = charMap[matchIdx][0];
  let origEnd = charMap[matchEndIdx][1];

  // Include any trailing combining marks / tashkeel immediately following the last matched char
  while (
    origEnd < safeOriginal.length &&
    DIACRITICS_AND_TATWEEL_REGEX.test(safeOriginal[origEnd])
  ) {
    DIACRITICS_AND_TATWEEL_REGEX.lastIndex = 0;
    origEnd++;
  }
  DIACRITICS_AND_TATWEEL_REGEX.lastIndex = 0;

  const segments: HighlightSegment[] = [];
  if (origStart > 0) {
    segments.push({ text: safeOriginal.slice(0, origStart), matched: false });
  }
  segments.push({
    text: safeOriginal.slice(origStart, origEnd),
    matched: true,
  });
  if (origEnd < safeOriginal.length) {
    segments.push({ text: safeOriginal.slice(origEnd), matched: false });
  }

  return segments;
}

/**
 * Builds a concise context snippet around the matched query within a potentially long text.
 */
export function buildMatchedSnippet(
  originalText: string,
  query: string,
  maxLength = 130
): string {
  const clean = String(originalText ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;

  const normQuery = normalizeArabicSearchText(query);
  if (!normQuery) {
    return `${clean.slice(0, maxLength)}…`;
  }

  const { normalized, charMap } = normalizeWithIndexMap(clean);
  const idx = normalized.indexOf(normQuery);
  if (idx === -1) {
    return `${clean.slice(0, maxLength)}…`;
  }

  const origStart = charMap[idx][0];
  const halfWindow = Math.max(20, Math.floor((maxLength - normQuery.length) / 2));
  const sliceStart = Math.max(0, origStart - halfWindow);
  const sliceEnd = Math.min(clean.length, sliceStart + maxLength);

  const prefix = sliceStart > 0 ? '…' : '';
  const suffix = sliceEnd < clean.length ? '…' : '';
  return `${prefix}${clean.slice(sliceStart, sliceEnd).trim()}${suffix}`;
}

export interface SearchFieldCandidate {
  labelAr: string;
  value: string;
  normalized: string;
  isPrimary: boolean;
}

export interface SearchableIndexEntry {
  id: string;
  recordType: SearchRecordType;
  title: string;
  NormalizedTitle: string;
  subtitle?: string;
  defaultSnippet: string;
  clientId?: string;
  clientName?: string;
  dateIso?: string;
  statusKey?: string;
  statusLabelAr?: string;
  priority?: TaskPriority;
  tags: string[];
  normalizedTags: string[];
  opportunityStage?: Opportunity['stage'];
  isOpenOpportunity?: boolean;
  fields: SearchFieldCandidate[];
  clientRef?: Client;
  contactRef?: ClientContact;
  meetingRef?: Meeting;
  taskRef?: ActionItem;
  noteRef?: Note;
  opportunityRef?: Opportunity;
}

export interface SearchDataInput {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities?: Opportunity[];
  currentUserId?: string;
}

function isOwnedByCurrentUser(
  recordUserId: string | undefined,
  currentUserId: string | undefined
): boolean {
  if (!currentUserId) return true;
  if (!recordUserId) return true;
  return recordUserId === currentUserId;
}

function addCandidate(
  list: SearchFieldCandidate[],
  labelAr: string,
  rawValue: string | undefined | null,
  isPrimary = false
) {
  if (!rawValue) return;
  const trimmed = String(rawValue).trim();
  if (!trimmed) return;
  const normalized = normalizeArabicSearchText(trimmed);
  if (!normalized) return;
  list.push({
    labelAr,
    value: trimmed,
    normalized,
    isPrimary,
  });
}

/**
 * Builds a memoizable in-memory search index from the active user's loaded collections.
 * Enforces strict user isolation if `currentUserId` is supplied.
 */
export function buildSearchIndex(data: SearchDataInput): SearchableIndexEntry[] {
  const entries: SearchableIndexEntry[] = [];
  const currentUserId = data.currentUserId;

  const ownedClients = (data.clients || []).filter((c) =>
    isOwnedByCurrentUser(c.userId, currentUserId)
  );
  const clientMap = new Map<string, Client>();
  for (const c of ownedClients) {
    clientMap.set(c.id, c);
  }

  const ownedOpportunities = (data.opportunities || []).filter((o) =>
    isOwnedByCurrentUser(o.userId, currentUserId)
  );
  const opportunityMap = new Map<string, Opportunity>();
  for (const o of ownedOpportunities) {
    opportunityMap.set(o.id, o);
  }

  // 1. Index Clients & their embedded Contacts
  for (const client of ownedClients) {
    const fields: SearchFieldCandidate[] = [];
    addCandidate(fields, 'اسم العميل', client.name, true);
    addCandidate(fields, 'الشركة', client.company, false);
    addCandidate(fields, 'القطاع', client.industry, false);
    addCandidate(fields, 'الهاتف', client.phone, false);
    addCandidate(fields, 'البريد الإلكتروني', client.email, false);
    addCandidate(fields, 'العنوان', client.address, false);
    addCandidate(fields, 'الموقع الإلكتروني', client.website, false);
    addCandidate(fields, 'ملاحظات العميل', client.notes, false);
    addCandidate(fields, 'وصف العميل', client.description, false);

    const clientTags = Array.isArray(client.tags) ? client.tags.filter(Boolean) : [];
    for (const tag of clientTags) {
      addCandidate(fields, 'وسم', tag, false);
    }

    const contacts = Array.isArray(client.contacts) ? client.contacts : [];
    for (const contact of contacts) {
      addCandidate(fields, 'جهة اتصال مرتبطة', contact.name, false);
      addCandidate(fields, 'منصب جهة الاتصال', contact.title, false);
      addCandidate(fields, 'قسم جهة الاتصال', contact.department, false);
      addCandidate(fields, 'هاتف جهة الاتصال', contact.phone, false);
      addCandidate(fields, 'بريد جهة الاتصال', contact.email, false);
      addCandidate(fields, 'ملاحظات جهة الاتصال', contact.notes, false);
    }

    const statusKey = client.relationshipStatus || 'active';
    const statusLabelAr = CLIENT_STATUS_LABELS_AR[statusKey] || statusKey;
    const mappedPriority: TaskPriority | undefined =
      client.importance === 'high'
        ? 'high'
        : client.importance === 'medium'
        ? 'medium'
        : client.importance === 'low'
        ? 'low'
        : undefined;

    entries.push({
      id: `client:${client.id}`,
      recordType: 'client',
      title: client.name,
      NormalizedTitle: normalizeArabicSearchText(client.name),
      subtitle: [client.company, client.industry].filter(Boolean).join(' • ') || undefined,
      defaultSnippet:
        client.company ||
        client.industry ||
        client.phone ||
        client.email ||
        client.notes ||
        'ملف عميل 360',
      clientId: client.id,
      clientName: client.name,
      dateIso: client.updatedAt || client.createdAt,
      statusKey,
      statusLabelAr,
      priority: mappedPriority,
      tags: clientTags,
      normalizedTags: clientTags.map((t) => normalizeArabicSearchText(t)),
      fields,
      clientRef: client,
    });

    // Also index each Contact as a first-class searchable 'contact' record
    for (const contact of contacts) {
      if (!contact || !contact.name) continue;
      const contactFields: SearchFieldCandidate[] = [];
      addCandidate(contactFields, 'اسم جهة الاتصال', contact.name, true);
      addCandidate(contactFields, 'المنصب', contact.title, false);
      addCandidate(contactFields, 'القسم / الإدارة', contact.department, false);
      addCandidate(contactFields, 'الهاتف', contact.phone, false);
      addCandidate(contactFields, 'البريد الإلكتروني', contact.email, false);
      addCandidate(contactFields, 'ملاحظات جهة الاتصال', contact.notes, false);
      addCandidate(contactFields, 'العميل المرتبط', client.name, false);
      addCandidate(contactFields, 'الشركة', client.company, false);

      entries.push({
        id: `contact:${client.id}:${contact.id}`,
        recordType: 'contact',
        title: contact.name,
        NormalizedTitle: normalizeArabicSearchText(contact.name),
        subtitle: [contact.title, contact.department, client.name]
          .filter(Boolean)
          .join(' • '),
        defaultSnippet:
          [contact.title, contact.department, contact.phone, contact.email]
            .filter(Boolean)
            .join(' — ') || `جهة اتصال لدى ${client.name}`,
        clientId: client.id,
        clientName: client.name,
        dateIso: contact.updatedAt || contact.createdAt || client.updatedAt || client.createdAt,
        statusKey: contact.isPrimary ? 'primary' : 'secondary',
        statusLabelAr: contact.isPrimary ? 'جهة اتصال رئيسية' : 'جهة اتصال',
        priority: mappedPriority,
        tags: clientTags,
        normalizedTags: clientTags.map((t) => normalizeArabicSearchText(t)),
        fields: contactFields,
        clientRef: client,
        contactRef: contact,
      });
    }
  }

  // 2. Index Meetings (strictly metadata & structured minutes, never B2 attachment files)
  const ownedMeetings = (data.meetings || []).filter((m) =>
    isOwnedByCurrentUser(m.userId, currentUserId)
  );
  for (const meeting of ownedMeetings) {
    const client = clientMap.get(meeting.clientId);
    const clientName = client?.name;
    const fields: SearchFieldCandidate[] = [];

    addCandidate(fields, 'عنوان الاجتماع', meeting.title, true);
    addCandidate(fields, 'ملاحظات الاجتماع', meeting.notes, false);
    addCandidate(fields, 'ملخص النقاش', meeting.discussionSummary, false);
    addCandidate(fields, 'ملاحظات إضافية للمحضر', meeting.minutesAdditionalNotes, false);
    addCandidate(fields, 'الموقع', meeting.location, false);
    addCandidate(fields, 'العميل المرتبط', clientName, false);

    if (Array.isArray(meeting.agendaItems)) {
      for (const item of meeting.agendaItems) {
        addCandidate(fields, 'بند جدول الأعمال', item.title, false);
        addCandidate(fields, 'ملاحظات جدول الأعمال', item.notes, false);
      }
    }

    if (Array.isArray(meeting.decisions)) {
      for (const dec of meeting.decisions) {
        addCandidate(fields, 'قرار معتمد', dec.text, false);
        addCandidate(fields, 'مسؤول القرار', dec.ownerName, false);
      }
    }

    if (Array.isArray(meeting.participants)) {
      for (const part of meeting.participants) {
        addCandidate(fields, 'مشارك في الاجتماع', part.name, false);
        addCandidate(fields, 'دور المشارك', part.role, false);
      }
    }

    const clientTags = client?.tags || [];
    const statusLabelAr = MEETING_STATUS_LABELS_AR[meeting.status] || meeting.status;

    entries.push({
      id: `meeting:${meeting.id}`,
      recordType: 'meeting',
      title: meeting.title,
      NormalizedTitle: normalizeArabicSearchText(meeting.title),
      subtitle: clientName,
      defaultSnippet:
        meeting.discussionSummary ||
        meeting.notes ||
        meeting.minutesAdditionalNotes ||
        meeting.location ||
        'لقاء مسجل',
      clientId: meeting.clientId,
      clientName,
      dateIso: meeting.dateTime || meeting.updatedAt || meeting.createdAt,
      statusKey: meeting.status,
      statusLabelAr,
      tags: clientTags,
      normalizedTags: clientTags.map((t) => normalizeArabicSearchText(t)),
      fields,
      clientRef: client,
      meetingRef: meeting,
    });
  }

  // 3. Index Tasks
  const ownedTasks = (data.tasks || []).filter((t) =>
    isOwnedByCurrentUser(t.userId, currentUserId)
  );
  for (const task of ownedTasks) {
    const client = clientMap.get(task.clientId);
    const clientName = client?.name;
    const linkedOpp = task.opportunityId ? opportunityMap.get(task.opportunityId) : undefined;
    const fields: SearchFieldCandidate[] = [];

    addCandidate(fields, 'عنوان المهمة', task.title, true);
    addCandidate(fields, 'وصف المهمة', task.description, false);
    addCandidate(fields, 'العميل المرتبط', clientName, false);
    addCandidate(fields, 'الفرصة المرتبطة', linkedOpp?.title, false);

    const clientTags = client?.tags || [];
    const statusLabelAr = TASK_STATUS_LABELS_AR[task.status] || task.status;

    entries.push({
      id: `task:${task.id}`,
      recordType: 'task',
      title: task.title,
      NormalizedTitle: normalizeArabicSearchText(task.title),
      subtitle: [clientName, linkedOpp?.title].filter(Boolean).join(' • ') || undefined,
      defaultSnippet:
        task.description ||
        (linkedOpp ? `مرتبطة بفرصة: ${linkedOpp.title}` : '') ||
        (clientName ? `مهمة خاصة بـ ${clientName}` : 'مهمة متابعة'),
      clientId: task.clientId,
      clientName,
      dateIso: task.dueDate || task.createdAt,
      statusKey: task.status,
      statusLabelAr,
      priority: task.priority,
      tags: clientTags,
      normalizedTags: clientTags.map((t) => normalizeArabicSearchText(t)),
      fields,
      clientRef: client,
      taskRef: task,
      opportunityRef: linkedOpp,
    });
  }

  // 4. Index Notes
  const ownedNotes = (data.notes || []).filter((n) =>
    isOwnedByCurrentUser(n.userId, currentUserId)
  );
  for (const note of ownedNotes) {
    const client = note.clientId ? clientMap.get(note.clientId) : undefined;
    const clientName = client?.name;
    const fields: SearchFieldCandidate[] = [];

    addCandidate(fields, 'عنوان الملاحظة', note.title, true);
    addCandidate(fields, 'محتوى الملاحظة', note.content, false);
    addCandidate(fields, 'العميل المرتبط', clientName, false);

    const noteTags = Array.isArray(note.tags) ? note.tags.filter(Boolean) : [];
    for (const tag of noteTags) {
      addCandidate(fields, 'وسم الملاحظة', tag, false);
    }

    entries.push({
      id: `note:${note.id}`,
      recordType: 'note',
      title: note.title,
      NormalizedTitle: normalizeArabicSearchText(note.title),
      subtitle: clientName,
      defaultSnippet: note.content || 'ملاحظة مسجلة',
      clientId: note.clientId,
      clientName,
      dateIso: note.updatedAt || note.createdAt,
      statusKey: note.isPinned ? 'pinned' : 'normal',
      statusLabelAr: note.isPinned ? 'مثبتة' : 'ملاحظة',
      tags: noteTags,
      normalizedTags: noteTags.map((t) => normalizeArabicSearchText(t)),
      fields,
      clientRef: client,
      noteRef: note,
    });
  }

  // 5. Index Opportunities
  for (const opp of ownedOpportunities) {
    const client = clientMap.get(opp.clientId);
    const clientName = client?.name;
    const stageMeta = OPPORTUNITY_STAGE_CONFIG[opp.stage];
    const typeMeta = OPPORTUNITY_TYPE_LABELS[opp.type];
    const fields: SearchFieldCandidate[] = [];

    addCandidate(fields, 'عنوان الفرصة', opp.title, true);
    addCandidate(fields, 'وصف الفرصة', opp.description, false);
    addCandidate(fields, 'العميل المرتبط', clientName, false);
    addCandidate(fields, 'الإجراء القادم', opp.nextAction, false);
    addCandidate(fields, 'نوع الفرصة', typeMeta?.ar || opp.type, false);
    addCandidate(fields, 'نوع الفرصة (EN)', typeMeta?.en || opp.type, false);
    addCandidate(fields, 'مرحلة الفرصة', stageMeta?.labelAr || opp.stage, false);
    addCandidate(fields, 'مرحلة الفرصة (EN)', stageMeta?.labelEn || opp.stage, false);
    addCandidate(fields, 'مصدر الفرصة', opp.source, false);
    addCandidate(fields, 'سبب الخسارة', opp.lostReason, false);

    const clientTags = client?.tags || [];

    entries.push({
      id: `opportunity:${opp.id}`,
      recordType: 'opportunity',
      title: opp.title,
      NormalizedTitle: normalizeArabicSearchText(opp.title),
      subtitle: clientName,
      defaultSnippet:
        opp.nextAction
          ? `الإجراء القادم: ${opp.nextAction}`
          : opp.description || stageMeta?.labelAr || 'فرصة أعمال',
      clientId: opp.clientId,
      clientName,
      dateIso: opp.nextActionDate || opp.expectedCloseDate || opp.updatedAt || opp.createdAt,
      statusKey: opp.stage,
      statusLabelAr: stageMeta?.labelAr || opp.stage,
      priority: opp.priority,
      tags: clientTags,
      normalizedTags: clientTags.map((t) => normalizeArabicSearchText(t)),
      opportunityStage: opp.stage,
      isOpenOpportunity: isOpportunityOpen(opp.stage),
      fields,
      clientRef: client,
      opportunityRef: opp,
    });
  }

  return entries;
}

/**
 * Evaluates how strongly a normalized query matches an index entry, following the
 * deterministic 5-tier ranking order:
 * 1. exact (primary title === query)
 * 2. prefix (primary title startsWith query)
 * 3. word (word in primary title equals or startsWith query, or exact secondary field)
 * 4. partial (primary title contains query substring)
 * 5. related (secondary/related field contains query substring)
 */
export function evaluateEntryMatch(
  entry: SearchableIndexEntry,
  normQuery: string
): {
  matched: boolean;
  tier: SearchMatchTier;
  score: number;
  matchedFieldLabelAr: string;
  matchedValue: string;
} | null {
  if (!normQuery) {
    return {
      matched: true,
      tier: 'filter_only',
      score: 100,
      matchedFieldLabelAr: SEARCH_RECORD_TYPE_LABELS[entry.recordType].ar,
      matchedValue: entry.defaultSnippet,
    };
  }

  const primaryField = entry.fields.find((f) => f.isPrimary);
  const normTitle = primaryField ? primaryField.normalized : entry.NormalizedTitle;
  const primaryLabel = primaryField ? primaryField.labelAr : 'العنوان';
  const primaryVal = primaryField ? primaryField.value : entry.title;

  if (normTitle) {
    // 1. Exact Match on primary title
    if (normTitle === normQuery) {
      return {
        matched: true,
        tier: 'exact',
        score: 1000,
        matchedFieldLabelAr: primaryLabel,
        matchedValue: primaryVal,
      };
    }

    // 2. Prefix / starts-with Match on primary title
    if (normTitle.startsWith(normQuery)) {
      const lengthBonus = Math.max(0, 50 - Math.min(50, normTitle.length - normQuery.length));
      return {
        matched: true,
        tier: 'prefix',
        score: 800 + lengthBonus,
        matchedFieldLabelAr: primaryLabel,
        matchedValue: primaryVal,
      };
    }

    // 3. Word-boundary Match on primary title
    const words = normTitle.split(' ');
    const exactWordIdx = words.findIndex((w) => w === normQuery);
    if (exactWordIdx !== -1) {
      return {
        matched: true,
        tier: 'word',
        score: 650 - Math.min(40, exactWordIdx * 5),
        matchedFieldLabelAr: primaryLabel,
        matchedValue: primaryVal,
      };
    }

    const prefixWordIdx = words.findIndex((w) => w.startsWith(normQuery));
    if (prefixWordIdx !== -1) {
      return {
        matched: true,
        tier: 'word',
        score: 600 - Math.min(40, prefixWordIdx * 5),
        matchedFieldLabelAr: primaryLabel,
        matchedValue: primaryVal,
      };
    }

    // 4. Partial substring Match on primary title
    const subIdx = normTitle.indexOf(normQuery);
    if (subIdx !== -1) {
      return {
        matched: true,
        tier: 'partial',
        score: 400 - Math.min(50, subIdx),
        matchedFieldLabelAr: primaryLabel,
        matchedValue: primaryVal,
      };
    }
  }

  // 5. Secondary / Related Field Match
  let bestSecondary: {
    score: number;
    labelAr: string;
    value: string;
  } | null = null;

  for (const field of entry.fields) {
    if (field.isPrimary) continue;
    const nf = field.normalized;
    if (!nf) continue;

    let candidateScore = 0;
    if (nf === normQuery) {
      candidateScore = 290;
    } else if (nf.startsWith(normQuery)) {
      candidateScore = 260;
    } else {
      const words = nf.split(' ');
      if (words.some((w) => w === normQuery || w.startsWith(normQuery))) {
        candidateScore = 235;
      } else if (nf.includes(normQuery)) {
        candidateScore = 200;
      }
    }

    if (candidateScore > 0 && (!bestSecondary || candidateScore > bestSecondary.score)) {
      bestSecondary = {
        score: candidateScore,
        labelAr: field.labelAr,
        value: field.value,
      };
    }
  }

  if (bestSecondary) {
    return {
      matched: true,
      tier: 'related',
      score: bestSecondary.score,
      matchedFieldLabelAr: bestSecondary.labelAr,
      matchedValue: bestSecondary.value,
    };
  }

  return null;
}

export function countActiveSearchFilters(filters: Partial<SearchFilterState> | undefined): number {
  if (!filters) return 0;
  let count = 0;
  if (filters.recordType && filters.recordType !== 'all') count++;
  if (filters.clientId && filters.clientId !== 'all') count++;
  if (filters.datePreset && filters.datePreset !== 'all') {
    if (filters.datePreset === 'custom') {
      if (filters.dateFrom || filters.dateTo) count++;
    } else {
      count++;
    }
  }
  if (filters.status && filters.status !== 'all') count++;
  if (filters.priority && filters.priority !== 'all') count++;
  if (filters.tag && filters.tag !== 'all') count++;
  if (filters.opportunityState && filters.opportunityState !== 'all') count++;
  return count;
}

function matchesDateFilter(
  dateIso: string | undefined,
  filters: SearchFilterState,
  referenceDate: Date,
  timeZone?: string
): boolean {
  if (!filters.datePreset || filters.datePreset === 'all') return true;
  if (!dateIso) return false;

  const targetParts = resolveCalendarParts(dateIso, timeZone);
  if (!targetParts) return false;
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);
  const diffDays = calendarDaysDiff(targetParts, refParts); // target - ref

  if (filters.datePreset === 'today') {
    return diffDays === 0;
  }
  if (filters.datePreset === '7d') {
    return Math.abs(diffDays) <= 7;
  }
  if (filters.datePreset === '30d') {
    return Math.abs(diffDays) <= 30;
  }
  if (filters.datePreset === '90d') {
    return Math.abs(diffDays) <= 90;
  }
  if (filters.datePreset === 'custom') {
    if (!filters.dateFrom && !filters.dateTo) return true;
    const itemYmd = `${String(targetParts.year).padStart(4, '0')}-${String(
      targetParts.month
    ).padStart(2, '0')}-${String(targetParts.day).padStart(2, '0')}`;
    if (filters.dateFrom && itemYmd < filters.dateFrom) return false;
    if (filters.dateTo && itemYmd > filters.dateTo) return false;
    return true;
  }
  return true;
}

function matchesEntryFilters(
  entry: SearchableIndexEntry,
  filters: SearchFilterState,
  referenceDate: Date,
  timeZone?: string
): boolean {
  // 1. Record Type
  if (filters.recordType !== 'all' && entry.recordType !== filters.recordType) {
    return false;
  }

  // 2. Client Filter
  if (filters.clientId !== 'all' && entry.clientId !== filters.clientId) {
    return false;
  }

  // 3. Status Filter
  if (filters.status !== 'all') {
    if (entry.statusKey !== filters.status) {
      return false;
    }
  }

  // 4. Priority Filter
  if (filters.priority !== 'all') {
    if (!entry.priority || entry.priority !== filters.priority) {
      return false;
    }
  }

  // 5. Tag Filter
  if (filters.tag !== 'all') {
    const normFilterTag = normalizeArabicSearchText(filters.tag);
    if (!entry.normalizedTags.some((t) => t === normFilterTag)) {
      return false;
    }
  }

  // 6. Opportunity State (Open / Closed / Won / Lost)
  if (filters.opportunityState !== 'all') {
    if (entry.recordType !== 'opportunity') {
      return false;
    }
    if (filters.opportunityState === 'open' && !entry.isOpenOpportunity) {
      return false;
    }
    if (filters.opportunityState === 'closed' && entry.isOpenOpportunity) {
      return false;
    }
    if (filters.opportunityState === 'won' && entry.opportunityStage !== 'won') {
      return false;
    }
    if (filters.opportunityState === 'lost' && entry.opportunityStage !== 'lost') {
      return false;
    }
  }

  // 7. Date Range Filter
  if (!matchesDateFilter(entry.dateIso, filters, referenceDate, timeZone)) {
    return false;
  }

  return true;
}

export interface ExecuteUniversalSearchParams {
  query: string;
  index?: SearchableIndexEntry[];
  data?: SearchDataInput;
  filters?: Partial<SearchFilterState>;
  collectionsLoaded?: Partial<SearchCollectionsLoadedState>;
  limit?: number;
  referenceDate?: Date;
  timeZone?: string;
}

const COLLECTION_LABELS_AR: Record<keyof SearchCollectionsLoadedState, string> = {
  clients: 'العملاء وجهات الاتصال',
  meetings: 'الاجتماعات',
  tasks: 'المهام',
  notes: 'الملاحظات',
  opportunities: 'فرص الأعمال',
};

/**
 * Executes a deterministic, normalized, filtered search over the user's in-memory index.
 */
export function executeUniversalSearch(
  params: ExecuteUniversalSearchParams
): SearchExecutionResult {
  const mergedFilters: SearchFilterState = {
    ...DEFAULT_SEARCH_FILTERS,
    ...(params.filters || {}),
  };
  const activeFilterCount = countActiveSearchFilters(mergedFilters);
  const normQuery = normalizeArabicSearchText(params.query);
  const limit = params.limit ?? MAX_SEARCH_RESULTS_DEFAULT;
  const referenceDate = params.referenceDate ?? new Date();

  const incompleteCollectionsAr: string[] = [];
  if (params.collectionsLoaded) {
    (Object.keys(COLLECTION_LABELS_AR) as Array<keyof SearchCollectionsLoadedState>).forEach(
      (key) => {
        if (params.collectionsLoaded?.[key] === false) {
          incompleteCollectionsAr.push(COLLECTION_LABELS_AR[key]);
        }
      }
    );
  }
  const isDataIncomplete = incompleteCollectionsAr.length > 0;

  const emptyGrouped: Record<SearchRecordType, SearchResultItem[]> = {
    client: [],
    contact: [],
    meeting: [],
    task: [],
    note: [],
    opportunity: [],
  };

  // If neither query nor filter is active, return empty state immediately
  if (!normQuery && activeFilterCount === 0) {
    return {
      items: [],
      grouped: emptyGrouped,
      totalMatched: 0,
      returnedCount: 0,
      truncated: false,
      isDataIncomplete,
      incompleteCollectionsAr,
      activeFilterCount: 0,
    };
  }

  const index =
    params.index ??
    buildSearchIndex(
      params.data || {
        clients: [],
        meetings: [],
        tasks: [],
        notes: [],
        opportunities: [],
      }
    );

  const matchedItems: SearchResultItem[] = [];

  for (const entry of index) {
    if (!matchesEntryFilters(entry, mergedFilters, referenceDate, params.timeZone)) {
      continue;
    }

    const evalRes = evaluateEntryMatch(entry, normQuery);
    if (!evalRes || !evalRes.matched) {
      continue;
    }

    const snippetSource =
      evalRes.tier === 'related' ? evalRes.matchedValue : entry.defaultSnippet;
    const snippet = buildMatchedSnippet(snippetSource, params.query);

    matchedItems.push({
      id: entry.id,
      recordType: entry.recordType,
      recordTypeLabelAr: SEARCH_RECORD_TYPE_LABELS[entry.recordType].ar,
      recordTypeLabelEn: SEARCH_RECORD_TYPE_LABELS[entry.recordType].en,
      title: entry.title,
      subtitle: entry.subtitle,
      snippet,
      matchedFieldLabelAr: evalRes.matchedFieldLabelAr,
      matchTier: evalRes.tier,
      score: evalRes.score,
      clientId: entry.clientId,
      clientName: entry.clientName,
      dateIso: entry.dateIso,
      statusLabelAr: entry.statusLabelAr,
      priority: entry.priority,
      tags: entry.tags,
      clientRef: entry.clientRef,
      contactRef: entry.contactRef,
      meetingRef: entry.meetingRef,
      taskRef: entry.taskRef,
      noteRef: entry.noteRef,
      opportunityRef: entry.opportunityRef,
    });
  }

  // Deterministic sort:
  // 1. Score descending
  // 2. Date descending (when available)
  // 3. Title alphabetical
  // 4. ID ascending
  matchedItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const timeA = a.dateIso ? new Date(a.dateIso).getTime() : 0;
    const timeB = b.dateIso ? new Date(b.dateIso).getTime() : 0;
    const safeA = Number.isNaN(timeA) ? 0 : timeA;
    const safeB = Number.isNaN(timeB) ? 0 : timeB;
    if (safeB !== safeA) return safeB - safeA;
    const titleCmp = a.title.localeCompare(b.title, 'ar');
    if (titleCmp !== 0) return titleCmp;
    return a.id.localeCompare(b.id);
  });

  const totalMatched = matchedItems.length;
  const truncated = totalMatched > limit;
  const limitedItems = truncated ? matchedItems.slice(0, limit) : matchedItems;

  const grouped: Record<SearchRecordType, SearchResultItem[]> = {
    client: [],
    contact: [],
    meeting: [],
    task: [],
    note: [],
    opportunity: [],
  };

  for (const item of limitedItems) {
    grouped[item.recordType].push(item);
  }

  return {
    items: limitedItems,
    grouped,
    totalMatched,
    returnedCount: limitedItems.length,
    truncated,
    isDataIncomplete,
    incompleteCollectionsAr,
    activeFilterCount,
  };
}

/**
 * Extracts all unique tags across the user's clients and notes for the Smart Filter dropdown.
 */
export function extractAvailableSearchTags(data: {
  clients: Client[];
  notes: Note[];
  currentUserId?: string;
}): string[] {
  const tagMap = new Map<string, string>();

  for (const client of data.clients || []) {
    if (!isOwnedByCurrentUser(client.userId, data.currentUserId)) continue;
    for (const tag of client.tags || []) {
      const trimmed = String(tag || '').trim();
      if (!trimmed) continue;
      const norm = normalizeArabicSearchText(trimmed);
      if (norm && !tagMap.has(norm)) {
        tagMap.set(norm, trimmed);
      }
    }
  }

  for (const note of data.notes || []) {
    if (!isOwnedByCurrentUser(note.userId, data.currentUserId)) continue;
    for (const tag of note.tags || []) {
      const trimmed = String(tag || '').trim();
      if (!trimmed) continue;
      const norm = normalizeArabicSearchText(trimmed);
      if (norm && !tagMap.has(norm)) {
        tagMap.set(norm, trimmed);
      }
    }
  }

  return Array.from(tagMap.values()).sort((a, b) => a.localeCompare(b, 'ar'));
}
