import type {
  ActionItem,
  Client,
  ClientCommunicationSummary,
  ClientContact,
  CommunicationCenterSummary,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationFilterState,
  CommunicationInteraction,
  CommunicationOutcome,
  Meeting,
  Opportunity,
  TaskPriority,
} from '../types/index.ts';
import { DEFAULT_APP_TIMEZONE, getDateKeyInTimeZone, normalizeStrictDateOnly } from './dateOnly.ts';
import { normalizeArabicSearchText } from './client360.ts';

export const EXTERNAL_COMMUNICATION_DISCLOSURE_AR =
  'النقر على أزرار الاتصال أو البريد أو واتساب يفتح تطبيق الاتصال أو المراسلة الخارجي على جهازك فقط، ولا يقوم تطبيق «مُرافق» بإجراء مكالمات أو إرسال رسائل أو تسجيلها تلقائيًا نيابةً عنك.';

export const EXTERNAL_COMMUNICATION_DISCLOSURE_EN =
  'Clicking call, email, or WhatsApp buttons opens the external dialer or messaging app on your device only; Murafiq does not automatically place calls, send messages, or record them on your behalf.';

export interface CommunicationChannelMeta {
  key: CommunicationChannel;
  labelAr: string;
  labelEn: string;
  shortLabelAr: string;
  badgeClass: string;
}

