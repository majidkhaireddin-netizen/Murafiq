import type { ActionItem, Client, Meeting, Note, Opportunity, TaskPriority } from '../types/index.ts';
import {
  calendarDaysDiff,
  extractZonedCalendarParts,
  resolveCalendarParts,
} from './followUpEngine.ts';
import { executeUniversalSearch } from './searchEngine.ts';

/**
 * Format Gregorian date into authentic Arabic string representation
 */
export function formatArabicDate(dateString: string, includeTime = false): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const monthsArabic = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  const day = date.getDate();
  const month = monthsArabic[date.getMonth()];
  const year = date.getFullYear();

  let formatted = `${day} ${month} ${year}`;

  if (includeTime) {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const period = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12 || 12;
    formatted += ` • ${hours}:${minutes} ${period}`;
  }

  return formatted;
}

/**
 * Calculate approximate Hijri date string for a given date
 */
export function getHijriDateString(dateString?: string): string {
  const date = dateString ? new Date(dateString) : new Date();
  if (isNaN(date.getTime())) return '';

  try {
    const formatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return formatter.format(date);
  } catch {
    // Fallback if islamic calendar locale is not supported
    return '1448 هـ';
  }
}

/**
 * Return relative Arabic time format ('اليوم', 'أمس', 'غداً', 'منذ X أيام', etc.)
 * Safe against YYYY-MM-DD UTC midnight shift across negative-UTC timezones.
 */
export function getRelativeTimeArabic(
  dateString: string,
  referenceDate: Date = new Date(),
  timeZone?: string
): string {
  if (!dateString) return '';
  const targetParts = resolveCalendarParts(dateString, timeZone);
  if (!targetParts) return dateString;

  const nowParts = extractZonedCalendarParts(referenceDate, timeZone);
  const diffDays = calendarDaysDiff(targetParts, nowParts);

  if (diffDays === 0) return 'اليوم';
  if (diffDays === 1) return 'غداً';
  if (diffDays === 2) return 'بعد غد';
  if (diffDays === -1) return 'أمس';
  if (diffDays === -2) return 'أول أمس';
  if (diffDays > 2 && diffDays <= 10) return `خلال ${diffDays} أيام`;
  if (diffDays > 10) return `خلال ${diffDays} يوماً`;
  if (diffDays < -2 && diffDays >= -10) return `منذ ${Math.abs(diffDays)} أيام`;
  return `منذ ${Math.abs(diffDays)} يوماً`;
}

/**
 * Priority rank helper for sorting
 */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function getPriorityBadge(priority: TaskPriority): {
  label: string;
  color: string;
} {
  switch (priority) {
    case 'urgent':
      return {
        label: 'عاجل',
        color: 'bg-rose-50 text-rose-800 border border-rose-200',
      };
    case 'high':
      return {
        label: 'مرتفع',
        color: 'bg-amber-50 text-amber-800 border border-amber-200',
      };
    case 'medium':
      return {
        label: 'متوسط',
        color: 'bg-stone-100 text-stone-700 border border-stone-200',
      };
    case 'low':
    default:
      return {
        label: 'منخفض',
        color: 'bg-stone-50 text-stone-500 border border-stone-200',
      };
  }
}

/**
 * Categorize action items into standard Murafiq buckets:
 * Overdue (متأخرة), Today (اليوم), This Week (هذا الأسبوع), Later (لاحقاً)
 */
export function categorizeTasks(
  tasks: ActionItem[],
  referenceDate = new Date(),
  timeZone?: string
) {
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  const overdue: ActionItem[] = [];
  const today: ActionItem[] = [];
  const thisWeek: ActionItem[] = [];
  const later: ActionItem[] = [];

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      continue;
    }

    if (!task.dueDate) {
      later.push(task);
      continue;
    }

    const taskParts = resolveCalendarParts(task.dueDate, timeZone);
    if (!taskParts) {
      later.push(task);
      continue;
    }

    const diffDays = calendarDaysDiff(taskParts, refParts);

    if (diffDays < 0) {
      overdue.push(task);
    } else if (diffDays === 0) {
      today.push(task);
    } else if (diffDays <= 7) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  // Sort each group by priority descending
  const sortByPriority = (a: ActionItem, b: ActionItem) =>
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];

  return {
    overdue: overdue.sort(sortByPriority),
    today: today.sort(sortByPriority),
    thisWeek: thisWeek.sort(sortByPriority),
    later: later.sort(sortByPriority),
  };
}

