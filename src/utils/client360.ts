import {
  ActionItem,
  Client,
  ClientCategory,
  ClientContact,
  ClientImportanceLevel,
  ClientRelationshipStatus,
  Meeting,
  Note,
  ProvenanceType,
} from '../types';

export const MAX_CLIENT_TAGS = 20;
export const MAX_CLIENT_CONTACTS = 25;
export const STALE_CONTACT_THRESHOLD_DAYS = 30;

export const CLIENT_RELATIONSHIP_STATUS_CONFIG: Record<
  ClientRelationshipStatus,
  { labelAr: string; labelEn: string; badgeClass: string; dotClass: string }
> = {
  lead: {
    labelAr: 'عميل محتمل',
    labelEn: 'Lead',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  initial_contact: {
    labelAr: 'تواصل أولي',
    labelEn: 'Initial Contact',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    dotClass: 'bg-indigo-500',
  },
  active: {
    labelAr: 'نشط',
    labelEn: 'Active',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-600',
  },
  follow_up_needed: {
    labelAr: 'يحتاج متابعة',
    labelEn: 'Needs Follow-up',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  inactive: {
    labelAr: 'متوقف',
    labelEn: 'Inactive',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
    dotClass: 'bg-stone-400',
  },
};

export const CLIENT_IMPORTANCE_CONFIG: Record<
  ClientImportanceLevel,
  { labelAr: string; labelEn: string; badgeClass: string; rank: number }
> = {
  high: {
    labelAr: 'مهم',
    labelEn: 'High',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    rank: 3,
  },
  medium: {
    labelAr: 'عادي',
    labelEn: 'Normal',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
    rank: 2,
  },
  low: {
    labelAr: 'منخفض الأولوية',
    labelEn: 'Low',
    badgeClass: 'bg-stone-50 text-stone-500 border-stone-200',
    rank: 1,
  },
};

export const CLIENT_CATEGORY_LABELS: Record<ClientCategory, { ar: string; en: string }> = {
  vip: { ar: 'كبار العملاء (VIP)', en: 'VIP' },
  corporate: { ar: 'شركات ومؤسسات', en: 'Corporate' },
  sme: { ar: 'منشآت صغيرة ومتوسطة', en: 'SME' },
  individual: { ar: 'أفراد', en: 'Individual' },
  partner: { ar: 'شريك عمل', en: 'Partner' },
  other: { ar: 'أخرى', en: 'Other' },
};

export function getClientCategoryLabel(category?: string, language: 'ar' | 'en' = 'ar'): string {
  if (!category) return '';
  if (category in CLIENT_CATEGORY_LABELS) {
    return CLIENT_CATEGORY_LABELS[category as ClientCategory][language];
  }
  return category;
}

/**
 * Normalize Arabic and Latin text for clean comparison & duplicate detection.
 */
export function normalizeTextForMatch(value?: string): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // Strip Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

/**
 * Normalize phone numbers so local and international variants (+9665... vs 05...) match reliably.
 */
export function normalizePhoneForMatch(phone?: string): string {
  if (!phone) return '';
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('966') && digits.length >= 11) {
    digits = `0${digits.slice(3)}`;
  }
  return digits;
}

export function isValidPhoneForTel(phone?: string): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (!trimmed || /[:<>]/.test(trimmed)) return false;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits.length >= 7;
}

export function sanitizePhoneForTel(phone?: string): string | null {
  if (!isValidPhoneForTel(phone)) return null;
  return phone!.trim().replace(/[^0-9+]/g, '');
}

export function sanitizePhoneForWhatsApp(phone?: string): string | null {
  if (!isValidPhoneForTel(phone)) return null;
  let digits = phone!.replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('05') && digits.length === 10) {
    digits = `966${digits.slice(1)}`;
  }
  return digits.length >= 7 ? digits : null;
}

export function isValidEmailAddress(email?: string): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 150) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function sanitizeWebsiteUrl(website?: string): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// ============================================================================
// Client Contacts Management (Embedded bounded array, <= 1 primary contact)
// ============================================================================