export const COMMUNICATION_CHANNEL_META: Record<CommunicationChannel, CommunicationChannelMeta> = {
  phone_call: {
    key: 'phone_call',
    labelAr: 'مكالمة هاتفية',
    labelEn: 'Phone Call',
    shortLabelAr: 'مكالمة',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  whatsapp: {
    key: 'whatsapp',
    labelAr: 'رسالة واتساب',
    labelEn: 'WhatsApp Message',
    shortLabelAr: 'واتساب',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  email: {
    key: 'email',
    labelAr: 'بريد إلكتروني',
    labelEn: 'Email',
    shortLabelAr: 'بريد',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  in_person_visit: {
    key: 'in_person_visit',
    labelAr: 'زيارة ميدانية / حضورية',
    labelEn: 'In-Person Visit',
    shortLabelAr: 'زيارة',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  video_call: {
    key: 'video_call',
    labelAr: 'اتصال مرئي سريـع',
    labelEn: 'Video Call',
    shortLabelAr: 'مرئي',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  sms: {
    key: 'sms',
    labelAr: 'رسالة نصية (SMS)',
    labelEn: 'SMS',
    shortLabelAr: 'رسالة نصية',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
  other: {
    key: 'other',
    labelAr: 'قناة تواصل أخرى',
    labelEn: 'Other Channel',
    shortLabelAr: 'أخرى',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
  },
};

export const COMMUNICATION_CHANNELS_ORDER: CommunicationChannel[] = [
  'phone_call',
  'whatsapp',
  'email',
  'in_person_visit',
  'video_call',
  'sms',
  'other',
];

export interface CommunicationDirectionMeta {
  key: CommunicationDirection;
  labelAr: string;
  labelEn: string;
  badgeClass: string;
}

export const COMMUNICATION_DIRECTION_META: Record<CommunicationDirection, CommunicationDirectionMeta> = {
  outbound: {
    key: 'outbound',
    labelAr: 'صادر (منك للعميل)',
    labelEn: 'Outbound',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  inbound: {
    key: 'inbound',
    labelAr: 'وارد (من العميل إليك)',
    labelEn: 'Inbound',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
  },
};

export interface CommunicationOutcomeMeta {
  key: CommunicationOutcome;
  labelAr: string;
  labelEn: string;
  requiresFollowUpDefault: boolean;
  badgeClass: string;
}

export const COMMUNICATION_OUTCOME_META: Record<CommunicationOutcome, CommunicationOutcomeMeta> = {
  answered: {
    key: 'answered',
    labelAr: 'تم الرد والنقاش',
    labelEn: 'Answered & Discussed',
    requiresFollowUpDefault: false,
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  no_answer: {
    key: 'no_answer',
    labelAr: 'لم يتم الرد',
    labelEn: 'No Answer',
    requiresFollowUpDefault: true,
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  busy_or_callback: {
    key: 'busy_or_callback',
    labelAr: 'مشغول / طلب معاودة الاتصال',
    labelEn: 'Busy / Callback Requested',
    requiresFollowUpDefault: true,
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  message_sent: {
    key: 'message_sent',
    labelAr: 'تم إرسال الرسالة وبانتظار الرد',
    labelEn: 'Message Sent (Awaiting Reply)',
    requiresFollowUpDefault: true,
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  replied: {
    key: 'replied',
    labelAr: 'تم استلام رد العميل',
    labelEn: 'Client Replied',
    requiresFollowUpDefault: false,
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  agreement_reached: {
    key: 'agreement_reached',
    labelAr: 'تم الاتفاق / خطوة إيجابية',
    labelEn: 'Agreement Reached',
    requiresFollowUpDefault: false,
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  follow_up_needed: {
    key: 'follow_up_needed',
    labelAr: 'يحتاج متابعة لاحقة',
    labelEn: 'Follow-Up Needed',
    requiresFollowUpDefault: true,
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  info_shared: {
    key: 'info_shared',
    labelAr: 'تمت مشاركة عرض / معلومات',
    labelEn: 'Information / Proposal Shared',
    requiresFollowUpDefault: false,
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  other: {
    key: 'other',
    labelAr: 'نتيجة أخرى',
    labelEn: 'Other Outcome',
    requiresFollowUpDefault: false,
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
  },
};

export const COMMUNICATION_OUTCOMES_ORDER: CommunicationOutcome[] = [
  'answered',
  'no_answer',
  'busy_or_callback',
  'message_sent',
  'replied',
  'agreement_reached',
  'follow_up_needed',
  'info_shared',
  'other',
];

export const DEFAULT_COMMUNICATION_FILTER_STATE: CommunicationFilterState = {
  searchQuery: '',
  clientId: 'all',
  contactId: 'all',
  opportunityId: 'all',
  channel: 'all',
  direction: 'all',
  outcome: 'all',
  followUpFilter: 'all',
  datePreset: 'all',
  sortBy: 'occurred_desc',
};

export function isValidCommunicationChannel(value: unknown): value is CommunicationChannel {
  return (
    typeof value === 'string' &&
    (COMMUNICATION_CHANNELS_ORDER as string[]).includes(value)
  );
}

export function isValidCommunicationDirection(value: unknown): value is CommunicationDirection {
  return value === 'outbound' || value === 'inbound';
}

export function isValidCommunicationOutcome(value: unknown): value is CommunicationOutcome {
  return (
    typeof value === 'string' &&
    (COMMUNICATION_OUTCOMES_ORDER as string[]).includes(value)
  );
}

/**
 * Checks whether a contactId belongs to the specified client.
 */
export function canLinkInteractionToContact(
  client: Client | undefined,
  contactId: string | undefined
): boolean {
  if (!contactId || !contactId.trim()) return true;
  if (!client || !Array.isArray(client.contacts)) return false;
  return client.contacts.some((c) => c.id === contactId.trim());
}

/**
 * Checks whether an opportunityId belongs to the specified clientId.
 */
export function canLinkInteractionToOpportunity(
  opportunities: Opportunity[],
  clientId: string,
  opportunityId: string | undefined
): boolean {
  if (!opportunityId || !opportunityId.trim()) return true;
  if (!clientId) return false;
  const opp = opportunities.find((o) => o.id === opportunityId.trim());
  if (!opp) return false;
  return opp.clientId === clientId;
}

/**
 * Resolves the contact object from a client given contactId.
 */
export function resolveInteractionContact(
  client: Client | undefined,
  contactId: string | undefined
): ClientContact | undefined {
  if (!client || !contactId || !Array.isArray(client.contacts)) return undefined;
  return client.contacts.find((c) => c.id === contactId);
}

/**
 * Builds a safe WhatsApp external link (wa.me) from a phone number string if digits exist.
 */
export function buildWhatsAppExternalUrl(phone?: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  const normalized = digits.startsWith('00') ? digits.slice(2) : digits;
  return `https://wa.me/${normalized}`;
}

/**
 * Sanitizes and validates a CommunicationInteraction before saving to Firestore or state.
 * Enforces same-client contactId and opportunityId rules, trims strings, bounds arrays,
 * and normalizes nextFollowUpDate to strict YYYY-MM-DD.
 */
export function sanitizeInteractionForSave(
  interaction: CommunicationInteraction,
  clients?: Client[],
  opportunities?: Opportunity[],
  nowIso: string = new Date().toISOString()
): CommunicationInteraction {
  const clientId = (interaction.clientId || '').trim();
  if (!clientId) {
    throw new Error('يجب اختيار العميل المرتبط بالتواصل.');
  }

  const subject = (interaction.subject || '').trim().slice(0, 200);
  if (!subject) {
    throw new Error('يرجى إدخال موضوع أو عنوان مختصر للتواصل.');
  }

  const channel: CommunicationChannel = isValidCommunicationChannel(interaction.channel)
    ? interaction.channel
    : 'phone_call';
  const direction: CommunicationDirection = isValidCommunicationDirection(interaction.direction)
    ? interaction.direction
    : 'outbound';
  const outcome: CommunicationOutcome = isValidCommunicationOutcome(interaction.outcome)
    ? interaction.outcome
    : 'answered';

  let occurredAt = (interaction.occurredAt || '').trim();
  if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
    occurredAt = nowIso;
  }

  const clientObj = clients?.find((c) => c.id === clientId);
  let contactId = interaction.contactId?.trim() || undefined;
  if (contactId && clients && clients.length > 0) {
    if (!canLinkInteractionToContact(clientObj, contactId)) {
      contactId = undefined;
    }
  }

  let opportunityId = interaction.opportunityId?.trim() || undefined;
  if (opportunityId && opportunities && opportunities.length > 0) {
    if (!canLinkInteractionToOpportunity(opportunities, clientId, opportunityId)) {
      opportunityId = undefined;
    }
  }

  const meetingId = interaction.meetingId?.trim() || undefined;
  const linkedTaskId = interaction.linkedTaskId?.trim() || undefined;

  let durationMinutes: number | undefined = undefined;
  if (
    typeof interaction.durationMinutes === 'number' &&
    Number.isFinite(interaction.durationMinutes) &&
    interaction.durationMinutes >= 0
  ) {
    durationMinutes = Math.min(1440, Math.round(interaction.durationMinutes));
  }

  const summary = interaction.summary?.trim()
    ? interaction.summary.trim().slice(0, 5000)
    : undefined;

  const topics = Array.isArray(interaction.topics)
    ? Array.from(
        new Set(
          interaction.topics
            .map((t) => (typeof t === 'string' ? t.trim().slice(0, 60) : ''))
            .filter(Boolean)
        )
      ).slice(0, 20)
    : undefined;

  const nextStep = interaction.nextStep?.trim()
    ? interaction.nextStep.trim().slice(0, 500)
    : undefined;

  const normalizedFollowUpDate = normalizeStrictDateOnly(interaction.nextFollowUpDate);
  const nextFollowUpDate = normalizedFollowUpDate || undefined;

  const createdAt =
    interaction.createdAt && !Number.isNaN(new Date(interaction.createdAt).getTime())
      ? interaction.createdAt
      : nowIso;

  const sanitized: CommunicationInteraction = {
    id: (interaction.id || '').trim() || `comm-${Date.now()}`,
    clientId,
    channel,
    direction,
    occurredAt,
    subject,
    outcome,
    createdAt,
    updatedAt: nowIso,
  };

  if (interaction.userId) sanitized.userId = interaction.userId;
  if (contactId) sanitized.contactId = contactId;
  if (opportunityId) sanitized.opportunityId = opportunityId;
  if (meetingId) sanitized.meetingId = meetingId;
  if (durationMinutes !== undefined) sanitized.durationMinutes = durationMinutes;
  if (summary) sanitized.summary = summary;
  if (topics && topics.length > 0) sanitized.topics = topics;
  if (nextStep) sanitized.nextStep = nextStep;
  if (nextFollowUpDate) sanitized.nextFollowUpDate = nextFollowUpDate;
  if (linkedTaskId) sanitized.linkedTaskId = linkedTaskId;

  return sanitized;
}

/**
 * Checks if an interaction already has a linked task in the tasks list.
 */
export function findLinkedTaskForInteraction(
  interaction: CommunicationInteraction,
  tasks: ActionItem[]
): ActionItem | undefined {
  if (!interaction) return undefined;
  return tasks.find(
    (task) =>
      task.interactionId === interaction.id ||
      (interaction.linkedTaskId && task.id === interaction.linkedTaskId)
  );
}

/**
 * Checks whether an interaction has an active (uncompleted) follow-up requirement.
 * If a linked task exists and is completed, or if there is no nextStep/nextFollowUpDate,
 * it is considered fulfilled.
 */
export function isInteractionFollowUpPending(
  interaction: CommunicationInteraction,
  tasks: ActionItem[] = []
): boolean {
  const hasFollowUpSignal =
    Boolean(interaction.nextFollowUpDate) ||
    Boolean(interaction.nextStep && interaction.nextStep.trim()) ||
    interaction.outcome === 'follow_up_needed' ||
    interaction.outcome === 'no_answer' ||
    interaction.outcome === 'busy_or_callback';

  if (!hasFollowUpSignal) return false;

  const linkedTask = findLinkedTaskForInteraction(interaction, tasks);
  if (linkedTask && (linkedTask.status === 'completed' || linkedTask.status === 'cancelled')) {
    return false;
  }

  return true;
}

/**
 * Converts an interaction's nextStep / follow-up into a structured ActionItem (Task)
 * without duplicating if a task is already linked to this interaction.
 */
export function convertInteractionNextStepToTaskDraft(
  interaction: CommunicationInteraction,
  existingTasks: ActionItem[] = [],
  options: {
    priority?: TaskPriority;
    nowIso?: string;
    taskId?: string;
    contactName?: string;
  } = {}
): {
  task: ActionItem;
  updatedInteraction: CommunicationInteraction;
  alreadyExisted: boolean;
} {
  const existing = findLinkedTaskForInteraction(interaction, existingTasks);
  if (existing) {
    const updatedInteraction: CommunicationInteraction =
      interaction.linkedTaskId === existing.id
        ? interaction
        : {
            ...interaction,
            linkedTaskId: existing.id,
          };
    return {
      task: existing,
      updatedInteraction,
      alreadyExisted: true,
    };
  }

  const nowIso = options.nowIso || new Date().toISOString();
  const taskId = options.taskId || `task-comm-${interaction.id}-${Date.now()}`;
  const channelLabel = COMMUNICATION_CHANNEL_META[interaction.channel]?.shortLabelAr || 'تواصل';
  const rawNextStep = interaction.nextStep?.trim();
  const title = rawNextStep
    ? rawNextStep.slice(0, 160)
    : `متابعة ${channelLabel}: ${interaction.subject}`.slice(0, 160);

  const descriptionParts: string[] = [];
  descriptionParts.push(
    `مهمة متابعة منبثقة من ${COMMUNICATION_CHANNEL_META[interaction.channel]?.labelAr || 'تواصل'} بتاريخ ${interaction.occurredAt.slice(0, 10)}.`
  );
  if (options.contactName) {
    descriptionParts.push(`جهة الاتصال: ${options.contactName}`);
  }
  if (interaction.summary) {
    descriptionParts.push(`ملخص التواصل: ${interaction.summary.slice(0, 400)}`);
  }

  const dueDate = normalizeStrictDateOnly(interaction.nextFollowUpDate) || undefined;

  const task: ActionItem = {
    id: taskId,
    clientId: interaction.clientId,
    interactionId: interaction.id,
    title,
    description: descriptionParts.join('\n'),
    priority: options.priority || 'high',
    status: 'pending',
    provenance: 'approved',
    createdAt: nowIso,
  };

  if (interaction.userId) task.userId = interaction.userId;
  if (interaction.opportunityId) task.opportunityId = interaction.opportunityId;
  if (interaction.meetingId) task.meetingId = interaction.meetingId;
  if (dueDate) task.dueDate = dueDate;

  const updatedInteraction: CommunicationInteraction = {
    ...interaction,
    linkedTaskId: task.id,
    updatedAt: nowIso,
  };

  return {
    task,
    updatedInteraction,
    alreadyExisted: false,
  };
}

/**
 * Unlinks interactionId from tasks when an interaction is deleted, preserving the tasks themselves.
 */
export function unlinkInteractionReferencesOnDelete(
  deletedInteractionId: string,
  tasks: ActionItem[]
): ActionItem[] {
  const modified: ActionItem[] = [];
  for (const task of tasks) {
    if (task.interactionId === deletedInteractionId) {
      const next = { ...task };
      delete next.interactionId;
      modified.push(next);
    }
  }
  return modified;
}

/**
 * Returns all interactions for a specific contact of a client, sorted newest first.
 */
export function getContactInteractionHistory(
  clientId: string,
  contactId: string,
  interactions: CommunicationInteraction[]
): CommunicationInteraction[] {
  return interactions
    .filter((item) => item.clientId === clientId && item.contactId === contactId)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/**
 * Computes comprehensive communication summary for a single client, combining
 * past/held meetings and logged interactions to determine true lastContactAt and staleness.
 */
export function computeClientCommunicationSummary(
  client: Client,
  interactions: CommunicationInteraction[],
  meetings: Meeting[] = [],
  tasks: ActionItem[] = [],
  now: Date = new Date(),
  staleThresholdDays: number = 14,
  timeZone: string = DEFAULT_APP_TIMEZONE
): ClientCommunicationSummary {
  const nowMs = now.getTime();
  const todayKey = getDateKeyInTimeZone(now, timeZone);

  const clientInteractions = interactions
    .filter((item) => item.clientId === client.id)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const byChannel: Record<CommunicationChannel, number> = {
    phone_call: 0,
    whatsapp: 0,
    email: 0,
    in_person_visit: 0,
    video_call: 0,
    sms: 0,
    other: 0,
  };

  const byContactId: Record<string, { count: number; lastOccurredAt: string }> = {};
  const recentTopicsSet = new Set<string>();
  let pendingFollowUpsCount = 0;
  let overdueFollowUpsCount = 0;
  let earliestFollowUpDate: string | null = null;

  for (const item of clientInteractions) {
    if (byChannel[item.channel] !== undefined) {
      byChannel[item.channel] += 1;
    } else {
      byChannel.other += 1;
    }

    if (item.contactId) {
      const existingContactStat = byContactId[item.contactId];
      if (!existingContactStat) {
        byContactId[item.contactId] = {
          count: 1,
          lastOccurredAt: item.occurredAt,
        };
      } else {
        existingContactStat.count += 1;
        if (new Date(item.occurredAt).getTime() > new Date(existingContactStat.lastOccurredAt).getTime()) {
          existingContactStat.lastOccurredAt = item.occurredAt;
        }
      }
    }

    if (Array.isArray(item.topics)) {
      for (const topic of item.topics) {
        if (topic && recentTopicsSet.size < 12) {
          recentTopicsSet.add(topic);
        }
      }
    }

    if (isInteractionFollowUpPending(item, tasks)) {
      pendingFollowUpsCount += 1;
      if (item.nextFollowUpDate) {
        if (item.nextFollowUpDate < todayKey) {
          overdueFollowUpsCount += 1;
        }
        if (!earliestFollowUpDate || item.nextFollowUpDate < earliestFollowUpDate) {
          earliestFollowUpDate = item.nextFollowUpDate;
        }
      }
    }
  }

  const latestInteraction = clientInteractions[0] || null;
  const lastInteractionAt = latestInteraction ? latestInteraction.occurredAt : null;

  // Consider past/completed non-cancelled meetings as well for true lastContactAt
  const clientHeldMeetings = meetings.filter((m) => {
    if (m.clientId !== client.id || m.status === 'cancelled') return false;
    const ms = new Date(m.dateTime).getTime();
    if (Number.isNaN(ms)) return false;
    return m.status === 'completed' || ms <= nowMs;
  });

  let latestMeetingIso: string | null = null;
  for (const m of clientHeldMeetings) {
    if (!latestMeetingIso || new Date(m.dateTime).getTime() > new Date(latestMeetingIso).getTime()) {
      latestMeetingIso = m.dateTime;
    }
  }

  // Only interactions that have already occurred count toward lastContactAt
  const pastInteractions = clientInteractions.filter((item) => {
    const ms = new Date(item.occurredAt).getTime();
    return !Number.isNaN(ms) && ms <= nowMs;
  });
  const latestPastInteractionIso = pastInteractions[0]?.occurredAt || null;

  let lastContactAt: string | null = null;
  if (latestPastInteractionIso && latestMeetingIso) {
    lastContactAt =
      new Date(latestPastInteractionIso).getTime() >= new Date(latestMeetingIso).getTime()
        ? latestPastInteractionIso
        : latestMeetingIso;
  } else {
    lastContactAt = latestPastInteractionIso || latestMeetingIso;
  }

  let daysSinceLastContact: number | null = null;
  if (lastContactAt) {
    const diffMs = Math.max(0, nowMs - new Date(lastContactAt).getTime());
    daysSinceLastContact = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Future scheduled meeting check
  const hasUpcomingMeeting = meetings.some((m) => {
    if (m.clientId !== client.id || m.status === 'cancelled') return false;
    const ms = new Date(m.dateTime).getTime();
    return !Number.isNaN(ms) && ms > nowMs;
  });

  const isInactive = client.relationshipStatus === 'inactive';
  let isStaleContact = false;
  if (!isInactive && !hasUpcomingMeeting) {
    if (daysSinceLastContact !== null) {
      isStaleContact = daysSinceLastContact >= staleThresholdDays;
    } else {
      const createdMs = new Date(client.createdAt).getTime();
      if (!Number.isNaN(createdMs)) {
        const daysSinceCreated = Math.floor(Math.max(0, nowMs - createdMs) / (1000 * 60 * 60 * 24));
        isStaleContact = daysSinceCreated >= staleThresholdDays;
      }
    }
  }

  return {
    clientId: client.id,
    totalInteractions: clientInteractions.length,
    lastInteractionAt,
    lastInteractionChannel: latestInteraction ? latestInteraction.channel : null,
    lastInteractionOutcome: latestInteraction ? latestInteraction.outcome : null,
    lastContactAt,
    daysSinceLastContact,
    isStaleContact,
    pendingFollowUpsCount,
    overdueFollowUpsCount,
    nextFollowUpDate: earliestFollowUpDate,
    byChannel,
    byContactId,
    recentTopics: Array.from(recentTopicsSet),
  };
}

/**
 * Filters and sorts interactions for the Communication Center, Client 360, or Opportunity views.
 */
export function filterAndSortInteractions(
  interactions: CommunicationInteraction[],
  filters: Partial<CommunicationFilterState> = {},
  context: {
    clients?: Client[];
    opportunities?: Opportunity[];
    tasks?: ActionItem[];
    now?: Date;
    timeZone?: string;
  } = {}
): CommunicationInteraction[] {
  const merged: CommunicationFilterState = {
    ...DEFAULT_COMMUNICATION_FILTER_STATE,
    ...filters,
  };

  const now = context.now || new Date();
  const timeZone = context.timeZone || DEFAULT_APP_TIMEZONE;
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const clientsById = new Map<string, Client>((context.clients || []).map((c) => [c.id, c]));
  const oppsById = new Map<string, Opportunity>((context.opportunities || []).map((o) => [o.id, o]));
  const tasks = context.tasks || [];

  const normalizedQuery = normalizeArabicSearchText(merged.searchQuery || '');

  // Pre-compute date threshold keys if datePreset is active
  let minDateKey: string | null = null;
  let maxDateKey: string | null = null;

  if (merged.datePreset === 'today') {
    minDateKey = todayKey;
    maxDateKey = todayKey;
  } else if (merged.datePreset === '7d') {
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    minDateKey = getDateKeyInTimeZone(d, timeZone);
  } else if (merged.datePreset === '30d') {
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    minDateKey = getDateKeyInTimeZone(d, timeZone);
  } else if (merged.datePreset === '90d') {
    const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    minDateKey = getDateKeyInTimeZone(d, timeZone);
  } else if (merged.datePreset === 'custom') {
    minDateKey = normalizeStrictDateOnly(merged.dateFrom);
    maxDateKey = normalizeStrictDateOnly(merged.dateTo);
  }

  const filtered = interactions.filter((item) => {
    if (merged.clientId !== 'all' && item.clientId !== merged.clientId) return false;
    if (merged.contactId !== 'all' && item.contactId !== merged.contactId) return false;
    if (merged.opportunityId !== 'all' && item.opportunityId !== merged.opportunityId) return false;
    if (merged.channel !== 'all' && item.channel !== merged.channel) return false;
    if (merged.direction !== 'all' && item.direction !== merged.direction) return false;
    if (merged.outcome !== 'all' && item.outcome !== merged.outcome) return false;

    if (merged.followUpFilter === 'needs_follow_up') {
      if (!isInteractionFollowUpPending(item, tasks)) return false;
    } else if (merged.followUpFilter === 'overdue_follow_up') {
      if (!isInteractionFollowUpPending(item, tasks)) return false;
      if (!item.nextFollowUpDate || item.nextFollowUpDate >= todayKey) return false;
    } else if (merged.followUpFilter === 'has_linked_task') {
      if (!findLinkedTaskForInteraction(item, tasks)) return false;
    }

    if (minDateKey || maxDateKey) {
      const itemDateKey = getDateKeyInTimeZone(item.occurredAt, timeZone);
      if (!itemDateKey) return false;
      if (minDateKey && itemDateKey < minDateKey) return false;
      if (maxDateKey && itemDateKey > maxDateKey) return false;
    }

    if (normalizedQuery) {
      const client = clientsById.get(item.clientId);
      const contact = resolveInteractionContact(client, item.contactId);
      const opp = item.opportunityId ? oppsById.get(item.opportunityId) : undefined;
      const channelMeta = COMMUNICATION_CHANNEL_META[item.channel];
      const outcomeMeta = COMMUNICATION_OUTCOME_META[item.outcome];

      const haystack = normalizeArabicSearchText(
        [
          item.subject,
          item.summary || '',
          (item.topics || []).join(' '),
          item.nextStep || '',
          client?.name || '',
          client?.company || '',
          contact?.name || '',
          contact?.title || '',
          opp?.title || '',
          channelMeta?.labelAr || '',
          outcomeMeta?.labelAr || '',
        ].join(' ')
      );

      if (!haystack.includes(normalizedQuery)) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    if (merged.sortBy === 'occurred_asc') {
      return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    }
    if (merged.sortBy === 'follow_up_asc') {
      const aDate = a.nextFollowUpDate || '9999-12-31';
      const bDate = b.nextFollowUpDate || '9999-12-31';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
    }
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
}

/**
 * Computes global KPIs for the Communication Center & Dashboard.
 */
export function computeCommunicationCenterSummary(
  interactions: CommunicationInteraction[],
  clients: Client[],
  meetings: Meeting[] = [],
  tasks: ActionItem[] = [],
  now: Date = new Date(),
  staleThresholdDays: number = 14,
  timeZone: string = DEFAULT_APP_TIMEZONE
): CommunicationCenterSummary {
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const key7dAgo = getDateKeyInTimeZone(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), timeZone);
  const key30dAgo = getDateKeyInTimeZone(
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    timeZone
  );

  const byChannel: Record<CommunicationChannel, number> = {
    phone_call: 0,
    whatsapp: 0,
    email: 0,
    in_person_visit: 0,
    video_call: 0,
    sms: 0,
    other: 0,
  };

  const byOutcome: Record<CommunicationOutcome, number> = {
    answered: 0,
    no_answer: 0,
    busy_or_callback: 0,
    message_sent: 0,
    replied: 0,
    agreement_reached: 0,
    follow_up_needed: 0,
    info_shared: 0,
    other: 0,
  };

  let interactionsToday = 0;
  let interactionsLast7Days = 0;
  let interactionsLast30Days = 0;
  let outboundCount = 0;
  let inboundCount = 0;
  let followUpsDueTodayCount = 0;
  let followUpsOverdueCount = 0;
  let followUpsPendingTotalCount = 0;
  const contactedClientsLast30d = new Set<string>();

  for (const item of interactions) {
    if (byChannel[item.channel] !== undefined) {
      byChannel[item.channel] += 1;
    } else {
      byChannel.other += 1;
    }

    if (byOutcome[item.outcome] !== undefined) {
      byOutcome[item.outcome] += 1;
    } else {
      byOutcome.other += 1;
    }

    if (item.direction === 'inbound') {
      inboundCount += 1;
    } else {
      outboundCount += 1;
    }

    const occurredKey = getDateKeyInTimeZone(item.occurredAt, timeZone);
    if (occurredKey === todayKey) {
      interactionsToday += 1;
    }
    if (occurredKey && occurredKey >= key7dAgo && occurredKey <= todayKey) {
      interactionsLast7Days += 1;
    }
    if (occurredKey && occurredKey >= key30dAgo && occurredKey <= todayKey) {
      interactionsLast30Days += 1;
      contactedClientsLast30d.add(item.clientId);
    }

    if (isInteractionFollowUpPending(item, tasks)) {
      followUpsPendingTotalCount += 1;
      if (item.nextFollowUpDate) {
        if (item.nextFollowUpDate < todayKey) {
          followUpsOverdueCount += 1;
        } else if (item.nextFollowUpDate === todayKey) {
          followUpsDueTodayCount += 1;
        }
      }
    }
  }

  let staleClientsCount = 0;
  for (const client of clients) {
    const summary = computeClientCommunicationSummary(
      client,
      interactions,
      meetings,
      tasks,
      now,
      staleThresholdDays,
      timeZone
    );
    if (summary.isStaleContact) {
      staleClientsCount += 1;
    }
  }

  return {
    totalInteractions: interactions.length,
    interactionsToday,
    interactionsLast7Days,
    interactionsLast30Days,
    outboundCount,
    inboundCount,
    followUpsDueTodayCount,
    followUpsOverdueCount,
    followUpsPendingTotalCount,
    staleClientsCount,
    activeClientsContactedLast30Days: contactedClientsLast30d.size,
    byChannel,
    byOutcome,
  };
}
