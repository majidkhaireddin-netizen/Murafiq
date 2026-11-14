import {
  ActionItem,
  Client,
  ClientImportanceLevel,
  ClientRelationshipStatus,
  Meeting,
  MeetingStatus,
  MeetingType,
  MinutesStatus,
  Note,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  CLIENT_CATEGORY_LABELS,
  CLIENT_IMPORTANCE_CONFIG,
  CLIENT_RELATIONSHIP_STATUS_CONFIG,
  STALE_CONTACT_THRESHOLD_DAYS,
  buildClientDataIndex,
  evaluateClientAttentionAlerts,
  getClientCategoryLabel,
} from './client360';
import {
  CalendarDateParts,
  addCalendarDays,
  calendarDaysDiff,
  extractZonedCalendarParts,
  formatCalendarDateKey,
  getDefaultTimeZone,
  parseDateOnlyString,
  parseMeetingDateTimeMs,
  resolveCalendarParts,
} from './followUpEngine';
import { MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, MINUTES_STATUS_CONFIG } from './meetingMinutes';

// ============================================================================
// Date Range Presets & Timezone-Safe Period Resolution
// ============================================================================

export type AnalyticsDatePreset =
  | '7d'
  | '30d'
  | '90d'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

export type AnalyticsTrendGranularity = 'day' | 'week' | 'month';

export interface AnalyticsDatePresetMeta {
  key: AnalyticsDatePreset;
  labelAr: string;
  labelEn: string;
}

export const ANALYTICS_DATE_PRESETS: AnalyticsDatePresetMeta[] = [
  { key: '7d', labelAr: 'آخر 7 أيام', labelEn: 'Last 7 days' },
  { key: '30d', labelAr: 'آخر 30 يومًا', labelEn: 'Last 30 days' },
  { key: '90d', labelAr: 'آخر 90 يومًا', labelEn: 'Last 90 days' },
  { key: 'this_month', labelAr: 'هذا الشهر', labelEn: 'This month' },
  { key: 'last_month', labelAr: 'الشهر السابق', labelEn: 'Last month' },
  { key: 'this_year', labelAr: 'هذه السنة', labelEn: 'This year' },
  { key: 'custom', labelAr: 'فترة مخصصة', labelEn: 'Custom range' },
];

export interface AnalyticsDateRange {
  preset: AnalyticsDatePreset;
  startKey: string; // Inclusive YYYY-MM-DD
  endKey: string; // Inclusive YYYY-MM-DD
  daysCount: number;
  granularity: AnalyticsTrendGranularity;
  labelAr: string;
  labelEn: string;
  isValid: boolean;
  validationErrorAr?: string;
  validationErrorEn?: string;
}

