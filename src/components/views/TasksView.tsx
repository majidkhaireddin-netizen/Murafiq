import React, { useEffect, useState } from 'react';
import {
  ActionItem,
  Client,
  Meeting,
  Opportunity,
  PlaybookRun,
  TaskPriority,
  ProvenanceType,
} from '../../types';
import {
  formatArabicDate,
  getRelativeTimeArabic,
  suggestFollowUpDate,
} from '../../utils/logic';
import { ProvenanceBadge } from '../ProvenanceBadge';
import {
  Briefcase,
  Plus,
  Clock,
  Calendar,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  X,
  Trash2,
  Edit2,
  PhoneCall,
  ListChecks,
} from 'lucide-react';

import {
  categorizeDailyWorkTasks,
  resolveCalendarParts,
  formatCalendarDateKey,
  extractZonedCalendarParts,
} from '../../utils/followUpEngine';
import {
  assignTaskTimeBlock,
  buildTimeBlockFromDateAndTime,
  clearTaskTimeBlock,
  decodeTaskTimeBlockFromFirestore,
  extractZonedHourAndMinute,
  formatIsoToDateTimeLocalInput,
  formatTimeInZone,
  validateTimeBlockInterval,
} from '../../utils/calendarEngine';

export type TaskFilterScope =
  | 'all'
  | 'overdue'
  | 'open'
  | 'time_blocked'
  | 'unscheduled'
  | 'completed';

export interface TasksFilterTrigger {
  scope?: TaskFilterScope;
  priority?: string;
  clientId?: string;
  nonce: number;
}

interface TasksViewProps {
  tasks: ActionItem[];
  clients: Client[];
  meetings: Meeting[];
  opportunities?: Opportunity[];
  playbookRuns?: PlaybookRun[];
  onToggleTask: (taskId: string) => void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onDeleteTask: (taskId: string) => void;
  onSelectOpportunity?: (opportunityId: string) => void;
  onOpenPlaybookRun?: (runId: string) => void;
  onScheduleInCalendar?: (task: ActionItem) => void;
  preselectedClientId?: string | null;
  preselectedMeetingId?: string | null;
  createTrigger?: {
    clientId?: string;
    meetingId?: string;
    opportunityId?: string;
    dueDate?: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    nonce: number;
  } | null;
  openTaskTrigger?: { taskId: string; nonce: number } | null;
  filterTrigger?: TasksFilterTrigger | null;
  language: 'ar' | 'en';
}

