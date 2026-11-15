import React, { useMemo, useState } from 'react';
import type {
  ActionItem,
  Client,
  CommunicationChannel,
  CommunicationInteraction,
  Opportunity,
  PlaybookRescheduleSuggestion,
  PlaybookRun,
  PlaybookRunStep,
} from '../types';
import {
  PLAYBOOK_RUN_STATUS_META,
  PLAYBOOK_STEP_STATUS_META,
  PLAYBOOK_STEP_TYPE_META,
  STEP_DEPENDENCY_PLACEHOLDER_AR,
  canLinkExistingTaskToPlaybookStep,
  cancelPlaybookRun,
  completePlaybookRun,
  completePlaybookStep,
  computePlaybookRunProgress,
  getPlaybookRunStepPointers,
  isCommunicationOutcomeConfirmedContact,
  linkCommunicationToPlaybookStep,
  linkExistingTaskToPlaybookStep,
  pausePlaybookRun,
  reopenPlaybookStep,
  resumePlaybookRun,
  skipPlaybookStep,
  startPlaybookStep,
  updatePlaybookStepDueDate,
  type AtomicStepTaskCreationOutcome,
} from '../utils/playbookEngine';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOME_META,
} from '../utils/communications';
import { formatArabicDate } from '../utils/logic';
import {
  ArrowRight,
  Building2,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  PauseCircle,
  PlayCircle,
  XCircle,
  AlertTriangle,
  SkipForward,
  RotateCcw,
  CheckSquare,
  Phone,
  Link2,
  ExternalLink,
  Info,
  RefreshCw,
} from 'lucide-react';

interface PlaybookRunWorkspaceProps {
  run: PlaybookRun;
  allRuns: PlaybookRun[];
  clients: Client[];
  opportunities: Opportunity[];
  tasks: ActionItem[];
  interactions: CommunicationInteraction[];
  currentUserId: string;
  isOnline: boolean;
  language: 'ar' | 'en';
  onBack: () => void;
  onSaveRun: (run: PlaybookRun) => void;
  onSaveTask: (task: ActionItem) => void;
  onAtomicConvertStepToTask: (
    run: PlaybookRun,
    stepId: string
  ) => Promise<AtomicStepTaskCreationOutcome>;
  onApproveRescheduleSuggestion: (
    suggestion: PlaybookRescheduleSuggestion,
    applyToLinkedTask: boolean
  ) => void;
  onLogCommunicationForStep: (params: {
    run: PlaybookRun;
    step: PlaybookRunStep;
    suggestedChannel?: CommunicationChannel;
  }) => void;
  onSelectClient: (client: Client) => void;
  onSelectOpportunity: (opportunity: Opportunity) => void;
  onOpenTask: (task: ActionItem) => void;
  onOpenInteraction: (interaction: CommunicationInteraction) => void;
}

