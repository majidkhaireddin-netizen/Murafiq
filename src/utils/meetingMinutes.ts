import type {
  ActionItem,
  Meeting,
  MeetingAgendaItem,
  MeetingDecision,
  MeetingParticipant,
  MeetingStatus,
  MeetingType,
  MinutesSectionKey,
  MinutesStatus,
  ParticipantParty,
  TaskPriority,
} from '../types/index.ts';
import type { MeetingTemplate } from '../data/meetingTemplates.ts';
import { formatArabicDate, getHijriDateString } from './logic.ts';

export interface MinutesSectionDefinition {
  key: MinutesSectionKey;
  labelAr: string;
  labelEn: string;
}

export const ALL_MINUTES_SECTIONS: MinutesSectionDefinition[] = [
  { key: 'basicInfo', labelAr: 'المعلومات الأساسية واللقاء', labelEn: 'Basic Information' },
  { key: 'participants', labelAr: 'قائمة المشاركين', labelEn: 'Participants' },
  { key: 'agenda', labelAr: 'جدول الأعمال', labelEn: 'Agenda' },
  { key: 'discussions', labelAr: 'ملخص المناقشات', labelEn: 'Discussions Summary' },
  { key: 'decisions', labelAr: 'القرارات المعتمدة', labelEn: 'Decisions' },
  { key: 'tasks', labelAr: 'المهام والالتزامات المرتبطة', labelEn: 'Linked Tasks & Commitments' },
  { key: 'followUp', labelAr: 'موعد المتابعة القادم', labelEn: 'Next Follow-up' },
  { key: 'additionalNotes', labelAr: 'ملاحظات إضافية', labelEn: 'Additional Notes' },
];

export const DEFAULT_MINUTES_SECTIONS: MinutesSectionKey[] = ALL_MINUTES_SECTIONS.map(
  (s) => s.key
);

export const MINUTES_FINAL_DISCLAIMER_AR =
  'تنبيه تنظيمي: حالة «نهائي» تُستخدم لتنظيم وإقفال مسودة المحضر إدارياً داخل مُرافق فقط، ولا تُعد توقيعاً رقمياً أو اعتماداً قانونياً ملزماً.';

export const MINUTES_FINAL_DISCLAIMER_EN =
  'Organizational Notice: "Final" status locks the draft for internal organization only and does not constitute a digital signature or legally binding sign-off.';

export const MINUTES_STATUS_CONFIG: Record<
  MinutesStatus,
  {
    labelAr: string;
    labelEn: string;
    descriptionAr: string;
    badgeClass: string;
  }
