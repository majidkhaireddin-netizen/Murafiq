import React, { useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  DailyCommandSummary,
  DailyTaskBucketKey,
  FollowUpPreferences,
  Meeting,
  Opportunity,
  ReminderItem,
  ReminderStatus,
  SnoozePreset,
} from '../../types';
import {
  OPPORTUNITY_STAGE_CONFIG,
  evaluateOpportunityFollowUpAlerts,
  isOpportunityClosed,
} from '../../utils/opportunities';
import {
  CLIENT_FOLLOW_UP_DISCLOSURE_AR,
  CategorizedDailyTasks,
  DailyClientFollowUpEntry,
  DailyUpcomingMeetingItem,
  EvaluatedRemindersResult,
  addCalendarDaysToKey,
  getDailyGreetingArabic,
  getTodayCalendarKey,
} from '../../utils/followUpEngine';
import {
  formatArabicDate,
  getHijriDateString,
  getRelativeTimeArabic,
} from '../../utils/logic';
import { MEETING_STATUS_LABELS } from '../../utils/meetingMinutes';
import { ProvenanceBadge } from '../ProvenanceBadge';
import {
  AlertCircle,
  Bell,
  BellOff,
  Briefcase,
  Calendar,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  Info,
  Plus,
  RotateCcw,
  Settings,
  StickyNote,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';

interface TodayViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  opportunities?: Opportunity[];
  categorizedDaily: CategorizedDailyTasks;
  upcomingMeetings: DailyUpcomingMeetingItem[];
  clientFollowUps: DailyClientFollowUpEntry[];
  evaluatedReminders: EvaluatedRemindersResult;
  summary: DailyCommandSummary;
  preferences: FollowUpPreferences;
  referenceDate: Date;
  showHijri: boolean;
  language: 'ar' | 'en';
  isOnline: boolean;
  collectionsLoaded: {
    clients: boolean;
    meetings: boolean;
    tasks: boolean;
    reminders: boolean;
    preferences: boolean;
  };
  hasSyncError: boolean;
  hasPendingWrites: boolean;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (task: ActionItem) => void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onSelectMeeting: (meeting: Meeting) => void;
  onSelectClient: (client: Client) => void;
  onSelectOpportunity?: (opportunity: Opportunity) => void;
  onNewTask: (clientId?: string) => void;
  onNewMeeting: (clientId?: string) => void;
  onNewNote: (clientId?: string) => void;
  onOpenReminderSource: (reminder: ReminderItem) => void;
  onSnoozeReminder: (
    reminder: ReminderItem,
    preset: SnoozePreset,
    customDateTime?: string
  ) => { ok: boolean; errorArabic?: string };
  onUnsnoozeReminder: (reminder: ReminderItem) => void;
  onDismissReminder: (reminder: ReminderItem) => void;
  onOpenSettings: () => void;
}

const BUCKET_META: Array<{
  key: DailyTaskBucketKey;
  labelAr: string;
  labelEn: string;
  toneClass: string;
}> = [
  { key: 'overdue', labelAr: 'متأخرة', labelEn: 'Overdue', toneClass: 'text-rose-700' },
  { key: 'today', labelAr: 'اليوم', labelEn: 'Today', toneClass: 'text-emerald-800' },
  { key: 'tomorrow', labelAr: 'غدًا', labelEn: 'Tomorrow', toneClass: 'text-amber-800' },
  { key: 'this_week', labelAr: 'هذا الأسبوع', labelEn: 'This Week', toneClass: 'text-stone-800' },
  { key: 'later', labelAr: 'لاحقًا', labelEn: 'Later', toneClass: 'text-stone-600' },
  {
    key: 'no_due_date',
    labelAr: 'بلا تاريخ استحقاق',
    labelEn: 'No Due Date',
    toneClass: 'text-stone-500',
  },
];

const PRIORITY_LABEL_AR: Record<ActionItem['priority'], { label: string; cls: string }> = {
  urgent: { label: 'عاجل', cls: 'text-rose-700 font-bold' },
  high: { label: 'مرتفعة', cls: 'text-amber-800 font-semibold' },
  medium: { label: 'متوسطة', cls: 'text-stone-600 font-medium' },
  low: { label: 'منخفضة', cls: 'text-stone-500' },
};

