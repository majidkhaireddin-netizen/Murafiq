import type {
  ActionItem,
  AiBriefingBasisType,
  AiBriefingInputPayload,
  AiBriefingSectionInclusionKey,
  AiBriefingSectionSelection,
  AiBriefingSuggestedGoal,
  AiBriefingTalkingPoint,
  Client,
  ClientContact,
  CommunicationInteraction,
  CommunicationOutcome,
  Meeting,
  MeetingAgendaItem,
  MeetingAiBriefingResult,
  MeetingDecision,
  MeetingGoalStatus,
  MeetingPreparationBrief,
  MeetingPreparationData,
  MeetingPreparationGoal,
  Note,
  Opportunity,
  OpportunityStageEvent,
  PreparationCollectionsLoadedState,
  PreparationCompletenessMeta,
  PreviousMeetingBriefItem,
  SuggestedDiscussionTopic,
} from '../types/index.ts';
import {
  addAgendaItemToList,
  getDiscussionSectionsForDisplay,
  getEffectiveParticipants,
  getMinutesStatus,
  isMinutesLocked,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  MINUTES_STATUS_CONFIG,
  normalizeAgendaOrder,
  normalizeTaskTitle,
  redactTemporaryAttachmentUrls,
} from './meetingMinutes.ts';
import {
  calendarDaysDiff,
  extractZonedCalendarParts,
  formatCalendarDateKey,
  getTodayCalendarKey,
  parseDateOnlyString,
  resolveCalendarParts,
  TASK_PRIORITY_RANK,
} from './followUpEngine.ts';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOME_META,
  isInteractionFollowUpPending,
} from './communications.ts';
import {
  formatOpportunityValue,
  isOpportunityOpen,
  OPPORTUNITY_STAGE_CONFIG,
} from './opportunities.ts';
import { formatArabicDate, getHijriDateString } from './logic.ts';

export const PREPARATION_RECORDS_DISCLOSURE_AR =
  'تستند المعلومات المعروضة إلى السجلات المتاحة داخل مُرافق فقط، ولا تشمل الاتصالات أو الأنشطة غير المسجلة.';

export const EMPTY_INTERACTIONS_MESSAGE_AR = 'لا توجد تفاعلات مسجلة داخل التطبيق.';

export const COMPLETE_ONLINE_PREPARATION_DISCLOSURE_AR =
  'ملف التحضير مكتمل ويستند إلى أحدث البيانات المتزامنة لحسابك.';

export const PARTIAL_OR_OFFLINE_PREPARATION_DISCLOSURE_AR =
  'تنبيه: يتم عرض التحضير بناءً على البيانات المتاحة محليًا حاليًا (وضع عدم الاتصال أو جاري استكمال تحميل/مزامنة بعض المجموعات).';

export const MAX_PREPARATION_GOALS = 20;
export const MAX_PREPARATION_GOAL_TEXT_CHARS = 300;
export const MAX_PREPARATION_GOAL_NOTE_CHARS = 1000;
export const MAX_PREPARATION_NOTES_CHARS = 5000;
export const MAX_AI_BRIEFING_INPUT_CHARS = 24000;

export const MEETING_GOAL_STATUS_ORDER: MeetingGoalStatus[] = [
  'planned',
  'achieved',
  'partially_achieved',
  'not_achieved',
  'deferred',
];

export const MEETING_GOAL_STATUS_META: Record<
  MeetingGoalStatus,
  {
    key: MeetingGoalStatus;
    labelAr: string;
    labelEn: string;
    badgeClass: string;
  }
> = {
  planned: {
    key: 'planned',
    labelAr: 'مخطط',
    labelEn: 'Planned',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-300',
  },
  achieved: {
    key: 'achieved',
    labelAr: 'تحقق',
    labelEn: 'Achieved',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  },
  partially_achieved: {
    key: 'partially_achieved',
    labelAr: 'تحقق جزئيًا',
    labelEn: 'Partially Achieved',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
  },
  not_achieved: {
    key: 'not_achieved',
    labelAr: 'لم يتحقق',
    labelEn: 'Not Achieved',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
  },
  deferred: {
    key: 'deferred',
    labelAr: 'مؤجل',
    labelEn: 'Deferred',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-300',
  },
};

export const AI_BRIEFING_BASIS_META: Record<
  AiBriefingBasisType,
  {
    key: AiBriefingBasisType;
    labelAr: string;
    badgeClass: string;
  }
> = {
  documented_fact: {
    key: 'documented_fact',
    labelAr: 'حقيقة موثقة من السجلات',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  inference: {
    key: 'inference',
    labelAr: 'استنتاج من السياق',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  ai_suggestion: {
    key: 'ai_suggestion',
    labelAr: 'اقتراح ذكي قابل للمراجعة',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
};

export const AI_BRIEFING_SECTION_LABELS: {
  key: AiBriefingSectionInclusionKey;
  labelAr: string;
  descriptionAr: string;
}[] = [
  {
    key: 'currentMeeting',
    labelAr: 'بيانات الاجتماع الحالي والأجندة والأهداف',
    descriptionAr: 'عنوان الاجتماع، الموعد، المشاركون، بنود جدول الأعمال، وأهداف الاجتماع المسجلة.',
  },
  {
    key: 'clientSummary',
    labelAr: 'بيانات العميل وجهات الاتصال',
    descriptionAr: 'اسم العميل، الجهة، القطاع، حالة العلاقة، وجهات الاتصال المرتبطة.',
  },
  {
    key: 'previousMeetings',
    labelAr: 'ملخص الاجتماعات السابقة والقرارات',
    descriptionAr: 'آخر الاجتماعات الفعلية مع العميل (باستثناء الملغاة) والقرارات المعتمدة فيها.',
  },
  {
    key: 'openTasks',
    labelAr: 'المهام والالتزامات المفتوحة',
    descriptionAr: 'المهام المتأخرة والمستحقة اليوم والقادمة المرتبطة بالعميل أو الفرصة.',
  },
  {
    key: 'opportunityDetails',
    labelAr: 'الفرصة المرتبطة والفرص المفتوحة للعميل',
    descriptionAr: 'مرحلة الفرصة، القيمة والعملة، الإجراء القادم، وآخر تحولات المرحلة.',
  },
  {
    key: 'recentInteractions',
    labelAr: 'سجل التواصل الأخير (المؤكد والمحاولات)',
    descriptionAr: 'ملخص آخر التفاعلات المسجلة والخطوات التالية المطلوبة.',
  },
  {
    key: 'clientNotes',
    labelAr: 'ملاحظات العميل العامة',
    descriptionAr: 'الملاحظات المرجعية المرتبطة بالعميل وملاحظات التحضير الإضافية.',
  },
];

export const DEFAULT_AI_BRIEFING_SECTION_SELECTION: AiBriefingSectionSelection = {
  currentMeeting: true,
  clientSummary: true,
  previousMeetings: true,
  openTasks: true,
  opportunityDetails: true,
  recentInteractions: true,
  clientNotes: true,
};

const PREPARATION_COLLECTION_LABELS_AR: Record<keyof PreparationCollectionsLoadedState, string> = {
  clients: 'العملاء',
  meetings: 'الاجتماعات',
  tasks: 'المهام',
  notes: 'الملاحظات',
  opportunities: 'فرص الأعمال',
  opportunityStageEvents: 'سجل مراحل الفرص',
  interactions: 'سجل التواصل',
};

/**
 * Outcomes that represent an unconfirmed communication attempt (e.g. No Answer, Busy/Callback, or outbound message awaiting reply).
 * Requirement C: Never count `no_answer` or any unconfirmed attempt as a confirmed successful contact.
 */
const UNCONFIRMED_ATTEMPT_OUTCOMES = new Set<CommunicationOutcome>([
  'no_answer',
  'busy_or_callback',
  'message_sent',
]);

export function isUnconfirmedAttemptOutcome(outcome: CommunicationOutcome): boolean {
  return UNCONFIRMED_ATTEMPT_OUTCOMES.has(outcome);
}

export function isConfirmedInteractionOutcome(outcome: CommunicationOutcome): boolean {
  return !UNCONFIRMED_ATTEMPT_OUTCOMES.has(outcome);
}

export function isConfirmedInteraction(interaction: CommunicationInteraction): boolean {
  return isConfirmedInteractionOutcome(interaction.outcome);
}

export function isAttemptInteraction(interaction: CommunicationInteraction): boolean {
  return isUnconfirmedAttemptOutcome(interaction.outcome);
}

function createGoalId(): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `goal-${Date.now()}-${rand}`;
}

export function isValidMeetingGoalStatus(val: unknown): val is MeetingGoalStatus {
  return (
    typeof val === 'string' &&
    (MEETING_GOAL_STATUS_ORDER as string[]).includes(val)
  );
}

/**
 * Normalizes and sorts preparation goals by 1-based order, enforcing max 20 items.
 */
export function normalizePreparationGoals(
  goals?: MeetingPreparationGoal[] | null
): MeetingPreparationGoal[] {
  if (!Array.isArray(goals)) return [];
  const now = new Date().toISOString();
  return [...goals]
    .filter((g) => g && typeof g === 'object' && typeof g.text === 'string' && g.text.trim().length > 0)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .slice(0, MAX_PREPARATION_GOALS)
    .map((g, idx) => {
      const clean: MeetingPreparationGoal = {
        id: (g.id || `goal-${idx + 1}`).slice(0, 64),
        text: g.text.trim().slice(0, MAX_PREPARATION_GOAL_TEXT_CHARS),
        status: isValidMeetingGoalStatus(g.status) ? g.status : 'planned',
        order: idx + 1,
        createdAt: g.createdAt || now,
        updatedAt: g.updatedAt || now,
      };
      if (g.note && g.note.trim()) {
        clean.note = g.note.trim().slice(0, MAX_PREPARATION_GOAL_NOTE_CHARS);
      }
      return clean;
    });
}

export function getMeetingPreparationData(meeting: Partial<Meeting>): MeetingPreparationData {
  const raw = meeting.preparation;
  return {
    goals: normalizePreparationGoals(raw?.goals),
    notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, MAX_PREPARATION_NOTES_CHARS) : undefined,
    dismissedTopicKeys: Array.isArray(raw?.dismissedTopicKeys)
      ? raw!.dismissedTopicKeys.filter((k) => typeof k === 'string' && k.trim().length > 0).slice(0, 60)
      : undefined,
    updatedAt: raw?.updatedAt || meeting.updatedAt || new Date().toISOString(),
  };
}

/**
 * Adds a preparation goal to a meeting.
 * Blocks if the meeting is cancelled or if max goals (20) is reached.
 * Prevents accidental duplicate goal text.
 */
export function addPreparationGoal(
  meeting: Meeting,
  input: { text: string; note?: string },
  nowIso: string = new Date().toISOString()
): { ok: true; meeting: Meeting; goal: MeetingPreparationGoal } | { ok: false; reasonArabic: string } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط) ولا يمكن إضافة أهداف جديدة له.',
    };
  }

  const cleanText = (input.text || '').trim().slice(0, MAX_PREPARATION_GOAL_TEXT_CHARS);
  if (cleanText.length < 2) {
    return {
      ok: false,
      reasonArabic: 'يرجى كتابة نص واضح للهدف (حرفان على الأقل).',
    };
  }

  const currentPrep = getMeetingPreparationData(meeting);
  if (currentPrep.goals.length >= MAX_PREPARATION_GOALS) {
    return {
      ok: false,
      reasonArabic: `تم الوصول للحد الأقصى لأهداف الاجتماع (${MAX_PREPARATION_GOALS} هدفًا).`,
    };
  }

  const normCandidate = normalizeTaskTitle(cleanText);
  const existingDuplicate = currentPrep.goals.find(
    (g) => normalizeTaskTitle(g.text) === normCandidate
  );
  if (existingDuplicate) {
    return {
      ok: false,
      reasonArabic: `يوجد هدف مطابق مسجل مسبقًا («${existingDuplicate.text}»).`,
    };
  }

  const newGoal: MeetingPreparationGoal = {
    id: createGoalId(),
    text: cleanText,
    status: 'planned',
    order: currentPrep.goals.length + 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (input.note && input.note.trim()) {
    newGoal.note = input.note.trim().slice(0, MAX_PREPARATION_GOAL_NOTE_CHARS);
  }

  const nextGoals = normalizePreparationGoals([...currentPrep.goals, newGoal]);
  const updatedMeeting: Meeting = {
    ...meeting,
    preparation: {
      ...currentPrep,
      goals: nextGoals,
      updatedAt: nowIso,
    },
    updatedAt: nowIso,
  };

  return { ok: true, meeting: updatedMeeting, goal: newGoal };
}

