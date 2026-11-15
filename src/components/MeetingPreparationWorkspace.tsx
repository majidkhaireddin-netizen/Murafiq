import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActionItem,
  AiBriefingSectionInclusionKey,
  AiBriefingSectionSelection,
  Client,
  CommunicationInteraction,
  Meeting,
  MeetingAiBriefingResult,
  MeetingGoalStatus,
  Note,
  Opportunity,
  OpportunityStageEvent,
  PreparationCollectionsLoadedState,
  SuggestedDiscussionTopic,
} from '../types/index.ts';
import {
  addPreparationGoal,
  AI_BRIEFING_BASIS_META,
  AI_BRIEFING_SECTION_LABELS,
  approveAiSuggestedGoalToPreparation,
  approveAiTalkingPointToAgenda,
  approveSuggestedTopicIntoAgenda,
  buildMeetingAiBriefingInputBundle,
  buildMeetingPreparationBrief,
  DEFAULT_AI_BRIEFING_SECTION_SELECTION,
  dismissSuggestedTopicInMeeting,
  EMPTY_INTERACTIONS_MESSAGE_AR,
  isConfirmedInteraction,
  MEETING_GOAL_STATUS_META,
  MEETING_GOAL_STATUS_ORDER,
  removePreparationGoal,
  reorderPreparationGoals,
  updatePreparationGoal,
  updatePreparationNotes,
} from '../utils/meetingPreparation.ts';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOME_META,
} from '../utils/communications.ts';
import {
  formatOpportunityValue,
  OPPORTUNITY_STAGE_CONFIG,
} from '../utils/opportunities.ts';
import { formatArabicDate, getHijriDateString } from '../utils/logic.ts';
import {
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  normalizeTaskTitle,
} from '../utils/meetingMinutes.ts';
import { requestMeetingAiBriefing } from '../services/meetingAi.ts';
import { MeetingPreparationPrintModal } from './MeetingPreparationPrintModal.tsx';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Edit2,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  Lock,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  User,
  WifiOff,
  X,
} from 'lucide-react';

