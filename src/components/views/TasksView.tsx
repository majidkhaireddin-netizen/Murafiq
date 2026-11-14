import React, { useEffect, useState } from 'react';
import { ActionItem, Client, Meeting, Opportunity, TaskPriority, TaskStatus, ProvenanceType } from '../../types';
import { formatArabicDate, getRelativeTimeArabic, categorizeTasks, suggestFollowUpDate } from '../../utils/logic';
import { ProvenanceBadge } from '../ProvenanceBadge';
import {
  Briefcase,
  CheckSquare,
  Plus,
  Clock,
  Calendar,
  Sparkles,
  AlertCircle,
  MoreVertical,
  CheckCircle2,
  X,
  ChevronDown,
  Filter,
  ArrowRight,
  Trash2,
  Edit2,
} from 'lucide-react';

import { categorizeDailyWorkTasks, resolveCalendarParts, formatCalendarDateKey, extractZonedCalendarParts } from '../../utils/followUpEngine';

export interface TasksFilterTrigger {
  scope?: 'all' | 'overdue' | 'open' | 'completed';
  priority?: string;
  clientId?: string;
  nonce: number;
}

interface TasksViewProps {
  tasks: ActionItem[];
  clients: Client[];
  meetings: Meeting[];
  opportunities?: Opportunity[];
  onToggleTask: (taskId: string) => void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onDeleteTask: (taskId: string) => void;
  onSelectOpportunity?: (opportunityId: string) => void;
  preselectedClientId?: string | null;
  preselectedMeetingId?: string | null;
  createTrigger?: {
    clientId?: string;
    meetingId?: string;
    opportunityId?: string;
    nonce: number;
  } | null;
  openTaskTrigger?: { taskId: string; nonce: number } | null;
  filterTrigger?: TasksFilterTrigger | null;
  language: 'ar' | 'en';
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  clients,
  meetings,
  opportunities = [],
  onToggleTask,
  onSaveTask,
  onDeleteTask,
  onSelectOpportunity,
  preselectedClientId,
  preselectedMeetingId,
  createTrigger,
  openTaskTrigger,
  filterTrigger,
  language,
}) => {
  const [filterScope, setFilterScope] = useState<'all' | 'overdue' | 'open' | 'completed'>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterClientId, setFilterClientId] = useState<string>('all');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<ActionItem> | null>(null);

  useEffect(() => {
    if (filterTrigger && filterTrigger.nonce > 0) {
      setFilterScope(filterTrigger.scope || 'all');
      setFilterPriority(filterTrigger.priority || 'all');
      setFilterClientId(filterTrigger.clientId || 'all');
    }
  }, [filterTrigger?.nonce]);

  const todayKey = formatCalendarDateKey(extractZonedCalendarParts(new Date()));

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterClientId !== 'all' && t.clientId !== filterClientId) return false;
    if (filterScope === 'open') {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
    } else if (filterScope === 'completed') {
      if (t.status !== 'completed') return false;
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
    opportunityId?: string
  ) => {
    setEditingTask({
      clientId: clientId || preselectedClientId || (clients[0]?.id || ''),
      meetingId: meetingId || preselectedMeetingId || undefined,
      opportunityId: opportunityId || undefined,
      title: '',
      description: '',
      dueDate: new Date().toISOString().split('T')[0],
      priority: 'medium',
      status: 'pending',
      provenance: 'approved',
    });
    setIsEditModalOpen(true);
  };

  const handleOpenEdit = (task: ActionItem) => {
    setEditingTask({ ...task });
    setIsEditModalOpen(true);
  };

  useEffect(() => {
    if (createTrigger && createTrigger.nonce > 0) {
      handleOpenCreate(
        createTrigger.clientId,
        createTrigger.meetingId,
        createTrigger.opportunityId
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
    const baseDate = editingTask.dueDate || new Date().toISOString().split('T')[0];
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
      title: editingTask.title,
      description: editingTask.description || '',
      dueDate: editingTask.dueDate,
      priority: editingTask.priority || 'medium',
      status: editingTask.status || 'pending',
      provenance: editingTask.provenance || 'approved',
      createdAt: editingTask.createdAt || new Date().toISOString(),
    };

    try {
      await onSaveTask(saved);
      setIsEditModalOpen(false);
      setEditingTask(null);
    } catch (err) {
      console.warn('TasksView: Save task failed, keeping modal open for retry:', err);
    }
  };

  const renderTaskItem = (task: ActionItem) => {
    const client = clients.find((c) => c.id === task.clientId);
    const isCompleted = task.status === 'completed';

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
              {client && (
                <span className="font-medium text-stone-700">
                  {client.name}
                </span>
              )}

              {task.opportunityId && (
                <button
                  type="button"
                  onClick={() =>
                    onSelectOpportunity && task.opportunityId && onSelectOpportunity(task.opportunityId)
                  }
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[10px] hover:bg-emerald-100"
                >
                  <Briefcase className="w-3 h-3" />
                  <span>
                    {opportunities.find((o) => o.id === task.opportunityId)?.title || 'فرصة عمل'}
                  </span>
                </button>
              )}

              {task.dueDate && (
                <span className="text-stone-600 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-stone-400" />
                  <span>{formatArabicDate(task.dueDate)}</span>
                  <span className="text-stone-400">({getRelativeTimeArabic(task.dueDate)})</span>
                </span>
              )}

              {/* Quick Postpone Shortcuts */}
              {!isCompleted && (
                <div className="flex items-center gap-1 ltr:ml-auto rtl:mr-auto text-[10px]">
                  <button
                    onClick={() => handlePostponeTask(task, 1)}
                    className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    title="تأجيل ليوم غد"
                  >
                    +1 يوم
                  </button>
                  <button
                    onClick={() => handlePostponeTask(task, 3)}
                    className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    title="تأجيل 3 أيام"
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
            {language === 'ar' ? 'متابعة دورية مباشرة بدون تعقيد' : 'Direct lightweight action item tracking'}
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
          onChange={(e) =>
            setFilterScope(e.target.value as 'all' | 'overdue' | 'open' | 'completed')
          }
          className="bg-white border border-stone-200 rounded-lg py-1 px-2.5 text-xs text-stone-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
        >
          <option value="all">كل المهام</option>
          <option value="overdue">المتأخرة فقط</option>
          <option value="open">المفتوحة فقط</option>
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
                    <label className="font-semibold text-stone-700">الموعد النهائي</label>
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
