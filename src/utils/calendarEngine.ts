import type {
  ActionItem,
  CalendarActivityType,
  CalendarConflictPair,
  CalendarDayCell,
  CalendarDefaultBlockMinutes,
  CalendarEventItem,
  CalendarFilterScope,
  CalendarSettings,
  CalendarTimeFormat,
  CalendarViewMode,
  CalendarWeekStartDay,
  Client,
  CommunicationInteraction,
  DayAvailableGap,
  Meeting,
  Opportunity,
  PlaybookRun,
  WeeklyPlanSummary,
} from '../types/index.ts';
import {
  type CalendarDateParts,
  addCalendarDays,
  buildZonedDate,
  extractZonedCalendarParts,
  extractZonedHour,
  formatCalendarDateKey,
  parseDateOnlyString,
  parseMeetingDateTimeMs,
  resolveCalendarParts,
} from './followUpEngine.ts';
import { isMinutesLocked, MEETING_STATUS_LABELS } from './meetingMinutes.ts';
import { isOpportunityClosed, OPPORTUNITY_STAGE_CONFIG } from './opportunities.ts';
import {
  COMMUNICATION_CHANNEL_META,
  findLinkedTaskForInteraction,
  isInteractionFollowUpPending,
} from './communications.ts';

export const CALENDAR_SETTINGS_STORAGE_PREFIX = 'murafiq_calendar_settings_v1_';

export const AVAILABLE_SLOTS_DISCLOSURE_AR =
  'الأوقات المتاحة المعروضة تستند فقط إلى الاجتماعات وفترات العمل المجدولة داخل تطبيق «مُرافق»، ولا تعكس أي التزامات خارجية غير مسجلة.';

export const MEETING_RESCHEDULE_DISCLOSURE_AR =
  'يتم تحديث موعد الاجتماع داخل سجلات «مُرافق» فقط؛ لا يرسل التطبيق دعوات بريدية أو تقويمية خارجية للمشاركين تلقائياً.';

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  weekStartDay: 6, // السبت افتراضياً
  timeFormat: '12h',
  defaultBlockMinutes: 60,
  showMeetings: true,
  showTasks: true,
  showFollowUps: true,
  showOpportunities: true,
  showPlaybooks: true,
  showCancelledMeetings: false,
  workingDayStartHour: 8,
  workingDayEndHour: 18,
};

const VALID_WEEK_START_DAYS: CalendarWeekStartDay[] = [6, 0, 1];
const VALID_TIME_FORMATS: CalendarTimeFormat[] = ['12h', '24h'];
const VALID_BLOCK_MINUTES: CalendarDefaultBlockMinutes[] = [30, 45, 60, 90, 120];

const DAY_NAMES_SHORT_AR: Record<number, string> = {
  0: 'أحد',
  1: 'إثنين',
  2: 'ثلاثاء',
  3: 'أربعاء',
  4: 'خميس',
  5: 'جمعة',
  6: 'سبت',
};

const DAY_NAMES_FULL_AR: Record<number, string> = {
  0: 'الأحد',
  1: 'الإثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
  5: 'الجمعة',
  6: 'السبت',
};

const MONTH_NAMES_AR: Record<number, string> = {
  1: 'يناير',
  2: 'فبراير',
  3: 'مارس',
  4: 'أبريل',
  5: 'مايو',
  6: 'يونيو',
  7: 'يوليو',
  8: 'أغسطس',
  9: 'سبتمبر',
  10: 'أكتوبر',
  11: 'نوفمبر',
  12: 'ديسمبر',
};

export const ACTIVITY_TYPE_META: Record<
  CalendarActivityType,
  {
    labelAr: string;
    labelEn: string;
    badgeClass: string;
    borderClass: string;
    dotClass: string;
  }
> = {
  meeting: {
    labelAr: 'اجتماع',
    labelEn: 'Meeting',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    borderClass: 'border-r-4 border-r-emerald-600',
    dotClass: 'bg-emerald-600',
  },
  task_block: {
    labelAr: 'وقت عمل مهمة',
    labelEn: 'Task Time Block',
    badgeClass: 'bg-sky-50 text-sky-900 border-sky-300',
    borderClass: 'border-r-4 border-r-sky-600',
    dotClass: 'bg-sky-600',
  },
  task_due: {
    labelAr: 'استحقاق مهمة',
    labelEn: 'Task Due Date',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
    borderClass: 'border-r-4 border-r-amber-500',
    dotClass: 'bg-amber-500',
  },
  follow_up: {
    labelAr: 'موعد متابعة',
    labelEn: 'Follow-Up',
    badgeClass: 'bg-violet-50 text-violet-900 border-violet-300',
    borderClass: 'border-r-4 border-r-violet-600',
    dotClass: 'bg-violet-600',
  },
  opportunity_action: {
    labelAr: 'إجراء فرصة أعمال',
    labelEn: 'Opportunity Next Action',
    badgeClass: 'bg-teal-50 text-teal-900 border-teal-300',
    borderClass: 'border-r-4 border-r-teal-600',
    dotClass: 'bg-teal-600',
  },
  opportunity_close: {
    labelAr: 'إغلاق متوقع (تقديري)',
    labelEn: 'Expected Close (Estimate)',
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-300',
    borderClass: 'border-r-4 border-r-stone-500',
    dotClass: 'bg-stone-500',
  },
  playbook_step: {
    labelAr: 'خطوة خطة متابعة',
    labelEn: 'Playbook Step',
    badgeClass: 'bg-indigo-50 text-indigo-900 border-indigo-300',
    borderClass: 'border-r-4 border-r-indigo-600',
    dotClass: 'bg-indigo-600',
  },
};

export function normalizeCalendarSettings(
  raw?: Partial<CalendarSettings> | null
): CalendarSettings {
  const weekStartDay = VALID_WEEK_START_DAYS.includes(raw?.weekStartDay as CalendarWeekStartDay)
    ? (raw!.weekStartDay as CalendarWeekStartDay)
    : DEFAULT_CALENDAR_SETTINGS.weekStartDay;

  const timeFormat = VALID_TIME_FORMATS.includes(raw?.timeFormat as CalendarTimeFormat)
    ? (raw!.timeFormat as CalendarTimeFormat)
    : DEFAULT_CALENDAR_SETTINGS.timeFormat;

  const defaultBlockMinutes = VALID_BLOCK_MINUTES.includes(
    raw?.defaultBlockMinutes as CalendarDefaultBlockMinutes
  )
    ? (raw!.defaultBlockMinutes as CalendarDefaultBlockMinutes)
    : DEFAULT_CALENDAR_SETTINGS.defaultBlockMinutes;

  const startHour =
    typeof raw?.workingDayStartHour === 'number' &&
    Number.isFinite(raw.workingDayStartHour) &&
    raw.workingDayStartHour >= 0 &&
    raw.workingDayStartHour <= 12
      ? Math.round(raw.workingDayStartHour)
      : DEFAULT_CALENDAR_SETTINGS.workingDayStartHour;

  const endHour =
    typeof raw?.workingDayEndHour === 'number' &&
    Number.isFinite(raw.workingDayEndHour) &&
    raw.workingDayEndHour > startHour &&
    raw.workingDayEndHour <= 23
      ? Math.round(raw.workingDayEndHour)
      : DEFAULT_CALENDAR_SETTINGS.workingDayEndHour;

  return {
    weekStartDay,
    timeFormat,
    defaultBlockMinutes,
    showMeetings:
      typeof raw?.showMeetings === 'boolean'
        ? raw.showMeetings
        : DEFAULT_CALENDAR_SETTINGS.showMeetings,
    showTasks:
      typeof raw?.showTasks === 'boolean' ? raw.showTasks : DEFAULT_CALENDAR_SETTINGS.showTasks,
    showFollowUps:
      typeof raw?.showFollowUps === 'boolean'
        ? raw.showFollowUps
        : DEFAULT_CALENDAR_SETTINGS.showFollowUps,
    showOpportunities:
      typeof raw?.showOpportunities === 'boolean'
        ? raw.showOpportunities
        : DEFAULT_CALENDAR_SETTINGS.showOpportunities,
    showPlaybooks:
      typeof raw?.showPlaybooks === 'boolean'
        ? raw.showPlaybooks
        : DEFAULT_CALENDAR_SETTINGS.showPlaybooks,
    showCancelledMeetings:
      typeof raw?.showCancelledMeetings === 'boolean'
        ? raw.showCancelledMeetings
        : DEFAULT_CALENDAR_SETTINGS.showCancelledMeetings,
    workingDayStartHour: startHour,
    workingDayEndHour: endHour,
  };
}

