import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Edit3,
  Eye,
  FileSearch,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  ActionItem,
  DocumentAiAnalysisMode,
  DocumentAiAnalysisResult,
  DocumentAiImportantDate,
  DocumentAiReviewItemState,
  DocumentAiSuggestedDecision,
  DocumentAiSuggestedTask,
  DocumentAiUiState,
  Meeting,
  MeetingAgendaItem,
  MeetingAttachment,
  TaskPriority,
} from '../types';
import { formatFileSizeArabic, isImageMimeType } from '../utils/attachmentPolicy';
import {
  DOCUMENT_AI_MAX_QUESTION_CHARS,
  buildStructuredDocumentSummaryText,
  getDocumentTypeArabicLabel,
  isAttachmentSupportedForDocumentAi,
} from '../utils/documentIntelligence';
import {
  applyAiFollowUpDateToMeeting,
  applyAiSummaryToMeeting,
  approveAiDecisionIntoMeeting,
  approveAiSuggestedTask,
  approveSuggestedTasksSequentially,
  isValidIsoDateOnly,
} from '../utils/meetingAiAssistant';
import { findDuplicateMeetingTask, isMinutesLocked } from '../utils/meetingMinutes';
import { DocumentAiClientError, requestDocumentAnalysis } from '../services/documentAi';

