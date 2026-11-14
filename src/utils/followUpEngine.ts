import {
  ActionItem,
  Client,
  DailyCommandSummary,
  DailyTaskBucketKey,
  FollowUpPreferences,
  Meeting,
  MeetingLeadMinutesOption,
  ProvenanceType,
  ReminderItem,
  ReminderReason,
  ReminderSourceType,
  ReminderStateRecord,
  SnoozePreset,
  UpcomingTaskWindowDaysOption,
} from '../types';
import {
  STALE_CONTACT_THRESHOLD_DAYS,
  evaluateClientAttentionAlerts,
} from './client360';

export const FOLLOW_UP_PREFERENCES_DOC_ID = 'follow_up';

export const DEFAULT_FOLLOW_UP_PREFERENCES: FollowUpPreferences = {
  id: FOLLOW_UP_PREFERENCES_DOC_ID,
  remindersEnabled: true,
  showOverdueTasks: true,
  showUpcomingMeetings: true,
  meetingLeadMinutes: 60,
  upcomingTaskWindowDays: 3,
  showStaleClients: true,
  staleClientDays: STALE_CONTACT_THRESHOLD_DAYS,
  updatedAt: '',
};

const VALID_MEETING_LEAD_OPTIONS: MeetingLeadMinutesOption[] = [15, 30, 60, 120, 1440];
const VALID_TASK_WINDOW_OPTIONS: UpcomingTaskWindowDaysOption[] = [0, 2, 3, 7];

export const TASK_PRIORITY_RANK: Record<ActionItem['priority'], number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface CalendarDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function normalizeFollowUpPreferences(
  raw?: Partial<FollowUpPreferences> | null
): FollowUpPreferences {
  const leadRaw = raw?.meetingLeadMinutes;
  const meetingLeadMinutes = VALID_MEETING_LEAD_OPTIONS.includes(
    leadRaw as MeetingLeadMinutesOption
  )
    ? (leadRaw as MeetingLeadMinutesOption)
    : DEFAULT_FOLLOW_UP_PREFERENCES.meetingLeadMinutes;

  const windowRaw = raw?.upcomingTaskWindowDays;
  const upcomingTaskWindowDays = VALID_TASK_WINDOW_OPTIONS.includes(
    windowRaw as UpcomingTaskWindowDaysOption
  )
    ? (windowRaw as UpcomingTaskWindowDaysOption)
    : DEFAULT_FOLLOW_UP_PREFERENCES.upcomingTaskWindowDays;

  const staleDaysRaw =
    typeof raw?.staleClientDays === 'number' && Number.isFinite(raw.staleClientDays)
      ? Math.min(365, Math.max(7, Math.round(raw.staleClientDays)))
      : DEFAULT_FOLLOW_UP_PREFERENCES.staleClientDays!;

  return {
    id: raw?.id?.trim() || FOLLOW_UP_PREFERENCES_DOC_ID,
    userId: raw?.userId,
    remindersEnabled:
      typeof raw?.remindersEnabled === 'boolean'
        ? raw.remindersEnabled
        : DEFAULT_FOLLOW_UP_PREFERENCES.remindersEnabled,
    showOverdueTasks:
      typeof raw?.showOverdueTasks === 'boolean'
        ? raw.showOverdueTasks
        : DEFAULT_FOLLOW_UP_PREFERENCES.showOverdueTasks,
    showUpcomingMeetings:
      typeof raw?.showUpcomingMeetings === 'boolean'
        ? raw.showUpcomingMeetings
        : DEFAULT_FOLLOW_UP_PREFERENCES.showUpcomingMeetings,
    meetingLeadMinutes,
    upcomingTaskWindowDays,
    showStaleClients:
      typeof raw?.showStaleClients === 'boolean'
        ? raw.showStaleClients
        : DEFAULT_FOLLOW_UP_PREFERENCES.showStaleClients,
    staleClientDays: staleDaysRaw,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

/**
 * Strictly parses a YYYY-MM-DD calendar date without UTC midnight shift.
 */
export function parseDateOnlyString(raw?: string | null): CalendarDateParts | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * Extracts calendar date coordinates (year/month/day) for a Date in either the given IANA timezone
 * or the runtime's local timezone.
 */
export function extractZonedCalendarParts(
  date: Date,
  timeZone?: string
): CalendarDateParts {
  if (timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(date);
      const year = Number(parts.find((p) => p.type === 'year')?.value);
      const month = Number(parts.find((p) => p.type === 'month')?.value);
      const day = Number(parts.find((p) => p.type === 'day')?.value);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        return { year, month, day };
      }
    } catch {
      // Fallback to local calendar if timeZone is invalid
    }
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function extractZonedHour(date: Date, timeZone?: string): number {
  if (timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const hourVal = Number(parts.find((p) => p.type === 'hour')?.value);
      if (Number.isFinite(hourVal)) {
        return hourVal % 24;
      }
    } catch {
      // Fallback
    }
  }
  return date.getHours();
}

/**
 * Resolves either a Date, a date-only YYYY-MM-DD string (timezone-invariant),
 * or an ISO/datetime string into calendar coordinates for the target timezone.
 */
export function resolveCalendarParts(
  input?: string | Date | null,
  timeZone?: string
): CalendarDateParts | null {
  if (!input) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return extractZonedCalendarParts(input, timeZone);
  }

  const trimmed = input.trim();
  if (!trimmed) return null;

  const dateOnly = parseDateOnlyString(trimmed);
  if (dateOnly) {
    return dateOnly;
  }

  // Naive local datetime (no explicit Z or +/-HH:MM offset): keep its literal calendar day when timeZone is specified
  const naiveMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/);
  if (naiveMatch) {
    return parseDateOnlyString(naiveMatch[1]);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return extractZonedCalendarParts(parsed, timeZone);
}