export const PlaybookRunWorkspace: React.FC<PlaybookRunWorkspaceProps> = ({
  run,
  allRuns,
  clients,
  opportunities,
  tasks,
  interactions,
  currentUserId,
  isOnline,
  onBack,
  onSaveRun,
  onSaveTask,
  onAtomicConvertStepToTask,
  onApproveRescheduleSuggestion,
  onLogCommunicationForStep,
  onSelectClient,
  onSelectOpportunity,
  onOpenTask,
  onOpenInteraction,
}) => {
  const [actionErrorAr, setActionErrorAr] = useState<string | null>(null);
  const [actionNoticeAr, setActionNoticeAr] = useState<string | null>(null);
  const [rescheduleSuggestions, setRescheduleSuggestions] = useState<
    PlaybookRescheduleSuggestion[]
  >([]);
  const [pendingDraftTask, setPendingDraftTask] = useState<{
    stepId: string;
    task: ActionItem;
    messageAr: string;
  } | null>(null);
  const [convertingStepId, setConvertingStepId] = useState<string | null>(null);

  const [stepNoteInputs, setStepNoteInputs] = useState<Record<string, string>>({});
  const [editingDueStepId, setEditingDueStepId] = useState<string | null>(null);
  const [dueDateInput, setDueDateInput] = useState<string>('');
  const [linkingTaskStepId, setLinkingTaskStepId] = useState<string | null>(null);
  const [linkingCommStepId, setLinkingCommStepId] = useState<string | null>(null);

  const [showCompleteRunConfirm, setShowCompleteRunConfirm] = useState(false);
  const [showCancelRunConfirm, setShowCancelRunConfirm] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState('');

  const client = useMemo(
    () => clients.find((c) => c.id === run.clientId),
    [clients, run.clientId]
  );
  const opportunity = useMemo(
    () => (run.opportunityId ? opportunities.find((o) => o.id === run.opportunityId) : undefined),
    [opportunities, run.opportunityId]
  );

  const progress = useMemo(() => computePlaybookRunProgress(run), [run]);
  const pointers = useMemo(() => getPlaybookRunStepPointers(run), [run]);
  const orderedSteps = useMemo(
    () => [...run.steps].sort((a, b) => a.order - b.order),
    [run.steps]
  );

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const interactionsById = useMemo(
    () => new Map(interactions.map((i) => [i.id, i])),
    [interactions]
  );

  const clientInteractions = useMemo(
    () =>
      interactions
        .filter((i) => i.clientId === run.clientId)
        .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '')),
    [interactions, run.clientId]
  );

  const runStatusMeta = PLAYBOOK_RUN_STATUS_META[run.status];

  const handleStartStep = (stepId: string) => {
    setActionErrorAr(null);
    setActionNoticeAr(null);
    const res = startPlaybookStep({ run, stepId, currentUserId });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر بدء الخطوة.');
      return;
    }
    onSaveRun(res.run);
  };

  const handleCompleteStep = (step: PlaybookRunStep) => {
    setActionErrorAr(null);
    setActionNoticeAr(null);
    const noteText = stepNoteInputs[step.id];
    const method = step.linkedTaskId
      ? 'linked_task'
      : step.linkedInteractionId
      ? 'linked_communication'
      : 'manual';

    const res = completePlaybookStep({
      run,
      stepId: step.id,
      completionMethod: method,
      note: noteText,
      tasks,
      currentUserId,
    });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر إكمال الخطوة.');
      return;
    }
    onSaveRun(res.run);
    if (res.rescheduleSuggestions.length > 0) {
      setRescheduleSuggestions(res.rescheduleSuggestions);
    }
  };

  const handleSkipStep = (stepId: string) => {
    setActionErrorAr(null);
    setActionNoticeAr(null);
    const res = skipPlaybookStep({
      run,
      stepId,
      note: stepNoteInputs[stepId],
      currentUserId,
    });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر تخطي الخطوة.');
      return;
    }
    onSaveRun(res.run);
  };

  const handleReopenStep = (stepId: string) => {
    setActionErrorAr(null);
    setActionNoticeAr(null);
    const res = reopenPlaybookStep({ run, stepId, currentUserId });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر إعادة فتح الخطوة.');
      return;
    }
    onSaveRun(res.run);
  };

  const handleSaveStepDueDate = (stepId: string) => {
    setActionErrorAr(null);
    const res = updatePlaybookStepDueDate({
      run,
      stepId,
      dueDate: dueDateInput || undefined,
      currentUserId,
    });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر تحديث الموعد.');
      return;
    }
    onSaveRun(res.run);
    setEditingDueStepId(null);
  };

  const handleAtomicConvertStep = async (stepId: string) => {
    setActionErrorAr(null);
    setActionNoticeAr(null);
    setConvertingStepId(stepId);
    try {
      const outcome = await onAtomicConvertStepToTask(run, stepId);
      if (!outcome.ok) {
        setActionErrorAr(outcome.errorAr || 'تعذر إنشاء المهمة من الخطوة.');
        if (outcome.draftTask) {
          setPendingDraftTask({
            stepId,
            task: outcome.draftTask,
            messageAr: outcome.errorAr || 'تم حفظ المسودة في الجلسة.',
          });
        }
        return;
      }
      setPendingDraftTask(null);
      setActionNoticeAr(
        outcome.alreadyExisted
          ? 'تم الربط بالمهمة القائمة مسبقًا دون الكتابة فوق تعديلاتك.'
          : 'تم إنشاء المهمة وربطها بهذه الخطوة ذريًا بنجاح.'
      );
    } finally {
      setConvertingStepId(null);
    }
  };

  const handleLinkExistingTask = (stepId: string, task: ActionItem) => {
    setActionErrorAr(null);
    const res = linkExistingTaskToPlaybookStep({
      run,
      stepId,
      task,
      allRuns,
      currentUserId,
    });
    if (!res.ok || !res.run || !res.updatedTask) {
      setActionErrorAr(res.errorAr || 'تعذر ربط المهمة.');
      return;
    }
    onSaveTask(res.updatedTask);
    onSaveRun(res.run);
    setLinkingTaskStepId(null);
    setActionNoticeAr(`تم ربط المهمة «${task.title}» بالخطوة مع الحفاظ على كافة حقولها.`);
  };

  const handleLinkExistingComm = (stepId: string, interaction: CommunicationInteraction) => {
    setActionErrorAr(null);
    const res = linkCommunicationToPlaybookStep({
      run,
      stepId,
      interaction,
      currentUserId,
    });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر ربط سجل التواصل.');
      return;
    }
    onSaveRun(res.run);
    setLinkingCommStepId(null);
    if (res.outcomeNoticeAr) {
      setActionNoticeAr(res.outcomeNoticeAr);
    }
  };

  const handlePauseRun = () => {
    setActionErrorAr(null);
    const res = pausePlaybookRun({ run, currentUserId });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر إيقاف الخطة مؤقتًا.');
      return;
    }
    onSaveRun(res.run);
    setActionNoticeAr('تم إيقاف الخطة مؤقتًا وإيقاف تذكيراتها حتى تقوم باستئنافها.');
  };

  const handleResumeRun = () => {
    setActionErrorAr(null);
    const res = resumePlaybookRun({ run, currentUserId });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر استئناف الخطة.');
      return;
    }
    onSaveRun(res.run);
    setActionNoticeAr('تم استئناف الخطة مع الحفاظ على جميع مواعيدها الأصلية دون إعادة جدولة تلقائية.');
  };

  const handleConfirmCompleteRun = () => {
    setActionErrorAr(null);
    const res = completePlaybookRun({ run, confirmed: true, currentUserId });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر إنهاء الخطة.');
      return;
    }
    onSaveRun(res.run);
    setShowCompleteRunConfirm(false);
  };

  const handleConfirmCancelRun = () => {
    setActionErrorAr(null);
    const res = cancelPlaybookRun({
      run,
      confirmed: true,
      cancelReason: cancelReasonInput,
      currentUserId,
    });
    if (!res.ok || !res.run) {
      setActionErrorAr(res.errorAr || 'تعذر إلغاء الخطة.');
      return;
    }
    onSaveRun(res.run);
    setShowCancelRunConfirm(false);
    setCancelReasonInput('');
  };

  return (
    <div className="space-y-4 pb-8" data-testid="playbook-run-workspace">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          data-testid="back-from-playbook-run-btn"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-semibold transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة إلى خطط المتابعة</span>
        </button>

        {run.revision && (
          <span className="text-[11px] text-stone-500 font-medium">
            إصدار التزامن: #{run.revision}
          </span>
        )}
      </div>

      {/* Header & Lifecycle Controls Card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center flex-wrap gap-2">
              <span
                data-testid="playbook-run-status-badge"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${runStatusMeta.badgeClass}`}
              >
                <span>{runStatusMeta.labelAr}</span>
              </span>
              {run.startDateKey && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 text-stone-700 text-[11px] font-semibold">
                  <Calendar className="w-3.5 h-3.5 text-stone-500" />
                  <span>تاريخ البدء: {run.startDateKey}</span>
                </span>
              )}
            </div>

            <h1 className="font-heading text-lg sm:text-xl font-bold text-stone-900">
              {run.templateName}
            </h1>

            {/* Client & Opportunity Links (Deleted-client safe fallback!) */}
            <div className="flex items-center flex-wrap gap-2 text-xs">
              {client ? (
                <button
                  type="button"
                  data-testid="playbook-run-client-link"
                  onClick={() => onSelectClient(client)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-emerald-50 text-stone-800 hover:text-emerald-900 font-bold transition-colors"
                >
                  <Building2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>{client.name}</span>
                  {client.company && (
                    <span className="text-stone-500 font-normal">({client.company})</span>
                  )}
                </button>
              ) : (
                <span
                  data-testid="playbook-run-missing-client-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-[11px] font-semibold"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>عميل محذوف أو غير متاح ({run.clientId})</span>
                </span>
              )}

              {run.opportunityId &&
                (opportunity ? (
                  <button
                    type="button"
                    onClick={() => onSelectOpportunity(opportunity)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-900 text-[11px] font-semibold transition-colors"
                  >
                    <Briefcase className="w-3.5 h-3.5 text-indigo-700" />
                    <span>الفرصة: {opportunity.title}</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600 text-[11px]">
                    <Briefcase className="w-3.5 h-3.5 text-stone-400" />
                    <span>فرصة مرتبطة غير متاحة ({run.opportunityId})</span>
                  </span>
                ))}
            </div>
          </div>

          {/* Lifecycle Buttons */}
          <div className="flex items-center flex-wrap gap-2 shrink-0 text-xs">
            {run.status === 'active' && (
              <>
                <button
                  type="button"
                  data-testid="pause-playbook-run-btn"
                  onClick={handlePauseRun}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 font-semibold transition-colors"
                >
                  <PauseCircle className="w-4 h-4 text-amber-700" />
                  <span>إيقاف مؤقت</span>
                </button>
                <button
                  type="button"
                  data-testid="open-complete-playbook-run-btn"
                  onClick={() => {
                    setShowCompleteRunConfirm(true);
                    setShowCancelRunConfirm(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>إنهاء الخطة</span>
                </button>
                <button
                  type="button"
                  data-testid="open-cancel-playbook-run-btn"
                  onClick={() => {
                    setShowCancelRunConfirm(true);
                    setShowCompleteRunConfirm(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  <span>إلغاء الخطة</span>
                </button>
              </>
            )}

            {run.status === 'paused' && (
              <>
                <button
                  type="button"
                  data-testid="resume-playbook-run-btn"
                  onClick={handleResumeRun}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold transition-colors"
                >
                  <PlayCircle className="w-4 h-4" />
                  <span>استئناف الخطة</span>
                </button>
                <button
                  type="button"
                  data-testid="open-cancel-playbook-run-btn"
                  onClick={() => setShowCancelRunConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  <span>إلغاء الخطة</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Confirm Complete Run Dialog */}
        {showCompleteRunConfirm && (
          <div
            data-testid="complete-playbook-run-confirm"
            className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs space-y-2.5"
          >
            <p className="font-bold">تأكيد إنهاء خطة المتابعة</p>
            <p className="text-[11px] text-emerald-900 leading-relaxed">
              سيتم توثيق الخطة كمكتملة، وتبقى جميع المهام والتفاعلات المرتبطة محفوظة كما هي دون حذف.
              {progress.actionableRemainingCount > 0 &&
                ` (ملاحظة: لا تزال هناك ${progress.actionableRemainingCount} خطوة غير منجزة).`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCompleteRunConfirm(false)}
                className="px-3 py-1.5 rounded-xl border border-stone-300 bg-white text-stone-700 font-semibold"
              >
                تراجع
              </button>
              <button
                type="button"
                data-testid="confirm-complete-playbook-run-btn"
                onClick={handleConfirmCompleteRun}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold"
              >
                تأكيد إنهاء الخطة
              </button>
            </div>
          </div>
        )}

        {/* Confirm Cancel Run Dialog */}
        {showCancelRunConfirm && (
          <div
            data-testid="cancel-playbook-run-confirm"
            className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 text-xs space-y-2.5"
          >
            <p className="font-bold">تأكيد إلغاء خطة المتابعة</p>
            <p className="text-[11px] text-rose-900 leading-relaxed">
              عند الإلغاء تتوقف تذكيرات الخطة، ولن تُحذف أي مهام أو سجلات تواصل مرتبطة بها.
            </p>
            <input
              type="text"
              data-testid="cancel-playbook-reason-input"
              value={cancelReasonInput}
              onChange={(e) => setCancelReasonInput(e.target.value)}
              maxLength={500}
              placeholder="سبب الإلغاء (اختياري)"
              className="w-full px-3 py-1.5 rounded-xl border border-rose-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelRunConfirm(false)}
                className="px-3 py-1.5 rounded-xl border border-stone-300 bg-white text-stone-700 font-semibold"
              >
                تراجع
              </button>
              <button
                type="button"
                data-testid="confirm-cancel-playbook-run-btn"
                onClick={handleConfirmCancelRun}
                className="px-3.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold"
              >
                تأكيد إلغاء الخطة
              </button>
            </div>
          </div>
        )}

        {/* Honest Progress & Pointers Summary */}
        <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <span>التقدم الفعلي:</span>
              <span data-testid="playbook-run-progress-percent" className="text-emerald-900 tabular-nums">
                {progress.completionPercent}%
              </span>
              <span className="text-stone-500 font-medium">
                ({progress.completedStepsCount} من {progress.totalStepsCount} خطوات مكتملة)
              </span>
            </div>

            {progress.skippedStepsCount > 0 && (
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg font-medium">
                تم تجاوز {progress.skippedStepsCount} خطوة (لا تُحتسب ضمن نسبة الإنجاز)
              </span>
            )}
          </div>

          <div className="w-full h-2.5 rounded-full bg-stone-200 overflow-hidden">
            <div
              className="h-full bg-emerald-700 transition-all duration-300"
              style={{ width: `${progress.completionPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
            <div className="bg-white rounded-xl border border-stone-200 p-2.5">
              <span className="text-stone-500 block mb-0.5">الخطوة الحالية</span>
              <span className="font-bold text-stone-900">
                {pointers.currentStep
                  ? `${pointers.currentStep.order}. ${pointers.currentStep.title}`
                  : 'لا توجد خطوات مفتوحة حاليًا'}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-2.5">
              <span className="text-stone-500 block mb-0.5">الخطوة التالية</span>
              <span className="font-bold text-stone-900">
                {pointers.nextStep
                  ? `${pointers.nextStep.order}. ${pointers.nextStep.title}`
                  : '—'}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-2.5">
              <span className="text-stone-500 block mb-0.5">أقرب متابعة قادمة</span>
              <span className="font-bold text-emerald-900">
                {pointers.nextFollowUpDate || 'بانتظار تحديد الموعد أو إكمال السابق'}
              </span>
            </div>
          </div>
        </div>

        {/* Ready-to-finish banner (explicit confirmation required) */}
        {progress.isReadyToFinish && (
          <div
            data-testid="playbook-ready-to-finish-banner"
            className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-950 text-xs flex items-center justify-between gap-2 flex-wrap"
          >
            <span className="font-semibold">
              اكتملت أو تخطّيت جميع خطوات هذه الخطة. يمكنك إنهاء الخطة يدويًا لتوثيقها كمكتملة.
            </span>
            <button
              type="button"
              onClick={() => setShowCompleteRunConfirm(true)}
              className="px-3 py-1.5 rounded-xl bg-teal-800 hover:bg-teal-900 text-white font-bold"
            >
              إنهاء الخطة الآن
            </button>
          </div>
        )}

        {/* Cancelled / Paused disclosures */}
        {run.status === 'paused' && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              هذه الخطة متوقفة مؤقتًا منذ {formatArabicDate(run.pausedAt || run.updatedAt)}. عند استئنافها تُحفظ مواعيد الخطوات والمهام كما هي دون إعادة جدولة تلقائية.
            </span>
          </div>
        )}

        {run.status === 'cancelled' && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex items-start gap-2">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">
                تم إلغاء هذه الخطة ({formatArabicDate(run.cancelledAt || run.updatedAt)})
              </span>
              {run.cancelReason && (
                <span className="text-[11px]">السبب: {run.cancelReason}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Feedback & Preserved Draft / Reschedule Banners */}
      {actionErrorAr && (
        <div
          data-testid="playbook-workspace-error"
          className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{actionErrorAr}</span>
        </div>
      )}

      {actionNoticeAr && (
        <div
          data-testid="playbook-workspace-notice"
          className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-start gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <span>{actionNoticeAr}</span>
        </div>
      )}

      {pendingDraftTask && (
        <div
          data-testid="playbook-pending-draft-task-banner"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-bold">
              مسودة مهمة محفوظة في الجلسة (لم تُرسل للسحابة بعد): «{pendingDraftTask.task.title}»
            </span>
            <button
              type="button"
              onClick={() => void handleAtomicConvertStep(pendingDraftTask.stepId)}
              disabled={!isOnline}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 text-white font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة محاولة التحويل الذري</span>
            </button>
          </div>
          <p className="text-[11px] text-amber-900">{pendingDraftTask.messageAr}</p>
        </div>
      )}

      {rescheduleSuggestions.map((sug) => (
        <div
          key={`${sug.stepId}-${sug.linkedTaskId}`}
          data-testid={`reschedule-suggestion-${sug.stepId}`}
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-2.5"
        >
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">اقتراح تحديث موعد المهمة المرتبطة بالخطوة التالية</p>
              <p className="text-[11px] leading-relaxed">{sug.reasonAr}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                onApproveRescheduleSuggestion(sug, false);
                setRescheduleSuggestions((prev) =>
                  prev.filter((item) => item.stepId !== sug.stepId)
                );
              }}
              className="px-3 py-1.5 rounded-xl border border-amber-300 bg-white hover:bg-amber-100 text-amber-950 font-semibold"
            >
              تحديث موعد الخطوة فقط وإبقاء المهمة ({sug.currentTaskDueDate})
            </button>
            <button
              type="button"
              data-testid={`approve-reschedule-btn-${sug.stepId}`}
              onClick={() => {
                onApproveRescheduleSuggestion(sug, true);
                setRescheduleSuggestions((prev) =>
                  prev.filter((item) => item.stepId !== sug.stepId)
                );
              }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold"
            >
              اعتماد الموعد الجديد ({sug.suggestedDueDate}) للمهمة والخطوة
            </button>
          </div>
        </div>
      ))}

      {/* Sequential Steps Timeline */}
      <div className="space-y-3">
        {orderedSteps.map((step) => {
          const stepTypeMeta = PLAYBOOK_STEP_TYPE_META[step.stepType];
          const stepStatusMeta = PLAYBOOK_STEP_STATUS_META[step.status];
          const isCurrent = pointers.currentStep?.id === step.id;
          const linkedTask = step.linkedTaskId ? tasksById.get(step.linkedTaskId) : undefined;
          const linkedInteraction = step.linkedInteractionId
            ? interactionsById.get(step.linkedInteractionId)
            : undefined;

          const linkableTasks = tasks.filter(
            (t) =>
              canLinkExistingTaskToPlaybookStep({
                task: t,
                run,
                stepId: step.id,
                allRuns,
                currentUserId,
              }).ok
          );

          return (
            <div
              key={step.id}
              data-testid={`playbook-step-card-${step.id}`}
              className={`bg-white rounded-2xl border p-4 shadow-2xs space-y-3 transition-all ${
                isCurrent && run.status === 'active'
                  ? 'border-emerald-400 ring-1 ring-emerald-200'
                  : 'border-stone-200'
              }`}
            >
              {/* Step Header */}
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`w-7 h-7 rounded-xl text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                      step.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-900'
                        : isCurrent && run.status === 'active'
                        ? 'bg-emerald-900 text-white'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {step.order}
                  </span>
                  <div className="space-y-1">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <h3 className="font-bold text-sm text-stone-900">{step.title}</h3>
                      {isCurrent && run.status === 'active' && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-900 text-white text-[10px] font-bold">
                          الخطوة الحالية
                        </span>
                      )}
                    </div>
                    {step.description && (
                      <p className="text-xs text-stone-600 leading-relaxed">
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${stepTypeMeta.badgeClass}`}
                  >
                    {stepTypeMeta.labelAr}
                  </span>
                  <span
                    data-testid={`playbook-step-status-${step.id}`}
                    className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${stepStatusMeta.badgeClass}`}
                  >
                    {stepStatusMeta.labelAr}
                  </span>
                </div>
              </div>

              {/* Metadata & Due Date Row */}
              <div className="flex items-center flex-wrap gap-3 text-xs text-stone-600 bg-stone-50 rounded-xl p-2.5 border border-stone-100">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                  {step.dueDate ? (
                    <span className="font-bold text-stone-900">
                      الموعد المستهدف: {step.dueDate}
                    </span>
                  ) : (
                    <span className="text-stone-500">
                      {step.duePolicy.type === 'after_previous_completion'
                        ? STEP_DEPENDENCY_PLACEHOLDER_AR
                        : 'بدون موعد محدد'}
                    </span>
                  )}

                  {(run.status === 'active' || run.status === 'paused') && (
                    <button
                      type="button"
                      data-testid={`edit-step-due-btn-${step.id}`}
                      onClick={() => {
                        setEditingDueStepId(
                          editingDueStepId === step.id ? null : step.id
                        );
                        setDueDateInput(step.dueDate || '');
                      }}
                      className="text-[11px] text-emerald-800 hover:underline font-semibold ms-1"
                    >
                      تعديل الموعد
                    </button>
                  )}
                </div>

                {step.suggestedChannel && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-stone-200 text-stone-700">
                    الوسيلة المقترحة:{' '}
                    {COMMUNICATION_CHANNEL_META[step.suggestedChannel].labelAr}
                  </span>
                )}

                {step.completedAt && (
                  <span className="text-[11px] text-emerald-800 font-medium">
                    أُكملت: {formatArabicDate(step.completedAt)}
                  </span>
                )}
              </div>

              {/* Inline Due Date Editor */}
              {editingDueStepId === step.id && (
                <div className="flex items-center flex-wrap gap-2 p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200 text-xs">
                  <input
                    type="date"
                    value={dueDateInput}
                    onChange={(e) => setDueDateInput(e.target.value)}
                    className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveStepDueDate(step.id)}
                    className="px-3 py-1 rounded-lg bg-emerald-900 text-white font-bold"
                  >
                    حفظ الموعد
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingDueStepId(null)}
                    className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-stone-600"
                  >
                    إلغاء
                  </button>
                </div>
              )}

              {/* Linked Task Card */}
              {step.linkedTaskId && (
                <div
                  data-testid={`step-linked-task-${step.id}`}
                  className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between gap-2 flex-wrap text-xs"
                >
                  {linkedTask ? (
                    <>
                      <div className="flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-amber-800" />
                        <span className="font-bold text-stone-900">
                          المهمة المرتبطة: {linkedTask.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white border border-amber-200 text-[10px] font-semibold">
                          {linkedTask.status === 'completed' ? 'مكتملة' : 'مفتوحة'}
                          {linkedTask.dueDate ? ` • ${linkedTask.dueDate}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenTask(linkedTask)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 font-semibold text-[11px]"
                      >
                        <span>فتح المهمة</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <span className="text-amber-900 text-[11px]">
                      مرتبطة بمعرف مهمة ({step.linkedTaskId}) قد تكون محذوفة.
                    </span>
                  )}
                </div>
              )}

              {/* Linked Communication Card */}
              {step.linkedInteractionId && (
                <div
                  data-testid={`step-linked-comm-${step.id}`}
                  className="p-2.5 rounded-xl bg-sky-50/70 border border-sky-200 flex items-center justify-between gap-2 flex-wrap text-xs"
                >
                  {linkedInteraction ? (
                    <>
                      <div className="flex items-center flex-wrap gap-2">
                        <Phone className="w-4 h-4 text-sky-700" />
                        <span className="font-bold text-stone-900">
                          {COMMUNICATION_CHANNEL_META[linkedInteraction.channel].labelAr}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white border border-sky-200 text-[10px] font-bold text-sky-900">
                          {COMMUNICATION_OUTCOME_META[linkedInteraction.outcome].labelAr}
                        </span>
                        {!isCommunicationOutcomeConfirmedContact(linkedInteraction.outcome) && (
                          <span className="text-[11px] text-amber-900 font-medium">
                            (توثيق محاولة متابعة — لا يُعد تواصلًا ناجحًا تلقائيًا)
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenInteraction(linkedInteraction)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-sky-300 hover:bg-sky-100 text-sky-950 font-semibold text-[11px]"
                      >
                        <span>عرض سجل التواصل</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <span className="text-sky-900 text-[11px]">
                      مرتبطة بسجل تواصل ({step.linkedInteractionId}) غير متاح حاليًا.
                    </span>
                  )}
                </div>
              )}

              {step.note && (
                <p className="text-[11px] text-stone-600 bg-stone-50 rounded-lg px-2.5 py-1.5 border border-stone-200">
                  ملاحظة التنفيذ: {step.note}
                </p>
              )}

              {/* Step Action Controls when Active */}
              {run.status === 'active' && (
                <div className="pt-2 border-t border-stone-100 space-y-2.5 text-xs">
                  {(step.status === 'pending' || step.status === 'in_progress') && (
                    <div className="flex items-center flex-wrap gap-2">
                      {step.status === 'pending' && (
                        <button
                          type="button"
                          data-testid={`start-step-btn-${step.id}`}
                          onClick={() => handleStartStep(step.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-900 font-semibold"
                        >
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>بدء التنفيذ</span>
                        </button>
                      )}

                      <button
                        type="button"
                        data-testid={`complete-step-btn-${step.id}`}
                        onClick={() => handleCompleteStep(step)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>إكمال الخطوة</span>
                      </button>

                      <button
                        type="button"
                        data-testid={`skip-step-btn-${step.id}`}
                        onClick={() => handleSkipStep(step.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                        <span>تخطي</span>
                      </button>

                      {!step.linkedTaskId && (
                        <>
                          <button
                            type="button"
                            data-testid={`atomic-convert-step-btn-${step.id}`}
                            disabled={convertingStepId === step.id}
                            onClick={() => void handleAtomicConvertStep(step.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-emerald-900 disabled:opacity-50 text-white font-semibold"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            <span>
                              {convertingStepId === step.id
                                ? 'جارٍ الإنشاء الذري...'
                                : 'إنشاء مهمة من الخطوة'}
                            </span>
                          </button>

                          {linkableTasks.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLinkingTaskStepId(
                                  linkingTaskStepId === step.id ? null : step.id
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-medium"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>ربط مهمة قائمة</span>
                            </button>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        data-testid={`log-comm-for-step-btn-${step.id}`}
                        onClick={() =>
                          onLogCommunicationForStep({
                            run,
                            step,
                            suggestedChannel: step.suggestedChannel,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-semibold"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>تسجيل تواصل</span>
                      </button>

                      {clientInteractions.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLinkingCommStepId(
                              linkingCommStepId === step.id ? null : step.id
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-medium"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>ربط تواصل قائم</span>
                        </button>
                      )}
                    </div>
                  )}

                  {(step.status === 'pending' || step.status === 'in_progress') && (
                    <input
                      type="text"
                      value={stepNoteInputs[step.id] ?? step.note ?? ''}
                      onChange={(e) =>
                        setStepNoteInputs((prev) => ({
                          ...prev,
                          [step.id]: e.target.value,
                        }))
                      }
                      maxLength={1000}
                      placeholder="ملاحظة اختيارية تُحفظ عند إكمال الخطوة أو تخطيها..."
                      className="w-full px-3 py-1.5 rounded-xl border border-stone-200 bg-stone-50/60 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700 text-[11px]"
                    />
                  )}

                  {(step.status === 'completed' || step.status === 'skipped') && (
                    <button
                      type="button"
                      data-testid={`reopen-step-btn-${step.id}`}
                      onClick={() => handleReopenStep(step.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إعادة فتح الخطوة</span>
                    </button>
                  )}

                  {/* Link Existing Task Picker */}
                  {linkingTaskStepId === step.id && (
                    <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                      <p className="text-[11px] font-bold text-stone-700">
                        اختر مهمة قائمة لنفس العميل لربطها (تبقى حقولها كما هي):
                      </p>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {linkableTasks.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleLinkExistingTask(step.id, t)}
                            className="w-full text-start px-2.5 py-1.5 rounded-lg bg-white hover:bg-emerald-50 border border-stone-200 text-xs flex items-center justify-between"
                          >
                            <span className="font-medium text-stone-900">{t.title}</span>
                            <span className="text-[11px] text-stone-500">
                              {t.dueDate || 'بدون موعد'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Link Existing Interaction Picker */}
                  {linkingCommStepId === step.id && (
                    <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                      <p className="text-[11px] font-bold text-stone-700">
                        اختر سجل تواصل مسجل لهذا العميل لربطه بالخطوة:
                      </p>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {clientInteractions.map((inter) => (
                          <button
                            key={inter.id}
                            type="button"
                            onClick={() => handleLinkExistingComm(step.id, inter)}
                            className="w-full text-start px-2.5 py-1.5 rounded-lg bg-white hover:bg-sky-50 border border-stone-200 text-xs flex items-center justify-between gap-2"
                          >
                            <span className="font-medium text-stone-900 truncate">
                              {COMMUNICATION_CHANNEL_META[inter.channel].shortLabelAr} —{' '}
                              {inter.subject || (inter.summary || '').slice(0, 50) || 'سجل تواصل'}
                            </span>
                            <span className="text-[11px] text-stone-500 shrink-0">
                              {COMMUNICATION_OUTCOME_META[inter.outcome].labelAr}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
