import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionItem,
  CalendarConflictPair,
  CalendarDefaultBlockMinutes,
  CalendarEventItem,
  CalendarFilterScope,
  CalendarSettings,
  CalendarTimeFormat,
  CalendarViewMode,
  CalendarWeekStartDay,
  Client,
  CommunicationInteraction,
  Meeting,
  Opportunity,
} from '../../types';
import {
  ACTIVITY_TYPE_META,
  AVAILABLE_SLOTS_DISCLOSURE_AR,
  MEETING_RESCHEDULE_DISCLOSURE_AR,
  applyMeetingReschedule,
  assignTaskTimeBlock,
  buildCalendarEvents,
  buildMonthCalendarGrid,
  buildWeekDaysRange,
  buildWeeklyPlanData,
  clearTaskTimeBlock,
  computeDayAvailableSlots,
  decodeTaskTimeBlockFromFirestore,
  detectCalendarConflicts,
  extractZonedHourAndMinute,
  formatDayHeaderAr,
  formatHourMinuteLabel,
  formatMonthYearHeaderAr,
  formatTimeInZone,
  getLocalTimeZoneName,
  getOrderedWeekDaysMeta,
  navigateCalendarDate,
} from '../../utils/calendarEngine';
import {
  buildZonedDate,
  extractZonedCalendarParts,
  formatCalendarDateKey,
  parseDateOnlyString,
} from '../../utils/followUpEngine';
import {
  AlertTriangle,
  Briefcase,
  Calendar as CalendarIcon,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Filter,
  Info,
  LayoutGrid,
  ListTodo,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';

export interface CalendarNavigationTrigger {
  mode?: CalendarViewMode;
  dateKey?: string;
  clientId?: string;
  scheduleTaskId?: string;
  nonce: number;
}

interface CalendarViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  opportunities: Opportunity[];
  interactions?: CommunicationInteraction[];
  currentUserId: string;
  referenceDate: Date;
  isOnline: boolean;
  collectionsLoaded: {
    clients: boolean;
    meetings: boolean;
    tasks: boolean;
    opportunities: boolean;
    interactions?: boolean;
  };
  hasPendingWrites: boolean;
  calendarSettings: CalendarSettings;
  onUpdateCalendarSettings: (next: Partial<CalendarSettings>) => void;
  onSaveMeeting: (meeting: Meeting) => Promise<void> | void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onToggleTask: (taskId: string) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onPrepareMeeting?: (meeting: Meeting) => void;
  onOpenTask: (task: ActionItem) => void;
  onOpenClient: (client: Client) => void;
  onOpenOpportunity: (opportunity: Opportunity) => void;
  onCreateNewMeeting: (params: {
    clientId?: string;
    dateTimeIso?: string;
  }) => void;
  onCreateNewTask: (params: {
    clientId?: string;
    dueDate?: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
  }) => void;
  navigationTrigger?: CalendarNavigationTrigger | null;
  language: 'ar' | 'en';
}

interface RescheduleModalState {
  kind: 'meeting' | 'task_block';
  title: string;
  meeting?: Meeting;
  task?: ActionItem;
  previousStartIso?: string;
  previousEndIso?: string;
  previousDuration?: number;
  targetDateKey: string;
  targetStartTime: string; // HH:MM
  targetDurationMinutes: number;
  confirmReopenFinalMinutes: boolean;
  fromDragAndDrop: boolean;
  errorAr?: string | null;
}

interface QuickSlotModalState {
  dateKey: string;
  hour: number;
  selectedTaskId: string;
  durationMinutes: number;
  errorAr?: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function extractLocalTimeHHMM(isoOrDate?: string, timeZone?: string): string {
  if (!isoOrDate) return '10:00';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '10:00';
  const { hour, minute } = extractZonedHourAndMinute(d, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  clients,
  meetings,
  tasks,
  opportunities,
  interactions = [],
  currentUserId,
  referenceDate,
  isOnline,
  collectionsLoaded,
  hasPendingWrites,
  calendarSettings,
  onUpdateCalendarSettings,
  onSaveMeeting,
  onSaveTask,
  onToggleTask,
  onOpenMeeting,
  onPrepareMeeting,
  onOpenTask,
  onOpenClient,
  onOpenOpportunity,
  onCreateNewMeeting,
  onCreateNewTask,
  navigationTrigger,
  language,
}) => {
  const localTimeZone = useMemo(() => getLocalTimeZoneName(), []);
  const todayParts = useMemo(
    () => extractZonedCalendarParts(referenceDate, localTimeZone),
    [referenceDate, localTimeZone]
  );
  const todayKey = useMemo(() => formatCalendarDateKey(todayParts), [todayParts]);

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [filterScope, setFilterScope] = useState<CalendarFilterScope>('all');
  const [clientIdFilter, setClientIdFilter] = useState<string>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [showConflictsPanel, setShowConflictsPanel] = useState<boolean>(false);
  const [actionBannerNotice, setActionBannerNotice] = useState<string | null>(null);

  // Reschedule / Time Block Modal state (always previews Previous vs New before saving)
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleModalState | null>(null);

  // Quick Slot Creation / Schedule Existing Task Modal
  const [quickSlotModal, setQuickSlotModal] = useState<QuickSlotModalState | null>(null);

  // Drag & Drop active item tracking
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);

  // Handle external navigation triggers (e.g., from TodayView, Client 360, or TasksView)
  useEffect(() => {
    if (!navigationTrigger || navigationTrigger.nonce <= 0) return;
    if (navigationTrigger.mode) {
      setViewMode(navigationTrigger.mode);
    }
    if (navigationTrigger.dateKey && parseDateOnlyString(navigationTrigger.dateKey)) {
      setSelectedDateKey(navigationTrigger.dateKey);
    }
    if (navigationTrigger.clientId) {
      setClientIdFilter(navigationTrigger.clientId);
    } else if (navigationTrigger.clientId === '') {
      setClientIdFilter('all');
    }
    if (navigationTrigger.scheduleTaskId) {
      const targetTask = tasks.find((t) => t.id === navigationTrigger.scheduleTaskId);
      if (targetTask) {
        const hydrated = decodeTaskTimeBlockFromFirestore(targetTask);
        openTaskTimeBlockModal(hydrated, navigationTrigger.dateKey || todayKey, 10, false);
      }
    }
  }, [navigationTrigger?.nonce]);

  const clientsById = useMemo(
    () => new Map<string, Client>(clients.map((c) => [c.id, c])),
    [clients]
  );

  // Build unified calendar events
  const allEvents = useMemo(
    () =>
      buildCalendarEvents({
        clients,
        meetings,
        tasks,
        opportunities,
        interactions,
        currentUserId,
        referenceDate,
        timeZone: localTimeZone,
        settings: calendarSettings,
        filterScope,
        clientIdFilter,
      }),
    [
      clients,
      meetings,
      tasks,
      opportunities,
      interactions,
      currentUserId,
      referenceDate,
      localTimeZone,
      calendarSettings,
      filterScope,
      clientIdFilter,
    ]
  );

  // Detect conflicts across all active events (independent of narrow activity scope filter so user never misses a real conflict)
  const unfilteredActiveEvents = useMemo(
    () =>
      buildCalendarEvents({
        clients,
        meetings,
        tasks,
        opportunities,
        currentUserId,
        referenceDate,
        timeZone: localTimeZone,
        settings: {
          ...calendarSettings,
          showMeetings: true,
          showTasks: true,
        },
        filterScope: 'all',
        clientIdFilter,
      }),
    [
      clients,
      meetings,
      tasks,
      opportunities,
      currentUserId,
      referenceDate,
      localTimeZone,
      calendarSettings,
      clientIdFilter,
    ]
  );

  const allConflicts = useMemo(
    () => detectCalendarConflicts(unfilteredActiveEvents),
    [unfilteredActiveEvents]
  );

  const selectedDateParts = useMemo(
    () => parseDateOnlyString(selectedDateKey) || todayParts,
    [selectedDateKey, todayParts]
  );

  // Monthly grid
  const monthGridCells = useMemo(
    () =>
      buildMonthCalendarGrid({
        year: selectedDateParts.year,
        month: selectedDateParts.month,
        weekStartDay: calendarSettings.weekStartDay,
        events: allEvents,
        conflicts: allConflicts,
        referenceDate,
        timeZone: localTimeZone,
      }),
    [
      selectedDateParts.year,
      selectedDateParts.month,
      calendarSettings.weekStartDay,
      allEvents,
      allConflicts,
      referenceDate,
      localTimeZone,
    ]
  );

  // Weekly range
  const weekDaysRange = useMemo(
    () =>
      buildWeekDaysRange({
        anchorDateKey: selectedDateKey,
        weekStartDay: calendarSettings.weekStartDay,
        events: allEvents,
        conflicts: allConflicts,
        referenceDate,
        timeZone: localTimeZone,
      }),
    [
      selectedDateKey,
      calendarSettings.weekStartDay,
      allEvents,
      allConflicts,
      referenceDate,
      localTimeZone,
    ]
  );

  // Weekly Planner Data
  const weeklyPlanData = useMemo(
    () =>
      buildWeeklyPlanData({
        anchorDateKey: selectedDateKey,
        weekStartDay: calendarSettings.weekStartDay,
        events: allEvents,
        allTasks: tasks,
        currentUserId,
        referenceDate,
        timeZone: localTimeZone,
      }),
    [
      selectedDateKey,
      calendarSettings.weekStartDay,
      allEvents,
      tasks,
      currentUserId,
      referenceDate,
      localTimeZone,
    ]
  );

  // Selected Day Events & Available Slots
  const selectedDayEvents = useMemo(
    () => allEvents.filter((ev) => ev.dateKey === selectedDateKey),
    [allEvents, selectedDateKey]
  );

  const selectedDayConflicts = useMemo(
    () => allConflicts.filter((c) => c.dateKey === selectedDateKey),
    [allConflicts, selectedDateKey]
  );

  const selectedDayAvailableSlots = useMemo(
    () =>
      computeDayAvailableSlots({
        dateKey: selectedDateKey,
        events: unfilteredActiveEvents,
        workingDayStartHour: calendarSettings.workingDayStartHour,
        workingDayEndHour: calendarSettings.workingDayEndHour,
        minGapMinutes: 30,
        timeFormat: calendarSettings.timeFormat,
        timeZone: localTimeZone,
      }),
    [
      selectedDateKey,
      unfilteredActiveEvents,
      calendarSettings.workingDayStartHour,
      calendarSettings.workingDayEndHour,
      calendarSettings.timeFormat,
      localTimeZone,
    ]
  );