export function formatCalendarDateKey(parts: CalendarDateParts): string {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(parts: CalendarDateParts, days: number): CalendarDateParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function addCalendarDaysToKey(dateKey: string, days: number): string {
  const parsed = parseDateOnlyString(dateKey);
  if (!parsed) return dateKey;
  return formatCalendarDateKey(addCalendarDays(parsed, days));
}

export function calendarDaysDiff(
  target: CalendarDateParts,
  reference: CalendarDateParts
): number {
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
  const refUtc = Date.UTC(reference.year, reference.month - 1, reference.day);
  return Math.round((targetUtc - refUtc) / 86400000);
}

/**
 * Computes the UTC Date corresponding to a wall-clock YYYY-MM-DD HH:MM in an optional IANA timeZone.
 */
export function buildZonedDate(
  parts: CalendarDateParts,
  hour: number,
  minute: number,
  timeZone?: string
): Date {
  if (!timeZone) {
    return new Date(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  }

  const desiredUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  // First guess at UTC, then adjust by observed offset in target timezone
  let candidate = new Date(desiredUtcMs);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const p = formatter.formatToParts(candidate);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    const obsHour = get('hour') % 24;
    const obsMs = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      obsHour,
      get('minute'),
      get('second'),
      0
    );
    const offsetMs = obsMs - desiredUtcMs;
    candidate = new Date(desiredUtcMs - offsetMs);
    return candidate;
  } catch {
    return new Date(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  }
}

export function getDefaultTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function getTodayCalendarKey(
  referenceDate: Date = new Date(),
  timeZone?: string
): string {
  return formatCalendarDateKey(extractZonedCalendarParts(referenceDate, timeZone));
}

export function getDailyGreetingArabic(
  referenceDate: Date = new Date(),
  timeZone?: string,
  language: 'ar' | 'en' = 'ar'
): string {
  const hour = extractZonedHour(referenceDate, timeZone);
  if (language === 'en') {
    if (hour < 12) return 'Good morning, here is your daily follow-up plan';
    if (hour < 17) return 'Good afternoon, here is your daily follow-up plan';
    return 'Good evening, here is your daily follow-up plan';
  }
  if (hour < 12) return 'صباح الخير — يومي ومركز المتابعة';
  if (hour < 17) return 'طاب يومك — يومي ومركز المتابعة';
  return 'مساء الخير — يومي ومركز المتابعة';
}

// =========================================================================
// Daily Work Queue: 6 Standard Buckets
// =========================================================================

export interface CategorizedDailyTasks {
  overdue: ActionItem[];
  today: ActionItem[];
  tomorrow: ActionItem[];
  thisWeek: ActionItem[];
  later: ActionItem[];
  noDueDate: ActionItem[];
  byBucket: Record<DailyTaskBucketKey, ActionItem[]>;
}

function compareOpenTasks(a: ActionItem, b: ActionItem): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }
  const prioDiff = TASK_PRIORITY_RANK[b.priority] - TASK_PRIORITY_RANK[a.priority];
  if (prioDiff !== 0) return prioDiff;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

export function categorizeDailyWorkTasks(
  tasks: ActionItem[],
  referenceDate: Date = new Date(),
  timeZone?: string
): CategorizedDailyTasks {
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  const overdue: ActionItem[] = [];
  const today: ActionItem[] = [];
  const tomorrow: ActionItem[] = [];
  const thisWeek: ActionItem[] = [];
  const later: ActionItem[] = [];
  const noDueDate: ActionItem[] = [];

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      continue;
    }

    const dueParts = resolveCalendarParts(task.dueDate, timeZone);
    if (!dueParts) {
      noDueDate.push(task);
      continue;
    }

    const diff = calendarDaysDiff(dueParts, refParts);
    if (diff < 0) {
      overdue.push(task);
    } else if (diff === 0) {
      today.push(task);
    } else if (diff === 1) {
      tomorrow.push(task);
    } else if (diff <= 7) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  overdue.sort(compareOpenTasks);
  today.sort(compareOpenTasks);
  tomorrow.sort(compareOpenTasks);
  thisWeek.sort(compareOpenTasks);
  later.sort(compareOpenTasks);
  noDueDate.sort(compareOpenTasks);

  return {
    overdue,
    today,
    tomorrow,
    thisWeek,
    later,
    noDueDate,
    byBucket: {
      overdue,
      today,
      tomorrow,
      this_week: thisWeek,
      later,
      no_due_date: noDueDate,
    },
  };
}

// =========================================================================
// Chronological Upcoming Meetings for Daily Command Center
// =========================================================================