/**
 * Updates an existing preparation goal's text, status, or note.
 * Requirement L: Even when `meeting.minutesStatus === 'final'`, updating goal status/note
 * after the meeting is allowed because it does not alter the locked minutes content.
 * Blocks if `meeting.status === 'cancelled'`.
 */
export function updatePreparationGoal(
  meeting: Meeting,
  goalId: string,
  patch: Partial<Pick<MeetingPreparationGoal, 'text' | 'status' | 'note'>>,
  nowIso: string = new Date().toISOString()
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط) ولا يمكن تعديل أهدافه.',
    };
  }

  const currentPrep = getMeetingPreparationData(meeting);
  const target = currentPrep.goals.find((g) => g.id === goalId);
  if (!target) {
    return {
      ok: false,
      reasonArabic: 'الهدف المطلوب غير موجود.',
    };
  }

  if (patch.text !== undefined) {
    const cleanText = patch.text.trim().slice(0, MAX_PREPARATION_GOAL_TEXT_CHARS);
    if (cleanText.length < 2) {
      return {
        ok: false,
        reasonArabic: 'يرجى كتابة نص واضح للهدف (حرفان على الأقل).',
      };
    }
  }

  const nextGoals = currentPrep.goals.map((g) => {
    if (g.id !== goalId) return g;
    const nextText =
      patch.text !== undefined
        ? patch.text.trim().slice(0, MAX_PREPARATION_GOAL_TEXT_CHARS) || g.text
        : g.text;
    const nextStatus =
      patch.status !== undefined && isValidMeetingGoalStatus(patch.status)
        ? patch.status
        : g.status;
    const nextNote =
      patch.note !== undefined
        ? patch.note.trim().slice(0, MAX_PREPARATION_GOAL_NOTE_CHARS) || undefined
        : g.note;

    const updated: MeetingPreparationGoal = {
      ...g,
      text: nextText,
      status: nextStatus,
      updatedAt: nowIso,
    };
    if (nextNote) {
      updated.note = nextNote;
    } else {
      delete updated.note;
    }
    return updated;
  });

  return {
    ok: true,
    meeting: {
      ...meeting,
      preparation: {
        ...currentPrep,
        goals: normalizePreparationGoals(nextGoals),
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
    },
  };
}

/**
 * Removes a preparation goal from a meeting.
 */
export function removePreparationGoal(
  meeting: Meeting,
  goalId: string,
  nowIso: string = new Date().toISOString()
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط) ولا يمكن حذف أهدافه.',
    };
  }

  const currentPrep = getMeetingPreparationData(meeting);
  const filtered = normalizePreparationGoals(currentPrep.goals.filter((g) => g.id !== goalId));

  return {
    ok: true,
    meeting: {
      ...meeting,
      preparation: {
        ...currentPrep,
        goals: filtered,
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
    },
  };
}

/**
 * Reorders a preparation goal up or down.
 */
export function reorderPreparationGoals(
  meeting: Meeting,
  goalId: string,
  direction: 'up' | 'down',
  nowIso: string = new Date().toISOString()
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط).',
    };
  }

  const currentPrep = getMeetingPreparationData(meeting);
  const sorted = normalizePreparationGoals(currentPrep.goals);
  const idx = sorted.findIndex((g) => g.id === goalId);
  if (idx < 0) {
    return { ok: true, meeting };
  }

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) {
    return { ok: true, meeting };
  }

  const copy = [...sorted];
  const [moved] = copy.splice(idx, 1);
  copy.splice(targetIdx, 0, moved);
  const reordered = copy.map((g, i) => ({ ...g, order: i + 1 }));

  return {
    ok: true,
    meeting: {
      ...meeting,
      preparation: {
        ...currentPrep,
        goals: reordered,
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
    },
  };
}

/**
 * Updates general preparation notes on `meeting.preparation.notes`.
 */
export function updatePreparationNotes(
  meeting: Meeting,
  notes: string,
  nowIso: string = new Date().toISOString()
): { ok: true; meeting: Meeting } | { ok: false; reasonArabic: string } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط).',
    };
  }

  const currentPrep = getMeetingPreparationData(meeting);
  const cleanNotes = (notes || '').slice(0, MAX_PREPARATION_NOTES_CHARS);

  return {
    ok: true,
    meeting: {
      ...meeting,
      preparation: {
        ...currentPrep,
        notes: cleanNotes,
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
    },
  };
}

/**
 * Approves a suggested discussion topic into `meeting.agendaItems` with duplicate prevention,
 * final-minutes lock protection, and cancelled-meeting protection.
 */
export function approveSuggestedTopicIntoAgenda(
  meeting: Meeting,
  input: { title: string; notes?: string; durationMinutes?: number },
  nowIso: string = new Date().toISOString()
):
  | { ok: true; meeting: Meeting; addedItem: MeetingAgendaItem }
  | { ok: false; reasonArabic: string; duplicateItem?: MeetingAgendaItem } {
  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      reasonArabic: 'الاجتماع في حالة «ملغاة» (للقراءة فقط) ولا يمكن تعديل جدول أعماله.',
    };
  }

  if (isMinutesLocked(meeting)) {
    return {
      ok: false,
      reasonArabic:
        'محضر الاجتماع في حالة «نهائي» مقفل تنظيميًا. يرجى إعادة فتح المحضر من تبويب المحضر أولاً لتعديل جدول الأعمال.',
    };
  }

  const cleanTitle = (input.title || '').trim().slice(0, 200);
  if (cleanTitle.length < 2) {
    return {
      ok: false,
      reasonArabic: 'يرجى كتابة عنوان واضح لبند جدول الأعمال (حرفان على الأقل).',
    };
  }

  const existingAgenda = normalizeAgendaOrder(meeting.agendaItems || []);
  const normCandidate = normalizeTaskTitle(cleanTitle);
  const duplicate = existingAgenda.find(
    (item) => normalizeTaskTitle(item.title) === normCandidate
  );

  if (duplicate) {
    return {
      ok: false,
      reasonArabic: `يوجد بند مطابق في جدول الأعمال مسبقًا («${duplicate.title}»). تم منع التكرار.`,
      duplicateItem: duplicate,
    };
  }

  const nextAgenda = addAgendaItemToList(existingAgenda, {
    title: cleanTitle,
    notes: input.notes,
    durationMinutes: input.durationMinutes,
  });

  const addedItem = nextAgenda[nextAgenda.length - 1];

  return {
    ok: true,
    meeting: {
      ...meeting,
      agendaItems: nextAgenda,
      updatedAt: nowIso,
    },
    addedItem,
  };
}