> = {
  draft: {
    labelAr: 'مسودة',
    labelEn: 'Draft',
    descriptionAr: 'قيد التحرير والتدوين الأولي',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-300',
  },
  review: {
    labelAr: 'جاهز للمراجعة',
    labelEn: 'Ready for Review',
    descriptionAr: 'مكتمل الصياغة وجاهز للمراجعة قبل الاعتماد التنظيمي',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
  },
  final: {
    labelAr: 'نهائي',
    labelEn: 'Final',
    descriptionAr: 'محضر مقفل تنظيمياً (إعادة الفتح تتطلب تأكيداً صريحاً)',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  },
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  confirmed: { ar: 'مؤكدة', en: 'Confirmed' },
  completed: { ar: 'منتهية', en: 'Completed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
};

export const MEETING_TYPE_LABELS: Record<MeetingType, { ar: string; en: string }> = {
  in_person: { ar: 'وجهاً لوجه', en: 'In Person' },
  video: { ar: 'مكالمة فيديو', en: 'Video Call' },
  phone: { ar: 'مكالمة هاتفية', en: 'Phone Call' },
  chat: { ar: 'مراسلة مكتوبة', en: 'Written Chat' },
};

function createItemId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now()}-${rand}`;
}

/**
 * Redacts any temporary Backblaze B2 URLs, presigned S3 query params, or bearer tokens
 * so secrets/temporary URLs never appear inside PDF exports or shared minutes text.
 */
export function redactTemporaryAttachmentUrls(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /https?:\/\/[^\s"'<>]*backblazeb2\.com[^\s"'<>]*/gi,
      '[رابط مرفق سحابي محذوف من المحضر للأمان]'
    )
    .replace(
      /https?:\/\/[^\s"'<>]*?(?:X-Amz-Signature|X-Amz-Credential|Authorization)=[^\s"'<>]*/gi,
      '[رابط مؤقت محذوف من المحضر للأمان]'
    );
}

/**
 * Derives structured participants cleanly from either `meeting.participants`
 * or legacy `meeting.attendees` without altering the source meeting object.
 */
export function getEffectiveParticipants(meeting: Partial<Meeting>): MeetingParticipant[] {
  if (Array.isArray(meeting.participants) && meeting.participants.length > 0) {
    return meeting.participants
      .filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 0)
      .map((p, index) => ({
        id: p.id || `part-legacy-${index}`,
        name: p.name.trim(),
        role: p.role?.trim() || undefined,
        party: p.party === 'internal' ? 'internal' : 'external',
      }));
  }

  if (Array.isArray(meeting.attendees) && meeting.attendees.length > 0) {
    return meeting.attendees
      .filter((name) => typeof name === 'string' && name.trim().length > 0)
      .map((rawName, index) => {
        const trimmed = rawName.trim();
        const isInternal =
          trimmed === 'أنت' ||
          trimmed.toLowerCase() === 'you' ||
          trimmed.includes('(داخلي)') ||
          trimmed.includes('فريقنا');
        return {
          id: `part-att-${index}`,
          name: trimmed,
          party: isInternal ? 'internal' : 'external',
        };
      });
  }

  return [];
}

/**
 * Synchronizes legacy `attendees: string[]` from structured participants.
 */
export function syncAttendeesFromParticipants(participants: MeetingParticipant[]): string[] {
  return participants
    .filter((p) => p.name.trim().length > 0)
    .map((p) => (p.role?.trim() ? `${p.name.trim()} (${p.role.trim()})` : p.name.trim()))
    .slice(0, 50);
}

export function addParticipantToList(
  current: MeetingParticipant[],
  input: { name: string; role?: string; party: ParticipantParty }
): MeetingParticipant[] {
  const name = input.name.trim();
  if (!name) return current;
  const role = input.role?.trim() || undefined;
  const next: MeetingParticipant = {
    id: createItemId('part'),
    name: name.slice(0, 120),
    role: role ? role.slice(0, 100) : undefined,
    party: input.party,
  };
  return [...current, next].slice(0, 50);
}

export function updateParticipantInList(
  current: MeetingParticipant[],
  id: string,
  patch: Partial<Pick<MeetingParticipant, 'name' | 'role' | 'party'>>
): MeetingParticipant[] {
  return current.map((p) => {
    if (p.id !== id) return p;
    const updatedName = patch.name !== undefined ? patch.name.trim().slice(0, 120) : p.name;
    const updatedRole = patch.role !== undefined ? patch.role.trim().slice(0, 100) || undefined : p.role;
    return {
      ...p,
      name: updatedName || p.name,
      role: updatedRole,
      party: patch.party ?? p.party,
    };
  });
}

export function removeParticipantFromList(
  current: MeetingParticipant[],
  id: string
): MeetingParticipant[] {
  return current.filter((p) => p.id !== id);
}

/**
 * Agenda Item operations (preserve 1-based sequential order).
 */
export function normalizeAgendaOrder(items: MeetingAgendaItem[]): MeetingAgendaItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, idx) => ({
      ...item,
      order: idx + 1,
    }));
}

export function addAgendaItemToList(
  current: MeetingAgendaItem[],
  input: { title: string; notes?: string; durationMinutes?: number }
): MeetingAgendaItem[] {
  const title = input.title.trim();
  if (!title) return current;
  const normalized = normalizeAgendaOrder(current);
  const newItem: MeetingAgendaItem = {
    id: createItemId('ag'),
    title: title.slice(0, 200),
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : undefined,
    durationMinutes:
      typeof input.durationMinutes === 'number' && input.durationMinutes > 0
        ? Math.min(480, Math.round(input.durationMinutes))
        : undefined,
    order: normalized.length + 1,
  };
  return [...normalized, newItem].slice(0, 60);
}

export function updateAgendaItemInList(
  current: MeetingAgendaItem[],
  id: string,
  patch: Partial<Pick<MeetingAgendaItem, 'title' | 'notes' | 'durationMinutes'>>
): MeetingAgendaItem[] {
  return normalizeAgendaOrder(
    current.map((item) => {
      if (item.id !== id) return item;
      const nextTitle = patch.title !== undefined ? patch.title.trim().slice(0, 200) : item.title;
      const nextNotes =
        patch.notes !== undefined ? patch.notes.trim().slice(0, 2000) || undefined : item.notes;
      const nextDuration =
        patch.durationMinutes !== undefined
          ? patch.durationMinutes > 0
            ? Math.min(480, Math.round(patch.durationMinutes))
            : undefined
          : item.durationMinutes;
      return {
        ...item,
        title: nextTitle || item.title,
        notes: nextNotes,
        durationMinutes: nextDuration,
      };
    })
  );
}

export function removeAgendaItemFromList(
  currentItems: MeetingAgendaItem[],
  id: string,
  currentDecisions?: MeetingDecision[]
): { agendaItems: MeetingAgendaItem[]; decisions: MeetingDecision[] } {
  const filteredItems = normalizeAgendaOrder(currentItems.filter((item) => item.id !== id));
  const updatedDecisions = (currentDecisions || []).map((dec) =>
    dec.agendaItemId === id ? { ...dec, agendaItemId: undefined } : dec
  );
  return { agendaItems: filteredItems, decisions: updatedDecisions };
}

export function reorderAgendaItems(
  current: MeetingAgendaItem[],
  id: string,
  direction: 'up' | 'down'
): MeetingAgendaItem[] {
  const sorted = normalizeAgendaOrder(current);
  const idx = sorted.findIndex((item) => item.id === id);
  if (idx < 0) return sorted;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return sorted;

  const copy = [...sorted];
  const [moved] = copy.splice(idx, 1);
  copy.splice(targetIdx, 0, moved);
  return copy.map((item, i) => ({ ...item, order: i + 1 }));
}

/**
 * Structured Decision operations.
 */
export function addDecisionToList(
  current: MeetingDecision[],
  input: { text: string; agendaItemId?: string; ownerName?: string }
): MeetingDecision[] {
  const text = input.text.trim();
  if (!text) return current;
  const newDecision: MeetingDecision = {
    id: createItemId('dec'),
    text: text.slice(0, 500),
    agendaItemId: input.agendaItemId?.trim() || undefined,
    ownerName: input.ownerName?.trim() ? input.ownerName.trim().slice(0, 120) : undefined,
    createdAt: new Date().toISOString(),
  };
  return [...current, newDecision].slice(0, 60);
}

export function updateDecisionInList(
  current: MeetingDecision[],
  id: string,
  patch: Partial<Pick<MeetingDecision, 'text' | 'agendaItemId' | 'ownerName'>>
): MeetingDecision[] {
  return current.map((d) => {
    if (d.id !== id) return d;
    return {
      ...d,
      text: patch.text !== undefined ? patch.text.trim().slice(0, 500) || d.text : d.text,
      agendaItemId:
        patch.agendaItemId !== undefined ? patch.agendaItemId.trim() || undefined : d.agendaItemId,
      ownerName:
        patch.ownerName !== undefined ? patch.ownerName.trim().slice(0, 120) || undefined : d.ownerName,
    };
  });
}

export function removeDecisionFromList(
  current: MeetingDecision[],
  id: string
): MeetingDecision[] {
  return current.filter((d) => d.id !== id);
}

/**
 * Minutes Lifecycle helpers
 */
export function getMinutesStatus(meeting: Partial<Meeting>): MinutesStatus {
  if (
    meeting.minutesStatus === 'draft' ||
    meeting.minutesStatus === 'review' ||
    meeting.minutesStatus === 'final'
  ) {
    return meeting.minutesStatus;
  }
  return 'draft';
}

export function isMinutesLocked(meeting: Partial<Meeting>): boolean {
  return getMinutesStatus(meeting) === 'final';
}

export function transitionMinutesStatus(
  meeting: Meeting,
  nextStatus: MinutesStatus,
  options?: { confirmedReopen?: boolean }
): { allowed: boolean; meeting: Meeting; reasonArabic?: string } {
  const currentStatus = getMinutesStatus(meeting);
  if (currentStatus === 'final' && nextStatus !== 'final' && !options?.confirmedReopen) {
    return {
      allowed: false,
      meeting,
      reasonArabic: 'هذا المحضر في حالة «نهائي». إعادة فتحه للتعديل تتطلب تأكيداً صريحاً.',
    };
  }

  const now = new Date().toISOString();
  return {
    allowed: true,
    meeting: {
      ...meeting,
      minutesStatus: nextStatus,
      minutesStatusUpdatedAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Normalizes Arabic/Latin task titles for accidental-duplicate detection.
 */
export function normalizeTaskTitle(title: string): string {
  return (title || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '') // Strip Arabic diacritics
    .replace(/\s+/g, ' ');
}

export function findDuplicateMeetingTask(
  existingTasks: ActionItem[],
  candidate: { meetingId: string; title: string }
): ActionItem | undefined {
  const targetNorm = normalizeTaskTitle(candidate.title);
  if (!targetNorm) return undefined;

  return existingTasks.find(
    (t) =>
      t.meetingId === candidate.meetingId &&
      t.status !== 'cancelled' &&
      normalizeTaskTitle(t.title) === targetNorm
  );
}

export function createLinkedMeetingTask(
  params: {
    meetingId: string;
    clientId: string;
    title: string;
    description?: string;
    dueDate?: string;
    priority?: TaskPriority;
  },
  existingTasks: ActionItem[]
): { ok: true; task: ActionItem } | { ok: false; reasonArabic: string; duplicateTask?: ActionItem } {
  const cleanTitle = params.title.trim();
  if (cleanTitle.length < 2) {
    return {
      ok: false,
      reasonArabic: 'يرجى كتابة عنوان واضح للمهمة (حرفان على الأقل).',
    };
  }

  const duplicate = findDuplicateMeetingTask(existingTasks, {
    meetingId: params.meetingId,
    title: cleanTitle,
  });

  if (duplicate) {
    return {
      ok: false,
      reasonArabic: `توجد مهمة مطابقة مرتبطة بهذا اللقاء مسبقاً («${duplicate.title}»). تم منع التكرار التلقائي.`,
      duplicateTask: duplicate,
    };
  }

  const task: ActionItem = {
    id: createItemId('t'),
    meetingId: params.meetingId,
    clientId: params.clientId,
    title: cleanTitle.slice(0, 250),
    description: params.description?.trim() ? params.description.trim().slice(0, 2000) : undefined,
    dueDate: params.dueDate?.trim() || undefined,
    priority: params.priority || 'medium',
    status: 'pending',
    provenance: 'approved',
    createdAt: new Date().toISOString(),
  };

  return { ok: true, task };
}

/**
 * Non-destructive template application:
 * - Preserves existing agenda items (only appends template items not already listed).
 * - Preserves existing `discussionSummary` and legacy `notes` (appends discussion starter cleanly if new).
 * - Only fills blank metadata (`title`, `duration`, `location`, `type`) unless missing.
 */
export function applyTemplateToMeetingNonDestructive<
  T extends Partial<Meeting>
>(
  meeting: T,
  template: MeetingTemplate,
  customOverrides?: {
    title?: string;
    duration?: number;
    agendaItems?: { title: string; notes?: string; durationMinutes?: number }[];
    discussionStarter?: string;
  }
): T {
  const existingAgenda = normalizeAgendaOrder(
    Array.isArray(meeting.agendaItems) ? meeting.agendaItems : []
  );
  const existingNormTitles = new Set(existingAgenda.map((item) => normalizeTaskTitle(item.title)));

  const seedItems = customOverrides?.agendaItems ?? template.defaultAgendaItems;
  const appendedItems: MeetingAgendaItem[] = [];
  let nextOrder = existingAgenda.length + 1;

  for (const seed of seedItems) {
    const cleanTitle = (seed.title || '').trim();
    if (!cleanTitle) continue;
    const norm = normalizeTaskTitle(cleanTitle);
    if (existingNormTitles.has(norm)) continue;
    existingNormTitles.add(norm);
    appendedItems.push({
      id: createItemId('ag'),
      title: cleanTitle.slice(0, 200),
      notes: seed.notes?.trim() ? seed.notes.trim().slice(0, 2000) : undefined,
      durationMinutes:
        typeof seed.durationMinutes === 'number' && seed.durationMinutes > 0
          ? Math.min(480, Math.round(seed.durationMinutes))
          : undefined,
      order: nextOrder++,
    });
  }

  const mergedAgenda = [...existingAgenda, ...appendedItems].slice(0, 60);

  const starterText = (
    customOverrides?.discussionStarter ?? template.defaultDiscussionStarter ?? ''
  ).trim();
  const currentSummary = (meeting.discussionSummary || '').trim();
  let nextDiscussionSummary = meeting.discussionSummary;
  if (starterText) {
    if (!currentSummary) {
      nextDiscussionSummary = starterText;
    } else if (!currentSummary.includes(starterText)) {
      nextDiscussionSummary = `${currentSummary}\n\n${starterText}`;
    }
  }

  const templateTitle = (customOverrides?.title ?? template.title).trim();
  const templateDuration = customOverrides?.duration ?? template.defaultDuration;

  return {
    ...meeting,
    title: meeting.title?.trim() ? meeting.title : templateTitle,
    duration: meeting.duration && meeting.duration > 0 ? meeting.duration : templateDuration,
    type: meeting.type || template.suggestedType,
    location: meeting.location?.trim() ? meeting.location : template.suggestedLocation,
    agendaItems: mergedAgenda,
    discussionSummary: nextDiscussionSummary,
    // Strictly preserve legacy `notes` untouched!
    notes: meeting.notes ?? '',
    appliedTemplateId: template.id,
  };
}

/**
 * Resolves effective discussion summary + legacy notes without losing legacy data.
 */
export function getDiscussionSectionsForDisplay(meeting: Partial<Meeting>): {
  primarySummary: string;
  legacyNotes: string;
  hasSeparateLegacyNotes: boolean;
} {
  const summary = (meeting.discussionSummary || '').trim();
  const legacy = (meeting.notes || '').trim();

  if (summary && legacy && summary !== legacy) {
    return {
      primarySummary: redactTemporaryAttachmentUrls(summary),
      legacyNotes: redactTemporaryAttachmentUrls(legacy),
      hasSeparateLegacyNotes: true,
    };
  }

  return {
    primarySummary: redactTemporaryAttachmentUrls(summary || legacy),
    legacyNotes: redactTemporaryAttachmentUrls(legacy),
    hasSeparateLegacyNotes: false,
  };
}

/**
 * Sanitizes and bounds a `Meeting` payload before saving to Firestore / local cache:
 * - Strips `undefined` keys recursively
 * - Enforces field/list sizes matching `firestore.rules`
 * - Preserves legacy `notes` & `attendees`
 */
export function sanitizeMeetingForSave(meeting: Partial<Meeting> & { id: string; clientId: string }): Meeting {
  const now = new Date().toISOString();

  const participants = Array.isArray(meeting.participants)
    ? meeting.participants
        .filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 0)
        .slice(0, 50)
        .map((p, idx) => {
          const entry: MeetingParticipant = {
            id: (p.id || `part-${idx}`).slice(0, 64),
            name: p.name.trim().slice(0, 120),
            party: p.party === 'internal' ? 'internal' : 'external',
          };
          if (p.role && p.role.trim()) {
            entry.role = p.role.trim().slice(0, 100);
          }
          return entry;
        })
    : undefined;

  const attendees =
    participants && participants.length > 0
      ? syncAttendeesFromParticipants(participants)
      : Array.isArray(meeting.attendees)
      ? meeting.attendees
          .filter((a) => typeof a === 'string' && a.trim().length > 0)
          .slice(0, 50)
          .map((a) => a.trim().slice(0, 150))
      : undefined;

  const agendaItems = Array.isArray(meeting.agendaItems)
    ? normalizeAgendaOrder(
        meeting.agendaItems
          .filter((item) => item && typeof item.title === 'string' && item.title.trim().length > 0)
          .slice(0, 60)
          .map((item, idx) => {
            const cleanItem: MeetingAgendaItem = {
              id: (item.id || `ag-${idx}`).slice(0, 64),
              title: item.title.trim().slice(0, 200),
              order: typeof item.order === 'number' ? item.order : idx + 1,
            };
            if (item.notes && item.notes.trim()) {
              cleanItem.notes = item.notes.trim().slice(0, 2000);
            }
            if (typeof item.durationMinutes === 'number' && item.durationMinutes > 0) {
              cleanItem.durationMinutes = Math.min(480, Math.round(item.durationMinutes));
            }
            return cleanItem;
          })
      )
    : undefined;

  const validAgendaIds = new Set((agendaItems || []).map((a) => a.id));

  const decisions = Array.isArray(meeting.decisions)
    ? meeting.decisions
        .filter((d) => d && typeof d.text === 'string' && d.text.trim().length > 0)
        .slice(0, 60)
        .map((d, idx) => {
          const cleanDec: MeetingDecision = {
            id: (d.id || `dec-${idx}`).slice(0, 64),
            text: d.text.trim().slice(0, 500),
            createdAt: (d.createdAt || now).slice(0, 50),
          };
          if (d.agendaItemId && (validAgendaIds.size === 0 || validAgendaIds.has(d.agendaItemId))) {
            cleanDec.agendaItemId = d.agendaItemId.slice(0, 64);
          }
          if (d.ownerName && d.ownerName.trim()) {
            cleanDec.ownerName = d.ownerName.trim().slice(0, 120);
          }
          return cleanDec;
        })
    : undefined;

  const allowedSectionKeys = new Set<MinutesSectionKey>(DEFAULT_MINUTES_SECTIONS);
  const minutesIncludedSections = Array.isArray(meeting.minutesIncludedSections)
    ? meeting.minutesIncludedSections
        .filter((k): k is MinutesSectionKey => allowedSectionKeys.has(k))
        .slice(0, 12)
    : undefined;

  const sanitized: Meeting = {
    id: meeting.id.slice(0, 128),
    clientId: meeting.clientId.slice(0, 128),
    title: (meeting.title || 'لقاء بدون عنوان').trim().slice(0, 200),
    dateTime: (meeting.dateTime || now).slice(0, 50),
    type: meeting.type || 'in_person',
    status: meeting.status || 'confirmed',
    notes: (meeting.notes ?? '').slice(0, 10000),
    photoPaths: Array.isArray(meeting.photoPaths) ? meeting.photoPaths.slice(0, 20) : [],
    createdAt: (meeting.createdAt || now).slice(0, 50),
    updatedAt: (meeting.updatedAt || now).slice(0, 50),
  };

  if (meeting.userId) sanitized.userId = meeting.userId;
  if (typeof meeting.duration === 'number' && !Number.isNaN(meeting.duration)) {
    sanitized.duration = Math.max(0, Math.min(1440, Math.round(meeting.duration)));
  }
  if (meeting.location !== undefined && meeting.location.trim()) {
    sanitized.location = meeting.location.trim().slice(0, 200);
  }
  if (meeting.isFollowUpScheduled !== undefined) {
    sanitized.isFollowUpScheduled = Boolean(meeting.isFollowUpScheduled);
  }
  if (attendees && attendees.length > 0) {
    sanitized.attendees = attendees;
  } else if (Array.isArray(meeting.attendees) && meeting.attendees.length === 0) {
    sanitized.attendees = [];
  }
  if (participants) sanitized.participants = participants;
  if (agendaItems) sanitized.agendaItems = agendaItems;
  if (meeting.discussionSummary !== undefined) {
    sanitized.discussionSummary = meeting.discussionSummary.slice(0, 15000);
  }
  if (decisions) sanitized.decisions = decisions;
  if (meeting.followUpDateTime && meeting.followUpDateTime.trim()) {
    sanitized.followUpDateTime = meeting.followUpDateTime.trim().slice(0, 50);
  }
  if (meeting.minutesStatus) sanitized.minutesStatus = meeting.minutesStatus;
  if (meeting.minutesStatusUpdatedAt) {
    sanitized.minutesStatusUpdatedAt = meeting.minutesStatusUpdatedAt.slice(0, 50);
  }
  if (minutesIncludedSections) sanitized.minutesIncludedSections = minutesIncludedSections;
  if (meeting.minutesAdditionalNotes !== undefined) {
    sanitized.minutesAdditionalNotes = meeting.minutesAdditionalNotes.slice(0, 5000);
  }
  if (meeting.appliedTemplateId) {
    sanitized.appliedTemplateId = meeting.appliedTemplateId.slice(0, 100);
  }
  if (meeting.opportunityId && meeting.opportunityId.trim()) {
    sanitized.opportunityId = meeting.opportunityId.trim().slice(0, 128);
  }

  return sanitized;
}

/**
 * Generates clean Arabic/English plain text for clipboard sharing from structured minutes,
 * respecting selected sections and redacting any temporary URLs.
 */
export function formatMinutesPlainText(params: {
  meeting: Meeting;
  clientName?: string;
  clientCompany?: string;
  linkedTasks: ActionItem[];
  includedSections: MinutesSectionKey[];
  additionalNotes?: string;
}): string {
  const { meeting, clientName, clientCompany, linkedTasks, includedSections, additionalNotes } =
    params;
  const includeSet = new Set(includedSections);
  const lines: string[] = [];

  const minutesStatus = getMinutesStatus(meeting);
  const statusLabel = MINUTES_STATUS_CONFIG[minutesStatus].labelAr;
  const participants = getEffectiveParticipants(meeting);
  const agenda = normalizeAgendaOrder(meeting.agendaItems || []);
  const decisions = meeting.decisions || [];
  const discussions = getDiscussionSectionsForDisplay(meeting);

  lines.push('محضر اجتماع — مُرافق');
  lines.push(`حالة المحضر: ${statusLabel} (${MINUTES_FINAL_DISCLAIMER_AR})`);
  lines.push(`رقم المرجع: MIN-${meeting.id.replace('m-', '').toUpperCase()}`);
  lines.push('');

  if (includeSet.has('basicInfo')) {
    lines.push(`عنوان اللقاء: ${meeting.title}`);
    lines.push(
      `العميل / الجهة: ${clientName || 'غير محدد'}${clientCompany ? ` — ${clientCompany}` : ''}`
    );
    lines.push(
      `التاريخ والوقت: ${formatArabicDate(meeting.dateTime, true)} (${getHijriDateString(
        meeting.dateTime
      )})`
    );
    lines.push(
      `النوع والمكان: ${MEETING_TYPE_LABELS[meeting.type]?.ar || meeting.type}${
        meeting.location ? ` — ${meeting.location}` : ''
      }`
    );
    if (meeting.duration) lines.push(`المدة: ${meeting.duration} دقيقة`);
    lines.push('');
  }

  if (includeSet.has('participants')) {
    lines.push('--- المشاركون ---');
    if (participants.length === 0) {
      lines.push('لم يتم تسجيل أسماء المشاركين.');
    } else {
      participants.forEach((p, idx) => {
        const partyLabel = p.party === 'internal' ? 'داخلي' : 'خارجي';
        lines.push(
          `${idx + 1}. ${p.name}${p.role ? ` — ${p.role}` : ''} [${partyLabel}]`
        );
      });
    }
    lines.push('');
  }

  if (includeSet.has('agenda') && agenda.length > 0) {
    lines.push('--- جدول الأعمال ---');
    agenda.forEach((item) => {
      lines.push(
        `${item.order}. ${item.title}${item.durationMinutes ? ` (${item.durationMinutes} د)` : ''}`
      );
      if (item.notes) lines.push(`   ملاحظة: ${redactTemporaryAttachmentUrls(item.notes)}`);
    });
    lines.push('');
  }

  if (includeSet.has('discussions')) {
    lines.push('--- ملخص المناقشات ---');
    lines.push(discussions.primarySummary || 'لا يوجد ملخص مناقشات مسجل.');
    if (discussions.hasSeparateLegacyNotes) {
      lines.push('');
      lines.push('ملاحظات اللقاء الإضافية / السابقة:');
      lines.push(discussions.legacyNotes);
    }
    lines.push('');
  }

  if (includeSet.has('decisions')) {
    lines.push('--- القرارات المعتمدة ---');
    if (decisions.length === 0) {
      lines.push('لم تُسجل قرارات منفصلة لهذا اللقاء.');
    } else {
      decisions.forEach((d, idx) => {
        const linkedItem = agenda.find((a) => a.id === d.agendaItemId);
        const parts = [`${idx + 1}. ${redactTemporaryAttachmentUrls(d.text)}`];
        if (linkedItem) parts.push(`(بند #${linkedItem.order}: ${linkedItem.title})`);
        if (d.ownerName) parts.push(`— المسؤول: ${d.ownerName}`);
        lines.push(parts.join(' '));
      });
    }
    lines.push('');
  }

  if (includeSet.has('tasks')) {
    lines.push('--- المهام والالتزامات المرتبطة ---');
    if (linkedTasks.length === 0) {
      lines.push('لا توجد مهام مرتبطة بهذا اللقاء.');
    } else {
      linkedTasks.forEach((t, idx) => {
        const statusAr =
          t.status === 'completed'
            ? 'منجزة'
            : t.status === 'in_progress'
            ? 'قيد التنفيذ'
            : t.status === 'cancelled'
            ? 'ملغاة'
            : 'معلقة';
        lines.push(
          `${idx + 1}. ${redactTemporaryAttachmentUrls(t.title)} — الحالة: ${statusAr} — الاستحقاق: ${
            t.dueDate ? formatArabicDate(t.dueDate) : 'غير محدد'
          }`
        );
      });
    }
    lines.push('');
  }

  if (includeSet.has('followUp')) {
    lines.push('--- المتابعة القادمة ---');
    if (meeting.followUpDateTime) {
      lines.push(`موعد المتابعة / اللقاء القادم: ${formatArabicDate(meeting.followUpDateTime, true)}`);
    } else if (meeting.isFollowUpScheduled) {
      lines.push('تم تأكيد الحاجة إلى متابعة قادمة (بدون تاريخ محدد).');
    } else {
      lines.push('لم يُحدد موعد متابعة قادم.');
    }
    lines.push('');
  }

  const finalAdditional = redactTemporaryAttachmentUrls(
    (additionalNotes ?? meeting.minutesAdditionalNotes ?? '').trim()
  );
  if (includeSet.has('additionalNotes') && finalAdditional) {
    lines.push('--- ملاحظات إضافية ---');
    lines.push(finalAdditional);
    lines.push('');
  }

  lines.push('تم التوثيق محلياً عبر تطبيق مُرافق.');
  return lines.join('\n').trim();
}