export interface DailyUpcomingMeetingItem {
  meeting: Meeting;
  clientName: string;
  startMs: number;
  minutesUntilStart: number;
  isToday: boolean;
  isImminent: boolean;
}

export function parseMeetingDateTimeMs(
  dateTime?: string,
  timeZone?: string
): number | null {
  if (!dateTime || typeof dateTime !== 'string') return null;
  const trimmed = dateTime.trim();
  if (!trimmed) return null;

  // Naive YYYY-MM-DDTHH:mm(:ss)? in explicit timeZone
  const naiveMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (naiveMatch && timeZone) {
    const parts: CalendarDateParts = {
      year: Number(naiveMatch[1]),
      month: Number(naiveMatch[2]),
      day: Number(naiveMatch[3]),
    };
    return buildZonedDate(
      parts,
      Number(naiveMatch[4]),
      Number(naiveMatch[5]),
      timeZone
    ).getTime();
  }

  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function getUpcomingMeetingsForDailyCenter(params: {
  meetings: Meeting[];
  clients: Client[];
  referenceDate?: Date;
  timeZone?: string;
  leadMinutes?: number;
}): DailyUpcomingMeetingItem[] {
  const {
    meetings,
    clients,
    referenceDate = new Date(),
    timeZone,
    leadMinutes = DEFAULT_FOLLOW_UP_PREFERENCES.meetingLeadMinutes,
  } = params;

  const refMs = referenceDate.getTime();
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);
  const clientNameById = new Map<string, string>(clients.map((c) => [c.id, c.name]));

  const items: DailyUpcomingMeetingItem[] = [];

  for (const meeting of meetings) {
    if (meeting.status === 'completed' || meeting.status === 'cancelled') {
      continue;
    }

    const startMs = parseMeetingDateTimeMs(meeting.dateTime, timeZone);
    if (startMs === null) continue;

    // Exclude meetings that ended well in the past (> 60 min ago)
    const graceWindowMs = Math.max(60, meeting.duration || 60) * 60000;
    if (startMs < refMs - graceWindowMs) {
      continue;
    }

    const minutesUntilStart = Math.round((startMs - refMs) / 60000);
    const meetingParts = extractZonedCalendarParts(new Date(startMs), timeZone);
    const isToday = calendarDaysDiff(meetingParts, refParts) === 0;
    const isImminent = minutesUntilStart >= -15 && minutesUntilStart <= leadMinutes;

    items.push({
      meeting,
      clientName: clientNameById.get(meeting.clientId) || 'عميل غير محدد',
      startMs,
      minutesUntilStart,
      isToday,
      isImminent,
    });
  }

  return items.sort((a, b) => a.startMs - b.startMs);
}

// =========================================================================
// Client Follow-Up Alerts & Disclosures
// =========================================================================

export interface DailyClientFollowUpEntry {
  client: Client;
  reasonsArabic: string[];
  severity: 'high' | 'medium' | 'info';
  overdueTasksCount: number;
  highPriorityTasksCount: number;
  hasImminentMeeting: boolean;
  hasScheduledFollowUp: boolean;
  staleContactDays: number | null;
  basisDisclosureArabic: string;
}

export const CLIENT_FOLLOW_UP_DISCLOSURE_AR =
  'يعتمد هذا المؤشر فقط على السجلات المدخلة داخل التطبيق (الاجتماعات والمهام والملاحظات)، ولا يُثبت عدم وجود تواصل هاتفي أو خارجي لم يُسجّل.';