/**
 * Dismisses a suggested topic key for this meeting so it doesn't clutter the active suggestions.
 */
export function dismissSuggestedTopicInMeeting(
  meeting: Meeting,
  topicKey: string,
  nowIso: string = new Date().toISOString()
): Meeting {
  if (meeting.status === 'cancelled') return meeting;
  const cleanKey = (topicKey || '').trim().slice(0, 128);
  if (!cleanKey) return meeting;

  const currentPrep = getMeetingPreparationData(meeting);
  const existingKeys = new Set(currentPrep.dismissedTopicKeys || []);
  existingKeys.add(cleanKey);

  return {
    ...meeting,
    preparation: {
      ...currentPrep,
      dismissedTopicKeys: Array.from(existingKeys).slice(0, 60),
      updatedAt: nowIso,
    },
    updatedAt: nowIso,
  };
}

export interface BuildMeetingPreparationBriefParams {
  meeting: Meeting;
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes?: Note[];
  opportunities?: Opportunity[];
  opportunityStageEvents?: OpportunityStageEvent[];
  interactions?: CommunicationInteraction[];
  currentUserId?: string;
  referenceDate?: Date;
  timeZone?: string;
  isOnline?: boolean;
  collectionsLoaded?: Partial<PreparationCollectionsLoadedState>;
  hasPendingWrites?: boolean;
}

/**
 * Level A: Deterministic Smart Preparation Engine.
 * Builds a complete, relationally verified, user-isolated `MeetingPreparationBrief`
 * without calling Gemini or mutating any source records.
 */