export interface MeetingPreparationWorkspaceProps {
  meeting: Meeting;
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes?: Note[];
  opportunities?: Opportunity[];
  opportunityStageEvents?: OpportunityStageEvent[];
  interactions?: CommunicationInteraction[];
  currentUserId?: string;
  isOnline?: boolean;
  collectionsLoaded?: Partial<PreparationCollectionsLoadedState>;
  hasPendingWrites?: boolean;
  onSaveMeeting: (updated: Meeting) => Promise<void> | void;
  onSelectClient?: (clientId: string) => void;
  onSelectMeeting?: (meetingId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onOpenTask?: (taskId: string) => void;
  onSwitchWorkspaceTab?: (tab: 'overview' | 'preparation' | 'agenda' | 'discussions' | 'decisions' | 'tasks' | 'minutes' | 'ai') => void;
  language?: 'ar' | 'en';
}

export const MeetingPreparationWorkspace: React.FC<MeetingPreparationWorkspaceProps> = ({
  meeting,
  clients,
  meetings,
  tasks,
  notes = [],
  opportunities = [],
  opportunityStageEvents = [],
  interactions = [],
  currentUserId,
  isOnline = true,
  collectionsLoaded,
  hasPendingWrites = false,
  onSaveMeeting,
  onSelectClient,
  onSelectMeeting,
  onOpenOpportunity,
  onOpenTask,
  onSwitchWorkspaceTab,
  language = 'ar',
}) => {
  // Deterministic Preparation Brief (Level A)
  const brief = useMemo(
    () =>
      buildMeetingPreparationBrief({
        meeting,
        clients,
        meetings,
        tasks,
        notes,
        opportunities,
        opportunityStageEvents,
        interactions,
        currentUserId,
        isOnline,
        collectionsLoaded,
        hasPendingWrites,
      }),
    [
      meeting,
      clients,
      meetings,
      tasks,
      notes,
      opportunities,
      opportunityStageEvents,
      interactions,
      currentUserId,
      isOnline,
      collectionsLoaded,
      hasPendingWrites,
    ]
  );

  // Feedback banner state
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const showBanner = (type: 'success' | 'error' | 'info', text: string) => {
    setFeedbackBanner({ type, text });
  };

  // Print Modal state
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Suggested Topics inline editing state
  const [editingTopicKey, setEditingTopicKey] = useState<string | null>(null);
  const [editingTopicTitle, setEditingTopicTitle] = useState('');
  const [editingTopicNotes, setEditingTopicNotes] = useState('');
  const [showDismissedTopics, setShowDismissedTopics] = useState(false);

  // Preparation Goals state
  const [newGoalText, setNewGoalText] = useState('');
  const [newGoalNote, setNewGoalNote] = useState('');
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editGoalText, setEditGoalText] = useState('');
  const [editGoalNote, setEditGoalNote] = useState('');
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);

  // General Preparation Notes state
  const [prepNotesDraft, setPrepNotesDraft] = useState(brief.preparationNotes);
  const [isPrepNotesDirty, setIsPrepNotesDirty] = useState(false);

  useEffect(() => {
    setPrepNotesDraft(brief.preparationNotes);
    setIsPrepNotesDirty(false);
  }, [meeting.id, brief.preparationNotes]);

  // AI Advanced Briefing (Level B) session-only state (reset when switching meetings)
  const [isAiConsentModalOpen, setIsAiConsentModalOpen] = useState(false);
  const [aiSectionSelection, setAiSectionSelection] = useState<AiBriefingSectionSelection>(
    DEFAULT_AI_BRIEFING_SECTION_SELECTION
  );
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<MeetingAiBriefingResult | null>(null);
  const [editingAiPointId, setEditingAiPointId] = useState<string | null>(null);
  const [editingAiPointTitle, setEditingAiPointTitle] = useState('');
  const [editingAiOutcomeId, setEditingAiOutcomeId] = useState<string | null>(null);
  const [editingAiOutcomeText, setEditingAiOutcomeText] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAiLoading(false);
    setAiError(null);
    setAiResult(null);
    setIsAiConsentModalOpen(false);
    setEditingTopicKey(null);
    setEditingGoalId(null);
    setDeletingGoalId(null);
  }, [meeting.id]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const aiConsentBundle = useMemo(
    () => buildMeetingAiBriefingInputBundle(brief, aiSectionSelection),
    [brief, aiSectionSelection]
  );

  // =========================================================================
  // Handlers: Suggested Topics -> Agenda
  // =========================================================================
  const handleAddSuggestedTopicToAgenda = async (
    topic: SuggestedDiscussionTopic,
    customTitle?: string,
    customNotes?: string
  ) => {
    const titleToUse = customTitle !== undefined ? customTitle : topic.title;
    const notesToUse = customNotes !== undefined ? customNotes : topic.reasonAr;

    const result = approveSuggestedTopicIntoAgenda(meeting, {
      title: titleToUse,
      notes: notesToUse,
    });

    if (!result.ok) {
      showBanner('error', result.reasonArabic);
      return;
    }

    await onSaveMeeting(result.meeting);
    setEditingTopicKey(null);
    showBanner('success', `تمت إضافة «${result.addedItem.title}» إلى جدول أعمال الاجتماع.`);
  };

  const handleDismissSuggestedTopic = async (topicKey: string) => {
    const updated = dismissSuggestedTopicInMeeting(meeting, topicKey);
    await onSaveMeeting(updated);
    showBanner('info', 'تم إخفاء الموضوع المقترح من القائمة النشطة.');
  };

  const handleOpenTopicSource = (topic: SuggestedDiscussionTopic) => {
    if (topic.sourceType === 'overdue_task' || topic.sourceType === 'due_today_task') {
      if (onOpenTask) onOpenTask(topic.sourceId);
      return;
    }
    if (topic.sourceType === 'opportunity_next_action') {
      if (onOpenOpportunity) onOpenOpportunity(topic.sourceId);
      return;
    }
    if (topic.sourceType === 'previous_meeting_follow_up' || topic.sourceType === 'previous_decision') {
      if (onSelectMeeting) onSelectMeeting(topic.sourceId);
      return;
    }
    if (topic.sourceType === 'interaction_follow_up') {
      if (onSelectClient && brief.client) onSelectClient(brief.client.id);
    }
  };

  const handleAddTaskToAgenda = async (task: ActionItem) => {
    const result = approveSuggestedTopicIntoAgenda(meeting, {
      title: `متابعة المهمة: ${task.title}`,
      notes: task.dueDate ? `تاريخ الاستحقاق: ${task.dueDate}` : undefined,
    });
    if (!result.ok) {
      showBanner('error', result.reasonArabic);
      return;
    }
    await onSaveMeeting(result.meeting);
    showBanner('success', `تمت إضافة المهمة «${task.title}» إلى جدول الأعمال.`);
  };

  // =========================================================================
  // Handlers: Preparation Goals & Notes
  // =========================================================================
  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = addPreparationGoal(meeting, {
      text: newGoalText,
      note: newGoalNote,
    });
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setNewGoalText('');
    setNewGoalNote('');
    showBanner('success', 'تمت إضافة هدف الاجتماع بنجاح.');
  };

  const handleGoalStatusChange = async (goalId: string, nextStatus: MeetingGoalStatus) => {
    const res = updatePreparationGoal(meeting, goalId, { status: nextStatus });
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    showBanner(
      'success',
      `تم تحديث حالة الهدف إلى «${MEETING_GOAL_STATUS_META[nextStatus].labelAr}».`
    );
  };

  const handleSaveEditedGoal = async (goalId: string) => {
    const res = updatePreparationGoal(meeting, goalId, {
      text: editGoalText,
      note: editGoalNote,
    });
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setEditingGoalId(null);
    showBanner('success', 'تم حفظ تعديلات الهدف.');
  };

  const handleConfirmDeleteGoal = async (goalId: string) => {
    const res = removePreparationGoal(meeting, goalId);
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setDeletingGoalId(null);
    showBanner('info', 'تم حذف الهدف من تحضير الاجتماع.');
  };

  const handleReorderGoal = async (goalId: string, direction: 'up' | 'down') => {
    const res = reorderPreparationGoals(meeting, goalId, direction);
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
  };

  const handleSavePrepNotes = async () => {
    const res = updatePreparationNotes(meeting, prepNotesDraft);
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setIsPrepNotesDirty(false);
    showBanner('success', 'تم حفظ ملاحظات التحضير للاجتماع.');
  };

  // =========================================================================
  // Handlers: AI Advanced Briefing (Level B)
  // =========================================================================
  const toggleAiSection = (key: AiBriefingSectionInclusionKey) => {
    setAiSectionSelection((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleStartAiBriefing = async () => {
    setIsAiConsentModalOpen(false);
    setAiError(null);
    setIsAiLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await requestMeetingAiBriefing({
        brief,
        includedSections: aiSectionSelection,
        signal: controller.signal,
      });
      setAiResult(result);
    } catch (err: any) {
      if (err?.code === 'AI_ABORTED') {
        setAiError('تم إلغاء طلب التحضير الذكي المتقدم بناءً على رغبتك.');
      } else {
        setAiError(
          err?.message ||
            'تعذر إتمام التحضير المتقدم عبر الذكاء الاصطناعي حاليًا. يظل التحضير الذكي المباشر متاحًا بالكامل.'
        );
      }
    } finally {
      setIsAiLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelAiBriefing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAiLoading(false);
  };

  const handleApproveAiPointToAgenda = async (title: string, rationale?: string) => {
    const res = approveAiTalkingPointToAgenda(meeting, { title, rationale });
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setEditingAiPointId(null);
    showBanner('success', `تم اعتماد نقطة النقاش «${res.addedItem.title}» في جدول الأعمال.`);
  };

  const handleApproveAiOutcomeToGoals = async (text: string, note?: string) => {
    const res = approveAiSuggestedGoalToPreparation(meeting, { text, note });
    if (!res.ok) {
      showBanner('error', res.reasonArabic);
      return;
    }
    await onSaveMeeting(res.meeting);
    setEditingAiOutcomeId(null);
    showBanner('success', `تم اعتماد الهدف «${res.goal.text}» ضمن أهداف الاجتماع.`);
  };

  const activeSuggestedTopics = brief.suggestedTopics.filter(
    (t) => showDismissedTopics || !t.isDismissed
  );

  const existingAgendaNormSet = useMemo(
    () => new Set((meeting.agendaItems || []).map((a) => normalizeTaskTitle(a.title))),
    [meeting.agendaItems]
  );

  const existingGoalNormSet = useMemo(
    () => new Set(brief.goals.map((g) => normalizeTaskTitle(g.text))),
    [brief.goals]
  );

  return (
    <div data-testid="meeting-preparation-workspace" className="space-y-4">
      {/* 1. Top Preparation Header & Quick Navigation Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs font-bold">
                <Target className="w-3.5 h-3.5 text-emerald-700" />
                <span>ملف التحضير الذكي للاجتماع</span>
              </span>

              <span className="text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200 font-medium">
                حالة الاجتماع: {MEETING_STATUS_LABELS[meeting.status]?.ar || meeting.status}
              </span>

              <span className="text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200 font-medium">
                المحضر: {brief.minutesStatusLabelAr}
              </span>
            </div>

            <h3 className="font-heading font-bold text-base text-stone-950">
              {meeting.title}
            </h3>

            <p className="text-xs text-stone-600 flex items-center gap-2 flex-wrap">
              <span>{formatArabicDate(meeting.dateTime, true)}</span>
              <span>•</span>
              <span>{getHijriDateString(meeting.dateTime)}</span>
              <span>•</span>
              <span>{MEETING_TYPE_LABELS[meeting.type]?.ar || meeting.type}</span>
              {meeting.location ? (
                <>
                  <span>•</span>
                  <span>{meeting.location}</span>
                </>
              ) : null}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {brief.client && onSelectClient && (
              <button
                type="button"
                data-testid="prep-open-client-btn"
                onClick={() => onSelectClient(brief.client!.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 text-stone-800 hover:bg-stone-200 transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-stone-600" />
                <span>ملف العميل</span>
              </button>
            )}

            {brief.opportunitiesContext.linkedOpportunity && onOpenOpportunity && (
              <button
                type="button"
                data-testid="prep-open-opportunity-btn"
                onClick={() => onOpenOpportunity(brief.opportunitiesContext.linkedOpportunity!.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100 transition-colors"
              >
                <Briefcase className="w-3.5 h-3.5 text-emerald-700" />
                <span>الفرصة المرتبطة</span>
              </button>
            )}

            {onSwitchWorkspaceTab && (
              <button
                type="button"
                data-testid="prep-go-agenda-btn"
                onClick={() => onSwitchWorkspaceTab('agenda')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                <ListChecks className="w-3.5 h-3.5 text-stone-600" />
                <span>جدول الأعمال ({(meeting.agendaItems || []).length})</span>
              </button>
            )}

            <button
              type="button"
              data-testid="prep-open-print-modal-btn"
              onClick={() => setIsPrintModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة / PDF التحضير</span>
            </button>
          </div>
        </div>

        {/* Completeness / Offline / Lock Status Notices */}
        <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
          {/* Mandatory Records Disclosure */}
          <div
            data-testid="prep-records-disclosure"
            className="flex items-start gap-2 text-[11px] text-stone-600 bg-stone-50 px-3 py-2 rounded-xl border border-stone-200/80"
          >
            <Info className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
            <span>{brief.relationshipSummary.recordsDisclosureAr}</span>
          </div>

          {brief.completeness.status === 'partial_or_offline' && (
            <div
              data-testid="prep-partial-offline-banner"
              className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200"
            >
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">{brief.completeness.disclosureAr}</span>
                {brief.completeness.unloadedCollectionsAr.length > 0 && (
                  <span className="block text-[11px] text-amber-800 mt-0.5">
                    مجموعات قيد التحميل: {brief.completeness.unloadedCollectionsAr.join('، ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {brief.isMeetingCancelled && (
            <div
              data-testid="prep-cancelled-readonly-banner"
              className="flex items-center gap-2 text-xs text-rose-900 bg-rose-50 px-3 py-2 rounded-xl border border-rose-200 font-medium"
            >
              <Lock className="w-4 h-4 text-rose-700 shrink-0" />
              <span>
                هذا الاجتماع في حالة «ملغاة» — يُعرض ملف التحضير كمرجع تاريخي للقراءة فقط ولا يمكن تعديل الأهداف أو جدول الأعمال.
              </span>
            </div>
          )}

          {!brief.isMeetingCancelled && brief.isMinutesFinalLocked && (
            <div
              data-testid="prep-final-minutes-lock-banner"
              className="flex items-center justify-between gap-2 flex-wrap text-xs text-emerald-950 bg-emerald-50/80 px-3 py-2 rounded-xl border border-emerald-200"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  محضر الاجتماع في حالة «نهائي» مقفل تنظيميًا — يمكنك تحديث حالة تحقق أهداف الاجتماع بعد انتهائه، بينما يتطلب تعديل جدول الأعمال إعادة فتح المحضر.
                </span>
              </div>
              {onSwitchWorkspaceTab && (
                <button
                  type="button"
                  onClick={() => onSwitchWorkspaceTab('minutes')}
                  className="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-[11px] font-semibold hover:bg-emerald-100"
                >
                  فتح تبويب المحضر
                </button>
              )}
            </div>
          )}

          {feedbackBanner && (
            <div
              data-testid="prep-feedback-banner"
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${
                feedbackBanner.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : feedbackBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-stone-100 border-stone-200 text-stone-800'
              }`}
            >
              <span>{feedbackBanner.text}</span>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-stone-400 hover:text-stone-700"
                aria-label="إغلاق التنبيه"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Two-Column Grid on Desktop */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Right Column (7 cols in RTL): Relationship, Opportunities, Commitments, Previous Meetings */}
        <div className="xl:col-span-7 space-y-4">
          {/* Section A: Client Relationship Summary («ملخص العلاقة مع العميل») */}
          <section
            data-testid="prep-section-relationship"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  ملخص العلاقة مع العميل
                </h4>
              </div>
              {brief.client && onSelectClient && (
                <button
                  type="button"
                  onClick={() => onSelectClient(brief.client!.id)}
                  className="text-xs font-semibold text-emerald-800 hover:underline inline-flex items-center gap-1"
                >
                  <span>عرض ملف 360</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {!brief.client ? (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                العميل المرتبط بهذا الاجتماع غير متاح حاليًا في السجلات المحلية.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80">
                    <span className="text-[11px] text-stone-500 block">العميل / الجهة</span>
                    <span className="font-bold text-stone-900 block truncate">
                      {brief.client.name}
                    </span>
                    {brief.client.company && (
                      <span className="text-[11px] text-stone-600 block truncate">
                        {brief.client.company}
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80">
                    <span className="text-[11px] text-stone-500 block">جهة الاتصال الرئيسية</span>
                    {brief.primaryContact ? (
                      <>
                        <span className="font-bold text-stone-900 block truncate">
                          {brief.primaryContact.name}
                        </span>
                        <span className="text-[11px] text-stone-600 block truncate">
                          {brief.primaryContact.title || brief.primaryContact.phone || 'معرّفة'}
                        </span>
                      </>
                    ) : (
                      <span className="text-stone-500 font-medium">غير محددة</span>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80">
                    <span className="text-[11px] text-emerald-800 block">آخر تواصل مؤكد</span>
                    <span
                      data-testid="prep-last-confirmed-contact"
                      className="font-bold text-emerald-950 block tabular-nums"
                    >
                      {brief.relationshipSummary.lastConfirmedContactAt
                        ? formatArabicDate(brief.relationshipSummary.lastConfirmedContactAt)
                        : 'لا يوجد تواصل مؤكد'}
                    </span>
                    {brief.relationshipSummary.daysSinceLastConfirmedContact !== null && (
                      <span className="text-[11px] text-emerald-800 block">
                        منذ {brief.relationshipSummary.daysSinceLastConfirmedContact} يوم
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80">
                    <span className="text-[11px] text-stone-500 block">إجمالي التفاعلات</span>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span
                        data-testid="prep-confirmed-count"
                        className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[11px]"
                      >
                        {brief.relationshipSummary.confirmedInteractionsCount} مؤكد
                      </span>
                      <span
                        data-testid="prep-attempt-count"
                        className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]"
                      >
                        {brief.relationshipSummary.attemptInteractionsCount} محاولة
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recent Interactions List */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-stone-800">آخر التفاعلات المسجلة:</span>
                    {brief.relationshipSummary.overdueFollowUpInteractions.length > 0 && (
                      <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                        {brief.relationshipSummary.overdueFollowUpInteractions.length} متابعة تواصل متأخرة
                      </span>
                    )}
                  </div>

                  {brief.relationshipSummary.recentInteractions.length === 0 ? (
                    <p
                      data-testid="prep-empty-interactions"
                      className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200"
                    >
                      {EMPTY_INTERACTIONS_MESSAGE_AR}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {brief.relationshipSummary.recentInteractions.map((item) => {
                        const confirmed = isConfirmedInteraction(item);
                        const channelLabel =
                          COMMUNICATION_CHANNEL_META[item.channel]?.labelAr || item.channel;
                        const outcomeLabel =
                          COMMUNICATION_OUTCOME_META[item.outcome]?.labelAr || item.outcome;

                        return (
                          <div
                            key={item.id}
                            data-testid={`prep-interaction-item-${item.id}`}
                            className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    confirmed
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : 'bg-amber-50 text-amber-800 border-amber-200'
                                  }`}
                                >
                                  {confirmed ? 'تواصل مؤكد' : 'محاولة غير مؤكدة'}
                                </span>
                                <span className="font-bold text-stone-900">{item.subject}</span>
                                <span className="text-[11px] text-stone-500">
                                  ({channelLabel} — {outcomeLabel})
                                </span>
                              </div>
                              {item.summary && (
                                <p className="text-[11px] text-stone-600 line-clamp-2">
                                  {item.summary}
                                </p>
                              )}
                              {item.nextStep && (
                                <p className="text-[11px] text-emerald-900 font-medium">
                                  الخطوة التالية: {item.nextStep}
                                  {item.nextFollowUpDate ? ` (${item.nextFollowUpDate})` : ''}
                                </p>
                              )}
                            </div>

                            <span className="text-[11px] text-stone-500 tabular-nums shrink-0">
                              {formatArabicDate(item.occurredAt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Section B: Business Opportunities Context */}
          <section
            data-testid="prep-section-opportunities"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  سياق فرص الأعمال
                </h4>
              </div>
            </div>

            {brief.opportunitiesContext.linkedOpportunity ? (
              <div
                data-testid="prep-linked-opportunity-card"
                className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 block">
                      الفرصة المرتبطة مباشرة بهذا الاجتماع
                    </span>
                    <h5 className="font-heading font-bold text-sm text-stone-950">
                      {brief.opportunitiesContext.linkedOpportunity.title}
                    </h5>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                        OPPORTUNITY_STAGE_CONFIG[
                          brief.opportunitiesContext.linkedOpportunity.stage
                        ]?.badgeClass || 'bg-white border-stone-200 text-stone-800'
                      }`}
                    >
                      {OPPORTUNITY_STAGE_CONFIG[
                        brief.opportunitiesContext.linkedOpportunity.stage
                      ]?.labelAr || brief.opportunitiesContext.linkedOpportunity.stage}
                    </span>
                    {onOpenOpportunity && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenOpportunity(brief.opportunitiesContext.linkedOpportunity!.id)
                        }
                        className="px-2 py-0.5 rounded-md bg-white border border-emerald-300 text-emerald-900 text-[11px] font-semibold hover:bg-emerald-100"
                      >
                        فتح الفرصة
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] bg-white/80 p-2.5 rounded-lg border border-emerald-200/70">
                  <div>
                    <span className="text-stone-500 block">القيمة التقديرية</span>
                    <span className="font-bold text-stone-900 tabular-nums">
                      {brief.opportunitiesContext.linkedOpportunity.estimatedValue !== undefined &&
                      brief.opportunitiesContext.linkedOpportunity.currency
                        ? formatOpportunityValue(
                            brief.opportunitiesContext.linkedOpportunity.estimatedValue,
                            brief.opportunitiesContext.linkedOpportunity.currency
                          )
                        : 'غير محددة'}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">تاريخ الإغلاق المتوقع</span>
                    <span className="font-bold text-stone-900 tabular-nums">
                      {brief.opportunitiesContext.linkedOpportunity.expectedCloseDate || 'غير محدد'}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">الإجراء القادم</span>
                    <span className="font-bold text-stone-900">
                      {brief.opportunitiesContext.linkedOpportunity.nextAction || 'غير محدد'}
                      {brief.opportunitiesContext.linkedOpportunity.nextActionDate
                        ? ` (${brief.opportunitiesContext.linkedOpportunity.nextActionDate})`
                        : ''}
                    </span>
                  </div>
                </div>

                {brief.opportunitiesContext.linkedOpportunityStageEvents.length > 0 && (
                  <div className="text-[11px] text-stone-600">
                    <span className="font-semibold text-stone-800">آخر تحول مسجل: </span>
                    <span>
                      إلى مرحلة «
                      {OPPORTUNITY_STAGE_CONFIG[
                        brief.opportunitiesContext.linkedOpportunityStageEvents[0].toStage
                      ]?.labelAr ||
                        brief.opportunitiesContext.linkedOpportunityStageEvents[0].toStage}
                      » بتاريخ{' '}
                      {formatArabicDate(
                        brief.opportunitiesContext.linkedOpportunityStageEvents[0].occurredAt
                      )}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                لا توجد فرصة أعمال مرتبطة مباشرة بهذا الاجتماع.
              </p>
            )}

            {/* Separate Section: Other Open Opportunities for the Same Client */}
            {brief.opportunitiesContext.otherClientOpportunities.length > 0 && (
              <div
                data-testid="prep-other-opportunities-list"
                className="pt-2 space-y-2"
              >
                <div className="text-xs font-bold text-stone-800">
                  فرص أخرى مرتبطة بالعميل ({brief.opportunitiesContext.otherClientOpportunities.length}):
                </div>
                <div className="space-y-1.5">
                  {brief.opportunitiesContext.otherClientOpportunities.map((opp) => (
                    <div
                      key={opp.id}
                      className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/60 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-bold text-stone-900">{opp.title}</span>
                        <span className="text-[11px] text-stone-500 ms-2">
                          ({OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage})
                        </span>
                        {opp.estimatedValue !== undefined && opp.currency && (
                          <span className="text-[11px] font-semibold text-emerald-900 ms-2 tabular-nums">
                            • {formatOpportunityValue(opp.estimatedValue, opp.currency)}
                          </span>
                        )}
                      </div>
                      {onOpenOpportunity && (
                        <button
                          type="button"
                          onClick={() => onOpenOpportunity(opp.id)}
                          className="text-[11px] font-semibold text-emerald-800 hover:underline shrink-0"
                        >
                          عرض
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Section C: Outstanding Commitments («التزامات تحتاج إلى متابعة») */}
          <section
            data-testid="prep-section-commitments"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  التزامات تحتاج إلى متابعة ({brief.openTasks.totalOpenCount})
                </h4>
              </div>
              {brief.openTasks.overdue.length > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-bold">
                  {brief.openTasks.overdue.length} متأخرة
                </span>
              )}
            </div>

            {brief.openTasks.totalOpenCount === 0 ? (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                لا توجد مهام مفتوحة مرتبطة بهذا العميل حاليًا.
              </p>
            ) : (
              <div className="space-y-3">
                {[
                  {
                    key: 'overdue',
                    titleAr: 'مهام متأخرة',
                    items: brief.openTasks.overdue,
                    badgeCls: 'bg-rose-50 text-rose-800 border-rose-200',
                  },
                  {
                    key: 'dueToday',
                    titleAr: 'مهام مستحقة اليوم',
                    items: brief.openTasks.dueToday,
                    badgeCls: 'bg-amber-50 text-amber-800 border-amber-200',
                  },
                  {
                    key: 'upcoming',
                    titleAr: 'مهام قادمة',
                    items: brief.openTasks.upcoming,
                    badgeCls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                  },
                  {
                    key: 'noDueDate',
                    titleAr: 'مهام بدون تاريخ استحقاق',
                    items: brief.openTasks.noDueDate,
                    badgeCls: 'bg-stone-100 text-stone-700 border-stone-200',
                  },
                ]
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <div key={group.key} data-testid={`prep-tasks-group-${group.key}`} className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800">
                        <span className={`px-2 py-0.5 rounded border text-[10px] ${group.badgeCls}`}>
                          {group.titleAr} ({group.items.length})
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {group.items.map((task) => {
                          const inAgenda = existingAgendaNormSet.has(
                            normalizeTaskTitle(`متابعة المهمة: ${task.title}`)
                          );
                          return (
                            <div
                              key={task.id}
                              data-testid={`prep-task-item-${task.id}`}
                              className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div>
                                <span className="font-bold text-stone-900">{task.title}</span>
                                {task.dueDate && (
                                  <span className="text-[11px] text-stone-500 ms-2 tabular-nums">
                                    (الاستحقاق: {task.dueDate})
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {onOpenTask && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenTask(task.id)}
                                    className="px-2 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 text-[11px] font-medium"
                                  >
                                    فتح المهمة
                                  </button>
                                )}
                                {brief.canEditAgendaAndMinutes && (
                                  <button
                                    type="button"
                                    disabled={inAgenda}
                                    onClick={() => void handleAddTaskToAgenda(task)}
                                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                      inAgenda
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 cursor-default'
                                        : 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800'
                                    }`}
                                  >
                                    {inAgenda ? 'مضاف للأجندة' : '+ للأجندة'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Section D: Previous Meetings & Decisions («ماذا حدث في الاجتماعات السابقة؟») */}
          <section
            data-testid="prep-section-previous-meetings"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  ماذا حدث في الاجتماعات السابقة؟ ({brief.previousMeetings.length})
                </h4>
              </div>
            </div>

            {brief.previousMeetings.length === 0 ? (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                لا توجد اجتماعات سابقة منعقدة مسجلة مع هذا العميل (تم استثناء الاجتماعات الملغاة).
              </p>
            ) : (
              <div className="space-y-2.5">
                {brief.previousMeetings.map((pm) => (
                  <div
                    key={pm.meeting.id}
                    data-testid={`prep-prev-meeting-${pm.meeting.id}`}
                    className="p-3 rounded-xl border border-stone-200 bg-stone-50/40 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <span className="font-bold text-stone-950 block">{pm.meeting.title}</span>
                        <span className="text-[11px] text-stone-500 tabular-nums">
                          {formatArabicDate(pm.meeting.dateTime, true)} •{' '}
                          {MEETING_TYPE_LABELS[pm.meeting.type]?.ar || pm.meeting.type}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-white border border-stone-200 text-[10px] text-stone-700">
                          مهام مفتوحة: {pm.openTasksCount} | منجزة: {pm.completedTasksCount}
                        </span>
                        {onSelectMeeting && (
                          <button
                            type="button"
                            onClick={() => onSelectMeeting(pm.meeting.id)}
                            className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold hover:bg-emerald-100"
                          >
                            فتح الاجتماع
                          </button>
                        )}
                      </div>
                    </div>

                    {pm.summaryExcerpt && (
                      <p className="text-stone-700 leading-relaxed bg-white p-2.5 rounded-lg border border-stone-200/70">
                        {pm.summaryExcerpt}
                      </p>
                    )}

                    {pm.decisions.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold text-stone-800 block">
                          القرارات المعتمدة ({pm.decisions.length}):
                        </span>
                        <ul className="space-y-1 ps-2">
                          {pm.decisions.map((dec) => (
                            <li key={dec.id} className="text-[11px] text-stone-700">
                              • <span className="font-medium text-stone-900">{dec.text}</span>
                              {dec.ownerName ? (
                                <span className="text-stone-500"> (المسؤول: {dec.ownerName})</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Left Column (5 cols in RTL): Suggested Discussion Topics, Meeting Goals & Notes, AI Advanced Briefing */}
        <div className="xl:col-span-5 space-y-4">
          {/* Section E: Suggested Discussion Topics («مواضيع تستحق المناقشة») */}
          <section
            data-testid="prep-section-suggested-topics"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  مواضيع تستحق المناقشة ({activeSuggestedTopics.length})
                </h4>
              </div>

              {brief.suggestedTopics.some((t) => t.isDismissed) && (
                <button
                  type="button"
                  onClick={() => setShowDismissedTopics((v) => !v)}
                  className="text-[11px] font-medium text-stone-500 hover:text-stone-800"
                >
                  {showDismissedTopics ? 'إخفاء المتجاهلة' : 'إظهار المتجاهلة'}
                </button>
              )}
            </div>

            {activeSuggestedTopics.length === 0 ? (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                لا توجد مواضيع مقترحة إضافية حاليًا. جميع الالتزامات والمتابعات إما مدرجة في جدول الأعمال أو مكتملة.
              </p>
            ) : (
              <div className="space-y-2.5">
                {activeSuggestedTopics.map((topic) => {
                  const isEditingThis = editingTopicKey === topic.key;
                  return (
                    <div
                      key={topic.key}
                      data-testid={`prep-suggested-topic-${topic.key}`}
                      className={`p-3 rounded-xl border text-xs space-y-2 ${
                        topic.alreadyInAgenda
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : 'bg-stone-50/60 border-stone-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <span className="font-bold text-stone-950 block">{topic.title}</span>
                          <span className="text-[11px] text-stone-600 block">{topic.reasonAr}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenTopicSource(topic)}
                          className="text-[11px] font-semibold text-emerald-800 hover:underline shrink-0 inline-flex items-center gap-0.5"
                          title={`فتح المصدر: ${topic.sourceLabelAr}`}
                        >
                          <span>المصدر</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>

                      {isEditingThis ? (
                        <div className="space-y-2 pt-2 border-t border-stone-200">
                          <input
                            type="text"
                            data-testid="prep-edit-topic-title-input"
                            value={editingTopicTitle}
                            onChange={(e) => setEditingTopicTitle(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs text-stone-900"
                            placeholder="عنوان البند في جدول الأعمال"
                          />
                          <input
                            type="text"
                            value={editingTopicNotes}
                            onChange={(e) => setEditingTopicNotes(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs text-stone-700"
                            placeholder="ملاحظة إضافية للبند (اختياري)"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              data-testid="prep-confirm-edited-topic-btn"
                              onClick={() =>
                                void handleAddSuggestedTopicToAgenda(
                                  topic,
                                  editingTopicTitle,
                                  editingTopicNotes
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800"
                            >
                              حفظ وإضافة للأجندة
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTopicKey(null)}
                              className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-stone-600 text-[11px]"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                          {topic.alreadyInAgenda ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>مدرج في جدول الأعمال</span>
                            </span>
                          ) : brief.canEditAgendaAndMinutes ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                data-testid={`prep-add-topic-btn-${topic.key}`}
                                onClick={() => void handleAddSuggestedTopicToAgenda(topic)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 text-white hover:bg-stone-800 text-[11px] font-semibold"
                              >
                                <Plus className="w-3 h-3" />
                                <span>إضافة إلى جدول الأعمال</span>
                              </button>
                              <button
                                type="button"
                                data-testid={`prep-edit-topic-btn-${topic.key}`}
                                onClick={() => {
                                  setEditingTopicKey(topic.key);
                                  setEditingTopicTitle(topic.title);
                                  setEditingTopicNotes(topic.reasonAr);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 text-[11px]"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>تعديل قبل الإضافة</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-stone-500">
                              جدول الأعمال مقفل حاليًا
                            </span>
                          )}

                          {!topic.alreadyInAgenda && !topic.isDismissed && !brief.isMeetingCancelled && (
                            <button
                              type="button"
                              data-testid={`prep-dismiss-topic-btn-${topic.key}`}
                              onClick={() => void handleDismissSuggestedTopic(topic.key)}
                              className="text-[11px] text-stone-400 hover:text-stone-700"
                            >
                              تجاهل
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section F: Meeting Preparation Goals («أهداف الاجتماع») & Notes */}
          <section
            data-testid="prep-section-goals"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-700" />
                <h4 className="font-heading font-bold text-sm text-stone-950">
                  أهداف الاجتماع ({brief.goals.length})
                </h4>
              </div>
              <span className="text-[11px] text-stone-500">تحديث الحالة يدويًا فقط</span>
            </div>

            {/* Add Goal Form */}
            {brief.canEditGoals && (
              <form onSubmit={(e) => void handleAddGoal(e)} className="space-y-2 bg-stone-50 p-3 rounded-xl border border-stone-200">
                <input
                  type="text"
                  data-testid="prep-new-goal-input"
                  value={newGoalText}
                  onChange={(e) => setNewGoalText(e.target.value)}
                  placeholder="أضف هدفًا واضحًا تريد تحقيقه في هذا الاجتماع..."
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    data-testid="prep-new-goal-note-input"
                    value={newGoalNote}
                    onChange={(e) => setNewGoalNote(e.target.value)}
                    placeholder="ملاحظة أو معيار تحقق الهدف (اختياري)..."
                    className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    type="submit"
                    data-testid="prep-add-goal-btn"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة هدف</span>
                  </button>
                </div>
              </form>
            )}

            {/* Goals List */}
            {brief.goals.length === 0 ? (
              <p className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
                لم يتم تحديد أهداف خاصة لهذا الاجتماع بعد.
              </p>
            ) : (
              <div className="space-y-2">
                {brief.goals.map((goal, idx) => {
                  const statusMeta = MEETING_GOAL_STATUS_META[goal.status];
                  const isEditing = editingGoalId === goal.id;
                  const isConfirmingDelete = deletingGoalId === goal.id;

                  return (
                    <div
                      key={goal.id}
                      data-testid={`prep-goal-item-${goal.id}`}
                      className="p-3 rounded-xl border border-stone-200 bg-stone-50/40 space-y-2 text-xs"
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            data-testid={`prep-edit-goal-text-${goal.id}`}
                            value={editGoalText}
                            onChange={(e) => setEditGoalText(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs text-stone-900"
                          />
                          <input
                            type="text"
                            value={editGoalNote}
                            onChange={(e) => setEditGoalNote(e.target.value)}
                            placeholder="ملاحظة على الهدف..."
                            className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs text-stone-700"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleSaveEditedGoal(goal.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold"
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGoalId(null)}
                              className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-stone-600 text-[11px]"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5">
                              <span className="font-bold text-stone-950 block">
                                {idx + 1}. {goal.text}
                              </span>
                              {goal.note && (
                                <span className="text-[11px] text-stone-600 block">
                                  ملاحظة: {goal.note}
                                </span>
                              )}
                            </div>

                            {brief.canEditGoals && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => void handleReorderGoal(goal.id, 'up')}
                                  className="p-1 rounded hover:bg-stone-200 disabled:opacity-30"
                                  title="تحريك لأعلى"
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-stone-600" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === brief.goals.length - 1}
                                  onClick={() => void handleReorderGoal(goal.id, 'down')}
                                  className="p-1 rounded hover:bg-stone-200 disabled:opacity-30"
                                  title="تحريك لأسفل"
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-stone-600" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingGoalId(goal.id);
                                    setEditGoalText(goal.text);
                                    setEditGoalNote(goal.note || '');
                                  }}
                                  className="p-1 rounded hover:bg-stone-200"
                                  title="تعديل الهدف"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-stone-600" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingGoalId(goal.id)}
                                  className="p-1 rounded hover:bg-rose-100 text-rose-700"
                                  title="حذف الهدف"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {isConfirmingDelete && (
                            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-900">
                              <span>هل أنت متأكد من حذف هذا الهدف؟</span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  data-testid={`prep-confirm-delete-goal-${goal.id}`}
                                  onClick={() => void handleConfirmDeleteGoal(goal.id)}
                                  className="px-2 py-0.5 rounded bg-rose-700 text-white font-semibold"
                                >
                                  تأكيد الحذف
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingGoalId(null)}
                                  className="px-2 py-0.5 rounded bg-white border border-rose-200 text-stone-700"
                                >
                                  تراجع
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Manual Goal Status Selector */}
                          <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-stone-200/60">
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${statusMeta.badgeClass}`}
                            >
                              الحالة: {statusMeta.labelAr}
                            </span>

                            {brief.canUpdatePostMeetingGoalStatus && (
                              <select
                                aria-label={`حالة الهدف ${goal.text}`}
                                data-testid={`prep-goal-status-select-${goal.id}`}
                                value={goal.status}
                                onChange={(e) =>
                                  void handleGoalStatusChange(
                                    goal.id,
                                    e.target.value as MeetingGoalStatus
                                  )
                                }
                                className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-[11px] font-medium text-stone-800"
                              >
                                {MEETING_GOAL_STATUS_ORDER.map((st) => (
                                  <option key={st} value={st}>
                                    {MEETING_GOAL_STATUS_META[st].labelAr}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* General Preparation Notes */}
            <div className="pt-2 border-t border-stone-100 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-800">
                  ملاحظات تحضيرية خاصة قبل الاجتماع:
                </label>
                {isPrepNotesDirty && brief.canEditGoals && (
                  <button
                    type="button"
                    data-testid="prep-save-notes-btn"
                    onClick={() => void handleSavePrepNotes()}
                    className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800"
                  >
                    حفظ ملاحظات التحضير
                  </button>
                )}
              </div>
              <textarea
                rows={3}
                data-testid="prep-notes-textarea"
                disabled={!brief.canEditGoals}
                value={prepNotesDraft}
                onChange={(e) => {
                  setPrepNotesDraft(e.target.value);
                  setIsPrepNotesDirty(true);
                }}
                placeholder="دوّن أي نقاط تذكيرية أو سياق شخصي تريد استحضاره أثناء اللقاء..."
                className="w-full rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-xs text-stone-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
              />
            </div>
          </section>

          {/* Section G: AI Advanced Briefing («تحضير ذكي متقدم» — Level B Optional) */}
          <section
            data-testid="prep-section-ai-briefing"
            className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-700" />
                <div>
                  <h4 className="font-heading font-bold text-sm text-stone-950">
                    تحضير ذكي متقدم (اختياري)
                  </h4>
                  <p className="text-[11px] text-stone-500">
                    يستخدم Gemini لتحليل السجلات واقتراح نقاط نقاش وأسئلة ومخاطر بعد موافقتك الصريحة
                  </p>
                </div>
              </div>

              {!brief.isMeetingCancelled && (
                <button
                  type="button"
                  data-testid="prep-open-ai-consent-btn"
                  disabled={!isOnline || isAiLoading}
                  onClick={() => setIsAiConsentModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50 transition-colors shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{aiResult ? 'إعادة التوليد' : 'إعداد تحضير متقدم'}</span>
                </button>
              )}
            </div>

            {!isOnline && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                التحضير المتقدم بالذكاء الاصطناعي غير متاح أثناء عدم الاتصال بالإنترنت. التحضير الذكي المباشر أعلاه يعمل بالكامل محليًا.
              </div>
            )}

            {isAiLoading && (
              <div
                data-testid="prep-ai-loading-state"
                className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200 flex items-center justify-between gap-3 text-xs text-indigo-950"
              >
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-4 h-4 text-indigo-700 animate-spin shrink-0" />
                  <span>جاري إعداد الإحاطة التنفيذية ومقترحات النقاش عبر الخادم...</span>
                </div>
                <button
                  type="button"
                  data-testid="prep-cancel-ai-btn"
                  onClick={handleCancelAiBriefing}
                  className="px-2.5 py-1 rounded-lg bg-white border border-indigo-300 text-indigo-900 text-[11px] font-semibold hover:bg-indigo-100"
                >
                  إلغاء الطلب
                </button>
              </div>
            )}

            {aiError && (
              <div
                data-testid="prep-ai-error-state"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">{aiError}</p>
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    لم تتأثر بيانات اجتماعك أو أهدافك المحلية.
                  </p>
                </div>
              </div>
            )}

            {aiResult && (
              <div data-testid="prep-ai-result-container" className="space-y-3.5 pt-1 text-xs">
                {/* Warnings if any */}
                {aiResult.warnings.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      <span>ملاحظات حول اكتمال البيانات:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {aiResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 1. Executive Briefing */}
                <div className="p-3 rounded-xl bg-indigo-50/40 border border-indigo-200 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-indigo-950">
                      1. الموجز التنفيذي قبل الاجتماع
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 text-[10px] font-semibold">
                      للمراجعة البشرية
                    </span>
                  </div>
                  <p
                    data-testid="prep-ai-executive-briefing"
                    className="text-stone-800 leading-relaxed whitespace-pre-line"
                  >
                    {aiResult.executiveBriefing}
                  </p>
                </div>

                {/* 2. Recommended Talking Points */}
                {aiResult.recommendedTalkingPoints.length > 0 && (
                  <div className="space-y-2">
                    <span className="font-bold text-stone-900 block">
                      2. نقاط النقاش الموصى بها ({aiResult.recommendedTalkingPoints.length}):
                    </span>
                    {aiResult.recommendedTalkingPoints.map((tp) => {
                      const basisMeta = AI_BRIEFING_BASIS_META[tp.basisType];
                      const alreadyInAgenda = existingAgendaNormSet.has(
                        normalizeTaskTitle(tp.title)
                      );
                      const isEditingPoint = editingAiPointId === tp.id;

                      return (
                        <div
                          key={tp.id}
                          data-testid={`prep-ai-talking-point-${tp.id}`}
                          className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/60 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${basisMeta.badgeClass}`}
                            >
                              {basisMeta.labelAr}
                            </span>
                            {tp.sourceReferenceAr && (
                              <span className="text-[10px] text-stone-500">
                                المرجع: {tp.sourceReferenceAr}
                              </span>
                            )}
                          </div>

                          {isEditingPoint ? (
                            <div className="space-y-1.5 pt-1">
                              <input
                                type="text"
                                value={editingAiPointTitle}
                                onChange={(e) => setEditingAiPointTitle(e.target.value)}
                                className="w-full px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-xs"
                              />
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleApproveAiPointToAgenda(
                                      editingAiPointTitle,
                                      tp.rationale
                                    )
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold"
                                >
                                  اعتماد في جدول الأعمال
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingAiPointId(null)}
                                  className="px-2 py-1 rounded-lg bg-white border border-stone-200 text-[11px]"
                                >
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="font-bold text-stone-900">{tp.title}</p>
                              <p className="text-[11px] text-stone-600">{tp.rationale}</p>
                              {brief.canEditAgendaAndMinutes && (
                                <div className="flex items-center gap-1.5 pt-1">
                                  <button
                                    type="button"
                                    disabled={alreadyInAgenda}
                                    data-testid={`prep-approve-ai-point-${tp.id}`}
                                    onClick={() =>
                                      void handleApproveAiPointToAgenda(tp.title, tp.rationale)
                                    }
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                                      alreadyInAgenda
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800'
                                    }`}
                                  >
                                    {alreadyInAgenda ? 'معتمد في الأجندة' : '+ اعتماد في جدول الأعمال'}
                                  </button>
                                  {!alreadyInAgenda && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingAiPointId(tp.id);
                                        setEditingAiPointTitle(tp.title);
                                      }}
                                      className="px-2 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 text-[11px]"
                                    >
                                      تعديل قبل الاعتماد
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 3. Suggested Questions */}
                {aiResult.suggestedQuestions.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-stone-900 block">
                      3. أسئلة مقترحة لطرحها على العميل:
                    </span>
                    <ul className="space-y-1.5">
                      {aiResult.suggestedQuestions.map((q, i) => (
                        <li
                          key={i}
                          className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/40 flex items-center justify-between gap-2"
                        >
                          <span className="text-stone-800">• {q}</span>
                          {brief.canEditAgendaAndMinutes && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleApproveAiPointToAgenda(`سؤال للنقاش: ${q}`)
                              }
                              className="px-2 py-0.5 rounded bg-white border border-stone-200 text-[10px] font-semibold text-stone-700 hover:bg-stone-100 shrink-0"
                            >
                              + للأجندة
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 4. Potential Risks */}
                {aiResult.potentialRisks.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-stone-900 block">
                      4. مخاطر أو نقاط حساسة محتملة:
                    </span>
                    <ul className="space-y-1 p-2.5 rounded-xl bg-rose-50/50 border border-rose-200 text-rose-950">
                      {aiResult.potentialRisks.map((risk, i) => (
                        <li key={i} className="text-[11px]">
                          • {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 5. Expected Outcomes -> Approve as Preparation Goals */}
                {aiResult.expectedOutcomes.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-stone-900 block">
                      5. مخرجات وأهداف مقترحة للاجتماع:
                    </span>
                    <div className="space-y-1.5">
                      {aiResult.expectedOutcomes.map((outcome) => {
                        const alreadyGoal = existingGoalNormSet.has(
                          normalizeTaskTitle(outcome.text)
                        );
                        const isEditingOut = editingAiOutcomeId === outcome.id;

                        return (
                          <div
                            key={outcome.id}
                            data-testid={`prep-ai-outcome-${outcome.id}`}
                            className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/60 space-y-1.5"
                          >
                            {isEditingOut ? (
                              <div className="space-y-1.5">
                                <input
                                  type="text"
                                  value={editingAiOutcomeText}
                                  onChange={(e) => setEditingAiOutcomeText(e.target.value)}
                                  className="w-full px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-xs"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleApproveAiOutcomeToGoals(
                                        editingAiOutcomeText,
                                        outcome.note
                                      )
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold"
                                  >
                                    حفظ كهدف للاجتماع
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAiOutcomeId(null)}
                                    className="px-2 py-1 rounded-lg bg-white border border-stone-200 text-[11px]"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div>
                                  <span className="font-bold text-stone-900 block">
                                    {outcome.text}
                                  </span>
                                  {outcome.note && (
                                    <span className="text-[11px] text-stone-600 block">
                                      {outcome.note}
                                    </span>
                                  )}
                                </div>

                                {brief.canEditGoals && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      disabled={alreadyGoal}
                                      data-testid={`prep-approve-ai-outcome-${outcome.id}`}
                                      onClick={() =>
                                        void handleApproveAiOutcomeToGoals(
                                          outcome.text,
                                          outcome.note
                                        )
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                                        alreadyGoal
                                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                          : 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800'
                                      }`}
                                    >
                                      {alreadyGoal ? 'مضاف في الأهداف' : '+ اعتماد كهدف للاجتماع'}
                                    </button>
                                    {!alreadyGoal && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingAiOutcomeId(outcome.id);
                                          setEditingAiOutcomeText(outcome.text);
                                        }}
                                        className="px-2 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 text-[11px]"
                                      >
                                        تعديل
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Explicit User Consent Modal for AI Advanced Briefing */}
      {isAiConsentModalOpen && (
        <div
          data-testid="prep-ai-consent-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/65 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-stone-200 max-h-[92vh] flex flex-col">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-700" />
                <h3 className="font-heading font-bold text-sm text-stone-950">
                  مراجعة البيانات والموافقة على التحضير المتقدم بالذكاء الاصطناعي
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAiConsentModalOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-indigo-950 space-y-1">
                <p className="font-bold">إفصاح الخصوصية والتحكم البشري:</p>
                <p className="text-[11px] leading-relaxed">
                  سيتم إرسال النص المعاين أدناه فقط إلى خدمة Google Gemini عبر خادم التطبيق الآمن لإعداد موجز تحضيري ومقترحات نقاش. لن يتم حفظ مخرجات الذكاء الاصطناعي أو تعديل جدول أعمالك أو أهدافك إلا بعد مراجعتك واعتمادك اليدوي لكل عنصر.
                </p>
              </div>

              {/* Checkboxes for included sections */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900">
                    اختر الأقسام المراد تضمينها في التحضير:
                  </span>
                  <span
                    data-testid="prep-ai-consent-char-count"
                    className="text-[11px] font-mono text-stone-600 tabular-nums"
                  >
                    {aiConsentBundle.charCount} / {aiConsentBundle.maxChars} حرف
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AI_BRIEFING_SECTION_LABELS.map((sec) => {
                    const checked = aiSectionSelection[sec.key];
                    return (
                      <label
                        key={sec.key}
                        className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                          checked
                            ? 'bg-indigo-50/50 border-indigo-300 text-stone-900'
                            : 'bg-stone-50 border-stone-200 text-stone-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          data-testid={`prep-ai-section-checkbox-${sec.key}`}
                          checked={checked}
                          onChange={() => toggleAiSection(sec.key)}
                          className="mt-0.5 accent-indigo-700 rounded"
                        />
                        <div>
                          <span className="font-bold block text-[11px]">{sec.labelAr}</span>
                          <span className="text-[10px] text-stone-500 block">
                            {sec.descriptionAr}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Excluded & Truncated Disclosures */}
              <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1 text-[11px] text-stone-600">
                <div className="font-bold text-stone-800">بيانات مستثناة تلقائيًا للأمان:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiConsentBundle.excludedItemsAr.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
                {aiConsentBundle.wasTruncated && (
                  <div className="pt-1 text-amber-800 font-medium">
                    تنبيه: تم اختصار بعض القوائم الطويلة ({aiConsentBundle.truncatedSectionsAr.join('، ')}).
                  </div>
                )}
              </div>

              {/* Exact Redacted Preview Text */}
              <div className="space-y-1">
                <label className="font-bold text-stone-800 block">
                  معاينة النص الفعلي الذي سيُرسل بعد التنقيح:
                </label>
                <pre
                  data-testid="prep-ai-consent-preview-text"
                  className="w-full max-h-48 overflow-y-auto p-3 rounded-xl bg-stone-900 text-stone-100 text-[11px] font-mono whitespace-pre-wrap leading-relaxed"
                >
                  {aiConsentBundle.previewText || 'لا توجد بيانات محددة للإرسال.'}
                </pre>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAiConsentModalOpen(false)}
                className="px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-700 text-xs font-medium hover:bg-stone-100"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="prep-ai-confirm-send-btn"
                disabled={aiConsentBundle.charCount < 15}
                onClick={() => void handleStartAiBriefing()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-700 text-white text-xs font-semibold hover:bg-indigo-800 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>موافقة وإرسال للتحضير المتقدم</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print / PDF Preview Modal */}
      <MeetingPreparationPrintModal
        brief={brief}
        aiBriefing={aiResult}
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        language={language}
      />
    </div>
  );
};