export function buildDailyClientFollowUps(params: {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  preferences: FollowUpPreferences;
  referenceDate?: Date;
  timeZone?: string;
}): DailyClientFollowUpEntry[] {
  const {
    clients,
    meetings,
    tasks,
    preferences,
    referenceDate = new Date(),
    timeZone,
  } = params;

  const refMs = referenceDate.getTime();
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);
  const staleDays = preferences.staleClientDays || STALE_CONTACT_THRESHOLD_DAYS;

  const entries: DailyClientFollowUpEntry[] = [];

  for (const client of clients) {
    const clientMeetings = meetings.filter((m) => m.clientId === client.id);
    const clientTasks = tasks.filter((t) => t.clientId === client.id);

    const overdueTasks = clientTasks.filter((t) => {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      const dueParts = resolveCalendarParts(t.dueDate, timeZone);
      return dueParts !== null && calendarDaysDiff(dueParts, refParts) < 0;
    });

    const highPriorityTasks = clientTasks.filter(
      (t) =>
        t.status !== 'completed' &&
        t.status !== 'cancelled' &&
        (t.priority === 'urgent' || t.priority === 'high')
    );

    const imminentMeetings = clientMeetings.filter((m) => {
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      const startMs = parseMeetingDateTimeMs(m.dateTime, timeZone);
      if (startMs === null) return false;
      const mins = (startMs - refMs) / 60000;
      return mins >= -15 && mins <= preferences.meetingLeadMinutes;
    });

    const dueFollowUpMeetings = clientMeetings.filter((m) => {
      if (m.status === 'cancelled') return false;
      if (!m.followUpDateTime) return false;
      const followParts = resolveCalendarParts(m.followUpDateTime, timeZone);
      if (!followParts) return false;
      const diff = calendarDaysDiff(followParts, refParts);
      return diff >= -7 && diff <= Math.max(1, preferences.upcomingTaskWindowDays);
    });

    const c360Alerts = evaluateClientAttentionAlerts({
      client,
      meetings: clientMeetings,
      tasks: clientTasks,
      staleThresholdDays: staleDays,
      referenceDate,
    });
    const staleAlert =
      preferences.showStaleClients && client.relationshipStatus !== 'inactive'
        ? c360Alerts.find((a) => a.kind === 'stale_contact')
        : undefined;

    let staleContactDays: number | null = null;
    if (staleAlert) {
      const mMatch = staleAlert.messageArabic.match(/(\d+)/);
      staleContactDays = mMatch ? Number(mMatch[1]) : staleDays;
    }

    const reasonsArabic: string[] = [];
    if (overdueTasks.length > 0) {
      reasonsArabic.push(
        overdueTasks.length === 1
          ? 'مهمة متأخرة'
          : `${overdueTasks.length} مهام متأخرة`
      );
    }
    if (imminentMeetings.length > 0) {
      reasonsArabic.push('اجتماع قريب');
    }
    if (dueFollowUpMeetings.length > 0) {
      reasonsArabic.push('موعد متابعة مجدول');
    }
    if (client.relationshipStatus === 'follow_up_needed') {
      reasonsArabic.push('حالة العميل: يحتاج متابعة');
    }
    if (highPriorityTasks.length > 0 && overdueTasks.length === 0) {
      reasonsArabic.push('التزام عالي الأولوية');
    }
    if (staleContactDays !== null) {
      reasonsArabic.push(`انقطاع تواصل مسجّل منذ ${staleContactDays} يوماً`);
    }

    if (reasonsArabic.length === 0) continue;

    const severity: 'high' | 'medium' | 'info' =
      overdueTasks.length > 0 || imminentMeetings.length > 0
        ? 'high'
        : dueFollowUpMeetings.length > 0 ||
          client.relationshipStatus === 'follow_up_needed' ||
          highPriorityTasks.length > 0 ||
          staleContactDays !== null
        ? 'medium'
        : 'info';

    entries.push({
      client,
      reasonsArabic,
      severity,
      overdueTasksCount: overdueTasks.length,
      highPriorityTasksCount: highPriorityTasks.length,
      hasImminentMeeting: imminentMeetings.length > 0,
      hasScheduledFollowUp: dueFollowUpMeetings.length > 0,
      staleContactDays,
      basisDisclosureArabic: CLIENT_FOLLOW_UP_DISCLOSURE_AR,
    });
  }

  const rank: Record<'high' | 'medium' | 'info', number> = { high: 3, medium: 2, info: 1 };
  return entries.sort((a, b) => {
    const sDiff = rank[b.severity] - rank[a.severity];
    if (sDiff !== 0) return sDiff;
    return b.overdueTasksCount - a.overdueTasksCount;
  });
}

// =========================================================================
// Live Summary KPIs (100% Real Derived Counts)
// =========================================================================

export function computeDailyCommandSummary(params: {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  preferences?: FollowUpPreferences;
  referenceDate?: Date;
  timeZone?: string;
}): DailyCommandSummary {
  const {
    clients,
    meetings,
    tasks,
    preferences = DEFAULT_FOLLOW_UP_PREFERENCES,
    referenceDate = new Date(),
    timeZone,
  } = params;

  const categorized = categorizeDailyWorkTasks(tasks, referenceDate, timeZone);
  const upcomingMeetings = getUpcomingMeetingsForDailyCenter({
    meetings,
    clients,
    referenceDate,
    timeZone,
    leadMinutes: preferences.meetingLeadMinutes,
  });
  const clientFollowUps = buildDailyClientFollowUps({
    clients,
    meetings,
    tasks,
    preferences,
    referenceDate,
    timeZone,
  });

  const highPriorityTasksCount = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      (t.priority === 'high' || t.priority === 'urgent')
  ).length;

  return {
    dueTodayTasksCount: categorized.today.length,
    overdueTasksCount: categorized.overdue.length,
    todayMeetingsCount: upcomingMeetings.filter((m) => m.isToday).length,
    upcomingMeetingsCount: upcomingMeetings.length,
    followUpsRequiredCount: clientFollowUps.length,
    highPriorityTasksCount,
  };
}

// =========================================================================
// Deterministic Reminder Generation, Snooze & Invalidation Engine
// =========================================================================

function sanitizeIdFragment(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || 'item';
}

function shortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Generates a deterministic Firestore-safe ID (^[a-zA-Z0-9_-]+$, <= 128 chars)
 * guaranteeing at most one reminder per (sourceType, sourceId, reason).
 */
export function buildDeterministicReminderId(
  sourceType: ReminderSourceType,
  sourceId: string,
  reason: ReminderReason
): string {
  const raw = `rem_${sourceType}_${sanitizeIdFragment(sourceId)}_${reason}`;
  if (raw.length <= 120) {
    return raw;
  }
  const suffix = shortHash(`${sourceType}:${sourceId}:${reason}`);
  const prefix = raw.slice(0, 110);
  return `${prefix}_${suffix}`;
}