export function buildMeetingPreparationBrief(
  params: BuildMeetingPreparationBriefParams
): MeetingPreparationBrief {
  const {
    meeting,
    referenceDate = new Date(),
    timeZone,
    isOnline = true,
    hasPendingWrites = false,
  } = params;

  const uid = params.currentUserId || meeting.userId;
  const filterOwned = <T extends { userId?: string }>(items: T[] = []): T[] =>
    items.filter((item) => {
      if (!item) return false;
      if (uid && item.userId && item.userId !== uid) return false;
      return true;
    });

  const ownedClients = filterOwned(params.clients);
  const ownedMeetings = filterOwned(params.meetings);
  const ownedTasks = filterOwned(params.tasks);
  const ownedNotes = filterOwned(params.notes || []);
  const ownedOpportunities = filterOwned(params.opportunities || []);
  const ownedStageEvents = filterOwned(params.opportunityStageEvents || []);
  const ownedInteractions = filterOwned(params.interactions || []);

  // 1. Completeness & Sync Metadata
  const loadedState: PreparationCollectionsLoadedState = {
    clients: params.collectionsLoaded?.clients ?? true,
    meetings: params.collectionsLoaded?.meetings ?? true,
    tasks: params.collectionsLoaded?.tasks ?? true,
    notes: params.collectionsLoaded?.notes ?? true,
    opportunities: params.collectionsLoaded?.opportunities ?? true,
    opportunityStageEvents: params.collectionsLoaded?.opportunityStageEvents ?? true,
    interactions: params.collectionsLoaded?.interactions ?? true,
  };

  const unloadedCollectionsAr: string[] = [];
  (Object.keys(loadedState) as (keyof PreparationCollectionsLoadedState)[]).forEach((key) => {
    if (!loadedState[key]) {
      unloadedCollectionsAr.push(PREPARATION_COLLECTION_LABELS_AR[key]);
    }
  });

  const allCollectionsLoaded = unloadedCollectionsAr.length === 0;
  const isCompleteOnline = isOnline && allCollectionsLoaded && !hasPendingWrites;

  const completeness: PreparationCompletenessMeta = {
    isOnline,
    allCollectionsLoaded,
    unloadedCollectionsAr,
    hasPendingWrites,
    status: isCompleteOnline ? 'complete_online' : 'partial_or_offline',
    disclosureAr: isCompleteOnline
      ? COMPLETE_ONLINE_PREPARATION_DISCLOSURE_AR
      : PARTIAL_OR_OFFLINE_PREPARATION_DISCLOSURE_AR,
  };

  // 2. Client & Contacts
  const client = ownedClients.find((c) => c.id === meeting.clientId) || null;
  const contacts: ClientContact[] = Array.isArray(client?.contacts)
    ? client!.contacts.filter((ct) => ct && typeof ct.name === 'string' && ct.name.trim().length > 0)
    : [];
  const primaryContact = contacts.find((ct) => ct.isPrimary) || contacts[0] || null;
  const participants = getEffectiveParticipants(meeting);

  // 3. Linked Opportunity vs Other Open Client Opportunities (Strict same-client check)
  let linkedOpportunity: Opportunity | null = null;
  if (meeting.opportunityId && meeting.opportunityId.trim()) {
    const candidateOpp = ownedOpportunities.find((o) => o.id === meeting.opportunityId!.trim());
    // Requirement G: Never link an opportunity belonging to a different client
    if (candidateOpp && candidateOpp.clientId === meeting.clientId) {
      linkedOpportunity = candidateOpp;
    }
  }

  const linkedOpportunityStageEvents: OpportunityStageEvent[] = linkedOpportunity
    ? ownedStageEvents
        .filter((e) => e.opportunityId === linkedOpportunity!.id)
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, 5)
    : [];

  const otherClientOpportunities: Opportunity[] = ownedOpportunities
    .filter(
      (o) =>
        o.clientId === meeting.clientId &&
        isOpportunityOpen(o.stage) &&
        (!linkedOpportunity || o.id !== linkedOpportunity.id)
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // 4. Previous Non-Cancelled Meetings for the Same Client
  const currentMeetingMs = new Date(meeting.dateTime).getTime();
  const refMs = referenceDate.getTime();
  const cutoffMs = !Number.isNaN(currentMeetingMs) ? Math.min(currentMeetingMs, refMs) : refMs;

  const clientTasks = ownedTasks.filter((t) => t.clientId === meeting.clientId);

  const previousClientMeetingsRaw = ownedMeetings
    .filter((m) => {
      if (m.id === meeting.id) return false;
      if (m.clientId !== meeting.clientId) return false;
      // Requirement D: Exclude cancelled meetings from held previous meetings
      if (m.status === 'cancelled') return false;
      const ms = new Date(m.dateTime).getTime();
      if (Number.isNaN(ms)) return false;
      return m.status === 'completed' || ms <= cutoffMs;
    })
    .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

  const previousMeetings: PreviousMeetingBriefItem[] = previousClientMeetingsRaw
    .slice(0, 5)
    .map((prev) => {
      const discussions = getDiscussionSectionsForDisplay(prev);
      const summaryExcerpt = (discussions.primarySummary || '').slice(0, 360);
      const decisions = Array.isArray(prev.decisions) ? prev.decisions : [];
      const linkedTasksForPrev = clientTasks.filter((t) => t.meetingId === prev.id);
      const openTasksCount = linkedTasksForPrev.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress'
      ).length;
      const completedTasksCount = linkedTasksForPrev.filter(
        (t) => t.status === 'completed'
      ).length;

      return {
        meeting: prev,
        summaryExcerpt,
        decisions,
        openTasksCount,
        completedTasksCount,
      };
    });

  // Deduplicated recent decisions across previous meetings
  const seenDecisionKeys = new Set<string>();
  const recentDecisions: { decision: MeetingDecision; meetingId: string; meetingTitle: string; meetingDate: string }[] = [];
  for (const prevItem of previousMeetings) {
    for (const dec of prevItem.decisions) {
      const normDec = normalizeTaskTitle(dec.text);
      if (!normDec || seenDecisionKeys.has(normDec)) continue;
      seenDecisionKeys.add(normDec);
      recentDecisions.push({
        decision: dec,
        meetingId: prevItem.meeting.id,
        meetingTitle: prevItem.meeting.title,
        meetingDate: prevItem.meeting.dateTime,
      });
      if (recentDecisions.length >= 10) break;
    }
    if (recentDecisions.length >= 10) break;
  }

  // 5. Interactions Summary (Distinguishing Confirmed Contact vs Unconfirmed Attempt)
  const todayParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(todayParts);

  const clientInteractions = ownedInteractions
    .filter((item) => item.clientId === meeting.clientId)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const confirmedInteractions = clientInteractions.filter((i) => isConfirmedInteraction(i));
  const attemptInteractions = clientInteractions.filter((i) => isAttemptInteraction(i));

  const pastConfirmedInteractions = confirmedInteractions.filter((i) => {
    const ms = new Date(i.occurredAt).getTime();
    return !Number.isNaN(ms) && ms <= refMs;
  });

  const lastConfirmedInteraction = pastConfirmedInteractions[0] || confirmedInteractions[0] || null;
  const lastAttemptInteraction = attemptInteractions[0] || null;
  const lastHeldMeeting = previousClientMeetingsRaw[0] || null;

  // Compute lastConfirmedContactAt from confirmed past interactions + held non-cancelled meetings
  let lastConfirmedContactAt: string | null = null;
  const latestConfirmedInteractionIso = pastConfirmedInteractions[0]?.occurredAt || null;
  const latestHeldMeetingIso = lastHeldMeeting?.dateTime || null;

  if (latestConfirmedInteractionIso && latestHeldMeetingIso) {
    lastConfirmedContactAt =
      new Date(latestConfirmedInteractionIso).getTime() >= new Date(latestHeldMeetingIso).getTime()
        ? latestConfirmedInteractionIso
        : latestHeldMeetingIso;
  } else {
    lastConfirmedContactAt = latestConfirmedInteractionIso || latestHeldMeetingIso;
  }

  let daysSinceLastConfirmedContact: number | null = null;
  if (lastConfirmedContactAt) {
    const contactParts = resolveCalendarParts(lastConfirmedContactAt, timeZone);
    if (contactParts) {
      daysSinceLastConfirmedContact = Math.max(0, calendarDaysDiff(todayParts, contactParts));
    }
  }

  const pendingFollowUpInteractions: CommunicationInteraction[] = [];
  const overdueFollowUpInteractions: CommunicationInteraction[] = [];

  for (const item of clientInteractions) {
    if (isInteractionFollowUpPending(item, clientTasks)) {
      pendingFollowUpInteractions.push(item);
      const normFollowUpDate = item.nextFollowUpDate ? parseDateOnlyString(item.nextFollowUpDate) : null;
      if (normFollowUpDate) {
        const followUpKey = formatCalendarDateKey(normFollowUpDate);
        if (followUpKey < todayKey) {
          overdueFollowUpInteractions.push(item);
        }
      }
    }
  }

  // 6. Open Tasks & Commitments Categorization (Requirement E: Overdue, Due Today, Upcoming, No Due Date)
  // Exclude completed and cancelled tasks; deduplicate by id
  const seenTaskIds = new Set<string>();
  const openClientTasks: ActionItem[] = [];
  for (const task of clientTasks) {
    if (seenTaskIds.has(task.id)) continue;
    if (task.status === 'completed' || task.status === 'cancelled') continue;
    seenTaskIds.add(task.id);
    openClientTasks.push(task);
  }

  const overdueTasks: ActionItem[] = [];
  const dueTodayTasks: ActionItem[] = [];
  const upcomingTasks: ActionItem[] = [];
  const noDueDateTasks: ActionItem[] = [];

  for (const task of openClientTasks) {
    if (!task.dueDate || !task.dueDate.trim()) {
      noDueDateTasks.push(task);
      continue;
    }
    const dueParts = resolveCalendarParts(task.dueDate, timeZone);
    if (!dueParts) {
      noDueDateTasks.push(task);
      continue;
    }
    const dueKey = formatCalendarDateKey(dueParts);
    if (dueKey < todayKey) {
      overdueTasks.push(task);
    } else if (dueKey === todayKey) {
      dueTodayTasks.push(task);
    } else {
      upcomingTasks.push(task);
    }
  }

  const sortTasksDeterministic = (list: ActionItem[]): ActionItem[] =>
    [...list].sort((a, b) => {
      const rankDiff = (TASK_PRIORITY_RANK[b.priority] || 0) - (TASK_PRIORITY_RANK[a.priority] || 0);
      if (rankDiff !== 0) return rankDiff;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      return a.title.localeCompare(b.title, 'ar');
    });

  const sortedOverdue = sortTasksDeterministic(overdueTasks);
  const sortedDueToday = sortTasksDeterministic(dueTodayTasks);
  const sortedUpcoming = sortTasksDeterministic(upcomingTasks);
  const sortedNoDueDate = sortTasksDeterministic(noDueDateTasks);

  // 7. Preparation Data & Goals
  const prepData = getMeetingPreparationData(meeting);
  const goals = prepData.goals;
  const preparationNotes = prepData.notes || '';
  const dismissedKeys = new Set(prepData.dismissedTopicKeys || []);

  // 8. Client Notes
  const clientNotes = ownedNotes
    .filter((n) => n.clientId === meeting.clientId)
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    })
    .slice(0, 6);

  // 9. Suggested Discussion Topics (Requirement H)
  const existingAgendaNormTitles = new Set(
    (meeting.agendaItems || []).map((item) => normalizeTaskTitle(item.title))
  );

  const suggestedTopics = extractSuggestedDiscussionTopics({
    overdueTasks: sortedOverdue,
    dueTodayTasks: sortedDueToday,
    linkedOpportunity,
    otherClientOpportunities,
    pendingFollowUpInteractions,
    overdueFollowUpInteractions,
    previousMeetings,
    existingAgendaNormTitles,
    dismissedKeys,
    todayKey,
  });

  // 10. Lock & Edit Guards (Requirement L)
  const minutesStatus = getMinutesStatus(meeting);
  const isMinutesFinalLocked = isMinutesLocked(meeting);
  const isMeetingCancelled = meeting.status === 'cancelled';

  return {
    meeting,
    client,
    primaryContact,
    contacts,
    participants,
    completeness,
    relationshipSummary: {
      totalInteractionsCount: clientInteractions.length,
      confirmedInteractionsCount: confirmedInteractions.length,
      attemptInteractionsCount: attemptInteractions.length,
      lastConfirmedInteraction,
      lastAttemptInteraction,
      lastHeldMeeting,
      lastConfirmedContactAt,
      daysSinceLastConfirmedContact,
      pendingFollowUpInteractions,
      overdueFollowUpInteractions,
      recentInteractions: clientInteractions.slice(0, 5),
      recordsDisclosureAr: PREPARATION_RECORDS_DISCLOSURE_AR,
    },
    previousMeetings,
    recentDecisions,
    openTasks: {
      overdue: sortedOverdue,
      dueToday: sortedDueToday,
      upcoming: sortedUpcoming,
      noDueDate: sortedNoDueDate,
      totalOpenCount: openClientTasks.length,
    },
    opportunitiesContext: {
      linkedOpportunity,
      linkedOpportunityStageEvents,
      otherClientOpportunities,
    },
    suggestedTopics,
    goals,
    preparationNotes,
    clientNotes,
    isMinutesFinalLocked,
    isMeetingCancelled,
    canEditAgendaAndMinutes: !isMinutesFinalLocked && !isMeetingCancelled,
    canEditGoals: !isMeetingCancelled,
    canUpdatePostMeetingGoalStatus: !isMeetingCancelled,
    minutesStatusLabelAr: MINUTES_STATUS_CONFIG[minutesStatus].labelAr,
  };
}

interface ExtractSuggestedTopicsParams {
  overdueTasks: ActionItem[];
  dueTodayTasks: ActionItem[];
  linkedOpportunity: Opportunity | null;
  otherClientOpportunities: Opportunity[];
  pendingFollowUpInteractions: CommunicationInteraction[];
  overdueFollowUpInteractions: CommunicationInteraction[];
  previousMeetings: PreviousMeetingBriefItem[];
  existingAgendaNormTitles: Set<string>;
  dismissedKeys: Set<string>;
  todayKey: string;
}

/**
 * Extracts deterministic suggested discussion topics from:
 * 1. Overdue tasks
 * 2. Due-today tasks
 * 3. Linked opportunity nextAction
 * 4. Overdue/pending interaction follow-ups
 * 5. Previous meeting followUpDateTime / decisions
 * Deduplicates by normalized title while marking `alreadyInAgenda` and `isDismissed`.
 */
