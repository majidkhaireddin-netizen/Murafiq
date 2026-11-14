import type {
  ActionItem,
  Client,
  ClientContact,
  CsvExportEntityType,
  ExportCompletenessMeta,
  ImportCollectionExecutionReport,
  ImportExecutionReport,
  ImportPreviewResult,
  ImportValidationIssue,
  Meeting,
  MeetingAgendaItem,
  MeetingDecision,
  MeetingParticipant,
  MinutesSectionKey,
  MurafiqExportBundleV1,
  Note,
  Opportunity,
  OpportunityCurrency,
  OpportunityStage,
  OpportunityStageEvent,
  OpportunityStageEventType,
  OpportunityType,
  SanitizedImportBatch,
  TaskPriority,
  TaskStatus,
} from '../types/index.ts';
import {
  OPPORTUNITY_STAGE_CONFIG,
  OPPORTUNITY_TYPE_LABELS,
  isOpportunityOpen,
} from './opportunities.ts';
import { normalizeArabicSearchText } from './searchEngine.ts';

export const MURAFIQ_EXPORT_SCHEMA_VERSION = 'murafiq-export-v1' as const;
export const LEGACY_PROTOTYPE_SCHEMA_VERSION = '1.0.0-prototype' as const;

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export const EXPORT_ATTACHMENT_DISCLOSURE_AR =
  'يتضمن هذا التصدير بيانات التطبيق المدعومة فقط، ولا يتضمن ملفات المرفقات المخزنة في Backblaze B2.';

export const EXPORT_SECURITY_DISCLOSURE_AR =
  'تنبيه أمني: ملفات التصدير (JSON / CSV) غير مشفرة تلقائياً وتحتوي على بيانات أعمالك النصية. احفظها في مكان آمن ولا تشاركها عبر قنوات غير موثوقة.';

export const COMPLETE_ONLINE_EXPORT_DISCLOSURE_AR =
  'تم إنشاء هذا التصدير أثناء الاتصال بالإنترنت بعد اكتمال تحميل المجموعات المدعومة لحسابك.';

export const PARTIAL_OR_OFFLINE_EXPORT_DISCLOSURE_AR =
  'تنبيه: تم إنشاء هذا التصدير في وضع عدم الاتصال أو قبل اكتمال مزامنة جميع المجموعات، لذا فهو يمثل البيانات المتاحة محلياً حالياً ولا يُعد نسخة احتياطية سحابية كاملة.';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FORBIDDEN_SECRET_AND_INTERNAL_KEYS = new Set([
  'idToken',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'secretKey',
  'privateKey',
  'applicationKey',
  'applicationKeyId',
  'presignedUrl',
  'downloadUrl',
  'uploadUrl',
  'storageKey',
  'storageProvider',
  'uploadIntents',
  '_meetingGuard',
  'attachments',
]);

// Allowed field whitelists matching firestore.rules
const CLIENT_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'name',
  'company',
  'phone',
  'email',
  'notes',
  'avatarPath',
  'color',
  'isFavorite',
  'industry',
  'category',
  'relationshipStatus',
  'importance',
  'tags',
  'website',
  'address',
  'source',
  'description',
  'contacts',
  'createdAt',
  'updatedAt',
]);

const MEETING_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'clientId',
  'title',
  'dateTime',
  'duration',
  'type',
  'location',
  'notes',
  'status',
  'photoPaths',
  'isFollowUpScheduled',
  'attendees',
  'participants',
  'agendaItems',
  'discussionSummary',
  'decisions',
  'followUpDateTime',
  'minutesStatus',
  'minutesStatusUpdatedAt',
  'minutesIncludedSections',
  'minutesAdditionalNotes',
  'appliedTemplateId',
  'opportunityId',
  'createdAt',
  'updatedAt',
]);

const TASK_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'meetingId',
  'clientId',
  'opportunityId',
  'title',
  'description',
  'dueDate',
  'priority',
  'status',
  'reminderDate',
  'completedAt',
  'provenance',
  'createdAt',
]);

const NOTE_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'clientId',
  'title',
  'content',
  'tags',
  'isPinned',
  'color',
  'createdAt',
  'updatedAt',
]);

const OPPORTUNITY_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'clientId',
  'title',
  'description',
  'type',
  'stage',
  'priority',
  'estimatedValue',
  'currency',
  'expectedCloseDate',
  'nextAction',
  'nextActionDate',
  'source',
  'lostReason',
  'closedAt',
  'reopenedAt',
  'createdAt',
  'updatedAt',
]);

const STAGE_EVENT_ALLOWED_KEYS = new Set([
  'id',
  'userId',
  'opportunityId',
  'eventType',
  'fromStage',
  'toStage',
  'note',
  'occurredAt',
]);

export function isValidFirestoreId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

/**
 * Recursively strips forbidden secret/internal keys and undefined values from an object.
 */
export function stripSecretsAndInternalFields<T>(input: T): T {
  if (input === null || input === undefined || typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripSecretsAndInternalFields(item)) as unknown as T;
  }
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input as Record<string, any>)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
    if (FORBIDDEN_SECRET_AND_INTERNAL_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = stripSecretsAndInternalFields(value);
  }
  return out as T;
}

export interface BuildExportBundleParams {
  currentUserId: string;
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities: Opportunity[];
  opportunityStageEvents: OpportunityStageEvent[];
  isOnline?: boolean;
  collectionsLoaded?: {
    clients?: boolean;
    meetings?: boolean;
    tasks?: boolean;
    notes?: boolean;
    opportunities?: boolean;
    opportunityStageEvents?: boolean;
  };
  hasPendingLocalWrites?: boolean;
  exportedAt?: string;
}

const EXPORT_COLLECTION_LABELS_AR: Record<string, string> = {
  clients: 'العملاء',
  meetings: 'الاجتماعات',
  tasks: 'المهام',
  notes: 'الملاحظات',
  opportunities: 'فرص الأعمال',
  opportunityStageEvents: 'سجل مراحل الفرص',
};

/**
 * Builds a structured, sanitized `murafiq-export-v1` JSON export bundle for the current user.
 * Never includes foreign user records, secrets, tokens, or Backblaze B2 storage keys/files.
 */
export function buildUserDataExportBundle(
  params: BuildExportBundleParams
): MurafiqExportBundleV1 {
  const uid = params.currentUserId;
  const isOnline = params.isOnline ?? true;
  const hasPendingLocalWrites = Boolean(params.hasPendingLocalWrites);
  const exportedAt = params.exportedAt || new Date().toISOString();

  const loadedFlags = {
    clients: params.collectionsLoaded?.clients ?? true,
    meetings: params.collectionsLoaded?.meetings ?? true,
    tasks: params.collectionsLoaded?.tasks ?? true,
    notes: params.collectionsLoaded?.notes ?? true,
    opportunities: params.collectionsLoaded?.opportunities ?? true,
    opportunityStageEvents: params.collectionsLoaded?.opportunityStageEvents ?? true,
  };

  const unloadedCollections: string[] = [];
  for (const [key, loaded] of Object.entries(loadedFlags)) {
    if (!loaded) {
      unloadedCollections.push(EXPORT_COLLECTION_LABELS_AR[key] || key);
    }
  }

  const allCollectionsLoaded = unloadedCollections.length === 0;
  const isCompleteOnline = isOnline && allCollectionsLoaded && !hasPendingLocalWrites;

  const completeness: ExportCompletenessMeta = {
    status: isCompleteOnline ? 'complete_online' : 'partial_or_offline',
    isOnline,
    allCollectionsLoaded,
    hasPendingLocalWrites,
    unloadedCollections,
    disclosureAr: isCompleteOnline
      ? COMPLETE_ONLINE_EXPORT_DISCLOSURE_AR
      : PARTIAL_OR_OFFLINE_EXPORT_DISCLOSURE_AR,
  };

  const filterOwned = <T extends { userId?: string }>(items: T[]): T[] =>
    (items || []).filter((item) => !item.userId || item.userId === uid);

  const rawClients = filterOwned(params.clients);
  const rawMeetings = filterOwned(params.meetings);
  const rawTasks = filterOwned(params.tasks);
  const rawNotes = filterOwned(params.notes);
  const rawOpportunities = filterOwned(params.opportunities);
  const rawStageEvents = filterOwned(params.opportunityStageEvents);

  let meetingsWithLegacyPhotoPathsCount = 0;
  let totalLegacyPhotoPathsCount = 0;
  for (const m of rawMeetings) {
    if (Array.isArray(m.photoPaths) && m.photoPaths.length > 0) {
      meetingsWithLegacyPhotoPathsCount++;
      totalLegacyPhotoPathsCount += m.photoPaths.length;
    }
  }

  // Sanitize records and strip any internal/attachment paths or tokens
  const cleanClients = rawClients.map((c) => {
    const stripped = stripSecretsAndInternalFields(c);
    const { avatarPath: _avatar, ...rest } = stripped;
    return {
      ...rest,
      userId: uid,
    } as Client;
  });

  const cleanMeetings = rawMeetings.map((m) => {
    const stripped = stripSecretsAndInternalFields(m);
    return {
      ...stripped,
      userId: uid,
      // Never export B2 or local attachment paths inside portable JSON
      photoPaths: [],
    } as Meeting;
  });

  const cleanTasks = rawTasks.map((t) => ({
    ...stripSecretsAndInternalFields(t),
    userId: uid,
  }));

  const cleanNotes = rawNotes.map((n) => ({
    ...stripSecretsAndInternalFields(n),
    userId: uid,
  }));

  const cleanOpportunities = rawOpportunities.map((o) => ({
    ...stripSecretsAndInternalFields(o),
    userId: uid,
  }));

  const cleanStageEvents = rawStageEvents.map((e) => ({
    ...stripSecretsAndInternalFields(e),
    userId: uid,
  }));

  return {
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    application: 'Murafiq',
    exportedAt,
    completeness,
    attachmentPolicyDisclosureAr: EXPORT_ATTACHMENT_DISCLOSURE_AR,
    securityDisclosureAr: EXPORT_SECURITY_DISCLOSURE_AR,
    attachmentSummary: {
      meetingsWithLegacyPhotoPathsCount,
      totalLegacyPhotoPathsCount,
      policyDisclosureAr: EXPORT_ATTACHMENT_DISCLOSURE_AR,
    },
    excludedItems: [
      'ملفات المرفقات المخزنة في Backblaze B2 (الصور وملفات PDF)',
      'مفاتيح التخزين السحابي (storageKey) والروابط الموقعة المؤقتة (presignedUrl)',
      'سجلات نوايا الرفع المؤقتة (uploadIntents) وأقفال الحذف (_meetingGuard)',
      'رموز المصادقة الجلسية (idToken / accessToken) وأي مفاتيح سرية للخادم',
    ],
    counts: {
      clients: cleanClients.length,
      meetings: cleanMeetings.length,
      tasks: cleanTasks.length,
      notes: cleanNotes.length,
      opportunities: cleanOpportunities.length,
      opportunityStageEvents: cleanStageEvents.length,
    },
    data: {
      clients: cleanClients,
      meetings: cleanMeetings,
      tasks: cleanTasks,
      notes: cleanNotes,
      opportunities: cleanOpportunities,
      opportunityStageEvents: cleanStageEvents,
    },
  };
}

