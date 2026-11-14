import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionItem,
  AiReviewItemState,
  AiSectionInclusionKey,
  AiSectionInclusionSelection,
  AiSuggestedActionItem,
  AiSuggestedDecision,
  Meeting,
  MeetingAgendaItem,
  MeetingAiAnalysisResult,
  TaskPriority,
} from '../types';
import {
  AI_SECTION_LABELS,
  DEFAULT_AI_SECTION_SELECTION,
  MAX_AI_TOTAL_INPUT_CHARS,
  applyAiFollowUpDateToMeeting,
  applyAiSummaryToMeeting,
  approveAiDecisionIntoMeeting,
  approveAiSuggestedTask,
  approveSuggestedTasksSequentially,
  buildMeetingAiInputBundle,
  buildStructuredMeetingSummaryText,
  isValidIsoDateOnly,
} from '../utils/meetingAiAssistant';
import { findDuplicateMeetingTask, isMinutesLocked } from '../utils/meetingMinutes';
import { requestMeetingAiSuggestions } from '../services/meetingAi';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Edit3,
  Eye,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
  WifiOff,
  X,
} from 'lucide-react';

export interface MeetingAiAssistantProps {
  meeting: Meeting;
  clientName?: string;
  tasks: ActionItem[];
  agendaItems: MeetingAgendaItem[];
  isOnline: boolean;
  onPersistMeetingUpdate: (nextMeeting: Meeting, noticeMsg: string) => Promise<void> | void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onRequestReopenMinutes: () => void;
  openConsentTrigger?: number;
  requestAnalysisFn?: typeof requestMeetingAiSuggestions;
}

interface DecisionDraftState {
  text: string;
  ownerName: string;
  agendaItemId: string;
}

interface TaskDraftState {
  title: string;
  description: string;
  ownerName: string;
  dueDate: string;
  priority: TaskPriority;
}