  const orderedWeekHeaderMeta = useMemo(
    () => getOrderedWeekDaysMeta(calendarSettings.weekStartDay),
    [calendarSettings.weekStartDay]
  );

  // Compute visible hour rows for Weekly/Daily views (expands if an event is outside default working hours)
  const visibleHours = useMemo(() => {
    let minH = calendarSettings.workingDayStartHour;
    let maxH = calendarSettings.workingDayEndHour;
    const relevantEvents =
      viewMode === 'day'
        ? selectedDayEvents
        : weekDaysRange.flatMap((d) => d.events);

    for (const ev of relevantEvents) {
      if (ev.isTimed && ev.startIso) {
        const { hour } = extractZonedHourAndMinute(new Date(ev.startIso), localTimeZone);
        if (hour < minH) minH = Math.max(0, hour);
        if (hour > maxH) maxH = Math.min(23, hour);
      }
    }
    const hours: number[] = [];
    for (let h = minH; h <= maxH; h++) {
      hours.push(h);
    }
    return hours;
  }, [
    calendarSettings.workingDayStartHour,
    calendarSettings.workingDayEndHour,
    viewMode,
    selectedDayEvents,
    weekDaysRange,
    localTimeZone,
  ]);

  // Eligible open tasks for scheduling a Time Block
  const eligibleTasksForScheduling = useMemo(() => {
    return tasks
      .map((t) => decodeTaskTimeBlockFromFirestore(t))
      .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
      .filter((t) => clientIdFilter === 'all' || t.clientId === clientIdFilter)
      .sort((a, b) => {
        const aHasBlock = Boolean(a.scheduledStartAt && a.scheduledEndAt);
        const bHasBlock = Boolean(b.scheduledStartAt && b.scheduledEndAt);
        if (aHasBlock !== bHasBlock) return aHasBlock ? 1 : -1;
        return a.title.localeCompare(b.title, 'ar');
      });
  }, [tasks, clientIdFilter]);

  const isInitialLoading =
    !collectionsLoaded.clients ||
    !collectionsLoaded.meetings ||
    !collectionsLoaded.tasks ||
    !collectionsLoaded.opportunities;

  // =========================================================================
  // Handlers for Rescheduling, Time-Blocking, Drag & Drop, and Navigation
  // =========================================================================