const QUICK_DURATION_OPTIONS = [30, 45, 60, 90, 120] as const;

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  clients,
  opportunities = [],
  playbookRuns = [],
  onToggleTask,
  onSaveTask,
  onDeleteTask,
  onSelectOpportunity,
  onOpenPlaybookRun,
  onScheduleInCalendar,
  preselectedClientId,
  preselectedMeetingId,
  createTrigger,
  openTaskTrigger,
  filterTrigger,
  language,
}) => {
  const [filterScope, setFilterScope] = useState<TaskFilterScope>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterClientId, setFilterClientId] = useState<string>('all');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<ActionItem> | null>(null);
  const [formTimeBlockError, setFormTimeBlockError] = useState<string | null>(null);

  // Dedicated Quick Time Block Modal State (schedules work time without altering dueDate)
  const [timeBlockModalTask, setTimeBlockModalTask] = useState<ActionItem | null>(null);
  const [tbDateKey, setTbDateKey] = useState<string>('');
  const [tbStartTime, setTbStartTime] = useState<string>('10:00');
  const [tbDurationMinutes, setTbDurationMinutes] = useState<number>(60);
  const [tbStartLocal, setTbStartLocal] = useState<string>('');
  const [tbEndLocal, setTbEndLocal] = useState<string>('');
  const [tbError, setTbError] = useState<string | null>(null);

  useEffect(() => {
    if (filterTrigger && filterTrigger.nonce > 0) {
      setFilterScope(filterTrigger.scope || 'all');
      setFilterPriority(filterTrigger.priority || 'all');
      setFilterClientId(filterTrigger.clientId || 'all');
    }
  }, [filterTrigger?.nonce]);

  const todayKey = formatCalendarDateKey(extractZonedCalendarParts(new Date()));

  // Filter tasks (always decode Firestore wire time block first)
  const filteredTasks = tasks
    .map((t) => decodeTaskTimeBlockFromFirestore(t))
    .filter((t) => {
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      if (filterClientId !== 'all' && t.clientId !== filterClientId) return false;
      const hasValidTimeBlock = Boolean(
        t.scheduledStartAt &&
          t.scheduledEndAt &&
          validateTimeBlockInterval(t.scheduledStartAt, t.scheduledEndAt).valid
      );
      if (filterScope === 'open') {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
      } else if (filterScope === 'completed') {
        if (t.status !== 'completed') return false;
      } else if (filterScope === 'time_blocked') {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        if (!hasValidTimeBlock) return false;
      } else if (filterScope === 'unscheduled') {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        if (hasValidTimeBlock) return false;
      } else if (filterScope === 'overdue') {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        const dueParts = resolveCalendarParts(t.dueDate);
        if (!dueParts || formatCalendarDateKey(dueParts) >= todayKey) return false;
      }
      return true;
    });

  const { overdue, today, thisWeek, later } = categorizeDailyWorkTasks(filteredTasks);
  const completedTasks = filteredTasks.filter((t) => t.status === 'completed');

  const handleOpenCreate = (
    clientId?: string,
    meetingId?: string,
    opportunityId?: string,
    dueDateOverride?: string,
    scheduledStartAtOverride?: string,
    scheduledEndAtOverride?: string
  ) => {
    setFormTimeBlockError(null);
    setEditingTask({
      clientId: clientId || preselectedClientId || (clients[0]?.id || ''),
      meetingId: meetingId || preselectedMeetingId || undefined,
      opportunityId: opportunityId || undefined,
      title: '',
      description: '',
      dueDate: dueDateOverride || todayKey,
      scheduledStartAt: scheduledStartAtOverride,
      scheduledEndAt: scheduledEndAtOverride,
      priority: 'medium',
      status: 'pending',
      provenance: 'approved',
    });
    setIsEditModalOpen(true);
  };

  const handleOpenEdit = (task: ActionItem) => {
    setFormTimeBlockError(null);
    setEditingTask({ ...decodeTaskTimeBlockFromFirestore(task) });
    setIsEditModalOpen(true);
  };

  const handleOpenTimeBlockModal = (rawTask: ActionItem) => {
    const task = decodeTaskTimeBlockFromFirestore(rawTask);
    setTbError(null);
    setTimeBlockModalTask(task);

    if (task.scheduledStartAt && task.scheduledEndAt) {
      const check = validateTimeBlockInterval(task.scheduledStartAt, task.scheduledEndAt);
      if (check.valid && check.startMs && check.endMs && check.durationMinutes) {
        const startDate = new Date(check.startMs);
        const dateParts = extractZonedCalendarParts(startDate);
        const hm = extractZonedHourAndMinute(startDate);
        setTbDateKey(formatCalendarDateKey(dateParts));
        setTbStartTime(
          `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`
        );
        setTbDurationMinutes(check.durationMinutes);
        setTbStartLocal(formatIsoToDateTimeLocalInput(check.startIso));
        setTbEndLocal(formatIsoToDateTimeLocalInput(check.endIso));
        return;
      }
    }

    const defaultDateKey =
      task.dueDate && task.dueDate >= todayKey ? task.dueDate : todayKey;
    const defaultStart = '10:00';
    const defaultDur = 60;
    setTbDateKey(defaultDateKey);
    setTbStartTime(defaultStart);
    setTbDurationMinutes(defaultDur);
    const built = buildTimeBlockFromDateAndTime({
      dateKey: defaultDateKey,
      startTimeHHMM: defaultStart,
      durationMinutes: defaultDur,
    });
    setTbStartLocal(
      built.ok && built.scheduledStartAt
        ? formatIsoToDateTimeLocalInput(built.scheduledStartAt)
        : `${defaultDateKey}T10:00`
    );
    setTbEndLocal(
      built.ok && built.scheduledEndAt
        ? formatIsoToDateTimeLocalInput(built.scheduledEndAt)
        : `${defaultDateKey}T11:00`
    );
  };

  const handleSyncQuickTimeBlockBuilder = (
    nextDateKey: string,
    nextStartTime: string,
    nextDuration: number
  ) => {
    setTbError(null);
    setTbDateKey(nextDateKey);
    setTbStartTime(nextStartTime);
    setTbDurationMinutes(nextDuration);
    const built = buildTimeBlockFromDateAndTime({
      dateKey: nextDateKey,
      startTimeHHMM: nextStartTime,
      durationMinutes: nextDuration,
    });
    if (built.ok && built.scheduledStartAt && built.scheduledEndAt) {
      setTbStartLocal(formatIsoToDateTimeLocalInput(built.scheduledStartAt));
      setTbEndLocal(formatIsoToDateTimeLocalInput(built.scheduledEndAt));
    }
  };

  const handleSaveTimeBlockModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timeBlockModalTask) return;

    const assigned = assignTaskTimeBlock(timeBlockModalTask, tbStartLocal, tbEndLocal);
    if (!assigned.ok || !assigned.task) {
      setTbError(
        assigned.errorAr || 'يرجى التأكد من أن وقت انتهاء العمل المخطط بعد وقت البدء.'
      );
      return;
    }

    try {
      await onSaveTask(assigned.task);
      setTimeBlockModalTask(null);
      setTbError(null);
    } catch (err) {
      setTbError(
        err instanceof Error && err.message
          ? err.message
          : 'تعذرت مزامنة وقت العمل مع الخادم. تم الاحتفاظ بالمسودة.'
      );
    }
  };

  const handleClearTimeBlockFromModal = async () => {
    if (!timeBlockModalTask) return;
    const cleared = clearTaskTimeBlock(timeBlockModalTask);
    try {
      await onSaveTask(cleared);
      setTimeBlockModalTask(null);
      setTbError(null);
    } catch (err) {
      setTbError(
        err instanceof Error && err.message
          ? err.message
          : 'تعذرت مزامنة التعديل مع الخادم. تم الاحتفاظ بالمسودة.'
      );
    }
  };

  const handleApplyEditModalDurationPreset = (minutes: number) => {
    if (!editingTask) return;
    setFormTimeBlockError(null);
    let baseStartLocal = editingTask.scheduledStartAt
      ? formatIsoToDateTimeLocalInput(editingTask.scheduledStartAt)
      : '';
    if (!baseStartLocal) {
      const targetDate =
        editingTask.dueDate && editingTask.dueDate >= todayKey
          ? editingTask.dueDate
          : todayKey;
      baseStartLocal = `${targetDate}T10:00`;
    }
    const startMs = new Date(baseStartLocal).getTime();
    if (Number.isNaN(startMs)) return;
    const endIso = new Date(startMs + minutes * 60000).toISOString();
    setEditingTask({
      ...editingTask,
      scheduledStartAt: new Date(startMs).toISOString(),
      scheduledEndAt: endIso,
    });
  };

  useEffect(() => {
    if (createTrigger && createTrigger.nonce > 0) {
      handleOpenCreate(
        createTrigger.clientId,
        createTrigger.meetingId,
        createTrigger.opportunityId,
        createTrigger.dueDate,
        createTrigger.scheduledStartAt,
        createTrigger.scheduledEndAt
      );
    }
  }, [createTrigger?.nonce]);

  useEffect(() => {
    if (openTaskTrigger && openTaskTrigger.nonce > 0) {
      const target = tasks.find((t) => t.id === openTaskTrigger.taskId);
      if (target) {
        if (target.clientId) setFilterClientId(target.clientId);
        handleOpenEdit(target);
      }
    }
  }, [openTaskTrigger?.nonce]);

  const handleSmartSuggestDate = (priority: TaskPriority) => {
    if (!editingTask) return;
    const baseDate = editingTask.dueDate || todayKey;
    const suggestion = suggestFollowUpDate(baseDate, priority);
    setEditingTask({
      ...editingTask,
      dueDate: suggestion.suggestedDate,
      provenance: 'ai_suggested',
    });
  };

  const handlePostponeTask = (task: ActionItem, days: number) => {
    const base = task.dueDate ? new Date(task.dueDate) : new Date();
    const newDate = new Date(base.getTime() + days * 86400000).toISOString().split('T')[0];
    onSaveTask({
      ...task,
      dueDate: newDate,
    });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask?.title || !editingTask.clientId) return;

    let cleanStartIso: string | undefined = undefined;
    let cleanEndIso: string | undefined = undefined;
    if (editingTask.scheduledStartAt || editingTask.scheduledEndAt) {
      const check = validateTimeBlockInterval(
        editingTask.scheduledStartAt,
        editingTask.scheduledEndAt
      );
      if (!check.valid || !check.startIso || !check.endIso) {
        setFormTimeBlockError(
          check.errorAr || 'يرجى التأكد من صحة وقت البدء ووقت الانتهاء لوقت العمل المخطط.'
        );
        return;
      }
      cleanStartIso = check.startIso;
      cleanEndIso = check.endIso;
    }

    const validOppId =
      editingTask.opportunityId &&
      opportunities.some(
        (o) => o.id === editingTask.opportunityId && o.clientId === editingTask.clientId
      )
        ? editingTask.opportunityId
        : undefined;

    const saved: ActionItem = {
      id: editingTask.id || `t-${Date.now()}`,
      clientId: editingTask.clientId,
      meetingId: editingTask.meetingId,
      opportunityId: validOppId,
      interactionId: editingTask.interactionId,
      playbookRunId: editingTask.playbookRunId,
      playbookStepId: editingTask.playbookStepId,
      title: editingTask.title,
      description: editingTask.description || '',
      dueDate: editingTask.dueDate,
      scheduledStartAt: cleanStartIso,
      scheduledEndAt: cleanEndIso,
      priority: editingTask.priority || 'medium',
      status: editingTask.status || 'pending',
      reminderDate: editingTask.reminderDate,
      completedAt: editingTask.completedAt,
      provenance: editingTask.provenance || 'approved',
      createdAt: editingTask.createdAt || new Date().toISOString(),
    };

    try {
      await onSaveTask(saved);
      setIsEditModalOpen(false);
      setEditingTask(null);
      setFormTimeBlockError(null);
    } catch (err) {
      console.warn('TasksView: Save task failed, keeping modal open for retry:', err);
      setFormTimeBlockError(
        err instanceof Error && err.message
          ? err.message
          : 'تعذرت مزامنة المهمة مع الخادم. تم الاحتفاظ بالمسودة.'
      );
    }
  };

  const renderTaskItem = (task: ActionItem) => {
    const client = clients.find((c) => c.id === task.clientId);
    const isCompleted = task.status === 'completed';
    const hasTimeBlock = Boolean(task.scheduledStartAt && task.scheduledEndAt);
    const timeBlockDateLabel = task.scheduledStartAt
      ? formatCalendarDateKey(extractZonedCalendarParts(new Date(task.scheduledStartAt)))
      : '';

    const getPriorityBadge = (p: TaskPriority) => {
      switch (p) {
        case 'urgent':
          return { label: 'عاجلة', color: 'bg-rose-100 text-rose-800 border-rose-200' };
        case 'high':
          return { label: 'عالية', color: 'bg-amber-100 text-amber-800 border-amber-200' };
        case 'medium':
          return { label: 'متوسطة', color: 'bg-sky-50 text-sky-800 border-sky-200' };
        default:
          return { label: 'منخفضة', color: 'bg-stone-100 text-stone-700 border-stone-200' };
      }
    };

    const prio = getPriorityBadge(task.priority);

    return (
      <div
        key={task.id}
        className={`p-3 rounded-2xl border transition-all ${
          isCompleted
            ? 'bg-stone-50/70 border-stone-200 opacity-60'
            : 'bg-white border-stone-200 shadow-xs hover:border-emerald-300'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {/* Checkbox */}
          <button
            onClick={() => onToggleTask(task.id)}
            className={`w-5 h-5 rounded-md border-2 mt-0.5 shrink-0 flex items-center justify-center transition-colors ${
              isCompleted
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'border-stone-300 hover:border-emerald-600 hover:bg-emerald-50'
            }`}
            aria-label="Toggle task completed"
          >
            {isCompleted && <CheckCircle2 className="w-4 h-4" />}
          </button>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`font-semibold text-xs leading-snug ${
                  isCompleted ? 'line-through text-stone-400' : 'text-stone-900'
                }`}
              >
                {task.title}
              </span>

              {/* Priority badge */}
              <span
                className={`inline-block text-[10px] px-1.5 py-0.2 rounded border font-semibold ${prio.color}`}
              >
                {prio.label}
              </span>

              {/* Provenance badge */}
              <ProvenanceBadge type={task.provenance} showText={false} />
            </div>

            {task.description && (
              <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
                {task.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-400 flex-wrap">
              {client && <span className="font-medium text-stone-700">{client.name}</span>}

              {task.opportunityId && (
                <button
                  type="button"
                  onClick={() =>
                    onSelectOpportunity &&
                    task.opportunityId &&
                    onSelectOpportunity(task.opportunityId)
                  }
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[10px] hover:bg-emerald-100"
                >
                  <Briefcase className="w-3 h-3" />
                  <span>
                    {opportunities.find((o) => o.id === task.opportunityId)?.title || 'فرصة عمل'}
                  </span>
                </button>
              )}

              {task.interactionId && (
                <span
                  data-testid={`task-interaction-badge-${task.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 font-semibold text-[10px]"
                >
                  <PhoneCall className="w-3 h-3" />
                  <span>مرتبطة بسجل تواصل</span>
                </span>
              )}

              {task.playbookRunId && (
                <button
                  type="button"
                  data-testid={`task-playbook-badge-${task.id}`}
                  onClick={() =>
                    onOpenPlaybookRun && task.playbookRunId && onOpenPlaybookRun(task.playbookRunId)
                  }
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold text-[10px] hover:bg-indigo-100"
                >
                  <ListChecks className="w-3 h-3" />
                  <span>
                    من خطة: {playbookRuns.find((r) => r.id === task.playbookRunId)?.templateName || 'خطة متابعة'}
                  </span>
                </button>
              )}

              {task.dueDate && (
                <span
                  data-testid={`task-due-date-badge-${task.id}`}
                  className="text-stone-600 flex items-center gap-1"
                >
                  <Calendar className="w-3 h-3 text-stone-400" />
                  <span>الاستحقاق: {formatArabicDate(task.dueDate)}</span>
                  <span className="text-stone-400">({getRelativeTimeArabic(task.dueDate)})</span>
                </span>
              )}

              {hasTimeBlock && task.scheduledStartAt && task.scheduledEndAt && (
                <span
                  data-testid={`task-time-block-badge-${task.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-900 border border-sky-200 font-semibold text-[10px]"
                >
                  <Clock className="w-3 h-3 text-sky-700" />
                  <span>
                    وقت العمل: {timeBlockDateLabel} ·{' '}
                    {formatTimeInZone(task.scheduledStartAt, '12h')} -{' '}
                    {formatTimeInZone(task.scheduledEndAt, '12h')}
                  </span>
                </span>
              )}

              {/* Quick Time Blocking, Postpone & Calendar Shortcuts */}
              {!isCompleted && (
                <div className="flex items-center gap-1 ltr:ml-auto rtl:mr-auto text-[10px] flex-wrap">
                  <button
                    type="button"
                    data-testid={`task-quick-time-block-${task.id}`}
                    onClick={() => handleOpenTimeBlockModal(task)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-2xs transition-colors"
                    title="تخطيط وجدولة وقت للعمل على المهمة دون تغيير تاريخ الاستحقاق"
                  >
                    <Clock className="w-2.5 h-2.5" />
                    <span>{hasTimeBlock ? 'تعديل وقت العمل' : 'جدولة وقت عمل'}</span>
                  </button>
                  {onScheduleInCalendar && (
                    <button
                      type="button"
                      data-testid={`task-schedule-in-calendar-${task.id}`}
                      onClick={() => onScheduleInCalendar(task)}
                      className="px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800 hover:bg-sky-100 font-semibold"
                      title="عرض وتخصيص وقت العمل في شبكة التقويم"
                    >
                      في التقويم
                    </button>
                  )}
                  <button
                    onClick={() => handlePostponeTask(task, 1)}
                    className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    title="تأجيل تاريخ الاستحقاق ليوم غد"
                  >
                    +1 يوم
                  </button>
                  <button
                    onClick={() => handlePostponeTask(task, 3)}
                    className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    title="تأجيل تاريخ الاستحقاق 3 أيام"
                  >
                    +3 أيام
                  </button>
                  <button
                    onClick={() => handleOpenEdit(task)}
                    className="p-1 text-stone-400 hover:text-emerald-700 rounded"
                    title="تعديل المهمة"
                    aria-label={`تعديل مهمة ${task.title}`}
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1 text-stone-400 hover:text-rose-600 rounded"
                    title="حذف المهمة"
                    aria-label={`حذف مهمة ${task.title}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-6">
      {/* View Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading font-extrabold text-xl text-stone-900">
            {language === 'ar' ? 'مهام المتابعة والالتزامات' : 'Action Items & Follow-ups'}
          </h2>
          <p className="text-xs text-stone-500">
            {language === 'ar'
              ? 'متابعة الالتزامات وتخصيص فترات عمل زمنية (Time Blocking) دون المساس بمواعيد الاستحقاق'
              : 'Direct action item tracking with non-destructive Time Blocking'}
          </p>
        </div>
        <button
          onClick={() => handleOpenCreate()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>مهمة جديدة</span>
        </button>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs flex-wrap">
        <select
          aria-label="تصفية حسب حالة المهام"
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value as TaskFilterScope)}
          className="bg-white border border-stone-200 rounded-lg py-1 px-2.5 text-xs text-stone-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
        >
          <option value="all">كل المهام</option>
          <option value="overdue">المتأخرة فقط</option>
          <option value="open">المفتوحة فقط</option>
          <option value="time_blocked">المجدولة بوقت عمل (Time Blocked)</option>
          <option value="unscheduled">مفتوحة بدون وقت عمل محجوز</option>
          <option value="completed">المنجزة فقط</option>
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-white border border-stone-200 rounded-lg py-1 px-2.5 text-xs text-stone-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
        >
          <option value="all">كل درجات الأهمية</option>
          <option value="urgent">عاجلة فقط</option>
          <option value="high">عالية فقط</option>
          <option value="medium">متوسطة</option>
          <option value="low">منخفضة</option>
        </select>

        <select
          value={filterClientId}
          onChange={(e) => setFilterClientId(e.target.value)}
          className="bg-white border border-stone-200 rounded-lg py-1 px-2.5 text-xs text-stone-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600 max-w-[160px] truncate"
        >
          <option value="all">كل العملاء</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {(filterScope !== 'all' || filterPriority !== 'all' || filterClientId !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setFilterScope('all');
              setFilterPriority('all');
              setFilterClientId('all');
            }}
            className="px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium"
          >
            مسح التصفية
          </button>
        )}
      </div>

      {/* Categorized Lists */}
      <div className="space-y-5">
        {/* 1. Overdue */}
        {overdue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
              <AlertCircle className="w-4 h-4" />
              <span>المهام المتأخرة ({overdue.length})</span>
            </div>
            <div className="space-y-2">{overdue.map(renderTaskItem)}</div>
          </div>
        )}

        {/* 2. Today */}
        {today.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
              <Clock className="w-4 h-4" />
              <span>مهام اليوم ({today.length})</span>
            </div>
            <div className="space-y-2">{today.map(renderTaskItem)}</div>
          </div>
        )}

        {/* 3. This Week */}
        {thisWeek.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <Calendar className="w-4 h-4" />
              <span>خلال هذا الأسبوع ({thisWeek.length})</span>
            </div>
            <div className="space-y-2">{thisWeek.map(renderTaskItem)}</div>
          </div>
        )}

        {/* 4. Later */}
        {later.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-600">
              <span>مهام لاحقة ({later.length})</span>
            </div>
            <div className="space-y-2">{later.map(renderTaskItem)}</div>
          </div>
        )}

        {/* 5. Completed */}
        {completedTasks.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-stone-200">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>المهام المنجزة مؤخراً ({completedTasks.length})</span>
            </div>
            <div className="space-y-1.5">{completedTasks.map(renderTaskItem)}</div>
          </div>
        )}

        {filteredTasks.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-stone-200 text-stone-400 text-xs">
            لا توجد مهام تطابق الفلتر المختار.
          </div>
        )}
      </div>

      {/* Dedicated Quick Task Time Blocking Modal (Time Blocking without modifying dueDate) */}
      {timeBlockModalTask && (
        <div
          data-testid="task-quick-time-block-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto overflow-hidden border border-stone-200 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-sky-700" />
                <div>
                  <h3 className="font-heading font-bold text-base text-stone-900">
                    التخطيط الزمني للمهمة (Time Blocking)
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    تخصيص فترة عمل لتنفيذ المهمة دون تعديل تاريخ الاستحقاق
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTimeBlockModalTask(null)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
                aria-label="إغلاق نافذة التخطيط الزمني"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Task Summary & Preserved Due Date */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5 text-xs">
              <div className="font-bold text-stone-900">{timeBlockModalTask.title}</div>
              <div className="flex items-center justify-between text-[11px] text-stone-600 flex-wrap gap-2">
                <span>
                  العميل:{' '}
                  <strong>
                    {clients.find((c) => c.id === timeBlockModalTask.clientId)?.name || '—'}
                  </strong>
                </span>
                <span
                  data-testid="time-block-modal-preserved-due-date"
                  className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-semibold"
                >
                  تاريخ الاستحقاق (ثابت):{' '}
                  {timeBlockModalTask.dueDate
                    ? formatArabicDate(timeBlockModalTask.dueDate)
                    : 'غير محدد'}
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveTimeBlockModal} className="space-y-3.5 text-xs">
              {/* Quick Builder: Date + Start Hour + Duration */}
              <div className="p-3 rounded-xl bg-sky-50/70 border border-sky-200 space-y-2.5">
                <span className="font-bold text-sky-950 block">
                  اختيار سريع ليوم وساعة ومدة العمل
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                      يوم العمل المخطط
                    </label>
                    <input
                      type="date"
                      data-testid="tb-quick-date-input"
                      value={tbDateKey}
                      onChange={(e) =>
                        handleSyncQuickTimeBlockBuilder(
                          e.target.value,
                          tbStartTime,
                          tbDurationMinutes
                        )
                      }
                      className="w-full bg-white rounded-lg border border-sky-200 p-1.5 text-xs text-stone-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                      ساعة البدء
                    </label>
                    <input
                      type="time"
                      data-testid="tb-quick-start-time-input"
                      value={tbStartTime}
                      onChange={(e) =>
                        handleSyncQuickTimeBlockBuilder(
                          tbDateKey,
                          e.target.value,
                          tbDurationMinutes
                        )
                      }
                      className="w-full bg-white rounded-lg border border-sky-200 p-1.5 text-xs text-stone-800 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-sky-900 mb-1">
                    المدة المخططة للعمل
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {QUICK_DURATION_OPTIONS.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        data-testid={`tb-duration-preset-${mins}`}
                        onClick={() =>
                          handleSyncQuickTimeBlockBuilder(tbDateKey, tbStartTime, mins)
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          tbDurationMinutes === mins
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-white text-sky-900 border-sky-200 hover:bg-sky-100'
                        }`}
                      >
                        {mins} د
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Exact Start & End Timestamp Controls */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    بداية العمل (`scheduledStartAt`)
                  </label>
                  <input
                    type="datetime-local"
                    required
                    data-testid="tb-direct-start-input"
                    value={tbStartLocal}
                    onChange={(e) => {
                      setTbError(null);
                      setTbStartLocal(e.target.value);
                    }}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-[11px] font-mono text-stone-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    نهاية العمل (`scheduledEndAt`)
                  </label>
                  <input
                    type="datetime-local"
                    required
                    data-testid="tb-direct-end-input"
                    value={tbEndLocal}
                    onChange={(e) => {
                      setTbError(null);
                      setTbEndLocal(e.target.value);
                    }}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-[11px] font-mono text-stone-800"
                  />
                </div>
              </div>

              {tbError && (
                <p
                  data-testid="tb-modal-error"
                  className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2"
                >
                  {tbError}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-stone-100">
                {timeBlockModalTask.scheduledStartAt && timeBlockModalTask.scheduledEndAt ? (
                  <button
                    type="button"
                    data-testid="tb-modal-clear-btn"
                    onClick={() => void handleClearTimeBlockFromModal()}
                    className="px-3 py-1.5 rounded-xl text-rose-700 hover:bg-rose-50 border border-rose-200 font-semibold"
                  >
                    إزالة الوقت المحجوز
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTimeBlockModalTask(null)}
                    className="px-3 py-1.5 rounded-xl text-stone-600 hover:bg-stone-100 font-medium"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    data-testid="tb-modal-save-btn"
                    className="px-4 py-1.5 rounded-xl text-white bg-sky-700 hover:bg-sky-800 font-semibold shadow-xs"
                  >
                    حفظ وقت العمل
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Task Modal */}
      {isEditModalOpen && editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto overflow-hidden border border-stone-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4">
              <h3 className="font-heading font-bold text-base text-stone-900">
                {editingTask.id ? 'تعديل المهمة' : 'إضافة مهمة متابعة جديدة'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  العميل المرتبط <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={editingTask.clientId || ''}
                  onChange={(e) => {
                    const nextClientId = e.target.value;
                    const keepOpp = opportunities.some(
                      (o) => o.id === editingTask.opportunityId && o.clientId === nextClientId
                    );
                    setEditingTask({
                      ...editingTask,
                      clientId: nextClientId,
                      opportunityId: keepOpp ? editingTask.opportunityId : undefined,
                    });
                  }}
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {editingTask.clientId &&
                opportunities.some((o) => o.clientId === editingTask.clientId) && (
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      فرصة العمل المرتبطة (اختياري)
                    </label>
                    <select
                      data-testid="task-modal-opportunity-select"
                      value={editingTask.opportunityId || ''}
                      onChange={(e) =>
                        setEditingTask({
                          ...editingTask,
                          opportunityId: e.target.value || undefined,
                        })
                      }
                      className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    >
                      <option value="">-- بدون ربط بفرصة عمل --</option>
                      {opportunities
                        .filter((o) => o.clientId === editingTask.clientId)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.title}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  عنوان المهمة <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingTask.title || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                  placeholder="مثال: إرسال ملحق العقد المعدل"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">التفاصيل / الملاحظات</label>
                <textarea
                  rows={2}
                  value={editingTask.description || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                  placeholder="أي متطلبات فرعية..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-stone-700">
                      الموعد النهائي (Due Date)
                    </label>
                    <button
                      type="button"
                      onClick={() => handleSmartSuggestDate(editingTask.priority || 'medium')}
                      className="text-[10px] text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-0.5"
                      title="اقتراح موعد ذكي بناءً على الأولوية"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      <span>اقتراح ذكي</span>
                    </button>
                  </div>
                  <input
                    type="date"
                    value={editingTask.dueDate || ''}
                    onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">درجة الأهمية</label>
                  <select
                    value={editingTask.priority || 'medium'}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, priority: e.target.value as TaskPriority })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  >
                    <option value="urgent">عاجلة (خلال 48 ساعة)</option>
                    <option value="high">عالية (أولوية قصوى)</option>
                    <option value="medium">متوسطة (عادية)</option>
                    <option value="low">منخفضة</option>
                  </select>
                </div>
              </div>

              {/* Optional Task Time Block (وقت العمل المخطط - مستقل عن موعد الاستحقاق) */}
              <div
                data-testid="task-modal-time-block-section"
                className="p-3 rounded-xl bg-sky-50/70 border border-sky-200 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-sky-950 block">
                      وقت العمل المخطط (Time Block — اختياري)
                    </span>
                    <span className="text-[10px] text-sky-800">
                      حجز فترة زمنية لتنفيذ المهمة في التقويم دون تغيير الموعد النهائي أو حالة الإنجاز
                    </span>
                  </div>
                  {(editingTask.scheduledStartAt || editingTask.scheduledEndAt) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormTimeBlockError(null);
                        setEditingTask({
                          ...editingTask,
                          scheduledStartAt: undefined,
                          scheduledEndAt: undefined,
                        });
                      }}
                      className="text-[10px] font-semibold text-rose-700 hover:underline shrink-0"
                    >
                      مسح وقت العمل
                    </button>
                  )}
                </div>

                {/* Quick duration chips */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-sky-800 ml-1">مدة سريعة:</span>
                  {QUICK_DURATION_OPTIONS.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => handleApplyEditModalDurationPreset(mins)}
                      className="px-2 py-0.5 rounded bg-white hover:bg-sky-100 text-sky-900 border border-sky-200 text-[10px] font-semibold transition-colors"
                    >
                      {mins} د
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                      بداية العمل المخطط
                    </label>
                    <input
                      type="datetime-local"
                      data-testid="task-modal-scheduled-start"
                      value={formatIsoToDateTimeLocalInput(editingTask.scheduledStartAt)}
                      onChange={(e) => {
                        setFormTimeBlockError(null);
                        const val = e.target.value;
                        setEditingTask({
                          ...editingTask,
                          scheduledStartAt: val || undefined,
                        });
                      }}
                      className="w-full bg-white rounded-lg border border-sky-200 p-1.5 text-[11px] font-mono text-stone-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                      نهاية العمل المخطط
                    </label>
                    <input
                      type="datetime-local"
                      data-testid="task-modal-scheduled-end"
                      value={formatIsoToDateTimeLocalInput(editingTask.scheduledEndAt)}
                      onChange={(e) => {
                        setFormTimeBlockError(null);
                        const val = e.target.value;
                        setEditingTask({
                          ...editingTask,
                          scheduledEndAt: val || undefined,
                        });
                      }}
                      className="w-full bg-white rounded-lg border border-sky-200 p-1.5 text-[11px] font-mono text-stone-800"
                    />
                  </div>
                </div>

                {formTimeBlockError && (
                  <p
                    data-testid="task-modal-time-block-error"
                    className="text-[11px] font-semibold text-rose-700"
                  >
                    {formTimeBlockError}
                  </p>
                )}
              </div>

              {/* Provenance selection */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">مصدر المعلومة</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['approved', 'source', 'ai_suggested'] as ProvenanceType[]).map((prov) => (
                    <button
                      key={prov}
                      type="button"
                      onClick={() => setEditingTask({ ...editingTask, provenance: prov })}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border text-center transition-colors ${
                        editingTask.provenance === prov
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                          : 'bg-stone-50 text-stone-600 border-stone-200'
                      }`}
                    >
                      {prov === 'approved' && 'معتمد شخصياً'}
                      {prov === 'source' && 'من محضر اللقاء'}
                      {prov === 'ai_suggested' && 'اقتراح ذكي'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-stone-600 hover:bg-stone-100 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-white bg-emerald-700 hover:bg-emerald-800 font-semibold shadow-xs"
                >
                  حفظ المهمة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