export interface CustomDateRangeInput {
  startDate?: string;
  endDate?: string;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function determineTrendGranularity(daysCount: number): AnalyticsTrendGranularity {
  if (daysCount <= 31) return 'day';
  if (daysCount <= 120) return 'week';
  return 'month';
}

export function resolveAnalyticsDateRange(params: {
  preset: AnalyticsDatePreset;
  customRange?: CustomDateRangeInput;
  referenceDate?: Date;
  timeZone?: string;
}): AnalyticsDateRange {
  const { preset, customRange, referenceDate = new Date(), timeZone } = params;
  const todayParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(todayParts);

  let startParts: CalendarDateParts;
  let endParts: CalendarDateParts;
  let isValid = true;
  let validationErrorAr: string | undefined;
  let validationErrorEn: string | undefined;

  if (preset === '7d') {
    startParts = addCalendarDays(todayParts, -6);
    endParts = todayParts;
  } else if (preset === '30d') {
    startParts = addCalendarDays(todayParts, -29);
    endParts = todayParts;
  } else if (preset === '90d') {
    startParts = addCalendarDays(todayParts, -89);
    endParts = todayParts;
  } else if (preset === 'this_month') {
    startParts = { year: todayParts.year, month: todayParts.month, day: 1 };
    endParts = todayParts;
  } else if (preset === 'last_month') {
    const prevMonth = todayParts.month === 1 ? 12 : todayParts.month - 1;
    const prevYear = todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
    startParts = { year: prevYear, month: prevMonth, day: 1 };
    endParts = {
      year: prevYear,
      month: prevMonth,
      day: getDaysInMonth(prevYear, prevMonth),
    };
  } else if (preset === 'this_year') {
    startParts = { year: todayParts.year, month: 1, day: 1 };
    endParts = todayParts;
  } else {
    const parsedStart = parseDateOnlyString(customRange?.startDate);
    const parsedEnd = parseDateOnlyString(customRange?.endDate);
    if (!parsedStart || !parsedEnd) {
      isValid = false;
      validationErrorAr = 'يرجى تحديد تاريخ بداية ونهاية صحيحين بصيغة YYYY-MM-DD.';
      validationErrorEn = 'Please provide valid start and end dates (YYYY-MM-DD).';
      startParts = addCalendarDays(todayParts, -29);
      endParts = todayParts;
    } else if (calendarDaysDiff(parsedEnd, parsedStart) < 0) {
      isValid = false;
      validationErrorAr = 'تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.';
      validationErrorEn = 'Start date must be on or before end date.';
      startParts = addCalendarDays(todayParts, -29);
      endParts = todayParts;
    } else {
      startParts = parsedStart;
      endParts = parsedEnd;
    }
  }

  const startKey = formatCalendarDateKey(startParts);
  const endKey = formatCalendarDateKey(endParts);
  const daysCount = Math.max(1, calendarDaysDiff(endParts, startParts) + 1);
  const presetMeta = ANALYTICS_DATE_PRESETS.find((p) => p.key === preset);

  const labelAr =
    preset === 'custom' && isValid
      ? `فترة مخصصة (${startKey} إلى ${endKey})`
      : presetMeta?.labelAr || todayKey;
  const labelEn =
    preset === 'custom' && isValid
      ? `Custom (${startKey} to ${endKey})`
      : presetMeta?.labelEn || todayKey;

  return {
    preset,
    startKey,
    endKey,
    daysCount,
    granularity: determineTrendGranularity(daysCount),
    labelAr,
    labelEn,
    isValid,
    validationErrorAr,
    validationErrorEn,
  };
}

export function getPreviousEquivalentRange(range: AnalyticsDateRange): AnalyticsDateRange {
  const startParts = parseDateOnlyString(range.startKey);
  if (!startParts) {
    return { ...range };
  }
  const prevEndParts = addCalendarDays(startParts, -1);
  const prevStartParts = addCalendarDays(prevEndParts, -(range.daysCount - 1));
  const startKey = formatCalendarDateKey(prevStartParts);
  const endKey = formatCalendarDateKey(prevEndParts);

  return {
    preset: 'custom',
    startKey,
    endKey,
    daysCount: range.daysCount,
    granularity: range.granularity,
    labelAr: `الفترة السابقة المماثلة (${startKey} إلى ${endKey})`,
    labelEn: `Previous equivalent period (${startKey} to ${endKey})`,
    isValid: true,
  };
}

function resolveDateKey(input?: string | null, timeZone?: string): string | null {
  const parts = resolveCalendarParts(input, timeZone);
  return parts ? formatCalendarDateKey(parts) : null;
}

function isKeyInRange(key: string | null, startKey: string, endKey: string): boolean {
  if (!key) return false;
  return key >= startKey && key <= endKey;
}

// ============================================================================
// Drill-Down Target Types
// ============================================================================

export type AnalyticsDrillDownTarget =
  | {
      tab: 'clients';
      quickFilter?: 'all' | 'favorites' | 'needs_follow_up' | 'overdue_tasks';
      createdFrom?: string;
      createdTo?: string;
      clientId?: string;
    }
  | {
      tab: 'meetings';
      status?: 'all' | MeetingStatus;
      upcomingOnly?: boolean;
      meetingId?: string;
    }
  | {
      tab: 'tasks';
      scope?: 'all' | 'overdue' | 'open' | 'completed';
      priority?: TaskPriority | 'all';
      clientId?: string;
      taskId?: string;
    };

// ============================================================================
// Core Analytics Output Types
// ============================================================================

export interface AnalyticsKpis {
  // Clients (4)
  totalClients: number;
  newClientsInPeriod: number;
  clientsWithMeetingsInPeriod: number;
  clientsNeedingFollowUp: number;
  // Meetings (4)
  heldMeetingsInPeriod: number;
  upcomingMeetings: number;
  cancelledMeetingsInPeriod: number;
  cancelledMeetingsTotal: number;
  avgMeetingsPerWeek: number;
  // Tasks (5)
  tasksCreatedInPeriod: number;
  tasksCompletedInPeriod: number;
  openTasksCurrent: number;
  overdueTasksCurrent: number;
  taskCompletionRateInPeriod: number | null;
  cohortTasksCreatedCount: number;
  cohortTasksCurrentlyCompletedCount: number;
  completedTasksTotal: number;
  completedWithoutTimestampCount: number;
}

export interface PeriodComparisonMetric {
  key: 'heldMeetings' | 'completedTasks' | 'newClients' | 'loggedActivities';
  labelAr: string;
  labelEn: string;
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  hasValidBase: boolean;
  polarity: 'higher_is_more_active' | 'lower_is_better';
  tone: 'positive' | 'negative' | 'neutral';
  noBaseMessageAr: string;
  noBaseMessageEn: string;
}

export interface TrendBucketPoint {
  bucketKey: string;
  labelAr: string;
  labelEn: string;
  heldMeetings: number;
  scheduledMeetings: number;
  cancelledMeetings: number;
  completedTasks: number;
}

export interface BreakdownItem<K extends string = string> {
  key: K;
  labelAr: string;
  labelEn: string;
  count: number;
  sharePercent: number;
}

export interface TaskLinkedMeetingEntry {
  meetingId: string;
  title: string;
  clientId: string;
  clientName: string;
  dateTime: string;
  status: MeetingStatus;
  linkedTasksCount: number;
  openTasksCount: number;
  completedTasksCount: number;
}

export interface MeetingAnalytics {
  totalInPeriod: number;
  nonCancelledInPeriod: number;
  heldInPeriod: number;
  upcomingNext7DaysCount: number;
  trendSeries: TrendBucketPoint[];
  byType: BreakdownItem<MeetingType>[];
  byStatus: BreakdownItem<MeetingStatus>[];
  byMinutesStatus: BreakdownItem<MinutesStatus>[];
  topTaskLinkedMeetings: TaskLinkedMeetingEntry[];
}

export interface OverdueClientBreakdown {
  clientId: string;
  clientName: string;
  overdueCount: number;
  urgentOrHighCount: number;
}

export interface TaskAnalytics {
  totalTasks: number;
  openCurrentCount: number;
  overdueCurrentCount: number;
  completedTotalCount: number;
  completedWithTimestampCount: number;
  completedWithoutTimestampCount: number;
  byStatusCurrent: BreakdownItem<TaskStatus>[];
  byPriorityOpenCurrent: BreakdownItem<TaskPriority>[];
  byPriorityOverdueCurrent: BreakdownItem<TaskPriority>[];
  overdueAffectedClients: OverdueClientBreakdown[];
  completedTrendSeries: TrendBucketPoint[];
}

export interface ActiveClientAnalyticsEntry {
  client: Client;
  meetingsInPeriod: number;
  heldMeetingsInPeriod: number;
  lastMeetingAt: string | null;
  openTasksCount: number;
}

export interface ClientAttentionAnalyticsEntry {
  client: Client;
  severity: 'high' | 'medium' | 'info';
  reasonsAr: string[];
  reasonsEn: string[];
  overdueTasksCount: number;
  highPriorityOpenCount: number;
  daysSinceLastContact: number | null;
  hasUpcomingMeetingSoon: boolean;
}

export interface ClientAnalytics {
  mostActiveClients: ActiveClientAnalyticsEntry[];
  clientsNeedingAttention: ClientAttentionAnalyticsEntry[];
  newClientsInPeriod: Client[];
  byRelationshipStatus: BreakdownItem<string>[];
  byImportance: BreakdownItem<string>[];
  byCategory: BreakdownItem<string>[];
  byIndustry: BreakdownItem<string>[];
}

export interface ActionableInsight {
  id: string;
  severity: 'high' | 'medium' | 'info';
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  evidenceAr: string;
  evidenceEn: string;
  actionLabelAr: string;
  actionLabelEn: string;
  drillDown: AnalyticsDrillDownTarget;
  provenance: 'source';
}

export interface AnalyticsDataCompleteness {
  allCollectionsLoaded: boolean;
  clientsLoaded: boolean;
  meetingsLoaded: boolean;
  tasksLoaded: boolean;
  notesLoaded: boolean;
  isIncomplete: boolean;
  isEmptyWorkspace: boolean;
  warningAr?: string;
  warningEn?: string;
}

export interface AnalyticsReportSnapshot {
  generatedAtIso: string;
  timeZone: string;
  range: AnalyticsDateRange;
  previousRange: AnalyticsDateRange;
  completeness: AnalyticsDataCompleteness;
  kpis: AnalyticsKpis;
  comparisons: PeriodComparisonMetric[];
  meetings: MeetingAnalytics;
  tasks: TaskAnalytics;
  clients: ClientAnalytics;
  insights: ActionableInsight[];
}

// ============================================================================
// Trend Bucketing Helpers
// ============================================================================

interface TrendBucketSpec {
  bucketKey: string;
  startKey: string;
  endKey: string;
  labelAr: string;
  labelEn: string;
}

const SHORT_MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const SHORT_MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatDayShort(parts: CalendarDateParts, lang: 'ar' | 'en'): string {
  const monthLabel =
    lang === 'ar'
      ? SHORT_MONTHS_AR[parts.month - 1] || String(parts.month)
      : SHORT_MONTHS_EN[parts.month - 1] || String(parts.month);
  return `${parts.day} ${monthLabel}`;
}

function buildTrendBucketSpecs(range: AnalyticsDateRange): TrendBucketSpec[] {
  const startParts = parseDateOnlyString(range.startKey);
  const endParts = parseDateOnlyString(range.endKey);
  if (!startParts || !endParts) return [];

  const specs: TrendBucketSpec[] = [];

  if (range.granularity === 'day') {
    let cur = startParts;
    for (let i = 0; i < range.daysCount && i < 62; i++) {
      const key = formatCalendarDateKey(cur);
      specs.push({
        bucketKey: key,
        startKey: key,
        endKey: key,
        labelAr: formatDayShort(cur, 'ar'),
        labelEn: formatDayShort(cur, 'en'),
      });
      cur = addCalendarDays(cur, 1);
    }
    return specs;
  }

  if (range.granularity === 'week') {
    let cur = startParts;
    while (calendarDaysDiff(endParts, cur) >= 0) {
      const candidateEnd = addCalendarDays(cur, 6);
      const bucketEnd =
        calendarDaysDiff(candidateEnd, endParts) > 0 ? endParts : candidateEnd;
      const bStartKey = formatCalendarDateKey(cur);
      const bEndKey = formatCalendarDateKey(bucketEnd);
      specs.push({
        bucketKey: bStartKey,
        startKey: bStartKey,
        endKey: bEndKey,
        labelAr: `${formatDayShort(cur, 'ar')}`,
        labelEn: `${formatDayShort(cur, 'en')}`,
      });
      cur = addCalendarDays(bucketEnd, 1);
    }
    return specs;
  }

  // Monthly buckets
  let year = startParts.year;
  let month = startParts.month;
  while (year < endParts.year || (year === endParts.year && month <= endParts.month)) {
    const monthStart: CalendarDateParts = {
      year,
      month,
      day: year === startParts.year && month === startParts.month ? startParts.day : 1,
    };
    const lastDay = getDaysInMonth(year, month);
    const monthEnd: CalendarDateParts = {
      year,
      month,
      day:
        year === endParts.year && month === endParts.month
          ? Math.min(endParts.day, lastDay)
          : lastDay,
    };
    const ymKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    specs.push({
      bucketKey: ymKey,
      startKey: formatCalendarDateKey(monthStart),
      endKey: formatCalendarDateKey(monthEnd),
      labelAr: `${SHORT_MONTHS_AR[month - 1]} ${year}`,
      labelEn: `${SHORT_MONTHS_EN[month - 1]} ${year}`,
    });

    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }

  return specs;
}

function findBucketIndexForDateKey(
  dateKey: string,
  specs: TrendBucketSpec[],
  granularity: AnalyticsTrendGranularity
): number {
  if (specs.length === 0) return -1;
  if (granularity === 'month') {
    const ym = dateKey.slice(0, 7);
    return specs.findIndex((s) => s.bucketKey === ym);
  }
  for (let i = 0; i < specs.length; i++) {
    if (dateKey >= specs[i].startKey && dateKey <= specs[i].endKey) {
      return i;
    }
  }
  return -1;
}

// ============================================================================
// Breakdown Helpers
// ============================================================================

function toBreakdown<K extends string>(
  counts: { key: K; labelAr: string; labelEn: string; count: number }[],
  denominator: number
): BreakdownItem<K>[] {
  return counts.map((item) => ({
    ...item,
    sharePercent: denominator > 0 ? Math.round((item.count / denominator) * 100) : 0,
  }));
}

function buildComparisonMetric(params: {
  key: PeriodComparisonMetric['key'];
  labelAr: string;
  labelEn: string;
  current: number;
  previous: number;
  polarity?: PeriodComparisonMetric['polarity'];
}): PeriodComparisonMetric {
  const {
    key,
    labelAr,
    labelEn,
    current,
    previous,
    polarity = 'higher_is_more_active',
  } = params;
  const delta = current - previous;
  const hasValidBase = previous > 0;
  const percentChange = hasValidBase ? Math.round((delta / previous) * 1000) / 10 : null;

  let tone: PeriodComparisonMetric['tone'] = 'neutral';
  if (delta > 0) {
    tone = polarity === 'higher_is_more_active' ? 'positive' : 'negative';
  } else if (delta < 0) {
    tone = polarity === 'higher_is_more_active' ? 'negative' : 'positive';
  }

  return {
    key,
    labelAr,
    labelEn,
    current,
    previous,
    delta,
    percentChange,
    hasValidBase,
    polarity,
    tone,
    noBaseMessageAr: 'لا تتوفر قاعدة مناسبة لحساب نسبة التغير',
    noBaseMessageEn: 'No prior baseline available for % change',
  };
}

// ============================================================================
// Main Pure Analytics Engine (Single-Pass Indexed, Deterministic)
// ============================================================================

export interface ComputeDashboardAnalyticsInput {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  preset?: AnalyticsDatePreset;
  customRange?: CustomDateRangeInput;
  collectionsLoaded?: {
    clients: boolean;
    meetings: boolean;
    tasks: boolean;
    notes: boolean;
  };
  referenceDate?: Date;
  timeZone?: string;
}

export function computeDashboardAnalytics(
  input: ComputeDashboardAnalyticsInput
): AnalyticsReportSnapshot {
  const {
    clients,
    meetings,
    tasks,
    notes,
    preset = '30d',
    customRange,
    collectionsLoaded = { clients: true, meetings: true, tasks: true, notes: true },
    referenceDate = new Date(),
    timeZone = getDefaultTimeZone() || 'UTC',
  } = input;

  const allCollectionsLoaded =
    collectionsLoaded.clients &&
    collectionsLoaded.meetings &&
    collectionsLoaded.tasks &&
    collectionsLoaded.notes;

  const isEmptyWorkspace =
    allCollectionsLoaded &&
    clients.length === 0 &&
    meetings.length === 0 &&
    tasks.length === 0 &&
    notes.length === 0;

  const completeness: AnalyticsDataCompleteness = {
    allCollectionsLoaded,
    clientsLoaded: collectionsLoaded.clients,
    meetingsLoaded: collectionsLoaded.meetings,
    tasksLoaded: collectionsLoaded.tasks,
    notesLoaded: collectionsLoaded.notes,
    isIncomplete: !allCollectionsLoaded,
    isEmptyWorkspace,
    warningAr: !allCollectionsLoaded
      ? 'بعض السجلات ما زالت قيد التحميل أو المزامنة؛ الأرقام الظاهرة تعكس البيانات المتوفرة محليًا فقط حتى تكتمل المزامنة.'
      : undefined,
    warningEn: !allCollectionsLoaded
      ? 'Some collections are still loading or syncing; metrics reflect currently available local records only.'
      : undefined,
  };

  const range = resolveAnalyticsDateRange({
    preset,
    customRange,
    referenceDate,
    timeZone,
  });
  const previousRange = getPreviousEquivalentRange(range);

  const refMs = referenceDate.getTime();
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(refParts);
  const next7EndKey = formatCalendarDateKey(addCalendarDays(refParts, 7));

  const clientById = new Map<string, Client>(clients.map((c) => [c.id, c]));
  const dataIndex = buildClientDataIndex({ meetings, tasks, notes });

  // Trend series initialization
  const bucketSpecs = buildTrendBucketSpecs(range);
  const trendSeries: TrendBucketPoint[] = bucketSpecs.map((spec) => ({
    bucketKey: spec.bucketKey,
    labelAr: spec.labelAr,
    labelEn: spec.labelEn,
    heldMeetings: 0,
    scheduledMeetings: 0,
    cancelledMeetings: 0,
    completedTasks: 0,
  }));

  // -------------------------------------------------------------------------
  // 1. Clients Indexing & Period Metrics
  // -------------------------------------------------------------------------
  const newClientsInPeriod: Client[] = [];
  let prevNewClientsCount = 0;

  const relStatusCounts = new Map<string, number>();
  const importanceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();

  for (const client of clients) {
    const createdKey = resolveDateKey(client.createdAt, timeZone);
    if (isKeyInRange(createdKey, range.startKey, range.endKey)) {
      newClientsInPeriod.push(client);
    } else if (isKeyInRange(createdKey, previousRange.startKey, previousRange.endKey)) {
      prevNewClientsCount += 1;
    }

    const relKey = client.relationshipStatus || 'unspecified';
    relStatusCounts.set(relKey, (relStatusCounts.get(relKey) || 0) + 1);

    const impKey = client.importance || 'unspecified';
    importanceCounts.set(impKey, (importanceCounts.get(impKey) || 0) + 1);

    const catKey = client.category?.trim() || 'unspecified';
    categoryCounts.set(catKey, (categoryCounts.get(catKey) || 0) + 1);

    const indKey = client.industry?.trim() || 'unspecified';
    industryCounts.set(indKey, (industryCounts.get(indKey) || 0) + 1);
  }

  newClientsInPeriod.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // -------------------------------------------------------------------------
  // 2. Meetings Indexing & Period Metrics (Strict: held === status === 'completed')
  // -------------------------------------------------------------------------
  let totalMeetingsInPeriod = 0;
  let nonCancelledMeetingsInPeriod = 0;
  let heldMeetingsInPeriod = 0;
  let cancelledMeetingsInPeriod = 0;
  let cancelledMeetingsTotal = 0;
  let upcomingMeetingsCount = 0;
  let upcomingNext7DaysCount = 0;

  let prevHeldMeetingsCount = 0;
  const loggedActivityIdsCurrent = new Set<string>();
  const loggedActivityIdsPrev = new Set<string>();

  const clientsWithMeetingsSet = new Set<string>();
  const clientMeetingStatsInPeriod = new Map<
    string,
    { total: number; held: number; lastDateTime: string | null; lastMs: number }
  >();

  const meetingTypeCounts: Record<MeetingType, number> = {
    in_person: 0,
    video: 0,
    phone: 0,
    chat: 0,
  };
  const meetingStatusCounts: Record<MeetingStatus, number> = {
    draft: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };
  const minutesStatusCounts: Record<MinutesStatus, number> = {
    draft: 0,
    review: 0,
    final: 0,
  };

  const tasksByMeetingId = new Map<string, ActionItem[]>();
  for (const t of tasks) {
    if (!t.meetingId) continue;
    const list = tasksByMeetingId.get(t.meetingId);
    if (list) list.push(t);
    else tasksByMeetingId.set(t.meetingId, [t]);
  }

  const periodMeetingsForTaskLink: Meeting[] = [];

  for (const m of meetings) {
    if (m.status === 'cancelled') {
      cancelledMeetingsTotal += 1;
    }

    const startMs = parseMeetingDateTimeMs(m.dateTime, timeZone);
    const graceWindowMs = Math.max(60, m.duration || 60) * 60000;
    const isUpcomingActive =
      m.status !== 'completed' &&
      m.status !== 'cancelled' &&
      startMs !== null &&
      startMs >= refMs - graceWindowMs;

    if (isUpcomingActive) {
      upcomingMeetingsCount += 1;
      const mKey = resolveDateKey(m.dateTime, timeZone);
      if (mKey && mKey >= todayKey && mKey <= next7EndKey) {
        upcomingNext7DaysCount += 1;
      }
    }

    const meetingDateKey = resolveDateKey(m.dateTime, timeZone);

    if (isKeyInRange(meetingDateKey, range.startKey, range.endKey)) {
      totalMeetingsInPeriod += 1;
      if (m.status in meetingStatusCounts) {
        meetingStatusCounts[m.status] += 1;
      }

      if (m.status === 'cancelled') {
        cancelledMeetingsInPeriod += 1;
      } else {
        nonCancelledMeetingsInPeriod += 1;
        periodMeetingsForTaskLink.push(m);
        loggedActivityIdsCurrent.add(`meeting:${m.id}`);

        if (m.type in meetingTypeCounts) {
          meetingTypeCounts[m.type] += 1;
        }
        const minStatus: MinutesStatus = m.minutesStatus || 'draft';
        if (minStatus in minutesStatusCounts) {
          minutesStatusCounts[minStatus] += 1;
        }

        if (m.status === 'completed') {
          heldMeetingsInPeriod += 1;
        }

        if (m.clientId && clientById.has(m.clientId)) {
          clientsWithMeetingsSet.add(m.clientId);
          const existing = clientMeetingStatsInPeriod.get(m.clientId) || {
            total: 0,
            held: 0,
            lastDateTime: null,
            lastMs: -Infinity,
          };
          existing.total += 1;
          if (m.status === 'completed') existing.held += 1;
          const mMs = startMs ?? -Infinity;
          if (mMs > existing.lastMs) {
            existing.lastMs = mMs;
            existing.lastDateTime = m.dateTime;
          }
          clientMeetingStatsInPeriod.set(m.clientId, existing);
        }
      }

      if (meetingDateKey) {
        const bIdx = findBucketIndexForDateKey(meetingDateKey, bucketSpecs, range.granularity);
        if (bIdx >= 0) {
          if (m.status === 'completed') trendSeries[bIdx].heldMeetings += 1;
          else if (m.status === 'cancelled') trendSeries[bIdx].cancelledMeetings += 1;
          else trendSeries[bIdx].scheduledMeetings += 1;
        }
      }
    } else if (isKeyInRange(meetingDateKey, previousRange.startKey, previousRange.endKey)) {
      if (m.status !== 'cancelled') {
        loggedActivityIdsPrev.add(`meeting:${m.id}`);
        if (m.status === 'completed') {
          prevHeldMeetingsCount += 1;
        }
      }
    }
  }

  const weeksInRange = Math.max(1 / 7, range.daysCount / 7);
  const avgMeetingsPerWeek = Math.round((heldMeetingsInPeriod / weeksInRange) * 10) / 10;

  const topTaskLinkedMeetings: TaskLinkedMeetingEntry[] = periodMeetingsForTaskLink
    .map((m) => {
      const linked = tasksByMeetingId.get(m.id) || [];
      const openTasksCount = linked.filter(
        (t) => t.status !== 'completed' && t.status !== 'cancelled'
      ).length;
      const completedTasksCount = linked.filter((t) => t.status === 'completed').length;
      return {
        meetingId: m.id,
        title: m.title,
        clientId: m.clientId,
        clientName: clientById.get(m.clientId)?.name || 'عميل غير محدد',
        dateTime: m.dateTime,
        status: m.status,
        linkedTasksCount: linked.length,
        openTasksCount,
        completedTasksCount,
      };
    })
    .filter((entry) => entry.linkedTasksCount > 0)
    .sort((a, b) => {
      if (b.linkedTasksCount !== a.linkedTasksCount) {
        return b.linkedTasksCount - a.linkedTasksCount;
      }
      return (b.dateTime || '').localeCompare(a.dateTime || '');
    })
    .slice(0, 5);

  // -------------------------------------------------------------------------
  // 3. Tasks Indexing & Period Metrics (Strict: completedAt ONLY, no guessing)
  // -------------------------------------------------------------------------
  let tasksCreatedInPeriod = 0;
  let cohortTasksCurrentlyCompletedCount = 0;
  let tasksCompletedInPeriod = 0;
  let prevCompletedTasksCount = 0;
  let openTasksCurrent = 0;
  let overdueTasksCurrent = 0;
  let completedTasksTotal = 0;
  let completedWithTimestampCount = 0;
  let completedWithoutTimestampCount = 0;

  const taskStatusCountsCurrent: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };
  const openPriorityCounts: Record<TaskPriority, number> = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const overduePriorityCounts: Record<TaskPriority, number> = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const overdueByClientMap = new Map<
    string,
    { overdueCount: number; urgentOrHighCount: number }
  >();