export const TodayView: React.FC<TodayViewProps> = ({
  clients,
  opportunities = [],
  categorizedDaily,
  upcomingMeetings,
  clientFollowUps,
  evaluatedReminders,
  summary,
  preferences,
  referenceDate,
  showHijri,
  language,
  isOnline,
  collectionsLoaded,
  hasSyncError,
  hasPendingWrites,
  onToggleTask,
  onOpenTask,
  onSaveTask,
  onSelectMeeting,
  onSelectClient,
  onSelectOpportunity,
  onNewTask,
  onNewMeeting,
  onNewNote,
  onOpenReminderSource,
  onSnoozeReminder,
  onUnsnoozeReminder,
  onDismissReminder,
  onOpenSettings,
}) => {
  const [selectedBucket, setSelectedBucket] = useState<'all' | DailyTaskBucketKey>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent_high'>('all');
  const [reminderTab, setReminderTab] = useState<ReminderStatus>('active');
  const [snoozePickerId, setSnoozePickerId] = useState<string | null>(null);
  const [customSnoozeValue, setCustomSnoozeValue] = useState<string>('');
  const [snoozeError, setSnoozeError] = useState<string | null>(null);

  const clientsById = useMemo(
    () => new Map<string, Client>(clients.map((c) => [c.id, c])),
    [clients]
  );

  const todayKey = getTodayCalendarKey(referenceDate);
  const tomorrowKey = addCalendarDaysToKey(todayKey, 1);
  const plus3DaysKey = addCalendarDaysToKey(todayKey, 3);
  const gregorianDateStr = formatArabicDate(referenceDate.toISOString(), false);
  const hijriDateStr = showHijri ? getHijriDateString(referenceDate.toISOString()) : '';
  const greetingText = getDailyGreetingArabic(referenceDate, undefined, language);

  const isInitialLoading =
    !collectionsLoaded.clients || !collectionsLoaded.meetings || !collectionsLoaded.tasks;

  const filterTaskList = (items: ActionItem[]): ActionItem[] => {
    if (priorityFilter === 'all') return items;
    return items.filter((t) => t.priority === 'urgent' || t.priority === 'high');
  };

  const totalOpenTasks = useMemo(
    () =>
      BUCKET_META.reduce(
        (sum, b) => sum + filterTaskList(categorizedDaily.byBucket[b.key]).length,
        0
      ),
    [categorizedDaily, priorityFilter]
  );

  const visibleBuckets = useMemo(() => {
    const base =
      selectedBucket === 'all'
        ? BUCKET_META
        : BUCKET_META.filter((b) => b.key === selectedBucket);
    return base
      .map((b) => ({
        ...b,
        items: filterTaskList(categorizedDaily.byBucket[b.key]),
      }))
      .filter((b) => selectedBucket !== 'all' || b.items.length > 0);
  }, [selectedBucket, categorizedDaily, priorityFilter]);

  const handleQuickReschedule = (task: ActionItem, targetDateKey: string) => {
    void onSaveTask({
      ...task,
      dueDate: targetDateKey,
    });
  };

  const handleApplySnooze = (
    reminder: ReminderItem,
    preset: SnoozePreset,
    customValue?: string
  ) => {
    const result = onSnoozeReminder(reminder, preset, customValue);
    if (!result.ok) {
      setSnoozeError(result.errorArabic || 'تعذر تأجيل التذكير.');
      return;
    }
    setSnoozeError(null);
    setSnoozePickerId(null);
    setCustomSnoozeValue('');
  };

  const activeTabReminders: ReminderItem[] =
    reminderTab === 'active'
      ? evaluatedReminders.active
      : reminderTab === 'snoozed'
      ? evaluatedReminders.snoozed
      : reminderTab === 'resolved'
      ? evaluatedReminders.resolved
      : evaluatedReminders.invalidated;

  const opportunitiesNeedingFollowUp = useMemo(() => {
    return opportunities
      .filter((opp) => !isOpportunityClosed(opp.stage))
      .map((opp) => ({
        opportunity: opp,
        alerts: evaluateOpportunityFollowUpAlerts({ opportunity: opp, referenceDate }),
      }))
      .filter((item) => item.alerts.length > 0);
  }, [opportunities, referenceDate]);

  const getReminderTypeLabel = (rem: ReminderItem) => {
    if (rem.sourceType === 'task') return 'مهمة';
    if (rem.sourceType === 'meeting') return 'اجتماع';
    if (rem.sourceType === 'opportunity') return 'فرصة';
    return 'عميل';
  };

  return (
    <div data-testid="today-command-center" className="space-y-5 pb-6">
      {/* 1. Greeting, Date & Quick Actions */}
      <section className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-emerald-700 shrink-0" />
              <h2 className="font-heading font-extrabold text-lg sm:text-xl text-stone-900">
                {greetingText}
              </h2>
            </div>
            <div className="flex items-center flex-wrap gap-2 text-xs text-stone-600">
              <span className="font-medium text-stone-800">{gregorianDateStr}</span>
              {showHijri && hijriDateStr && (
                <>
                  <span className="text-stone-300" aria-hidden="true">
                    •
                  </span>
                  <span className="text-stone-600">{hijriDateStr}</span>
                </>
              )}
              {hasPendingWrites && (
                <>
                  <span className="text-stone-300" aria-hidden="true">
                    •
                  </span>
                  <span className="text-amber-700 font-semibold">
                    تغييرات بانتظار المزامنة
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] text-stone-500">
              التذكيرات تعمل داخل التطبيق أثناء الجلسة وتستند إلى مهامك واجتماعاتك المسجّلة فقط.
            </p>
          </div>

          {/* Reuses existing creation pipelines */}
          <div className="flex items-center flex-wrap gap-2 shrink-0">
            <button
              type="button"
              data-testid="today-quick-new-task"
              onClick={() => onNewTask()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>مهمة جديدة</span>
            </button>
            <button
              type="button"
              data-testid="today-quick-new-meeting"
              onClick={() => onNewMeeting()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-800 text-xs font-semibold transition-colors"
            >
              <Calendar className="w-3.5 h-3.5 text-emerald-700" />
              <span>اجتماع جديد</span>
            </button>
            <button
              type="button"
              data-testid="today-quick-new-note"
              onClick={() => onNewNote()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-800 text-xs font-semibold transition-colors"
            >
              <StickyNote className="w-3.5 h-3.5 text-amber-700" />
              <span>ملاحظة عميل</span>
            </button>
          </div>
        </div>

        {/* Honest Loading / Offline / Sync Error Notices */}
        {(isInitialLoading || hasSyncError || !isOnline) && (
          <div className="space-y-1.5 pt-2 border-t border-stone-100 text-[11px]">
            {isInitialLoading && (
              <p className="text-stone-500">
                جارٍ مزامنة بيانات المهام والاجتماعات والعملاء من السحابة...
              </p>
            )}
            {!isOnline && (
              <div className="flex items-center gap-1.5 text-amber-800 font-medium">
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span>
                  العمل محلياً دون اتصال: حسابات التذكيرات وتأجيلها محفوظة مؤقتاً حتى عودة الشبكة.
                </span>
              </div>
            )}
            {hasSyncError && (
              <div className="flex items-center gap-1.5 text-rose-700 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  تعذر تحديث بعض مجموعات البيانات من السحابة؛ قد لا تعكس القائمة أحدث التعديلات السحابية.
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. ملخص اليوم (6 Live Derived KPI Cards) */}
      <section aria-label="ملخص اليوم" data-testid="today-summary-kpis" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-bold text-sm text-stone-900">ملخص اليوم</h3>
          <span className="text-[11px] text-stone-500">أرقام مشتقة مباشرة من سجلاتك</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <button
            type="button"
            onClick={() => setSelectedBucket('today')}
            className="bg-white rounded-xl border border-stone-200 hover:border-emerald-300 p-3 text-start transition-colors"
          >
            <span className="text-[11px] font-medium text-stone-500 block">مهام اليوم</span>
            <span
              data-testid="kpi-due-today-tasks"
              className="font-heading font-extrabold text-xl text-emerald-800 mt-1 block tabular-nums"
            >
              {summary.dueTodayTasksCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedBucket('overdue')}
            className={`bg-white rounded-xl border p-3 text-start transition-colors ${
              summary.overdueTasksCount > 0
                ? 'border-rose-200 hover:border-rose-300'
                : 'border-stone-200 hover:border-stone-300'
            }`}
          >
            <span className="text-[11px] font-medium text-stone-500 block">مهام متأخرة</span>
            <span
              data-testid="kpi-overdue-tasks"
              className={`font-heading font-extrabold text-xl mt-1 block tabular-nums ${
                summary.overdueTasksCount > 0 ? 'text-rose-700' : 'text-stone-900'
              }`}
            >
              {summary.overdueTasksCount}
            </span>
          </button>

          <div className="bg-white rounded-xl border border-stone-200 p-3">
            <span className="text-[11px] font-medium text-stone-500 block">اجتماعات اليوم</span>
            <span
              data-testid="kpi-today-meetings"
              className="font-heading font-extrabold text-xl text-stone-900 mt-1 block tabular-nums"
            >
              {summary.todayMeetingsCount}
            </span>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 p-3">
            <span className="text-[11px] font-medium text-stone-500 block">اجتماعات قادمة</span>
            <span
              data-testid="kpi-upcoming-meetings"
              className="font-heading font-extrabold text-xl text-stone-900 mt-1 block tabular-nums"
            >
              {summary.upcomingMeetingsCount}
            </span>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 p-3">
            <span className="text-[11px] font-medium text-stone-500 block">متابعات مطلوبة</span>
            <span
              data-testid="kpi-followups-required"
              className={`font-heading font-extrabold text-xl mt-1 block tabular-nums ${
                summary.followUpsRequiredCount > 0 ? 'text-amber-800' : 'text-stone-900'
              }`}
            >
              {summary.followUpsRequiredCount}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedBucket('all');
              setPriorityFilter((prev) => (prev === 'urgent_high' ? 'all' : 'urgent_high'));
            }}
            className="bg-white rounded-xl border border-stone-200 hover:border-amber-300 p-3 text-start transition-colors"
          >
            <span className="text-[11px] font-medium text-stone-500 block">عالية / عاجلة</span>
            <span
              data-testid="kpi-high-priority-tasks"
              className="font-heading font-extrabold text-xl text-stone-900 mt-1 block tabular-nums"
            >
              {summary.highPriorityTasksCount}
            </span>
          </button>
        </div>
      </section>

      {/* 3. Main Two-Column Operational Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Right/Primary Column (7 cols): Daily Work Queue + Upcoming Meetings */}
        <div className="lg:col-span-7 space-y-5">
          {/* «ما الذي عليك إنجازه؟» */}
          <section
            data-testid="today-work-queue"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-heading font-bold text-sm text-stone-900">
                  ما الذي عليك إنجازه؟
                </h3>
                <p className="text-[11px] text-stone-500">
                  قائمة العمل اليومية مرتبة حسب الاستحقاق والأولوية ({totalOpenTasks})
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setPriorityFilter((prev) => (prev === 'all' ? 'urgent_high' : 'all'))
                  }
                  className={`px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                    priorityFilter === 'urgent_high'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  {priorityFilter === 'urgent_high' ? 'عاجلة وعالية فقط' : 'جميع الأولويات'}
                </button>
              </div>
            </div>

            {/* 6-Bucket Filter Strip */}
            <div className="flex items-center flex-wrap gap-1.5 pb-1 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedBucket('all')}
                className={`px-2.5 py-1 rounded-lg border font-semibold whitespace-nowrap transition-colors ${
                  selectedBucket === 'all'
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                }`}
              >
                الكل ({totalOpenTasks})
              </button>
              {BUCKET_META.map((b) => {
                const count = filterTaskList(categorizedDaily.byBucket[b.key]).length;
                const active = selectedBucket === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    data-testid={`bucket-filter-${b.key}`}
                    onClick={() => setSelectedBucket(b.key)}
                    className={`px-2.5 py-1 rounded-lg border font-medium whitespace-nowrap transition-colors tabular-nums ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {b.labelAr} ({count})
                  </button>
                );
              })}
            </div>

            {/* Task Buckets */}
            {totalOpenTasks === 0 ? (
              <div
                data-testid="today-tasks-empty"
                className="py-8 text-center border border-dashed border-stone-200 rounded-xl space-y-2"
              >
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-stone-800">
                  لا توجد مهام مفتوحة في قائمة العمل الآن
                </p>
                <p className="text-[11px] text-stone-500">
                  أضف مهمة جديدة أو سجّل محضر اجتماع لاستخراج الالتزامات تلقائياً.
                </p>
              </div>
            ) : visibleBuckets.length === 0 ? (
              <div className="py-6 text-center border border-dashed border-stone-200 rounded-xl text-xs text-stone-500">
                لا توجد مهام ضمن هذا التصنيف حالياً.
              </div>
            ) : (
              <div className="space-y-4">
                {visibleBuckets.map((bucket) => (
                  <div
                    key={bucket.key}
                    data-testid={`task-bucket-${bucket.key}`}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-bold ${bucket.toneClass}`}>
                        {bucket.labelAr}
                      </span>
                      <span className="text-[11px] text-stone-400 tabular-nums">
                        {bucket.items.length}
                      </span>
                    </div>

                    {bucket.items.length === 0 ? (
                      <p className="text-[11px] text-stone-400 py-2">
                        لا توجد مهام في هذا القسم.
                      </p>
                    ) : (
                      <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                        {bucket.items.map((task) => {
                          const client = clientsById.get(task.clientId);
                          const prio = PRIORITY_LABEL_AR[task.priority];
                          return (
                            <div
                              key={task.id}
                              data-testid={`today-task-row-${task.id}`}
                              className="p-3 bg-white hover:bg-stone-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <button
                                  type="button"
                                  data-testid={`toggle-task-${task.id}`}
                                  onClick={() => onToggleTask(task.id)}
                                  aria-label={`إكمال مهمة ${task.title}`}
                                  className="mt-0.5 w-4 h-4 rounded border border-stone-300 hover:border-emerald-600 flex items-center justify-center shrink-0 bg-white"
                                />
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => onOpenTask(task)}
                                      className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start"
                                    >
                                      {task.title}
                                    </button>
                                    {task.provenance && task.provenance !== 'approved' && (
                                      <ProvenanceBadge type={task.provenance} />
                                    )}
                                  </div>
                                  <div className="flex items-center flex-wrap gap-2 text-[11px] text-stone-500">
                                    <span className={prio.cls}>{prio.label}</span>
                                    {client && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <button
                                          type="button"
                                          onClick={() => onSelectClient(client)}
                                          className="text-stone-700 hover:text-emerald-800 font-medium"
                                        >
                                          {client.name}
                                        </button>
                                      </>
                                    )}
                                    {task.dueDate && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="tabular-nums">
                                          {getRelativeTimeArabic(task.dueDate, referenceDate)} (
                                          {formatArabicDate(task.dueDate, false)})
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Quick Reschedule Actions (writes task.dueDate directly) */}
                              <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                                {task.dueDate !== todayKey && (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickReschedule(task, todayKey)}
                                    className="px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-700"
                                  >
                                    اليوم
                                  </button>
                                )}
                                {task.dueDate !== tomorrowKey && (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickReschedule(task, tomorrowKey)}
                                    className="px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-700"
                                  >
                                    غدًا
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleQuickReschedule(task, plus3DaysKey)}
                                  className="px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-700 tabular-nums"
                                >
                                  +3 أيام
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* الاجتماعات القادمة */}
          <section
            data-testid="today-upcoming-meetings"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-heading font-bold text-sm text-stone-900">
                  الاجتماعات القادمة
                </h3>
                <p className="text-[11px] text-stone-500">
                  مرتبة زمنياً (باستثناء اللقاءات المكتملة والملغاة)
                </p>
              </div>
              <span className="text-xs font-bold text-stone-600 tabular-nums">
                {upcomingMeetings.length}
              </span>
            </div>

            {upcomingMeetings.length === 0 ? (
              <div
                data-testid="today-meetings-empty"
                className="py-6 text-center border border-dashed border-stone-200 rounded-xl space-y-1.5"
              >
                <Calendar className="w-6 h-6 text-stone-400 mx-auto" />
                <p className="text-xs font-semibold text-stone-700">
                  لا توجد اجتماعات قادمة مجدولة
                </p>
                <button
                  type="button"
                  onClick={() => onNewMeeting()}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  جدولة اجتماع جديد
                </button>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                {upcomingMeetings.map((item) => {
                  const clientObj = clientsById.get(item.meeting.clientId);
                  const statusInfo =
                    MEETING_STATUS_LABELS[item.meeting.status] ||
                    MEETING_STATUS_LABELS.confirmed;
                  return (
                    <div
                      key={item.meeting.id}
                      data-testid={`today-meeting-row-${item.meeting.id}`}
                      className="p-3 bg-white hover:bg-stone-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectMeeting(item.meeting)}
                            className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start"
                          >
                            {item.meeting.title}
                          </button>
                          {item.isImminent && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                              قريب الآن
                            </span>
                          )}
                        </div>
                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-stone-500">
                          {clientObj ? (
                            <button
                              type="button"
                              onClick={() => onSelectClient(clientObj)}
                              className="text-stone-700 hover:text-emerald-800 font-medium"
                            >
                              {item.clientName}
                            </button>
                          ) : (
                            <span>{item.clientName}</span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {formatArabicDate(item.meeting.dateTime, true)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-stone-700">{statusInfo.ar}</span>
                          {item.meeting.duration ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{item.meeting.duration} د</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => onSelectMeeting(item.meeting)}
                          className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-[11px] font-semibold"
                        >
                          فتح الاجتماع
                        </button>
                        {clientObj && (
                          <button
                            type="button"
                            onClick={() => onSelectClient(clientObj)}
                            className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-[11px] font-medium"
                          >
                            ملف العميل
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Left/Secondary Column (5 cols): Reminders Center + Client Follow-Ups */}
        <div className="lg:col-span-5 space-y-5">
          {/* التذكيرات داخل التطبيق */}
          <section
            data-testid="today-reminders-panel"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
              <div className="flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-emerald-700" />
                <h3 className="font-heading font-bold text-sm text-stone-900">التذكيرات</h3>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-600 hover:text-emerald-800"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>تفضيلات التذكير</span>
              </button>
            </div>

            {!preferences.remindersEnabled ? (
              <div
                data-testid="reminders-disabled-notice"
                className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-center space-y-2"
              >
                <BellOff className="w-6 h-6 text-stone-400 mx-auto" />
                <p className="text-xs font-bold text-stone-800">
                  التذكيرات متوقفة حالياً من الإعدادات
                </p>
                <p className="text-[11px] text-stone-500">
                  تظل جميع المهام والاجتماعات وسجلات العملاء محفوظة بشكل طبيعي في قائمة العمل.
                </p>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                >
                  تفعيل التذكيرات من الإعدادات
                </button>
              </div>
            ) : (
              <>
                {/* 4 Reminder States Filter */}
                <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl text-[11px]">
                  {(
                    [
                      { key: 'active', label: 'نشط', count: evaluatedReminders.active.length },
                      { key: 'snoozed', label: 'مؤجل', count: evaluatedReminders.snoozed.length },
                      {
                        key: 'resolved',
                        label: 'معالج',
                        count: evaluatedReminders.resolved.length,
                      },
                      {
                        key: 'invalidated',
                        label: 'غير صالح',
                        count: evaluatedReminders.invalidated.length,
                      },
                    ] as Array<{ key: ReminderStatus; label: string; count: number }>
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      data-testid={`reminder-status-tab-${tab.key}`}
                      onClick={() => setReminderTab(tab.key)}
                      className={`py-1.5 px-1.5 rounded-lg font-semibold transition-colors tabular-nums truncate ${
                        reminderTab === tab.key
                          ? 'bg-white text-stone-900 shadow-2xs'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>

                {activeTabReminders.length === 0 ? (
                  <div
                    data-testid="today-reminders-empty"
                    className="py-6 text-center border border-dashed border-stone-200 rounded-xl text-xs text-stone-500"
                  >
                    {reminderTab === 'active'
                      ? 'لا توجد تذكيرات نشطة الآن.'
                      : reminderTab === 'snoozed'
                      ? 'لا توجد تذكيرات مؤجلة.'
                      : reminderTab === 'resolved'
                      ? 'لا توجد تذكيرات معالجة.'
                      : 'لا توجد تذكيرات ملغاة أو منتهية الصلاحية.'}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeTabReminders.map((rem) => {
                      const isSnoozeOpen = snoozePickerId === rem.id;
                      return (
                        <div
                          key={rem.id}
                          data-testid={`reminder-card-${rem.id}`}
                          className="p-3 rounded-xl border border-stone-200 bg-white space-y-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => onOpenReminderSource(rem)}
                                className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start"
                              >
                                {rem.titleArabic}
                              </button>
                              <span
                                className={`text-[10px] font-semibold shrink-0 ${
                                  rem.status === 'invalidated'
                                    ? 'text-stone-400'
                                    : rem.severity === 'high'
                                    ? 'text-rose-700'
                                    : 'text-amber-800'
                                }`}
                              >
                                {getReminderTypeLabel(rem)}
                              </span>
                            </div>

                            <div className="text-[11px] text-stone-500 flex items-center flex-wrap gap-1.5">
                              {rem.clientName && <span>{rem.clientName}</span>}
                              {rem.dueAt && (
                                <>
                                  {rem.clientName && <span aria-hidden="true">·</span>}
                                  <span className="tabular-nums">
                                    {formatArabicDate(rem.dueAt, rem.sourceType === 'meeting')}
                                  </span>
                                </>
                              )}
                            </div>

                            <p className="text-[11px] text-stone-700">{rem.subtitleArabic}</p>

                            {rem.status === 'snoozed' && rem.snoozedUntil && (
                              <p className="text-[11px] text-amber-800 font-medium tabular-nums">
                                مؤجل حتى {formatArabicDate(rem.snoozedUntil, true)}
                              </p>
                            )}

                            {rem.status === 'invalidated' && rem.invalidationReasonArabic && (
                              <p className="text-[11px] text-stone-500">
                                {rem.invalidationReasonArabic}
                              </p>
                            )}

                            {rem.basisDisclosureArabic && rem.status === 'active' && (
                              <p className="text-[10px] text-stone-500 leading-relaxed pt-0.5">
                                {rem.basisDisclosureArabic}
                              </p>
                            )}
                          </div>

                          {/* Reminder Actions */}
                          {rem.status === 'active' && (
                            <div className="space-y-2 pt-1 border-t border-stone-100">
                              <div className="flex items-center justify-between flex-wrap gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    data-testid={`snooze-toggle-${rem.id}`}
                                    onClick={() => {
                                      setSnoozeError(null);
                                      setSnoozePickerId((prev) =>
                                        prev === rem.id ? null : rem.id
                                      );
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-[11px] font-medium text-stone-800"
                                  >
                                    <Clock className="w-3 h-3 text-stone-600" />
                                    <span>ذكّرني لاحقًا</span>
                                  </button>
                                  <button
                                    type="button"
                                    data-testid={`dismiss-reminder-${rem.id}`}
                                    onClick={() => onDismissReminder(rem)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[11px] font-medium text-stone-600"
                                  >
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>تمت المعالجة</span>
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onOpenReminderSource(rem)}
                                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                                >
                                  فتح السجل
                                </button>
                              </div>

                              {/* 5-Option Snooze Picker (Never mutates task.dueDate) */}
                              {isSnoozeOpen && (
                                <div
                                  data-testid={`snooze-options-${rem.id}`}
                                  className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2"
                                >
                                  <p className="text-[10px] text-stone-500">
                                    يؤجّل التنبيه فقط دون تعديل تاريخ استحقاق المهمة أو إنشاء مهمة مكررة.
                                  </p>
                                  <div className="flex items-center flex-wrap gap-1.5">
                                    {(
                                      [
                                        { preset: '1h', label: 'بعد ساعة' },
                                        { preset: 'tomorrow', label: 'غدًا' },
                                        { preset: '3d', label: 'بعد 3 أيام' },
                                        { preset: 'next_week', label: 'الأسبوع القادم' },
                                      ] as Array<{ preset: SnoozePreset; label: string }>
                                    ).map((opt) => (
                                      <button
                                        key={opt.preset}
                                        type="button"
                                        data-testid={`snooze-preset-${opt.preset}-${rem.id}`}
                                        onClick={() => handleApplySnooze(rem, opt.preset)}
                                        className="px-2 py-1 rounded-lg bg-white border border-stone-200 hover:border-emerald-400 text-[11px] font-medium text-stone-800"
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="flex items-center gap-1.5 pt-1">
                                    <input
                                      type="datetime-local"
                                      aria-label="تحديد موعد مخصص للتأجيل"
                                      value={customSnoozeValue}
                                      onChange={(e) => {
                                        setSnoozeError(null);
                                        setCustomSnoozeValue(e.target.value);
                                      }}
                                      dir="ltr"
                                      className="flex-1 min-w-0 bg-white border border-stone-200 rounded-lg px-2 py-1 text-[11px] text-stone-800"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleApplySnooze(rem, 'custom', customSnoozeValue)
                                      }
                                      className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-[11px] font-semibold shrink-0"
                                    >
                                      تحديد موعد
                                    </button>
                                  </div>
                                  {snoozeError && (
                                    <p className="text-[11px] text-rose-700 font-medium">
                                      {snoozeError}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {(rem.status === 'snoozed' || rem.status === 'resolved') && (
                            <div className="flex items-center justify-between pt-1 border-t border-stone-100">
                              <button
                                type="button"
                                onClick={() => onUnsnoozeReminder(rem)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-700 hover:text-emerald-800"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>
                                  {rem.status === 'snoozed' ? 'إلغاء التأجيل' : 'إعادة التفعيل'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenReminderSource(rem)}
                                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                              >
                                فتح السجل
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          {/* متابعات وتنبيهات العملاء (Reuses Client 360 Engine) */}
          <section
            data-testid="today-client-followups"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-700" />
                <h3 className="font-heading font-bold text-sm text-stone-900">
                  متابعات العملاء
                </h3>
              </div>
              <span className="text-xs font-bold text-stone-600 tabular-nums">
                {clientFollowUps.length}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-[11px] text-stone-600 flex items-start gap-2 leading-relaxed">
              <Info className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
              <span>{CLIENT_FOLLOW_UP_DISCLOSURE_AR}</span>
            </div>

            {clientFollowUps.length === 0 ? (
              <div className="py-6 text-center border border-dashed border-stone-200 rounded-xl space-y-1">
                <Users className="w-6 h-6 text-stone-400 mx-auto" />
                <p className="text-xs font-semibold text-stone-700">
                  لا توجد متابعات عاجلة للعملاء حالياً
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                {clientFollowUps.map((entry) => (
                  <div
                    key={entry.client.id}
                    data-testid={`client-followup-${entry.client.id}`}
                    className="p-3 bg-white space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectClient(entry.client)}
                          className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start block truncate"
                        >
                          {entry.client.name}
                        </button>
                        {entry.client.company && (
                          <span className="text-[11px] text-stone-500 block truncate">
                            {entry.client.company}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold shrink-0 ${
                          entry.severity === 'high' ? 'text-rose-700' : 'text-amber-800'
                        }`}
                      >
                        {entry.severity === 'high' ? 'أولوية مرتفعة' : 'للمتابعة'}
                      </span>
                    </div>

                    <p className="text-[11px] text-stone-700 leading-relaxed">
                      {entry.reasonsArabic.join(' • ')}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onSelectClient(entry.client)}
                        className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        فتح ملف العميل 360
                      </button>
                      <button
                        type="button"
                        onClick={() => onNewMeeting(entry.client.id)}
                        className="px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-[11px] font-medium text-stone-800"
                      >
                        جدولة اجتماع
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* فرص الأعمال التي تتطلب متابعة */}
          <section
            data-testid="today-opportunity-followups"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-emerald-700" />
                <h3 className="font-heading font-bold text-sm text-stone-900">
                  فرص الأعمال للمتابعة
                </h3>
              </div>
              <span className="text-xs font-bold text-stone-600 tabular-nums">
                {opportunitiesNeedingFollowUp.length}
              </span>
            </div>

            {opportunitiesNeedingFollowUp.length === 0 ? (
              <div className="py-5 text-center border border-dashed border-stone-200 rounded-xl space-y-1">
                <Briefcase className="w-5 h-5 text-stone-400 mx-auto" />
                <p className="text-xs font-semibold text-stone-700">
                  جميع الفرص المفتوحة محدّثة ولا توجد خطوات متأخرة
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                {opportunitiesNeedingFollowUp.map(({ opportunity: opp, alerts }) => {
                  const clientObj = clientsById.get(opp.clientId);
                  const stCfg = OPPORTUNITY_STAGE_CONFIG[opp.stage];
                  return (
                    <div
                      key={opp.id}
                      data-testid={`today-opp-followup-${opp.id}`}
                      className="p-3 bg-white space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectOpportunity && onSelectOpportunity(opp)}
                            className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start block truncate"
                          >
                            {opp.title}
                          </button>
                          <span className="text-[11px] text-stone-500 block truncate">
                            {clientObj ? clientObj.name : 'عميل محذوف أو غير متوفر'}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${stCfg.badgeClass}`}
                        >
                          {stCfg.labelAr}
                        </span>
                      </div>

                      <p className="text-[11px] text-amber-800 font-medium">
                        {alerts.map((a) => a.messageArabic).join(' • ')}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => onSelectOpportunity && onSelectOpportunity(opp)}
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          فتح الفرصة
                        </button>
                        {clientObj && (
                          <button
                            type="button"
                            onClick={() => onSelectClient(clientObj)}
                            className="text-[11px] font-medium text-stone-600 hover:text-stone-900"
                          >
                            ملف العميل
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