let inMemorySettingsByUser: Record<string, CalendarSettings> = {};

export function loadUserCalendarSettings(userId?: string | null): CalendarSettings {
  const key = `${CALENDAR_SETTINGS_STORAGE_PREFIX}${userId || 'anon'}`;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        return normalizeCalendarSettings(JSON.parse(raw));
      }
    }
  } catch {
    // Fallback to memory
  }
  return inMemorySettingsByUser[key] || { ...DEFAULT_CALENDAR_SETTINGS };
}

export function saveUserCalendarSettings(
  userId: string | null | undefined,
  settings: Partial<CalendarSettings>
): CalendarSettings {
  const key = `${CALENDAR_SETTINGS_STORAGE_PREFIX}${userId || 'anon'}`;
  const normalized = normalizeCalendarSettings(settings);
  inMemorySettingsByUser[key] = normalized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(normalized));
    }
  } catch {
    // Ignore storage quota errors
  }
  return normalized;
}

/**
 * Resolves the runtime's local IANA timezone without hardcoding Asia/Amman.
 */
export function getLocalTimeZoneName(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string' && tz.trim().length > 0) {
      return tz.trim();
    }
  } catch {
    // Fallback
  }
  return 'UTC';
}

export function extractZonedHourAndMinute(
  date: Date,
  timeZone?: string
): { hour: number; minute: number } {
  if (timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value);
      const minuteRaw = Number(parts.find((p) => p.type === 'minute')?.value);
      if (Number.isFinite(hourRaw) && Number.isFinite(minuteRaw)) {
        return {
          hour: hourRaw % 24,
          minute: minuteRaw,
        };
      }
    } catch {
      // Fallback
    }
  }
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

export function formatHourMinuteLabel(
  hour: number,
  minute: number,
  timeFormat: CalendarTimeFormat = '12h',
  language: 'ar' | 'en' = 'ar'
): string {
  const h = ((hour % 24) + 24) % 24;
  const mStr = String(minute).padStart(2, '0');
  if (timeFormat === '24h') {
    return `${String(h).padStart(2, '0')}:${mStr}`;
  }
  const period = h >= 12 ? (language === 'ar' ? 'م' : 'PM') : language === 'ar' ? 'ص' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
}

export function formatTimeInZone(
  input: string | Date,
  timeFormat: CalendarTimeFormat = '12h',
  timeZone?: string,
  language: 'ar' | 'en' = 'ar'
): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    // If naive local YYYY-MM-DDTHH:MM string without offset, respect literal HH:MM when no timeZone override
    const naiveMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
    if (naiveMatch && !timeZone && !trimmed.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(trimmed)) {
      return formatHourMinuteLabel(Number(naiveMatch[1]), Number(naiveMatch[2]), timeFormat, language);
    }
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const { hour, minute } = extractZonedHourAndMinute(d, timeZone);
  return formatHourMinuteLabel(hour, minute, timeFormat, language);
}

/**
 * Formats an ISO or naive datetime string into a local `YYYY-MM-DDTHH:mm` value
 * suitable for `<input type="datetime-local" />` without UTC offset shift.
 */