  for (const t of tasks) {
    if (t.status in taskStatusCountsCurrent) {
      taskStatusCountsCurrent[t.status] += 1;
    }

    const createdKey = resolveDateKey(t.createdAt, timeZone);
    if (isKeyInRange(createdKey, range.startKey, range.endKey)) {
      tasksCreatedInPeriod += 1;
      loggedActivityIdsCurrent.add(`task:${t.id}`);
      if (t.status === 'completed') {
        cohortTasksCurrentlyCompletedCount += 1;
      }
    } else if (isKeyInRange(createdKey, previousRange.startKey, previousRange.endKey)) {
      loggedActivityIdsPrev.add(`task:${t.id}`);
    }

    if (t.status === 'completed') {
      completedTasksTotal += 1;
      const completedKey = resolveDateKey(t.completedAt, timeZone);
      if (completedKey) {
        completedWithTimestampCount += 1;
        if (isKeyInRange(completedKey, range.startKey, range.endKey)) {
          tasksCompletedInPeriod += 1;
          const bIdx = findBucketIndexForDateKey(completedKey, bucketSpecs, range.granularity);
          if (bIdx >= 0) {
            trendSeries[bIdx].completedTasks += 1;
          }
        } else if (isKeyInRange(completedKey, previousRange.startKey, previousRange.endKey)) {
          prevCompletedTasksCount += 1;
        }
      } else {
        completedWithoutTimestampCount += 1;
      }
      continue;
    }

    if (t.status === 'cancelled') {
      continue;
    }

    // Open task
    openTasksCurrent += 1;
    if (t.priority in openPriorityCounts) {
      openPriorityCounts[t.priority] += 1;
    }

    const dueParts = resolveCalendarParts(t.dueDate, timeZone);
    if (dueParts && calendarDaysDiff(dueParts, refParts) < 0) {
      overdueTasksCurrent += 1;
      if (t.priority in overduePriorityCounts) {
        overduePriorityCounts[t.priority] += 1;
      }
      if (t.clientId) {
        const cur = overdueByClientMap.get(t.clientId) || {
          overdueCount: 0,
          urgentOrHighCount: 0,
        };
        cur.overdueCount += 1;
        if (t.priority === 'urgent' || t.priority === 'high') {
          cur.urgentOrHighCount += 1;
        }
        overdueByClientMap.set(t.clientId, cur);
      }
    }
  }