export function extractSuggestedDiscussionTopics(
  params: ExtractSuggestedTopicsParams
): SuggestedDiscussionTopic[] {
  const topics: SuggestedDiscussionTopic[] = [];
  const seenNormTitles = new Set<string>();

  const pushCandidate = (candidate: Omit<SuggestedDiscussionTopic, 'alreadyInAgenda' | 'isDismissed'>) => {
    const cleanTitle = candidate.title.trim().slice(0, 200);
    if (!cleanTitle) return;
    const norm = normalizeTaskTitle(cleanTitle);
    if (!norm || seenNormTitles.has(norm)) return;
    seenNormTitles.add(norm);

    topics.push({
      ...candidate,
      title: cleanTitle,
      alreadyInAgenda: params.existingAgendaNormTitles.has(norm),
      isDismissed: params.dismissedKeys.has(candidate.key),
    });
  };

  // 1. Overdue Tasks
  for (const task of params.overdueTasks.slice(0, 5)) {
    const key = `topic-task-overdue-${task.id}`;
    pushCandidate({
      key,
      title: `متابعة المهمة المتأخرة: ${task.title}`,
      reasonAr: `مهمة متأخرة منذ ${task.dueDate || 'تاريخ سابق'} (${
        task.priority === 'urgent' ? 'عاجلة' : task.priority === 'high' ? 'أولوية عالية' : 'مفتوحة'
      })`,
      sourceType: 'overdue_task',
      sourceId: task.id,
      sourceLabelAr: `مهمة: ${task.title}`,
      priorityWeight: 100 + (TASK_PRIORITY_RANK[task.priority] || 1),
    });
  }

  // 2. Due Today Tasks
  for (const task of params.dueTodayTasks.slice(0, 4)) {
    const key = `topic-task-today-${task.id}`;
    pushCandidate({
      key,
      title: `حسم المهمة المستحقة اليوم: ${task.title}`,
      reasonAr: 'مهمة مستحقة بتاريخ اليوم وتحتاج إلى مراجعة خلال الاجتماع',
      sourceType: 'due_today_task',
      sourceId: task.id,
      sourceLabelAr: `مهمة اليوم: ${task.title}`,
      priorityWeight: 90 + (TASK_PRIORITY_RANK[task.priority] || 1),
    });
  }

  // 3. Linked Opportunity Next Action
  if (params.linkedOpportunity) {
    const opp = params.linkedOpportunity;
    const stageLabel = OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage;
    if (opp.nextAction && opp.nextAction.trim()) {
      const key = `topic-opp-action-${opp.id}`;
      const isActionOverdue = Boolean(opp.nextActionDate && opp.nextActionDate < params.todayKey);
      pushCandidate({
        key,
        title: `الفرصة المرتبطة (${opp.title}): ${opp.nextAction.trim()}`,
        reasonAr: isActionOverdue
          ? `إجراء الفرصة القادم متأخر عن ${opp.nextActionDate} — المرحلة: ${stageLabel}`
          : `الخطوة القادمة المسجلة للفرصة في مرحلة «${stageLabel}»${
              opp.nextActionDate ? ` (بتاريخ ${opp.nextActionDate})` : ''
            }`,
        sourceType: 'opportunity_next_action',
        sourceId: opp.id,
        sourceLabelAr: `فرصة: ${opp.title}`,
        priorityWeight: isActionOverdue ? 96 : 85,
      });
    } else if (isOpportunityOpen(opp.stage)) {
      const key = `topic-opp-stage-${opp.id}`;
      pushCandidate({
        key,
        title: `تحديد الخطوة القادمة للفرصة: ${opp.title}`,
        reasonAr: `الفرصة في مرحلة «${stageLabel}» ولا توجد خطوة تالية محددة لها حاليًا`,
        sourceType: 'opportunity_next_action',
        sourceId: opp.id,
        sourceLabelAr: `فرصة: ${opp.title}`,
        priorityWeight: 82,
      });
    }
  } else if (params.otherClientOpportunities.length > 0) {
    const topOther = params.otherClientOpportunities[0];
    if (topOther.nextAction && topOther.nextAction.trim()) {
      const key = `topic-other-opp-${topOther.id}`;
      const stageLabel = OPPORTUNITY_STAGE_CONFIG[topOther.stage]?.labelAr || topOther.stage;
      pushCandidate({
        key,
        title: `مراجعة الفرصة المفتوحة (${topOther.title}): ${topOther.nextAction.trim()}`,
        reasonAr: `فرصة مفتوحة مرتبطة بالعميل في مرحلة «${stageLabel}»`,
        sourceType: 'opportunity_next_action',
        sourceId: topOther.id,
        sourceLabelAr: `فرصة: ${topOther.title}`,
        priorityWeight: 75,
      });
    }
  }

  // 4. Interaction Follow-Ups (Overdue first, then pending)
  const orderedFollowUpInteractions = [
    ...params.overdueFollowUpInteractions,
    ...params.pendingFollowUpInteractions.filter(
      (i) => !params.overdueFollowUpInteractions.some((o) => o.id === i.id)
    ),
  ];

  for (const interaction of orderedFollowUpInteractions.slice(0, 4)) {
    const key = `topic-interaction-${interaction.id}`;
    const channelLabel = COMMUNICATION_CHANNEL_META[interaction.channel]?.shortLabelAr || 'تواصل';
    const outcomeLabel = COMMUNICATION_OUTCOME_META[interaction.outcome]?.labelAr || interaction.outcome;
    const isOverdue = Boolean(
      interaction.nextFollowUpDate && interaction.nextFollowUpDate < params.todayKey
    );
    const topicTitle =
      interaction.nextStep && interaction.nextStep.trim()
        ? `متابعة ${channelLabel}: ${interaction.nextStep.trim()}`
        : `متابعة موضوع التواصل: ${interaction.subject}`;

    pushCandidate({
      key,
      title: topicTitle,
      reasonAr: isOverdue
        ? `متابعة تواصل متأخرة منذ ${interaction.nextFollowUpDate} (${outcomeLabel})`
        : `خطوة تالية مسجلة من ${channelLabel} بتاريخ ${interaction.occurredAt.slice(0, 10)} (${outcomeLabel})`,
      sourceType: 'interaction_follow_up',
      sourceId: interaction.id,
      sourceLabelAr: `تواصل: ${interaction.subject}`,
      priorityWeight: isOverdue ? 92 : 78,
    });
  }

  // 5. Previous Meetings Follow-Ups & Recent Decisions
  const latestPrev = params.previousMeetings[0];
  if (latestPrev) {
    if (latestPrev.meeting.followUpDateTime || latestPrev.meeting.isFollowUpScheduled) {
      const key = `topic-prev-followup-${latestPrev.meeting.id}`;
      pushCandidate({
        key,
        title: `مراجعة مخرجات اللقاء السابق: ${latestPrev.meeting.title}`,
        reasonAr: `تم تحديد متابعة للقاء السابق المنعقد بتاريخ ${latestPrev.meeting.dateTime.slice(0, 10)}`,
        sourceType: 'previous_meeting_follow_up',
        sourceId: latestPrev.meeting.id,
        sourceLabelAr: `لقاء سابق: ${latestPrev.meeting.title}`,
        priorityWeight: 74,
      });
    }

    for (const dec of latestPrev.decisions.slice(0, 2)) {
      const key = `topic-prev-decision-${dec.id}`;
      pushCandidate({
        key,
        title: `متابعة تنفيذ القرار: ${dec.text}`,
        reasonAr: `قرار معتمد في الاجتماع السابق «${latestPrev.meeting.title}»${
          dec.ownerName ? ` (المسؤول: ${dec.ownerName})` : ''
        }`,
        sourceType: 'previous_decision',
        sourceId: latestPrev.meeting.id,
        sourceLabelAr: `قرار من: ${latestPrev.meeting.title}`,
        priorityWeight: 70,
      });
    }
  }

  return topics.sort((a, b) => b.priorityWeight - a.priorityWeight).slice(0, 12);
}

// ============================================================================
// Level B: AI Advanced Briefing Payload Builder, Sanitizer & Validator
// ============================================================================

function clampText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return redactTemporaryAttachmentUrls(value.trim()).slice(0, maxLen);
}

export interface BuildAiBriefingBundleResult {
  payload: AiBriefingInputPayload;
  previewText: string;
  charCount: number;
  maxChars: number;
  wasTruncated: boolean;
  truncatedSectionsAr: string[];
  excludedItemsAr: string[];
}

/**
 * Builds the exact sanitized, redacted, character-bounded payload and human-readable preview text
 * to show in the explicit user consent modal before sending anything to `/api/ai/meeting-briefing`.
 */