export const MeetingAiAssistant: React.FC<MeetingAiAssistantProps> = ({
  meeting,
  clientName,
  tasks,
  agendaItems,
  isOnline,
  onPersistMeetingUpdate,
  onSaveTask,
  onRequestReopenMinutes,
  openConsentTrigger = 0,
  requestAnalysisFn = requestMeetingAiSuggestions,
}) => {
  const minutesLocked = isMinutesLocked(meeting);

  // Consent & preview modal state
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [includedSections, setIncludedSections] = useState<AiSectionInclusionSelection>({
    ...DEFAULT_AI_SECTION_SELECTION,
  });

  // In-flight request + abort controller
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Session-only analysis result (NEVER persisted automatically to Firestore/IndexedDB)
  const [analysis, setAnalysis] = useState<MeetingAiAnalysisResult | null>(null);

  // Per-item review states & inline edit drafts
  const [summaryState, setSummaryState] = useState<AiReviewItemState>('pending');
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraftText, setSummaryDraftText] = useState('');

  const [decisionStates, setDecisionStates] = useState<Record<string, AiReviewItemState>>({});
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraftState>>({});

  const [taskStates, setTaskStates] = useState<Record<string, AiReviewItemState>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<Record<string, boolean>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraftState>>({});
  const [isBatchApprovingTasks, setIsBatchApprovingTasks] = useState(false);
  const [batchTaskNotice, setBatchTaskNotice] = useState<string | null>(null);

  const [dismissedOpenIds, setDismissedOpenIds] = useState<Record<string, boolean>>({});
  const [followUpStates, setFollowUpStates] = useState<Record<string, AiReviewItemState>>({});
  const [followUpDateDrafts, setFollowUpDateDrafts] = useState<Record<string, string>>({});
  const [followUpErrors, setFollowUpErrors] = useState<Record<string, string>>({});

  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Reset transient AI session state when switching meetings
  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsConsentOpen(false);
    setIsAnalyzing(false);
    setAnalysisError(null);
    setAnalysis(null);
    setSummaryState('pending');
    setIsEditingSummary(false);
    setSummaryDraftText('');
    setDecisionStates({});
    setDecisionErrors({});
    setEditingDecisionId(null);
    setDecisionDrafts({});
    setTaskStates({});
    setTaskErrors({});
    setSelectedTaskIds({});
    setEditingTaskId(null);
    setTaskDrafts({});
    setDismissedOpenIds({});
    setFollowUpStates({});
    setFollowUpDateDrafts({});
    setFollowUpErrors({});
    setBatchTaskNotice(null);
    setActionBanner(null);
  }, [meeting.id]);

  // Allow parent header button to open consent modal cleanly
  useEffect(() => {
    if (openConsentTrigger > 0) {
      setAnalysisError(null);
      setIsConsentOpen(true);
    }
  }, [openConsentTrigger]);

  const inputBundle = useMemo(
    () =>
      buildMeetingAiInputBundle({
        meeting,
        tasks,
        clientName,
        includedSections,
      }),
    [meeting, tasks, clientName, includedSections]
  );

  const hydrateDraftsFromResult = (res: MeetingAiAnalysisResult) => {
    setSummaryState('pending');
    setIsEditingSummary(false);
    setSummaryDraftText(buildStructuredMeetingSummaryText(res.summary));

    const decDrafts: Record<string, DecisionDraftState> = {};
    const decStates: Record<string, AiReviewItemState> = {};
    res.decisions.forEach((d) => {
      decStates[d.id] = 'pending';
      decDrafts[d.id] = {
        text: d.text,
        ownerName: d.ownerName || '',
        agendaItemId: d.agendaItemId || '',
      };
    });
    setDecisionStates(decStates);
    setDecisionDrafts(decDrafts);
    setDecisionErrors({});
    setEditingDecisionId(null);

    const tDrafts: Record<string, TaskDraftState> = {};
    const tStates: Record<string, AiReviewItemState> = {};
    const tSelected: Record<string, boolean> = {};
    res.actionItems.forEach((t) => {
      tStates[t.id] = 'pending';
      tSelected[t.id] = true;
      tDrafts[t.id] = {
        title: t.title,
        description: t.description || '',
        ownerName: t.ownerName || '',
        dueDate: t.dueDate || '',
        priority: t.priority,
      };
    });
    setTaskStates(tStates);
    setTaskDrafts(tDrafts);
    setSelectedTaskIds(tSelected);
    setTaskErrors({});
    setEditingTaskId(null);
    setBatchTaskNotice(null);

    setDismissedOpenIds({});
    const fStates: Record<string, AiReviewItemState> = {};
    const fDates: Record<string, string> = {};
    res.followUpSuggestions.forEach((f) => {
      fStates[f.id] = 'pending';
      fDates[f.id] = f.suggestedDate || '';
    });
    setFollowUpStates(fStates);
    setFollowUpDateDrafts(fDates);
    setFollowUpErrors({});
    setActionBanner(null);
  };

  const handleToggleSection = (key: AiSectionInclusionKey) => {
    setIncludedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleStartAnalysis = async () => {
    if (!isOnline || !inputBundle.hasSubstantiveContent || inputBundle.exceedsLimit || isAnalyzing) {
      return;
    }

    setIsConsentOpen(false);
    setAnalysisError(null);
    setActionBanner(null);
    setIsAnalyzing(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await requestAnalysisFn({
        meeting,
        tasks,
        clientName,
        includedSections,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setAnalysis(result);
      hydrateDraftsFromResult(result);
    } catch (err: any) {
      if (err?.code === 'AI_ABORTED' || controller.signal.aborted) {
        setAnalysisError('تم إلغاء تحليل الاجتماع بناءً على طلبك. لم يتم إرسال أو تعديل أي بيانات.');
      } else {
        setAnalysisError(
          err?.message || 'تعذر إتمام تحليل الاجتماع عبر Google Gemini. يمكنك المحاولة مجدداً.'
        );
      }
    } finally {
      setIsAnalyzing(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
  };

  const handleApplySummary = async (mode: 'append' | 'replace') => {
    const res = applyAiSummaryToMeeting(meeting, summaryDraftText, mode);
    if (!res.ok) {
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      return;
    }
    await onPersistMeetingUpdate(
      res.meeting,
      mode === 'replace'
        ? 'تم اعتماد الملخص واستبدال ملخص المناقشات.'
        : 'تمت إضافة الملخص المعتمد إلى قسم المناقشات.'
    );
    setSummaryState('approved');
    setIsEditingSummary(false);
    setActionBanner({
      type: 'success',
      text: 'تم اعتماد الملخص وحفظه في ملخص المناقشات دون المساس بالملاحظات النصية السابقة.',
    });
  };

  const handleApproveDecision = async (dec: AiSuggestedDecision) => {
    const draft = decisionDrafts[dec.id] || {
      text: dec.text,
      ownerName: dec.ownerName || '',
      agendaItemId: dec.agendaItemId || '',
    };
    const res = approveAiDecisionIntoMeeting(meeting, {
      text: draft.text,
      ownerName: draft.ownerName || undefined,
      agendaItemId: draft.agendaItemId || undefined,
    });

    if (!res.ok) {
      setDecisionErrors((prev) => ({ ...prev, [dec.id]: res.reasonArabic }));
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      return;
    }

    await onPersistMeetingUpdate(res.meeting, 'تم اعتماد القرار وإضافته إلى المحضر.');
    setDecisionStates((prev) => ({ ...prev, [dec.id]: 'approved' }));
    setDecisionErrors((prev) => {
      const copy = { ...prev };
      delete copy[dec.id];
      return copy;
    });
    setEditingDecisionId((curr) => (curr === dec.id ? null : curr));
  };

  const buildCandidateFromDraft = (item: AiSuggestedActionItem) => {
    const draft = taskDrafts[item.id] || {
      title: item.title,
      description: item.description || '',
      ownerName: item.ownerName || '',
      dueDate: item.dueDate || '',
      priority: item.priority,
    };
    return {
      id: item.id,
      title: draft.title,
      description: draft.description,
      ownerName: draft.ownerName,
      dueDate: draft.dueDate,
      priority: draft.priority,
    };
  };

  const handleApproveSingleTask = async (item: AiSuggestedActionItem) => {
    if (taskStates[item.id] === 'approved') return;

    const candidate = buildCandidateFromDraft(item);
    const res = await approveAiSuggestedTask({
      candidate,
      meeting,
      existingTasks: tasks,
      saveTaskFn: onSaveTask,
    });

    if (res.ok) {
      setTaskStates((prev) => ({ ...prev, [item.id]: 'approved' }));
      setTaskErrors((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });
      setEditingTaskId((curr) => (curr === item.id ? null : curr));
      setActionBanner({
        type: 'success',
        text: `تم إنشاء المهمة «${res.task.title}» وربطها باللقاء والعميل.`,
      });
    } else {
      setTaskStates((prev) => ({ ...prev, [item.id]: 'save_failed' }));
      setTaskErrors((prev) => ({ ...prev, [item.id]: res.reasonArabic }));
    }
  };

  const handleBatchApproveSelectedTasks = async () => {
    if (!analysis || isBatchApprovingTasks) return;

    const alreadyApproved = new Set(
      Object.entries(taskStates)
        .filter(([, st]) => st === 'approved')
        .map(([id]) => id)
    );

    const targets = analysis.actionItems
      .filter((item) => {
        const state = taskStates[item.id];
        if (state === 'approved' || state === 'ignored') return false;
        return Boolean(selectedTaskIds[item.id]);
      })
      .map(buildCandidateFromDraft);

    if (targets.length === 0) {
      setBatchTaskNotice('لا توجد مهام محددة بانتظار الاعتماد.');
      return;
    }

    setIsBatchApprovingTasks(true);
    setBatchTaskNotice(null);

    try {
      const outcome = await approveSuggestedTasksSequentially({
        candidates: targets,
        meeting,
        initialExistingTasks: tasks,
        alreadyApprovedIds: alreadyApproved,
        saveTaskFn: onSaveTask,
      });

      setTaskStates((prev) => {
        const next = { ...prev };
        outcome.succeededIds.forEach((id) => {
          next[id] = 'approved';
        });
        outcome.failedItems.forEach((f) => {
          next[f.id] = 'save_failed';
        });
        return next;
      });

      setTaskErrors((prev) => {
        const next = { ...prev };
        outcome.succeededIds.forEach((id) => {
          delete next[id];
        });
        outcome.failedItems.forEach((f) => {
          next[f.id] = f.reasonArabic;
        });
        outcome.skippedDuplicateIds.forEach((id) => {
          next[id] = 'تم تجاوز هذه المهمة لأنها مطابقة لمهمة موجودة مسبقاً في هذا اللقاء.';
        });
        return next;
      });

      const summaryParts: string[] = [];
      if (outcome.succeededIds.length > 0) {
        summaryParts.push(`تم إنشاء ${outcome.succeededIds.length} مهمة بنجاح`);
      }
      if (outcome.skippedDuplicateIds.length > 0) {
        summaryParts.push(`تم منع تكرار ${outcome.skippedDuplicateIds.length} مهمة موجودة`);
      }
      if (outcome.failedItems.length > 0) {
        summaryParts.push(
          `تعذر حفظ ${outcome.failedItems.length} مهمة — يمكنك إعادة محاولة الفاشلة فقط دون تكرار الناجحة`
        );
      }
      setBatchTaskNotice(summaryParts.join(' · '));
    } finally {
      setIsBatchApprovingTasks(false);
    }
  };

  const handleApplyFollowUpDate = async (suggestionId: string) => {
    const rawDate = followUpDateDrafts[suggestionId] || '';
    const res = applyAiFollowUpDateToMeeting(meeting, rawDate);
    if (!res.ok) {
      setFollowUpErrors((prev) => ({ ...prev, [suggestionId]: res.reasonArabic }));
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      return;
    }
    await onPersistMeetingUpdate(res.meeting, 'تم اعتماد موعد المتابعة القادم في المحضر.');
    setFollowUpStates((prev) => ({ ...prev, [suggestionId]: 'approved' }));
    setFollowUpErrors((prev) => {
      const copy = { ...prev };
      delete copy[suggestionId];
      return copy;
    });
  };

  const handleCreateTaskFromFollowUp = async (suggestionId: string, actionText: string) => {
    const suggestedDate = followUpDateDrafts[suggestionId] || '';
    const res = await approveAiSuggestedTask({
      candidate: {
        id: suggestionId,
        title: actionText,
        dueDate: isValidIsoDateOnly(suggestedDate) ? suggestedDate : undefined,
        priority: 'medium',
      },
      meeting,
      existingTasks: tasks,
      saveTaskFn: onSaveTask,
    });
    if (res.ok) {
      setFollowUpStates((prev) => ({ ...prev, [suggestionId]: 'approved' }));
      setActionBanner({
        type: 'success',
        text: `تم إنشاء مهمة المتابعة «${res.task.title}» وربطها باللقاء.`,
      });
    } else {
      setFollowUpErrors((prev) => ({ ...prev, [suggestionId]: res.reasonArabic }));
    }
  };

  const pendingTaskCount = analysis
    ? analysis.actionItems.filter((t) => {
        const st = taskStates[t.id];
        return st !== 'approved' && st !== 'ignored';
      }).length
    : 0;

  return (
    <section
      data-testid="section-meeting-ai-assistant"
      className="border border-stone-200 rounded-2xl p-4 bg-white space-y-4"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
        <div className="space-y-0.5">
          <h4 className="font-heading font-bold text-sm text-stone-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-700" />
            <span>المساعد الذكي للاجتماع</span>
          </h4>
          <p className="text-[11px] text-stone-600">
            تحليل اختياري لمحضر الاجتماع لاستخراج الملخص والقرارات والمهام مع المراجعة البشرية قبل أي حفظ.
          </p>
        </div>

        <button
          type="button"
          data-testid="ai-open-consent-btn"
          disabled={!isOnline || isAnalyzing}
          onClick={() => {
            setAnalysisError(null);
            setIsConsentOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>تحليل الاجتماع بالذكاء الاصطناعي</span>
        </button>
      </div>

      {/* Offline Guard Notice */}
      {!isOnline && (
        <div
          data-testid="ai-offline-notice"
          className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            التحليل الذكي غير متاح في وضع عدم الاتصال لأنه يتطلب إرسال النص المختار إلى Google Gemini عبر الخادم. تظل كافة أدوات التحرير اليدوي والمحضر متاحة.
          </span>
        </div>
      )}

      {/* Loading Progress Card with Cancel */}
      {isAnalyzing && (
        <div
          data-testid="ai-loading-card"
          className="p-4 rounded-xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
            <div className="space-y-0.5">
              <div className="font-bold text-stone-900 text-xs">
                جاري تحليل الاجتماع بواسطة المساعد الذكي...
              </div>
              <div className="text-[11px] text-stone-500">
                يُعالج النص المحدد فقط دون إرسال أي ملفات مرفقة، ولن يُحفظ أي عنصر تلقائياً.
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="ai-cancel-btn"
            onClick={handleCancelAnalysis}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-800 font-semibold text-xs shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>إلغاء التحليل</span>
          </button>
        </div>
      )}

      {/* Error State Banner */}
      {analysisError && (
        <div
          data-testid="ai-error-banner"
          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{analysisError}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setAnalysisError(null);
                setIsConsentOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-[11px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>مراجعة وإعادة المحاولة</span>
            </button>
            <button
              type="button"
              onClick={() => setAnalysisError(null)}
              className="p-1 text-rose-600 hover:text-rose-900"
              aria-label="إغلاق تنبيه الخطأ"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Action Feedback Banner */}
      {actionBanner && (
        <div
          data-testid="ai-action-banner"
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : actionBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-rose-50 border-rose-200 text-rose-950'
          }`}
        >
          <span>{actionBanner.text}</span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="opacity-70 hover:opacity-100 p-0.5"
            aria-label="إغلاق الإشعار"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Results Review Workspace */}
      {analysis && (
        <div data-testid="ai-results-panel" className="space-y-4">
          {/* Header + Ephemeral RAM Disclaimer */}
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-700" />
                <span>نتائج تحليل الاجتماع (بانتظار مراجعتك)</span>
              </div>
              <p className="text-[11px] text-stone-600">
                هذه الاقتراحات مؤقتة في ذاكرة الجلسة الحالية فقط ولم تُحفظ في المحضر أو قائمة المهام بعد. اعتمد كل عنصر أو عدّله أو تجاهله بشكل مستقل.
              </p>
            </div>
            <button
              type="button"
              data-testid="ai-clear-results-btn"
              onClick={() => setAnalysis(null)}
              className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-medium text-[11px] shrink-0"
            >
              مسح النتائج
            </button>
          </div>

          {/* Final Minutes Lock Notice */}
          {minutesLocked && (
            <div
              data-testid="ai-final-minutes-banner"
              className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  المحضر مضبوط على حالة <strong>نهائي</strong>: لا يمكن إضافة الملخص أو القرارات أو تعديل موعد المتابعة داخل المحضر قبل إعادة فتحه، بينما يظل إنشاء المهام المرتبطة المستقلة متاحاً.
                </span>
              </div>
              <button
                type="button"
                data-testid="ai-reopen-minutes-btn"
                onClick={onRequestReopenMinutes}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-400 text-amber-950 hover:bg-amber-100 font-semibold text-[11px] shrink-0"
              >
                <Unlock className="w-3 h-3" />
                <span>إعادة فتح المحضر</span>
              </button>
            </div>
          )}

          {/* Sparse/Truncation Warnings */}
          {analysis.warningsArabic.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 text-[11px] space-y-1">
              {analysis.warningsArabic.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* 1. SUGGESTED SUMMARY */}
          <div
            data-testid="ai-section-summary"
            className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-xs text-stone-900">
                  1. الملخص المقترح
                </span>
                {analysis.summary.insufficientInfo && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-semibold">
                    <AlertTriangle className="w-3 h-3" />
                    <span>معلومات محدودة في المصدر</span>
                  </span>
                )}
                {summaryState === 'approved' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-semibold">
                    <Check className="w-3 h-3" />
                    <span>تم اعتماده في المناقشات</span>
                  </span>
                )}
                {summaryState === 'ignored' && (
                  <span className="text-[10px] text-stone-500">تم تجاهل الملخص المقترح</span>
                )}
              </div>

              {summaryState !== 'ignored' && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsEditingSummary((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 text-[11px] font-medium"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditingSummary ? 'معاينة البنود' : 'تعديل قبل الحفظ'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryState('ignored')}
                    className="px-2 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 text-[11px]"
                  >
                    تجاهل
                  </button>
                </div>
              )}
            </div>

            {summaryState !== 'ignored' && (
              <>
                {isEditingSummary ? (
                  <textarea
                    rows={6}
                    data-testid="ai-summary-edit-textarea"
                    value={summaryDraftText}
                    onChange={(e) => setSummaryDraftText(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-xs text-stone-800 leading-relaxed focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                ) : (
                  <div className="space-y-2.5 text-xs text-stone-800">
                    <div>
                      <span className="font-semibold text-stone-600 text-[11px] block">
                        النظرة العامة:
                      </span>
                      <p className="leading-relaxed mt-0.5">{analysis.summary.overview}</p>
                    </div>
                    {analysis.summary.mainTopics.length > 0 && (
                      <div>
                        <span className="font-semibold text-stone-600 text-[11px] block">
                          أبرز الموضوعات:
                        </span>
                        <ul className="list-disc list-inside space-y-0.5 mt-0.5 text-stone-700">
                          {analysis.summary.mainTopics.map((topic, i) => (
                            <li key={i}>{topic}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.summary.keyOutcomes.length > 0 && (
                      <div>
                        <span className="font-semibold text-stone-600 text-[11px] block">
                          أهم النتائج والاتجاهات:
                        </span>
                        <ul className="list-disc list-inside space-y-0.5 mt-0.5 text-stone-700">
                          {analysis.summary.keyOutcomes.map((outcome, i) => (
                            <li key={i}>{outcome}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <span className="font-semibold text-stone-600 text-[11px] block">
                        التوجه القادم:
                      </span>
                      <p className="leading-relaxed mt-0.5 text-stone-700">
                        {analysis.summary.nextDirection}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    data-testid="ai-apply-summary-append-btn"
                    disabled={minutesLocked}
                    onClick={() => void handleApplySummary('append')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                  >
                    <Check className="w-3 h-3" />
                    <span>إضافة إلى ملخص المناقشات</span>
                  </button>
                  <button
                    type="button"
                    data-testid="ai-apply-summary-replace-btn"
                    disabled={minutesLocked}
                    onClick={() => void handleApplySummary('replace')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-semibold text-[11px] disabled:opacity-50"
                  >
                    <span>استبدال الملخص الحالي</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 2. EXTRACTED DECISIONS */}
          <div
            data-testid="ai-section-decisions"
            className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
              <span className="font-heading font-bold text-xs text-stone-900 tabular-nums">
                2. القرارات المستخرجة ({analysis.decisions.length})
              </span>
              <span className="text-[11px] text-stone-500">
                لا يُضاف أي قرار للمحضر قبل اعتمادك الصريح
              </span>
            </div>

            {analysis.decisions.length === 0 ? (
              <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                لم يظهر قرار صريح في النصوص المختارة.
              </p>
            ) : (
              <div className="space-y-2">
                {analysis.decisions.map((dec) => {
                  const st = decisionStates[dec.id] || 'pending';
                  const draft = decisionDrafts[dec.id] || {
                    text: dec.text,
                    ownerName: dec.ownerName || '',
                    agendaItemId: dec.agendaItemId || '',
                  };
                  const errMsg = decisionErrors[dec.id];
                  const linkedAgenda = agendaItems.find((a) => a.id === draft.agendaItemId);

                  return (
                    <div
                      key={dec.id}
                      data-testid={`ai-decision-card-${dec.id}`}
                      className={`p-3 rounded-xl border space-y-2 ${
                        st === 'approved'
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : st === 'ignored'
                          ? 'bg-stone-50 border-stone-200 opacity-60'
                          : 'bg-stone-50/50 border-stone-200'
                      }`}
                    >
                      {editingDecisionId === dec.id ? (
                        <div className="space-y-2">
                          <textarea
                            rows={2}
                            value={draft.text}
                            onChange={(e) =>
                              setDecisionDrafts((prev) => ({
                                ...prev,
                                [dec.id]: { ...draft, text: e.target.value },
                              }))
                            }
                            className="w-full bg-white border border-stone-300 rounded-lg p-2 text-xs"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={draft.ownerName}
                              onChange={(e) =>
                                setDecisionDrafts((prev) => ({
                                  ...prev,
                                  [dec.id]: { ...draft, ownerName: e.target.value },
                                }))
                              }
                              placeholder="المسؤول (اختياري)..."
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
                            />
                            <select
                              value={draft.agendaItemId}
                              onChange={(e) =>
                                setDecisionDrafts((prev) => ({
                                  ...prev,
                                  [dec.id]: { ...draft, agendaItemId: e.target.value },
                                }))
                              }
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
                            >
                              <option value="">بدون ربط ببند جدول أعمال</option>
                              {agendaItems.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.order}. {a.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingDecisionId(null)}
                              className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold"
                            >
                              إنهاء التعديل
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <p className="font-bold text-stone-900 text-xs leading-relaxed">
                              {draft.text}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${
                                dec.confidence === 'explicit'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-900 border-amber-300'
                              }`}
                            >
                              {dec.confidence === 'explicit' ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>قرار صريح في المحضر</span>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>اقتراح يحتاج لتأكيد</span>
                                </>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-stone-600 flex-wrap">
                            {draft.ownerName && <span>المسؤول: {draft.ownerName}</span>}
                            {linkedAgenda && (
                              <span>
                                البند: {linkedAgenda.order}. {linkedAgenda.title}
                              </span>
                            )}
                            {dec.sourceExcerpt && (
                              <span className="text-stone-500">
                                من النص: «{dec.sourceExcerpt}»
                              </span>
                            )}
                          </div>

                          {errMsg && (
                            <p className="text-[11px] text-rose-700 font-medium">{errMsg}</p>
                          )}

                          <div className="flex items-center gap-1.5 flex-wrap pt-1">
                            {st === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                                <Check className="w-3.5 h-3.5" />
                                <span>تمت إضافته إلى قرارات المحضر</span>
                              </span>
                            ) : st === 'ignored' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDecisionStates((prev) => ({ ...prev, [dec.id]: 'pending' }))
                                }
                                className="text-[11px] text-stone-700 underline"
                              >
                                استعادة للمراجعة
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  data-testid={`ai-approve-decision-${dec.id}`}
                                  disabled={minutesLocked}
                                  onClick={() => void handleApproveDecision(dec)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>اعتماد وإضافة للمحضر</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingDecisionId(dec.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-700 text-[11px]"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>تعديل</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDecisionStates((prev) => ({ ...prev, [dec.id]: 'ignored' }))
                                  }
                                  className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-600 text-[11px]"
                                >
                                  تجاهل
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. SUGGESTED TASKS */}
          <div
            data-testid="ai-section-tasks"
            className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-stone-100">
              <div>
                <span className="font-heading font-bold text-xs text-stone-900 tabular-nums">
                  3. المهام المقترحة ({analysis.actionItems.length})
                </span>
                <p className="text-[11px] text-stone-500">
                  تُربط المهام المعتمدة بهذا اللقاء والعميل بعد تأكيدك فقط، مع منع التكرار.
                </p>
              </div>

              {pendingTaskCount > 0 && (
                <button
                  type="button"
                  data-testid="ai-batch-approve-tasks-btn"
                  disabled={isBatchApprovingTasks}
                  onClick={() => void handleBatchApproveSelectedTasks()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] disabled:opacity-50 shrink-0"
                >
                  {isBatchApprovingTasks ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>اعتماد المهام المحددة</span>
                </button>
              )}
            </div>

            {batchTaskNotice && (
              <div
                data-testid="ai-batch-task-notice"
                className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-stone-800 text-[11px] font-medium"
              >
                {batchTaskNotice}
              </div>
            )}

            {analysis.actionItems.length === 0 ? (
              <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                لم تُستخرج مهام تنفيذية واضحة من النصوص المختارة.
              </p>
            ) : (
              <div className="space-y-2">
                {analysis.actionItems.map((item) => {
                  const st = taskStates[item.id] || 'pending';
                  const draft = taskDrafts[item.id] || {
                    title: item.title,
                    description: item.description || '',
                    ownerName: item.ownerName || '',
                    dueDate: item.dueDate || '',
                    priority: item.priority,
                  };
                  const duplicate =
                    st !== 'approved'
                      ? findDuplicateMeetingTask(tasks, {
                          meetingId: meeting.id,
                          title: draft.title,
                        })
                      : undefined;
                  const errMsg = taskErrors[item.id];
                  const dateUncertain =
                    item.needsDueDateConfirmation && !isValidIsoDateOnly(draft.dueDate);
                  const ownerUncertain = !draft.ownerName.trim();

                  return (
                    <div
                      key={item.id}
                      data-testid={`ai-task-card-${item.id}`}
                      className={`p-3 rounded-xl border space-y-2 ${
                        st === 'approved'
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : st === 'save_failed'
                          ? 'bg-rose-50/60 border-rose-300'
                          : st === 'ignored'
                          ? 'bg-stone-50 border-stone-200 opacity-60'
                          : 'bg-stone-50/50 border-stone-200'
                      }`}
                    >
                      {editingTaskId === item.id ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            data-testid={`ai-task-edit-title-${item.id}`}
                            value={draft.title}
                            onChange={(e) =>
                              setTaskDrafts((prev) => ({
                                ...prev,
                                [item.id]: { ...draft, title: e.target.value },
                              }))
                            }
                            placeholder="عنوان المهمة..."
                            className="w-full bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={draft.ownerName}
                              onChange={(e) =>
                                setTaskDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, ownerName: e.target.value },
                                }))
                              }
                              placeholder="المسؤول (اختياري)..."
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
                            />
                            <input
                              type="date"
                              data-testid={`ai-task-edit-date-${item.id}`}
                              value={draft.dueDate}
                              onChange={(e) =>
                                setTaskDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, dueDate: e.target.value },
                                }))
                              }
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs tabular-nums"
                            />
                            <select
                              value={draft.priority}
                              onChange={(e) =>
                                setTaskDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    ...draft,
                                    priority: e.target.value as TaskPriority,
                                  },
                                }))
                              }
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
                            >
                              <option value="urgent">عاجلة</option>
                              <option value="high">عالية</option>
                              <option value="medium">متوسطة</option>
                              <option value="low">منخفضة</option>
                            </select>
                          </div>
                          <input
                            type="text"
                            value={draft.description}
                            onChange={(e) =>
                              setTaskDrafts((prev) => ({
                                ...prev,
                                [item.id]: { ...draft, description: e.target.value },
                              }))
                            }
                            placeholder="تفاصيل إضافية (اختياري)..."
                            className="w-full bg-white border border-stone-300 rounded-lg px-2.5 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingTaskId(null)}
                            className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold"
                          >
                            حفظ التعديل مؤقتاً
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-2.5">
                            {st !== 'approved' && st !== 'ignored' && (
                              <input
                                type="checkbox"
                                checked={Boolean(selectedTaskIds[item.id])}
                                onChange={(e) =>
                                  setSelectedTaskIds((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.checked,
                                  }))
                                }
                                aria-label={`تحديد مهمة ${draft.title}`}
                                className="mt-1 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
                              />
                            )}
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="font-bold text-stone-900 text-xs">{draft.title}</div>
                              {draft.description && (
                                <p className="text-[11px] text-stone-600">{draft.description}</p>
                              )}
                              <div className="flex items-center gap-2.5 text-[11px] text-stone-600 flex-wrap tabular-nums">
                                <span>
                                  الاستحقاق: {draft.dueDate ? draft.dueDate : 'غير محدد'}
                                </span>
                                <span>·</span>
                                <span>
                                  المسؤول: {draft.ownerName ? draft.ownerName : 'غير محدد'}
                                </span>
                                <span>·</span>
                                <span>
                                  الأهمية:{' '}
                                  {draft.priority === 'urgent'
                                    ? 'عاجلة'
                                    : draft.priority === 'high'
                                    ? 'عالية'
                                    : draft.priority === 'medium'
                                    ? 'متوسطة'
                                    : 'منخفضة'}
                                </span>
                              </div>

                              {(dateUncertain || ownerUncertain) && st !== 'approved' && (
                                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                  {dateUncertain && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-medium">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>الموعد يحتاج تأكيداً</span>
                                    </span>
                                  )}
                                  {ownerUncertain && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-stone-700 text-[10px] font-medium">
                                      <span>المسؤول غير مذكور صراحة</span>
                                    </span>
                                  )}
                                </div>
                              )}

                              {duplicate && (
                                <div
                                  data-testid={`ai-task-duplicate-${item.id}`}
                                  className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-[11px] flex items-center gap-1.5"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                  <span>
                                    توجد مهمة مشابهة مسجلة مسبقاً لهذا اللقاء («{duplicate.title}»). عدّل العنوان أو تجاهل الاقتراح لمنع التكرار.
                                  </span>
                                </div>
                              )}

                              {errMsg && (
                                <div
                                  data-testid={`ai-task-error-${item.id}`}
                                  className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-[11px]"
                                >
                                  {errMsg}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap pt-1">
                            {st === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>تم الإنشاء والربط باللقاء</span>
                              </span>
                            ) : st === 'ignored' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setTaskStates((prev) => ({ ...prev, [item.id]: 'pending' }))
                                }
                                className="text-[11px] text-stone-700 underline"
                              >
                                استعادة للمراجعة
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  data-testid={`ai-approve-task-${item.id}`}
                                  disabled={Boolean(duplicate)}
                                  onClick={() => void handleApproveSingleTask(item)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                                >
                                  {st === 'save_failed' ? (
                                    <>
                                      <RefreshCw className="w-3 h-3" />
                                      <span>إعادة محاولة الحفظ</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-3 h-3" />
                                      <span>اعتماد وإنشاء المهمة</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`ai-edit-task-btn-${item.id}`}
                                  onClick={() => setEditingTaskId(item.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-700 text-[11px]"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>تعديل</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid={`ai-ignore-task-btn-${item.id}`}
                                  onClick={() =>
                                    setTaskStates((prev) => ({ ...prev, [item.id]: 'ignored' }))
                                  }
                                  className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-600 text-[11px]"
                                >
                                  تجاهل
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. OPEN QUESTIONS & AMBIGUITIES (Display/Review only — NEVER auto-tasks) */}
          <div
            data-testid="ai-section-open-questions"
            className="rounded-xl border border-stone-200 p-3.5 space-y-2.5 bg-white"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100 flex-wrap">
              <span className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5 tabular-nums">
                <HelpCircle className="w-3.5 h-3.5 text-amber-700" />
                <span>4. نقاط تحتاج إلى متابعة ({analysis.openQuestions.length})</span>
              </span>
              <span className="text-[11px] text-stone-500">
                للمراجعة والنقاش فقط — لا تتحول تلقائياً إلى مهام
              </span>
            </div>

            {analysis.openQuestions.length === 0 ? (
              <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                لا توجد نقاط غامضة أو أسئلة مفتوحة مستخرجة.
              </p>
            ) : (
              <div className="space-y-1.5">
                {analysis.openQuestions.map((q) => {
                  if (dismissedOpenIds[q.id]) return null;
                  const catLabel =
                    q.category === 'risk'
                      ? 'تنبيه / مخاطرة'
                      : q.category === 'ambiguity'
                      ? 'نقطة غامضة'
                      : 'سؤال مفتوح';
                  return (
                    <div
                      key={q.id}
                      className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/60 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[10px] font-semibold text-amber-800">{catLabel}</span>
                        <p className="text-xs text-stone-800 leading-relaxed">{q.text}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedOpenIds((prev) => ({ ...prev, [q.id]: true }))
                        }
                        className="text-[11px] text-stone-500 hover:text-stone-800 shrink-0 px-2 py-0.5 rounded"
                      >
                        إخفاء
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5. FOLLOW-UP SUGGESTIONS */}
          <div
            data-testid="ai-section-followups"
            className="rounded-xl border border-stone-200 p-3.5 space-y-2.5 bg-white"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100 flex-wrap">
              <span className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5 tabular-nums">
                <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                <span>5. مقترحات المتابعة القادمة ({analysis.followUpSuggestions.length})</span>
              </span>
              <span className="text-[11px] text-stone-500">
                لا يتم إنشاء اجتماع تلقائياً
              </span>
            </div>

            {analysis.followUpSuggestions.length === 0 ? (
              <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                لا توجد مقترحات متابعة إضافية في النص المختار.
              </p>
            ) : (
              <div className="space-y-2">
                {analysis.followUpSuggestions.map((f) => {
                  const st = followUpStates[f.id] || 'pending';
                  const dateVal = followUpDateDrafts[f.id] || '';
                  const errMsg = followUpErrors[f.id];

                  return (
                    <div
                      key={f.id}
                      className={`p-3 rounded-xl border space-y-2 ${
                        st === 'approved'
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : st === 'ignored'
                          ? 'bg-stone-50 border-stone-200 opacity-60'
                          : 'bg-stone-50/50 border-stone-200'
                      }`}
                    >
                      <p className="font-bold text-stone-900 text-xs">{f.actionText}</p>
                      {f.suggestedQuestions.length > 0 && (
                        <ul className="list-disc list-inside text-[11px] text-stone-600 space-y-0.5">
                          {f.suggestedQuestions.map((sq, i) => (
                            <li key={i}>{sq}</li>
                          ))}
                        </ul>
                      )}

                      {st !== 'ignored' && st !== 'approved' && (
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <input
                            type="date"
                            value={dateVal}
                            onChange={(e) =>
                              setFollowUpDateDrafts((prev) => ({
                                ...prev,
                                [f.id]: e.target.value,
                              }))
                            }
                            className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs tabular-nums"
                          />
                          {f.needsDateConfirmation && !dateVal && (
                            <span className="text-[10px] text-amber-800">
                              تاريخ مقترح غير محدد — اختر التاريخ المناسب
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={minutesLocked || !dateVal}
                            onClick={() => void handleApplyFollowUpDate(f.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />
                            <span>اعتماد كموعد متابعة</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCreateTaskFromFollowUp(f.id, f.actionText)
                            }
                            className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-medium text-[11px]"
                          >
                            إنشاء كمهمة متابعة
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFollowUpStates((prev) => ({ ...prev, [f.id]: 'ignored' }))
                            }
                            className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-600 text-[11px]"
                          >
                            تجاهل
                          </button>
                        </div>
                      )}

                      {st === 'approved' && (
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                          <Check className="w-3.5 h-3.5" />
                          <span>تم اعتماد اقتراح المتابعة</span>
                        </div>
                      )}

                      {errMsg && <p className="text-[11px] text-rose-700">{errMsg}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* CONSENT & CONTENT PREVIEW MODAL                                   */}
      {/* ================================================================= */}
      {isConsentOpen && (
        <div
          data-testid="ai-consent-modal"
          className="fixed inset-0 z-70 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-auto border border-stone-200 max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-start justify-between gap-3 shrink-0">
              <div className="space-y-0.5">
                <h4 className="font-heading font-bold text-sm text-stone-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>موافقة صريحة ومعاينة المحتوى قبل التحليل</span>
                </h4>
                <p className="text-[11px] text-stone-600">
                  اختر الأقسام التي ترغب في إرسالها إلى Google Gemini. لن يُحفظ أي اقتراح تلقائياً قبل موافقتك.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConsentOpen(false)}
                aria-label="إغلاق نافذة الموافقة"
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Privacy Disclosure Box */}
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-950 space-y-1 text-[11px] leading-relaxed">
                <div>
                  <strong>ما سيُرسل:</strong> النصوص المحددة أدناه فقط عبر خادم مُرافق الآمن إلى Google Gemini لاستخراج الملخص والقرارات والمهام المقترحة.
                </div>
                <div>
                  <strong>ما لن يُرسل:</strong> ملفات وصور ومستندات Backblaze B2، روابط التنزيل المؤقتة، وسجلات العملاء الأخرى.
                </div>
              </div>

              {/* Section Toggles */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-stone-800 text-xs">
                    الأقسام المضمنة في التحليل:
                  </span>
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      inputBundle.exceedsLimit ? 'text-rose-700 font-bold' : 'text-stone-500'
                    }`}
                  >
                    {inputBundle.totalChars.toLocaleString('en-US')} /{' '}
                    {MAX_AI_TOTAL_INPUT_CHARS.toLocaleString('en-US')} حرف
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AI_SECTION_LABELS.map((sec) => (
                    <label
                      key={sec.key}
                      className="flex items-center gap-2 p-2 rounded-xl border border-stone-200 bg-stone-50/60 hover:bg-stone-100/70 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        data-testid={`ai-toggle-${sec.key}`}
                        checked={Boolean(includedSections[sec.key])}
                        onChange={() => handleToggleSection(sec.key)}
                        className="rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      <span className="text-[11px] font-medium text-stone-800">
                        {sec.labelAr}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Live Preview */}
              <div className="space-y-1.5">
                <label className="font-bold text-stone-800 text-xs flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-stone-500" />
                  <span>معاينة النص الفعلي الذي سيُرسل:</span>
                </label>
                <pre
                  data-testid="ai-consent-preview-text"
                  className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-[11px] text-stone-700 whitespace-pre-wrap break-words font-sans max-h-52 overflow-y-auto leading-relaxed"
                >
                  {inputBundle.previewText || 'لم يتم تحديد أقسام تحتوي على نص كافٍ للتحليل.'}
                </pre>
              </div>

              {!inputBundle.hasSubstantiveContent && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                  النص المختار حالياً قصير جداً. فعّل قسماً يحتوي على مناقشات أو بنود جدول أعمال أو أضف ملاحظات للقاء أولاً.
                </div>
              )}

              {inputBundle.exceedsLimit && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px]">
                  النص المختار يتجاوز الحد الأقصى ({MAX_AI_TOTAL_INPUT_CHARS.toLocaleString('en-US')} حرفاً). ألغِ تحديد بعض الأقسام لتقليص الحجم.
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsConsentOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold text-xs"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="ai-confirm-analyze-btn"
                disabled={
                  !isOnline ||
                  !inputBundle.hasSubstantiveContent ||
                  inputBundle.exceedsLimit ||
                  isAnalyzing
                }
                onClick={() => void handleStartAnalysis()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>أوافق، ابدأ التحليل</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