export function formatIsoToDateTimeLocalInput(
  input?: string | null,
  timeZone?: string
): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const naiveMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (naiveMatch && !timeZone && !trimmed.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return naiveMatch[1];
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return '';
  const parts = extractZonedCalendarParts(d, timeZone);
  const { hour, minute } = extractZonedHourAndMinute(d, timeZone);
  const dateKey = formatCalendarDateKey(parts);
  return `${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Builds validated ISO start and end timestamps from a calendar date (`YYYY-MM-DD`),
 * start time (`HH:mm`), and duration in minutes.
 */
export function buildTimeBlockFromDateAndTime(params: {
  dateKey: string;
  startTimeHHMM: string;
  durationMinutes: number;
  timeZone?: string;
}): { ok: boolean; scheduledStartAt?: string; scheduledEndAt?: string; errorAr?: string } {
  const parts = parseDateOnlyString(params.dateKey);
  if (!parts) {
    return { ok: false, errorAr: 'يرجى تحديد تاريخ صحيح لوقت العمل المخطط.' };
  }
  const timeMatch = (params.startTimeHHMM || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return { ok: false, errorAr: 'يرجى تحديد وقت بدء صحيح (ساعة:دقيقة).' };
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return { ok: false, errorAr: 'وقت البدء المحدد خارج النطاق المسموح.' };
  }
  if (!Number.isFinite(params.durationMinutes) || params.durationMinutes < 5 || params.durationMinutes > 1440) {
    return { ok: false, errorAr: 'مدة العمل المخططة يجب أن تكون بين 5 دقائق و24 ساعة.' };
  }
  const startDate = buildZonedDate(parts, hour, minute, params.timeZone);
  const endDate = new Date(startDate.getTime() + Math.round(params.durationMinutes) * 60000);
  return {
    ok: true,
    scheduledStartAt: startDate.toISOString(),
    scheduledEndAt: endDate.toISOString(),
  };
}

export function formatMonthYearHeaderAr(parts: CalendarDateParts): string {
  return `${MONTH_NAMES_AR[parts.month] || ''} ${parts.year}`;
}

export function formatDayHeaderAr(dateKey: string): string {
  const parts = parseDateOnlyString(dateKey);
  if (!parts) return dateKey;
  const dow = getDayOfWeekForParts(parts);
  return `${DAY_NAMES_FULL_AR[dow]}، ${parts.day} ${MONTH_NAMES_AR[parts.month]} ${parts.year}`;
}

export function getDayOfWeekForParts(parts: CalendarDateParts): number {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return utc.getUTCDay(); // 0 = Sun ... 6 = Sat
}

export function getOrderedWeekDaysMeta(
  weekStartDay: CalendarWeekStartDay = 6
): Array<{ dayOfWeek: number; shortAr: string; fullAr: string }> {
  const result: Array<{ dayOfWeek: number; shortAr: string; fullAr: string }> = [];
  for (let i = 0; i < 7; i++) {
    const dow = (weekStartDay + i) % 7;
    result.push({
      dayOfWeek: dow,
      shortAr: DAY_NAMES_SHORT_AR[dow],
      fullAr: DAY_NAMES_FULL_AR[dow],
    });
  }
  return result;
}

export function getWeekStartDateParts(
  parts: CalendarDateParts,
  weekStartDay: CalendarWeekStartDay = 6
): CalendarDateParts {
  const currentDow = getDayOfWeekForParts(parts);
  const offset = (currentDow - weekStartDay + 7) % 7;
  return addCalendarDays(parts, -offset);
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function navigateCalendarDate(
  anchorDateKey: string,
  mode: CalendarViewMode,
  direction: 'prev' | 'next'
): string {
  const parts = parseDateOnlyString(anchorDateKey);
  if (!parts) return anchorDateKey;
  const delta = direction === 'next' ? 1 : -1;

  if (mode === 'day') {
    return formatCalendarDateKey(addCalendarDays(parts, delta));
  }

  if (mode === 'week' || mode === 'planner') {
    return formatCalendarDateKey(addCalendarDays(parts, delta * 7));
  }

  // Monthly navigation: clamp day to target month's max days
  let targetYear = parts.year;
  let targetMonth = parts.month + delta;
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear += 1;
  } else if (targetMonth < 1) {
    targetMonth = 12;
    targetYear -= 1;
  }
  const maxDay = getDaysInMonth(targetYear, targetMonth);
  return formatCalendarDateKey({
    year: targetYear,
    month: targetMonth,
    day: Math.min(parts.day, maxDay),
  });
}

// =========================================================================
// Task Time Block Validation, Mutation & Firestore Wire Encoding
// =========================================================================

export interface TimeBlockValidationResult {
  valid: boolean;
  startMs?: number;
  endMs?: number;
  startIso?: string;
  endIso?: string;
  durationMinutes?: number;
  errorAr?: string;
}

export function validateTimeBlockInterval(
  scheduledStartAt?: string | null,
  scheduledEndAt?: string | null
): TimeBlockValidationResult {
  if (!scheduledStartAt || !scheduledEndAt) {
    return {
      valid: false,
      errorAr: 'يرجى تحديد وقت البدء ووقت الانتهاء لجدولة العمل على المهمة.',
    };
  }
  const startMs = parseMeetingDateTimeMs(scheduledStartAt);
  const endMs = parseMeetingDateTimeMs(scheduledEndAt);
  if (startMs === null || endMs === null) {
    return {
      valid: false,
      errorAr: 'صيغة التاريخ أو الوقت المحددة لجدولة المهمة غير صالحة.',
    };
  }
  if (endMs <= startMs) {
    return {
      valid: false,
      errorAr: 'يجب أن يكون وقت انتهاء العمل المخطط بعد وقت البدء.',
    };
  }
  const durationMinutes = Math.round((endMs - startMs) / 60000);
  if (durationMinutes < 5) {
    return {
      valid: false,
      errorAr: 'يجب ألا تقل فترة العمل المخططة عن 5 دقائق.',
    };
  }
  if (durationMinutes > 24 * 60) {
    return {
      valid: false,
      errorAr: 'لا يمكن أن تتجاوز فترة العمل الواحدة 24 ساعة.',
    };
  }
  return {
    valid: true,
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    durationMinutes,
  };
}

const LEGACY_TIME_BLOCK_TOKEN_REGEX = /^(?:(.*?)#)?tb:(\d{8,12}):(\d{8,12})$/;

function extractCleanReminderDate(rawReminder?: string | null): string | undefined {
  if (typeof rawReminder !== 'string') return undefined;
  const trimmed = rawReminder.trim();
  if (!trimmed) return undefined;
  const legacyMatch = trimmed.match(LEGACY_TIME_BLOCK_TOKEN_REGEX);
  if (legacyMatch) {
    const baseReminder = (legacyMatch[1] || '').trim();
    return baseReminder ? baseReminder.slice(0, 50) : undefined;
  }
  return trimmed.slice(0, 50);
}

/**
 * Assigns or updates a Time Block on a task WITHOUT modifying its dueDate, reminderDate, or status,
 * and without creating a duplicate task.
 */
export function assignTaskTimeBlock(
  task: ActionItem,
  scheduledStartAt: string,
  scheduledEndAt: string
): { ok: boolean; task?: ActionItem; errorAr?: string } {
  const check = validateTimeBlockInterval(scheduledStartAt, scheduledEndAt);
  if (!check.valid || !check.startIso || !check.endIso) {
    return { ok: false, errorAr: check.errorAr };
  }
  const cleanReminder = extractCleanReminderDate(task.reminderDate);
  const nextTask: ActionItem = {
    ...task,
    // Preserve dueDate, reminderDate, and status strictly as-is
    dueDate: task.dueDate,
    status: task.status,
    scheduledStartAt: check.startIso,
    scheduledEndAt: check.endIso,
  };
  if (cleanReminder !== undefined) {
    nextTask.reminderDate = cleanReminder;
  } else {
    delete nextTask.reminderDate;
  }
  return {
    ok: true,
    task: nextTask,
  };
}

/**
 * Clears the planned Time Block from a task without deleting the task or altering its dueDate, reminderDate, or status.
 */
export function clearTaskTimeBlock(task: ActionItem): ActionItem {
  const cleanReminder = extractCleanReminderDate(task.reminderDate);
  const next: ActionItem = {
    ...task,
    dueDate: task.dueDate,
    status: task.status,
  };
  if (cleanReminder !== undefined) {
    next.reminderDate = cleanReminder;
  } else {
    delete next.reminderDate;
  }
  delete next.scheduledStartAt;
  delete next.scheduledEndAt;
  return next;
}

/**
 * Prepares a task document for Firestore persistence:
 * - Stores `scheduledStartAt` and `scheduledEndAt` as independent fields on the Task document.
 * - Keeps `reminderDate` completely independent and dedicated exclusively to reminders.
 * - Never encodes Time Blocking inside `reminderDate`.
 * - If an older legacy record still carried a `tb:...` token in `reminderDate`, normalizes it into
 *   independent `scheduledStartAt` / `scheduledEndAt` fields and restores the clean `reminderDate`.
 */
export function sanitizeTaskForFirestoreSave(task: ActionItem): ActionItem {
  const clone: ActionItem = { ...task };

  let legacyStartIso: string | undefined;
  let legacyEndIso: string | undefined;

  if (typeof clone.reminderDate === 'string') {
    const trimmedReminder = clone.reminderDate.trim();
    const legacyMatch = trimmedReminder.match(LEGACY_TIME_BLOCK_TOKEN_REGEX);
    if (legacyMatch) {
      const baseReminder = (legacyMatch[1] || '').trim();
      const startMs = Number(legacyMatch[2]) * 1000;
      const endMs = Number(legacyMatch[3]) * 1000;
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        legacyStartIso = new Date(startMs).toISOString();
        legacyEndIso = new Date(endMs).toISOString();
      }
      if (baseReminder) {
        clone.reminderDate = baseReminder.slice(0, 50);
      } else {
        delete clone.reminderDate;
      }
    } else if (trimmedReminder) {
      clone.reminderDate = trimmedReminder.slice(0, 50);
    } else {
      delete clone.reminderDate;
    }
  } else {
    delete clone.reminderDate;
  }

  const candidateStart = clone.scheduledStartAt || legacyStartIso;
  const candidateEnd = clone.scheduledEndAt || legacyEndIso;

  if (candidateStart && candidateEnd) {
    const check = validateTimeBlockInterval(candidateStart, candidateEnd);
    if (check.valid && check.startIso && check.endIso) {
      clone.scheduledStartAt = check.startIso.slice(0, 50);
      clone.scheduledEndAt = check.endIso.slice(0, 50);
    } else {
      delete clone.scheduledStartAt;
      delete clone.scheduledEndAt;
    }
  } else {
    delete clone.scheduledStartAt;
    delete clone.scheduledEndAt;
  }

  if (typeof clone.playbookRunId === 'string' && clone.playbookRunId.trim()) {
    clone.playbookRunId = clone.playbookRunId.trim().slice(0, 128);
  } else {
    delete clone.playbookRunId;
  }

  if (typeof clone.playbookStepId === 'string' && clone.playbookStepId.trim()) {
    clone.playbookStepId = clone.playbookStepId.trim().slice(0, 128);
  } else {
    delete clone.playbookStepId;
  }

  return clone;
}

/**
 * Read-only hydration helper for tasks loaded from Firestore:
 * 1. Reads independent `scheduledStartAt` and `scheduledEndAt` fields directly.
 * 2. Preserves read-only backward compatibility for legacy records that encoded `tb:<startSec>:<endSec>`
 *    inside `reminderDate`, extracting the time block and restoring the clean `reminderDate`.
 */
export function decodeTaskTimeBlockFromFirestore(raw: Record<string, any>): ActionItem {
  const result: ActionItem = { ...(raw as ActionItem) };

  // 1. Read independent top-level scheduledStartAt / scheduledEndAt fields directly
  if (typeof raw.scheduledStartAt === 'string' && typeof raw.scheduledEndAt === 'string') {
    const check = validateTimeBlockInterval(raw.scheduledStartAt, raw.scheduledEndAt);
    if (check.valid && check.startIso && check.endIso) {
      result.scheduledStartAt = check.startIso;
      result.scheduledEndAt = check.endIso;
    } else {
      delete result.scheduledStartAt;
      delete result.scheduledEndAt;
    }
  } else {
    delete result.scheduledStartAt;
    delete result.scheduledEndAt;
  }

  // 2. Read-only backward compatibility for legacy records that carried a wire token in reminderDate
  if (typeof raw.reminderDate === 'string') {
    const match = raw.reminderDate.trim().match(LEGACY_TIME_BLOCK_TOKEN_REGEX);
    if (match) {
      const baseReminder = (match[1] || '').trim() || undefined;
      const startMs = Number(match[2]) * 1000;
      const endMs = Number(match[3]) * 1000;
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        if (!result.scheduledStartAt || !result.scheduledEndAt) {
          result.scheduledStartAt = new Date(startMs).toISOString();
          result.scheduledEndAt = new Date(endMs).toISOString();
        }
      }
      if (baseReminder) {
        result.reminderDate = baseReminder;
      } else {
        delete result.reminderDate;
      }
    }
  }

  return result;
}

// =========================================================================
// Safe Meeting Rescheduling with Final Minutes & Cancelled Guards
// =========================================================================

export interface MeetingRescheduleResult {
  ok: boolean;
  code?: 'CANCELLED_MEETING' | 'FINAL_MINUTES_LOCKED' | 'INVALID_DATETIME' | 'INVALID_DURATION';
  requiresReopenConfirmation?: boolean;
  errorAr?: string;
  meeting?: Meeting;
  previousDateTime?: string;
  newDateTime?: string;
  previousDuration?: number;
  newDuration?: number;
  honestDisclosureAr: string;
}

export function applyMeetingReschedule(params: {
  meeting: Meeting;
  newDateTime: string;
  newDurationMinutes?: number;
  confirmReopenFinalMinutes?: boolean;
  nowIso?: string;
}): MeetingRescheduleResult {
  const {
    meeting,
    newDateTime,
    newDurationMinutes,
    confirmReopenFinalMinutes = false,
    nowIso = new Date().toISOString(),
  } = params;

  if (meeting.status === 'cancelled') {
    return {
      ok: false,
      code: 'CANCELLED_MEETING',
      errorAr:
        'لا يمكن إعادة جدولة اجتماع ملغى تلقائياً. غيّر حالة الاجتماع من «ملغى» أولاً إذا أردت تفعيله.',
      honestDisclosureAr: MEETING_RESCHEDULE_DISCLOSURE_AR,
    };
  }

  const parsedMs = parseMeetingDateTimeMs(newDateTime);
  if (parsedMs === null) {
    return {
      ok: false,
      code: 'INVALID_DATETIME',
      errorAr: 'تاريخ أو وقت الاجتماع الجديد غير صالح.',
      honestDisclosureAr: MEETING_RESCHEDULE_DISCLOSURE_AR,
    };
  }

  let resolvedDuration = meeting.duration;
  if (newDurationMinutes !== undefined) {
    if (
      !Number.isFinite(newDurationMinutes) ||
      newDurationMinutes <= 0 ||
      newDurationMinutes > 1440
    ) {
      return {
        ok: false,
        code: 'INVALID_DURATION',
        errorAr: 'مدة الاجتماع يجب أن تكون بين دقيقة واحدة و1440 دقيقة.',
        honestDisclosureAr: MEETING_RESCHEDULE_DISCLOSURE_AR,
      };
    }
    resolvedDuration = Math.round(newDurationMinutes);
  }

  const locked = isMinutesLocked(meeting);
  if (locked && !confirmReopenFinalMinutes) {
    return {
      ok: false,
      code: 'FINAL_MINUTES_LOCKED',
      requiresReopenConfirmation: true,
      errorAr:
        'محضر هذا الاجتماع معتمد كنسخة نهائية مقفلة. لتعديل موعد الاجتماع، يلزم تأكيد إعادة فتح المحضر إلى مسودة (Draft) أولاً.',
      honestDisclosureAr: MEETING_RESCHEDULE_DISCLOSURE_AR,
    };
  }

  const normalizedIso = new Date(parsedMs).toISOString();
  const updatedMeeting: Meeting = {
    ...meeting,
    dateTime: normalizedIso,
    duration: resolvedDuration,
    minutesStatus: locked && confirmReopenFinalMinutes ? 'draft' : meeting.minutesStatus,
    minutesStatusUpdatedAt:
      locked && confirmReopenFinalMinutes ? nowIso : meeting.minutesStatusUpdatedAt,
    updatedAt: nowIso,
  };

  return {
    ok: true,
    meeting: updatedMeeting,
    previousDateTime: meeting.dateTime,
    newDateTime: normalizedIso,
    previousDuration: meeting.duration,
    newDuration: resolvedDuration,
    honestDisclosureAr: MEETING_RESCHEDULE_DISCLOSURE_AR,
  };
}

// =========================================================================
// Unified Calendar Event Aggregation (Meetings, Tasks, Follow-Ups, Opportunities)
// =========================================================================

export interface BuildCalendarEventsParams {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  opportunities?: Opportunity[];
  interactions?: CommunicationInteraction[];
  playbookRuns?: PlaybookRun[];
  currentUserId?: string;
  referenceDate?: Date;
  timeZone?: string;
  settings?: Partial<CalendarSettings>;
  filterScope?: CalendarFilterScope;
  clientIdFilter?: string; // 'all' or clientId
}

function isOwnedByCurrentUser(recordUserId: string | undefined, currentUserId?: string): boolean {
  if (!currentUserId) return true;
  if (!recordUserId) return true;
  return recordUserId === currentUserId;
}

export function buildCalendarEvents(params: BuildCalendarEventsParams): CalendarEventItem[] {
  const {
    clients,
    meetings,
    tasks,
    opportunities = [],
    interactions = [],
    playbookRuns = [],
    currentUserId,
    referenceDate = new Date(),
    timeZone,
    settings: rawSettings,
    filterScope = 'all',
    clientIdFilter = 'all',
  } = params;

  const settings = normalizeCalendarSettings(rawSettings);
  const todayParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(todayParts);
  const nowMs = referenceDate.getTime();

  const clientsById = new Map<string, Client>();
  for (const c of clients) {
    if (isOwnedByCurrentUser(c.userId, currentUserId)) {
      clientsById.set(c.id, c);
    }
  }

  const events: CalendarEventItem[] = [];

  // 1. Meetings & Meeting Follow-Ups
  for (const meeting of meetings) {
    if (!isOwnedByCurrentUser(meeting.userId, currentUserId)) continue;
    if (
      clientIdFilter &&
      clientIdFilter !== 'all' &&
      meeting.clientId !== clientIdFilter
    ) {
      continue;
    }

    const clientName = clientsById.get(meeting.clientId)?.name || 'عميل غير محدد';
    const isCancelled = meeting.status === 'cancelled';

    // Primary Meeting Event
    const allowMeetingsInFilter = filterScope === 'all' || filterScope === 'meetings';
    if (
      settings.showMeetings &&
      allowMeetingsInFilter &&
      (!isCancelled || settings.showCancelledMeetings)
    ) {
      const startMs = parseMeetingDateTimeMs(meeting.dateTime);
      const dateParts = resolveCalendarParts(meeting.dateTime, timeZone);
      if (startMs !== null && dateParts) {
        const dateKey = formatCalendarDateKey(dateParts);
        const hasKnownDuration =
          typeof meeting.duration === 'number' &&
          Number.isFinite(meeting.duration) &&
          meeting.duration > 0;
        const durationMinutes = hasKnownDuration ? Math.round(meeting.duration!) : undefined;
        const endMs = hasKnownDuration ? startMs + durationMinutes! * 60000 : undefined;
        const statusInfo =
          MEETING_STATUS_LABELS[meeting.status] || MEETING_STATUS_LABELS.confirmed;

        events.push({
          id: `cal-meeting-${meeting.id}`,
          sourceId: meeting.id,
          activityType: 'meeting',
          activityTypeLabelAr: ACTIVITY_TYPE_META.meeting.labelAr,
          activityTypeLabelEn: ACTIVITY_TYPE_META.meeting.labelEn,
          title: meeting.title,
          subtitle: meeting.location || undefined,
          dateKey,
          isTimed: true,
          startIso: meeting.dateTime,
          endIso: endMs !== undefined ? new Date(endMs).toISOString() : undefined,
          startMs,
          endMs,
          durationMinutes,
          hasKnownDuration,
          clientId: meeting.clientId,
          clientName,
          statusLabelAr: statusInfo.ar,
          isCompletedOrClosed: meeting.status === 'completed',
          isCancelled,
          isOverdue: false,
          minutesLocked: isMinutesLocked(meeting),
          meetingRef: meeting,
        });
      }
    }

    // Meeting Follow-Up Event (from meeting.followUpDateTime)
    const allowFollowUpsInFilter = filterScope === 'all' || filterScope === 'follow_ups';
    if (
      settings.showFollowUps &&
      allowFollowUpsInFilter &&
      !isCancelled &&
      meeting.followUpDateTime
    ) {
      const followParts = resolveCalendarParts(meeting.followUpDateTime, timeZone);
      if (followParts) {
        const followDateKey = formatCalendarDateKey(followParts);
        const followStartMs = parseMeetingDateTimeMs(meeting.followUpDateTime);
        const isDateOnlyFollowUp = Boolean(parseDateOnlyString(meeting.followUpDateTime));
        events.push({
          id: `cal-followup-${meeting.id}`,
          sourceId: meeting.id,
          activityType: 'follow_up',
          activityTypeLabelAr: ACTIVITY_TYPE_META.follow_up.labelAr,
          activityTypeLabelEn: ACTIVITY_TYPE_META.follow_up.labelEn,
          title: `متابعة: ${meeting.title}`,
          subtitle: 'موعد متابعة مسجل في محضر الاجتماع',
          dateKey: followDateKey,
          isTimed: !isDateOnlyFollowUp && followStartMs !== null,
          startIso: meeting.followUpDateTime,
          startMs: !isDateOnlyFollowUp && followStartMs !== null ? followStartMs : undefined,
          hasKnownDuration: false,
          clientId: meeting.clientId,
          clientName,
          statusLabelAr: followDateKey < todayKey ? 'متابعة مستحقة' : 'متابعة قادمة',
          isCompletedOrClosed: false,
          isCancelled: false,
          isOverdue: followDateKey < todayKey,
          meetingRef: meeting,
        });
      }
    }
  }

  // 2. Tasks: Due Dates (task_due) AND Scheduled Work Time Blocks (task_block)
  const allowTasksInFilter = filterScope === 'all' || filterScope === 'tasks';
  if (settings.showTasks && allowTasksInFilter) {
    for (const rawTask of tasks) {
      if (!isOwnedByCurrentUser(rawTask.userId, currentUserId)) continue;
      const task = decodeTaskTimeBlockFromFirestore(rawTask);

      if (
        clientIdFilter &&
        clientIdFilter !== 'all' &&
        task.clientId !== clientIdFilter
      ) {
        continue;
      }

      const clientName = clientsById.get(task.clientId)?.name || 'عميل غير محدد';
      const isCompleted = task.status === 'completed';
      const isCancelled = task.status === 'cancelled';
      const statusLabelAr =
        task.status === 'completed'
          ? 'مكتملة'
          : task.status === 'in_progress'
          ? 'قيد التنفيذ'
          : task.status === 'cancelled'
          ? 'ملغاة'
          : 'قيد الانتظار';

      // 2a. Date-only Due Date event (NEVER fabricates a specific hour)
      if (task.dueDate) {
        const dueParts = parseDateOnlyString(task.dueDate);
        if (dueParts) {
          const dueKey = formatCalendarDateKey(dueParts);
          const isOverdue = !isCompleted && !isCancelled && dueKey < todayKey;
          events.push({
            id: `cal-task-due-${task.id}`,
            sourceId: task.id,
            activityType: 'task_due',
            activityTypeLabelAr: ACTIVITY_TYPE_META.task_due.labelAr,
            activityTypeLabelEn: ACTIVITY_TYPE_META.task_due.labelEn,
            title: task.title,
            subtitle: task.description || 'موعد استحقاق المهمة (طوال اليوم)',
            dateKey: dueKey,
            isTimed: false,
            hasKnownDuration: false,
            clientId: task.clientId,
            clientName,
            statusLabelAr: isOverdue ? `${statusLabelAr} (متأخرة)` : statusLabelAr,
            isCompletedOrClosed: isCompleted,
            isCancelled,
            isOverdue,
            priority: task.priority,
            provenance: task.provenance,
            taskRef: task,
          });
        }
      }

      // 2b. Scheduled Work Time Block event (task_block)
      if (task.scheduledStartAt && task.scheduledEndAt) {
        const check = validateTimeBlockInterval(task.scheduledStartAt, task.scheduledEndAt);
        if (check.valid && check.startMs && check.endMs && check.durationMinutes) {
          const blockParts = resolveCalendarParts(task.scheduledStartAt, timeZone);
          if (blockParts) {
            const blockDateKey = formatCalendarDateKey(blockParts);
            const isOverdue = !isCompleted && !isCancelled && check.endMs < nowMs;
            events.push({
              id: `cal-task-block-${task.id}`,
              sourceId: task.id,
              activityType: 'task_block',
              activityTypeLabelAr: ACTIVITY_TYPE_META.task_block.labelAr,
              activityTypeLabelEn: ACTIVITY_TYPE_META.task_block.labelEn,
              title: task.title,
              subtitle: task.dueDate
                ? `وقت عمل مخطط (الاستحقاق: ${task.dueDate})`
                : 'وقت عمل مخطط للمهمة',
              dateKey: blockDateKey,
              isTimed: true,
              startIso: check.startIso,
              endIso: check.endIso,
              startMs: check.startMs,
              endMs: check.endMs,
              durationMinutes: check.durationMinutes,
              hasKnownDuration: true,
              clientId: task.clientId,
              clientName,
              statusLabelAr,
              isCompletedOrClosed: isCompleted,
              isCancelled,
              isOverdue,
              priority: task.priority,
              provenance: task.provenance,
              taskRef: task,
            });
          }
        }
      }
    }
  }

  // 3. Open Business Opportunities (nextActionDate & expectedCloseDate)
  const allowOpportunitiesInFilter =
    filterScope === 'all' ||
    filterScope === 'opportunities' ||
    filterScope === 'follow_ups';
  if (settings.showOpportunities && allowOpportunitiesInFilter) {
    for (const opp of opportunities) {
      if (!isOwnedByCurrentUser(opp.userId, currentUserId)) continue;
      // Closed opportunities are excluded from active calendar commitments
      if (isOpportunityClosed(opp.stage)) continue;
      if (
        clientIdFilter &&
        clientIdFilter !== 'all' &&
        opp.clientId !== clientIdFilter
      ) {
        continue;
      }

      const clientName = clientsById.get(opp.clientId)?.name || 'عميل غير محدد';
      const stageLabel = OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage;

      // 3a. Next Action Date
      if (opp.nextActionDate) {
        const nextParts = parseDateOnlyString(opp.nextActionDate);
        if (nextParts) {
          const nextKey = formatCalendarDateKey(nextParts);
          const isOverdue = nextKey < todayKey;
          events.push({
            id: `cal-opp-action-${opp.id}`,
            sourceId: opp.id,
            activityType: 'opportunity_action',
            activityTypeLabelAr: ACTIVITY_TYPE_META.opportunity_action.labelAr,
            activityTypeLabelEn: ACTIVITY_TYPE_META.opportunity_action.labelEn,
            title: opp.nextAction ? `${opp.title}: ${opp.nextAction}` : `متابعة فرصة: ${opp.title}`,
            subtitle: `المرحلة: ${stageLabel}`,
            dateKey: nextKey,
            isTimed: false,
            hasKnownDuration: false,
            clientId: opp.clientId,
            clientName,
            statusLabelAr: isOverdue ? `${stageLabel} (إجراء متأخر)` : stageLabel,
            isCompletedOrClosed: false,
            isCancelled: false,
            isOverdue,
            priority: opp.priority,
            opportunityRef: opp,
          });
        }
      }

      // 3b. Expected Close Date (only shown in 'all' or 'opportunities', clearly labeled as estimate, never a meeting)
      if (
        opp.expectedCloseDate &&
        (filterScope === 'all' || filterScope === 'opportunities')
      ) {
        const closeParts = parseDateOnlyString(opp.expectedCloseDate);
        if (closeParts) {
          const closeKey = formatCalendarDateKey(closeParts);
          events.push({
            id: `cal-opp-close-${opp.id}`,
            sourceId: opp.id,
            activityType: 'opportunity_close',
            activityTypeLabelAr: ACTIVITY_TYPE_META.opportunity_close.labelAr,
            activityTypeLabelEn: ACTIVITY_TYPE_META.opportunity_close.labelEn,
            title: `إغلاق متوقع: ${opp.title}`,
            subtitle: `تاريخ إغلاق تقديري للفرصة (${stageLabel}) — ليس اجتماعاً مؤكداً`,
            dateKey: closeKey,
            isTimed: false,
            hasKnownDuration: false,
            clientId: opp.clientId,
            clientName,
            statusLabelAr: `تقديري (${stageLabel})`,
            isCompletedOrClosed: false,
            isCancelled: false,
            isOverdue: closeKey < todayKey,
            priority: opp.priority,
            opportunityRef: opp,
          });
        }
      }
    }
  }

  // 4. Communication Interaction Follow-Ups (nextFollowUpDate)
  const allowCommFollowUps = filterScope === 'all' || filterScope === 'follow_ups';
  if (settings.showFollowUps && allowCommFollowUps && interactions.length > 0) {
    for (const comm of interactions) {
      if (!isOwnedByCurrentUser(comm.userId, currentUserId)) continue;
      if (!comm.nextFollowUpDate) continue;
      if (
        clientIdFilter &&
        clientIdFilter !== 'all' &&
        comm.clientId !== clientIdFilter
      ) {
        continue;
      }

      const linkedTask = findLinkedTaskForInteraction(comm, tasks);
      const isCompleted = linkedTask?.status === 'completed';
      const isCancelled = linkedTask?.status === 'cancelled';
      if (!isInteractionFollowUpPending(comm, tasks) && !isCompleted) continue;

      const followParts = parseDateOnlyString(comm.nextFollowUpDate);
      if (!followParts) continue;

      const followDateKey = formatCalendarDateKey(followParts);
      const clientName = clientsById.get(comm.clientId)?.name || 'عميل غير محدد';
      const channelLabel = COMMUNICATION_CHANNEL_META[comm.channel]?.shortLabelAr || 'تواصل';
      const isOverdue = !isCompleted && !isCancelled && followDateKey < todayKey;

      events.push({
        id: `cal-comm-followup-${comm.id}`,
        sourceId: comm.id,
        activityType: 'follow_up',
        activityTypeLabelAr: ACTIVITY_TYPE_META.follow_up.labelAr,
        activityTypeLabelEn: ACTIVITY_TYPE_META.follow_up.labelEn,
        title: comm.nextStep?.trim()
          ? `متابعة ${channelLabel}: ${comm.nextStep.trim()}`
          : `متابعة ${channelLabel}: ${comm.subject}`,
        subtitle: `منبثقة من ${COMMUNICATION_CHANNEL_META[comm.channel]?.labelAr || 'تواصل'}`,
        dateKey: followDateKey,
        isTimed: false,
        hasKnownDuration: false,
        clientId: comm.clientId,
        clientName,
        statusLabelAr: isCompleted
          ? 'متابعة منجزة'
          : isOverdue
          ? 'متابعة تواصل متأخرة'
          : 'متابعة تواصل مجدولة',
        isCompletedOrClosed: Boolean(isCompleted),
        isCancelled: Boolean(isCancelled),
        isOverdue,
        interactionRef: comm,
      });
    }
  }

  // 5. Playbook Run Steps (active runs only, date-only dueDates, deduplicated against linked tasks)
  const allowPlaybooksInFilter = filterScope === 'all' || filterScope === 'follow_ups';
  if (settings.showPlaybooks !== false && allowPlaybooksInFilter && playbookRuns.length > 0) {
    const nonCancelledTaskIds = new Set<string>();
    const nonCancelledPlaybookStepKeys = new Set<string>();
    for (const rawTask of tasks) {
      if (!isOwnedByCurrentUser(rawTask.userId, currentUserId)) continue;
      if (rawTask.status === 'cancelled') continue;
      nonCancelledTaskIds.add(rawTask.id);
      if (rawTask.playbookRunId && rawTask.playbookStepId) {
        nonCancelledPlaybookStepKeys.add(`${rawTask.playbookRunId}__${rawTask.playbookStepId}`);
      }
    }

    for (const run of playbookRuns) {
      if (!isOwnedByCurrentUser(run.userId, currentUserId)) continue;
      if (run.status !== 'active') continue;
      if (
        clientIdFilter &&
        clientIdFilter !== 'all' &&
        run.clientId !== clientIdFilter
      ) {
        continue;
      }

      const clientName = clientsById.get(run.clientId)?.name || 'عميل غير محدد';

      for (const step of run.steps || []) {
        if (step.status !== 'pending' && step.status !== 'in_progress') continue;
        if (!step.dueDate) continue;

        // Avoid duplicate calendar entries when step is already backed by a non-cancelled task
        if (step.linkedTaskId && nonCancelledTaskIds.has(step.linkedTaskId)) continue;
        if (nonCancelledPlaybookStepKeys.has(`${run.id}__${step.id}`)) continue;

        const dueParts = parseDateOnlyString(step.dueDate);
        if (!dueParts) continue;
        const dueKey = formatCalendarDateKey(dueParts);
        const isOverdue = dueKey < todayKey;

        events.push({
          id: `cal-playbook-step-${run.id}-${step.id}`,
          sourceId: step.id,
          activityType: 'playbook_step',
          activityTypeLabelAr: ACTIVITY_TYPE_META.playbook_step.labelAr,
          activityTypeLabelEn: ACTIVITY_TYPE_META.playbook_step.labelEn,
          title: step.title,
          subtitle: `من خطة: ${run.templateName}`,
          dateKey: dueKey,
          isTimed: false,
          hasKnownDuration: false,
          clientId: run.clientId,
          clientName,
          statusLabelAr: isOverdue ? 'خطوة متابعة (متأخرة)' : 'خطوة متابعة مجدولة',
          isCompletedOrClosed: false,
          isCancelled: false,
          isOverdue,
          priority: step.priority,
          provenance: 'approved',
          playbookRunRef: run,
          playbookStepId: step.id,
        });
      }
    }
  }

  // Sort events deterministically:
  // 1. By dateKey ascending
  // 2. Timed events before all-day events
  // 3. By startMs ascending for timed events
  // 4. By activity type priority & title
  events.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    if (a.isTimed !== b.isTimed) return a.isTimed ? -1 : 1;
    if (a.isTimed && b.isTimed && a.startMs !== undefined && b.startMs !== undefined) {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    }
    return a.title.localeCompare(b.title, 'ar');
  });

  return events;
}

// =========================================================================
// Time Conflict Detection («تعارض في المواعيد»)
// =========================================================================

/**
 * Detects time overlaps strictly between active time-bounded commitments:
 * - Active meetings (status !== 'cancelled') with known duration > 0
 * - Active task Time Blocks (status !== 'completed' && status !== 'cancelled') with valid start/end
 * Never treats date-only tasks (dueDate without Time Block) or cancelled meetings as conflicts.
 */
export function detectCalendarConflicts(events: CalendarEventItem[]): CalendarConflictPair[] {
  const eligible = events.filter((ev) => {
    if (!ev.isTimed || !ev.hasKnownDuration) return false;
    if (ev.isCancelled) return false;
    if (ev.activityType === 'task_block' && ev.isCompletedOrClosed) return false;
    if (ev.activityType !== 'meeting' && ev.activityType !== 'task_block') return false;
    return (
      typeof ev.startMs === 'number' &&
      typeof ev.endMs === 'number' &&
      ev.endMs > ev.startMs
    );
  });

  const sorted = [...eligible].sort((a, b) => {
    if (a.startMs! !== b.startMs!) return a.startMs! - b.startMs!;
    return a.endMs! - b.endMs!;
  });

  const conflicts: CalendarConflictPair[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j];
      // Since sorted by startMs, if second starts at or after first ends, no subsequent item can overlap first
      if (second.startMs! >= first.endMs!) {
        break;
      }
      // Avoid flagging an item against itself
      if (first.id === second.id) continue;

      const overlapStartMs = Math.max(first.startMs!, second.startMs!);
      const overlapEndMs = Math.min(first.endMs!, second.endMs!);
      const overlapMinutes = Math.max(1, Math.round((overlapEndMs - overlapStartMs) / 60000));

      let reasonAr = 'تداخل زمني بين التزامين مجدولين';
      if (first.activityType === 'meeting' && second.activityType === 'meeting') {
        reasonAr = `تعارض بين اجتماعين («${first.title}» و«${second.title}») لمدة ${overlapMinutes} دقيقة`;
      } else if (
        first.activityType === 'task_block' &&
        second.activityType === 'task_block'
      ) {
        reasonAr = `تعارض بين فترتي عمل لمهمتين («${first.title}» و«${second.title}») لمدة ${overlapMinutes} دقيقة`;
      } else {
        reasonAr = `تعارض بين ${first.activityTypeLabelAr} «${first.title}» و${second.activityTypeLabelAr} «${second.title}» لمدة ${overlapMinutes} دقيقة`;
      }

      conflicts.push({
        id: `conflict-${first.id}-${second.id}`,
        dateKey: first.dateKey,
        firstEvent: first,
        secondEvent: second,
        overlapStartIso: new Date(overlapStartMs).toISOString(),
        overlapEndIso: new Date(overlapEndMs).toISOString(),
        overlapMinutes,
        reasonAr,
      });
    }
  }

  return conflicts;
}

// =========================================================================
// Monthly Grid, Weekly Range, Daily Available Gaps & Weekly Planner
// =========================================================================

function buildDayCell(params: {
  parts: CalendarDateParts;
  isCurrentMonth: boolean;
  todayKey: string;
  eventsByDate: Map<string, CalendarEventItem[]>;
  conflictDates: Set<string>;
}): CalendarDayCell {
  const { parts, isCurrentMonth, todayKey, eventsByDate, conflictDates } = params;
  const dateKey = formatCalendarDateKey(parts);
  const dow = getDayOfWeekForParts(parts);
  const dayEvents = eventsByDate.get(dateKey) || [];

  let meetings = 0;
  let taskBlocks = 0;
  let tasksDue = 0;
  let followUps = 0;
  let opportunities = 0;

  for (const ev of dayEvents) {
    if (ev.activityType === 'meeting' && !ev.isCancelled) meetings += 1;
    else if (ev.activityType === 'task_block') taskBlocks += 1;
    else if (ev.activityType === 'task_due') tasksDue += 1;
    else if (ev.activityType === 'follow_up' || ev.activityType === 'playbook_step') followUps += 1;
    else if (
      ev.activityType === 'opportunity_action' ||
      ev.activityType === 'opportunity_close'
    ) {
      opportunities += 1;
    }
  }

  return {
    dateKey,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    dayOfWeek: dow,
    dayNameShortAr: DAY_NAMES_SHORT_AR[dow],
    dayNameFullAr: DAY_NAMES_FULL_AR[dow],
    isCurrentMonth,
    isToday: dateKey === todayKey,
    events: dayEvents,
    counts: {
      meetings,
      taskBlocks,
      tasksDue,
      followUps,
      opportunities,
      total: dayEvents.length,
    },
    hasConflict: conflictDates.has(dateKey),
  };
}

export function buildMonthCalendarGrid(params: {
  year: number;
  month: number; // 1-12
  weekStartDay?: CalendarWeekStartDay;
  events: CalendarEventItem[];
  conflicts?: CalendarConflictPair[];
  referenceDate?: Date;
  timeZone?: string;
}): CalendarDayCell[] {
  const {
    year,
    month,
    weekStartDay = 6,
    events,
    conflicts = detectCalendarConflicts(events),
    referenceDate = new Date(),
    timeZone,
  } = params;

  const todayKey = formatCalendarDateKey(extractZonedCalendarParts(referenceDate, timeZone));
  const eventsByDate = new Map<string, CalendarEventItem[]>();
  for (const ev of events) {
    const list = eventsByDate.get(ev.dateKey) || [];
    list.push(ev);
    eventsByDate.set(ev.dateKey, list);
  }

  const conflictDates = new Set<string>(conflicts.map((c) => c.dateKey));

  const firstOfMonth: CalendarDateParts = { year, month, day: 1 };
  const gridStart = getWeekStartDateParts(firstOfMonth, weekStartDay);
  const daysInCurrentMonth = getDaysInMonth(year, month);
  const lastOfMonth: CalendarDateParts = { year, month, day: daysInCurrentMonth };
  const lastDow = getDayOfWeekForParts(lastOfMonth);
  const endOffset = (6 - ((lastDow - weekStartDay + 7) % 7) + 7) % 7;
  const gridEnd = addCalendarDays(lastOfMonth, endOffset);

  const cells: CalendarDayCell[] = [];
  let cursor = gridStart;
  const endKey = formatCalendarDateKey(gridEnd);

  for (let safety = 0; safety < 42; safety++) {
    const cursorKey = formatCalendarDateKey(cursor);
    cells.push(
      buildDayCell({
        parts: cursor,
        isCurrentMonth: cursor.year === year && cursor.month === month,
        todayKey,
        eventsByDate,
        conflictDates,
      })
    );
    if (cursorKey === endKey) break;
    cursor = addCalendarDays(cursor, 1);
  }

  return cells;
}

export function buildWeekDaysRange(params: {
  anchorDateKey: string;
  weekStartDay?: CalendarWeekStartDay;
  events: CalendarEventItem[];
  conflicts?: CalendarConflictPair[];
  referenceDate?: Date;
  timeZone?: string;
}): CalendarDayCell[] {
  const {
    anchorDateKey,
    weekStartDay = 6,
    events,
    conflicts = detectCalendarConflicts(events),
    referenceDate = new Date(),
    timeZone,
  } = params;

  const todayParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(todayParts);
  const anchorParts = parseDateOnlyString(anchorDateKey) || todayParts;
  const weekStart = getWeekStartDateParts(anchorParts, weekStartDay);

  const eventsByDate = new Map<string, CalendarEventItem[]>();
  for (const ev of events) {
    const list = eventsByDate.get(ev.dateKey) || [];
    list.push(ev);
    eventsByDate.set(ev.dateKey, list);
  }

  const conflictDates = new Set<string>(conflicts.map((c) => c.dateKey));

  const days: CalendarDayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const parts = addCalendarDays(weekStart, i);
    days.push(
      buildDayCell({
        parts,
        isCurrentMonth: parts.month === anchorParts.month,
        todayKey,
        eventsByDate,
        conflictDates,
      })
    );
  }
  return days;
}

/**
 * Computes available gaps during working hours on a single day based on active timed commitments in Murafiq.
 */
export function computeDayAvailableSlots(params: {
  dateKey: string;
  events: CalendarEventItem[];
  workingDayStartHour?: number;
  workingDayEndHour?: number;
  minGapMinutes?: number;
  timeFormat?: CalendarTimeFormat;
  timeZone?: string;
}): DayAvailableGap[] {
  const {
    dateKey,
    events,
    workingDayStartHour = 8,
    workingDayEndHour = 18,
    minGapMinutes = 30,
    timeFormat = '12h',
    timeZone,
  } = params;

  const parts = parseDateOnlyString(dateKey);
  if (!parts) return [];

  const windowStart = buildZonedDate(parts, workingDayStartHour, 0, timeZone).getTime();
  const windowEnd = buildZonedDate(parts, workingDayEndHour, 0, timeZone).getTime();
  if (windowEnd <= windowStart) return [];

  // Collect busy intervals for this day
  const busyIntervals: Array<{ startMs: number; endMs: number }> = [];
  for (const ev of events) {
    if (ev.dateKey !== dateKey) continue;
    if (!ev.isTimed || ev.isCancelled) continue;
    if (ev.activityType === 'task_block' && ev.isCompletedOrClosed) continue;
    if (typeof ev.startMs !== 'number') continue;

    // For meetings without an explicit duration, reserve 45 mins visually for gap estimation
    const effectiveEndMs =
      typeof ev.endMs === 'number' && ev.endMs > ev.startMs
        ? ev.endMs
        : ev.startMs + 45 * 60000;

    const clampedStart = Math.max(windowStart, ev.startMs);
    const clampedEnd = Math.min(windowEnd, effectiveEndMs);
    if (clampedEnd > clampedStart) {
      busyIntervals.push({ startMs: clampedStart, endMs: clampedEnd });
    }
  }

  busyIntervals.sort((a, b) => a.startMs - b.startMs);

  // Merge overlapping busy intervals
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of busyIntervals) {
    if (merged.length === 0) {
      merged.push({ ...interval });
    } else {
      const last = merged[merged.length - 1];
      if (interval.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, interval.endMs);
      } else {
        merged.push({ ...interval });
      }
    }
  }

  const gaps: DayAvailableGap[] = [];
  let cursorMs = windowStart;

  for (const busy of merged) {
    if (busy.startMs > cursorMs) {
      const gapMinutes = Math.round((busy.startMs - cursorMs) / 60000);
      if (gapMinutes >= minGapMinutes) {
        const startDate = new Date(cursorMs);
        const endDate = new Date(busy.startMs);
        gaps.push({
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          startHourLabel: formatTimeInZone(startDate, timeFormat, timeZone),
          endHourLabel: formatTimeInZone(endDate, timeFormat, timeZone),
          durationMinutes: gapMinutes,
        });
      }
    }
    cursorMs = Math.max(cursorMs, busy.endMs);
  }

  if (windowEnd > cursorMs) {
    const gapMinutes = Math.round((windowEnd - cursorMs) / 60000);
    if (gapMinutes >= minGapMinutes) {
      const startDate = new Date(cursorMs);
      const endDate = new Date(windowEnd);
      gaps.push({
        startIso: startDate.toISOString(),
        endIso: endDate.toISOString(),
        startHourLabel: formatTimeInZone(startDate, timeFormat, timeZone),
        endHourLabel: formatTimeInZone(endDate, timeFormat, timeZone),
        durationMinutes: gapMinutes,
      });
    }
  }

  return gaps;
}

export interface WeeklyPlanDataResult {
  weekStartKey: string;
  weekEndKey: string;
  weekDays: CalendarDayCell[];
  weekMeetings: CalendarEventItem[];
  weekDueTasks: CalendarEventItem[];
  weekTimeBlocks: CalendarEventItem[];
  weekFollowUps: CalendarEventItem[];
  weekOpportunityActions: CalendarEventItem[];
  overdueCommitments: CalendarEventItem[];
  unscheduledOpenTasks: ActionItem[];
  weekConflicts: CalendarConflictPair[];
  summary: WeeklyPlanSummary;
}

/**
 * Builds the comprehensive Weekly Planner («خطتي لهذا الأسبوع») dataset and summary metrics.
 * Never fabricates meeting hours when meeting.duration is missing!
 */
export function buildWeeklyPlanData(params: {
  anchorDateKey: string;
  weekStartDay?: CalendarWeekStartDay;
  events: CalendarEventItem[];
  allTasks: ActionItem[];
  currentUserId?: string;
  referenceDate?: Date;
  timeZone?: string;
}): WeeklyPlanDataResult {
  const {
    anchorDateKey,
    weekStartDay = 6,
    events,
    allTasks,
    currentUserId,
    referenceDate = new Date(),
    timeZone,
  } = params;

  const todayParts = extractZonedCalendarParts(referenceDate, timeZone);
  const todayKey = formatCalendarDateKey(todayParts);

  const weekDays = buildWeekDaysRange({
    anchorDateKey,
    weekStartDay,
    events,
    referenceDate,
    timeZone,
  });

  const weekStartKey = weekDays[0]?.dateKey || anchorDateKey;
  const weekEndKey = weekDays[weekDays.length - 1]?.dateKey || anchorDateKey;

  const weekEvents = events.filter(
    (ev) => ev.dateKey >= weekStartKey && ev.dateKey <= weekEndKey
  );

  const weekMeetings = weekEvents.filter(
    (ev) => ev.activityType === 'meeting' && !ev.isCancelled
  );
  const weekDueTasks = weekEvents.filter(
    (ev) => ev.activityType === 'task_due' && !ev.isCancelled
  );
  const weekTimeBlocks = weekEvents.filter(
    (ev) => ev.activityType === 'task_block' && !ev.isCancelled
  );
  const weekFollowUps = weekEvents.filter(
    (ev) => ev.activityType === 'follow_up' || ev.activityType === 'playbook_step'
  );
  const weekOpportunityActions = weekEvents.filter(
    (ev) => ev.activityType === 'opportunity_action'
  );

  // Overdue commitments: uncompleted tasks, follow-ups, playbook steps, or opportunity actions with dateKey < todayKey
  const overdueCommitments = events.filter(
    (ev) =>
      ev.isOverdue &&
      !ev.isCompletedOrClosed &&
      !ev.isCancelled &&
      (ev.activityType === 'task_due' ||
        ev.activityType === 'follow_up' ||
        ev.activityType === 'playbook_step' ||
        ev.activityType === 'opportunity_action')
  );

  // Open tasks that do not yet have a scheduled work Time Block (eligible for quick weekly scheduling)
  const unscheduledOpenTasks = allTasks
    .filter((t) => isOwnedByCurrentUser(t.userId, currentUserId))
    .map((t) => decodeTaskTimeBlockFromFirestore(t))
    .filter(
      (t) =>
        t.status !== 'completed' &&
        t.status !== 'cancelled' &&
        (!t.scheduledStartAt || !t.scheduledEndAt)
    )
    .sort((a, b) => {
      const aDue = a.dueDate || '9999-12-31';
      const bDue = b.dueDate || '9999-12-31';
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return a.title.localeCompare(b.title, 'ar');
    });

  // Honest duration aggregation: only sum meetings where hasKnownDuration is true
  let scheduledMeetingMinutes = 0;
  let meetingsWithoutDurationCount = 0;
  for (const m of weekMeetings) {
    if (m.hasKnownDuration && typeof m.durationMinutes === 'number' && m.durationMinutes > 0) {
      scheduledMeetingMinutes += m.durationMinutes;
    } else {
      meetingsWithoutDurationCount += 1;
    }
  }

  let plannedTaskWorkMinutes = 0;
  for (const tb of weekTimeBlocks) {
    if (tb.hasKnownDuration && typeof tb.durationMinutes === 'number' && tb.durationMinutes > 0) {
      plannedTaskWorkMinutes += tb.durationMinutes;
    }
  }

  const weekConflicts = detectCalendarConflicts(weekEvents);

  const summary: WeeklyPlanSummary = {
    weekStartKey,
    weekEndKey,
    meetingsCount: weekMeetings.length,
    dueTasksCount: weekDueTasks.length,
    timeBlockedTasksCount: weekTimeBlocks.length,
    followUpsCount: weekFollowUps.length,
    opportunityActionsCount: weekOpportunityActions.length,
    overdueCommitmentsCount: overdueCommitments.length,
    scheduledMeetingMinutes,
    scheduledMeetingHours: Math.round((scheduledMeetingMinutes / 60) * 10) / 10,
    meetingsWithoutDurationCount,
    plannedTaskWorkMinutes,
    plannedTaskWorkHours: Math.round((plannedTaskWorkMinutes / 60) * 10) / 10,
    conflictsCount: weekConflicts.length,
  };

  return {
    weekStartKey,
    weekEndKey,
    weekDays,
    weekMeetings,
    weekDueTasks,
    weekTimeBlocks,
    weekFollowUps,
    weekOpportunityActions,
    overdueCommitments,
    unscheduledOpenTasks,
    weekConflicts,
    summary,
  };
}