export function buildMeetingAiBriefingInputBundle(
  brief: MeetingPreparationBrief,
  selection: AiBriefingSectionSelection = DEFAULT_AI_BRIEFING_SECTION_SELECTION
): BuildAiBriefingBundleResult {
  const { meeting, client } = brief;
  const truncatedSectionsAr: string[] = [];

  const excludedItemsAr: string[] = [
    'ملفات وصور المرفقات المخزنة في Backblaze B2 والروابط المؤقتة',
    'بيانات العملاء الآخرين غير المرتبطين بهذا الاجتماع',
    'مفاتيح النظام ورموز الجلسة والمصادقة',
  ];

  const payload: AiBriefingInputPayload = {
    meetingId: meeting.id,
    meetingTitle: clampText(meeting.title, 200) || 'لقاء بدون عنوان',
    meetingDateTime: clampText(meeting.dateTime, 50),
    meetingType: MEETING_TYPE_LABELS[meeting.type]?.ar || meeting.type,
    meetingStatus: MEETING_STATUS_LABELS[meeting.status]?.ar || meeting.status,
    includedSections: { ...selection },
    agendaItems: [],
    preparationGoals: [],
    previousMeetings: [],
    openTasks: [],
    recentInteractions: [],
    clientNotes: [],
  };

  if (selection.currentMeeting) {
    if (meeting.location) {
      payload.meetingLocation = clampText(meeting.location, 200);
    }
    payload.agendaItems = (meeting.agendaItems || []).slice(0, 20).map((a) => ({
      title: clampText(a.title, 200),
      notes: a.notes ? clampText(a.notes, 400) : undefined,
    }));
    payload.preparationGoals = brief.goals.slice(0, 15).map((g) => ({
      text: clampText(g.text, 250),
      status: MEETING_GOAL_STATUS_META[g.status]?.labelAr || g.status,
      note: g.note ? clampText(g.note, 300) : undefined,
    }));
    if (brief.preparationNotes) {
      payload.preparationNotes = clampText(brief.preparationNotes, 1500);
    }
  } else {
    excludedItemsAr.push('جدول الأعمال وأهداف الاجتماع الحالية (تم إلغاء تحديدها من المستخدم)');
  }

  if (selection.clientSummary && client) {
    payload.clientSummary = {
      name: clampText(client.name, 150),
      company: client.company ? clampText(client.company, 150) : undefined,
      industry: client.industry ? clampText(client.industry, 100) : undefined,
      relationshipStatus: client.relationshipStatus,
      importance: client.importance,
      primaryContactName: brief.primaryContact?.name
        ? clampText(brief.primaryContact.name, 120)
        : undefined,
      primaryContactRole: brief.primaryContact?.title
        ? clampText(brief.primaryContact.title, 100)
        : undefined,
    };
  } else if (!selection.clientSummary) {
    excludedItemsAr.push('ملخص بيانات العميل وجهة الاتصال (تم إلغاء تحديدها من المستخدم)');
  }

  if (selection.previousMeetings) {
    if (brief.previousMeetings.length > 4) {
      truncatedSectionsAr.push(`الاجتماعات السابقة (تم تضمين أحدث 4 من أصل ${brief.previousMeetings.length})`);
    }
    payload.previousMeetings = brief.previousMeetings.slice(0, 4).map((pm) => ({
      title: clampText(pm.meeting.title, 160),
      dateTime: clampText(pm.meeting.dateTime, 40),
      status: MEETING_STATUS_LABELS[pm.meeting.status]?.ar || pm.meeting.status,
      summary: clampText(pm.summaryExcerpt, 350),
      decisions: pm.decisions.slice(0, 5).map((d) => clampText(d.text, 220)),
    }));
  } else {
    excludedItemsAr.push('ملخص الاجتماعات السابقة والقرارات (تم إلغاء تحديدها من المستخدم)');
  }

  if (selection.openTasks) {
    const allOpen = [
      ...brief.openTasks.overdue.map((t) => ({ t, bucket: 'متأخرة' })),
      ...brief.openTasks.dueToday.map((t) => ({ t, bucket: 'مستحقة اليوم' })),
      ...brief.openTasks.upcoming.map((t) => ({ t, bucket: 'قادمة' })),
      ...brief.openTasks.noDueDate.map((t) => ({ t, bucket: 'بدون تاريخ' })),
    ];
    if (allOpen.length > 12) {
      truncatedSectionsAr.push(`المهام المفتوحة (تم تضمين أهم 12 من أصل ${allOpen.length})`);
    }
    payload.openTasks = allOpen.slice(0, 12).map(({ t, bucket }) => ({
      title: clampText(t.title, 180),
      dueDate: t.dueDate ? clampText(t.dueDate, 30) : undefined,
      priority: t.priority,
      status: t.status,
      bucket,
    }));
  } else {
    excludedItemsAr.push('المهام والالتزامات المفتوحة (تم إلغاء تحديدها من المستخدم)');
  }

  if (selection.opportunityDetails) {
    if (brief.opportunitiesContext.linkedOpportunity) {
      const opp = brief.opportunitiesContext.linkedOpportunity;
      payload.linkedOpportunity = {
        title: clampText(opp.title, 180),
        stage: OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage,
        priority: opp.priority,
        valueDisplay:
          opp.estimatedValue !== undefined && opp.currency
            ? formatOpportunityValue(opp.estimatedValue, opp.currency)
            : undefined,
        expectedCloseDate: opp.expectedCloseDate,
        nextAction: opp.nextAction ? clampText(opp.nextAction, 240) : undefined,
        nextActionDate: opp.nextActionDate,
      };
    }
    if (brief.opportunitiesContext.otherClientOpportunities.length > 0) {
      payload.otherOpenOpportunitiesCount = brief.opportunitiesContext.otherClientOpportunities.length;
    }
  } else {
    excludedItemsAr.push('بيانات الفرصة المرتبطة (تم إلغاء تحديدها من المستخدم)');
  }

  if (selection.recentInteractions) {
    const recent = brief.relationshipSummary.recentInteractions;
    if (brief.relationshipSummary.totalInteractionsCount > 5) {
      truncatedSectionsAr.push(
        `سجل التواصل (تم تضمين أحدث 5 من أصل ${brief.relationshipSummary.totalInteractionsCount})`
      );
    }
    payload.recentInteractions = recent.slice(0, 5).map((item) => ({
      channel: COMMUNICATION_CHANNEL_META[item.channel]?.labelAr || item.channel,
      direction: item.direction === 'inbound' ? 'وارد من العميل' : 'صادر للعميل',
      occurredAt: clampText(item.occurredAt, 40),
      outcome: COMMUNICATION_OUTCOME_META[item.outcome]?.labelAr || item.outcome,
      isConfirmedContact: isConfirmedInteraction(item),
      subject: clampText(item.subject, 160),
      summary: item.summary ? clampText(item.summary, 300) : undefined,
      nextStep: item.nextStep ? clampText(item.nextStep, 200) : undefined,
      nextFollowUpDate: item.nextFollowUpDate,
    }));
  } else {
    excludedItemsAr.push('سجل التواصل الأخير (تم إلغاء تحديده من المستخدم)');
  }

  if (selection.clientNotes) {
    if (brief.clientNotes.length > 4) {
      truncatedSectionsAr.push(`ملاحظات العميل (تم تضمين أحدث 4 من أصل ${brief.clientNotes.length})`);
    }
    payload.clientNotes = brief.clientNotes.slice(0, 4).map((n) => ({
      title: clampText(n.title, 140),
      content: clampText(n.content, 400),
    }));
  } else {
    excludedItemsAr.push('ملاحظات العميل المرجعية (تم إلغاء تحديدها من المستخدم)');
  }

  let previewText = formatAiBriefingConsentPreviewText(payload);
  let wasTruncated = truncatedSectionsAr.length > 0;

  if (previewText.length > MAX_AI_BRIEFING_INPUT_CHARS) {
    wasTruncated = true;
    truncatedSectionsAr.push(
      `تم اقتصاص النص الإجمالي ليلتزم بالحد الأقصى الآمن (${MAX_AI_BRIEFING_INPUT_CHARS} حرف)`
    );
    previewText = previewText.slice(0, MAX_AI_BRIEFING_INPUT_CHARS);
  }

  return {
    payload,
    previewText,
    charCount: previewText.length,
    maxChars: MAX_AI_BRIEFING_INPUT_CHARS,
    wasTruncated,
    truncatedSectionsAr,
    excludedItemsAr,
  };
}