export function computeTaskFingerprint(task: ActionItem): string {
  return `task|${task.status}|${task.dueDate || ''}|${task.priority}|${task.title.trim()}`;
}

export function computeMeetingFingerprint(meeting: Meeting): string {
  return `meeting|${meeting.status}|${meeting.dateTime}|${meeting.followUpDateTime || ''}|${meeting.title.trim()}`;
}

export function computeClientFingerprint(
  client: Client,
  lastContactIso: string | null
): string {
  return `client|${client.relationshipStatus || ''}|${lastContactIso || client.createdAt || ''}`;
}

export interface SnoozeCalculationResult {
  ok: boolean;
  snoozedUntilIso?: string;
  errorArabic?: string;
}

/**
 * Computes future snooze timestamp WITHOUT mutating original task dueDate or creating duplicate tasks.
 */
export function computeSnoozeUntilIso(params: {
  preset: SnoozePreset;
  customDateTime?: string;
  referenceDate?: Date;
  timeZone?: string;
}): SnoozeCalculationResult {
  const {
    preset,
    customDateTime,
    referenceDate = new Date(),
    timeZone,
  } = params;

  const refMs = referenceDate.getTime();
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  if (preset === '1h') {
    return { ok: true, snoozedUntilIso: new Date(refMs + 3600000).toISOString() };
  }

  if (preset === 'tomorrow') {
    const tomorrowParts = addCalendarDays(refParts, 1);
    const target = buildZonedDate(tomorrowParts, 9, 0, timeZone);
    if (target.getTime() <= refMs) {
      return { ok: true, snoozedUntilIso: new Date(refMs + 24 * 3600000).toISOString() };
    }
    return { ok: true, snoozedUntilIso: target.toISOString() };
  }

  if (preset === '3d') {
    const targetParts = addCalendarDays(refParts, 3);
    const target = buildZonedDate(targetParts, 9, 0, timeZone);
    return { ok: true, snoozedUntilIso: target.toISOString() };
  }

  if (preset === 'next_week') {
    const targetParts = addCalendarDays(refParts, 7);
    const target = buildZonedDate(targetParts, 9, 0, timeZone);
    return { ok: true, snoozedUntilIso: target.toISOString() };
  }

  // Custom date-time
  if (!customDateTime || !customDateTime.trim()) {
    return { ok: false, errorArabic: 'يرجى تحديد تاريخ ووقت للتأجيل.' };
  }

  const parsedMs = parseMeetingDateTimeMs(customDateTime, timeZone);
  if (parsedMs === null || parsedMs <= refMs) {
    return { ok: false, errorArabic: 'يجب أن يكون موعد التأجيل في المستقبل.' };
  }

  return { ok: true, snoozedUntilIso: new Date(parsedMs).toISOString() };
}