/**
 * Suggest a follow-up date based on task priority or client engagement patterns
 */
export function suggestFollowUpDate(baseDateString: string, priority: TaskPriority): {
  suggestedDate: string;
  reasonArabic: string;
} {
  const base = new Date(baseDateString || new Date().toISOString());
  const daysToAdd = priority === 'urgent' ? 2 : priority === 'high' ? 5 : priority === 'medium' ? 7 : 14;

  const target = new Date(base.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const isoDate = target.toISOString().split('T')[0];

  const reason = priority === 'urgent'
    ? 'اقتراح ذكي: متابعة خلال يومين نظراً لدرجة الأهمية العاجلة'
    : priority === 'high'
    ? 'اقتراح ذكي: متابعة بعد 5 أيام لضمان تقدم المهام العالية'
    : 'اقتراح ذكي: متابعة أسبوعية دورية معتادة';

  return { suggestedDate: isoDate, reasonArabic: reason };
}

/**
 * Detect clients with no logged meetings in the last X days (default: 30 days)
 */
export function detectClientsNeedingReview(
  clients: Client[],
  meetings: Meeting[],
  thresholdDays = 30,
  referenceDate = new Date()
): { client: Client; daysSinceLastMeeting: number }[] {
  const refTime = referenceDate.getTime();
  const dayMs = 1000 * 60 * 60 * 24;

  const results: { client: Client; daysSinceLastMeeting: number }[] = [];

  for (const client of clients) {
    const clientMeetings = meetings.filter(m => m.clientId === client.id);
    if (clientMeetings.length === 0) {
      // Check created date
      const createdTime = new Date(client.createdAt).getTime();
      const days = Math.floor((refTime - createdTime) / dayMs);
      if (days >= thresholdDays) {
        results.push({ client, daysSinceLastMeeting: days });
      }
    } else {
      // Find latest meeting
      const sorted = [...clientMeetings].sort(
        (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()
      );
      const latestTime = new Date(sorted[0].dateTime).getTime();
      const days = Math.floor((refTime - latestTime) / dayMs);
      if (days >= thresholdDays) {
        results.push({ client, daysSinceLastMeeting: days });
      }
    }
  }

  return results.sort((a, b) => b.daysSinceLastMeeting - a.daysSinceLastMeeting);
}

/**
 * Universal search filter across Clients, Contacts, Meetings, Tasks, Notes, and Opportunities
 * powered by the Task 009 Arabic-normalized search engine.
 */
export function universalSearch(
  query: string,
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
    opportunities?: Opportunity[];
    currentUserId?: string;
  }
) {
  const exec = executeUniversalSearch({
    query,
    data,
    limit: 500,
  });

  return {
    clients: exec.grouped.client.map((i) => i.clientRef!).filter(Boolean),
    contacts: exec.grouped.contact
      .map((i) => ({ contact: i.contactRef!, client: i.clientRef! }))
      .filter((x) => Boolean(x.contact && x.client)),
    meetings: exec.grouped.meeting.map((i) => i.meetingRef!).filter(Boolean),
    tasks: exec.grouped.task.map((i) => i.taskRef!).filter(Boolean),
    notes: exec.grouped.note.map((i) => i.noteRef!).filter(Boolean),
    opportunities: exec.grouped.opportunity.map((i) => i.opportunityRef!).filter(Boolean),
  };
}

/**
 * Apply a meeting agenda template either by replacing current notes or appending to them.
 */
export function applyMeetingTemplate(
  currentNotes: string,
  templateMarkdown: string,
  mode: 'replace' | 'append' = 'replace'
): string {
  const trimmed = (currentNotes || '').trim();
  if (mode === 'replace' || !trimmed) {
    return templateMarkdown;
  }
  return `${trimmed}\n\n---\n\n${templateMarkdown}`;
}

/**
 * Insert a quick decision, action, or blocker snippet into meeting notes cleanly.
 */
export function insertMeetingSnippet(currentNotes: string, snippet: string): string {
  const trimmed = (currentNotes || '').trim();
  if (!trimmed) {
    return snippet.trim();
  }
  return `${trimmed}${snippet}`;
}