  const showNotice = (msg: string) => {
    setActionBannerNotice(msg);
    setTimeout(() => {
      setActionBannerNotice((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  function openMeetingRescheduleModal(
    meeting: Meeting,
    overrideDateKey?: string,
    overrideHour?: number,
    fromDragAndDrop: boolean = false
  ) {
    const mDateParts =
      resolveDatePartsSafe(meeting.dateTime, localTimeZone) || selectedDateParts;
    const targetDateKey = overrideDateKey || formatCalendarDateKey(mDateParts);
    const defaultTime =
      overrideHour !== undefined
        ? `${pad2(overrideHour)}:00`
        : extractLocalTimeHHMM(meeting.dateTime, localTimeZone);

    setRescheduleModal({
      kind: 'meeting',
      title: meeting.title,
      meeting,
      previousStartIso: meeting.dateTime,
      previousDuration: meeting.duration,
      targetDateKey,
      targetStartTime: defaultTime,
      targetDurationMinutes:
        meeting.duration && meeting.duration > 0
          ? meeting.duration
          : calendarSettings.defaultBlockMinutes,
      confirmReopenFinalMinutes: false,
      fromDragAndDrop,
      errorAr: null,
    });
  }

  function openTaskTimeBlockModal(
    rawTask: ActionItem,
    overrideDateKey?: string,
    overrideHour?: number,
    fromDragAndDrop: boolean = false
  ) {
    const task = decodeTaskTimeBlockFromFirestore(rawTask);
    const existingStart = task.scheduledStartAt;
    const existingEnd = task.scheduledEndAt;
    let defaultDateKey = overrideDateKey || selectedDateKey;
    if (!overrideDateKey && existingStart) {
      const parts = resolveDatePartsSafe(existingStart, localTimeZone);
      if (parts) defaultDateKey = formatCalendarDateKey(parts);
    } else if (!overrideDateKey && task.dueDate && parseDateOnlyString(task.dueDate)) {
      defaultDateKey = task.dueDate;
    }

    const defaultTime =
      overrideHour !== undefined
        ? `${pad2(overrideHour)}:00`
        : existingStart
        ? extractLocalTimeHHMM(existingStart, localTimeZone)
        : '10:00';

    let defaultDuration: number = calendarSettings.defaultBlockMinutes;
    if (existingStart && existingEnd) {
      const diffMin = Math.round(
        (new Date(existingEnd).getTime() - new Date(existingStart).getTime()) / 60000
      );
      if (diffMin >= 5 && diffMin <= 1440) {
        defaultDuration = diffMin;
      }
    }

    setRescheduleModal({
      kind: 'task_block',
      title: task.title,
      task,
      previousStartIso: existingStart,
      previousEndIso: existingEnd,
      targetDateKey: defaultDateKey,
      targetStartTime: defaultTime,
      targetDurationMinutes: defaultDuration,
      confirmReopenFinalMinutes: false,
      fromDragAndDrop,
      errorAr: null,
    });
  }

  function resolveDatePartsSafe(iso: string, tz?: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return extractZonedCalendarParts(d, tz);
  }

  const handleConfirmRescheduleOrTimeBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleModal) return;

    const parts = parseDateOnlyString(rescheduleModal.targetDateKey);
    const timeMatch = rescheduleModal.targetStartTime.match(/^(\d{2}):(\d{2})$/);
    if (!parts || !timeMatch) {
      setRescheduleModal((prev) =>
        prev ? { ...prev, errorAr: 'يرجى اختيار تاريخ ووقت صالحين.' } : null
      );
      return;
    }

    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const startDate = buildZonedDate(parts, hour, minute, localTimeZone);
    const durationMin = Math.round(Number(rescheduleModal.targetDurationMinutes) || 60);

    if (rescheduleModal.kind === 'meeting' && rescheduleModal.meeting) {
      const res = applyMeetingReschedule({
        meeting: rescheduleModal.meeting,
        newDateTime: startDate.toISOString(),
        newDurationMinutes: durationMin,
        confirmReopenFinalMinutes: rescheduleModal.confirmReopenFinalMinutes,
      });

      if (!res.ok || !res.meeting) {
        setRescheduleModal((prev) =>
          prev
            ? {
                ...prev,
                errorAr: res.errorAr || 'تعذر إعادة جدولة الاجتماع.',
              }
            : null
        );
        return;
      }

      try {
        await onSaveMeeting(res.meeting);
        setRescheduleModal(null);
        showNotice(`تم تحديث موعد الاجتماع «${res.meeting.title}» بنجاح.`);
      } catch (err) {
        setRescheduleModal((prev) =>
          prev
            ? {
                ...prev,
                errorAr:
                  err instanceof Error && err.message
                    ? err.message
                    : 'تعذرت مزامنة موعد الاجتماع مع الخادم. تم الاحتفاظ بالمسودة.',
              }
            : null
        );
      }
      return;
    }

    if (rescheduleModal.kind === 'task_block' && rescheduleModal.task) {
      const endDate = new Date(startDate.getTime() + durationMin * 60000);
      const res = assignTaskTimeBlock(
        rescheduleModal.task,
        startDate.toISOString(),
        endDate.toISOString()
      );
      if (!res.ok || !res.task) {
        setRescheduleModal((prev) =>
          prev ? { ...prev, errorAr: res.errorAr || 'تعذر جدولة وقت عمل المهمة.' } : null
        );
        return;
      }

      try {
        await onSaveTask(res.task);
        setRescheduleModal(null);
        showNotice(
          `تم تخصيص وقت عمل للمهمة «${res.task.title}» دون تغيير موعد استحقاقها الأصلي.`
        );
      } catch (err) {
        setRescheduleModal((prev) =>
          prev
            ? {
                ...prev,
                errorAr:
                  err instanceof Error && err.message
                    ? err.message
                    : 'تعذرت مزامنة وقت العمل مع الخادم. تم الاحتفاظ بالمسودة.',
              }
            : null
        );
      }
    }
  };

  const handleClearTaskTimeBlock = async (task: ActionItem) => {
    const cleared = clearTaskTimeBlock(task);
    try {
      await onSaveTask(cleared);
      if (rescheduleModal?.task?.id === task.id) {
        setRescheduleModal(null);
      }
      showNotice(`تم إلغاء تخصيص وقت العمل للمهمة «${task.title}» مع بقاء المهمة كما هي.`);
    } catch (err) {
      if (rescheduleModal?.task?.id === task.id) {
        setRescheduleModal((prev) =>
          prev
            ? {
                ...prev,
                errorAr:
                  err instanceof Error && err.message
                    ? err.message
                    : 'تعذرت مزامنة التعديل مع الخادم. تم الاحتفاظ بالمسودة.',
              }
            : null
        );
      } else {
        showNotice(
          err instanceof Error && err.message
            ? err.message
            : 'تعذرت مزامنة التعديل مع الخادم. تم الاحتفاظ بالمسودة.'
        );
      }
    }
  };

  const handleOpenOriginalRecord = (ev: CalendarEventItem) => {
    if (ev.meetingRef) {
      onOpenMeeting(ev.meetingRef);
      return;
    }
    if (ev.taskRef) {
      onOpenTask(ev.taskRef);
      return;
    }
    if (ev.opportunityRef) {
      onOpenOpportunity(ev.opportunityRef);
      return;
    }
    if (ev.clientId) {
      const c = clientsById.get(ev.clientId);
      if (c) onOpenClient(c);
    }
  };

  // Drag & Drop handlers on Weekly / Daily hour slots
  const handleDragStartEvent = (e: React.DragEvent, ev: CalendarEventItem) => {
    if (ev.activityType !== 'meeting' && ev.activityType !== 'task_block') {
      e.preventDefault();
      return;
    }
    setDraggedEventId(ev.id);
    e.dataTransfer.setData('text/plain', ev.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnSlot = (
    e: React.DragEvent,
    targetDateKey: string,
    targetHour: number
  ) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain') || draggedEventId;
    setDraggedEventId(null);
    if (!droppedId) return;

    const ev = allEvents.find((item) => item.id === droppedId);
    if (!ev) return;

    if (ev.activityType === 'meeting' && ev.meetingRef) {
      openMeetingRescheduleModal(ev.meetingRef, targetDateKey, targetHour, true);
    } else if (ev.activityType === 'task_block' && ev.taskRef) {
      openTaskTimeBlockModal(ev.taskRef, targetDateKey, targetHour, true);
    }
  };

  const handleOpenQuickSlotModal = (dateKey: string, hour: number = 10) => {
    setQuickSlotModal({
      dateKey,
      hour,
      selectedTaskId: eligibleTasksForScheduling[0]?.id || '',
      durationMinutes: calendarSettings.defaultBlockMinutes,
      errorAr: null,
    });
  };

  const handleScheduleSelectedTaskInSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSlotModal) return;
    const task = eligibleTasksForScheduling.find(
      (t) => t.id === quickSlotModal.selectedTaskId
    );
    if (!task) {
      setQuickSlotModal((prev) =>
        prev ? { ...prev, errorAr: 'يرجى اختيار مهمة من القائمة.' } : null
      );
      return;
    }
    const parts = parseDateOnlyString(quickSlotModal.dateKey);
    if (!parts) return;
    const startDate = buildZonedDate(parts, quickSlotModal.hour, 0, localTimeZone);
    const endDate = new Date(
      startDate.getTime() + (quickSlotModal.durationMinutes || 60) * 60000
    );
    const res = assignTaskTimeBlock(task, startDate.toISOString(), endDate.toISOString());
    if (!res.ok || !res.task) {
      setQuickSlotModal((prev) =>
        prev ? { ...prev, errorAr: res.errorAr || 'تعذر جدولة المهمة.' } : null
      );
      return;
    }
    try {
      await onSaveTask(res.task);
      setQuickSlotModal(null);
      showNotice(`تمت جدولة وقت عمل للمهمة «${res.task.title}» بنجاح.`);
    } catch (err) {
      setQuickSlotModal((prev) =>
        prev
          ? {
              ...prev,
              errorAr:
                err instanceof Error && err.message
                  ? err.message
                  : 'تعذرت مزامنة جدولة المهمة مع الخادم. تم الاحتفاظ بالمسودة.',
            }
          : null
      );
    }
  };

  // Period header title
  const currentPeriodLabel = useMemo(() => {
    if (viewMode === 'month') {
      return formatMonthYearHeaderAr(selectedDateParts);
    }
    if (viewMode === 'day') {
      return formatDayHeaderAr(selectedDateKey);
    }
    const startCell = weekDaysRange[0];
    const endCell = weekDaysRange[weekDaysRange.length - 1];
    if (!startCell || !endCell) return formatMonthYearHeaderAr(selectedDateParts);
    return `${startCell.day} ${
      formatMonthYearHeaderAr({
        year: startCell.year,
        month: startCell.month,
        day: startCell.day,
      }).split(' ')[0]
    } — ${endCell.day} ${formatMonthYearHeaderAr({
      year: endCell.year,
      month: endCell.month,
      day: endCell.day,
    })}`;
  }, [viewMode, selectedDateParts, selectedDateKey, weekDaysRange]);

  const activeClientObj =
    clientIdFilter !== 'all' ? clientsById.get(clientIdFilter) || null : null;

  return (
    <div data-testid="calendar-workspace-view" className="space-y-4 pb-8">
      {/* 1. Top Header & Mode Switcher */}
      <section className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarIcon className="w-5 h-5 text-emerald-700 shrink-0" />
              <h2 className="font-heading font-extrabold text-lg sm:text-xl text-stone-900">
                {language === 'ar'
                  ? 'التقويم والتخطيط الأسبوعي'
                  : 'Calendar & Weekly Planner'}
              </h2>
              <span
                data-testid="calendar-timezone-badge"
                className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200 font-mono"
                title="المنطقة الزمنية المحلية المستخدمة لعرض المواعيد"
              >
                {localTimeZone}
              </span>
              {hasPendingWrites && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                  تعديلات محلية بانتظار المزامنة
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500">
              مساحة زمنية موحدة تجمع الاجتماعات، أوقات عمل المهام (Time Blocks)، مواعيد الاستحقاق، المتابعات، وإجراءات الفرص.
            </p>
          </div>

          {/* 4 View Modes Switcher */}
          <div
            role="tablist"
            aria-label="أوضاع عرض التقويم"
            className="flex items-center flex-wrap gap-1.5 bg-stone-100 p-1 rounded-xl"
          >
            {(
              [
                { key: 'month', labelAr: 'الشهري', testId: 'cal-mode-month' },
                { key: 'week', labelAr: 'الأسبوعي', testId: 'cal-mode-week' },
                { key: 'day', labelAr: 'اليومي', testId: 'cal-mode-day' },
                {
                  key: 'planner',
                  labelAr: 'خطتي لهذا الأسبوع',
                  testId: 'cal-mode-planner',
                },
              ] as Array<{ key: CalendarViewMode; labelAr: string; testId: string }>
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={viewMode === m.key}
                data-testid={m.testId}
                onClick={() => setViewMode(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  viewMode === m.key
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-stone-700 hover:bg-stone-200/70'
                }`}
              >
                {m.labelAr}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation Bar & Quick Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-stone-100">
          {/* Date Period Navigation */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-xl border border-stone-200 bg-stone-50 p-0.5">
              <button
                type="button"
                data-testid="calendar-nav-prev"
                onClick={() =>
                  setSelectedDateKey((curr) =>
                    navigateCalendarDate(curr, viewMode, 'prev')
                  )
                }
                aria-label="الفترة السابقة"
                className="p-1.5 rounded-lg hover:bg-white text-stone-700 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="calendar-nav-today"
                onClick={() => setSelectedDateKey(todayKey)}
                className="px-2.5 py-1 text-xs font-bold text-stone-800 hover:bg-white rounded-lg transition-colors"
              >
                {viewMode === 'week' || viewMode === 'planner'
                  ? 'الأسبوع الحالي'
                  : 'اليوم'}
              </button>
              <button
                type="button"
                data-testid="calendar-nav-next"
                onClick={() =>
                  setSelectedDateKey((curr) =>
                    navigateCalendarDate(curr, viewMode, 'next')
                  )
                }
                aria-label="الفترة التالية"
                className="p-1.5 rounded-lg hover:bg-white text-stone-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <h3
              data-testid="calendar-period-title"
              className="font-heading font-extrabold text-sm sm:text-base text-stone-900"
            >
              {currentPeriodLabel}
            </h3>

            <input
              type="date"
              aria-label="انتقال إلى تاريخ محدد"
              data-testid="calendar-date-jump-input"
              value={selectedDateKey}
              onChange={(e) => {
                if (e.target.value && parseDateOnlyString(e.target.value)) {
                  setSelectedDateKey(e.target.value);
                }
              }}
              className="text-xs border border-stone-200 rounded-xl px-2.5 py-1.5 bg-white text-stone-800 font-mono"
            />
          </div>

          {/* Quick Create & Settings Actions */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              data-testid="calendar-quick-new-meeting"
              onClick={() => {
                const parts = parseDateOnlyString(selectedDateKey) || todayParts;
                const dt = buildZonedDate(parts, 10, 0, localTimeZone);
                onCreateNewMeeting({
                  clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                  dateTimeIso: dt.toISOString(),
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>اجتماع جديد</span>
            </button>

            <button
              type="button"
              data-testid="calendar-quick-new-task"
              onClick={() =>
                onCreateNewTask({
                  clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                  dueDate: selectedDateKey,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-800 text-xs font-semibold transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
              <span>مهمة جديدة</span>
            </button>

            <button
              type="button"
              data-testid="calendar-quick-schedule-existing-task"
              onClick={() => handleOpenQuickSlotModal(selectedDateKey, 10)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 text-xs font-semibold transition-colors"
            >
              <CalendarClock className="w-3.5 h-3.5 text-sky-700" />
              <span>جدولة مهمة موجودة</span>
            </button>

            <button
              type="button"
              data-testid="calendar-settings-toggle"
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              aria-expanded={isSettingsOpen}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                isSettingsOpen
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>إعدادات التقويم</span>
            </button>
          </div>
        </div>

        {/* Filters Strip (Activity Type + Client Filter + Visual Legend) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2.5 border-t border-stone-100 text-xs">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 text-stone-500 font-semibold ml-1">
              <Filter className="w-3.5 h-3.5" />
              <span>عرض:</span>
            </span>
            {(
              [
                { key: 'all', label: 'الكل' },
                { key: 'meetings', label: 'الاجتماعات فقط' },
                { key: 'tasks', label: 'المهام فقط' },
                { key: 'follow_ups', label: 'المتابعات فقط' },
                { key: 'opportunities', label: 'فرص الأعمال فقط' },
              ] as Array<{ key: CalendarFilterScope; label: string }>
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                data-testid={`calendar-filter-${f.key}`}
                onClick={() => setFilterScope(f.key)}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                  filterScope === f.key
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Client Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor="calendar-client-filter"
              className="text-[11px] font-semibold text-stone-600"
            >
              تصفية حسب العميل:
            </label>
            <select
              id="calendar-client-filter"
              data-testid="calendar-client-filter"
              value={clientIdFilter}
              onChange={(e) => setClientIdFilter(e.target.value)}
              className="text-xs border border-stone-200 rounded-xl px-2.5 py-1 bg-white text-stone-800 font-medium"
            >
              <option value="all">جميع العملاء ({clients.length})</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.company ? `— ${c.company}` : ''}
                </option>
              ))}
            </select>
            {activeClientObj && (
              <button
                type="button"
                onClick={() => setClientIdFilter('all')}
                className="text-[11px] text-rose-700 hover:underline font-semibold"
              >
                إلغاء تصفية العميل
              </button>
            )}
          </div>
        </div>

        {/* Inline Calendar Settings Drawer */}
        {isSettingsOpen && (
          <div
            data-testid="calendar-settings-panel"
            className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-stone-900">تفضيلات التقويم والتخطيط الزمني</h4>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-stone-500 hover:text-stone-800"
                aria-label="إغلاق إعدادات التقويم"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="cal-setting-week-start"
                  className="block text-[11px] font-semibold text-stone-600 mb-1"
                >
                  أول يوم في الأسبوع
                </label>
                <select
                  id="cal-setting-week-start"
                  data-testid="cal-setting-week-start"
                  value={calendarSettings.weekStartDay}
                  onChange={(e) =>
                    onUpdateCalendarSettings({
                      weekStartDay: Number(e.target.value) as CalendarWeekStartDay,
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value={6}>السبت (افتراضي)</option>
                  <option value={0}>الأحد</option>
                  <option value={1}>الإثنين</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="cal-setting-time-format"
                  className="block text-[11px] font-semibold text-stone-600 mb-1"
                >
                  تنسيق عرض الوقت
                </label>
                <select
                  id="cal-setting-time-format"
                  data-testid="cal-setting-time-format"
                  value={calendarSettings.timeFormat}
                  onChange={(e) =>
                    onUpdateCalendarSettings({
                      timeFormat: e.target.value as CalendarTimeFormat,
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value="12h">12 ساعة (ص / م)</option>
                  <option value="24h">24 ساعة (00:00 - 23:00)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="cal-setting-default-duration"
                  className="block text-[11px] font-semibold text-stone-600 mb-1"
                >
                  المدة الافتراضية لوقت عمل المهمة
                </label>
                <select
                  id="cal-setting-default-duration"
                  data-testid="cal-setting-default-duration"
                  value={calendarSettings.defaultBlockMinutes}
                  onChange={(e) =>
                    onUpdateCalendarSettings({
                      defaultBlockMinutes: Number(
                        e.target.value
                      ) as CalendarDefaultBlockMinutes,
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value={30}>30 دقيقة</option>
                  <option value={45}>45 دقيقة</option>
                  <option value={60}>60 دقيقة (ساعة)</option>
                  <option value={90}>90 دقيقة (ساعة ونصف)</option>
                  <option value={120}>120 دقيقة (ساعتان)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-4 pt-2 border-t border-stone-200/70">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.showMeetings}
                  onChange={(e) =>
                    onUpdateCalendarSettings({ showMeetings: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-700"
                />
                <span>إظهار الاجتماعات</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.showTasks}
                  onChange={(e) =>
                    onUpdateCalendarSettings({ showTasks: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-700"
                />
                <span>إظهار المهام وفترات العمل</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.showFollowUps}
                  onChange={(e) =>
                    onUpdateCalendarSettings({ showFollowUps: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-700"
                />
                <span>إظهار مواعيد المتابعة</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.showOpportunities}
                  onChange={(e) =>
                    onUpdateCalendarSettings({ showOpportunities: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-700"
                />
                <span>إظهار مواعيد الفرص</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.showCancelledMeetings}
                  onChange={(e) =>
                    onUpdateCalendarSettings({
                      showCancelledMeetings: e.target.checked,
                    })
                  }
                  className="rounded border-stone-300 text-emerald-700"
                />
                <span>إظهار الاجتماعات الملغاة</span>
              </label>
            </div>
          </div>
        )}

        {/* Honest Loading & Offline Disclosures */}
        {(isInitialLoading || !isOnline) && (
          <div className="pt-2 border-t border-stone-100 flex items-center flex-wrap gap-3 text-[11px]">
            {isInitialLoading && (
              <span className="text-stone-500">
                جارٍ مزامنة بيانات التقويم من مجموعات حسابك...
              </span>
            )}
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                <WifiOff className="w-3.5 h-3.5" />
                <span>
                  وضع عدم الاتصال: يمكنك تصفح التقويم وتخصيص أوقات العمل وإعادة الجدولة محلياً، وستُرفع التعديلات عند عودة الاتصال.
                </span>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Action Confirmation Toast Banner */}
      {actionBannerNotice && (
        <div
          data-testid="calendar-action-notice"
          className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionBannerNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBannerNotice(null)}
            className="text-emerald-700 hover:text-emerald-950"
            aria-label="إغلاق الإشعار"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Time Conflict Detection Alert Banner («تعارض في المواعيد») */}
      {allConflicts.length > 0 && (
        <section
          data-testid="calendar-conflicts-banner"
          className="bg-rose-50 border border-rose-300 rounded-2xl p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-rose-900">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <h3 className="font-heading font-extrabold text-sm">
                  تعارض في المواعيد ({allConflicts.length})
                </h3>
                <p className="text-[11px] text-rose-800">
                  تم رصد تداخل زمني بين التزامات مجدولة بوقت محدد. لا يقوم التطبيق بتغيير مواعيدك تلقائياً؛ يمكنك مراجعة السجلات المتعارضة أو تعديل موعد أي منها.
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="toggle-conflicts-details-btn"
              onClick={() => setShowConflictsPanel((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 text-rose-900 text-xs font-bold hover:bg-rose-100 transition-colors self-start sm:self-center"
            >
              {showConflictsPanel ? 'إخفاء تفاصيل التعارض' : 'مراجعة التعارضات'}
            </button>
          </div>

          {showConflictsPanel && (
            <div className="space-y-2 pt-2 border-t border-rose-200">
              {allConflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  data-testid={`conflict-item-${conflict.id}`}
                  className="bg-white border border-rose-200 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-rose-900">{conflict.reasonAr}</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">
                        {conflict.dateKey} ·{' '}
                        {formatTimeInZone(
                          conflict.overlapStartIso,
                          calendarSettings.timeFormat,
                          localTimeZone
                        )}{' '}
                        -{' '}
                        {formatTimeInZone(
                          conflict.overlapEndIso,
                          calendarSettings.timeFormat,
                          localTimeZone
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-600 flex items-center flex-wrap gap-2">
                      <span>
                        1) <strong>{conflict.firstEvent.activityTypeLabelAr}:</strong>{' '}
                        {conflict.firstEvent.title} ({conflict.firstEvent.clientName})
                      </span>
                      <span>•</span>
                      <span>
                        2) <strong>{conflict.secondEvent.activityTypeLabelAr}:</strong>{' '}
                        {conflict.secondEvent.title} ({conflict.secondEvent.clientName})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-1.5 shrink-0">
                    {conflict.firstEvent.meetingRef && (
                      <button
                        type="button"
                        onClick={() =>
                          openMeetingRescheduleModal(conflict.firstEvent.meetingRef!)
                        }
                        className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold hover:bg-stone-800"
                      >
                        تغيير موعد «{conflict.firstEvent.title.slice(0, 18)}»
                      </button>
                    )}
                    {conflict.firstEvent.taskRef && (
                      <button
                        type="button"
                        onClick={() =>
                          openTaskTimeBlockModal(conflict.firstEvent.taskRef!)
                        }
                        className="px-2.5 py-1 rounded-lg bg-sky-700 text-white text-[11px] font-semibold hover:bg-sky-800"
                      >
                        تعديل وقت «{conflict.firstEvent.title.slice(0, 18)}»
                      </button>
                    )}
                    {conflict.secondEvent.meetingRef && (
                      <button
                        type="button"
                        onClick={() =>
                          openMeetingRescheduleModal(conflict.secondEvent.meetingRef!)
                        }
                        className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-stone-800 text-[11px] font-semibold hover:bg-stone-50"
                      >
                        تغيير موعد «{conflict.secondEvent.title.slice(0, 18)}»
                      </button>
                    )}
                    {conflict.secondEvent.taskRef && (
                      <button
                        type="button"
                        onClick={() =>
                          openTaskTimeBlockModal(conflict.secondEvent.taskRef!)
                        }
                        className="px-2.5 py-1 rounded-lg border border-sky-300 bg-sky-50 text-sky-900 text-[11px] font-semibold hover:bg-sky-100"
                      >
                        تعديل وقت «{conflict.secondEvent.title.slice(0, 18)}»
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ===================================================================== */}
      {/* VIEW 1: MONTHLY VIEW (العرض الشهري)                                   */}
      {/* ===================================================================== */}
      {viewMode === 'month' && (
        <div
          data-testid="calendar-month-view"
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
        >
          {/* Month Grid (8 cols on desktop) */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-2xs">
            {/* Day-of-week header row */}
            <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50">
              {orderedWeekHeaderMeta.map((d) => (
                <div
                  key={d.dayOfWeek}
                  className="py-2.5 text-center text-[11px] font-bold text-stone-600"
                >
                  {d.fullAr}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 divide-x divide-y divide-stone-100">
              {monthGridCells.map((cell) => {
                const isSelected = cell.dateKey === selectedDateKey;
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    data-testid={`month-day-cell-${cell.dateKey}`}
                    onClick={() => setSelectedDateKey(cell.dateKey)}
                    className={`min-h-[92px] sm:min-h-[112px] p-1.5 sm:p-2 text-start flex flex-col justify-between transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/70 ring-2 ring-inset ring-emerald-600'
                        : cell.isCurrentMonth
                        ? 'bg-white hover:bg-stone-50'
                        : 'bg-stone-50/60 text-stone-400 hover:bg-stone-100/60'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full gap-1">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold tabular-nums ${
                          cell.isToday
                            ? 'bg-emerald-700 text-white'
                            : isSelected
                            ? 'text-emerald-900 font-extrabold'
                            : cell.isCurrentMonth
                            ? 'text-stone-800'
                            : 'text-stone-400'
                        }`}
                      >
                        {cell.day}
                      </span>
                      {cell.hasConflict && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200"
                          title="يوجد تعارض في المواعيد في هذا اليوم"
                        >
                          تعارض
                        </span>
                      )}
                    </div>

                    {/* Summary Badges & First 2 Event Titles */}
                    <div className="w-full space-y-1 mt-1">
                      {cell.counts.total > 0 && (
                        <div className="flex items-center flex-wrap gap-1">
                          {cell.counts.meetings > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 tabular-nums">
                              {cell.counts.meetings} اجتماع
                            </span>
                          )}
                          {cell.counts.taskBlocks > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 text-sky-900 tabular-nums">
                              {cell.counts.taskBlocks} عمل
                            </span>
                          )}
                          {cell.counts.tasksDue > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 tabular-nums">
                              {cell.counts.tasksDue} مهمة
                            </span>
                          )}
                          {(cell.counts.followUps > 0 || cell.counts.opportunities > 0) && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-violet-100 text-violet-900 tabular-nums">
                              {cell.counts.followUps + cell.counts.opportunities} متابعة
                            </span>
                          )}
                        </div>
                      )}

                      <div className="hidden sm:block space-y-0.5">
                        {cell.events.slice(0, 2).map((ev) => (
                          <div
                            key={ev.id}
                            className={`text-[10px] truncate px-1.5 py-0.5 rounded border ${
                              ACTIVITY_TYPE_META[ev.activityType].badgeClass
                            }`}
                          >
                            {ev.isTimed && ev.startIso
                              ? `${formatTimeInZone(
                                  ev.startIso,
                                  calendarSettings.timeFormat,
                                  localTimeZone
                                )} `
                              : ''}
                            {ev.title}
                          </div>
                        ))}
                        {cell.events.length > 2 && (
                          <div className="text-[10px] text-stone-500 font-semibold pr-1">
                            +{cell.events.length - 2} أخرى
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Detail Inspector (4 cols on desktop) */}
          <div
            data-testid="month-selected-day-inspector"
            className="lg:col-span-4 bg-white rounded-2xl border border-stone-200 p-4 space-y-4 shadow-2xs"
          >
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-100">
              <div>
                <span className="text-[11px] font-semibold text-emerald-700 block">
                  تفاصيل اليوم المحدد
                </span>
                <h3 className="font-heading font-extrabold text-sm text-stone-900">
                  {formatDayHeaderAr(selectedDateKey)}
                </h3>
              </div>
              <button
                type="button"
                data-testid="open-day-schedule-from-month"
                onClick={() => setViewMode('day')}
                className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-[11px] font-semibold shrink-0"
              >
                فتح جدول اليوم
              </button>
            </div>

            {/* Quick Create on Selected Day */}
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  const dt = buildZonedDate(selectedDateParts, 10, 0, localTimeZone);
                  onCreateNewMeeting({
                    clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                    dateTimeIso: dt.toISOString(),
                  });
                }}
                className="py-1.5 px-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-semibold text-center"
              >
                + اجتماع
              </button>
              <button
                type="button"
                onClick={() =>
                  onCreateNewTask({
                    clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                    dueDate: selectedDateKey,
                  })
                }
                className="py-1.5 px-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-800 font-semibold text-center"
              >
                + مهمة
              </button>
              <button
                type="button"
                onClick={() => handleOpenQuickSlotModal(selectedDateKey, 10)}
                className="py-1.5 px-2 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 font-semibold text-center"
              >
                + جدولة مهمة
              </button>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-stone-200 rounded-xl space-y-1.5">
                <CalendarCheck className="w-6 h-6 text-stone-400 mx-auto" />
                <p className="text-xs font-bold text-stone-700">
                  لا توجد أنشطة مسجلة في هذا اليوم
                </p>
                <p className="text-[11px] text-stone-500">
                  يمكنك إنشاء اجتماع جديد أو مهمة أو تخصيص وقت عمل لمهمة قائمة.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-0.5">
                {selectedDayEvents.map((ev) => (
                  <CalendarEventCard
                    key={ev.id}
                    event={ev}
                    timeFormat={calendarSettings.timeFormat}
                    timeZone={localTimeZone}
                    onOpenRecord={() => handleOpenOriginalRecord(ev)}
                    onPrepareMeeting={
                      ev.meetingRef && onPrepareMeeting
                        ? () => onPrepareMeeting(ev.meetingRef!)
                        : undefined
                    }
                    onReschedule={() => {
                      if (ev.meetingRef) {
                        openMeetingRescheduleModal(ev.meetingRef);
                      } else if (ev.taskRef) {
                        openTaskTimeBlockModal(ev.taskRef);
                      }
                    }}
                    onClearTimeBlock={
                      ev.activityType === 'task_block' && ev.taskRef
                        ? () => void handleClearTaskTimeBlock(ev.taskRef!)
                        : undefined
                    }
                    onToggleTask={
                      ev.taskRef ? () => onToggleTask(ev.taskRef!.id) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 2: WEEKLY VIEW (العرض الأسبوعي)                                  */}
      {/* ===================================================================== */}
      {viewMode === 'week' && (
        <section
          data-testid="calendar-week-view"
          className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-2xs space-y-0"
        >
          <div className="p-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2 text-xs">
            <span className="font-semibold text-stone-700">
              العرض الأسبوعي الزمني — يمكنك سحب الاجتماع أو فترة عمل المهمة وإفلاتها على أي ساعة، أو استخدام زر «تغيير الموعد» مباشرة.
            </span>
            <span className="text-[11px] text-stone-500">
              المهام التي لها تاريخ استحقاق فقط تظهر في شريط «التزامات اليوم» أعلى كل عمود دون افتراض ساعة محددة.
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              {/* 7-Day Column Headers */}
              <div className="grid grid-cols-8 border-b border-stone-200 bg-stone-50/80">
                <div className="p-2.5 text-[11px] font-bold text-stone-500 border-l border-stone-200">
                  الوقت / اليوم
                </div>
                {weekDaysRange.map((dayCell) => (
                  <div
                    key={dayCell.dateKey}
                    data-testid={`week-col-header-${dayCell.dateKey}`}
                    className={`p-2.5 border-l border-stone-100 text-center space-y-1 ${
                      dayCell.isToday ? 'bg-emerald-50/70' : ''
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-xs font-bold text-stone-800">
                        {dayCell.dayNameFullAr}
                      </span>
                      {dayCell.hasConflict && (
                        <span className="w-2 h-2 rounded-full bg-rose-600" title="تعارض زمني" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDateKey(dayCell.dateKey);
                        setViewMode('day');
                      }}
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-extrabold tabular-nums ${
                        dayCell.isToday
                          ? 'bg-emerald-700 text-white'
                          : 'text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      {dayCell.day}/{dayCell.month}
                    </button>
                  </div>
                ))}
              </div>

              {/* All-Day / Date-Only Row (Tasks Due, Follow-Ups without time, Opportunity Dates) */}
              <div className="grid grid-cols-8 border-b border-stone-200 bg-amber-50/20">
                <div className="p-2 text-[11px] font-bold text-stone-600 border-l border-stone-200 flex items-center">
                  التزامات اليوم (بدون ساعة)
                </div>
                {weekDaysRange.map((dayCell) => {
                  const dateOnlyItems = dayCell.events.filter((ev) => !ev.isTimed);
                  return (
                    <div
                      key={`allday-${dayCell.dateKey}`}
                      className="p-1.5 border-l border-stone-100 space-y-1 min-h-[60px]"
                    >
                      {dateOnlyItems.map((ev) => (
                        <div
                          key={ev.id}
                          className={`p-1.5 rounded-lg border text-[10px] space-y-1 ${
                            ACTIVITY_TYPE_META[ev.activityType].badgeClass
                          }`}
                        >
                          <div className="font-bold truncate" title={ev.title}>
                            {ev.title}
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenOriginalRecord(ev)}
                              className="underline font-semibold hover:opacity-80"
                            >
                              فتح
                            </button>
                            {ev.activityType === 'task_due' && ev.taskRef && (
                              <button
                                type="button"
                                onClick={() =>
                                  openTaskTimeBlockModal(ev.taskRef!, dayCell.dateKey, 10)
                                }
                                className="px-1.5 py-0.5 rounded bg-white/80 text-sky-900 font-semibold"
                              >
                                + وقت عمل
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Hourly Rows */}
              <div className="divide-y divide-stone-100">
                {visibleHours.map((hour) => (
                  <div key={hour} className="grid grid-cols-8 min-h-[68px]">
                    <div className="p-2 text-[11px] font-mono font-semibold text-stone-500 border-l border-stone-200 bg-stone-50/50">
                      {formatHourMinuteLabel(hour, 0, calendarSettings.timeFormat)}
                    </div>

                    {weekDaysRange.map((dayCell) => {
                      const slotEvents = dayCell.events.filter((ev) => {
                        if (!ev.isTimed || !ev.startIso) return false;
                        const { hour: evHour } = extractZonedHourAndMinute(
                          new Date(ev.startIso),
                          localTimeZone
                        );
                        return evHour === hour;
                      });

                      return (
                        <div
                          key={`${dayCell.dateKey}-${hour}`}
                          data-testid={`week-slot-${dayCell.dateKey}-${hour}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(e) => handleDropOnSlot(e, dayCell.dateKey, hour)}
                          className="p-1 border-l border-stone-100 hover:bg-stone-50/70 transition-colors space-y-1 relative group"
                        >
                          {slotEvents.map((ev) => (
                            <div
                              key={ev.id}
                              draggable={
                                ev.activityType === 'meeting' ||
                                ev.activityType === 'task_block'
                              }
                              onDragStart={(e) => handleDragStartEvent(e, ev)}
                              data-testid={`week-timed-event-${ev.id}`}
                              className={`p-1.5 rounded-lg border text-[10px] space-y-1 cursor-grab active:cursor-grabbing ${
                                ACTIVITY_TYPE_META[ev.activityType].badgeClass
                              } ${ACTIVITY_TYPE_META[ev.activityType].borderClass}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold truncate">{ev.title}</span>
                                <span className="font-mono text-[9px] shrink-0">
                                  {ev.durationMinutes ? `${ev.durationMinutes}د` : 'بدون مدة'}
                                </span>
                              </div>
                              <div className="text-[9px] opacity-85 truncate">
                                {ev.clientName}
                              </div>
                              <div className="flex items-center justify-between gap-1 pt-0.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenOriginalRecord(ev)}
                                  className="underline font-bold"
                                >
                                  فتح السجل
                                </button>
                                {ev.meetingRef && onPrepareMeeting && (
                                  <button
                                    type="button"
                                    data-testid={`week-prepare-btn-${ev.id}`}
                                    onClick={() => onPrepareMeeting(ev.meetingRef!)}
                                    className="px-1.5 py-0.5 rounded bg-emerald-700 text-white font-semibold"
                                  >
                                    فتح التحضير
                                  </button>
                                )}
                                {(ev.meetingRef || ev.taskRef) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (ev.meetingRef) {
                                        openMeetingRescheduleModal(ev.meetingRef);
                                      } else if (ev.taskRef) {
                                        openTaskTimeBlockModal(ev.taskRef);
                                      }
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-white/90 text-stone-900 font-semibold"
                                  >
                                    تغيير الموعد
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() => handleOpenQuickSlotModal(dayCell.dateKey, hour)}
                            aria-label={`إضافة أو جدولة في ${dayCell.dateKey} الساعة ${hour}`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-full py-0.5 rounded text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50 text-center"
                          >
                            + جدولة
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* VIEW 3: DAILY VIEW (العرض اليومي)                                     */}
      {/* ===================================================================== */}
      {viewMode === 'day' && (
        <div
          data-testid="calendar-day-view"
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
        >
          {/* Left/Primary: Hourly Day Schedule (7 cols) */}
          <section className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2 bg-stone-50">
              <div>
                <h3 className="font-heading font-extrabold text-sm text-stone-900">
                  الجدول الزمني لليوم — {formatDayHeaderAr(selectedDateKey)}
                </h3>
                <p className="text-[11px] text-stone-500">
                  الاجتماعات وفترات العمل المخططة للمهام (Time Blocks) مرتبة بالساعة
                </p>
              </div>
              {selectedDayConflicts.length > 0 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 border border-rose-200">
                  {selectedDayConflicts.length} تعارض زمني في هذا اليوم
                </span>
              )}
            </div>

            <div className="divide-y divide-stone-100">
              {visibleHours.map((hour) => {
                const hourEvents = selectedDayEvents.filter((ev) => {
                  if (!ev.isTimed || !ev.startIso) return false;
                  const { hour: evHour } = extractZonedHourAndMinute(
                    new Date(ev.startIso),
                    localTimeZone
                  );
                  return evHour === hour;
                });

                return (
                  <div
                    key={hour}
                    data-testid={`day-hour-row-${hour}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => handleDropOnSlot(e, selectedDateKey, hour)}
                    className="grid grid-cols-12 min-h-[64px] hover:bg-stone-50/60 transition-colors"
                  >
                    <div className="col-span-3 sm:col-span-2 p-3 text-xs font-mono font-bold text-stone-500 border-l border-stone-100 bg-stone-50/40 flex items-start justify-between">
                      <span>
                        {formatHourMinuteLabel(hour, 0, calendarSettings.timeFormat)}
                      </span>
                    </div>

                    <div className="col-span-9 sm:col-span-10 p-2 space-y-2 flex flex-col justify-center">
                      {hourEvents.length > 0 ? (
                        hourEvents.map((ev) => (
                          <CalendarEventCard
                            key={ev.id}
                            event={ev}
                            timeFormat={calendarSettings.timeFormat}
                            timeZone={localTimeZone}
                            draggable={
                              ev.activityType === 'meeting' ||
                              ev.activityType === 'task_block'
                            }
                            onDragStart={(e) => handleDragStartEvent(e, ev)}
                            onOpenRecord={() => handleOpenOriginalRecord(ev)}
                            onPrepareMeeting={
                              ev.meetingRef && onPrepareMeeting
                                ? () => onPrepareMeeting(ev.meetingRef!)
                                : undefined
                            }
                            onReschedule={() => {
                              if (ev.meetingRef) {
                                openMeetingRescheduleModal(ev.meetingRef);
                              } else if (ev.taskRef) {
                                openTaskTimeBlockModal(ev.taskRef);
                              }
                            }}
                            onClearTimeBlock={
                              ev.activityType === 'task_block' && ev.taskRef
                                ? () => void handleClearTaskTimeBlock(ev.taskRef!)
                                : undefined
                            }
                            onToggleTask={
                              ev.taskRef ? () => onToggleTask(ev.taskRef!.id) : undefined
                            }
                          />
                        ))
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-stone-400">فترة متاحة</span>
                          <button
                            type="button"
                            onClick={() => handleOpenQuickSlotModal(selectedDateKey, hour)}
                            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-0.5 rounded-lg hover:bg-emerald-50"
                          >
                            + جدولة في هذه الساعة
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right/Secondary: Date-Only Items & Available Gaps (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Date-Only Commitments for Selected Day */}
            <section
              data-testid="day-unscheduled-commitments"
              className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs"
            >
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <div>
                  <h3 className="font-heading font-bold text-sm text-stone-900">
                    التزامات اليوم غير المرتبطة بساعة
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    مهام مستحقة اليوم، متابعات، وإجراءات فرص أعمال
                  </p>
                </div>
                <span className="text-xs font-bold text-stone-600 tabular-nums">
                  {selectedDayEvents.filter((e) => !e.isTimed).length}
                </span>
              </div>

              {selectedDayEvents.filter((e) => !e.isTimed).length === 0 ? (
                <p className="text-xs text-stone-500 py-4 text-center">
                  لا توجد مهام أو متابعات غير محددة الساعة في هذا اليوم.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {selectedDayEvents
                    .filter((e) => !e.isTimed)
                    .map((ev) => (
                      <CalendarEventCard
                        key={ev.id}
                        event={ev}
                        timeFormat={calendarSettings.timeFormat}
                        timeZone={localTimeZone}
                        onOpenRecord={() => handleOpenOriginalRecord(ev)}
                        onReschedule={
                          ev.taskRef
                            ? () =>
                                openTaskTimeBlockModal(
                                  ev.taskRef!,
                                  selectedDateKey,
                                  10
                                )
                            : undefined
                        }
                        onToggleTask={
                          ev.taskRef ? () => onToggleTask(ev.taskRef!.id) : undefined
                        }
                      />
                    ))}
                </div>
              )}
            </section>

            {/* Available Free Windows with Honest Disclosure */}
            <section
              data-testid="day-available-gaps"
              className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs"
            >
              <div className="space-y-1 pb-2 border-b border-stone-100">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-bold text-sm text-stone-900">
                    الفراغات المتاحة للتخطيط ({selectedDayAvailableSlots.length})
                  </h3>
                  <span className="text-[11px] text-stone-500 font-mono">
                    {formatHourMinuteLabel(
                      calendarSettings.workingDayStartHour,
                      0,
                      calendarSettings.timeFormat
                    )}{' '}
                    -{' '}
                    {formatHourMinuteLabel(
                      calendarSettings.workingDayEndHour,
                      0,
                      calendarSettings.timeFormat
                    )}
                  </span>
                </div>
                <p
                  data-testid="available-slots-disclosure"
                  className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200/80 rounded-lg p-2 leading-relaxed"
                >
                  {AVAILABLE_SLOTS_DISCLOSURE_AR}
                </p>
              </div>

              {selectedDayAvailableSlots.length === 0 ? (
                <p className="text-xs text-stone-500 py-3 text-center">
                  جميع ساعات العمل في هذا اليوم مشغولة بالتزامات مجدولة.
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedDayAvailableSlots.map((gap, idx) => (
                    <div
                      key={`${gap.startIso}-${idx}`}
                      className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/60 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-bold text-stone-900 font-mono">
                          {gap.startHourLabel} — {gap.endHourLabel}
                        </span>
                        <span className="text-[11px] text-stone-500 mr-2">
                          ({gap.durationMinutes} دقيقة متاحة)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const { hour } = extractZonedHourAndMinute(
                            new Date(gap.startIso),
                            localTimeZone
                          );
                          handleOpenQuickSlotModal(selectedDateKey, hour);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold shrink-0"
                      >
                        تخصيص لمهمة / اجتماع
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 4: WEEKLY PLANNER («خطتي لهذا الأسبوع»)                          */}
      {/* ===================================================================== */}
      {viewMode === 'planner' && (
        <div data-testid="weekly-planner-view" className="space-y-5">
          {/* Weekly Summary KPI Cards */}
          <section
            aria-label="ملخص خطة الأسبوع"
            data-testid="weekly-planner-summary"
            className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 space-y-3 shadow-2xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-heading font-extrabold text-base text-stone-900">
                  ملخص خطتي لهذا الأسبوع ({weeklyPlanData.weekStartKey} إلى{' '}
                  {weeklyPlanData.weekEndKey})
                </h3>
                <p className="text-xs text-stone-500">
                  نظرة شاملة على الاجتماعات، ساعات العمل المخططة للمهام، المهام المستحقة، والالتزامات المتأخرة
                </p>
              </div>
              {weeklyPlanData.summary.meetingsWithoutDurationCount > 0 && (
                <span
                  data-testid="planner-unknown-duration-disclosure"
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 font-medium"
                >
                  ملاحظة: يوجد {weeklyPlanData.summary.meetingsWithoutDurationCount} اجتماع بدون مدة محددة (لم تُحتسب ساعات افتراضية لها)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/50">
                <span className="text-[11px] text-stone-500 font-medium block">
                  اجتماعات الأسبوع
                </span>
                <span
                  data-testid="planner-kpi-meetings-count"
                  className="font-heading font-extrabold text-xl text-emerald-800 mt-1 block tabular-nums"
                >
                  {weeklyPlanData.summary.meetingsCount}
                </span>
              </div>

              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/50">
                <span className="text-[11px] text-stone-500 font-medium block">
                  ساعات الاجتماعات المعلومة
                </span>
                <span
                  data-testid="planner-kpi-meeting-hours"
                  className="font-heading font-extrabold text-xl text-stone-900 mt-1 block tabular-nums"
                >
                  {weeklyPlanData.summary.scheduledMeetingHours} س
                </span>
              </div>

              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/50">
                <span className="text-[11px] text-stone-500 font-medium block">
                  مهام مستحقة هذا الأسبوع
                </span>
                <span
                  data-testid="planner-kpi-due-tasks"
                  className="font-heading font-extrabold text-xl text-amber-800 mt-1 block tabular-nums"
                >
                  {weeklyPlanData.summary.dueTasksCount}
                </span>
              </div>

              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/50">
                <span className="text-[11px] text-stone-500 font-medium block">
                  مهام مجدولة بوقت عمل
                </span>
                <span
                  data-testid="planner-kpi-time-blocked-tasks"
                  className="font-heading font-extrabold text-xl text-sky-800 mt-1 block tabular-nums"
                >
                  {weeklyPlanData.summary.timeBlockedTasksCount}
                </span>
              </div>

              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/50">
                <span className="text-[11px] text-stone-500 font-medium block">
                  ساعات عمل المهام المخططة
                </span>
                <span
                  data-testid="planner-kpi-planned-task-hours"
                  className="font-heading font-extrabold text-xl text-sky-900 mt-1 block tabular-nums"
                >
                  {weeklyPlanData.summary.plannedTaskWorkHours} س
                </span>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  weeklyPlanData.summary.overdueCommitmentsCount > 0
                    ? 'border-rose-200 bg-rose-50/40'
                    : 'border-stone-200 bg-stone-50/50'
                }`}
              >
                <span className="text-[11px] text-stone-500 font-medium block">
                  التزامات متأخرة غير منجزة
                </span>
                <span
                  data-testid="planner-kpi-overdue"
                  className={`font-heading font-extrabold text-xl mt-1 block tabular-nums ${
                    weeklyPlanData.summary.overdueCommitmentsCount > 0
                      ? 'text-rose-700'
                      : 'text-stone-900'
                  }`}
                >
                  {weeklyPlanData.summary.overdueCommitmentsCount}
                </span>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Overdue Commitments & Unscheduled Open Tasks Queue (4 cols) */}
            <div className="lg:col-span-4 space-y-5">
              {/* Overdue Commitments */}
              <section
                data-testid="planner-overdue-section"
                className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                  <div>
                    <h4 className="font-heading font-bold text-sm text-rose-800">
                      التزامات متأخرة تحتاج متابعة
                    </h4>
                    <p className="text-[11px] text-stone-500">
                      مهام أو متابعات أو إجراءات فرص تجاوزت تاريخها دون إكمال
                    </p>
                  </div>
                  <span className="text-xs font-extrabold text-rose-700 tabular-nums">
                    {weeklyPlanData.overdueCommitments.length}
                  </span>
                </div>

                {weeklyPlanData.overdueCommitments.length === 0 ? (
                  <p className="text-xs text-stone-500 py-4 text-center">
                    لا توجد التزامات متأخرة حالياً.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {weeklyPlanData.overdueCommitments.map((ev) => (
                      <CalendarEventCard
                        key={ev.id}
                        event={ev}
                        timeFormat={calendarSettings.timeFormat}
                        timeZone={localTimeZone}
                        onOpenRecord={() => handleOpenOriginalRecord(ev)}
                        onReschedule={
                          ev.taskRef
                            ? () => openTaskTimeBlockModal(ev.taskRef!, todayKey, 10)
                            : undefined
                        }
                        onToggleTask={
                          ev.taskRef ? () => onToggleTask(ev.taskRef!.id) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Unscheduled Tasks Ready for Time Blocking */}
              <section
                data-testid="planner-unscheduled-tasks-section"
                className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                  <div>
                    <h4 className="font-heading font-bold text-sm text-stone-900">
                      مهام مفتوحة بانتظار تخصيص وقت عمل
                    </h4>
                    <p className="text-[11px] text-stone-500">
                      احجز فترة عمل (Time Block) لأي مهمة دون المساس بموعد استحقاقها
                    </p>
                  </div>
                  <span className="text-xs font-extrabold text-sky-800 tabular-nums">
                    {weeklyPlanData.unscheduledOpenTasks.length}
                  </span>
                </div>

                {weeklyPlanData.unscheduledOpenTasks.length === 0 ? (
                  <p className="text-xs text-stone-500 py-4 text-center">
                    جميع المهام المفتوحة مجدولة زمنياً أو مكتملة.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto">
                    {weeklyPlanData.unscheduledOpenTasks.map((task) => {
                      const clientName =
                        clientsById.get(task.clientId)?.name || 'عميل غير محدد';
                      return (
                        <div
                          key={task.id}
                          data-testid={`planner-unscheduled-task-${task.id}`}
                          className="p-3 rounded-xl border border-stone-200 bg-stone-50/60 space-y-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenTask(task)}
                              className="font-bold text-stone-900 hover:text-emerald-800 text-start"
                            >
                              {task.title}
                            </button>
                            {task.dueDate && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 shrink-0">
                                استحقاق: {task.dueDate}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
                            <span>{clientName}</span>
                            <button
                              type="button"
                              data-testid={`schedule-task-btn-${task.id}`}
                              onClick={() =>
                                openTaskTimeBlockModal(
                                  task,
                                  task.dueDate &&
                                    task.dueDate >= weeklyPlanData.weekStartKey &&
                                    task.dueDate <= weeklyPlanData.weekEndKey
                                    ? task.dueDate
                                    : selectedDateKey,
                                  10
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold"
                            >
                              + جدولة وقت عمل
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: 7-Day Weekly Plan Breakdown (8 cols) */}
            <div className="lg:col-span-8 space-y-3">
              {weeklyPlanData.weekDays.map((dayCell) => (
                <section
                  key={dayCell.dateKey}
                  data-testid={`planner-day-card-${dayCell.dateKey}`}
                  className={`bg-white rounded-2xl border p-4 space-y-3 shadow-2xs ${
                    dayCell.isToday ? 'border-emerald-400' : 'border-stone-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-stone-100">
                    <div className="flex items-center gap-2">
                      <h4 className="font-heading font-extrabold text-sm text-stone-900">
                        {formatDayHeaderAr(dayCell.dateKey)}
                      </h4>
                      {dayCell.isToday && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-700 text-white">
                          اليوم
                        </span>
                      )}
                      {dayCell.hasConflict && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                          تعارض زمني
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenQuickSlotModal(dayCell.dateKey, 10)
                        }
                        className="px-2.5 py-1 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 font-semibold"
                      >
                        + جدولة مهمة
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDateKey(dayCell.dateKey);
                          setViewMode('day');
                        }}
                        className="px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-semibold"
                      >
                        عرض اليوم
                      </button>
                    </div>
                  </div>

                  {dayCell.events.length === 0 ? (
                    <p className="text-xs text-stone-400 py-2">
                      لا توجد التزامات مجدولة في هذا اليوم.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {dayCell.events.map((ev) => (
                        <CalendarEventCard
                          key={ev.id}
                          event={ev}
                          timeFormat={calendarSettings.timeFormat}
                          timeZone={localTimeZone}
                          onOpenRecord={() => handleOpenOriginalRecord(ev)}
                          onPrepareMeeting={
                            ev.meetingRef && onPrepareMeeting
                              ? () => onPrepareMeeting(ev.meetingRef!)
                              : undefined
                          }
                          onReschedule={() => {
                            if (ev.meetingRef) {
                              openMeetingRescheduleModal(ev.meetingRef);
                            } else if (ev.taskRef) {
                              openTaskTimeBlockModal(ev.taskRef, dayCell.dateKey, 10);
                            }
                          }}
                          onClearTimeBlock={
                            ev.activityType === 'task_block' && ev.taskRef
                              ? () => void handleClearTaskTimeBlock(ev.taskRef!)
                              : undefined
                          }
                          onToggleTask={
                            ev.taskRef ? () => onToggleTask(ev.taskRef!.id) : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: RESCHEDULE / TIME BLOCK PREVIEW & CONFIRMATION MODAL         */}
      {/* ===================================================================== */}
      {rescheduleModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-modal-title"
          data-testid="calendar-reschedule-modal"
          className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-stone-200 max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-100">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 block">
                  {rescheduleModal.fromDragAndDrop
                    ? 'معاينة وتأكيد النقل الزمني قبل الحفظ'
                    : rescheduleModal.kind === 'meeting'
                    ? 'إعادة جدولة الاجتماع'
                    : 'التخطيط الزمني للمهمة (Time Blocking)'}
                </span>
                <h3
                  id="reschedule-modal-title"
                  className="font-heading font-extrabold text-base text-stone-900 mt-0.5"
                >
                  {rescheduleModal.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1"
                aria-label="إغلاق نافذة الجدولة"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmRescheduleOrTimeBlock} className="space-y-4 text-xs">
              {/* Previous vs New Preview Box */}
              <div
                data-testid="reschedule-preview-comparison"
                className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-stone-500 font-semibold">الموعد السابق:</span>
                  <span className="font-mono font-bold text-stone-800">
                    {rescheduleModal.previousStartIso
                      ? `${rescheduleModal.previousStartIso.slice(0, 10)} · ${formatTimeInZone(
                          rescheduleModal.previousStartIso,
                          calendarSettings.timeFormat,
                          localTimeZone
                        )}`
                      : 'غير مجدول بوقت عمل مسبقاً'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-800 font-semibold">الموعد الجديد المقترح:</span>
                  <span className="font-mono font-extrabold text-emerald-900">
                    {rescheduleModal.targetDateKey} · {rescheduleModal.targetStartTime} (
                    {rescheduleModal.targetDurationMinutes} دقيقة)
                  </span>
                </div>
                {rescheduleModal.kind === 'task_block' && rescheduleModal.task && (
                  <div className="pt-1.5 border-t border-stone-200/80 text-[11px] text-sky-900 font-medium">
                    موعد الاستحقاق الأصلي للمهمة (Due Date):{' '}
                    <strong className="font-mono">
                      {rescheduleModal.task.dueDate || 'غير محدد'}
                    </strong>{' '}
                    — لن يتغير موعد الاستحقاق ولن تُعلَّم المهمة كمكتملة.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="reschedule-date-input"
                    className="block font-semibold text-stone-700 mb-1"
                  >
                    التاريخ
                  </label>
                  <input
                    id="reschedule-date-input"
                    data-testid="reschedule-date-input"
                    type="date"
                    required
                    value={rescheduleModal.targetDateKey}
                    onChange={(e) =>
                      setRescheduleModal((prev) =>
                        prev
                          ? { ...prev, targetDateKey: e.target.value, errorAr: null }
                          : null
                      )
                    }
                    className="w-full rounded-xl border border-stone-200 px-2.5 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="reschedule-time-input"
                    className="block font-semibold text-stone-700 mb-1"
                  >
                    وقت البدء
                  </label>
                  <input
                    id="reschedule-time-input"
                    data-testid="reschedule-time-input"
                    type="time"
                    required
                    value={rescheduleModal.targetStartTime}
                    onChange={(e) =>
                      setRescheduleModal((prev) =>
                        prev
                          ? { ...prev, targetStartTime: e.target.value, errorAr: null }
                          : null
                      )
                    }
                    className="w-full rounded-xl border border-stone-200 px-2.5 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="reschedule-duration-input"
                    className="block font-semibold text-stone-700 mb-1"
                  >
                    المدة (بالدقائق)
                  </label>
                  <input
                    id="reschedule-duration-input"
                    data-testid="reschedule-duration-input"
                    type="number"
                    min={5}
                    max={720}
                    step={5}
                    required
                    value={rescheduleModal.targetDurationMinutes}
                    onChange={(e) =>
                      setRescheduleModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              targetDurationMinutes: Number(e.target.value),
                              errorAr: null,
                            }
                          : null
                      )
                    }
                    className="w-full rounded-xl border border-stone-200 px-2.5 py-2 font-mono text-xs"
                  />
                </div>
              </div>

              {/* Final Minutes Lock Guard for Meetings */}
              {rescheduleModal.kind === 'meeting' &&
                rescheduleModal.meeting?.minutesStatus === 'final' && (
                  <div
                    data-testid="final-minutes-reschedule-guard"
                    className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2"
                  >
                    <div className="flex items-center gap-1.5 font-bold">
                      <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>محضر الاجتماع معتمد كنسخة نهائية مقفلة</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      وفق سياسة حماية المحاضر النهائية (Task 004-B)، لا يُعدَّل موعد اجتماع ذي محضر نهائي إلا بعد إعادة فتح المحضر إلى مسودة (Draft).
                    </p>
                    <label className="inline-flex items-center gap-2 font-semibold cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        data-testid="confirm-reopen-final-minutes-checkbox"
                        checked={rescheduleModal.confirmReopenFinalMinutes}
                        onChange={(e) =>
                          setRescheduleModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  confirmReopenFinalMinutes: e.target.checked,
                                  errorAr: null,
                                }
                              : null
                          )
                        }
                        className="rounded border-amber-400 text-emerald-700"
                      />
                      <span>
                        أوافق على إعادة فتح المحضر إلى «مسودة» لتحديث موعد الاجتماع
                      </span>
                    </label>
                  </div>
                )}

              {/* Honest Disclosure for Meeting Rescheduling */}
              {rescheduleModal.kind === 'meeting' && (
                <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-2.5">
                  {MEETING_RESCHEDULE_DISCLOSURE_AR}
                </p>
              )}

              {rescheduleModal.errorAr && (
                <div
                  data-testid="reschedule-modal-error"
                  className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold"
                >
                  {rescheduleModal.errorAr}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-100">
                <div>
                  {rescheduleModal.kind === 'task_block' &&
                    rescheduleModal.task?.scheduledStartAt && (
                      <button
                        type="button"
                        data-testid="remove-task-time-block-btn"
                        onClick={() =>
                          void handleClearTaskTimeBlock(rescheduleModal.task!)
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>إزالة وقت العمل</span>
                      </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRescheduleModal(null)}
                    className="px-3.5 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 font-semibold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    data-testid="confirm-reschedule-submit-btn"
                    className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
                  >
                    تأكيد وحفظ الموعد
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: QUICK SLOT ACTION & SCHEDULE EXISTING TASK MODAL             */}
      {/* ===================================================================== */}
      {quickSlotModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-slot-modal-title"
          data-testid="calendar-quick-slot-modal"
          className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-stone-200 max-w-md w-full p-5 space-y-4 shadow-xl text-xs">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-100">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 block">
                  إجراء سريع على التقويم
                </span>
                <h3
                  id="quick-slot-modal-title"
                  className="font-heading font-extrabold text-sm text-stone-900 mt-0.5"
                >
                  {formatDayHeaderAr(quickSlotModal.dateKey)} · الساعة{' '}
                  {formatHourMinuteLabel(
                    quickSlotModal.hour,
                    0,
                    calendarSettings.timeFormat
                  )}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickSlotModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1"
                aria-label="إغلاق النافذة"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Direct Creation Shortcuts */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="slot-create-meeting-btn"
                onClick={() => {
                  const parts =
                    parseDateOnlyString(quickSlotModal.dateKey) || todayParts;
                  const dt = buildZonedDate(
                    parts,
                    quickSlotModal.hour,
                    0,
                    localTimeZone
                  );
                  setQuickSlotModal(null);
                  onCreateNewMeeting({
                    clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                    dateTimeIso: dt.toISOString(),
                  });
                }}
                className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 font-bold flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 text-emerald-700" />
                <span>اجتماع جديد في هذا الوقت</span>
              </button>

              <button
                type="button"
                data-testid="slot-create-task-btn"
                onClick={() => {
                  const parts =
                    parseDateOnlyString(quickSlotModal.dateKey) || todayParts;
                  const startDt = buildZonedDate(
                    parts,
                    quickSlotModal.hour,
                    0,
                    localTimeZone
                  );
                  const endDt = new Date(
                    startDt.getTime() + quickSlotModal.durationMinutes * 60000
                  );
                  setQuickSlotModal(null);
                  onCreateNewTask({
                    clientId: clientIdFilter !== 'all' ? clientIdFilter : undefined,
                    dueDate: quickSlotModal.dateKey,
                    scheduledStartAt: startDt.toISOString(),
                    scheduledEndAt: endDt.toISOString(),
                  });
                }}
                className="p-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-900 font-bold flex items-center justify-center gap-1.5"
              >
                <CheckSquare className="w-4 h-4 text-emerald-700" />
                <span>مهمة جديدة مع وقت عمل</span>
              </button>
            </div>

            {/* Schedule an Existing Task into this Time Slot */}
            <form
              onSubmit={handleScheduleSelectedTaskInSlot}
              className="pt-3 border-t border-stone-100 space-y-3"
            >
              <h4 className="font-bold text-stone-900">
                أو جدولة وقت عمل لمهمة موجودة (دون تكرارها):
              </h4>

              {eligibleTasksForScheduling.length === 0 ? (
                <p className="text-stone-500 text-[11px]">
                  لا توجد مهام مفتوحة حالياً لجدولتها.
                </p>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="quick-slot-task-select"
                      className="block text-[11px] font-semibold text-stone-600 mb-1"
                    >
                      اختر المهمة
                    </label>
                    <select
                      id="quick-slot-task-select"
                      data-testid="quick-slot-task-select"
                      value={quickSlotModal.selectedTaskId}
                      onChange={(e) =>
                        setQuickSlotModal((prev) =>
                          prev
                            ? { ...prev, selectedTaskId: e.target.value, errorAr: null }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs font-medium"
                    >
                      {eligibleTasksForScheduling.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}{' '}
                          {t.dueDate ? `(الاستحقاق: ${t.dueDate})` : ''}{' '}
                          {t.scheduledStartAt ? '[لها وقت عمل سابق]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="quick-slot-hour-select"
                        className="block text-[11px] font-semibold text-stone-600 mb-1"
                      >
                        ساعة البدء
                      </label>
                      <select
                        id="quick-slot-hour-select"
                        value={quickSlotModal.hour}
                        onChange={(e) =>
                          setQuickSlotModal((prev) =>
                            prev ? { ...prev, hour: Number(e.target.value) } : null
                          )
                        }
                        className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs font-mono"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {formatHourMinuteLabel(h, 0, calendarSettings.timeFormat)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="quick-slot-duration-select"
                        className="block text-[11px] font-semibold text-stone-600 mb-1"
                      >
                        مدة العمل المخططة
                      </label>
                      <select
                        id="quick-slot-duration-select"
                        value={quickSlotModal.durationMinutes}
                        onChange={(e) =>
                          setQuickSlotModal((prev) =>
                            prev
                              ? { ...prev, durationMinutes: Number(e.target.value) }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value={30}>30 دقيقة</option>
                        <option value={45}>45 دقيقة</option>
                        <option value={60}>60 دقيقة (ساعة)</option>
                        <option value={90}>90 دقيقة</option>
                        <option value={120}>120 دقيقة (ساعتان)</option>
                      </select>
                    </div>
                  </div>

                  {quickSlotModal.errorAr && (
                    <p className="text-rose-700 font-semibold">{quickSlotModal.errorAr}</p>
                  )}

                  <button
                    type="submit"
                    data-testid="quick-slot-schedule-task-submit"
                    className="w-full py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold"
                  >
                    تخصيص وقت العمل للمهمة المختارة
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Reusable Accessible Calendar Event Card (Never relies on color alone)
// ============================================================================

interface CalendarEventCardProps {
  event: CalendarEventItem;
  timeFormat: CalendarTimeFormat;
  timeZone: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onOpenRecord: () => void;
  onPrepareMeeting?: () => void;
  onReschedule?: () => void;
  onClearTimeBlock?: () => void;
  onToggleTask?: () => void;
}

const CalendarEventCard: React.FC<CalendarEventCardProps> = ({
  event,
  timeFormat,
  timeZone,
  draggable,
  onDragStart,
  onOpenRecord,
  onPrepareMeeting,
  onReschedule,
  onClearTimeBlock,
  onToggleTask,
}) => {
  const meta = ACTIVITY_TYPE_META[event.activityType];

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={`calendar-event-card-${event.id}`}
      className={`p-3 rounded-xl border bg-white hover:bg-stone-50/70 transition-colors space-y-2 ${meta.borderClass} border-stone-200`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {onToggleTask &&
            (event.activityType === 'task_due' || event.activityType === 'task_block') && (
              <button
                type="button"
                onClick={onToggleTask}
                aria-label={`تبديل حالة إكمال المهمة ${event.title}`}
                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  event.isCompletedOrClosed
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-stone-300 bg-white hover:border-emerald-600'
                }`}
              >
                {event.isCompletedOrClosed && <CheckCircle2 className="w-3 h-3" />}
              </button>
            )}

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center flex-wrap gap-1.5">
              {/* Explicit Type Badge + Icon Dot (Never color alone) */}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${meta.badgeClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                <span>{event.activityTypeLabelAr}</span>
              </span>

              {event.minutesLocked && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200"
                  title="محضر نهائي مقفل"
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span>محضر نهائي</span>
                </span>
              )}

              {event.isOverdue && !event.isCompletedOrClosed && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                  متأخر
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenRecord}
              className={`text-xs font-extrabold text-start hover:text-emerald-800 block ${
                event.isCompletedOrClosed
                  ? 'line-through text-stone-400'
                  : 'text-stone-900'
              }`}
            >
              {event.title}
            </button>
          </div>
        </div>

        {/* Time or All-Day Label */}
        <div className="text-end shrink-0">
          {event.isTimed && event.startIso ? (
            <div className="font-mono text-[11px] font-bold text-stone-800">
              {formatTimeInZone(event.startIso, timeFormat, timeZone)}
              {event.endIso
                ? ` - ${formatTimeInZone(event.endIso, timeFormat, timeZone)}`
                : ''}
            </div>
          ) : (
            <span className="text-[10px] font-semibold text-stone-500">
              تاريخ فقط ({event.dateKey})
            </span>
          )}
          {event.isTimed && (
            <span className="text-[10px] text-stone-500 block">
              {event.hasKnownDuration && event.durationMinutes
                ? `${event.durationMinutes} دقيقة`
                : 'المدة غير محددة'}
            </span>
          )}
        </div>
      </div>

      {/* Metadata Row */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-stone-500 pt-1 border-t border-stone-100">
        <div className="flex items-center flex-wrap gap-1.5">
          {event.clientName && (
            <span className="font-medium text-stone-700">{event.clientName}</span>
          )}
          <span>·</span>
          <span>{event.statusLabelAr}</span>
          {event.subtitle && (
            <>
              <span>·</span>
              <span className="truncate max-w-[200px]">{event.subtitle}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {onPrepareMeeting && (
            <button
              type="button"
              data-testid={`calendar-prepare-btn-${event.id}`}
              onClick={onPrepareMeeting}
              className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-semibold"
            >
              فتح التحضير
            </button>
          )}
          {onReschedule && !event.isCancelled && (
            <button
              type="button"
              data-testid={`reschedule-btn-${event.id}`}
              onClick={onReschedule}
              className="px-2 py-1 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-800 text-[10px] font-semibold"
            >
              {event.activityType === 'task_due'
                ? 'جدولة وقت عمل'
                : event.activityType === 'task_block'
                ? 'تعديل وقت العمل'
                : 'تغيير الموعد'}
            </button>
          )}
          {onClearTimeBlock && (
            <button
              type="button"
              onClick={onClearTimeBlock}
              className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-[10px] font-semibold"
            >
              إلغاء الوقت
            </button>
          )}
          <button
            type="button"
            onClick={onOpenRecord}
            className="px-2 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-[10px] font-semibold"
          >
            فتح السجل
          </button>
        </div>
      </div>
    </div>
  );
};