export interface DocumentAiAssistantProps {
  meeting: Meeting;
  attachments: MeetingAttachment[];
  tasks: ActionItem[];
  agendaItems: MeetingAgendaItem[];
  isOnline: boolean;
  onPersistMeetingUpdate: (nextMeeting: Meeting, noticeMsg: string) => Promise<void> | void;
  onSaveTask: (task: ActionItem) => Promise<void> | void;
  onRequestReopenMinutes: () => void;
  externalSelectedAttachment?: MeetingAttachment | null;
  externalTriggerNonce?: number;
  requestAnalysisFn?: typeof requestDocumentAnalysis;
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

const CONFIGURATION_ERROR_CODES = new Set([
  'GEMINI_NOT_CONFIGURED',
  'B2_NOT_CONFIGURED',
  'GEMINI_AUTH_ERROR',
]);

export const DocumentAiAssistant: React.FC<DocumentAiAssistantProps> = ({
  meeting,
  attachments,
  tasks,
  agendaItems,
  isOnline,
  onPersistMeetingUpdate,
  onSaveTask,
  onRequestReopenMinutes,
  externalSelectedAttachment = null,
  externalTriggerNonce = 0,
  requestAnalysisFn = requestDocumentAnalysis,
}) => {
  const minutesLocked = isMinutesLocked(meeting);

  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string>('');
  const [analysisMode, setAnalysisMode] = useState<DocumentAiAnalysisMode>('comprehensive');
  const [questionInput, setQuestionInput] = useState<string>('');
  const [questionValidationError, setQuestionValidationError] = useState<string | null>(null);

  const [uiState, setUiState] = useState<DocumentAiUiState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Ephemeral RAM-only result (never persisted to browser storage, database, or logs)
  const [result, setResult] = useState<DocumentAiAnalysisResult | null>(null);

  // Human review states
  const [summaryState, setSummaryState] = useState<DocumentAiReviewItemState>('pending');
  const [isEditingSummary, setIsEditingSummary] = useState<boolean>(false);
  const [summaryDraftText, setSummaryDraftText] = useState<string>('');
  const [confirmReplaceSummaryOpen, setConfirmReplaceSummaryOpen] = useState<boolean>(false);

  const [decisionStates, setDecisionStates] = useState<Record<string, DocumentAiReviewItemState>>({});
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraftState>>({});

  const [taskStates, setTaskStates] = useState<Record<string, DocumentAiReviewItemState>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<Record<string, boolean>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraftState>>({});
  const [isBatchApprovingTasks, setIsBatchApprovingTasks] = useState<boolean>(false);
  const [batchTaskNotice, setBatchTaskNotice] = useState<string | null>(null);

  const [dateStates, setDateStates] = useState<Record<string, DocumentAiReviewItemState>>({});
  const [dateDraftIso, setDateDraftIso] = useState<Record<string, string>>({});
  const [dateErrors, setDateErrors] = useState<Record<string, string>>({});

  const [dismissedOpenIds, setDismissedOpenIds] = useState<Record<string, boolean>>({});

  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const clearEphemeralResult = () => {
    setResult(null);
    setSummaryState('pending');
    setIsEditingSummary(false);
    setSummaryDraftText('');
    setConfirmReplaceSummaryOpen(false);
    setDecisionStates({});
    setDecisionErrors({});
    setEditingDecisionId(null);
    setDecisionDrafts({});
    setTaskStates({});
    setTaskErrors({});
    setSelectedTaskIds({});
    setEditingTaskId(null);
    setTaskDrafts({});
    setDateStates({});
    setDateDraftIso({});
    setDateErrors({});
    setDismissedOpenIds({});
    setBatchTaskNotice(null);
    setActionBanner(null);
  };

  // Reset all ephemeral RAM state when switching meetings
  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSelectedAttachmentId('');
    setAnalysisMode('comprehensive');
    setQuestionInput('');
    setQuestionValidationError(null);
    setUiState(isOnline ? 'idle' : 'offline');
    setStatusMessage(null);
    clearEphemeralResult();
  }, [meeting.id]);

  // Keep selected attachment coherent with live attachments list & clear RAM results if analyzed attachment is deleted
  useEffect(() => {
    if (attachments.length === 0) {
      setSelectedAttachmentId('');
      if (result) {
        clearEphemeralResult();
        setUiState(isOnline ? 'idle' : 'offline');
      }
      return;
    }

    if (result && !attachments.some((a) => a.id === result.attachmentId && (!a.deleteStatus || a.deleteStatus === 'active'))) {
      clearEphemeralResult();
      setUiState(isOnline ? 'idle' : 'offline');
    }

    if (!selectedAttachmentId || !attachments.some((a) => a.id === selectedAttachmentId)) {
      const firstActive = attachments.find((a) => !a.deleteStatus || a.deleteStatus === 'active') || attachments[0];
      setSelectedAttachmentId(firstActive.id);
    }
  }, [attachments]);

  // Reflect offline transitions clearly without losing any existing RAM review if user wants to read it, or update idle/consent
  useEffect(() => {
    if (!isOnline) {
      if (uiState === 'idle' || uiState === 'consent' || uiState === 'unsupported_file') {
        setUiState('offline');
      }
    } else if (uiState === 'offline') {
      setUiState(result ? 'success' : 'idle');
    }
  }, [isOnline]);

  // Handle direct trigger from an attachment row in MeetingAttachmentsSection
  useEffect(() => {
    if (!externalTriggerNonce || !externalSelectedAttachment) return;
    setSelectedAttachmentId(externalSelectedAttachment.id);
    setActionBanner(null);
    setQuestionValidationError(null);

    if (!isOnline) {
      setUiState('offline');
      return;
    }

    const support = isAttachmentSupportedForDocumentAi(externalSelectedAttachment);
    if (!support.supported) {
      setStatusMessage(support.reasonArabic || 'هذا المرفق غير صالح للتحليل الذكي.');
      setUiState('unsupported_file');
      return;
    }

    setStatusMessage(null);
    setUiState('consent');
  }, [externalTriggerNonce, externalSelectedAttachment?.id]);

  const selectedAttachment = useMemo(
    () => attachments.find((a) => a.id === selectedAttachmentId) || null,
    [attachments, selectedAttachmentId]
  );

  const selectedSupport = useMemo(() => {
    if (!selectedAttachment) return null;
    return isAttachmentSupportedForDocumentAi(selectedAttachment);
  }, [selectedAttachment]);

  const hydrateDraftsFromResult = (res: DocumentAiAnalysisResult) => {
    setSummaryState('pending');
    setIsEditingSummary(false);
    setConfirmReplaceSummaryOpen(false);
    setSummaryDraftText(buildStructuredDocumentSummaryText(res));

    const decStates: Record<string, DocumentAiReviewItemState> = {};
    const decDrafts: Record<string, DecisionDraftState> = {};
    res.decisions.forEach((d) => {
      decStates[d.id] = 'pending';
      decDrafts[d.id] = {
        text: d.text,
        ownerName: d.ownerName || '',
        agendaItemId: '',
      };
    });
    setDecisionStates(decStates);
    setDecisionDrafts(decDrafts);
    setDecisionErrors({});
    setEditingDecisionId(null);

    const tStates: Record<string, DocumentAiReviewItemState> = {};
    const tSelected: Record<string, boolean> = {};
    const tDrafts: Record<string, TaskDraftState> = {};
    res.suggestedTasks.forEach((t) => {
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
    setSelectedTaskIds(tSelected);
    setTaskDrafts(tDrafts);
    setTaskErrors({});
    setEditingTaskId(null);
    setBatchTaskNotice(null);

    const dtStates: Record<string, DocumentAiReviewItemState> = {};
    const dtIso: Record<string, string> = {};
    res.importantDates.forEach((dt) => {
      dtStates[dt.id] = 'pending';
      dtIso[dt.id] = dt.dateIso || '';
    });
    setDateStates(dtStates);
    setDateDraftIso(dtIso);
    setDateErrors({});

    setDismissedOpenIds({});
    setActionBanner(null);
  };

  const handleOpenConsent = () => {
    setActionBanner(null);
    setQuestionValidationError(null);

    if (!isOnline) {
      setUiState('offline');
      return;
    }

    if (!selectedAttachment) {
      setStatusMessage('يرجى اختيار مرفق من القائمة أولاً.');
      setUiState('error');
      return;
    }

    const support = isAttachmentSupportedForDocumentAi(selectedAttachment);
    if (!support.supported) {
      setStatusMessage(support.reasonArabic || 'هذا المرفق غير مدعوم للتحليل الذكي.');
      setUiState('unsupported_file');
      return;
    }

    setStatusMessage(null);
    setUiState('consent');
  };

  const handleConfirmAndAnalyze = async () => {
    if (!selectedAttachment) return;
    if (!isOnline) {
      setUiState('offline');
      return;
    }

    const support = isAttachmentSupportedForDocumentAi(selectedAttachment);
    if (!support.supported) {
      setStatusMessage(support.reasonArabic || 'هذا المرفق غير مدعوم للتحليل الذكي.');
      setUiState('unsupported_file');
      return;
    }

    if (analysisMode === 'question') {
      const trimmedQ = questionInput.trim();
      if (trimmedQ.length < 2) {
        setQuestionValidationError('يرجى كتابة سؤال واضح حول المستند (حرفان على الأقل).');
        return;
      }
      if (trimmedQ.length > DOCUMENT_AI_MAX_QUESTION_CHARS) {
        setQuestionValidationError(
          `يتجاوز السؤال الحد الأقصى المسموح (${DOCUMENT_AI_MAX_QUESTION_CHARS} حرفاً).`
        );
        return;
      }
    }

    setQuestionValidationError(null);
    setStatusMessage(null);
    setUiState('loading');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const docResult = await requestAnalysisFn({
        meetingId: meeting.id,
        attachmentId: selectedAttachment.id,
        fileName: selectedAttachment.fileName,
        contentType: selectedAttachment.contentType,
        sizeBytes: selectedAttachment.sizeBytes,
        analysisMode,
        question: analysisMode === 'question' ? questionInput.trim() : undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setResult(docResult);
      hydrateDraftsFromResult(docResult);
      setUiState('success');
    } catch (err: any) {
      const code = err instanceof DocumentAiClientError ? err.code : String(err?.code || '');
      if (code === 'AI_ABORTED' || controller.signal.aborted) {
        setStatusMessage('تم إلغاء تحليل المستند بناءً على طلبك. لم يتم تعديل أي بيانات.');
        setUiState('cancelled');
      } else if (code === 'OFFLINE_BLOCKED') {
        setStatusMessage(err?.message || 'أنت في وضع عدم الاتصال.');
        setUiState('offline');
      } else if (CONFIGURATION_ERROR_CODES.has(code)) {
        setStatusMessage(
          err?.message ||
            'خدمة تحليل المستندات غير مهيأة بعد على الخادم؛ يرجى مراجعة إعدادات الذكاء الاصطناعي والتخزين السحابي.'
        );
        setUiState('configuration_error');
      } else if (code === 'UNSUPPORTED_DOCUMENT_TYPE' || code === 'DOCUMENT_TOO_LARGE') {
        setStatusMessage(err?.message || 'الملف غير مدعوم أو يتجاوز الحد المسموح.');
        setUiState('unsupported_file');
      } else {
        setStatusMessage(
          err?.message || 'تعذر إتمام تحليل المرفق عبر Google Gemini. يمكنك المحاولة مجدداً.'
        );
        setUiState('error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
  };

  const handleApplySummary = async (mode: 'append' | 'replace') => {
    if (summaryState === 'approved' || summaryState === 'saving') return;
    setSummaryState('saving' as any);
    setActionBanner(null);

    const res = applyAiSummaryToMeeting(meeting, summaryDraftText, mode);
    if (!res.ok) {
      setSummaryState('pending');
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      setConfirmReplaceSummaryOpen(false);
      return;
    }

    try {
      await onPersistMeetingUpdate(
        res.meeting,
        mode === 'replace'
          ? 'تم اعتماد ملخص المستند واستبدال ملخص المناقشات.'
          : 'تمت إضافة ملخص المستند المعتمد إلى قسم المناقشات.'
      );

      setSummaryState('approved');
      setIsEditingSummary(false);
      setConfirmReplaceSummaryOpen(false);
      setActionBanner({
        type: 'success',
        text: 'تم حفظ الملخص المعتمد في ملخص المناقشات دون المساس بالملاحظات النصية السابقة.',
      });
    } catch (err: any) {
      setSummaryState('save_failed');
      const errMsg = err?.message || 'تعذر حفظ الملخص المعتمد على الخادم. يرجى إعادة المحاولة.';
      setActionBanner({ type: 'error', text: errMsg });
    }
  };

  const handleApproveDecision = async (dec: DocumentAiSuggestedDecision) => {
    const st = decisionStates[dec.id];
    if (st === 'approved' || st === 'saving') return;

    setDecisionStates((prev) => ({ ...prev, [dec.id]: 'saving' as any }));
    setDecisionErrors((prev) => {
      const copy = { ...prev };
      delete copy[dec.id];
      return copy;
    });

    const draft = decisionDrafts[dec.id] || {
      text: dec.text,
      ownerName: dec.ownerName || '',
      agendaItemId: '',
    };
    const res = approveAiDecisionIntoMeeting(meeting, {
      text: draft.text,
      ownerName: draft.ownerName || undefined,
      agendaItemId: draft.agendaItemId || undefined,
    });

    if (!res.ok) {
      setDecisionStates((prev) => ({ ...prev, [dec.id]: 'save_failed' }));
      setDecisionErrors((prev) => ({ ...prev, [dec.id]: res.reasonArabic }));
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      return;
    }

    try {
      await onPersistMeetingUpdate(res.meeting, 'تم اعتماد القرار المستخرج وإضافته إلى المحضر.');
      setDecisionStates((prev) => ({ ...prev, [dec.id]: 'approved' }));
      setDecisionErrors((prev) => {
        const copy = { ...prev };
        delete copy[dec.id];
        return copy;
      });
      setEditingDecisionId((curr) => (curr === dec.id ? null : curr));
      setActionBanner({ type: 'success', text: 'تم اعتماد القرار وحفظه بنجاح.' });
    } catch (err: any) {
      setDecisionStates((prev) => ({ ...prev, [dec.id]: 'save_failed' }));
      const errMsg = err?.message || 'تعذر حفظ القرار على الخادم.';
      setDecisionErrors((prev) => ({ ...prev, [dec.id]: errMsg }));
      setActionBanner({ type: 'error', text: errMsg });
    }
  };

  const buildTaskCandidate = (item: DocumentAiSuggestedTask) => {
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

  const handleApproveSingleTask = async (item: DocumentAiSuggestedTask) => {
    const st = taskStates[item.id];
    if (st === 'approved' || st === 'saving') return;

    setTaskStates((prev) => ({ ...prev, [item.id]: 'saving' as any }));
    setTaskErrors((prev) => {
      const copy = { ...prev };
      delete copy[item.id];
      return copy;
    });

    const candidate = buildTaskCandidate(item);
    try {
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
    } catch (err: any) {
      setTaskStates((prev) => ({ ...prev, [item.id]: 'save_failed' }));
      const errMsg = err?.message || 'تعذر حفظ المهمة على الخادم.';
      setTaskErrors((prev) => ({ ...prev, [item.id]: errMsg }));
    }
  };

  const handleBatchApproveSelectedTasks = async () => {
    if (!result || isBatchApprovingTasks) return;

    const alreadyApproved = new Set(
      Object.entries(taskStates)
        .filter(([, st]) => st === 'approved')
        .map(([id]) => id)
    );

    const targets = result.suggestedTasks
      .filter((item) => {
        const st = taskStates[item.id];
        if (st === 'approved' || st === 'ignored' || st === 'saving') return false;
        return Boolean(selectedTaskIds[item.id]);
      })
      .map(buildTaskCandidate);

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

  const handleAdoptImportantDateAsFollowUp = async (dt: DocumentAiImportantDate) => {
    const st = dateStates[dt.id];
    if (st === 'approved' || st === 'saving') return;

    const rawDate = (dateDraftIso[dt.id] || dt.dateIso || '').trim();
    if (!isValidIsoDateOnly(rawDate)) {
      setDateErrors((prev) => ({
        ...prev,
        [dt.id]: 'يرجى تحديد تاريخ صحيح بصيغة YYYY-MM-DD قبل اعتماده كموعد متابعة.',
      }));
      return;
    }

    setDateStates((prev) => ({ ...prev, [dt.id]: 'saving' as any }));
    setDateErrors((prev) => {
      const copy = { ...prev };
      delete copy[dt.id];
      return copy;
    });

    const res = applyAiFollowUpDateToMeeting(meeting, rawDate);
    if (!res.ok) {
      setDateStates((prev) => ({ ...prev, [dt.id]: 'save_failed' }));
      setDateErrors((prev) => ({ ...prev, [dt.id]: res.reasonArabic }));
      setActionBanner({ type: 'warning', text: res.reasonArabic });
      return;
    }

    try {
      await onPersistMeetingUpdate(
        res.meeting,
        `تم اعتماد التاريخ (${rawDate}) كموعد متابعة في هذا اللقاء.`
      );
      setDateStates((prev) => ({ ...prev, [dt.id]: 'approved' }));
      setDateErrors((prev) => {
        const copy = { ...prev };
        delete copy[dt.id];
        return copy;
      });
      setActionBanner({ type: 'success', text: 'تم اعتماد موعد المتابعة وحفظه بنجاح.' });
    } catch (err: any) {
      setDateStates((prev) => ({ ...prev, [dt.id]: 'save_failed' }));
      const errMsg = err?.message || 'تعذر حفظ موعد المتابعة على الخادم.';
      setDateErrors((prev) => ({ ...prev, [dt.id]: errMsg }));
      setActionBanner({ type: 'error', text: errMsg });
    }
  };

  const pendingTaskCount = result
    ? result.suggestedTasks.filter((t) => {
        const st = taskStates[t.id];
        return st !== 'approved' && st !== 'ignored';
      }).length
    : 0;

  return (
    <section
      data-testid="section-document-ai-assistant"
      className="border border-stone-200 rounded-2xl p-4 bg-white space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
        <div className="space-y-0.5">
          <h4 className="font-heading font-bold text-sm text-stone-900 flex items-center gap-1.5">
            <FileSearch className="w-4 h-4 text-emerald-700" />
            <span>التحليل الذكي للمرفقات والمستندات</span>
          </h4>
          <p className="text-[11px] text-stone-600">
            استخراج منظم أو إجابة سؤال من مرفق PDF أو صورة واحدة — بموافقة صريحة ودون حفظ تلقائي.
          </p>
        </div>

        {attachments.length > 0 && (
          <button
            type="button"
            data-testid="doc-ai-open-consent-btn"
            disabled={!isOnline || uiState === 'loading' || !selectedAttachment}
            onClick={handleOpenConsent}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>تحليل المرفق المحدد</span>
          </button>
        )}
      </div>

      {/* Attachment Picker Bar */}
      {attachments.length === 0 ? (
        <div
          data-testid="doc-ai-empty-attachments"
          className="p-3 rounded-xl bg-stone-50 border border-dashed border-stone-200 text-stone-600 text-xs flex items-center gap-2"
        >
          <FileText className="w-4 h-4 text-stone-400 shrink-0" />
          <span>
            ارفع ملف PDF أو صورة (JPEG / PNG / WebP) ضمن قسم المرفقات أعلاه لتتمكن من تحليل محتواه ذكياً.
          </span>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 bg-stone-50/70 p-2.5 rounded-xl border border-stone-200">
          <label
            htmlFor={`doc-ai-select-${meeting.id}`}
            className="text-[11px] font-bold text-stone-700 shrink-0"
          >
            المرفق المختار للتحليل:
          </label>
          <select
            id={`doc-ai-select-${meeting.id}`}
            data-testid="doc-ai-attachment-select"
            value={selectedAttachmentId}
            disabled={uiState === 'loading'}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedAttachmentId(nextId);
              if (result && result.attachmentId !== nextId) {
                clearEphemeralResult();
              }
              setStatusMessage(null);
              const nextAtt = attachments.find((a) => a.id === nextId);
              if (!isOnline) {
                setUiState('offline');
              } else if (nextAtt && !isAttachmentSupportedForDocumentAi(nextAtt).supported) {
                setStatusMessage(
                  isAttachmentSupportedForDocumentAi(nextAtt).reasonArabic ||
                    'المرفق المحدد غير مدعوم للتحليل.'
                );
                setUiState('unsupported_file');
              } else {
                setUiState('idle');
              }
            }}
            className="flex-1 bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-900 min-w-0"
          >
            {attachments.map((att) => (
              <option key={att.id} value={att.id}>
                {att.fileName} ({getDocumentTypeArabicLabel(att.contentType)} ·{' '}
                {formatFileSizeArabic(att.sizeBytes)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Offline State Notice */}
      {(uiState === 'offline' || !isOnline) && (
        <div
          data-testid="doc-ai-offline-notice"
          className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            أنت في وضع عدم الاتصال: يتطلب تحليل المرفقات بالذكاء الاصطناعي اتصالاً نشطاً بالإنترنت
            لجلب الملف من الخادم ومعالجته عبر Google Gemini.
          </span>
        </div>
      )}

      {/* Unsupported File Banner */}
      {((uiState === 'unsupported_file' && statusMessage) ||
        (selectedAttachment && selectedSupport && !selectedSupport.supported)) && (
        <div
          data-testid="doc-ai-unsupported-banner"
          className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            {statusMessage ||
              selectedSupport?.reasonArabic ||
              'هذا المرفق غير مدعوم للتحليل الذكي.'}
          </span>
        </div>
      )}

      {/* Loading State */}
      {uiState === 'loading' && selectedAttachment && (
        <div
          data-testid="doc-ai-loading-card"
          className="p-4 rounded-xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
            <div className="space-y-0.5">
              <div className="font-bold text-stone-900 text-xs">
                جاري تحليل «{selectedAttachment.fileName}» عبر Google Gemini...
              </div>
              <div className="text-[11px] text-stone-500">
                الوضع:{' '}
                {analysisMode === 'question'
                  ? 'إجابة سؤال محدد حول المستند'
                  : 'تحليل شامل للمستند'}{' '}
                · لا يُحفظ أي مخرج قبل اعتمادك الصريح.
              </div>
            </div>
          </div>
          <button
            type="button"
            data-testid="doc-ai-cancel-btn"
            onClick={handleCancelAnalysis}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-800 font-semibold text-xs shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>إلغاء التحليل</span>
          </button>
        </div>
      )}

      {/* Cancelled State */}
      {uiState === 'cancelled' && statusMessage && (
        <div
          data-testid="doc-ai-cancelled-banner"
          className="p-3 rounded-xl bg-stone-100 border border-stone-300 text-stone-800 text-xs flex items-center justify-between gap-2"
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={handleOpenConsent}
            className="px-2.5 py-1 rounded-lg bg-white border border-stone-300 text-stone-800 font-semibold text-[11px] shrink-0"
          >
            إعادة فتح الموافقة
          </button>
        </div>
      )}

      {/* Configuration Error State (server AI or storage unconfigured) */}
      {uiState === 'configuration_error' && statusMessage && (
        <div
          data-testid="doc-ai-config-error-banner"
          className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start justify-between gap-2"
        >
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">خدمة الخادم غير مهيأة حالياً</div>
              <p className="leading-relaxed">{statusMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setStatusMessage(null);
              setUiState(result ? 'success' : 'idle');
            }}
            className="p-1 text-amber-700 hover:text-amber-950"
            aria-label="إغلاق"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* General Error State */}
      {uiState === 'error' && statusMessage && (
        <div
          data-testid="doc-ai-error-banner"
          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{statusMessage}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenConsent}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-[11px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>مراجعة وإعادة المحاولة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusMessage(null);
                setUiState(result ? 'success' : 'idle');
              }}
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
          data-testid="doc-ai-action-banner"
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

      {/* Results Panel (Ephemeral RAM ONLY) */}
      {result && (
        <div data-testid="doc-ai-results-panel" className="space-y-4">
          {/* Ephemeral RAM Disclaimer */}
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-700" />
                <span>نتائج تحليل «{result.fileName}» (في ذاكرة الجلسة فقط)</span>
              </div>
              <p className="text-[11px] text-stone-600">
                هذه النتائج غير محفوظة في المتصفح أو قاعدة البيانات. راجع كل عنصر ثم اعتمد ما يناسبك يدوياً.
              </p>
            </div>
            <button
              type="button"
              data-testid="doc-ai-clear-results-btn"
              onClick={() => {
                clearEphemeralResult();
                setUiState(isOnline ? 'idle' : 'offline');
              }}
              className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-medium text-[11px] shrink-0"
            >
              مسح النتائج
            </button>
          </div>

          {/* Final Minutes Lock Notice */}
          {minutesLocked && (
            <div
              data-testid="doc-ai-final-minutes-banner"
              className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  المحضر مضبوط على حالة <strong>نهائي</strong>: لا يمكن تعديل ملخص المناقشات أو إضافة
                  قرارات أو تعديل موعد المتابعة قبل إعادة فتحه، بينما يظل إنشاء المهام المرتبطة
                  المستقلة متاحاً.
                </span>
              </div>
              <button
                type="button"
                data-testid="doc-ai-reopen-minutes-btn"
                onClick={onRequestReopenMinutes}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-400 text-amber-950 hover:bg-amber-100 font-semibold text-[11px] shrink-0"
              >
                <Unlock className="w-3 h-3" />
                <span>إعادة فتح المحضر</span>
              </button>
            </div>
          )}

          {/* Warnings + Limitations */}
          {(result.warningsArabic.length > 0 || result.limitations.length > 0) && (
            <div
              data-testid="doc-ai-limitations-card"
              className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 text-[11px] space-y-1.5"
            >
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>قيود القراءة وتنبيهات الدقة:</span>
              </div>
              {result.warningsArabic.map((w, idx) => (
                <div key={`warn-${idx}`} className="pr-5">
                  • {w}
                </div>
              ))}
              {result.limitations.map((lim, idx) => (
                <div key={`lim-${idx}`} className="pr-5">
                  • {lim}
                </div>
              ))}
            </div>
          )}

          {/* QUESTION MODE RESULT */}
          {result.analysisMode === 'question' && result.questionAnswer && (
            <div
              data-testid="doc-ai-question-result-card"
              className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap pb-2 border-b border-stone-100">
                <div className="space-y-0.5">
                  <div className="text-[11px] text-stone-500 font-semibold flex items-center gap-1">
                    <MessageSquareText className="w-3.5 h-3.5 text-emerald-700" />
                    <span>السؤال المطروح حول المستند:</span>
                  </div>
                  <p className="text-xs font-bold text-stone-900">
                    {result.questionAnswer.question}
                  </p>
                </div>

                {result.questionAnswer.insufficientInformation && (
                  <span
                    data-testid="doc-ai-insufficient-answer-badge"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-semibold"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>المعلومات غير كافية في المستند</span>
                  </span>
                )}
              </div>

              <div className="space-y-2 text-xs text-stone-800">
                <div className="font-semibold text-stone-600 text-[11px]">الإجابة المستخلصة:</div>
                {isEditingSummary ? (
                  <textarea
                    rows={5}
                    data-testid="doc-ai-question-answer-textarea"
                    value={summaryDraftText}
                    onChange={(e) => setSummaryDraftText(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-xs text-stone-800 leading-relaxed"
                  />
                ) : (
                  <p className="leading-relaxed whitespace-pre-line">{result.questionAnswer.answer}</p>
                )}
              </div>

              {result.questionAnswer.supportingEvidence.length > 0 && (
                <div className="bg-stone-50 rounded-xl p-2.5 border border-stone-200 space-y-1">
                  <div className="text-[11px] font-bold text-stone-700">
                    مقتطفات مرجعية مقترحة من المستند (تحتاج إلى مراجعة المصدر):
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-stone-700">
                    {result.questionAnswer.supportingEvidence.map((ev, i) => (
                      <li key={i}>{ev}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsEditingSummary((v) => !v)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-[11px] font-medium"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditingSummary ? 'معاينة' : 'تعديل قبل الإضافة'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="doc-ai-append-qa-summary-btn"
                    disabled={minutesLocked || summaryState === 'approved'}
                    onClick={() => void handleApplySummary('append')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                  >
                    <Check className="w-3 h-3" />
                    <span>
                      {summaryState === 'approved'
                        ? 'تمت الإضافة للمناقشات'
                        : 'إضافة الإجابة إلى ملخص المناقشات'}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="doc-ai-ask-another-btn"
                  disabled={!isOnline}
                  onClick={() => {
                    setAnalysisMode('question');
                    setQuestionInput('');
                    handleOpenConsent();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 text-[11px] font-semibold disabled:opacity-50"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span>طرح سؤال مستقل آخر</span>
                </button>
              </div>
            </div>
          )}

          {/* COMPREHENSIVE MODE RESULT */}
          {result.analysisMode === 'comprehensive' && result.summary && (
            <>
              {/* 1. Document Summary & Key Points */}
              <div
                data-testid="doc-ai-section-summary"
                className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-stone-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-heading font-bold text-xs text-stone-900">
                      1. ملخص المستند وأبرز النقاط
                    </span>
                    {result.summary.documentTypeLabel && (
                      <span className="px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-stone-700 text-[10px] font-semibold">
                        {result.summary.documentTypeLabel}
                      </span>
                    )}
                    {result.summary.insufficientInfo && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        <span>معلومات محدودة في المستند</span>
                      </span>
                    )}
                    {summaryState === 'approved' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-semibold">
                        <Check className="w-3 h-3" />
                        <span>تم اعتماده في المناقشات</span>
                      </span>
                    )}
                    {summaryState === 'ignored' && (
                      <span className="text-[10px] text-stone-500">تم تجاهل الملخص</span>
                    )}
                  </div>

                  {summaryState !== 'ignored' && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsEditingSummary((v) => !v)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 text-[11px] font-medium"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>{isEditingSummary ? 'معاينة' : 'تعديل قبل الحفظ'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmReplaceSummaryOpen(false);
                          setSummaryState('ignored');
                        }}
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
                        data-testid="doc-ai-summary-edit-textarea"
                        value={summaryDraftText}
                        onChange={(e) => setSummaryDraftText(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-xs text-stone-800 leading-relaxed"
                      />
                    ) : (
                      <div className="space-y-2 text-xs text-stone-800">
                        {result.summary.mainSubject && (
                          <div className="text-[11px] text-stone-600">
                            <span className="font-semibold">الموضوع الرئيسي:</span>{' '}
                            {result.summary.mainSubject}
                          </div>
                        )}
                        <p className="leading-relaxed">{result.summary.overview}</p>
                        {result.keyPoints.length > 0 && (
                          <div>
                            <span className="font-semibold text-stone-600 text-[11px] block">
                              أبرز النقاط المستخرجة:
                            </span>
                            <ul className="list-disc list-inside space-y-0.5 mt-0.5 text-stone-700">
                              {result.keyPoints.map((pt, i) => (
                                <li key={i}>{pt}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Explicit Confirmation Step before Replacing existing Discussion Summary */}
                    {confirmReplaceSummaryOpen && (
                      <div
                        data-testid="doc-ai-replace-confirm-box"
                        className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <span>
                          سيتم استبدال نص «ملخص المناقشات» الحالي بهذا الملخص (تبقى الملاحظات
                          السابقة محفوظة كما هي). هل تؤكد الاستبدال؟
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmReplaceSummaryOpen(false)}
                            className="px-2.5 py-1 rounded-lg bg-white border border-stone-300 text-stone-700 font-medium"
                          >
                            إلغاء
                          </button>
                          <button
                            type="button"
                            data-testid="doc-ai-confirm-replace-btn"
                            onClick={() => void handleApplySummary('replace')}
                            className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold"
                          >
                            نعم، استبدل الملخص
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        data-testid="doc-ai-apply-summary-append-btn"
                        disabled={minutesLocked}
                        onClick={() => void handleApplySummary('append')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        <span>إضافة إلى ملخص المناقشات</span>
                      </button>
                      <button
                        type="button"
                        data-testid="doc-ai-apply-summary-replace-btn"
                        disabled={minutesLocked}
                        onClick={() => {
                          if ((meeting.discussionSummary || '').trim()) {
                            setConfirmReplaceSummaryOpen(true);
                          } else {
                            void handleApplySummary('replace');
                          }
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-semibold text-[11px] disabled:opacity-50"
                      >
                        <span>استبدال الملخص الحالي</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* 2. Extracted Decisions */}
              <div
                data-testid="doc-ai-section-decisions"
                className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                  <span className="font-heading font-bold text-xs text-stone-900 tabular-nums">
                    2. القرارات والالتزامات المقترحة ({result.decisions.length})
                  </span>
                  <span className="text-[11px] text-stone-500">
                    يتطلب كل قرار اعتمادك قبل إضافته للمحضر
                  </span>
                </div>

                {result.decisions.length === 0 ? (
                  <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                    لم تظهر قرارات صريحة في هذا المرفق.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {result.decisions.map((dec) => {
                      const st = decisionStates[dec.id] || 'pending';
                      const draft = decisionDrafts[dec.id] || {
                        text: dec.text,
                        ownerName: dec.ownerName || '',
                        agendaItemId: '',
                      };
                      const errMsg = decisionErrors[dec.id];

                      return (
                        <div
                          key={dec.id}
                          data-testid={`doc-ai-decision-card-${dec.id}`}
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
                              <button
                                type="button"
                                onClick={() => setEditingDecisionId(null)}
                                className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold"
                              >
                                إنهاء التعديل
                              </button>
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
                                  {dec.confidence === 'explicit'
                                    ? 'قرار صريح في المستند'
                                    : 'يحتاج لتأكيد بشري'}
                                </span>
                              </div>

                              {(draft.ownerName || dec.sourceEvidence) && (
                                <div className="flex items-center gap-3 text-[11px] text-stone-600 flex-wrap">
                                  {draft.ownerName && <span>المسؤول: {draft.ownerName}</span>}
                                  {dec.sourceEvidence && (
                                    <span className="text-stone-500">
                                      مقتطف مرجعي مقترح: «{dec.sourceEvidence}» (يحتاج إلى مراجعة المصدر)
                                    </span>
                                  )}
                                </div>
                              )}

                              {errMsg && (
                                <p className="text-[11px] text-rose-700 font-medium">{errMsg}</p>
                              )}

                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                {st === 'approved' ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>تمت إضافته لقرارات المحضر</span>
                                  </span>
                                ) : st === 'ignored' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDecisionStates((prev) => ({
                                        ...prev,
                                        [dec.id]: 'pending',
                                      }))
                                    }
                                    className="text-[11px] text-stone-700 underline"
                                  >
                                    استعادة للمراجعة
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      data-testid={`doc-ai-approve-decision-${dec.id}`}
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
                                        setDecisionStates((prev) => ({
                                          ...prev,
                                          [dec.id]: 'ignored',
                                        }))
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

              {/* 3. Suggested Tasks */}
              <div
                data-testid="doc-ai-section-tasks"
                className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-stone-100">
                  <div>
                    <span className="font-heading font-bold text-xs text-stone-900 tabular-nums">
                      3. المهام المقترحة من المستند ({result.suggestedTasks.length})
                    </span>
                    <p className="text-[11px] text-stone-500">
                      لا تُنشأ أي مهمة إلا بعد تأكيدك، مع فحص التكرار قبل الحفظ.
                    </p>
                  </div>

                  {pendingTaskCount > 0 && (
                    <button
                      type="button"
                      data-testid="doc-ai-batch-approve-tasks-btn"
                      disabled={isBatchApprovingTasks}
                      onClick={() => void handleBatchApproveSelectedTasks()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] disabled:opacity-50 shrink-0"
                    >
                      {isBatchApprovingTasks ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>اعتماد المهام المحددة</span>
                    </button>
                  )}
                </div>

                {batchTaskNotice && (
                  <div
                    data-testid="doc-ai-batch-task-notice"
                    className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-800"
                  >
                    {batchTaskNotice}
                  </div>
                )}

                {result.suggestedTasks.length === 0 ? (
                  <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                    لم تظهر مهام قابلة للتنفيذ في هذا المستند.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {result.suggestedTasks.map((item) => {
                      const st = taskStates[item.id] || 'pending';
                      const draft = taskDrafts[item.id] || {
                        title: item.title,
                        description: item.description || '',
                        ownerName: item.ownerName || '',
                        dueDate: item.dueDate || '',
                        priority: item.priority,
                      };
                      const duplicateMatch =
                        st !== 'approved'
                          ? findDuplicateMeetingTask(tasks, {
                              meetingId: meeting.id,
                              title: draft.title,
                            })
                          : undefined;
                      const errMsg = taskErrors[item.id];

                      return (
                        <div
                          key={item.id}
                          data-testid={`doc-ai-task-card-${item.id}`}
                          className={`p-3 rounded-xl border space-y-2 ${
                            st === 'approved'
                              ? 'bg-emerald-50/40 border-emerald-200'
                              : st === 'save_failed'
                              ? 'bg-rose-50/40 border-rose-200'
                              : st === 'ignored'
                              ? 'bg-stone-50 border-stone-200 opacity-60'
                              : 'bg-stone-50/50 border-stone-200'
                          }`}
                        >
                          {editingTaskId === item.id ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={draft.title}
                                onChange={(e) =>
                                  setTaskDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...draft, title: e.target.value },
                                  }))
                                }
                                className="w-full bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                              />
                              <textarea
                                rows={2}
                                value={draft.description}
                                onChange={(e) =>
                                  setTaskDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...draft, description: e.target.value },
                                  }))
                                }
                                placeholder="تفاصيل المهمة..."
                                className="w-full bg-white border border-stone-300 rounded-lg p-2 text-xs"
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
                                  placeholder="المسؤول المقترح..."
                                  className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
                                />
                                <input
                                  type="date"
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
                              <button
                                type="button"
                                onClick={() => setEditingTaskId(null)}
                                className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold"
                              >
                                إنهاء التعديل
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
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
                                      className="mt-1 rounded border-stone-300 text-emerald-700"
                                    />
                                  )}
                                  <div className="min-w-0 space-y-0.5">
                                    <div className="font-bold text-stone-900 text-xs">
                                      {draft.title}
                                    </div>
                                    {draft.description && (
                                      <p className="text-[11px] text-stone-600 leading-relaxed">
                                        {draft.description}
                                      </p>
                                    )}
                                  </div>
                                </label>
                                <span className="px-2 py-0.5 rounded-md border border-stone-200 bg-white text-[10px] font-semibold text-stone-700 shrink-0">
                                  {draft.priority === 'urgent'
                                    ? 'عاجلة'
                                    : draft.priority === 'high'
                                    ? 'عالية'
                                    : draft.priority === 'low'
                                    ? 'منخفضة'
                                    : 'متوسطة'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                {draft.ownerName ? (
                                  <span className="text-stone-700">
                                    المسؤول: {draft.ownerName}
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px]">
                                    يحتاج تأكيد المسؤول
                                  </span>
                                )}
                                {draft.dueDate && isValidIsoDateOnly(draft.dueDate) ? (
                                  <span className="text-stone-700 tabular-nums">
                                    الاستحقاق: {draft.dueDate}
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px]">
                                    يحتاج تأكيد موعد الاستحقاق
                                  </span>
                                )}
                                {duplicateMatch && (
                                  <span
                                    data-testid={`doc-ai-duplicate-task-badge-${item.id}`}
                                    className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[10px] font-semibold"
                                  >
                                    توجد مهمة مطابقة مسجلة مسبقاً في هذا اللقاء
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
                                    <span>تم إنشاؤها وربطها باللقاء</span>
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
                                      data-testid={`doc-ai-approve-task-${item.id}`}
                                      disabled={Boolean(duplicateMatch)}
                                      onClick={() => void handleApproveSingleTask(item)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] disabled:opacity-50"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>
                                        {st === 'save_failed'
                                          ? 'إعادة المحاولة'
                                          : 'اعتماد المهمة'}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingTaskId(item.id)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-700 text-[11px]"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                      <span>تعديل</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTaskStates((prev) => ({
                                          ...prev,
                                          [item.id]: 'ignored',
                                        }))
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

              {/* 4. Important Dates */}
              <div
                data-testid="doc-ai-section-dates"
                className="rounded-xl border border-stone-200 p-3.5 space-y-3 bg-white"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                  <span className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>4. التواريخ والمواعيد المهمة ({result.importantDates.length})</span>
                  </span>
                  <span className="text-[11px] text-stone-500">
                    للعرض فقط ما لم تعتمد تاريخاً كموعد متابعة
                  </span>
                </div>

                {result.importantDates.length === 0 ? (
                  <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                    لم تُذكر تواريخ أو مواعيد محددة في المستند.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {result.importantDates.map((dt) => {
                      const st = dateStates[dt.id] || 'pending';
                      const draftIso = dateDraftIso[dt.id] ?? dt.dateIso ?? '';
                      const errMsg = dateErrors[dt.id];

                      return (
                        <div
                          key={dt.id}
                          data-testid={`doc-ai-date-card-${dt.id}`}
                          className={`p-3 rounded-xl border space-y-2 ${
                            st === 'approved'
                              ? 'bg-emerald-50/40 border-emerald-200'
                              : 'bg-stone-50/50 border-stone-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="space-y-0.5">
                              <div className="font-bold text-stone-900 text-xs">{dt.label}</div>
                              {dt.rawDateText && (
                                <div className="text-[11px] text-stone-600">
                                  النص الوارد: «{dt.rawDateText}»
                                </div>
                              )}
                              {dt.sourceEvidence && (
                                <div className="text-[11px] text-stone-500">
                                  مقتطف مرجعي مقترح: «{dt.sourceEvidence}» (يحتاج إلى مراجعة المصدر)
                                </div>
                              )}
                            </div>
                            {dt.needsDateConfirmation && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-semibold">
                                يحتاج تأكيد التاريخ
                              </span>
                            )}
                          </div>

                          {errMsg && (
                            <p className="text-[11px] text-rose-700 font-medium">{errMsg}</p>
                          )}

                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              type="date"
                              value={draftIso}
                              disabled={minutesLocked || st === 'approved'}
                              onChange={(e) =>
                                setDateDraftIso((prev) => ({
                                  ...prev,
                                  [dt.id]: e.target.value,
                                }))
                              }
                              className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs tabular-nums"
                            />
                            {st === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                                <Check className="w-3.5 h-3.5" />
                                <span>تم اعتماده كموعد متابعة للقاء</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                data-testid={`doc-ai-adopt-date-${dt.id}`}
                                disabled={minutesLocked || !isValidIsoDateOnly(draftIso)}
                                onClick={() => void handleAdoptImportantDateAsFollowUp(dt)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] disabled:opacity-50"
                              >
                                <Calendar className="w-3 h-3" />
                                <span>اعتماد كموعد متابعة</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 5. Open Questions / Risks (Display-Only — NO auto tasks) */}
              <div
                data-testid="doc-ai-section-open-questions"
                className="rounded-xl border border-stone-200 p-3.5 space-y-2.5 bg-white"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                  <span className="font-heading font-bold text-xs text-stone-900">
                    5. الأسئلة المفتوحة والمخاطر ({result.openQuestions.length})
                  </span>
                  <span className="text-[11px] text-stone-500">
                    للمراجعة والتنبيه فقط — لا تتحول تلقائياً لمهام
                  </span>
                </div>

                {result.openQuestions.length === 0 ? (
                  <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-dashed border-stone-200">
                    لم تُرصد نقاط غامضة أو أسئلة مفتوحة في المستند.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {result.openQuestions.map((oq) => {
                      const dismissed = Boolean(dismissedOpenIds[oq.id]);
                      return (
                        <div
                          key={oq.id}
                          className={`p-2.5 rounded-xl border border-stone-200 flex items-start justify-between gap-2 text-xs ${
                            dismissed ? 'opacity-50 bg-stone-50' : 'bg-stone-50/60'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-stone-200 text-stone-700">
                              {oq.category === 'risk'
                                ? 'مخاطرة محتملة'
                                : oq.category === 'ambiguity'
                                ? 'نقطة غامضة'
                                : 'سؤال مفتوح'}
                            </span>
                            <p className="text-stone-800 leading-relaxed">{oq.text}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDismissedOpenIds((prev) => ({
                                ...prev,
                                [oq.id]: !dismissed,
                              }))
                            }
                            className="text-[11px] text-stone-600 hover:text-stone-900 shrink-0 underline"
                          >
                            {dismissed ? 'استعادة' : 'تجاهل'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* EXPLICIT CONSENT MODAL */}
      {uiState === 'consent' && selectedAttachment && (
        <div
          data-testid="doc-ai-consent-modal"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 border border-stone-200 space-y-4">
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2 text-emerald-800">
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <h4 className="font-heading font-bold text-sm text-stone-900">
                  الموافقة على تحليل المرفق بالذكاء الاصطناعي
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setUiState(result ? 'success' : 'idle')}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
                aria-label="إغلاق نافذة الموافقة"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected Attachment Summary */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white border border-stone-200 flex items-center justify-center shrink-0 text-emerald-700">
                {isImageMimeType(selectedAttachment.contentType) ? (
                  <ImageIcon className="w-5 h-5" />
                ) : (
                  <FileText className="w-5 h-5 text-rose-700" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                <div className="font-bold text-stone-900 truncate">
                  {selectedAttachment.fileName}
                </div>
                <div className="text-[11px] text-stone-600 flex items-center gap-2 flex-wrap">
                  <span>{getDocumentTypeArabicLabel(selectedAttachment.contentType)}</span>
                  <span>•</span>
                  <span>{formatFileSizeArabic(selectedAttachment.sizeBytes)}</span>
                  <span>•</span>
                  <span className="truncate">اللقاء: {meeting.title}</span>
                </div>
              </div>
            </div>

            {/* Analysis Mode Selector */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-stone-800">اختر نوع التحليل:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  className={`p-2.5 rounded-xl border cursor-pointer flex items-start gap-2 text-xs transition-colors ${
                    analysisMode === 'comprehensive'
                      ? 'border-emerald-600 bg-emerald-50/60 text-stone-900'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`doc-ai-mode-${meeting.id}`}
                    value="comprehensive"
                    checked={analysisMode === 'comprehensive'}
                    onChange={() => {
                      setAnalysisMode('comprehensive');
                      setQuestionValidationError(null);
                    }}
                    className="mt-0.5 text-emerald-700"
                  />
                  <div>
                    <div className="font-bold">تحليل شامل للمستند</div>
                    <div className="text-[11px] text-stone-600">
                      ملخص، قرارات، مهام، مواعيد، ونقاط مفتوحة.
                    </div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded-xl border cursor-pointer flex items-start gap-2 text-xs transition-colors ${
                    analysisMode === 'question'
                      ? 'border-emerald-600 bg-emerald-50/60 text-stone-900'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`doc-ai-mode-${meeting.id}`}
                    value="question"
                    checked={analysisMode === 'question'}
                    onChange={() => setAnalysisMode('question')}
                    className="mt-0.5 text-emerald-700"
                  />
                  <div>
                    <div className="font-bold">طرح سؤال محدد</div>
                    <div className="text-[11px] text-stone-600">
                      إجابة مباشرة مدعومة بالشواهد من المستند.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Single-turn question textarea */}
            {analysisMode === 'question' && (
              <div className="space-y-1.5">
                <label
                  htmlFor={`doc-ai-question-${meeting.id}`}
                  className="text-xs font-bold text-stone-800 block"
                >
                  سؤالك حول هذا المستند (طلب مستقل لمرة واحدة):
                </label>
                <textarea
                  id={`doc-ai-question-${meeting.id}`}
                  data-testid="doc-ai-question-input"
                  rows={3}
                  maxLength={DOCUMENT_AI_MAX_QUESTION_CHARS}
                  value={questionInput}
                  onChange={(e) => {
                    setQuestionInput(e.target.value);
                    setQuestionValidationError(null);
                  }}
                  placeholder="مثال: ما هي شروط الدفع أو مواعيد التسليم المذكورة في هذا المستند؟"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl p-2.5 text-xs text-stone-900 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
                {questionValidationError && (
                  <p className="text-[11px] text-rose-700 font-medium">{questionValidationError}</p>
                )}
              </div>
            )}

            {/* Privacy & AI Review Disclosures */}
            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 text-[11px] space-y-1.5 leading-relaxed">
              <div className="font-bold text-xs">إقرار الخصوصية والمراجعة البشرية:</div>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  سيُرسل محتوى هذا المرفق المحدد فقط (مع سؤالك عند اختيار وضع السؤال) من خادم
                  التطبيق إلى Google Gemini لمعالجته.
                </li>
                <li>
                  لن يتم إرسال أي مرفقات أخرى أو ملفات لقاءات أخرى، ولن تُرسل روابط تحميل خاصة من
                  المتصفح.
                </li>
                <li>
                  قد يخطئ الذكاء الاصطناعي أو يغفل تفاصيل؛ لذا لا يُحفظ أي ملخص أو قرار أو مهمة في
                  بياناتك تلقائياً قبل مراجعتك واعتمادك.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                data-testid="doc-ai-consent-cancel-btn"
                onClick={() => setUiState(result ? 'success' : 'idle')}
                className="px-3.5 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="doc-ai-consent-confirm-btn"
                onClick={() => void handleConfirmAndAnalyze()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-2xs"
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