export function buildSnoozeStateRecord(params: {
  reminder: ReminderItem;
  snoozedUntilIso: string;
  existing?: ReminderStateRecord;
  nowIso?: string;
  userId?: string;
}): ReminderStateRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  return {
    id: params.reminder.id,
    userId: params.userId,
    sourceType: params.reminder.sourceType,
    sourceId: params.reminder.sourceId,
    reason: params.reminder.reason,
    clientId: params.reminder.clientId,
    status: 'snoozed',
    sourceFingerprint: params.reminder.sourceFingerprint,
    snoozedUntil: params.snoozedUntilIso,
    createdAt: params.existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function buildResolvedStateRecord(params: {
  reminder: ReminderItem;
  existing?: ReminderStateRecord;
  nowIso?: string;
  userId?: string;
}): ReminderStateRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  return {
    id: params.reminder.id,
    userId: params.userId,
    sourceType: params.reminder.sourceType,
    sourceId: params.reminder.sourceId,
    reason: params.reminder.reason,
    clientId: params.reminder.clientId,
    status: 'resolved',
    sourceFingerprint: params.reminder.sourceFingerprint,
    resolvedAt: nowIso,
    createdAt: params.existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

function inferInvalidationDetails(params: {
  persisted: ReminderStateRecord;
  tasksById: Map<string, ActionItem>;
  meetingsById: Map<string, Meeting>;
  clientsById: Map<string, Client>;
  preferences: FollowUpPreferences;
}): { titleArabic: string; titleEnglish: string; reasonArabic: string; clientId?: string } {
  const { persisted, tasksById, meetingsById, clientsById, preferences } = params;

  if (persisted.sourceType === 'task') {
    const task = tasksById.get(persisted.sourceId);
    if (!task) {
      return {
        titleArabic: 'تذكير مهمة محذوفة',
        titleEnglish: 'Deleted task reminder',
        reasonArabic: 'لم يعد صالحًا: تم حذف المهمة المرتبطة',
        clientId: persisted.clientId,
      };
    }
    if (task.status === 'completed') {
      return {
        titleArabic: task.title,
        titleEnglish: task.title,
        reasonArabic: 'لم يعد صالحًا: أُنجزت المهمة المرتبطة',
        clientId: task.clientId,
      };
    }
    if (task.status === 'cancelled') {
      return {
        titleArabic: task.title,
        titleEnglish: task.title,
        reasonArabic: 'لم يعد صالحًا: أُلغيت المهمة المرتبطة',
        clientId: task.clientId,
      };
    }
    if (!preferences.showOverdueTasks && persisted.reason === 'task_overdue') {
      return {
        titleArabic: task.title,
        titleEnglish: task.title,
        reasonArabic: 'متوقف حسب تفضيلات التذكير',
        clientId: task.clientId,
      };
    }
    return {
      titleArabic: task.title,
      titleEnglish: task.title,
      reasonArabic: 'لم يعد صالحًا نتيجة تغيّر موعد أو حالة المهمة',
      clientId: task.clientId,
    };
  }

  if (persisted.sourceType === 'meeting') {
    const meeting = meetingsById.get(persisted.sourceId);
    if (!meeting) {
      return {
        titleArabic: 'تذكير اجتماع محذوف',
        titleEnglish: 'Deleted meeting reminder',
        reasonArabic: 'لم يعد صالحًا: تم حذف الاجتماع المرتبط',
        clientId: persisted.clientId,
      };
    }
    if (meeting.status === 'cancelled') {
      return {
        titleArabic: meeting.title,
        titleEnglish: meeting.title,
        reasonArabic: 'لم يعد صالحًا: أُلغي الاجتماع المرتبط',
        clientId: meeting.clientId,
      };
    }
    if (meeting.status === 'completed') {
      return {
        titleArabic: meeting.title,
        titleEnglish: meeting.title,
        reasonArabic: 'لم يعد صالحًا: انتهى الاجتماع المرتبط',
        clientId: meeting.clientId,
      };
    }
    return {
      titleArabic: meeting.title,
      titleEnglish: meeting.title,
      reasonArabic: 'لم يعد صالحًا نتيجة تغيّر موعد الاجتماع',
      clientId: meeting.clientId,
    };
  }

  const client = clientsById.get(persisted.sourceId);
  if (!client) {
    return {
      titleArabic: 'تنبيه عميل محذوف',
      titleEnglish: 'Deleted client reminder',
      reasonArabic: 'لم يعد صالحًا: تم حذف ملف العميل',
      clientId: persisted.clientId,
    };
  }
  return {
    titleArabic: `متابعة العميل: ${client.name}`,
    titleEnglish: `Client follow-up: ${client.name}`,
    reasonArabic: 'لم يعد صالحًا نتيجة تحديث حالة العميل أو تسجيل تواصل حديث',
    clientId: client.id,
  };
}

export interface EvaluatedRemindersResult {
  active: ReminderItem[];
  snoozed: ReminderItem[];
  resolved: ReminderItem[];
  invalidated: ReminderItem[];
  all: ReminderItem[];
  activeCount: number;
}

export function evaluateReminders(params: {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  persistedStates?: ReminderStateRecord[];
  preferences?: FollowUpPreferences;
  referenceDate?: Date;
  timeZone?: string;
}): EvaluatedRemindersResult {
  const {
    clients,
    meetings,
    tasks,
    persistedStates = [],
    preferences = DEFAULT_FOLLOW_UP_PREFERENCES,
    referenceDate = new Date(),
    timeZone,
  } = params;

  const refMs = referenceDate.getTime();
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  const clientsById = new Map<string, Client>(clients.map((c) => [c.id, c]));
  const tasksById = new Map<string, ActionItem>(tasks.map((t) => [t.id, t]));
  const meetingsById = new Map<string, Meeting>(meetings.map((m) => [m.id, m]));
  const persistedById = new Map<string, ReminderStateRecord>(
    persistedStates.map((s) => [s.id, s])
  );

  // If reminders are globally disabled in user settings, surface zero active alerts
  // while preserving existing persisted records and never deleting tasks/meetings.
  if (!preferences.remindersEnabled) {
    return {
      active: [],
      snoozed: [],
      resolved: [],
      invalidated: [],
      all: [],
      activeCount: 0,
    };
  }

  const candidateMap = new Map<string, Omit<ReminderItem, 'status'>>();

  // 1. Task Candidates (Mutually exclusive date tier -> strict max 1 reminder per task)
  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') continue;

    const clientName = clientsById.get(task.clientId)?.name;
    const dueParts = resolveCalendarParts(task.dueDate, timeZone);
    const fingerprint = computeTaskFingerprint(task);
    const provenance: ProvenanceType = task.provenance || 'approved';

    let reason: ReminderReason | null = null;
    let subtitleArabic = '';
    let subtitleEnglish = '';
    let severity: 'high' | 'medium' | 'info' = 'medium';

    if (dueParts) {
      const diff = calendarDaysDiff(dueParts, refParts);
      if (diff < 0) {
        if (preferences.showOverdueTasks) {
          reason = 'task_overdue';
          severity = 'high';
          const lateDays = Math.abs(diff);
          subtitleArabic =
            lateDays === 1
              ? 'مهمة متأخرة عن موعدها بيوم واحد'
              : `مهمة متأخرة منذ ${lateDays} أيام`;
          subtitleEnglish = `Overdue by ${lateDays} day(s)`;
        }
      } else if (diff === 0) {
        reason = 'task_due_today';
        severity = 'high';
        subtitleArabic = 'مهمة مستحقة اليوم';
        subtitleEnglish = 'Due today';
      } else if (diff <= preferences.upcomingTaskWindowDays) {
        reason = 'task_due_soon';
        severity = 'medium';
        subtitleArabic =
          diff === 1 ? 'مهمة مستحقة غداً' : `مهمة مستحقة خلال ${diff} أيام`;
        subtitleEnglish = diff === 1 ? 'Due tomorrow' : `Due in ${diff} days`;
      } else if (task.priority === 'urgent' || task.priority === 'high') {
        reason = 'task_high_priority';
        severity = 'medium';
        subtitleArabic = 'التزام مفتوح بأولوية عالية';
        subtitleEnglish = 'High priority open commitment';
      }
    } else if (task.priority === 'urgent' || task.priority === 'high') {
      reason = 'task_high_priority';
      severity = 'medium';
      subtitleArabic = 'مهمة عالية الأولوية بدون تاريخ استحقاق';
      subtitleEnglish = 'High priority task without due date';
    }

    if (!reason) continue;

    const id = buildDeterministicReminderId('task', task.id, reason);
    if (!candidateMap.has(id)) {
      candidateMap.set(id, {
        id,
        sourceType: 'task',
        sourceId: task.id,
        reason,
        clientId: task.clientId,
        clientName,
        meetingId: task.meetingId,
        taskId: task.id,
        titleArabic: task.title,
        titleEnglish: task.title,
        subtitleArabic,
        subtitleEnglish,
        dueAt: task.dueDate,
        severity,
        sourceFingerprint: fingerprint,
        provenance,
      });
    }
  }

  // 2. Meeting Candidates (Imminent + Scheduled Follow-Up)
  if (preferences.showUpcomingMeetings) {
    for (const meeting of meetings) {
      if (meeting.status === 'cancelled') continue;
      const clientName = clientsById.get(meeting.clientId)?.name;
      const fingerprint = computeMeetingFingerprint(meeting);

      if (meeting.status !== 'completed') {
        const startMs = parseMeetingDateTimeMs(meeting.dateTime, timeZone);
        if (startMs !== null) {
          const minsUntil = Math.round((startMs - refMs) / 60000);
          if (minsUntil >= -15 && minsUntil <= preferences.meetingLeadMinutes) {
            const reason: ReminderReason = 'meeting_imminent';
            const id = buildDeterministicReminderId('meeting', meeting.id, reason);
            if (!candidateMap.has(id)) {
              const subtitleArabic =
                minsUntil <= 0
                  ? 'موعد الاجتماع الآن'
                  : minsUntil < 60
                  ? `اجتماع قادم خلال ${minsUntil} دقيقة`
                  : `اجتماع قادم خلال ${Math.round(minsUntil / 60)} ساعة`;
              candidateMap.set(id, {
                id,
                sourceType: 'meeting',
                sourceId: meeting.id,
                reason,
                clientId: meeting.clientId,
                clientName,
                meetingId: meeting.id,
                titleArabic: meeting.title,
                titleEnglish: meeting.title,
                subtitleArabic,
                subtitleEnglish: `Upcoming meeting in ${Math.max(0, minsUntil)} min`,
                dueAt: meeting.dateTime,
                severity: 'high',
                sourceFingerprint: fingerprint,
                provenance: 'source',
              });
            }
          }
        }
      }

      if (meeting.followUpDateTime) {
        const followParts = resolveCalendarParts(meeting.followUpDateTime, timeZone);
        if (followParts) {
          const diff = calendarDaysDiff(followParts, refParts);
          const windowDays = Math.max(1, preferences.upcomingTaskWindowDays);
          if (diff >= -7 && diff <= windowDays) {
            const reason: ReminderReason = 'meeting_follow_up';
            const id = buildDeterministicReminderId('meeting', meeting.id, reason);
            if (!candidateMap.has(id)) {
              const subtitleArabic =
                diff < 0
                  ? `متابعة مجدولة من الاجتماع متأخرة منذ ${Math.abs(diff)} يوم`
                  : diff === 0
                  ? 'موعد متابعة مجدول اليوم بناءً على الاجتماع'
                  : `موعد متابعة مجدول خلال ${diff} يوم`;
              candidateMap.set(id, {
                id,
                sourceType: 'meeting',
                sourceId: meeting.id,
                reason,
                clientId: meeting.clientId,
                clientName,
                meetingId: meeting.id,
                titleArabic: `متابعة: ${meeting.title}`,
                titleEnglish: `Follow-up: ${meeting.title}`,
                subtitleArabic,
                subtitleEnglish: 'Scheduled meeting follow-up',
                dueAt: meeting.followUpDateTime,
                severity: diff <= 0 ? 'high' : 'medium',
                sourceFingerprint: fingerprint,
                provenance: 'approved',
              });
            }
          }
        }
      }
    }
  }

  // 3. Client Stale Contact Candidates (reusing Client 360 evaluation logic)
  if (preferences.showStaleClients) {
    const staleThreshold = preferences.staleClientDays || STALE_CONTACT_THRESHOLD_DAYS;
    for (const client of clients) {
      if (client.relationshipStatus === 'inactive') continue;
      const clientMeetings = meetings.filter(
        (m) => m.clientId === client.id && m.status !== 'cancelled'
      );
      const clientTasks = tasks.filter((t) => t.clientId === client.id);
      const alerts = evaluateClientAttentionAlerts({
        client,
        meetings: clientMeetings,
        tasks: clientTasks,
        staleThresholdDays: staleThreshold,
        referenceDate,
      });
      const staleAlert = alerts.find((a) => a.kind === 'stale_contact');
      if (!staleAlert) continue;

      const latestMeetingIso = clientMeetings
        .map((m) => m.dateTime)
        .filter((d) => {
          const ms = parseMeetingDateTimeMs(d, timeZone);
          return ms !== null && ms <= refMs;
        })
        .sort()
        .pop() || null;

      const reason: ReminderReason = 'client_stale_contact';
      const id = buildDeterministicReminderId('client', client.id, reason);
      if (!candidateMap.has(id)) {
        candidateMap.set(id, {
          id,
          sourceType: 'client',
          sourceId: client.id,
          reason,
          clientId: client.id,
          clientName: client.name,
          titleArabic: `مراجعة التواصل مع ${client.name}`,
          titleEnglish: `Review contact with ${client.name}`,
          subtitleArabic: staleAlert.messageArabic,
          subtitleEnglish: 'No recent logged activity in app',
          severity: 'medium',
          sourceFingerprint: computeClientFingerprint(client, latestMeetingIso),
          basisDisclosureArabic: CLIENT_FOLLOW_UP_DISCLOSURE_AR,
          provenance: 'source',
        });
      }
    }
  }

  const active: ReminderItem[] = [];
  const snoozed: ReminderItem[] = [];
  const resolved: ReminderItem[] = [];
  const invalidated: ReminderItem[] = [];

  // Reconcile active candidates with persisted snooze / resolution records
  for (const candidate of candidateMap.values()) {
    const persisted = persistedById.get(candidate.id);
    if (!persisted) {
      active.push({ ...candidate, status: 'active' });
      continue;
    }

    // If source attributes changed (e.g. task dueDate moved or meeting rescheduled),
    // old snooze/dismissal no longer applies -> re-evaluate cleanly as active.
    if (persisted.sourceFingerprint !== candidate.sourceFingerprint) {
      active.push({ ...candidate, status: 'active' });
      continue;
    }

    if (persisted.status === 'resolved') {
      resolved.push({ ...candidate, status: 'resolved' });
      continue;
    }

    if (persisted.status === 'snoozed') {
      const snoozedMs = persisted.snoozedUntil ? new Date(persisted.snoozedUntil).getTime() : NaN;
      if (!Number.isNaN(snoozedMs) && snoozedMs > refMs) {
        snoozed.push({
          ...candidate,
          status: 'snoozed',
          snoozedUntil: persisted.snoozedUntil,
        });
      } else {
        // Snooze duration elapsed -> automatically resurface as active
        active.push({ ...candidate, status: 'active' });
      }
      continue;
    }

    active.push({ ...candidate, status: 'active' });
  }

  // Reconcile persisted states whose underlying source no longer generates a candidate
  // (e.g., task completed/deleted, meeting cancelled/completed, or date changed outside window)
  for (const persisted of persistedStates) {
    if (candidateMap.has(persisted.id)) continue;

    const details = inferInvalidationDetails({
      persisted,
      tasksById,
      meetingsById,
      clientsById,
      preferences,
    });
    const clientName = details.clientId
      ? clientsById.get(details.clientId)?.name
      : undefined;

    invalidated.push({
      id: persisted.id,
      sourceType: persisted.sourceType,
      sourceId: persisted.sourceId,
      reason: persisted.reason,
      clientId: details.clientId,
      clientName,
      meetingId: persisted.sourceType === 'meeting' ? persisted.sourceId : undefined,
      taskId: persisted.sourceType === 'task' ? persisted.sourceId : undefined,
      titleArabic: details.titleArabic,
      titleEnglish: details.titleEnglish,
      subtitleArabic: details.reasonArabic,
      subtitleEnglish: 'Invalidated due to source update',
      severity: 'info',
      status: 'invalidated',
      sourceFingerprint: persisted.sourceFingerprint,
      snoozedUntil: persisted.snoozedUntil,
      invalidationReasonArabic: details.reasonArabic,
      provenance: 'source',
    });
  }

  const severityRank: Record<'high' | 'medium' | 'info', number> = {
    high: 3,
    medium: 2,
    info: 1,
  };
  const sortReminders = (list: ReminderItem[]) =>
    list.sort((a, b) => {
      const sDiff = severityRank[b.severity] - severityRank[a.severity];
      if (sDiff !== 0) return sDiff;
      return (a.dueAt || '').localeCompare(b.dueAt || '');
    });

  sortReminders(active);
  sortReminders(snoozed);
  sortReminders(resolved);
  sortReminders(invalidated);

  return {
    active,
    snoozed,
    resolved,
    invalidated,
    all: [...active, ...snoozed, ...resolved, ...invalidated],
    activeCount: active.length,
  };
}