// ============================================================================
// CSV Export & Formula Injection Protection
// ============================================================================

const FORMULA_DANGEROUS_PREFIX_REGEX = /^[\s\u0000-\u001F]*[=+\-@]/;
const CONTROL_CHAR_PREFIX_REGEX = /^[\t\r]/;

/**
 * Neutralizes CSV Formula Injection (CSV Injection / DDE Injection) for cells starting
 * with `=`, `+`, `-`, `@`, `\t`, or `\r` (even if preceded by whitespace).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!str) return '';

  if (CONTROL_CHAR_PREFIX_REGEX.test(str) || FORMULA_DANGEROUS_PREFIX_REGEX.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Formats and escapes a cell according to RFC 4180 after neutralizing CSV formula injection.
 */
export function escapeCsvCell(value: unknown): string {
  const safe = sanitizeCsvCell(value);
  if (!safe) return '';
  if (safe.includes('"') || safe.includes(',') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  // Prepend UTF-8 BOM (\uFEFF) for Arabic compatibility in Excel / Calc
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}`;
}

const CLIENT_RELATIONSHIP_AR: Record<string, string> = {
  lead: 'عميل محتمل',
  initial_contact: 'تواصل أولي',
  active: 'نشط',
  follow_up_needed: 'يحتاج متابعة',
  inactive: 'غير نشط',
};

const IMPORTANCE_AR: Record<string, string> = {
  high: 'مرتفعة',
  medium: 'متوسطة',
  low: 'منخفضة',
};

const PRIORITY_AR: Record<string, string> = {
  urgent: 'عاجل',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
};

const TASK_STATUS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const MEETING_TYPE_AR: Record<string, string> = {
  in_person: 'حضوري',
  video: 'مرئي (فيديو)',
  phone: 'هاتفي',
  chat: 'محادثة',
};

const MEETING_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  confirmed: 'مؤكد',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};

const MINUTES_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  review: 'قيد المراجعة',
  final: 'معتمد نهائي',
};

export interface BuildEntityCsvParams {
  entityType: CsvExportEntityType;
  currentUserId?: string;
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  opportunities: Opportunity[];
}

/**
 * Generates an Arabic UTF-8 BOM CSV string for Clients, Tasks, Meetings, or Opportunities.
 * Respects multi-currency separation for Opportunities (value and currency in separate columns, never summed across currencies).
 */
export function buildEntityCsv(params: BuildEntityCsvParams): string {
  const uid = params.currentUserId;
  const filterOwned = <T extends { userId?: string }>(items: T[]): T[] =>
    (items || []).filter((item) => !uid || !item.userId || item.userId === uid);

  const ownedClients = filterOwned(params.clients);
  const clientNameMap = new Map<string, string>();
  for (const c of ownedClients) {
    clientNameMap.set(c.id, c.name);
  }

  const ownedOpportunities = filterOwned(params.opportunities);
  const opportunityTitleMap = new Map<string, string>();
  for (const o of ownedOpportunities) {
    opportunityTitleMap.set(o.id, o.title);
  }

  if (params.entityType === 'clients') {
    const headers = [
      'معرف العميل',
      'الاسم',
      'الشركة',
      'القطاع',
      'الفئة',
      'حالة العلاقة',
      'الأهمية',
      'الهاتف',
      'البريد الإلكتروني',
      'الوسوم',
      'عدد جهات الاتصال',
      'جهة الاتصال الرئيسية',
      'ملاحظات',
      'تاريخ الإنشاء',
      'آخر تحديث',
    ];
    const rows = ownedClients.map((c) => {
      const contacts = Array.isArray(c.contacts) ? c.contacts : [];
      const primaryContact = contacts.find((ct) => ct.isPrimary) || contacts[0];
      return [
        c.id,
        c.name,
        c.company || '',
        c.industry || '',
        c.category || '',
        c.relationshipStatus ? CLIENT_RELATIONSHIP_AR[c.relationshipStatus] || c.relationshipStatus : '',
        c.importance ? IMPORTANCE_AR[c.importance] || c.importance : '',
        c.phone || '',
        c.email || '',
        Array.isArray(c.tags) ? c.tags.join(' | ') : '',
        contacts.length,
        primaryContact ? `${primaryContact.name}${primaryContact.phone ? ` (${primaryContact.phone})` : ''}` : '',
        c.notes || '',
        c.createdAt || '',
        c.updatedAt || '',
      ];
    });
    return buildCsvDocument(headers, rows);
  }

  if (params.entityType === 'tasks') {
    const ownedTasks = filterOwned(params.tasks);
    const headers = [
      'معرف المهمة',
      'العنوان',
      'العميل',
      'الفرصة المرتبطة',
      'الحالة',
      'الأولوية',
      'تاريخ الاستحقاق',
      'الوصف',
      'تاريخ الإنجاز',
      'تاريخ الإنشاء',
    ];
    const rows = ownedTasks.map((t) => [
      t.id,
      t.title,
      clientNameMap.get(t.clientId) || t.clientId,
      t.opportunityId ? opportunityTitleMap.get(t.opportunityId) || t.opportunityId : '',
      TASK_STATUS_AR[t.status] || t.status,
      PRIORITY_AR[t.priority] || t.priority,
      t.dueDate || '',
      t.description || '',
      t.completedAt || '',
      t.createdAt || '',
    ]);
    return buildCsvDocument(headers, rows);
  }

  if (params.entityType === 'meetings') {
    const ownedMeetings = filterOwned(params.meetings);
    const headers = [
      'معرف الاجتماع',
      'العنوان',
      'العميل',
      'تاريخ ووقت الاجتماع',
      'النوع',
      'الحالة',
      'حالة المحضر',
      'الموقع',
      'الفرصة المرتبطة',
      'ملخص النقاش / الملاحظات',
      'عدد القرارات',
    ];
    const rows = ownedMeetings.map((m) => [
      m.id,
      m.title,
      clientNameMap.get(m.clientId) || m.clientId,
      m.dateTime || '',
      MEETING_TYPE_AR[m.type] || m.type,
      MEETING_STATUS_AR[m.status] || m.status,
      m.minutesStatus ? MINUTES_STATUS_AR[m.minutesStatus] || m.minutesStatus : '',
      m.location || '',
      m.opportunityId ? opportunityTitleMap.get(m.opportunityId) || m.opportunityId : '',
      m.discussionSummary || m.notes || '',
      Array.isArray(m.decisions) ? m.decisions.length : 0,
    ]);
    return buildCsvDocument(headers, rows);
  }

  // opportunities
  const headers = [
    'معرف الفرصة',
    'العنوان',
    'العميل',
    'النوع',
    'المرحلة',
    'حالة الفرصة',
    'الأولوية',
    'القيمة التقديرية',
    'العملة',
    'تاريخ الإغلاق المتوقع',
    'الإجراء القادم',
    'تاريخ الإجراء القادم',
    'سبب الخسارة',
    'تاريخ الإنشاء',
  ];
  const rows = ownedOpportunities.map((o) => [
    o.id,
    o.title,
    clientNameMap.get(o.clientId) || o.clientId,
    OPPORTUNITY_TYPE_LABELS[o.type]?.ar || o.type,
    OPPORTUNITY_STAGE_CONFIG[o.stage]?.labelAr || o.stage,
    isOpportunityOpen(o.stage) ? 'مفتوحة' : o.stage === 'won' ? 'مكسوبة' : 'خاسرة',
    PRIORITY_AR[o.priority] || o.priority,
    o.estimatedValue !== undefined ? o.estimatedValue : '',
    o.currency || '',
    o.expectedCloseDate || '',
    o.nextAction || '',
    o.nextActionDate || '',
    o.lostReason || '',
    o.createdAt || '',
  ]);
  return buildCsvDocument(headers, rows);
}

// ============================================================================
// RFC 4180 CSV Parser (for Clients CSV Import)
// ============================================================================

export function parseCsvText(csvText: string): string[][] {
  // Strip UTF-8 BOM if present
  const content = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < content.length && content[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (inQuotes) {
    throw new Error('UNCLOSED_CSV_QUOTES');
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// ============================================================================
// Safe Import Validation, Sanitization & Preview Engine
// ============================================================================

function containsDangerousJsonKeys(rawJson: string): boolean {
  return /"(?:__proto__|constructor|prototype)"\s*:/.test(rawJson);
}

function clampStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function deterministicHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function checkUnknownAndForbiddenKeys(
  rawObj: Record<string, any>,
  allowedSet: Set<string>,
  collection: ImportValidationIssue['collection'],
  recordId: string,
  recordTitle: string,
  issues: ImportValidationIssue[]
) {
  const unknownKeys: string[] = [];
  const attachmentKeys: string[] = [];

  for (const key of Object.keys(rawObj)) {
    if (FORBIDDEN_SECRET_AND_INTERNAL_KEYS.has(key)) {
      attachmentKeys.push(key);
    } else if (!allowedSet.has(key)) {
      unknownKeys.push(key);
    }
  }

  if (attachmentKeys.length > 0) {
    issues.push({
      id: `issue_att_${collection}_${recordId}`,
      collection,
      recordId,
      recordTitle,
      severity: 'warning',
      code: 'ATTACHMENT_FIELDS_STRIPPED',
      messageAr: `تم تجاهل حقول مرفقات أو مفاتيح داخلية غير مسموح باستيرادها (${attachmentKeys.join(', ')}) في السجل «${recordTitle}».`,
    });
  }

  if (unknownKeys.length > 0) {
    issues.push({
      id: `issue_unk_${collection}_${recordId}`,
      collection,
      recordId,
      recordTitle,
      severity: 'warning',
      code: 'UNKNOWN_FIELDS_STRIPPED',
      messageAr: `تم استبعاد حقول غير معتمدة (${unknownKeys.join(', ')}) من السجل «${recordTitle}» التزاماً بقواعد قاعدة البيانات.`,
    });
  }
}

function sanitizeImportedContacts(rawContacts: unknown): ClientContact[] | undefined {
  if (!Array.isArray(rawContacts)) return undefined;
  const valid: ClientContact[] = [];
  for (let i = 0; i < Math.min(25, rawContacts.length); i++) {
    const item = rawContacts[i];
    if (!item || typeof item !== 'object') continue;
    const name = clampStr((item as any).name, 120);
    if (!name) continue;
    const rawId = (item as any).id;
    const id = isValidFirestoreId(rawId) ? rawId : `contact_${i + 1}_${deterministicHash(name)}`;
    const contact: ClientContact = {
      id,
      name,
      isPrimary: Boolean((item as any).isPrimary),
    };
    const title = clampStr((item as any).title, 100);
    if (title) contact.title = title;
    const department = clampStr((item as any).department, 100);
    if (department) contact.department = department;
    const phone = clampStr((item as any).phone, 50);
    if (phone) contact.phone = phone;
    const email = clampStr((item as any).email, 150);
    if (email) contact.email = email;
    const notes = clampStr((item as any).notes, 500);
    if (notes) contact.notes = notes;
    valid.push(contact);
  }
  return valid.length > 0 ? valid : undefined;
}

export interface ExistingUserDataForImport {
  currentUserId: string;
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities: Opportunity[];
  opportunityStageEvents: OpportunityStageEvent[];
}

export interface ValidateImportInput {
  fileContent: string;
  fileName?: string;
  fileSizeBytes?: number;
  formatHint?: 'auto' | 'murafiq_json' | 'clients_csv';
  existingData: ExistingUserDataForImport;
  nowIso?: string;
}

function createEmptyCountsByCollection(): ImportPreviewResult['countsByCollection'] {
  return {
    clients: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
    meetings: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
    tasks: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
    notes: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
    opportunities: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
    opportunityStageEvents: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
  };
}

function createEmptyBatch(): SanitizedImportBatch {
  return {
    clients: [],
    meetings: [],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
  };
}

/**
 * Validates, sanitizes, and previews an import file (Murafiq JSON or Clients CSV)
 * without mutating any state or writing to Firestore.
 */
export function validateAndPreviewImport(input: ValidateImportInput): ImportPreviewResult {
  const nowIso = input.nowIso || new Date().toISOString();
  const uid = input.existingData.currentUserId;
  const countsByCollection = createEmptyCountsByCollection();
  const sanitizedBatch = createEmptyBatch();
  const issues: ImportValidationIssue[] = [];

  const byteSize =
    input.fileSizeBytes ?? new TextEncoder().encode(input.fileContent || '').byteLength;

  if (byteSize > MAX_IMPORT_FILE_BYTES) {
    issues.push({
      id: 'issue_file_too_large',
      collection: 'file',
      severity: 'error',
      code: 'FILE_TOO_LARGE',
      messageAr: `حجم الملف يتجاوز الحد الأقصى المسموح به للاستيراد الآمن (${Math.round(
        MAX_IMPORT_FILE_BYTES / (1024 * 1024)
      )} ميجابايت).`,
    });
    return {
      canProceed: false,
      fatalErrorAr: 'حجم الملف كبير جداً ويتجاوز الحد المسموح به (5 ميجابايت).',
      format: 'murafiq_json',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const trimmedContent = (input.fileContent || '').trim();
  if (!trimmedContent) {
    issues.push({
      id: 'issue_empty_file',
      collection: 'file',
      severity: 'error',
      code: 'INVALID_FORMAT',
      messageAr: 'الملف المحدد فارغ ولا يحتوي على بيانات قابلة للاستيراد.',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'الملف المحدد فارغ.',
      format: 'murafiq_json',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const lowerName = (input.fileName || '').toLowerCase();
  const isCsv =
    input.formatHint === 'clients_csv' ||
    (input.formatHint !== 'murafiq_json' &&
      (lowerName.endsWith('.csv') || (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('['))));

  if (isCsv) {
    return validateClientsCsvImport(trimmedContent, uid, input.existingData, nowIso);
  }

  // JSON Import Validation
  if (containsDangerousJsonKeys(trimmedContent)) {
    issues.push({
      id: 'issue_proto_pollution',
      collection: 'file',
      severity: 'error',
      code: 'PROTOTYPE_POLLUTION_BLOCKED',
      messageAr:
        'تم حظر الملف لاحتوائه على مفاتيح برمجية خطرة (__proto__ أو constructor أو prototype).',
    });
    return {
      canProceed: false,
      fatalErrorAr:
        'تم رفض الملف أمنياً لاحتوائه على مفاتيح غير آمنة (__proto__ / constructor / prototype).',
      format: 'murafiq_json',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmedContent);
  } catch {
    issues.push({
      id: 'issue_malformed_json',
      collection: 'file',
      severity: 'error',
      code: 'INVALID_FORMAT',
      messageAr: 'تعذر قراءة ملف JSON. تأكد من سلامة بنية الملف وعدم تلفه.',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'ملف JSON غير صالح أو تالف.',
      format: 'murafiq_json',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    issues.push({
      id: 'issue_json_not_object',
      collection: 'file',
      severity: 'error',
      code: 'INVALID_FORMAT',
      messageAr: 'بنية ملف JSON غير متوافقة مع قالب تصدير «مُرافق».',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'بنية ملف JSON غير متوافقة مع قالب تصدير «مُرافق».',
      format: 'murafiq_json',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const schemaVersionDetected = String(
    parsed.schemaVersion || parsed.murafiq_version || ''
  ).trim();

  if (
    schemaVersionDetected !== MURAFIQ_EXPORT_SCHEMA_VERSION &&
    schemaVersionDetected !== LEGACY_PROTOTYPE_SCHEMA_VERSION
  ) {
    issues.push({
      id: 'issue_unsupported_schema',
      collection: 'file',
      severity: 'error',
      code: 'UNSUPPORTED_SCHEMA',
      messageAr: schemaVersionDetected
        ? `إصدار قالب الملف (${schemaVersionDetected}) غير مدعوم. الإصدار المعتمد هو ${MURAFIQ_EXPORT_SCHEMA_VERSION}.`
        : `الملف لا يحتوي على معرف إصدار قالب مُرافق المعتمد (${MURAFIQ_EXPORT_SCHEMA_VERSION}).`,
    });
    return {
      canProceed: false,
      fatalErrorAr: schemaVersionDetected
        ? `إصدار القالب «${schemaVersionDetected}» غير مدعوم.`
        : 'الملف لا يتضمن إصدار قالب تصدير «مُرافق» المعتمد.',
      format: 'murafiq_json',
      schemaVersionDetected: schemaVersionDetected || undefined,
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const sourceContainer =
    parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
      ? parsed.data
      : parsed;

  const rawClients: unknown[] = Array.isArray(sourceContainer.clients)
    ? sourceContainer.clients
    : [];
  const rawMeetings: unknown[] = Array.isArray(sourceContainer.meetings)
    ? sourceContainer.meetings
    : [];
  const rawTasks: unknown[] = Array.isArray(sourceContainer.tasks)
    ? sourceContainer.tasks
    : [];
  const rawNotes: unknown[] = Array.isArray(sourceContainer.notes)
    ? sourceContainer.notes
    : [];
  const rawOpportunities: unknown[] = Array.isArray(sourceContainer.opportunities)
    ? sourceContainer.opportunities
    : [];
  const rawStageEvents: unknown[] = Array.isArray(sourceContainer.opportunityStageEvents)
    ? sourceContainer.opportunityStageEvents
    : [];

  // Existing IDs in current user's account
  const existingClientIds = new Set(input.existingData.clients.map((c) => c.id));
  const existingMeetingIds = new Set(input.existingData.meetings.map((m) => m.id));
  const existingTaskIds = new Set(input.existingData.tasks.map((t) => t.id));
  const existingNoteIds = new Set(input.existingData.notes.map((n) => n.id));
  const existingOppIds = new Set(input.existingData.opportunities.map((o) => o.id));
  const existingEventIds = new Set(
    input.existingData.opportunityStageEvents.map((e) => e.id)
  );

  // Track valid target IDs (existing + newly validated in this batch) for relational integrity
  const validClientIds = new Set<string>(existingClientIds);
  const validOpportunityIds = new Set<string>(existingOppIds);
  const validMeetingIds = new Set<string>(existingMeetingIds);

  const seenClientIdsInFile = new Set<string>();
  const seenOppIdsInFile = new Set<string>();
  const seenMeetingIdsInFile = new Set<string>();
  const seenTaskIdsInFile = new Set<string>();
  const seenNoteIdsInFile = new Set<string>();
  const seenEventIdsInFile = new Set<string>();

  let brokenRelationshipsCount = 0;

  // 1. Validate Clients First
  countsByCollection.clients.totalInFile = rawClients.length;
  for (let i = 0; i < rawClients.length; i++) {
    const raw = rawClients[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.clients.rejected++;
      issues.push({
        id: `client_invalid_${i}`,
        collection: 'clients',
        severity: 'error',
        code: 'INVALID_FIELD_VALUE',
        messageAr: `سجل عميل رقم ${i + 1} غير صالح وتم استبعاده.`,
      });
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const name = clampStr(obj.name, 150);

    if (!isValidFirestoreId(id)) {
      countsByCollection.clients.rejected++;
      issues.push({
        id: `client_bad_id_${i}`,
        collection: 'clients',
        recordId: String(id || ''),
        recordTitle: name || `عميل #${i + 1}`,
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض العميل «${name || i + 1}» لأن المعرف (${String(id)}) غير صالح أو يحتوي على محارف مسار ممنوعة.`,
      });
      continue;
    }

    if (!name) {
      countsByCollection.clients.rejected++;
      issues.push({
        id: `client_no_name_${id}`,
        collection: 'clients',
        recordId: id,
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض العميل (${id}) لعدم وجود اسم العميل الإلزامي.`,
      });
      continue;
    }

    if (existingClientIds.has(id) || seenClientIdsInFile.has(id)) {
      countsByCollection.clients.duplicateSkipped++;
      issues.push({
        id: `client_dup_${id}_${i}`,
        collection: 'clients',
        recordId: id,
        recordTitle: name,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي العميل «${name}» (${id}) لأنه موجود مسبقاً (لم يتم الكتابة فوق السجل الحالي).`,
      });
      continue;
    }

    if (obj.userId && obj.userId !== uid) {
      issues.push({
        id: `client_rebind_${id}`,
        collection: 'clients',
        recordId: id,
        recordTitle: name,
        severity: 'warning',
        code: 'FOREIGN_USER_ID_REBOUND',
        messageAr: `تم ربط العميل «${name}» بمعرف حسابك الحالي بدلاً من معرف المستخدم الوارد في الملف.`,
      });
    }

    checkUnknownAndForbiddenKeys(obj, CLIENT_ALLOWED_KEYS, 'clients', id, name, issues);

    const client: Client = {
      id,
      userId: uid,
      name,
      createdAt: clampStr(obj.createdAt, 50) || nowIso,
      updatedAt: clampStr(obj.updatedAt, 50) || nowIso,
    };

    const company = clampStr(obj.company, 150);
    if (company) client.company = company;
    const phone = clampStr(obj.phone, 50);
    if (phone) client.phone = phone;
    const email = clampStr(obj.email, 150);
    if (email) client.email = email;
    const notes = clampStr(obj.notes, 2000);
    if (notes) client.notes = notes;
    const color = clampStr(obj.color, 30);
    if (color) client.color = color;
    if (typeof obj.isFavorite === 'boolean') client.isFavorite = obj.isFavorite;
    const industry = clampStr(obj.industry, 100);
    if (industry) client.industry = industry;
    const category = clampStr(obj.category, 80);
    if (category) client.category = category;
    if (
      ['lead', 'initial_contact', 'active', 'follow_up_needed', 'inactive'].includes(
        obj.relationshipStatus
      )
    ) {
      client.relationshipStatus = obj.relationshipStatus;
    }
    if (['high', 'medium', 'low'].includes(obj.importance)) {
      client.importance = obj.importance;
    }
    if (Array.isArray(obj.tags)) {
      client.tags = obj.tags
        .map((t: unknown) => clampStr(t, 60))
        .filter((t): t is string => Boolean(t))
        .slice(0, 20);
    }
    const website = clampStr(obj.website, 250);
    if (website) client.website = website;
    const address = clampStr(obj.address, 300);
    if (address) client.address = address;
    const source = clampStr(obj.source, 150);
    if (source) client.source = source;
    const description = clampStr(obj.description, 1000);
    if (description) client.description = description;
    const contacts = sanitizeImportedContacts(obj.contacts);
    if (contacts) client.contacts = contacts;

    seenClientIdsInFile.add(id);
    validClientIds.add(id);
    sanitizedBatch.clients.push(client);
    countsByCollection.clients.validToImport++;
  }

  // 2. Validate Opportunities (depends on validClientIds)
  countsByCollection.opportunities.totalInFile = rawOpportunities.length;
  for (let i = 0; i < rawOpportunities.length; i++) {
    const raw = rawOpportunities[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.opportunities.rejected++;
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const title = clampStr(obj.title, 200);
    const clientId = obj.clientId;

    if (!isValidFirestoreId(id)) {
      countsByCollection.opportunities.rejected++;
      issues.push({
        id: `opp_bad_id_${i}`,
        collection: 'opportunities',
        recordId: String(id || ''),
        recordTitle: title || `فرصة #${i + 1}`,
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض الفرصة «${title || i + 1}» لأن المعرف (${String(id)}) غير صالح.`,
      });
      continue;
    }

    if (!title || !isValidFirestoreId(clientId)) {
      countsByCollection.opportunities.rejected++;
      issues.push({
        id: `opp_missing_req_${id}`,
        collection: 'opportunities',
        recordId: id,
        recordTitle: title || id,
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض الفرصة «${title || id}» لعدم اكتمال الحقول الإلزامية (العنوان أو معرف العميل).`,
      });
      continue;
    }

    if (existingOppIds.has(id) || seenOppIdsInFile.has(id)) {
      countsByCollection.opportunities.duplicateSkipped++;
      issues.push({
        id: `opp_dup_${id}_${i}`,
        collection: 'opportunities',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي الفرصة «${title}» (${id}) لوجودها مسبقاً.`,
      });
      continue;
    }

    if (!validClientIds.has(clientId)) {
      countsByCollection.opportunities.rejected++;
      brokenRelationshipsCount++;
      issues.push({
        id: `opp_missing_client_${id}`,
        collection: 'opportunities',
        recordId: id,
        recordTitle: title,
        severity: 'error',
        code: 'MISSING_CLIENT_SKIPPED',
        messageAr: `تم استبعاد الفرصة «${title}» لأن العميل المرتبط بها (${clientId}) غير موجود في حسابك أو في ملف الاستيراد.`,
      });
      continue;
    }

    if (obj.userId && obj.userId !== uid) {
      issues.push({
        id: `opp_rebind_${id}`,
        collection: 'opportunities',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'FOREIGN_USER_ID_REBOUND',
        messageAr: `تم ربط الفرصة «${title}» بمعرف حسابك الحالي.`,
      });
    }

    checkUnknownAndForbiddenKeys(
      obj,
      OPPORTUNITY_ALLOWED_KEYS,
      'opportunities',
      id,
      title,
      issues
    );

    const type: OpportunityType = [
      'service',
      'consulting',
      'retainer',
      'partnership',
      'project',
      'other',
    ].includes(obj.type)
      ? obj.type
      : 'other';

    const stage: OpportunityStage = [
      'new',
      'qualification',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ].includes(obj.stage)
      ? obj.stage
      : 'new';

    const priority: TaskPriority = ['urgent', 'high', 'medium', 'low'].includes(obj.priority)
      ? obj.priority
      : 'medium';

    const opp: Opportunity = {
      id,
      userId: uid,
      clientId,
      title,
      type,
      stage,
      priority,
      createdAt: clampStr(obj.createdAt, 50) || nowIso,
      updatedAt: clampStr(obj.updatedAt, 50) || nowIso,
    };

    const description = clampStr(obj.description, 3000);
    if (description) opp.description = description;

    const validCurrencies: OpportunityCurrency[] = ['JOD', 'SAR', 'USD', 'EUR', 'AED', 'EGP'];
    const currency: OpportunityCurrency | undefined = validCurrencies.includes(obj.currency)
      ? obj.currency
      : undefined;

    if (
      typeof obj.estimatedValue === 'number' &&
      Number.isFinite(obj.estimatedValue) &&
      obj.estimatedValue >= 0 &&
      obj.estimatedValue <= 1000000000
    ) {
      opp.estimatedValue = obj.estimatedValue;
      opp.currency = currency || 'JOD';
    } else if (currency) {
      opp.currency = currency;
    }

    if (typeof obj.expectedCloseDate === 'string' && DATE_ONLY_REGEX.test(obj.expectedCloseDate)) {
      opp.expectedCloseDate = obj.expectedCloseDate;
    }
    const nextAction = clampStr(obj.nextAction, 300);
    if (nextAction) opp.nextAction = nextAction;
    if (typeof obj.nextActionDate === 'string' && DATE_ONLY_REGEX.test(obj.nextActionDate)) {
      opp.nextActionDate = obj.nextActionDate;
    }
    const source = clampStr(obj.source, 150);
    if (source) opp.source = source;
    const lostReason = clampStr(obj.lostReason, 500);
    if (lostReason) opp.lostReason = lostReason;
    const closedAt = clampStr(obj.closedAt, 50);
    if (closedAt) opp.closedAt = closedAt;
    const reopenedAt = clampStr(obj.reopenedAt, 50);
    if (reopenedAt) opp.reopenedAt = reopenedAt;

    seenOppIdsInFile.add(id);
    validOpportunityIds.add(id);
    sanitizedBatch.opportunities.push(opp);
    countsByCollection.opportunities.validToImport++;
  }

  // 3. Validate Meetings (depends on validClientIds & optional validOpportunityIds)
  countsByCollection.meetings.totalInFile = rawMeetings.length;
  for (let i = 0; i < rawMeetings.length; i++) {
    const raw = rawMeetings[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.meetings.rejected++;
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const title = clampStr(obj.title, 200);
    const clientId = obj.clientId;

    if (!isValidFirestoreId(id)) {
      countsByCollection.meetings.rejected++;
      issues.push({
        id: `meeting_bad_id_${i}`,
        collection: 'meetings',
        recordId: String(id || ''),
        recordTitle: title || `اجتماع #${i + 1}`,
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض الاجتماع «${title || i + 1}» لأن المعرف (${String(id)}) غير صالح.`,
      });
      continue;
    }

    if (!title || !isValidFirestoreId(clientId)) {
      countsByCollection.meetings.rejected++;
      issues.push({
        id: `meeting_missing_req_${id}`,
        collection: 'meetings',
        recordId: id,
        recordTitle: title || id,
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض الاجتماع «${title || id}» لعدم اكتمال الحقول الإلزامية (العنوان أو معرف العميل).`,
      });
      continue;
    }

    if (existingMeetingIds.has(id) || seenMeetingIdsInFile.has(id)) {
      countsByCollection.meetings.duplicateSkipped++;
      issues.push({
        id: `meeting_dup_${id}_${i}`,
        collection: 'meetings',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي الاجتماع «${title}» (${id}) لوجوده مسبقاً.`,
      });
      continue;
    }

    if (!validClientIds.has(clientId)) {
      countsByCollection.meetings.rejected++;
      brokenRelationshipsCount++;
      issues.push({
        id: `meeting_missing_client_${id}`,
        collection: 'meetings',
        recordId: id,
        recordTitle: title,
        severity: 'error',
        code: 'MISSING_CLIENT_SKIPPED',
        messageAr: `تم استبعاد الاجتماع «${title}» لأن العميل المرتبط به (${clientId}) غير موجود.`,
      });
      continue;
    }

    if (obj.userId && obj.userId !== uid) {
      issues.push({
        id: `meeting_rebind_${id}`,
        collection: 'meetings',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'FOREIGN_USER_ID_REBOUND',
        messageAr: `تم ربط الاجتماع «${title}» بمعرف حسابك الحالي.`,
      });
    }

    checkUnknownAndForbiddenKeys(obj, MEETING_ALLOWED_KEYS, 'meetings', id, title, issues);

    const type: Meeting['type'] = ['in_person', 'phone', 'video', 'chat'].includes(obj.type)
      ? obj.type
      : 'in_person';
    const status: Meeting['status'] = ['draft', 'confirmed', 'completed', 'cancelled'].includes(
      obj.status
    )
      ? obj.status
      : 'confirmed';

    const meeting: Meeting = {
      id,
      userId: uid,
      clientId,
      title,
      dateTime: clampStr(obj.dateTime, 50) || nowIso,
      type,
      status,
      notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 10000) : '',
      photoPaths: [], // Never import external/B2 photoPaths
      createdAt: clampStr(obj.createdAt, 50) || nowIso,
      updatedAt: clampStr(obj.updatedAt, 50) || nowIso,
    };

    if (
      typeof obj.duration === 'number' &&
      Number.isFinite(obj.duration) &&
      obj.duration >= 0 &&
      obj.duration <= 1440
    ) {
      meeting.duration = obj.duration;
    }
    const location = clampStr(obj.location, 200);
    if (location) meeting.location = location;
    if (typeof obj.isFollowUpScheduled === 'boolean') {
      meeting.isFollowUpScheduled = obj.isFollowUpScheduled;
    }
    const discussionSummary = clampStr(obj.discussionSummary, 15000);
    if (discussionSummary) meeting.discussionSummary = discussionSummary;
    const minutesAdditionalNotes = clampStr(obj.minutesAdditionalNotes, 5000);
    if (minutesAdditionalNotes) meeting.minutesAdditionalNotes = minutesAdditionalNotes;
    const followUpDateTime = clampStr(obj.followUpDateTime, 50);
    if (followUpDateTime) meeting.followUpDateTime = followUpDateTime;
    if (['draft', 'review', 'final'].includes(obj.minutesStatus)) {
      meeting.minutesStatus = obj.minutesStatus;
    }
    const minutesStatusUpdatedAt = clampStr(obj.minutesStatusUpdatedAt, 50);
    if (minutesStatusUpdatedAt) meeting.minutesStatusUpdatedAt = minutesStatusUpdatedAt;
    if (Array.isArray(obj.minutesIncludedSections)) {
      meeting.minutesIncludedSections = obj.minutesIncludedSections.slice(
        0,
        12
      ) as MinutesSectionKey[];
    }
    const appliedTemplateId = clampStr(obj.appliedTemplateId, 100);
    if (appliedTemplateId) meeting.appliedTemplateId = appliedTemplateId;

    if (Array.isArray(obj.participants)) {
      const validParticipants: MeetingParticipant[] = [];
      for (const p of obj.participants.slice(0, 50)) {
        if (!p || typeof p !== 'object') continue;
        const pName = clampStr((p as any).name, 120);
        if (!pName) continue;
        validParticipants.push({
          id: isValidFirestoreId((p as any).id)
            ? (p as any).id
            : `part_${validParticipants.length + 1}`,
          name: pName,
          role: clampStr((p as any).role, 100),
          party: (p as any).party === 'internal' ? 'internal' : 'external',
        });
      }
      if (validParticipants.length > 0) meeting.participants = validParticipants;
    }

    if (Array.isArray(obj.agendaItems)) {
      const validAgenda: MeetingAgendaItem[] = [];
      for (const a of obj.agendaItems.slice(0, 60)) {
        if (!a || typeof a !== 'object') continue;
        const aTitle = clampStr((a as any).title, 200);
        if (!aTitle) continue;
        validAgenda.push({
          id: isValidFirestoreId((a as any).id)
            ? (a as any).id
            : `agenda_${validAgenda.length + 1}`,
          title: aTitle,
          notes: clampStr((a as any).notes, 2000),
          durationMinutes:
            typeof (a as any).durationMinutes === 'number'
              ? (a as any).durationMinutes
              : undefined,
          order:
            typeof (a as any).order === 'number' ? (a as any).order : validAgenda.length + 1,
        });
      }
      if (validAgenda.length > 0) meeting.agendaItems = validAgenda;
    }

    if (Array.isArray(obj.decisions)) {
      const validDecisions: MeetingDecision[] = [];
      for (const d of obj.decisions.slice(0, 60)) {
        if (!d || typeof d !== 'object') continue;
        const dText = clampStr((d as any).text, 1000);
        if (!dText) continue;
        validDecisions.push({
          id: isValidFirestoreId((d as any).id)
            ? (d as any).id
            : `dec_${validDecisions.length + 1}`,
          text: dText,
          ownerName: clampStr((d as any).ownerName, 120),
          agendaItemId: clampStr((d as any).agendaItemId, 128),
          createdAt: clampStr((d as any).createdAt, 50) || nowIso,
        });
      }
      if (validDecisions.length > 0) meeting.decisions = validDecisions;
    }

    if (obj.opportunityId !== undefined && obj.opportunityId !== null && obj.opportunityId !== '') {
      if (
        isValidFirestoreId(obj.opportunityId) &&
        validOpportunityIds.has(obj.opportunityId)
      ) {
        meeting.opportunityId = obj.opportunityId;
      } else {
        brokenRelationshipsCount++;
        issues.push({
          id: `meeting_broken_opp_${id}`,
          collection: 'meetings',
          recordId: id,
          recordTitle: title,
          severity: 'warning',
          code: 'BROKEN_OPTIONAL_LINK_UNLINKED',
          messageAr: `تم استيراد الاجتماع «${title}» مع فك ارتباطه بالفرصة (${String(
            obj.opportunityId
          )}) لعدم وجودها.`,
        });
      }
    }

    seenMeetingIdsInFile.add(id);
    validMeetingIds.add(id);
    sanitizedBatch.meetings.push(meeting);
    countsByCollection.meetings.validToImport++;
  }

  // 4. Validate Tasks (depends on validClientIds, optional validMeetingIds & validOpportunityIds)
  countsByCollection.tasks.totalInFile = rawTasks.length;
  for (let i = 0; i < rawTasks.length; i++) {
    const raw = rawTasks[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.tasks.rejected++;
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const title = clampStr(obj.title, 250);
    const clientId = obj.clientId;

    if (!isValidFirestoreId(id)) {
      countsByCollection.tasks.rejected++;
      issues.push({
        id: `task_bad_id_${i}`,
        collection: 'tasks',
        recordId: String(id || ''),
        recordTitle: title || `مهمة #${i + 1}`,
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض المهمة «${title || i + 1}» لأن المعرف (${String(id)}) غير صالح.`,
      });
      continue;
    }

    if (!title || !isValidFirestoreId(clientId)) {
      countsByCollection.tasks.rejected++;
      issues.push({
        id: `task_missing_req_${id}`,
        collection: 'tasks',
        recordId: id,
        recordTitle: title || id,
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض المهمة «${title || id}» لعدم اكتمال الحقول الإلزامية (العنوان أو معرف العميل).`,
      });
      continue;
    }

    if (existingTaskIds.has(id) || seenTaskIdsInFile.has(id)) {
      countsByCollection.tasks.duplicateSkipped++;
      issues.push({
        id: `task_dup_${id}_${i}`,
        collection: 'tasks',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي المهمة «${title}» (${id}) لوجودها مسبقاً.`,
      });
      continue;
    }

    if (!validClientIds.has(clientId)) {
      countsByCollection.tasks.rejected++;
      brokenRelationshipsCount++;
      issues.push({
        id: `task_missing_client_${id}`,
        collection: 'tasks',
        recordId: id,
        recordTitle: title,
        severity: 'error',
        code: 'MISSING_CLIENT_SKIPPED',
        messageAr: `تم استبعاد المهمة «${title}» لأن العميل المرتبط بها (${clientId}) غير موجود.`,
      });
      continue;
    }

    if (obj.userId && obj.userId !== uid) {
      issues.push({
        id: `task_rebind_${id}`,
        collection: 'tasks',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'FOREIGN_USER_ID_REBOUND',
        messageAr: `تم ربط المهمة «${title}» بمعرف حسابك الحالي.`,
      });
    }

    checkUnknownAndForbiddenKeys(obj, TASK_ALLOWED_KEYS, 'tasks', id, title, issues);

    const priority: TaskPriority = ['urgent', 'high', 'medium', 'low'].includes(obj.priority)
      ? obj.priority
      : 'medium';
    const status: TaskStatus = ['pending', 'in_progress', 'completed', 'cancelled'].includes(
      obj.status
    )
      ? obj.status
      : 'pending';

    const task: ActionItem = {
      id,
      userId: uid,
      clientId,
      title,
      priority,
      status,
      createdAt: clampStr(obj.createdAt, 50) || nowIso,
    };

    const description = clampStr(obj.description, 2000);
    if (description) task.description = description;
    const dueDate = clampStr(obj.dueDate, 50);
    if (dueDate) task.dueDate = dueDate;
    const reminderDate = clampStr(obj.reminderDate, 50);
    if (reminderDate) task.reminderDate = reminderDate;
    const completedAt = clampStr(obj.completedAt, 50);
    if (completedAt) task.completedAt = completedAt;
    if (['source', 'ai_suggested', 'approved', 'uncertain'].includes(obj.provenance)) {
      task.provenance = obj.provenance;
    }

    if (obj.meetingId !== undefined && obj.meetingId !== null && obj.meetingId !== '') {
      if (isValidFirestoreId(obj.meetingId) && validMeetingIds.has(obj.meetingId)) {
        task.meetingId = obj.meetingId;
      } else {
        brokenRelationshipsCount++;
        issues.push({
          id: `task_broken_meeting_${id}`,
          collection: 'tasks',
          recordId: id,
          recordTitle: title,
          severity: 'warning',
          code: 'BROKEN_OPTIONAL_LINK_UNLINKED',
          messageAr: `تم استيراد المهمة «${title}» مع فك ارتباطها بالاجتماع (${String(
            obj.meetingId
          )}) لعدم وجوده.`,
        });
      }
    }

    if (obj.opportunityId !== undefined && obj.opportunityId !== null && obj.opportunityId !== '') {
      if (
        isValidFirestoreId(obj.opportunityId) &&
        validOpportunityIds.has(obj.opportunityId)
      ) {
        task.opportunityId = obj.opportunityId;
      } else {
        brokenRelationshipsCount++;
        issues.push({
          id: `task_broken_opp_${id}`,
          collection: 'tasks',
          recordId: id,
          recordTitle: title,
          severity: 'warning',
          code: 'BROKEN_OPTIONAL_LINK_UNLINKED',
          messageAr: `تم استيراد المهمة «${title}» مع فك ارتباطها بالفرصة (${String(
            obj.opportunityId
          )}) لعدم وجودها.`,
        });
      }
    }

    seenTaskIdsInFile.add(id);
    sanitizedBatch.tasks.push(task);
    countsByCollection.tasks.validToImport++;
  }

  // 5. Validate Notes (optional clientId)
  countsByCollection.notes.totalInFile = rawNotes.length;
  for (let i = 0; i < rawNotes.length; i++) {
    const raw = rawNotes[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.notes.rejected++;
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const title = clampStr(obj.title, 200);

    if (!isValidFirestoreId(id)) {
      countsByCollection.notes.rejected++;
      issues.push({
        id: `note_bad_id_${i}`,
        collection: 'notes',
        recordId: String(id || ''),
        recordTitle: title || `ملاحظة #${i + 1}`,
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض الملاحظة «${title || i + 1}» لأن المعرف (${String(id)}) غير صالح.`,
      });
      continue;
    }

    if (!title || typeof obj.content !== 'string') {
      countsByCollection.notes.rejected++;
      issues.push({
        id: `note_missing_req_${id}`,
        collection: 'notes',
        recordId: id,
        recordTitle: title || id,
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض الملاحظة «${title || id}» لعدم وجود العنوان أو المحتوى النصي.`,
      });
      continue;
    }

    if (existingNoteIds.has(id) || seenNoteIdsInFile.has(id)) {
      countsByCollection.notes.duplicateSkipped++;
      issues.push({
        id: `note_dup_${id}_${i}`,
        collection: 'notes',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي الملاحظة «${title}» (${id}) لوجودها مسبقاً.`,
      });
      continue;
    }

    if (obj.userId && obj.userId !== uid) {
      issues.push({
        id: `note_rebind_${id}`,
        collection: 'notes',
        recordId: id,
        recordTitle: title,
        severity: 'warning',
        code: 'FOREIGN_USER_ID_REBOUND',
        messageAr: `تم ربط الملاحظة «${title}» بمعرف حسابك الحالي.`,
      });
    }

    checkUnknownAndForbiddenKeys(obj, NOTE_ALLOWED_KEYS, 'notes', id, title, issues);

    const note: Note = {
      id,
      userId: uid,
      title,
      content: obj.content.slice(0, 5000),
      tags: Array.isArray(obj.tags)
        ? obj.tags
            .map((t: unknown) => clampStr(t, 60))
            .filter((t): t is string => Boolean(t))
            .slice(0, 30)
        : [],
      isPinned: Boolean(obj.isPinned),
      createdAt: clampStr(obj.createdAt, 50) || nowIso,
      updatedAt: clampStr(obj.updatedAt, 50) || nowIso,
    };

    const color = clampStr(obj.color, 30);
    if (color) note.color = color;

    if (obj.clientId !== undefined && obj.clientId !== null && obj.clientId !== '') {
      if (isValidFirestoreId(obj.clientId) && validClientIds.has(obj.clientId)) {
        note.clientId = obj.clientId;
      } else {
        brokenRelationshipsCount++;
        issues.push({
          id: `note_broken_client_${id}`,
          collection: 'notes',
          recordId: id,
          recordTitle: title,
          severity: 'warning',
          code: 'BROKEN_OPTIONAL_LINK_UNLINKED',
          messageAr: `تم استيراد الملاحظة «${title}» كملاحظة عامة بعد فك ارتباطها بالعميل (${String(
            obj.clientId
          )}) لعدم وجوده.`,
        });
      }
    }

    seenNoteIdsInFile.add(id);
    sanitizedBatch.notes.push(note);
    countsByCollection.notes.validToImport++;
  }

  // 6. Validate Opportunity Stage Events (depends on validOpportunityIds)
  countsByCollection.opportunityStageEvents.totalInFile = rawStageEvents.length;
  for (let i = 0; i < rawStageEvents.length; i++) {
    const raw = rawStageEvents[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      countsByCollection.opportunityStageEvents.rejected++;
      continue;
    }
    const obj = raw as Record<string, any>;
    const id = obj.id;
    const opportunityId = obj.opportunityId;

    if (!isValidFirestoreId(id) || !isValidFirestoreId(opportunityId)) {
      countsByCollection.opportunityStageEvents.rejected++;
      issues.push({
        id: `event_bad_id_${i}`,
        collection: 'opportunityStageEvents',
        recordId: String(id || ''),
        severity: 'error',
        code: 'INVALID_ID',
        messageAr: `تم رفض سجل حدث مرحلة رقم ${i + 1} لعدم صلاحية المعرف.`,
      });
      continue;
    }

    if (existingEventIds.has(id) || seenEventIdsInFile.has(id)) {
      countsByCollection.opportunityStageEvents.duplicateSkipped++;
      continue;
    }

    if (!validOpportunityIds.has(opportunityId)) {
      countsByCollection.opportunityStageEvents.rejected++;
      brokenRelationshipsCount++;
      issues.push({
        id: `event_missing_opp_${id}`,
        collection: 'opportunityStageEvents',
        recordId: id,
        severity: 'warning',
        code: 'MISSING_OPPORTUNITY_SKIPPED',
        messageAr: `تم استبعاد حدث المرحلة (${id}) لأن الفرصة المرتبطة به (${opportunityId}) غير موجودة.`,
      });
      continue;
    }

    const validEventTypes: OpportunityStageEventType[] = [
      'created',
      'stage_changed',
      'closed_won',
      'closed_lost',
      'reopened',
    ];
    const validStages: OpportunityStage[] = [
      'new',
      'qualification',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ];

    if (!validEventTypes.includes(obj.eventType) || !validStages.includes(obj.toStage)) {
      countsByCollection.opportunityStageEvents.rejected++;
      continue;
    }

    checkUnknownAndForbiddenKeys(
      obj,
      STAGE_EVENT_ALLOWED_KEYS,
      'opportunityStageEvents',
      id,
      id,
      issues
    );

    const ev: OpportunityStageEvent = {
      id,
      userId: uid,
      opportunityId,
      eventType: obj.eventType,
      toStage: obj.toStage,
      occurredAt: clampStr(obj.occurredAt, 50) || nowIso,
    };
    if (validStages.includes(obj.fromStage)) {
      ev.fromStage = obj.fromStage;
    }
    const note = clampStr(obj.note, 500);
    if (note) ev.note = note;

    seenEventIdsInFile.add(id);
    sanitizedBatch.opportunityStageEvents.push(ev);
    countsByCollection.opportunityStageEvents.validToImport++;
  }

  const totalInFile =
    countsByCollection.clients.totalInFile +
    countsByCollection.meetings.totalInFile +
    countsByCollection.tasks.totalInFile +
    countsByCollection.notes.totalInFile +
    countsByCollection.opportunities.totalInFile +
    countsByCollection.opportunityStageEvents.totalInFile;

  const totalValidToImport =
    countsByCollection.clients.validToImport +
    countsByCollection.meetings.validToImport +
    countsByCollection.tasks.validToImport +
    countsByCollection.notes.validToImport +
    countsByCollection.opportunities.validToImport +
    countsByCollection.opportunityStageEvents.validToImport;

  const totalDuplicatesSkipped =
    countsByCollection.clients.duplicateSkipped +
    countsByCollection.meetings.duplicateSkipped +
    countsByCollection.tasks.duplicateSkipped +
    countsByCollection.notes.duplicateSkipped +
    countsByCollection.opportunities.duplicateSkipped +
    countsByCollection.opportunityStageEvents.duplicateSkipped;

  const totalRejected =
    countsByCollection.clients.rejected +
    countsByCollection.meetings.rejected +
    countsByCollection.tasks.rejected +
    countsByCollection.notes.rejected +
    countsByCollection.opportunities.rejected +
    countsByCollection.opportunityStageEvents.rejected;

  return {
    canProceed: totalValidToImport > 0,
    fatalErrorAr:
      totalValidToImport === 0
        ? totalDuplicatesSkipped > 0
          ? 'جميع السجلات الواردة في الملف موجودة مسبقاً في حسابك (تم تخطي التكرارات بأمان).'
          : 'لا توجد سجلات صالحة للاستيراد في هذا الملف.'
        : undefined,
    format: 'murafiq_json',
    schemaVersionDetected,
    countsByCollection,
    totalInFile,
    totalValidToImport,
    totalDuplicatesSkipped,
    totalRejected,
    brokenRelationshipsCount,
    issues,
    sanitizedBatch,
  };
}

function validateClientsCsvImport(
  csvText: string,
  uid: string,
  existingData: ExistingUserDataForImport,
  nowIso: string
): ImportPreviewResult {
  const countsByCollection = createEmptyCountsByCollection();
  const sanitizedBatch = createEmptyBatch();
  const issues: ImportValidationIssue[] = [];

  let rows: string[][];
  try {
    rows = parseCsvText(csvText);
  } catch {
    issues.push({
      id: 'csv_malformed',
      collection: 'file',
      severity: 'error',
      code: 'INVALID_FORMAT',
      messageAr: 'تعذر قراءة ملف CSV بسبب علامات اقتباس غير مغلقة أو تنسيق غير صالح.',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'ملف CSV غير صالح.',
      format: 'clients_csv',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  if (rows.length < 2) {
    issues.push({
      id: 'csv_no_data_rows',
      collection: 'file',
      severity: 'error',
      code: 'INVALID_FORMAT',
      messageAr: 'ملف CSV يجب أن يحتوي على صف ترويسة الأعمدة وصف بيانات واحد على الأقل.',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'ملف CSV لا يحتوي على صفوف بيانات.',
      format: 'clients_csv',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const rawHeaders = rows[0].map((h) => normalizeArabicSearchText(h));
  const findColIdx = (candidates: string[]): number => {
    const normCandidates = candidates.map((c) => normalizeArabicSearchText(c));
    return rawHeaders.findIndex((h) => normCandidates.includes(h));
  };

  const nameIdx = findColIdx(['الاسم', 'اسم العميل', 'name', 'client name', 'full name']);
  if (nameIdx === -1) {
    issues.push({
      id: 'csv_missing_name_col',
      collection: 'file',
      severity: 'error',
      code: 'MISSING_REQUIRED_FIELD',
      messageAr: 'لم يتم العثور على عمود «الاسم» أو «name» الإلزامي في ترويسة ملف CSV.',
    });
    return {
      canProceed: false,
      fatalErrorAr: 'ملف CSV يفتقر إلى عمود «الاسم» الإلزامي.',
      format: 'clients_csv',
      countsByCollection,
      totalInFile: 0,
      totalValidToImport: 0,
      totalDuplicatesSkipped: 0,
      totalRejected: 0,
      brokenRelationshipsCount: 0,
      issues,
      sanitizedBatch,
    };
  }

  const idIdx = findColIdx(['معرف العميل', 'المعرف', 'id', 'client id']);
  const companyIdx = findColIdx(['الشركة', 'الجهة', 'company', 'organization']);
  const industryIdx = findColIdx(['القطاع', 'المجال', 'industry', 'sector']);
  const phoneIdx = findColIdx(['الهاتف', 'الجوال', 'رقم الهاتف', 'phone', 'mobile']);
  const emailIdx = findColIdx(['البريد الإلكتروني', 'البريد', 'email', 'e-mail']);
  const tagsIdx = findColIdx(['الوسوم', 'وسوم', 'tags']);
  const notesIdx = findColIdx(['ملاحظات', 'الملاحظات', 'notes']);

  const existingClientIds = new Set(existingData.clients.map((c) => c.id));
  const existingNaturalKeys = new Set(
    existingData.clients.map((c) =>
      normalizeArabicSearchText(`${c.name}|${c.company || ''}|${c.phone || ''}|${c.email || ''}`)
    )
  );
  const seenIds = new Set<string>();
  const seenNaturalKeys = new Set<string>();

  const dataRows = rows.slice(1);
  countsByCollection.clients.totalInFile = dataRows.length;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    // Strip leading single quote if it was neutralized on export
    const cleanCell = (idx: number, maxLen: number): string | undefined => {
      if (idx < 0 || idx >= row.length) return undefined;
      const rawVal = row[idx] || '';
      const unquoted =
        rawVal.startsWith("'") && FORMULA_DANGEROUS_PREFIX_REGEX.test(rawVal.slice(1))
          ? rawVal.slice(1)
          : rawVal;
      return clampStr(unquoted, maxLen);
    };

    const name = cleanCell(nameIdx, 150);
    if (!name) {
      countsByCollection.clients.rejected++;
      issues.push({
        id: `csv_row_no_name_${i + 2}`,
        collection: 'clients',
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELD',
        messageAr: `تم رفض الصف رقم ${i + 2} في ملف CSV لعدم وجود اسم العميل.`,
      });
      continue;
    }

    const company = cleanCell(companyIdx, 150);
    const industry = cleanCell(industryIdx, 100);
    const phone = cleanCell(phoneIdx, 50);
    const email = cleanCell(emailIdx, 150);
    const notes = cleanCell(notesIdx, 2000);
    const rawTags = cleanCell(tagsIdx, 500);

    const naturalKey = normalizeArabicSearchText(
      `${name}|${company || ''}|${phone || ''}|${email || ''}`
    );

    const rawId = idIdx >= 0 ? (row[idIdx] || '').trim() : '';
    let id: string;
    if (rawId) {
      if (!isValidFirestoreId(rawId)) {
        countsByCollection.clients.rejected++;
        issues.push({
          id: `csv_row_bad_id_${i + 2}`,
          collection: 'clients',
          recordId: rawId,
          recordTitle: name,
          severity: 'error',
          code: 'INVALID_ID',
          messageAr: `تم رفض العميل «${name}» في الصف ${i + 2} لأن المعرف (${rawId}) غير صالح.`,
        });
        continue;
      }
      id = rawId;
    } else {
      id = `client_csv_${deterministicHash(naturalKey || `${name}_${i}`)}`;
    }

    if (
      existingClientIds.has(id) ||
      seenIds.has(id) ||
      existingNaturalKeys.has(naturalKey) ||
      seenNaturalKeys.has(naturalKey)
    ) {
      countsByCollection.clients.duplicateSkipped++;
      issues.push({
        id: `csv_dup_${id}_${i}`,
        collection: 'clients',
        recordId: id,
        recordTitle: name,
        severity: 'warning',
        code: 'DUPLICATE_SKIPPED',
        messageAr: `تم تخطي العميل «${name}» لأنه موجود مسبقاً.`,
      });
      continue;
    }

    const client: Client = {
      id,
      userId: uid,
      name,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (company) client.company = company;
    if (industry) client.industry = industry;
    if (phone) client.phone = phone;
    if (email) client.email = email;
    if (notes) client.notes = notes;
    if (rawTags) {
      const tags = rawTags
        .split(/[|،,]/)
        .map((t) => clampStr(t, 60))
        .filter((t): t is string => Boolean(t))
        .slice(0, 20);
      if (tags.length > 0) client.tags = tags;
    }

    seenIds.add(id);
    seenNaturalKeys.add(naturalKey);
    sanitizedBatch.clients.push(client);
    countsByCollection.clients.validToImport++;
  }

  const totalInFile = countsByCollection.clients.totalInFile;
  const totalValidToImport = countsByCollection.clients.validToImport;
  const totalDuplicatesSkipped = countsByCollection.clients.duplicateSkipped;
  const totalRejected = countsByCollection.clients.rejected;

  return {
    canProceed: totalValidToImport > 0,
    fatalErrorAr:
      totalValidToImport === 0
        ? totalDuplicatesSkipped > 0
          ? 'جميع العملاء في ملف CSV موجودون مسبقاً في حسابك.'
          : 'لم يتم العثور على سجلات عملاء صالحة للاستيراد في ملف CSV.'
        : undefined,
    format: 'clients_csv',
    countsByCollection,
    totalInFile,
    totalValidToImport,
    totalDuplicatesSkipped,
    totalRejected,
    brokenRelationshipsCount: 0,
    issues,
    sanitizedBatch,
  };
}

// ============================================================================
// Stage 4: Explicit Confirmation & Safe Topological Import Execution
// ============================================================================

export interface ImportPersistenceHandlers {
  saveClient: (client: Client) => Promise<void>;
  saveOpportunity: (opportunity: Opportunity) => Promise<void>;
  saveMeeting: (meeting: Meeting) => Promise<void>;
  saveTask: (task: ActionItem) => Promise<void>;
  saveNote: (note: Note) => Promise<void>;
  saveOpportunityStageEvent: (event: OpportunityStageEvent) => Promise<void>;
}

export interface ExecuteSafeImportParams {
  preview: ImportPreviewResult;
  confirmed: boolean;
  isOnline: boolean;
  handlers: ImportPersistenceHandlers;
  previousSucceededKeys?: Iterable<string>;
}

function createEmptyCollectionExecutionReport(
  skippedDuplicates = 0
): ImportCollectionExecutionReport {
  return {
    attempted: 0,
    succeeded: 0,
    skippedDuplicates,
    failed: 0,
    failedItems: [],
  };
}

/**
 * Executes a validated import preview only after explicit user confirmation (`confirmed === true`)
 * and while online (`isOnline === true`).
 * Writes records in topological order:
 * 1. clients -> 2. opportunities -> 3. meetings -> 4. tasks -> 5. notes -> 6. opportunityStageEvents.
 * Supports safe retry without duplicating already-succeeded records via `previousSucceededKeys`.
 */
export async function executeSafeImportPlan(
  params: ExecuteSafeImportParams
): Promise<ImportExecutionReport> {
  const startedAt = new Date().toISOString();
  const succeededSet = new Set<string>(params.previousSucceededKeys || []);

  const collections = {
    clients: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.clients.duplicateSkipped
    ),
    opportunities: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.opportunities.duplicateSkipped
    ),
    meetings: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.meetings.duplicateSkipped
    ),
    tasks: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.tasks.duplicateSkipped
    ),
    notes: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.notes.duplicateSkipped
    ),
    opportunityStageEvents: createEmptyCollectionExecutionReport(
      params.preview.countsByCollection.opportunityStageEvents.duplicateSkipped
    ),
  };

  const totalSkippedDuplicates = params.preview.totalDuplicatesSkipped;

  if (!params.confirmed) {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'blocked_unconfirmed',
      messageAr: 'لا يمكن بدء الاستيراد قبل التأكيد الصريح من المستخدم.',
      collections,
      totalSucceeded: 0,
      totalSkippedDuplicates,
      totalFailed: 0,
      succeededRecordKeys: Array.from(succeededSet),
    };
  }

  if (!params.isOnline) {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'blocked_offline',
      messageAr:
        'الاستيراد غير متاح في وضع عدم الاتصال (Offline). يرجى الاتصال بالإنترنت أولاً لضمان التحقق من السجلات وحفظها بأمان.',
      collections,
      totalSucceeded: 0,
      totalSkippedDuplicates,
      totalFailed: 0,
      succeededRecordKeys: Array.from(succeededSet),
    };
  }

  if (!params.preview.canProceed) {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'failed',
      messageAr: params.preview.fatalErrorAr || 'لا توجد سجلات صالحة للاستيراد.',
      collections,
      totalSucceeded: 0,
      totalSkippedDuplicates,
      totalFailed: 0,
      succeededRecordKeys: Array.from(succeededSet),
    };
  }

  const batch = params.preview.sanitizedBatch;
  const confirmedClientIds = new Set<string>();
  const confirmedOpportunityIds = new Set<string>();

  // 1. Import Clients
  for (const client of batch.clients) {
    const key = `clients:${client.id}`;
    if (succeededSet.has(key)) {
      confirmedClientIds.add(client.id);
      continue;
    }
    collections.clients.attempted++;
    try {
      await params.handlers.saveClient(client);
      collections.clients.succeeded++;
      succeededSet.add(key);
      confirmedClientIds.add(client.id);
    } catch (err: any) {
      collections.clients.failed++;
      collections.clients.failedItems.push({
        id: client.id,
        title: client.name,
        errorAr: err?.message || 'تعذر حفظ سجل العميل.',
      });
    }
  }

  const failedClientIds = new Set(collections.clients.failedItems.map((f) => f.id));

  // 2. Import Opportunities
  for (const opp of batch.opportunities) {
    const key = `opportunities:${opp.id}`;
    if (succeededSet.has(key)) {
      confirmedOpportunityIds.add(opp.id);
      continue;
    }
    collections.opportunities.attempted++;
    if (failedClientIds.has(opp.clientId)) {
      collections.opportunities.failed++;
      collections.opportunities.failedItems.push({
        id: opp.id,
        title: opp.title,
        errorAr: 'تعذر حفظ الفرصة بسبب فشل حفظ العميل المرتبط بها.',
      });
      continue;
    }
    try {
      await params.handlers.saveOpportunity(opp);
      collections.opportunities.succeeded++;
      succeededSet.add(key);
      confirmedOpportunityIds.add(opp.id);
    } catch (err: any) {
      collections.opportunities.failed++;
      collections.opportunities.failedItems.push({
        id: opp.id,
        title: opp.title,
        errorAr: err?.message || 'تعذر حفظ سجل الفرصة.',
      });
    }
  }

  const failedOppIds = new Set(collections.opportunities.failedItems.map((f) => f.id));

  // 3. Import Meetings
  for (const meeting of batch.meetings) {
    const key = `meetings:${meeting.id}`;
    if (succeededSet.has(key)) continue;
    collections.meetings.attempted++;
    if (failedClientIds.has(meeting.clientId)) {
      collections.meetings.failed++;
      collections.meetings.failedItems.push({
        id: meeting.id,
        title: meeting.title,
        errorAr: 'تعذر حفظ الاجتماع بسبب فشل حفظ العميل المرتبط به.',
      });
      continue;
    }
    try {
      await params.handlers.saveMeeting(meeting);
      collections.meetings.succeeded++;
      succeededSet.add(key);
    } catch (err: any) {
      collections.meetings.failed++;
      collections.meetings.failedItems.push({
        id: meeting.id,
        title: meeting.title,
        errorAr: err?.message || 'تعذر حفظ سجل الاجتماع.',
      });
    }
  }

  // 4. Import Tasks
  for (const task of batch.tasks) {
    const key = `tasks:${task.id}`;
    if (succeededSet.has(key)) continue;
    collections.tasks.attempted++;
    if (failedClientIds.has(task.clientId)) {
      collections.tasks.failed++;
      collections.tasks.failedItems.push({
        id: task.id,
        title: task.title,
        errorAr: 'تعذر حفظ المهمة بسبب فشل حفظ العميل المرتبط بها.',
      });
      continue;
    }
    try {
      await params.handlers.saveTask(task);
      collections.tasks.succeeded++;
      succeededSet.add(key);
    } catch (err: any) {
      collections.tasks.failed++;
      collections.tasks.failedItems.push({
        id: task.id,
        title: task.title,
        errorAr: err?.message || 'تعذر حفظ سجل المهمة.',
      });
    }
  }

  // 5. Import Notes
  for (const note of batch.notes) {
    const key = `notes:${note.id}`;
    if (succeededSet.has(key)) continue;
    collections.notes.attempted++;
    try {
      await params.handlers.saveNote(note);
      collections.notes.succeeded++;
      succeededSet.add(key);
    } catch (err: any) {
      collections.notes.failed++;
      collections.notes.failedItems.push({
        id: note.id,
        title: note.title,
        errorAr: err?.message || 'تعذر حفظ سجل الملاحظة.',
      });
    }
  }

  // 6. Import Opportunity Stage Events
  for (const ev of batch.opportunityStageEvents) {
    const key = `opportunityStageEvents:${ev.id}`;
    if (succeededSet.has(key)) continue;
    collections.opportunityStageEvents.attempted++;
    if (failedOppIds.has(ev.opportunityId)) {
      collections.opportunityStageEvents.failed++;
      collections.opportunityStageEvents.failedItems.push({
        id: ev.id,
        title: `حدث مرحلة (${ev.opportunityId})`,
        errorAr: 'تعذر حفظ حدث المرحلة بسبب فشل حفظ الفرصة المرتبطة به.',
      });
      continue;
    }
    try {
      await params.handlers.saveOpportunityStageEvent(ev);
      collections.opportunityStageEvents.succeeded++;
      succeededSet.add(key);
    } catch (err: any) {
      collections.opportunityStageEvents.failed++;
      collections.opportunityStageEvents.failedItems.push({
        id: ev.id,
        title: `حدث مرحلة (${ev.opportunityId})`,
        errorAr: err?.message || 'تعذر حفظ سجل حدث المرحلة.',
      });
    }
  }

  const totalSucceeded =
    collections.clients.succeeded +
    collections.opportunities.succeeded +
    collections.meetings.succeeded +
    collections.tasks.succeeded +
    collections.notes.succeeded +
    collections.opportunityStageEvents.succeeded;

  const totalFailed =
    collections.clients.failed +
    collections.opportunities.failed +
    collections.meetings.failed +
    collections.tasks.failed +
    collections.notes.failed +
    collections.opportunityStageEvents.failed;

  const status: ImportExecutionReport['status'] =
    totalFailed === 0
      ? 'completed'
      : totalSucceeded > 0 || succeededSet.size > 0
      ? 'partial_failure'
      : 'failed';

  const messageAr =
    status === 'completed'
      ? `تم استيراد ${totalSucceeded} سجل بنجاح دون المساس ببياناتك السابقة.`
      : status === 'partial_failure'
      ? `اكتمل استيراد ${totalSucceeded} سجل بنجاح، وتعذر حفظ ${totalFailed} سجل. يمكنك إعادة محاولة السجلات الفاشلة فقط دون تكرار ما نجح.`
      : `فشل استيراد السجلات (${totalFailed} سجل فاشل). يرجى التحقق من الاتصال والمحاولة مجدداً.`;

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    messageAr,
    collections,
    totalSucceeded,
    totalSkippedDuplicates,
    totalFailed,
    succeededRecordKeys: Array.from(succeededSet),
  };
}