export function normalizeClientContacts(contacts?: ClientContact[]): ClientContact[] {
  if (!Array.isArray(contacts)) return [];
  const seenIds = new Set<string>();
  let primaryAssigned = false;

  const cleaned: ClientContact[] = [];
  for (const raw of contacts) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;

    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `cc-${cleaned.length + 1}`;
    if (seenIds.has(id)) {
      id = `${id}-${cleaned.length + 1}`;
    }
    seenIds.add(id);

    const wantsPrimary = Boolean(raw.isPrimary);
    const isPrimary = wantsPrimary && !primaryAssigned;
    if (isPrimary) {
      primaryAssigned = true;
    }

    cleaned.push({
      id,
      name: name.slice(0, 120),
      title: raw.title?.trim() ? raw.title.trim().slice(0, 120) : undefined,
      department: raw.department?.trim() ? raw.department.trim().slice(0, 120) : undefined,
      phone: raw.phone?.trim() ? raw.phone.trim().slice(0, 50) : undefined,
      email: raw.email?.trim() ? raw.email.trim().slice(0, 150) : undefined,
      notes: raw.notes?.trim() ? raw.notes.trim().slice(0, 500) : undefined,
      isPrimary,
      createdAt: raw.createdAt || undefined,
      updatedAt: raw.updatedAt || undefined,
    });

    if (cleaned.length >= MAX_CLIENT_CONTACTS) break;
  }

  return cleaned;
}

