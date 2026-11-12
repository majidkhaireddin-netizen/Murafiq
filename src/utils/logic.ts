import { ActionItem, Client, Meeting, Note, TaskPriority } from '../types';

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
 */
export function getRelativeTimeArabic(dateString: string): string {
  if (!dateString) return '';
  const target = new Date(dateString);
  if (isNaN(target.getTime())) return dateString;

  const now = new Date();
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const diffDays = Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24));

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

/**
 * Categorize action items into standard Murafiq buckets:
 * Overdue (متأخرة), Today (اليوم), This Week (هذا الأسبوع), Later (لاحقاً)
 */
export function categorizeTasks(tasks: ActionItem[], referenceDate = new Date()) {
  const refMidnight = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
  const dayMs = 1000 * 60 * 60 * 24;

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

    const taskDate = new Date(task.dueDate);
    const taskMidnight = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate()).getTime();
    const diffDays = Math.round((taskMidnight - refMidnight) / dayMs);

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
 * Universal search filter across Clients, Meetings, Tasks, and Notes
 */
export function universalSearch(
  query: string,
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
  }
) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { clients: [], meetings: [], tasks: [], notes: [] };
  }

  const clients = data.clients.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.company && c.company.toLowerCase().includes(q)) ||
    (c.phone && c.phone.includes(q)) ||
    (c.notes && c.notes.toLowerCase().includes(q))
  );

  const meetings = data.meetings.filter(m =>
    m.title.toLowerCase().includes(q) ||
    (m.location && m.location.toLowerCase().includes(q)) ||
    (m.notes && m.notes.toLowerCase().includes(q))
  );

  const tasks = data.tasks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.description && t.description.toLowerCase().includes(q))
  );

  const notes = data.notes.filter(n =>
    n.title.toLowerCase().includes(q) ||
    n.content.toLowerCase().includes(q) ||
    n.tags.some(tag => tag.toLowerCase().includes(q))
  );

  return { clients, meetings, tasks, notes };
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