export function formatAiBriefingConsentPreviewText(payload: AiBriefingInputPayload): string {
  const lines: string[] = [];
  lines.push(`=== بيانات الاجتماع الحالي ===`);
  lines.push(`العنوان: ${payload.meetingTitle}`);
  lines.push(`التاريخ والوقت: ${payload.meetingDateTime}`);
  if (payload.meetingType) lines.push(`النوع: ${payload.meetingType}`);
  if (payload.meetingLocation) lines.push(`المكان: ${payload.meetingLocation}`);

  if (payload.clientSummary) {
    lines.push('');
    lines.push(`=== ملخص العميل ===`);
    lines.push(
      `العميل: ${payload.clientSummary.name}${
        payload.clientSummary.company ? ` — ${payload.clientSummary.company}` : ''
      }`
    );
    if (payload.clientSummary.industry) lines.push(`القطاع: ${payload.clientSummary.industry}`);
    if (payload.clientSummary.primaryContactName) {
      lines.push(
        `جهة الاتصال الرئيسية: ${payload.clientSummary.primaryContactName}${
          payload.clientSummary.primaryContactRole ? ` (${payload.clientSummary.primaryContactRole})` : ''
        }`
      );
    }
  }

  if (payload.agendaItems && payload.agendaItems.length > 0) {
    lines.push('');
    lines.push(`=== جدول الأعمال الحالي ===`);
    payload.agendaItems.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title}${a.notes ? ` — ${a.notes}` : ''}`);
    });
  }

  if (payload.preparationGoals && payload.preparationGoals.length > 0) {
    lines.push('');
    lines.push(`=== أهداف الاجتماع المسجلة ===`);
    payload.preparationGoals.forEach((g, i) => {
      lines.push(`${i + 1}. [${g.status}] ${g.text}${g.note ? ` — ${g.note}` : ''}`);
    });
  }

  if (payload.preparationNotes) {
    lines.push('');
    lines.push(`=== ملاحظات التحضير ===`);
    lines.push(payload.preparationNotes);
  }

  if (payload.linkedOpportunity) {
    lines.push('');
    lines.push(`=== الفرصة المرتبطة ===`);
    lines.push(`الفرصة: ${payload.linkedOpportunity.title} (المرحلة: ${payload.linkedOpportunity.stage})`);
    if (payload.linkedOpportunity.valueDisplay) {
      lines.push(`القيمة التقديرية: ${payload.linkedOpportunity.valueDisplay}`);
    }
    if (payload.linkedOpportunity.nextAction) {
      lines.push(
        `الإجراء القادم: ${payload.linkedOpportunity.nextAction}${
          payload.linkedOpportunity.nextActionDate ? ` (${payload.linkedOpportunity.nextActionDate})` : ''
        }`
      );
    }
  }

  if (payload.previousMeetings && payload.previousMeetings.length > 0) {
    lines.push('');
    lines.push(`=== الاجتماعات السابقة (غير الملغاة) ===`);
    payload.previousMeetings.forEach((pm, i) => {
      lines.push(`${i + 1}. ${pm.title} (${pm.dateTime.slice(0, 10)})`);
      if (pm.summary) lines.push(`   الملخص: ${pm.summary}`);
      if (pm.decisions.length > 0) {
        lines.push(`   القرارات: ${pm.decisions.join(' | ')}`);
      }
    });
  }

  if (payload.openTasks && payload.openTasks.length > 0) {
    lines.push('');
    lines.push(`=== المهام والالتزامات المفتوحة ===`);
    payload.openTasks.forEach((t, i) => {
      lines.push(
        `${i + 1}. [${t.bucket}] ${t.title}${t.dueDate ? ` (الاستحقاق: ${t.dueDate})` : ''} — الأولوية: ${t.priority}`
      );
    });
  }

  if (payload.recentInteractions && payload.recentInteractions.length > 0) {
    lines.push('');
    lines.push(`=== سجل التواصل الأخير ===`);
    payload.recentInteractions.forEach((it, i) => {
      const contactNature = it.isConfirmedContact ? 'تواصل مؤكد' : 'محاولة غير مؤكدة';
      lines.push(
        `${i + 1}. [${contactNature}] ${it.channel} (${it.direction}) بتاريخ ${it.occurredAt.slice(0, 10)} — النتيجة: ${it.outcome} — الموضوع: ${it.subject}`
      );
      if (it.summary) lines.push(`   الملخص: ${it.summary}`);
      if (it.nextStep) lines.push(`   الخطوة التالية: ${it.nextStep}`);
    });
  }

  if (payload.clientNotes && payload.clientNotes.length > 0) {
    lines.push('');
    lines.push(`=== ملاحظات العميل ===`);
    payload.clientNotes.forEach((n, i) => {
      lines.push(`${i + 1}. ${n.title}: ${n.content}`);
    });
  }

  return lines.join('\n').trim();
}

/**
 * Sanitizes and validates incoming `/api/ai/meeting-briefing` request body on the server.
 */
export function sanitizeIncomingAiBriefingPayload(
  raw: unknown
): { ok: true; data: AiBriefingInputPayload; totalChars: number } | { ok: false; errorArabic: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errorArabic: 'بيانات طلب التحضير الذكي غير صالحة.' };
  }

  const body = raw as Record<string, unknown>;
  const meetingId = typeof body.meetingId === 'string' ? body.meetingId.trim() : '';
  if (!meetingId || meetingId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(meetingId)) {
    return { ok: false, errorArabic: 'معرّف الاجتماع غير صالح.' };
  }

  const rawIncluded =
    body.includedSections && typeof body.includedSections === 'object'
      ? (body.includedSections as Record<string, unknown>)
      : {};

  const includedSections: AiBriefingSectionSelection = {
    currentMeeting: Boolean(rawIncluded.currentMeeting ?? true),
    clientSummary: Boolean(rawIncluded.clientSummary ?? true),
    previousMeetings: Boolean(rawIncluded.previousMeetings ?? true),
    openTasks: Boolean(rawIncluded.openTasks ?? true),
    opportunityDetails: Boolean(rawIncluded.opportunityDetails ?? true),
    recentInteractions: Boolean(rawIncluded.recentInteractions ?? true),
    clientNotes: Boolean(rawIncluded.clientNotes ?? true),
  };

  const sanitized: AiBriefingInputPayload = {
    meetingId,
    meetingTitle: clampText(body.meetingTitle, 200) || 'لقاء بدون عنوان',
    meetingDateTime: clampText(body.meetingDateTime, 50),
    meetingType: clampText(body.meetingType, 60) || undefined,
    meetingLocation: clampText(body.meetingLocation, 200) || undefined,
    meetingStatus: clampText(body.meetingStatus, 40) || undefined,
    includedSections,
  };

  if (includedSections.clientSummary && body.clientSummary && typeof body.clientSummary === 'object') {
    const cs = body.clientSummary as Record<string, unknown>;
    const cName = clampText(cs.name, 150);
    if (cName) {
      sanitized.clientSummary = {
        name: cName,
        company: clampText(cs.company, 150) || undefined,
        industry: clampText(cs.industry, 100) || undefined,
        relationshipStatus: clampText(cs.relationshipStatus, 50) || undefined,
        importance: clampText(cs.importance, 30) || undefined,
        primaryContactName: clampText(cs.primaryContactName, 120) || undefined,
        primaryContactRole: clampText(cs.primaryContactRole, 100) || undefined,
      };
    }
  }

  if (includedSections.currentMeeting) {
    if (Array.isArray(body.agendaItems)) {
      sanitized.agendaItems = body.agendaItems
        .filter((a) => a && typeof a === 'object')
        .slice(0, 25)
        .map((a: any) => ({
          title: clampText(a.title, 200),
          notes: clampText(a.notes, 400) || undefined,
        }))
        .filter((a) => a.title.length > 0);
    }
    if (Array.isArray(body.preparationGoals)) {
      sanitized.preparationGoals = body.preparationGoals
        .filter((g) => g && typeof g === 'object')
        .slice(0, 20)
        .map((g: any) => ({
          text: clampText(g.text, 250),
          status: clampText(g.status, 40) || 'مخطط',
          note: clampText(g.note, 300) || undefined,
        }))
        .filter((g) => g.text.length > 0);
    }
    if (typeof body.preparationNotes === 'string' && body.preparationNotes.trim()) {
      sanitized.preparationNotes = clampText(body.preparationNotes, 1500);
    }
  }

  if (includedSections.previousMeetings && Array.isArray(body.previousMeetings)) {
    sanitized.previousMeetings = body.previousMeetings
      .filter((pm) => pm && typeof pm === 'object')
      .slice(0, 5)
      .map((pm: any) => ({
        title: clampText(pm.title, 160),
        dateTime: clampText(pm.dateTime, 40),
        status: clampText(pm.status, 40),
        summary: clampText(pm.summary, 350),
        decisions: Array.isArray(pm.decisions)
          ? pm.decisions.slice(0, 6).map((d: unknown) => clampText(d, 220)).filter(Boolean)
          : [],
      }))
      .filter((pm) => pm.title.length > 0);
  }

  if (includedSections.openTasks && Array.isArray(body.openTasks)) {
    sanitized.openTasks = body.openTasks
      .filter((t) => t && typeof t === 'object')
      .slice(0, 15)
      .map((t: any) => ({
        title: clampText(t.title, 180),
        dueDate: clampText(t.dueDate, 30) || undefined,
        priority: clampText(t.priority, 30),
        status: clampText(t.status, 30),
        bucket: clampText(t.bucket, 40),
      }))
      .filter((t) => t.title.length > 0);
  }

  if (
    includedSections.opportunityDetails &&
    body.linkedOpportunity &&
    typeof body.linkedOpportunity === 'object'
  ) {
    const lo = body.linkedOpportunity as Record<string, unknown>;
    const loTitle = clampText(lo.title, 180);
    if (loTitle) {
      sanitized.linkedOpportunity = {
        title: loTitle,
        stage: clampText(lo.stage, 60),
        priority: clampText(lo.priority, 30),
        valueDisplay: clampText(lo.valueDisplay, 80) || undefined,
        expectedCloseDate: clampText(lo.expectedCloseDate, 30) || undefined,
        nextAction: clampText(lo.nextAction, 240) || undefined,
        nextActionDate: clampText(lo.nextActionDate, 30) || undefined,
      };
    }
    if (typeof body.otherOpenOpportunitiesCount === 'number') {
      sanitized.otherOpenOpportunitiesCount = Math.max(
        0,
        Math.min(100, Math.round(body.otherOpenOpportunitiesCount))
      );
    }
  }

  if (includedSections.recentInteractions && Array.isArray(body.recentInteractions)) {
    sanitized.recentInteractions = body.recentInteractions
      .filter((it) => it && typeof it === 'object')
      .slice(0, 6)
      .map((it: any) => ({
        channel: clampText(it.channel, 60),
        direction: clampText(it.direction, 40),
        occurredAt: clampText(it.occurredAt, 40),
        outcome: clampText(it.outcome, 60),
        isConfirmedContact: Boolean(it.isConfirmedContact),
        subject: clampText(it.subject, 160),
        summary: clampText(it.summary, 300) || undefined,
        nextStep: clampText(it.nextStep, 200) || undefined,
        nextFollowUpDate: clampText(it.nextFollowUpDate, 30) || undefined,
      }))
      .filter((it) => it.subject.length > 0);
  }

  if (includedSections.clientNotes && Array.isArray(body.clientNotes)) {
    sanitized.clientNotes = body.clientNotes
      .filter((n) => n && typeof n === 'object')
      .slice(0, 5)
      .map((n: any) => ({
        title: clampText(n.title, 140),
        content: clampText(n.content, 400),
      }))
      .filter((n) => n.title.length > 0 || n.content.length > 0);
  }

  const previewText = formatAiBriefingConsentPreviewText(sanitized);
  if (previewText.length < 15) {
    return {
      ok: false,
      errorArabic: 'يرجى تضمين قسم واحد على الأقل يحتوي على بيانات كافية لتوليد التحضير الذكي.',
    };
  }
  if (previewText.length > MAX_AI_BRIEFING_INPUT_CHARS) {
    return {
      ok: false,
      errorArabic: `حجم البيانات المرسلة يتجاوز الحد المسموح به (${MAX_AI_BRIEFING_INPUT_CHARS} حرف).`,
    };
  }

  return { ok: true, data: sanitized, totalChars: previewText.length };
}

/**
 * Validates and normalizes the raw JSON returned by Gemini for `/api/ai/meeting-briefing`.
 * Enforces strict schema bounds, valid `basisType`, and non-empty strings.
 */
export function validateAndNormalizeMeetingBriefingAi(
  raw: unknown,
  options?: { modelUsed?: string; generatedAt?: string }
): { ok: true; data: MeetingAiBriefingResult } | { ok: false; errorArabic: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      errorArabic: 'استجابة المساعد الذكي غير صالحة (ليست كائن JSON متوافق).',
    };
  }

  const obj = raw as Record<string, unknown>;
  const executiveBriefing = clampText(obj.executiveBriefing, 2500);
  if (!executiveBriefing || executiveBriefing.length < 5) {
    return {
      ok: false,
      errorArabic: 'لم يتمكن المساعد الذكي من توليد موجز تنفيذي صالح للاجتماع.',
    };
  }

  const allowedBasis = new Set<AiBriefingBasisType>([
    'documented_fact',
    'inference',
    'ai_suggestion',
  ]);

  const rawPoints = Array.isArray(obj.recommendedTalkingPoints)
    ? obj.recommendedTalkingPoints
    : [];
  const recommendedTalkingPoints: AiBriefingTalkingPoint[] = [];

  for (let i = 0; i < Math.min(10, rawPoints.length); i++) {
    const item = rawPoints[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = clampText(rec.title, 200);
    if (!title) continue;
    const rationale = clampText(rec.rationale, 500) || 'مقترح للمناقشة بناءً على سياق الاجتماع.';
    const rawBasis = rec.basisType as AiBriefingBasisType;
    const basisType: AiBriefingBasisType = allowedBasis.has(rawBasis)
      ? rawBasis
      : 'ai_suggestion';
    const sourceRef = clampText(rec.sourceReferenceAr, 160) || undefined;

    recommendedTalkingPoints.push({
      id: `ai-tp-${i + 1}`,
      title,
      rationale,
      basisType,
      sourceReferenceAr: sourceRef,
    });
  }

  const sanitizeStringArray = (input: unknown, maxItems: number, maxLen: number): string[] => {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    for (const item of input.slice(0, maxItems)) {
      const clean = clampText(item, maxLen);
      if (clean.length >= 2) {
        out.push(clean);
      }
    }
    return out;
  };

  const suggestedQuestions = sanitizeStringArray(obj.suggestedQuestions, 10, 300);
  const potentialRisks = sanitizeStringArray(obj.potentialRisks, 8, 300);
  const warnings = sanitizeStringArray(obj.warnings, 6, 300);

  const rawOutcomes = Array.isArray(obj.expectedOutcomes) ? obj.expectedOutcomes : [];
  const expectedOutcomes: AiBriefingSuggestedGoal[] = [];
  for (let i = 0; i < Math.min(10, rawOutcomes.length); i++) {
    const item = rawOutcomes[i];
    if (typeof item === 'string') {
      const text = clampText(item, 250);
      if (text) {
        expectedOutcomes.push({ id: `ai-goal-${i + 1}`, text });
      }
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const text = clampText(rec.text, 250);
      if (text) {
        expectedOutcomes.push({
          id: `ai-goal-${i + 1}`,
          text,
          note: clampText(rec.note, 400) || undefined,
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      executiveBriefing,
      recommendedTalkingPoints,
      suggestedQuestions,
      potentialRisks,
      expectedOutcomes,
      warnings,
      generatedAt: options?.generatedAt || new Date().toISOString(),
      modelUsed: options?.modelUsed || 'gemini-4-hydrogen',
    },
  };
}

/**
 * Approves an AI Talking Point into `meeting.agendaItems` (with duplicate prevention and final-minutes lock check).
 */
export function approveAiTalkingPointToAgenda(
  meeting: Meeting,
  talkingPoint: { title: string; rationale?: string },
  nowIso: string = new Date().toISOString()
) {
  return approveSuggestedTopicIntoAgenda(
    meeting,
    {
      title: talkingPoint.title,
      notes: talkingPoint.rationale,
    },
    nowIso
  );
}

/**
 * Approves an AI Expected Outcome into `meeting.preparation.goals` (with duplicate prevention).
 */
export function approveAiSuggestedGoalToPreparation(
  meeting: Meeting,
  suggestedGoal: { text: string; note?: string },
  nowIso: string = new Date().toISOString()
) {
  return addPreparationGoal(
    meeting,
    {
      text: suggestedGoal.text,
      note: suggestedGoal.note,
    },
    nowIso
  );
}

/**
 * Formats the deterministic MeetingPreparationBrief into clean Arabic plain text for clipboard/print.
 */
export function formatPreparationBriefPlainText(brief: MeetingPreparationBrief): string {
  const { meeting, client } = brief;
  const lines: string[] = [];

  lines.push('ملف التحضير الذكي للاجتماع — مُرافق');
  lines.push(`عنوان الاجتماع: ${meeting.title}`);
  lines.push(
    `العميل / الجهة: ${client?.name || 'غير محدد'}${client?.company ? ` — ${client.company}` : ''}`
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
  lines.push(`حالة المحضر: ${brief.minutesStatusLabelAr}`);
  lines.push(`إفصاح: ${brief.relationshipSummary.recordsDisclosureAr}`);
  lines.push('');

  if (brief.goals.length > 0) {
    lines.push('--- أهداف الاجتماع ---');
    brief.goals.forEach((g, idx) => {
      const statusLabel = MEETING_GOAL_STATUS_META[g.status]?.labelAr || g.status;
      lines.push(`${idx + 1}. [${statusLabel}] ${g.text}${g.note ? ` — ملاحظة: ${g.note}` : ''}`);
    });
    lines.push('');
  }

  if (brief.preparationNotes.trim()) {
    lines.push('--- ملاحظات التحضير ---');
    lines.push(redactTemporaryAttachmentUrls(brief.preparationNotes.trim()));
    lines.push('');
  }

  const agenda = normalizeAgendaOrder(meeting.agendaItems || []);
  if (agenda.length > 0) {
    lines.push('--- جدول الأعمال ---');
    agenda.forEach((item) => {
      lines.push(
        `${item.order}. ${item.title}${item.durationMinutes ? ` (${item.durationMinutes} د)` : ''}`
      );
      if (item.notes) lines.push(`   ${redactTemporaryAttachmentUrls(item.notes)}`);
    });
    lines.push('');
  }

  if (brief.opportunitiesContext.linkedOpportunity) {
    const opp = brief.opportunitiesContext.linkedOpportunity;
    const stageLabel = OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage;
    lines.push('--- الفرصة المرتبطة ---');
    lines.push(`الفرصة: ${opp.title} — المرحلة: ${stageLabel}`);
    if (opp.estimatedValue !== undefined && opp.currency) {
      lines.push(`القيمة التقديرية: ${formatOpportunityValue(opp.estimatedValue, opp.currency)}`);
    }
    if (opp.nextAction) {
      lines.push(
        `الإجراء القادم: ${opp.nextAction}${opp.nextActionDate ? ` (${opp.nextActionDate})` : ''}`
      );
    }
    lines.push('');
  }

  if (brief.openTasks.totalOpenCount > 0) {
    lines.push(`--- الالتزامات والمهام المفتوحة (${brief.openTasks.totalOpenCount}) ---`);
    const allOpen = [
      ...brief.openTasks.overdue.map((t) => `[متأخرة] ${t.title} (${t.dueDate || ''})`),
      ...brief.openTasks.dueToday.map((t) => `[اليوم] ${t.title}`),
      ...brief.openTasks.upcoming.map((t) => `[قادمة] ${t.title} (${t.dueDate || ''})`),
      ...brief.openTasks.noDueDate.map((t) => `[مفتوحة] ${t.title}`),
    ];
    allOpen.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
    lines.push('');
  }

  if (brief.previousMeetings.length > 0) {
    lines.push('--- آخر الاجتماعات السابقة ---');
    brief.previousMeetings.forEach((pm, idx) => {
      lines.push(`${idx + 1}. ${pm.meeting.title} (${pm.meeting.dateTime.slice(0, 10)})`);
      if (pm.summaryExcerpt) lines.push(`   الملخص: ${pm.summaryExcerpt}`);
      if (pm.decisions.length > 0) {
        lines.push(`   القرارات: ${pm.decisions.map((d) => d.text).join(' | ')}`);
      }
    });
    lines.push('');
  }

  return lines.join('\n').trim();
}