export function addClientContact(
  contacts: ClientContact[] | undefined,
  input: Omit<ClientContact, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  nowIso = new Date().toISOString()
): ClientContact[] {
  const existing = normalizeClientContacts(contacts);
  const name = input.name.trim();
  if (!name || existing.length >= MAX_CLIENT_CONTACTS) {
    return existing;
  }

  const shouldBePrimary = Boolean(input.isPrimary);
  const baseList = shouldBePrimary
    ? existing.map((c) => ({ ...c, isPrimary: false }))
    : existing;

  const newContact: ClientContact = {
    id: input.id?.trim() || `cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 120),
    title: input.title?.trim() ? input.title.trim().slice(0, 120) : undefined,
    department: input.department?.trim() ? input.department.trim().slice(0, 120) : undefined,
    phone: input.phone?.trim() ? input.phone.trim().slice(0, 50) : undefined,
    email: input.email?.trim() ? input.email.trim().slice(0, 150) : undefined,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 500) : undefined,
    isPrimary: shouldBePrimary,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return normalizeClientContacts([...baseList, newContact]);
}

export function updateClientContact(
  contacts: ClientContact[] | undefined,
  contactId: string,
  patch: Partial<Omit<ClientContact, 'id'>>,
  nowIso = new Date().toISOString()
): ClientContact[] {
  const existing = normalizeClientContacts(contacts);
  const promotingToPrimary = patch.isPrimary === true;

  const updated = existing.map((c) => {
    if (c.id !== contactId) {
      return promotingToPrimary ? { ...c, isPrimary: false } : c;
    }
    return {
      ...c,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || c.name : c.name,
      isPrimary: patch.isPrimary !== undefined ? patch.isPrimary : c.isPrimary,
      updatedAt: nowIso,
    };
  });

  return normalizeClientContacts(updated);
}

export function removeClientContact(
  contacts: ClientContact[] | undefined,
  contactId: string
): ClientContact[] {
  return normalizeClientContacts((contacts || []).filter((c) => c.id !== contactId));
}

export function setPrimaryClientContact(
  contacts: ClientContact[] | undefined,
  contactId: string,
  nowIso = new Date().toISOString()
): ClientContact[] {
  const existing = normalizeClientContacts(contacts);
  const exists = existing.some((c) => c.id === contactId);
  if (!exists) return existing;

  return existing.map((c) => ({
    ...c,
    isPrimary: c.id === contactId,
    updatedAt: c.id === contactId ? nowIso : c.updatedAt,
  }));
}

export function sanitizeClientTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim().slice(0, 50);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_CLIENT_TAGS) break;
  }
  return result;
}

export function sanitizeClientForSave(client: Client): Client {
  const cleanTags = sanitizeClientTags(client.tags);
  const cleanContacts = normalizeClientContacts(client.contacts);

  const sanitized: Client = {
    id: client.id,
    userId: client.userId,
    name: client.name.trim().slice(0, 150),
    company: client.company?.trim() ? client.company.trim().slice(0, 150) : undefined,
    phone: client.phone?.trim() ? client.phone.trim().slice(0, 50) : undefined,
    email: client.email?.trim() ? client.email.trim().slice(0, 150) : undefined,
    notes: client.notes?.trim() ? client.notes.trim().slice(0, 2000) : undefined,
    avatarPath: client.avatarPath?.trim() ? client.avatarPath.trim().slice(0, 500) : undefined,
    color: client.color?.trim() ? client.color.trim().slice(0, 30) : undefined,
    isFavorite: client.isFavorite,
    industry: client.industry?.trim() ? client.industry.trim().slice(0, 100) : undefined,
    category: client.category?.trim() ? client.category.trim().slice(0, 80) : undefined,
    relationshipStatus: client.relationshipStatus,
    importance: client.importance,
    tags: cleanTags.length > 0 ? cleanTags : undefined,
    website: client.website?.trim() ? client.website.trim().slice(0, 250) : undefined,
    address: client.address?.trim() ? client.address.trim().slice(0, 300) : undefined,
    source: client.source?.trim() ? client.source.trim().slice(0, 150) : undefined,
    description: client.description?.trim() ? client.description.trim().slice(0, 1000) : undefined,
    contacts: cleanContacts.length > 0 ? cleanContacts : undefined,
    createdAt: client.createdAt || new Date().toISOString(),
    updatedAt: client.updatedAt || new Date().toISOString(),
  };

  return sanitized;
}

// ============================================================================
// Indexed Per-Client Lookup (Avoids N+1 Queries / Scans)
// ============================================================================

export interface ClientDataIndex {
  meetingsByClient: Map<string, Meeting[]>;
  tasksByClient: Map<string, ActionItem[]>;
  notesByClient: Map<string, Note[]>;
}

export function buildClientDataIndex(params: {
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
}): ClientDataIndex {
  const meetingsByClient = new Map<string, Meeting[]>();
  const tasksByClient = new Map<string, ActionItem[]>();
  const notesByClient = new Map<string, Note[]>();

  for (const m of params.meetings) {
    if (!m.clientId) continue;
    const arr = meetingsByClient.get(m.clientId);
    if (arr) arr.push(m);
    else meetingsByClient.set(m.clientId, [m]);
  }

  for (const t of params.tasks) {
    if (!t.clientId) continue;
    const arr = tasksByClient.get(t.clientId);
    if (arr) arr.push(t);
    else tasksByClient.set(t.clientId, [t]);
  }

  for (const n of params.notes) {
    if (!n.clientId) continue;
    const arr = notesByClient.get(n.clientId);
    if (arr) arr.push(n);
    else notesByClient.set(n.clientId, [n]);
  }

  return { meetingsByClient, tasksByClient, notesByClient };
}

// ============================================================================
// Client 360 KPIs & Real-Data Sync State
// ============================================================================

export interface ClientKpis {
  totalMeetings: number;
  upcomingMeetings: number;
  openTasks: number;
  overdueTasks: number;
  completedTasks: number;
  notesCount: number;
  contactsCount: number;
  lastContactAt: string | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
}

function parseValidTime(iso?: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function parseTaskDueMidnight(dueDate?: string): number | null {
  if (!dueDate) return null;
  const match = dueDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return new Date(year, month - 1, day).getTime();
  }
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function computeClientKpis(params: {
  client: Client;
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  referenceDate?: Date;
}): ClientKpis {
  const { client, meetings, tasks, notes, referenceDate = new Date() } = params;
  const refTime = referenceDate.getTime();
  const refMidnight = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  ).getTime();

  const clientMeetings = meetings.filter((m) => m.clientId === client.id);
  const clientTasks = tasks.filter((t) => t.clientId === client.id);
  const clientNotes = notes.filter((n) => n.clientId === client.id);

  let upcomingMeetings = 0;
  let lastContactMs: number | null = null;
  let lastContactAt: string | null = null;
  let nextFollowUpMs: number | null = null;
  let nextFollowUpAt: string | null = null;

  const activityCandidates: { ms: number; iso: string }[] = [];

  for (const m of clientMeetings) {
    const mTime = parseValidTime(m.dateTime);
    if (m.status !== 'cancelled' && mTime !== null) {
      if (mTime >= refTime && m.status !== 'completed') {
        upcomingMeetings += 1;
        if (nextFollowUpMs === null || mTime < nextFollowUpMs) {
          nextFollowUpMs = mTime;
          nextFollowUpAt = m.dateTime;
        }
      }
      if (mTime <= refTime || m.status === 'completed') {
        if (lastContactMs === null || mTime > lastContactMs) {
          lastContactMs = mTime;
          lastContactAt = m.dateTime;
        }
        activityCandidates.push({ ms: mTime, iso: m.dateTime });
      }
    }

    const followUpMs = parseValidTime(m.followUpDateTime);
    if (followUpMs !== null && followUpMs >= refTime) {
      if (nextFollowUpMs === null || followUpMs < nextFollowUpMs) {
        nextFollowUpMs = followUpMs;
        nextFollowUpAt = m.followUpDateTime!;
      }
    }

    for (const d of m.decisions || []) {
      const dMs = parseValidTime(d.createdAt);
      if (dMs !== null && dMs <= refTime) {
        activityCandidates.push({ ms: dMs, iso: d.createdAt });
      }
    }

    // If meeting was only scheduled in the future, its creation is still a recorded activity
    const mCreatedMs = parseValidTime(m.createdAt);
    if (mCreatedMs !== null && mCreatedMs <= refTime) {
      activityCandidates.push({ ms: mCreatedMs, iso: m.createdAt });
    }
  }

  let openTasks = 0;
  let overdueTasks = 0;
  let completedTasks = 0;

  for (const t of clientTasks) {
    if (t.status === 'completed') {
      completedTasks += 1;
      const doneMs = parseValidTime(t.completedAt) ?? parseValidTime(t.createdAt);
      if (doneMs !== null && doneMs <= refTime) {
        activityCandidates.push({
          ms: doneMs,
          iso: t.completedAt || t.createdAt,
        });
      }
      continue;
    }
    if (t.status === 'cancelled') {
      continue;
    }

    openTasks += 1;
    const dueMidnight = parseTaskDueMidnight(t.dueDate);
    if (dueMidnight !== null && dueMidnight < refMidnight) {
      overdueTasks += 1;
    }

    const tCreatedMs = parseValidTime(t.createdAt);
    if (tCreatedMs !== null && tCreatedMs <= refTime) {
      activityCandidates.push({ ms: tCreatedMs, iso: t.createdAt });
    }
  }

  for (const n of clientNotes) {
    const noteIso = n.updatedAt || n.createdAt;
    const noteMs = parseValidTime(noteIso);
    if (noteMs !== null && noteMs <= refTime) {
      activityCandidates.push({ ms: noteMs, iso: noteIso });
    }
  }

  let lastActivityAt: string | null = null;
  let lastActivityMs = -Infinity;
  for (const item of activityCandidates) {
    if (item.ms > lastActivityMs) {
      lastActivityMs = item.ms;
      lastActivityAt = item.iso;
    }
  }

  return {
    totalMeetings: clientMeetings.length,
    upcomingMeetings,
    openTasks,
    overdueTasks,
    completedTasks,
    notesCount: clientNotes.length,
    contactsCount: (client.contacts || []).length,
    lastContactAt,
    lastActivityAt,
    nextFollowUpAt,
  };
}

export type ClientSyncStatusKind = 'loading' | 'error' | 'failed' | 'offline_pending' | 'synced';

export interface ClientSyncDisplayState {
  kind: ClientSyncStatusKind;
  labelArabic: string;
  labelEnglish: string;
  isReliableComplete: boolean;
}

export function deriveClientSyncDisplayState(params: {
  clientsLoaded: boolean;
  meetingsLoaded: boolean;
  tasksLoaded: boolean;
  notesLoaded: boolean;
  hasAnyError: boolean;
  hasPendingWrites: boolean;
  isClientDocPending: boolean;
  hasRejectedClientWrite: boolean;
  isOnline: boolean;
}): ClientSyncDisplayState {
  if (params.hasRejectedClientWrite) {
    return {
      kind: 'failed',
      labelArabic: 'تعذرت المزامنة السحابية — مسودة محفوظة مؤقتاً',
      labelEnglish: 'Sync failed — local draft preserved',
      isReliableComplete: false,
    };
  }
  if (params.hasAnyError) {
    return {
      kind: 'error',
      labelArabic: 'تعذر تحميل بعض السجلات من السحابة',
      labelEnglish: 'Failed to sync some collections',
      isReliableComplete: false,
    };
  }
  if (
    !params.clientsLoaded ||
    !params.meetingsLoaded ||
    !params.tasksLoaded ||
    !params.notesLoaded
  ) {
    return {
      kind: 'loading',
      labelArabic: 'جاري تحميل بيانات العميل...',
      labelEnglish: 'Loading client records...',
      isReliableComplete: false,
    };
  }
  if (!params.isOnline || params.isClientDocPending || params.hasPendingWrites) {
    return {
      kind: 'offline_pending',
      labelArabic: !params.isOnline
        ? 'وضع عدم الاتصال — البيانات من الذاكرة المحلية وبانتظار المزامنة'
        : 'بانتظار تأكيد المزامنة السحابية',
      labelEnglish: !params.isOnline
        ? 'Offline — local records pending sync'
        : 'Pending cloud sync confirmation',
      isReliableComplete: false,
    };
  }
  return {
    kind: 'synced',
    labelArabic: 'متزامن مع السحابة',
    labelEnglish: 'Synced',
    isReliableComplete: true,
  };
}

// ============================================================================
// Unified Chronological Client Activity Timeline (No Duplication)
// ============================================================================

export type ClientTimelineEventType = 'meeting' | 'task' | 'note' | 'decision';

export interface ClientTimelineEvent {
  id: string;
  clientId: string;
  type: ClientTimelineEventType;
  subKind?: 'scheduled_follow_up';
  timestamp: string;
  sortMs: number;
  title: string;
  summary?: string;
  statusLabelAr?: string;
  provenance: ProvenanceType;
  sourceType: 'meeting' | 'task' | 'note';
  sourceId: string;
  meetingId?: string;
}

export function buildClientActivityTimeline(params: {
  clientId: string;
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  filterType?: 'all' | ClientTimelineEventType;
  sortOrder?: 'desc' | 'asc';
}): ClientTimelineEvent[] {
  const {
    clientId,
    meetings,
    tasks,
    notes,
    filterType = 'all',
    sortOrder = 'desc',
  } = params;

  const events: ClientTimelineEvent[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (event: ClientTimelineEvent) => {
    if (seenIds.has(event.id)) return;
    seenIds.add(event.id);
    events.push(event);
  };

  for (const m of meetings) {
    if (m.clientId !== clientId) continue;

    const mMs = parseValidTime(m.dateTime) ?? parseValidTime(m.createdAt) ?? 0;
    const statusLabelAr =
      m.status === 'completed'
        ? 'منتهي'
        : m.status === 'confirmed'
        ? 'مؤكد'
        : m.status === 'cancelled'
        ? 'ملغي'
        : 'مسودة';

    pushUnique({
      id: `meeting:${m.id}`,
      clientId,
      type: 'meeting',
      timestamp: m.dateTime || m.createdAt,
      sortMs: mMs,
      title: m.title,
      summary: m.discussionSummary || m.notes || undefined,
      statusLabelAr,
      provenance: 'source',
      sourceType: 'meeting',
      sourceId: m.id,
      meetingId: m.id,
    });

    if (m.followUpDateTime && m.followUpDateTime !== m.dateTime) {
      const fMs = parseValidTime(m.followUpDateTime);
      if (fMs !== null) {
        pushUnique({
          id: `followup:${m.id}`,
          clientId,
          type: 'meeting',
          subKind: 'scheduled_follow_up',
          timestamp: m.followUpDateTime,
          sortMs: fMs,
          title: `متابعة مجدولة: ${m.title}`,
          statusLabelAr: 'متابعة مجدولة',
          provenance: 'approved',
          sourceType: 'meeting',
          sourceId: m.id,
          meetingId: m.id,
        });
      }
    }

    for (const d of m.decisions || []) {
      const dTime = d.createdAt || m.dateTime || m.createdAt;
      const dMs = parseValidTime(dTime) ?? mMs;
      pushUnique({
        id: `decision:${m.id}:${d.id}`,
        clientId,
        type: 'decision',
        timestamp: dTime,
        sortMs: dMs,
        title: d.text,
        summary: d.ownerName ? `المسؤول: ${d.ownerName} • ضمن «${m.title}»` : `ضمن «${m.title}»`,
        statusLabelAr: 'قرار معتمد',
        provenance: 'approved',
        sourceType: 'meeting',
        sourceId: m.id,
        meetingId: m.id,
      });
    }
  }

  for (const t of tasks) {
    if (t.clientId !== clientId) continue;
    const timestamp =
      t.status === 'completed'
        ? t.completedAt || t.createdAt || t.dueDate || ''
        : t.dueDate || t.createdAt || '';
    const tMs =
      parseValidTime(timestamp) ??
      parseValidTime(t.createdAt) ??
      0;

    const statusLabelAr =
      t.status === 'completed'
        ? 'منجزة'
        : t.status === 'in_progress'
        ? 'قيد التنفيذ'
        : t.status === 'cancelled'
        ? 'ملغاة'
        : 'مفتوحة';

    pushUnique({
      id: `task:${t.id}`,
      clientId,
      type: 'task',
      timestamp,
      sortMs: tMs,
      title: t.title,
      summary: t.description || undefined,
      statusLabelAr,
      provenance: t.provenance || 'approved',
      sourceType: 'task',
      sourceId: t.id,
      meetingId: t.meetingId,
    });
  }

  for (const n of notes) {
    if (n.clientId !== clientId) continue;
    const timestamp = n.updatedAt || n.createdAt;
    const nMs = parseValidTime(timestamp) ?? 0;

    pushUnique({
      id: `note:${n.id}`,
      clientId,
      type: 'note',
      timestamp,
      sortMs: nMs,
      title: n.title,
      summary: n.content,
      statusLabelAr: n.isPinned ? 'مثبتة' : 'ملاحظة',
      provenance: 'source',
      sourceType: 'note',
      sourceId: n.id,
    });
  }

  const filtered =
    filterType === 'all' ? events : events.filter((ev) => ev.type === filterType);

  return filtered.sort((a, b) =>
    sortOrder === 'asc' ? a.sortMs - b.sortMs : b.sortMs - a.sortMs
  );
}

// ============================================================================
// Deterministic Relationship Attention Alerts (Non-AI, Rule-based)
// ============================================================================

export type ClientAttentionAlertKind =
  | 'overdue_tasks'
  | 'stale_contact'
  | 'upcoming_meeting'
  | 'high_priority_tasks';

export type ClientAttentionSeverity = 'high' | 'medium' | 'info';

export interface ClientAttentionAlert {
  id: string;
  kind: ClientAttentionAlertKind;
  severity: ClientAttentionSeverity;
  titleArabic: string;
  messageArabic: string;
  basisDisclosureArabic?: string;
  actionLabelArabic: string;
  actionType: 'view_tasks' | 'schedule_meeting' | 'open_meeting';
  meetingId?: string;
}

function formatCountLabelAr(count: number, singular: string, dual: string, plural3to10: string, plural11Plus: string): string {
  if (count === 1) return singular;
  if (count === 2) return dual;
  if (count <= 10) return `${count} ${plural3to10}`;
  return `${count} ${plural11Plus}`;
}

export function evaluateClientAttentionAlerts(params: {
  client: Client;
  meetings: Meeting[];
  tasks: ActionItem[];
  staleThresholdDays?: number;
  referenceDate?: Date;
}): ClientAttentionAlert[] {
  const {
    client,
    meetings,
    tasks,
    staleThresholdDays = STALE_CONTACT_THRESHOLD_DAYS,
    referenceDate = new Date(),
  } = params;

  const refTime = referenceDate.getTime();
  const refMidnight = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  ).getTime();
  const dayMs = 1000 * 60 * 60 * 24;

  const clientMeetings = meetings.filter((m) => m.clientId === client.id);
  const clientTasks = tasks.filter((t) => t.clientId === client.id);

  const alerts: ClientAttentionAlert[] = [];

  // A. Overdue open tasks
  const overdueTasks = clientTasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    const dueMidnight = parseTaskDueMidnight(t.dueDate);
    return dueMidnight !== null && dueMidnight < refMidnight;
  });

  if (overdueTasks.length > 0) {
    const countText = formatCountLabelAr(
      overdueTasks.length,
      'مهمة متأخرة',
      'مهمتين متأخرتين',
      'مهام متأخرة',
      'مهمة متأخرة'
    );
    alerts.push({
      id: `alert:overdue:${client.id}`,
      kind: 'overdue_tasks',
      severity: 'high',
      titleArabic: 'مهام متأخرة',
      messageArabic: `لديك ${countText} مرتبطة بهذا العميل.`,
      actionLabelArabic: 'مراجعة المهام',
      actionType: 'view_tasks',
    });
  }

  // C. Upcoming meeting within next 48 hours
  const upcomingSoonMeetings = clientMeetings
    .filter((m) => m.status !== 'completed' && m.status !== 'cancelled')
    .map((m) => ({ meeting: m, ms: parseValidTime(m.dateTime) }))
    .filter((x): x is { meeting: Meeting; ms: number } => {
      if (x.ms === null) return false;
      const diff = x.ms - refTime;
      return diff >= -3600000 && diff <= 48 * 3600000;
    })
    .sort((a, b) => a.ms - b.ms);

  if (upcomingSoonMeetings.length > 0) {
    const nextM = upcomingSoonMeetings[0];
    const mDate = new Date(nextM.ms);
    const mMidnight = new Date(mDate.getFullYear(), mDate.getMonth(), mDate.getDate()).getTime();
    const diffDays = Math.round((mMidnight - refMidnight) / dayMs);

    const messageArabic =
      diffDays <= 0
        ? 'لديك اجتماع مع هذا العميل اليوم.'
        : diffDays === 1
        ? 'لديك اجتماع مع هذا العميل غداً.'
        : 'لديك اجتماع قريب مع هذا العميل خلال 48 ساعة.';

    alerts.push({
      id: `alert:upcoming:${client.id}`,
      kind: 'upcoming_meeting',
      severity: 'info',
      titleArabic: 'اجتماع قريب',
      messageArabic,
      actionLabelArabic: 'فتح الاجتماع',
      actionType: 'open_meeting',
      meetingId: nextM.meeting.id,
    });
  }

  // D. Open high or urgent priority tasks
  const highPriorityOpenTasks = clientTasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    return t.priority === 'urgent' || t.priority === 'high';
  });

  if (highPriorityOpenTasks.length > 0) {
    const messageArabic =
      highPriorityOpenTasks.length === 1
        ? 'توجد مهمة عالية الأولوية تحتاج إلى متابعة.'
        : `توجد ${highPriorityOpenTasks.length} مهام عالية الأولوية تحتاج إلى متابعة.`;

    alerts.push({
      id: `alert:highprio:${client.id}`,
      kind: 'high_priority_tasks',
      severity: 'medium',
      titleArabic: 'أولوية عالية',
      messageArabic,
      actionLabelArabic: 'عرض المهام',
      actionType: 'view_tasks',
    });
  }

  // B. Long gap without recorded communication (>= 30 days)
  const pastOrCurrentMeetings = clientMeetings
    .map((m) => parseValidTime(m.dateTime))
    .filter((ms): ms is number => ms !== null && ms <= refTime);

  let daysSinceLastContact: number | null = null;
  if (pastOrCurrentMeetings.length > 0) {
    const latestMs = Math.max(...pastOrCurrentMeetings);
    daysSinceLastContact = Math.floor((refTime - latestMs) / dayMs);
  } else if (clientMeetings.length === 0) {
    const createdMs = parseValidTime(client.createdAt);
    if (createdMs !== null) {
      daysSinceLastContact = Math.floor((refTime - createdMs) / dayMs);
    }
  }

  if (daysSinceLastContact !== null && daysSinceLastContact >= staleThresholdDays) {
    alerts.push({
      id: `alert:stale:${client.id}`,
      kind: 'stale_contact',
      severity: 'medium',
      titleArabic: 'غياب تواصل مسجل',
      messageArabic: `لم يُسجّل تواصل حديث مع هذا العميل (منذ ${daysSinceLastContact} يوماً).`,
      basisDisclosureArabic:
        'مبني على الأنشطة المسجلة في التطبيق فقط ولا يُثبت عدم وجود تواصل خارجه.',
      actionLabelArabic: 'جدولة اجتماع',
      actionType: 'schedule_meeting',
    });
  }

  return alerts;
}

// ============================================================================
// Non-Blocking Duplicate Client Detection
// ============================================================================

export type DuplicateMatchReason = 'phone' | 'email' | 'name' | 'company';

export interface DuplicateClientMatch {
  client: Client;
  reasons: DuplicateMatchReason[];
  reasonLabelArabic: string;
}

export function findPotentialDuplicateClients(
  candidate: Partial<Client>,
  existingClients: Client[]
): DuplicateClientMatch[] {
  const normName = normalizeTextForMatch(candidate.name);
  const normCompany = normalizeTextForMatch(candidate.company);
  const normEmail = candidate.email?.trim().toLowerCase() || '';
  const normPhone = normalizePhoneForMatch(candidate.phone);

  if (!normName && !normCompany && !normEmail && !normPhone) {
    return [];
  }

  const matches: DuplicateClientMatch[] = [];

  for (const existing of existingClients) {
    if (candidate.id && existing.id === candidate.id) continue;

    const reasons: DuplicateMatchReason[] = [];

    if (normPhone && normPhone.length >= 7) {
      const existingPhone = normalizePhoneForMatch(existing.phone);
      const contactPhones = (existing.contacts || []).map((c) => normalizePhoneForMatch(c.phone));
      if (existingPhone === normPhone || contactPhones.includes(normPhone)) {
        reasons.push('phone');
      }
    }

    if (normEmail) {
      const existingEmail = existing.email?.trim().toLowerCase() || '';
      const contactEmails = (existing.contacts || []).map((c) => c.email?.trim().toLowerCase() || '');
      if (existingEmail === normEmail || contactEmails.includes(normEmail)) {
        reasons.push('email');
      }
    }

    if (normName && normName.length >= 3) {
      const existingName = normalizeTextForMatch(existing.name);
      if (
        existingName === normName ||
        (existingName.length >= 5 &&
          normName.length >= 5 &&
          (existingName.includes(normName) || normName.includes(existingName)))
      ) {
        reasons.push('name');
      }
    }

    if (normCompany && normCompany.length >= 4) {
      const existingCompany = normalizeTextForMatch(existing.company);
      if (existingCompany && existingCompany === normCompany) {
        reasons.push('company');
      }
    }

    if (reasons.length > 0) {
      const labelParts: string[] = [];
      if (reasons.includes('phone')) labelParts.push('تطابق رقم الهاتف');
      if (reasons.includes('email')) labelParts.push('تطابق البريد الإلكتروني');
      if (reasons.includes('name')) labelParts.push('تشابه الاسم');
      if (reasons.includes('company')) labelParts.push('تطابق الشركة');

      matches.push({
        client: existing,
        reasons,
        reasonLabelArabic: labelParts.join(' • '),
      });
    }
  }

  return matches;
}

// ============================================================================
// Clients List Filtering, Summaries & Sorting
// ============================================================================

export type ClientListSortBy = 'last_activity' | 'importance' | 'name' | 'created_at';

export interface ClientListFilterOptions {
  searchQuery?: string;
  onlyFavorites?: boolean;
  relationshipStatus?: ClientRelationshipStatus | 'all';
  importance?: ClientImportanceLevel | 'all';
  category?: string | 'all';
  industry?: string | 'all';
  onlyWithOverdueTasks?: boolean;
  onlyNeedsFollowUp?: boolean;
  sortBy?: ClientListSortBy;
  referenceDate?: Date;
}

export interface ClientWithSummary {
  client: Client;
  kpis: ClientKpis;
  needsFollowUp: boolean;
  needsReviewGap: boolean;
}

export function filterAndSortClients(
  clients: Client[],
  meetings: Meeting[],
  tasks: ActionItem[],
  notes: Note[],
  options: ClientListFilterOptions = {}
): ClientWithSummary[] {
  const {
    searchQuery = '',
    onlyFavorites = false,
    relationshipStatus = 'all',
    importance = 'all',
    category = 'all',
    industry = 'all',
    onlyWithOverdueTasks = false,
    onlyNeedsFollowUp = false,
    sortBy = 'last_activity',
    referenceDate = new Date(),
  } = options;

  const index = buildClientDataIndex({ meetings, tasks, notes });
  const refTime = referenceDate.getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  const q = normalizeTextForMatch(searchQuery);
  const qPhoneDigits = normalizePhoneForMatch(searchQuery);

  const enriched: ClientWithSummary[] = clients.map((client) => {
    const cMeetings = index.meetingsByClient.get(client.id) || [];
    const cTasks = index.tasksByClient.get(client.id) || [];
    const cNotes = index.notesByClient.get(client.id) || [];

    const kpis = computeClientKpis({
      client,
      meetings: cMeetings,
      tasks: cTasks,
      notes: cNotes,
      referenceDate,
    });

    const lastContactMs = kpis.lastContactAt ? parseValidTime(kpis.lastContactAt) : null;
    const createdMs = parseValidTime(client.createdAt);
    const gapDays =
      lastContactMs !== null
        ? Math.floor((refTime - lastContactMs) / dayMs)
        : cMeetings.length === 0 && createdMs !== null
        ? Math.floor((refTime - createdMs) / dayMs)
        : null;

    const needsReviewGap = gapDays !== null && gapDays >= STALE_CONTACT_THRESHOLD_DAYS;
    const needsFollowUp =
      client.relationshipStatus === 'follow_up_needed' ||
      kpis.overdueTasks > 0 ||
      needsReviewGap;

    return { client, kpis, needsFollowUp, needsReviewGap };
  });

  const filtered = enriched.filter(({ client, kpis, needsFollowUp }) => {
    if (onlyFavorites && !client.isFavorite) return false;
    if (relationshipStatus !== 'all' && client.relationshipStatus !== relationshipStatus) return false;
    if (importance !== 'all' && client.importance !== importance) return false;
    if (category !== 'all' && client.category !== category) return false;
    if (industry !== 'all' && normalizeTextForMatch(client.industry) !== normalizeTextForMatch(industry)) {
      return false;
    }
    if (onlyWithOverdueTasks && kpis.overdueTasks === 0) return false;
    if (onlyNeedsFollowUp && !needsFollowUp) return false;

    if (q) {
      const haystacks = [
        client.name,
        client.company,
        client.email,
        client.phone,
        client.industry,
        client.category,
        ...(client.tags || []),
        ...(client.contacts || []).flatMap((cc) => [cc.name, cc.title, cc.email, cc.phone]),
      ];

      const matchesText = haystacks.some((val) => val && normalizeTextForMatch(val).includes(q));
      const matchesPhone =
        qPhoneDigits.length >= 3 &&
        (normalizePhoneForMatch(client.phone).includes(qPhoneDigits) ||
          (client.contacts || []).some((cc) =>
            normalizePhoneForMatch(cc.phone).includes(qPhoneDigits)
          ));

      if (!matchesText && !matchesPhone) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'name') {
      return a.client.name.localeCompare(b.client.name, 'ar');
    }
    if (sortBy === 'created_at') {
      const aMs = parseValidTime(a.client.createdAt) ?? 0;
      const bMs = parseValidTime(b.client.createdAt) ?? 0;
      return bMs - aMs;
    }
    if (sortBy === 'importance') {
      const aRank = a.client.importance ? CLIENT_IMPORTANCE_CONFIG[a.client.importance].rank : 0;
      const bRank = b.client.importance ? CLIENT_IMPORTANCE_CONFIG[b.client.importance].rank : 0;
      if (bRank !== aRank) return bRank - aRank;
      const aFav = a.client.isFavorite ? 1 : 0;
      const bFav = b.client.isFavorite ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
    }
    // Default: last_activity (clients with activity newest first, fallback to updatedAt/createdAt)
    const aAct =
      parseValidTime(a.kpis.lastActivityAt || undefined) ??
      parseValidTime(a.client.updatedAt || a.client.createdAt) ??
      0;
    const bAct =
      parseValidTime(b.kpis.lastActivityAt || undefined) ??
      parseValidTime(b.client.updatedAt || b.client.createdAt) ??
      0;
    return bAct - aAct;
  });

  return filtered;
}