  const taskCompletionRateInPeriod =
    tasksCreatedInPeriod > 0
      ? Math.round((cohortTasksCurrentlyCompletedCount / tasksCreatedInPeriod) * 100)
      : null;

  const overdueAffectedClients: OverdueClientBreakdown[] = Array.from(overdueByClientMap.entries())
    .map(([clientId, stats]) => ({
      clientId,
      clientName: clientById.get(clientId)?.name || 'عميل غير محدد',
      overdueCount: stats.overdueCount,
      urgentOrHighCount: stats.urgentOrHighCount,
    }))
    .sort((a, b) => {
      if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
      return b.urgentOrHighCount - a.urgentOrHighCount;
    });

  // Notes logged in period (deduplicated by note id)
  for (const n of notes) {
    const noteKey = resolveDateKey(n.createdAt, timeZone);
    if (isKeyInRange(noteKey, range.startKey, range.endKey)) {
      loggedActivityIdsCurrent.add(`note:${n.id}`);
    } else if (isKeyInRange(noteKey, previousRange.startKey, previousRange.endKey)) {
      loggedActivityIdsPrev.add(`note:${n.id}`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Client Relationship Intelligence (Reusing Client 360 Engine)
  // -------------------------------------------------------------------------
  const clientsNeedingAttention: ClientAttentionAnalyticsEntry[] = [];
  let clientsNeedingFollowUpCount = 0;

  for (const client of clients) {
    const cMeetings = dataIndex.meetingsByClient.get(client.id) || [];
    const cTasks = dataIndex.tasksByClient.get(client.id) || [];

    const alerts = evaluateClientAttentionAlerts({
      client,
      meetings: cMeetings,
      tasks: cTasks,
      staleThresholdDays: STALE_CONTACT_THRESHOLD_DAYS,
      referenceDate,
    });

    const overdueAlert = alerts.find((a) => a.kind === 'overdue_tasks');
    const staleAlert = alerts.find((a) => a.kind === 'stale_contact');
    const highPrioAlert = alerts.find((a) => a.kind === 'high_priority_tasks');
    const upcomingAlert = alerts.find((a) => a.kind === 'upcoming_meeting');
    const markedFollowUp = client.relationshipStatus === 'follow_up_needed';

    const needsFollowUp =
      markedFollowUp || Boolean(overdueAlert) || Boolean(staleAlert);
    if (needsFollowUp) {
      clientsNeedingFollowUpCount += 1;
    }

    if (markedFollowUp || alerts.length > 0) {
      const reasonsAr: string[] = [];
      const reasonsEn: string[] = [];

      const overdueCount = cTasks.filter((t) => {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        const due = resolveCalendarParts(t.dueDate, timeZone);
        return due !== null && calendarDaysDiff(due, refParts) < 0;
      }).length;

      const highPrioCount = cTasks.filter(
        (t) =>
          t.status !== 'completed' &&
          t.status !== 'cancelled' &&
          (t.priority === 'urgent' || t.priority === 'high')
      ).length;

      let daysSinceLastContact: number | null = null;
      const pastMeetingMs = cMeetings
        .filter((m) => m.status !== 'cancelled')
        .map((m) => parseMeetingDateTimeMs(m.dateTime, timeZone))
        .filter((ms): ms is number => ms !== null && ms <= refMs);
      if (pastMeetingMs.length > 0) {
        daysSinceLastContact = Math.floor((refMs - Math.max(...pastMeetingMs)) / 86400000);
      } else if (cMeetings.length === 0) {
        const createdMs = new Date(client.createdAt).getTime();
        if (!Number.isNaN(createdMs)) {
          daysSinceLastContact = Math.floor((refMs - createdMs) / 86400000);
        }
      }

      if (overdueCount > 0) {
        reasonsAr.push(`${overdueCount} مهام متأخرة`);
        reasonsEn.push(`${overdueCount} overdue task(s)`);
      }
      if (markedFollowUp) {
        reasonsAr.push('الحالة: يحتاج متابعة');
        reasonsEn.push('Status: Needs follow-up');
      }
      if (staleAlert && daysSinceLastContact !== null) {
        reasonsAr.push(`غياب تواصل مسجل منذ ${daysSinceLastContact} يومًا`);
        reasonsEn.push(`No logged contact for ${daysSinceLastContact} days`);
      }
      if (highPrioAlert && highPrioCount > 0) {
        reasonsAr.push(`${highPrioCount} مهام عالية الأولوية`);
        reasonsEn.push(`${highPrioCount} high-priority task(s)`);
      }
      if (upcomingAlert) {
        reasonsAr.push('اجتماع قريب خلال 48 ساعة');
        reasonsEn.push('Upcoming meeting within 48h');
      }

      const severity: ClientAttentionAnalyticsEntry['severity'] =
        overdueCount > 0 || (markedFollowUp && highPrioCount > 0)
          ? 'high'
          : markedFollowUp || staleAlert || highPrioCount > 0
          ? 'medium'
          : 'info';

      clientsNeedingAttention.push({
        client,
        severity,
        reasonsAr,
        reasonsEn,
        overdueTasksCount: overdueCount,
        highPriorityOpenCount: highPrioCount,
        daysSinceLastContact,
        hasUpcomingMeetingSoon: Boolean(upcomingAlert),
      });
    }
  }

  const severityRank: Record<'high' | 'medium' | 'info', number> = {
    high: 3,
    medium: 2,
    info: 1,
  };

  clientsNeedingAttention.sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    if (b.overdueTasksCount !== a.overdueTasksCount) {
      return b.overdueTasksCount - a.overdueTasksCount;
    }
    return (b.daysSinceLastContact || 0) - (a.daysSinceLastContact || 0);
  });

  const mostActiveClients: ActiveClientAnalyticsEntry[] = Array.from(
    clientMeetingStatsInPeriod.entries()
  )
    .map(([clientId, stats]) => {
      const client = clientById.get(clientId)!;
      const openTasksCount = (dataIndex.tasksByClient.get(clientId) || []).filter(
        (t) => t.status !== 'completed' && t.status !== 'cancelled'
      ).length;
      return {
        client,
        meetingsInPeriod: stats.total,
        heldMeetingsInPeriod: stats.held,
        lastMeetingAt: stats.lastDateTime,
        openTasksCount,
      };
    })
    .sort((a, b) => {
      if (b.meetingsInPeriod !== a.meetingsInPeriod) {
        return b.meetingsInPeriod - a.meetingsInPeriod;
      }
      if (b.heldMeetingsInPeriod !== a.heldMeetingsInPeriod) {
        return b.heldMeetingsInPeriod - a.heldMeetingsInPeriod;
      }
      return (b.lastMeetingAt || '').localeCompare(a.lastMeetingAt || '');
    })
    .slice(0, 6);

  // -------------------------------------------------------------------------
  // 5. Distributions & Comparisons
  // -------------------------------------------------------------------------
  const kpis: AnalyticsKpis = {
    totalClients: clients.length,
    newClientsInPeriod: newClientsInPeriod.length,
    clientsWithMeetingsInPeriod: clientsWithMeetingsSet.size,
    clientsNeedingFollowUp: clientsNeedingFollowUpCount,
    heldMeetingsInPeriod,
    upcomingMeetings: upcomingMeetingsCount,
    cancelledMeetingsInPeriod,
    cancelledMeetingsTotal,
    avgMeetingsPerWeek,
    tasksCreatedInPeriod,
    tasksCompletedInPeriod,
    openTasksCurrent,
    overdueTasksCurrent,
    taskCompletionRateInPeriod,
    cohortTasksCreatedCount: tasksCreatedInPeriod,
    cohortTasksCurrentlyCompletedCount,
    completedTasksTotal,
    completedWithoutTimestampCount,
  };

  const comparisons: PeriodComparisonMetric[] = [
    buildComparisonMetric({
      key: 'heldMeetings',
      labelAr: 'الاجتماعات المنعقدة',
      labelEn: 'Held Meetings',
      current: heldMeetingsInPeriod,
      previous: prevHeldMeetingsCount,
    }),
    buildComparisonMetric({
      key: 'completedTasks',
      labelAr: 'المهام المنجزة (بتاريخ إنجاز موثق)',
      labelEn: 'Completed Tasks (verified date)',
      current: tasksCompletedInPeriod,
      previous: prevCompletedTasksCount,
    }),
    buildComparisonMetric({
      key: 'newClients',
      labelAr: 'العملاء الجدد',
      labelEn: 'New Clients',
      current: newClientsInPeriod.length,
      previous: prevNewClientsCount,
    }),
    buildComparisonMetric({
      key: 'loggedActivities',
      labelAr: 'الأنشطة المسجلة (اجتماعات ومهام وملاحظات)',
      labelEn: 'Logged Activities',
      current: loggedActivityIdsCurrent.size,
      previous: loggedActivityIdsPrev.size,
    }),
  ];

  const byType = toBreakdown(
    (['in_person', 'video', 'phone', 'chat'] as MeetingType[]).map((key) => ({
      key,
      labelAr: MEETING_TYPE_LABELS[key].ar,
      labelEn: MEETING_TYPE_LABELS[key].en,
      count: meetingTypeCounts[key],
    })),
    nonCancelledMeetingsInPeriod
  );

  const byStatus = toBreakdown(
    (['completed', 'confirmed', 'draft', 'cancelled'] as MeetingStatus[]).map((key) => ({
      key,
      labelAr: MEETING_STATUS_LABELS[key].ar,
      labelEn: MEETING_STATUS_LABELS[key].en,
      count: meetingStatusCounts[key],
    })),
    totalMeetingsInPeriod
  );

  const byMinutesStatus = toBreakdown(
    (['final', 'review', 'draft'] as MinutesStatus[]).map((key) => ({
      key,
      labelAr: MINUTES_STATUS_CONFIG[key].labelAr,
      labelEn: MINUTES_STATUS_CONFIG[key].labelEn,
      count: minutesStatusCounts[key],
    })),
    nonCancelledMeetingsInPeriod
  );

  const byStatusCurrent = toBreakdown(
    (['pending', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((key) => ({
      key,
      labelAr:
        key === 'pending'
          ? 'قيد الانتظار'
          : key === 'in_progress'
          ? 'قيد التنفيذ'
          : key === 'completed'
          ? 'منجزة'
          : 'ملغاة',
      labelEn:
        key === 'pending'
          ? 'Pending'
          : key === 'in_progress'
          ? 'In Progress'
          : key === 'completed'
          ? 'Completed'
          : 'Cancelled',
      count: taskStatusCountsCurrent[key],
    })),
    tasks.length
  );

  const taskPriorityLabels: Record<TaskPriority, { ar: string; en: string }> = {
    urgent: { ar: 'عاجلة', en: 'Urgent' },
    high: { ar: 'عالية', en: 'High' },
    medium: { ar: 'متوسطة', en: 'Medium' },
    low: { ar: 'منخفضة', en: 'Low' },
  };

  const byPriorityOpenCurrent = toBreakdown(
    (['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((key) => ({
      key,
      labelAr: taskPriorityLabels[key].ar,
      labelEn: taskPriorityLabels[key].en,
      count: openPriorityCounts[key],
    })),
    openTasksCurrent
  );

  const byPriorityOverdueCurrent = toBreakdown(
    (['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((key) => ({
      key,
      labelAr: taskPriorityLabels[key].ar,
      labelEn: taskPriorityLabels[key].en,
      count: overduePriorityCounts[key],
    })),
    overdueTasksCurrent
  );

  const byRelationshipStatus = toBreakdown(
    [
      ...(Object.keys(CLIENT_RELATIONSHIP_STATUS_CONFIG) as ClientRelationshipStatus[]).map(
        (key) => ({
          key,
          labelAr: CLIENT_RELATIONSHIP_STATUS_CONFIG[key].labelAr,
          labelEn: CLIENT_RELATIONSHIP_STATUS_CONFIG[key].labelEn,
          count: relStatusCounts.get(key) || 0,
        })
      ),
      ...(relStatusCounts.get('unspecified')
        ? [
            {
              key: 'unspecified',
              labelAr: 'غير محددة',
              labelEn: 'Unspecified',
              count: relStatusCounts.get('unspecified') || 0,
            },
          ]
        : []),
    ],
    clients.length
  );

  const byImportance = toBreakdown(
    [
      ...(Object.keys(CLIENT_IMPORTANCE_CONFIG) as ClientImportanceLevel[]).map((key) => ({
        key,
        labelAr: CLIENT_IMPORTANCE_CONFIG[key].labelAr,
        labelEn: CLIENT_IMPORTANCE_CONFIG[key].labelEn,
        count: importanceCounts.get(key) || 0,
      })),
      ...(importanceCounts.get('unspecified')
        ? [
            {
              key: 'unspecified',
              labelAr: 'غير محددة',
              labelEn: 'Unspecified',
              count: importanceCounts.get('unspecified') || 0,
            },
          ]
        : []),
    ],
    clients.length
  );

  const byCategory = toBreakdown(
    Array.from(categoryCounts.entries())
      .map(([key, count]) => ({
        key,
        labelAr:
          key === 'unspecified'
            ? 'غير مصنف'
            : key in CLIENT_CATEGORY_LABELS
            ? CLIENT_CATEGORY_LABELS[key as keyof typeof CLIENT_CATEGORY_LABELS].ar
            : getClientCategoryLabel(key, 'ar'),
        labelEn:
          key === 'unspecified'
            ? 'Uncategorized'
            : getClientCategoryLabel(key, 'en'),
        count,
      }))
      .sort((a, b) => b.count - a.count),
    clients.length
  );

  const byIndustry = toBreakdown(
    Array.from(industryCounts.entries())
      .map(([key, count]) => ({
        key,
        labelAr: key === 'unspecified' ? 'غير محدد' : key,
        labelEn: key === 'unspecified' ? 'Unspecified' : key,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    clients.length
  );

  // -------------------------------------------------------------------------
  // 6. Deterministic Actionable Insights (Zero AI Fabrication)
  // -------------------------------------------------------------------------
  const insights = generateActionableInsights({
    kpis,
    comparisons,
    meetings: {
      upcomingNext7DaysCount,
    },
    overduePriorityCounts,
    overdueAffectedClients,
    clientsNeedingAttention,
    range,
    isEmptyWorkspace,
  });

  return {
    generatedAtIso: referenceDate.toISOString(),
    timeZone,
    range,
    previousRange,
    completeness,
    kpis,
    comparisons,
    meetings: {
      totalInPeriod: totalMeetingsInPeriod,
      nonCancelledInPeriod: nonCancelledMeetingsInPeriod,
      heldInPeriod: heldMeetingsInPeriod,
      upcomingNext7DaysCount,
      trendSeries,
      byType,
      byStatus,
      byMinutesStatus,
      topTaskLinkedMeetings,
    },
    tasks: {
      totalTasks: tasks.length,
      openCurrentCount: openTasksCurrent,
      overdueCurrentCount: overdueTasksCurrent,
      completedTotalCount: completedTasksTotal,
      completedWithTimestampCount,
      completedWithoutTimestampCount,
      byStatusCurrent,
      byPriorityOpenCurrent,
      byPriorityOverdueCurrent,
      overdueAffectedClients,
      completedTrendSeries: trendSeries,
    },
    clients: {
      mostActiveClients,
      clientsNeedingAttention,
      newClientsInPeriod,
      byRelationshipStatus,
      byImportance,
      byCategory,
      byIndustry,
    },
    insights,
  };
}

// ============================================================================
// Deterministic Rule-Based Insights Generator
// ============================================================================

function generateActionableInsights(params: {
  kpis: AnalyticsKpis;
  comparisons: PeriodComparisonMetric[];
  meetings: { upcomingNext7DaysCount: number };
  overduePriorityCounts: Record<TaskPriority, number>;
  overdueAffectedClients: OverdueClientBreakdown[];
  clientsNeedingAttention: ClientAttentionAnalyticsEntry[];
  range: AnalyticsDateRange;
  isEmptyWorkspace: boolean;
}): ActionableInsight[] {
  const {
    kpis,
    comparisons,
    meetings,
    overduePriorityCounts,
    overdueAffectedClients,
    clientsNeedingAttention,
    range,
    isEmptyWorkspace,
  } = params;

  if (isEmptyWorkspace) return [];

  const insights: ActionableInsight[] = [];

  // 1. Overdue tasks insight (aggregate workload + high/urgent focus)
  if (kpis.overdueTasksCurrent > 0) {
    const highOrUrgent = overduePriorityCounts.urgent + overduePriorityCounts.high;
    const affectedCount = overdueAffectedClients.length;
    insights.push({
      id: 'insight:overdue_tasks',
      severity: highOrUrgent > 0 || kpis.overdueTasksCurrent >= 3 ? 'high' : 'medium',
      titleAr:
        highOrUrgent > 0
          ? `${kpis.overdueTasksCurrent} مهام متأخرة تتضمن ${highOrUrgent} مهام عاجلة أو عالية الأولوية`
          : `${kpis.overdueTasksCurrent} مهام متأخرة عن موعدها النهائي`,
      titleEn:
        highOrUrgent > 0
          ? `${kpis.overdueTasksCurrent} overdue tasks include ${highOrUrgent} urgent/high priority items`
          : `${kpis.overdueTasksCurrent} overdue tasks past due date`,
      descriptionAr:
        affectedCount > 0
          ? `تتوزع الالتزامات المتأخرة حاليًا على ${affectedCount} عملاء. معالجة المهام العاجلة أولًا تقلل تراكم المتابعات.`
          : 'توجد التزامات تجاوزت موعدها النهائي المحدد وتحتاج إلى إغلاق أو إعادة جدولة.',
      descriptionEn:
        affectedCount > 0
          ? `Overdue commitments currently span ${affectedCount} client(s). Resolving urgent items first reduces backlog.`
          : 'Open commitments have passed their due dates and need completion or rescheduling.',
      evidenceAr: `المصدر: ${kpis.overdueTasksCurrent} مهمة مفتوحة بتاريخ استحقاق أقدم من اليوم (${highOrUrgent} عاجلة/عالية).`,
      evidenceEn: `Source: ${kpis.overdueTasksCurrent} open tasks with dueDate < today (${highOrUrgent} urgent/high).`,
      actionLabelAr: 'مراجعة المهام المتأخرة',
      actionLabelEn: 'Review overdue tasks',
      drillDown: { tab: 'tasks', scope: 'overdue' },
      provenance: 'source',
    });
  }

  // 2. Clients needing follow-up insight
  const followUpClients = clientsNeedingAttention.filter(
    (c) =>
      c.overdueTasksCount > 0 ||
      c.client.relationshipStatus === 'follow_up_needed' ||
      (c.daysSinceLastContact !== null && c.daysSinceLastContact >= STALE_CONTACT_THRESHOLD_DAYS)
  );
  if (followUpClients.length > 0) {
    const topClient = followUpClients[0];
    insights.push({
      id: 'insight:clients_follow_up',
      severity: followUpClients.some((c) => c.severity === 'high') ? 'high' : 'medium',
      titleAr: `${followUpClients.length} عملاء لديهم إشارات حاجة إلى متابعة`,
      titleEn: `${followUpClients.length} client(s) show follow-up signals`,
      descriptionAr: `يتصدرهم «${topClient.client.name}» (${topClient.reasonsAr.slice(0, 2).join('، ')}). استند التحديد إلى الأنشطة المسجلة داخل التطبيق فقط.`,
      descriptionEn: `Led by "${topClient.client.name}" (${topClient.reasonsEn.slice(0, 2).join(', ')}). Based strictly on activities logged inside Murafiq.`,
      evidenceAr: `المصدر: مهام متأخرة أو حالة «يحتاج متابعة» أو غياب تواصل مسجل >= ${STALE_CONTACT_THRESHOLD_DAYS} يومًا.`,
      evidenceEn: `Source: Overdue tasks, follow_up_needed status, or >= ${STALE_CONTACT_THRESHOLD_DAYS}d since logged contact.`,
      actionLabelAr: 'عرض العملاء المحتاجين للمتابعة',
      actionLabelEn: 'View follow-up clients',
      drillDown: { tab: 'clients', quickFilter: 'needs_follow_up' },
      provenance: 'source',
    });
  }

  // 3. Significant drop in held meetings vs equal previous period (requires meaningful baseline >= 2)
  const heldComp = comparisons.find((c) => c.key === 'heldMeetings');
  if (
    heldComp &&
    heldComp.previous >= 2 &&
    heldComp.delta <= -1 &&
    heldComp.percentChange !== null &&
    heldComp.percentChange <= -25
  ) {
    insights.push({
      id: 'insight:held_meetings_drop',
      severity: 'medium',
      titleAr: `انخفاض الاجتماعات المنعقدة بنسبة ${Math.abs(heldComp.percentChange)}% مقارنة بالفترة السابقة`,
      titleEn: `Held meetings dropped by ${Math.abs(heldComp.percentChange)}% vs previous period`,
      descriptionAr: `انخفضت الاجتماعات ذات الحالة «منتهية» من ${heldComp.previous} إلى ${heldComp.current} خلال ${range.labelAr}. قد يشير ذلك إلى اجتماعات مؤجلة أو لم تُحدَّث حالتها بعد.`,
      descriptionEn: `Completed meetings moved from ${heldComp.previous} to ${heldComp.current} during ${range.labelEn}.`,
      evidenceAr: `المصدر: مقارنة ${range.startKey}..${range.endKey} مع الفترة السابقة المماثلة (${heldComp.previous} ← ${heldComp.current}).`,
      evidenceEn: `Source: ${range.startKey}..${range.endKey} vs prior equal range (${heldComp.previous} -> ${heldComp.current}).`,
      actionLabelAr: 'مراجعة سجل اللقاءات',
      actionLabelEn: 'Review meetings',
      drillDown: { tab: 'meetings', status: 'all' },
      provenance: 'source',
    });
  }

  // 4. Upcoming 7-day scheduled meetings preparation insight
  if (meetings.upcomingNext7DaysCount > 0) {
    insights.push({
      id: 'insight:upcoming_7d_meetings',
      severity: 'info',
      titleAr: `${meetings.upcomingNext7DaysCount} اجتماعات قادمة مجدولة خلال الأيام السبعة المقبلة`,
      titleEn: `${meetings.upcomingNext7DaysCount} meeting(s) scheduled over the next 7 days`,
      descriptionAr: 'تأكد من مراجعة جدول الأعمال والمهام المفتوحة للعملاء قبل انعقاد الاجتماعات القادمة.',
      descriptionEn: 'Review agendas and open client tasks ahead of upcoming scheduled meetings.',
      evidenceAr: `المصدر: اجتماعات غير ملغاة وغير منتهية بتاريخ خلال 7 أيام قادمة.`,
      evidenceEn: 'Source: Active non-cancelled meetings scheduled in the next 7 days.',
      actionLabelAr: 'فتح اللقاءات القادمة',
      actionLabelEn: 'Open upcoming meetings',
      drillDown: { tab: 'meetings', upcomingOnly: true },
      provenance: 'source',
    });
  }

  // 5. Transparency insight when legacy completed tasks lack completedAt
  if (kpis.completedWithoutTimestampCount > 0) {
    insights.push({
      id: 'insight:missing_completed_at',
      severity: 'info',
      titleAr: `${kpis.completedWithoutTimestampCount} مهام منجزة بدون تاريخ إنجاز موثق`,
      titleEn: `${kpis.completedWithoutTimestampCount} completed task(s) lack a completion timestamp`,
      descriptionAr: 'تُحسب هذه المهام ضمن إجمالي المنجز ومعدل إنجاز دفعة الفترة، لكنها لا تُدرج في منحنى الإنجاز الزمني دون تخمين تاريخها.',
      descriptionEn: 'Counted in overall completed totals, but excluded from dated completion trends without guessing timestamps.',
      evidenceAr: `المصدر: مهام بحالة "completed" بدون حقل completedAt صالح.`,
      evidenceEn: 'Source: Tasks with status="completed" missing valid completedAt.',
      actionLabelAr: 'استعراض المهام',
      actionLabelEn: 'View tasks',
      drillDown: { tab: 'tasks', scope: 'completed' },
      provenance: 'source',
    });
  }

  return insights;
}

// ============================================================================
// Safe CSV Export (Formula Injection Sanitized, Zero Secrets/B2 URLs)
// ============================================================================

const FORMULA_PREFIX_REGEX = /^[\s]*[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value).replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (FORMULA_PREFIX_REGEX.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(',');
}

export function buildAnalyticsSummaryCsv(
  snapshot: AnalyticsReportSnapshot,
  language: 'ar' | 'en' = 'ar'
): string {
  const isAr = language === 'ar';
  const rows: string[] = [];

  rows.push(
    csvRow([
      isAr ? 'القسم' : 'Section',
      isAr ? 'المؤشر / البند' : 'Metric / Item',
      isAr ? 'القيمة' : 'Value',
      isAr ? 'النطاق / التفاصيل' : 'Scope / Details',
    ])
  );

  rows.push(
    csvRow([
      isAr ? 'بيانات التقرير' : 'Metadata',
      isAr ? 'الفترة المختارة' : 'Selected Range',
      `${snapshot.range.startKey} .. ${snapshot.range.endKey}`,
      isAr ? snapshot.range.labelAr : snapshot.range.labelEn,
    ])
  );
  rows.push(
    csvRow([
      isAr ? 'بيانات التقرير' : 'Metadata',
      isAr ? 'وقت التوليد' : 'Generated At',
      snapshot.generatedAtIso,
      snapshot.timeZone,
    ])
  );

  const kpiRows: [string, string, number | string, string][] = [
    [
      isAr ? 'العملاء' : 'Clients',
      isAr ? 'إجمالي العملاء' : 'Total Clients',
      snapshot.kpis.totalClients,
      isAr ? 'تراكمي' : 'Cumulative',
    ],
    [
      isAr ? 'العملاء' : 'Clients',
      isAr ? 'العملاء المضافون خلال الفترة' : 'New Clients in Period',
      snapshot.kpis.newClientsInPeriod,
      snapshot.range.labelAr,
    ],
    [
      isAr ? 'العملاء' : 'Clients',
      isAr ? 'العملاء الذين سُجلت معهم اجتماعات' : 'Clients with Meetings',
      snapshot.kpis.clientsWithMeetingsInPeriod,
      snapshot.range.labelAr,
    ],
    [
      isAr ? 'العملاء' : 'Clients',
      isAr ? 'العملاء الذين يحتاجون إلى متابعة' : 'Clients Needing Follow-up',
      snapshot.kpis.clientsNeedingFollowUp,
      isAr ? 'تراكمي' : 'Cumulative',
    ],
    [
      isAr ? 'الاجتماعات' : 'Meetings',
      isAr ? 'الاجتماعات المنعقدة خلال الفترة' : 'Held Meetings in Period',
      snapshot.kpis.heldMeetingsInPeriod,
      snapshot.range.labelAr,
    ],
    [
      isAr ? 'الاجتماعات' : 'Meetings',
      isAr ? 'الاجتماعات القادمة' : 'Upcoming Meetings',
      snapshot.kpis.upcomingMeetings,
      isAr ? 'تراكمي' : 'Cumulative',
    ],
    [
      isAr ? 'الاجتماعات' : 'Meetings',
      isAr ? 'الاجتماعات الملغاة خلال الفترة' : 'Cancelled Meetings in Period',
      snapshot.kpis.cancelledMeetingsInPeriod,
      `${isAr ? 'إجمالي الملغاة' : 'All-time cancelled'}: ${snapshot.kpis.cancelledMeetingsTotal}`,
    ],
    [
      isAr ? 'الاجتماعات' : 'Meetings',
      isAr ? 'متوسط الاجتماعات أسبوعيًا' : 'Avg Held Meetings / Week',
      snapshot.kpis.avgMeetingsPerWeek,
      snapshot.range.labelAr,
    ],
    [
      isAr ? 'المهام' : 'Tasks',
      isAr ? 'المهام المُنشأة خلال الفترة' : 'Tasks Created in Period',
      snapshot.kpis.tasksCreatedInPeriod,
      snapshot.range.labelAr,
    ],
    [
      isAr ? 'المهام' : 'Tasks',
      isAr ? 'المهام المنجزة خلال الفترة' : 'Tasks Completed in Period',
      snapshot.kpis.tasksCompletedInPeriod,
      isAr ? 'باستخدام completedAt الموثق فقط' : 'Verified completedAt only',
    ],
    [
      isAr ? 'المهام' : 'Tasks',
      isAr ? 'المهام المفتوحة حاليًا' : 'Currently Open Tasks',
      snapshot.kpis.openTasksCurrent,
      isAr ? 'تراكمي' : 'Cumulative',
    ],
    [
      isAr ? 'المهام' : 'Tasks',
      isAr ? 'المهام المتأخرة حاليًا' : 'Currently Overdue Tasks',
      snapshot.kpis.overdueTasksCurrent,
      isAr ? 'تراكمي' : 'Cumulative',
    ],
    [
      isAr ? 'المهام' : 'Tasks',
      isAr ? 'معدل إنجاز دفعة الفترة' : 'Cohort Task Completion Rate',
      snapshot.kpis.taskCompletionRateInPeriod === null
        ? isAr
          ? 'غير متاح (0 مهام)'
          : 'N/A (0 tasks)'
        : `${snapshot.kpis.taskCompletionRateInPeriod}%`,
      `${snapshot.kpis.cohortTasksCurrentlyCompletedCount} / ${snapshot.kpis.cohortTasksCreatedCount}`,
    ],
  ];

  for (const r of kpiRows) {
    rows.push(csvRow(r));
  }

  for (const comp of snapshot.comparisons) {
    rows.push(
      csvRow([
        isAr ? 'مقارنة الفترات' : 'Period Comparison',
        isAr ? comp.labelAr : comp.labelEn,
        `${comp.current} (${isAr ? 'السابق' : 'Prev'}: ${comp.previous})`,
        comp.hasValidBase
          ? `${comp.percentChange! > 0 ? '+' : ''}${comp.percentChange}%`
          : isAr
          ? comp.noBaseMessageAr
          : comp.noBaseMessageEn,
      ])
    );
  }

  for (const item of snapshot.meetings.byType) {
    rows.push(
      csvRow([
        isAr ? 'توزيع نوع الاجتماع' : 'Meeting Type',
        isAr ? item.labelAr : item.labelEn,
        item.count,
        `${item.sharePercent}%`,
      ])
    );
  }

  for (const item of snapshot.tasks.byPriorityOpenCurrent) {
    rows.push(
      csvRow([
        isAr ? 'أولوية المهام المفتوحة' : 'Open Task Priority',
        isAr ? item.labelAr : item.labelEn,
        item.count,
        `${item.sharePercent}%`,
      ])
    );
  }

  for (const insight of snapshot.insights) {
    rows.push(
      csvRow([
        isAr ? 'رؤى تستحق انتباهك' : 'Actionable Insights',
        isAr ? insight.titleAr : insight.titleEn,
        insight.severity,
        isAr ? insight.evidenceAr : insight.evidenceEn,
      ])
    );
  }

  return `\uFEFF${rows.join('\n')}`;
}
