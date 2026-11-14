import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  Meeting,
  Opportunity,
  OpportunityStage,
  OpportunityStageEvent,
} from '../types';
import {
  OPPORTUNITY_ALL_STAGES,
  OPPORTUNITY_STAGE_CONFIG,
  OPPORTUNITY_TYPE_LABELS,
  evaluateOpportunityFollowUpAlerts,
  extractRelatedDecisionsFromMeetings,
  formatOpportunityMoney,
  isOpportunityClosed,
} from '../utils/opportunities';
import { formatArabicDate, getPriorityBadge } from '../utils/logic';
import {
  ArrowRight,
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Edit3,
  FileText,
  History,
  Link2,
  ListChecks,
  Plus,
  Trash2,
  Unlink,
  User,
  XCircle,
} from 'lucide-react';

interface OpportunityDetailWorkspaceProps {
  opportunity: Opportunity;
  client?: Client;
  meetings: Meeting[];
  tasks: ActionItem[];
  stageEvents: OpportunityStageEvent[];
  onBack: () => void;
  onEdit: (opportunity: Opportunity) => void;
  onDelete: (opportunity: Opportunity) => Promise<void> | void;
  onRequestStageChange: (opportunity: Opportunity, targetStage: OpportunityStage) => void;
  onUpdateOpportunity: (updated: Opportunity) => Promise<void> | void;
  onConvertNextActionToTask: (opportunity: Opportunity) => Promise<void> | void;
  onLinkMeeting: (meeting: Meeting, opportunity: Opportunity) => Promise<void> | void;
  onUnlinkMeeting: (meeting: Meeting) => Promise<void> | void;
  onLinkTask: (task: ActionItem, opportunity: Opportunity) => Promise<void> | void;
  onUnlinkTask: (task: ActionItem) => Promise<void> | void;
  onToggleTaskStatus: (task: ActionItem) => Promise<void> | void;
  onCreateLinkedMeeting: (opportunity: Opportunity) => void;
  onCreateLinkedTask: (opportunity: Opportunity) => void;
  onOpenClient: (clientId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
  onOpenTask: (taskId: string) => void;
  language: 'ar' | 'en';
}

export const OpportunityDetailWorkspace: React.FC<OpportunityDetailWorkspaceProps> = ({
  opportunity,
  client,
  meetings,
  tasks,
  stageEvents,
  onBack,
  onEdit,
  onDelete,
  onRequestStageChange,
  onUpdateOpportunity,
  onConvertNextActionToTask,
  onLinkMeeting,
  onUnlinkMeeting,
  onLinkTask,
  onUnlinkTask,
  onToggleTaskStatus,
  onCreateLinkedMeeting,
  onCreateLinkedTask,
  onOpenClient,
  onOpenMeeting,
  onOpenTask,
  language,
}) => {
  const [isEditingNextAction, setIsEditingNextAction] = useState(false);
  const [nextActionDraft, setNextActionDraft] = useState(opportunity.nextAction || '');
  const [nextActionDateDraft, setNextActionDateDraft] = useState(opportunity.nextActionDate || '');
  const [isSavingNextAction, setIsSavingNextAction] = useState(false);
  const [isConvertingTask, setIsConvertingTask] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [selectedMeetingToLink, setSelectedMeetingToLink] = useState('');
  const [selectedTaskToLink, setSelectedTaskToLink] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setNextActionDraft(opportunity.nextAction || '');
    setNextActionDateDraft(opportunity.nextActionDate || '');
    setIsEditingNextAction(false);
    setSelectedMeetingToLink('');
    setSelectedTaskToLink('');
    setActionFeedback(null);
  }, [opportunity.id, opportunity.nextAction, opportunity.nextActionDate]);

  const stageCfg = OPPORTUNITY_STAGE_CONFIG[opportunity.stage];
  const priorityInfo = getPriorityBadge(opportunity.priority);
  const closed = isOpportunityClosed(opportunity.stage);

  const followUpAlerts = useMemo(
    () => evaluateOpportunityFollowUpAlerts({ opportunity }),
    [opportunity]
  );

  const linkedMeetings = useMemo(
    () =>
      meetings
        .filter((m) => m.opportunityId === opportunity.id)
        .sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || '')),
    [meetings, opportunity.id]
  );

  // Strictly only meetings for the SAME client can be linked
  const linkableMeetings = useMemo(
    () =>
      meetings
        .filter((m) => m.clientId === opportunity.clientId && m.opportunityId !== opportunity.id)
        .sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || '')),
    [meetings, opportunity.clientId, opportunity.id]
  );

  const linkedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.opportunityId === opportunity.id)
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [tasks, opportunity.id]
  );

  // Strictly only tasks for the SAME client can be linked
  const linkableTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.clientId === opportunity.clientId && t.opportunityId !== opportunity.id)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [tasks, opportunity.clientId, opportunity.id]
  );

  const relatedDecisions = useMemo(
    () => extractRelatedDecisionsFromMeetings(meetings, opportunity.id),
    [meetings, opportunity.id]
  );

  const oppStageEvents = useMemo(
    () =>
      stageEvents
        .filter((e) => e.opportunityId === opportunity.id)
        .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '')),
    [stageEvents, opportunity.id]
  );

  const handleSaveNextAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingNextAction) return;
    setIsSavingNextAction(true);
    try {
      await onUpdateOpportunity({
        ...opportunity,
        nextAction: nextActionDraft.trim() || undefined,
        nextActionDate: nextActionDateDraft.trim() || undefined,
        updatedAt: new Date().toISOString(),
      });
      setIsEditingNextAction(false);
      setActionFeedback(
        language === 'ar' ? 'تم تحديث الخطوة التالية بنجاح.' : 'Next action updated.'
      );
    } finally {
      setIsSavingNextAction(false);
    }
  };

  const handleConvertClick = async () => {
    if (isConvertingTask || !opportunity.nextAction?.trim()) return;
    setIsConvertingTask(true);
    try {
      await onConvertNextActionToTask(opportunity);
      setActionFeedback(
        language === 'ar'
          ? 'تم إنشاء مهمة مرتبطة بهذه الفرصة في قائمة المهام بنجاح.'
          : 'Task created and linked to this opportunity.'
      );
    } finally {
      setIsConvertingTask(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(opportunity);
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="space-y-4 pb-6"
      data-testid="opportunity-detail-workspace"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-testid="opp-detail-back-btn"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50 transition-colors"
        >
          <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
          <span>{language === 'ar' ? 'العودة إلى فرص الأعمال' : 'Back to Pipeline'}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="opp-detail-edit-btn"
            onClick={() => onEdit(opportunity)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'تعديل' : 'Edit'}</span>
          </button>
          <button
            type="button"
            data-testid="opp-detail-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'حذف' : 'Delete'}</span>
          </button>
        </div>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${stageCfg.badgeClass}`}
              >
                {language === 'ar' ? stageCfg.labelAr : stageCfg.labelEn}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200">
                {language === 'ar'
                  ? OPPORTUNITY_TYPE_LABELS[opportunity.type]?.ar
                  : OPPORTUNITY_TYPE_LABELS[opportunity.type]?.en}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold ${priorityInfo.color}`}
              >
                {priorityInfo.label}
              </span>
            </div>

            <h1 className="text-lg sm:text-xl font-bold text-stone-900 leading-snug">
              {opportunity.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
              {client ? (
                <button
                  type="button"
                  data-testid="opp-detail-open-client-btn"
                  onClick={() => onOpenClient(client.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold hover:bg-emerald-100 transition-colors"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{client.name}</span>
                  {client.company && (
                    <span className="text-emerald-700/80 font-normal">({client.company})</span>
                  )}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600 border border-stone-200 font-medium">
                  <User className="w-3.5 h-3.5" />
                  <span>
                    {language === 'ar'
                      ? 'عميل محذوف أو غير متوفر'
                      : 'Deleted or unavailable client'}
                  </span>
                </span>
              )}

              {opportunity.source && (
                <span className="text-stone-500">
                  {language === 'ar' ? `المصدر: ${opportunity.source}` : `Source: ${opportunity.source}`}
                </span>
              )}
            </div>
          </div>

          {/* Value Box */}
          <div className="sm:text-left shrink-0 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5">
            <span className="block text-[10px] text-stone-500 font-medium">
              {language === 'ar' ? 'القيمة التقديرية' : 'Estimated Value'}
            </span>
            <span className="block text-base sm:text-lg font-extrabold text-stone-900 tabular-nums mt-0.5">
              {typeof opportunity.estimatedValue === 'number' && opportunity.currency
                ? formatOpportunityMoney(opportunity.estimatedValue, opportunity.currency)
                : language === 'ar'
                ? 'غير محددة'
                : 'Not specified'}
            </span>
            {opportunity.expectedCloseDate && (
              <span className="block text-[10px] text-stone-500 tabular-nums mt-1">
                {language === 'ar'
                  ? `الإغلاق المتوقع (تقديري): ${opportunity.expectedCloseDate}`
                  : `Est. close: ${opportunity.expectedCloseDate}`}
              </span>
            )}
          </div>
        </div>

        {/* Stage Stepper */}
        <div className="pt-3 border-t border-stone-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-stone-700">
              {language === 'ar' ? 'مرحلة الفرصة (يتطلب الإغلاق أو إعادة الفتح تأكيداً صريحاً)' : 'Pipeline Stage'}
            </span>
            {closed && (
              <button
                type="button"
                data-testid="opp-reopen-btn"
                onClick={() => onRequestStageChange(opportunity, 'negotiation')}
                className="text-[11px] font-bold text-sky-700 hover:underline"
              >
                {language === 'ar' ? 'إعادة فتح الفرصة' : 'Reopen Opportunity'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
            {OPPORTUNITY_ALL_STAGES.map((stKey) => {
              const cfg = OPPORTUNITY_STAGE_CONFIG[stKey];
              const isCurrent = opportunity.stage === stKey;
              return (
                <button
                  key={stKey}
                  type="button"
                  data-testid={`opp-stage-btn-${stKey}`}
                  disabled={isCurrent}
                  onClick={() => onRequestStageChange(opportunity, stKey)}
                  className={`px-2 py-2 rounded-xl text-[11px] font-bold border text-center transition-all ${
                    isCurrent
                      ? `${cfg.badgeClass} ring-2 ring-emerald-600/20 shadow-2xs`
                      : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:border-stone-300'
                  }`}
                >
                  {language === 'ar' ? cfg.labelAr : cfg.labelEn}
                </button>
              );
            })}
          </div>
        </div>

        {/* Closed / Lost / Reopened Metadata Banner */}
        {(closed || opportunity.reopenedAt || opportunity.lostReason) && (
          <div
            className={`p-3 rounded-xl border text-xs space-y-1 ${
              opportunity.stage === 'won'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : opportunity.stage === 'lost'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-sky-50 border-sky-200 text-sky-900'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3 font-bold">
              {opportunity.stage === 'won' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              {opportunity.stage === 'lost' && <XCircle className="w-4 h-4 shrink-0" />}
              {opportunity.closedAt && (
                <span>
                  {language === 'ar'
                    ? `تاريخ الإغلاق: ${formatArabicDate(opportunity.closedAt)}`
                    : `Closed: ${opportunity.closedAt}`}
                </span>
              )}
              {opportunity.reopenedAt && (
                <span>
                  {language === 'ar'
                    ? `أُعيد فتحها في: ${formatArabicDate(opportunity.reopenedAt)}`
                    : `Reopened: ${opportunity.reopenedAt}`}
                </span>
              )}
            </div>
            {opportunity.lostReason && (
              <p className="text-[11px]">
                {language === 'ar'
                  ? `السبب المسجّل: ${opportunity.lostReason}`
                  : `Reason: ${opportunity.lostReason}`}
              </p>
            )}
          </div>
        )}

        {/* Follow-Up Alerts */}
        {followUpAlerts.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{language === 'ar' ? 'تنبيهات المتابعة لهذه الفرصة' : 'Follow-Up Alerts'}</span>
            </div>
            <ul className="space-y-1 text-[11px] text-amber-800">
              {followUpAlerts.map((alert, idx) => (
                <li key={idx}>
                  <span className="font-semibold">
                    {language === 'ar' ? alert.messageArabic : alert.messageEnglish}
                  </span>
                  {alert.disclosureArabic && (
                    <span className="block text-[10px] text-amber-700/80">
                      {alert.disclosureArabic}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {opportunity.description && (
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700 whitespace-pre-line">
            <span className="block text-[11px] font-bold text-stone-500 mb-1">
              {language === 'ar' ? 'وصف الفرصة والنطاق' : 'Description'}
            </span>
            {opportunity.description}
          </div>
        )}
      </div>

      {/* Action Feedback */}
      {actionFeedback && (
        <div
          data-testid="opp-detail-feedback"
          className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between"
        >
          <span>{actionFeedback}</span>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="text-emerald-700 hover:underline text-[11px]"
          >
            {language === 'ar' ? 'إخفاء' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Next Action Workspace */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-bold text-stone-900">
              {language === 'ar' ? 'الخطوة التالية' : 'Next Action'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {opportunity.nextAction?.trim() && !isEditingNextAction && (
              <button
                type="button"
                data-testid="convert-next-action-btn"
                disabled={isConvertingTask}
                onClick={handleConvertClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-[11px] font-bold hover:bg-emerald-800 disabled:opacity-60 transition-colors"
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>
                  {isConvertingTask
                    ? language === 'ar'
                      ? 'جاري الإنشاء...'
                      : 'Creating...'
                    : language === 'ar'
                    ? 'تحويل إلى مهمة'
                    : 'Convert to Task'}
                </span>
              </button>
            )}
            <button
              type="button"
              data-testid="edit-next-action-btn"
              onClick={() => setIsEditingNextAction((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-bold transition-colors"
            >
              {isEditingNextAction
                ? language === 'ar'
                  ? 'إلغاء'
                  : 'Cancel'
                : language === 'ar'
                ? 'تحديث الخطوة'
                : 'Update Next Action'}
            </button>
          </div>
        </div>

        {isEditingNextAction ? (
          <form onSubmit={handleSaveNextAction} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <input
              type="text"
              data-testid="inline-next-action-input"
              value={nextActionDraft}
              onChange={(e) => setNextActionDraft(e.target.value)}
              maxLength={300}
              placeholder={language === 'ar' ? 'وصف الخطوة التالية...' : 'Next action...'}
              className="sm:col-span-2 px-3 py-2 rounded-xl border border-stone-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
            <input
              type="date"
              data-testid="inline-next-action-date"
              value={nextActionDateDraft}
              onChange={(e) => setNextActionDateDraft(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white tabular-nums focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
            <div className="sm:col-span-3 flex justify-end">
              <button
                type="submit"
                disabled={isSavingNextAction}
                data-testid="inline-next-action-save"
                className="px-4 py-1.5 rounded-xl bg-emerald-700 text-white font-bold hover:bg-emerald-800 disabled:opacity-60"
              >
                {isSavingNextAction
                  ? language === 'ar'
                    ? 'جاري الحفظ...'
                    : 'Saving...'
                  : language === 'ar'
                  ? 'حفظ الخطوة التالية'
                  : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              {opportunity.nextAction?.trim() ? (
                <p className="font-bold text-stone-900">{opportunity.nextAction}</p>
              ) : (
                <p className="text-stone-500">
                  {language === 'ar'
                    ? 'لم تُحدَّد خطوة تالية بعد.'
                    : 'No next action set yet.'}
                </p>
              )}
            </div>
            {opportunity.nextActionDate && (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 font-semibold tabular-nums text-[11px]">
                {language === 'ar'
                  ? `الموعد: ${opportunity.nextActionDate}`
                  : `Due: ${opportunity.nextActionDate}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Linked Meetings & Tasks Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Linked Meetings */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-700" />
              <h3 className="text-sm font-bold text-stone-900">
                {language === 'ar'
                  ? `اللقاءات المرتبطة (${linkedMeetings.length})`
                  : `Linked Meetings (${linkedMeetings.length})`}
              </h3>
            </div>
            <button
              type="button"
              data-testid="opp-new-linked-meeting-btn"
              onClick={() => onCreateLinkedMeeting(opportunity)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-bold hover:bg-sky-100"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'لقاء مرتبط' : 'New Meeting'}</span>
            </button>
          </div>

          {linkableMeetings.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <select
                data-testid="opp-link-existing-meeting-select"
                value={selectedMeetingToLink}
                onChange={(e) => setSelectedMeetingToLink(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
              >
                <option value="">
                  {language === 'ar'
                    ? '-- ربط لقاء قائم لنفس العميل --'
                    : '-- Link existing client meeting --'}
                </option>
                {linkableMeetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({formatArabicDate(m.dateTime)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedMeetingToLink}
                data-testid="opp-link-existing-meeting-btn"
                onClick={async () => {
                  const found = linkableMeetings.find((m) => m.id === selectedMeetingToLink);
                  if (found) {
                    await onLinkMeeting(found, opportunity);
                    setSelectedMeetingToLink('');
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-800 text-white font-bold disabled:opacity-40"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? 'ربط' : 'Link'}</span>
              </button>
            </div>
          )}

          {linkedMeetings.length === 0 ? (
            <p className="text-xs text-stone-400 py-4 text-center">
              {language === 'ar'
                ? 'لا توجد لقاءات مرتبطة بهذه الفرصة حالياً.'
                : 'No linked meetings yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {linkedMeetings.map((m) => (
                <div
                  key={m.id}
                  className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/70 flex items-center justify-between gap-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => onOpenMeeting(m.id)}
                    className="text-right flex-1 min-w-0 hover:text-emerald-700"
                  >
                    <span className="font-bold text-stone-900 block truncate">{m.title}</span>
                    <span className="text-[11px] text-stone-500 block">
                      {formatArabicDate(m.dateTime)}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid={`unlink-meeting-${m.id}`}
                    onClick={() => onUnlinkMeeting(m)}
                    title={language === 'ar' ? 'إلغاء الربط (يحفظ اللقاء)' : 'Unlink (keeps meeting)'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-stone-200 text-[11px] text-stone-600 hover:text-rose-700 hover:border-rose-200 shrink-0"
                  >
                    <Unlink className="w-3 h-3" />
                    <span>{language === 'ar' ? 'فك الربط' : 'Unlink'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked Tasks */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-bold text-stone-900">
                {language === 'ar'
                  ? `المهام المرتبطة (${linkedTasks.length})`
                  : `Linked Tasks (${linkedTasks.length})`}
              </h3>
            </div>
            <button
              type="button"
              data-testid="opp-new-linked-task-btn"
              onClick={() => onCreateLinkedTask(opportunity)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold hover:bg-emerald-100"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'مهمة مرتبطة' : 'New Task'}</span>
            </button>
          </div>

          {linkableTasks.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <select
                data-testid="opp-link-existing-task-select"
                value={selectedTaskToLink}
                onChange={(e) => setSelectedTaskToLink(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
              >
                <option value="">
                  {language === 'ar'
                    ? '-- ربط مهمة قائمة لنفس العميل --'
                    : '-- Link existing client task --'}
                </option>
                {linkableTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedTaskToLink}
                data-testid="opp-link-existing-task-btn"
                onClick={async () => {
                  const found = linkableTasks.find((t) => t.id === selectedTaskToLink);
                  if (found) {
                    await onLinkTask(found, opportunity);
                    setSelectedTaskToLink('');
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-800 text-white font-bold disabled:opacity-40"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? 'ربط' : 'Link'}</span>
              </button>
            </div>
          )}

          {linkedTasks.length === 0 ? (
            <p className="text-xs text-stone-400 py-4 text-center">
              {language === 'ar'
                ? 'لا توجد مهام مرتبطة بهذه الفرصة حالياً.'
                : 'No linked tasks yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {linkedTasks.map((t) => {
                const isDone = t.status === 'completed';
                return (
                  <div
                    key={t.id}
                    className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/70 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => onToggleTaskStatus(t)}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          isDone
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white border-stone-300'
                        }`}
                        aria-label={language === 'ar' ? 'تبديل حالة المهمة' : 'Toggle task'}
                      >
                        {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenTask(t.id)}
                        className="text-right flex-1 min-w-0 hover:text-emerald-700"
                      >
                        <span
                          className={`font-bold block truncate ${
                            isDone ? 'line-through text-stone-400' : 'text-stone-900'
                          }`}
                        >
                          {t.title}
                        </span>
                        {t.dueDate && (
                          <span className="text-[11px] text-stone-500 tabular-nums">
                            {t.dueDate}
                          </span>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      data-testid={`unlink-task-${t.id}`}
                      onClick={() => onUnlinkTask(t)}
                      title={language === 'ar' ? 'إلغاء الربط (يحفظ المهمة)' : 'Unlink (keeps task)'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-stone-200 text-[11px] text-stone-600 hover:text-rose-700 hover:border-rose-200 shrink-0"
                    >
                      <Unlink className="w-3 h-3" />
                      <span>{language === 'ar' ? 'فك الربط' : 'Unlink'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Related Decisions from Linked Meetings */}
      {relatedDecisions.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-700" />
            <h3 className="text-sm font-bold text-stone-900">
              {language === 'ar'
                ? `قرارات مستخلصة من اللقاءات المرتبطة (${relatedDecisions.length})`
                : `Decisions from Linked Meetings (${relatedDecisions.length})`}
            </h3>
          </div>
          <div className="space-y-2">
            {relatedDecisions.map((dec) => (
              <div
                key={`${dec.meetingId}_${dec.decisionId}`}
                className="p-3 rounded-xl bg-amber-50/50 border border-amber-200/80 text-xs flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <p className="font-bold text-stone-900">{dec.text}</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    {language === 'ar' ? `من لقاء: ${dec.meetingTitle}` : `Meeting: ${dec.meetingTitle}`}
                    {dec.ownerName ? ` — المسؤول: ${dec.ownerName}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenMeeting(dec.meetingId)}
                  className="text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  {language === 'ar' ? 'فتح المحضر' : 'Open Meeting'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage Evolution History */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-stone-700" />
            <h3 className="text-sm font-bold text-stone-900">
              {language === 'ar'
                ? `سجل تطور المرحلة (${oppStageEvents.length})`
                : `Stage Transition History (${oppStageEvents.length})`}
            </h3>
          </div>
          <span className="text-[10px] text-stone-500">
            {language === 'ar'
              ? 'سجل تشغيلي مسجّل في التطبيق وليس سجلاً قانونياً ملزماً'
              : 'Operational app history only (not a legal audit trail)'}
          </span>
        </div>

        {oppStageEvents.length === 0 ? (
          <p className="text-xs text-stone-400 py-3 text-center">
            {language === 'ar'
              ? 'لا توجد أحداث انتقال مسجلة بعد لهذه الفرصة.'
              : 'No stage events recorded yet.'}
          </p>
        ) : (
          <div className="space-y-2" data-testid="opp-stage-history-list">
            {oppStageEvents.map((ev) => {
              const toCfg = OPPORTUNITY_STAGE_CONFIG[ev.toStage];
              const fromCfg = ev.fromStage ? OPPORTUNITY_STAGE_CONFIG[ev.fromStage] : null;
              return (
                <div
                  key={ev.id}
                  className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 font-bold text-stone-800">
                      {fromCfg ? (
                        <>
                          <span>{language === 'ar' ? fromCfg.labelAr : fromCfg.labelEn}</span>
                          <span className="text-stone-400">←</span>
                        </>
                      ) : (
                        <Briefcase className="w-3.5 h-3.5 text-emerald-700" />
                      )}
                      <span className="text-emerald-800">
                        {language === 'ar' ? toCfg.labelAr : toCfg.labelEn}
                      </span>
                    </div>
                    {ev.note && <p className="text-[11px] text-stone-600">{ev.note}</p>}
                  </div>
                  <span className="text-[11px] text-stone-500 tabular-nums">
                    {formatArabicDate(ev.occurredAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Safe In-App Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-stone-900/60 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            data-testid="opp-delete-confirm-modal"
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-stone-200 p-5 space-y-4 text-xs"
          >
            <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>{language === 'ar' ? 'تأكيد حذف فرصة العمل' : 'Delete Opportunity'}</span>
            </div>
            <p className="text-stone-700 leading-relaxed">
              {language === 'ar'
                ? `هل أنت متأكد من حذف الفرصة «${opportunity.title}»؟ سيتم الاحتفاظ بالاجتماعات (${linkedMeetings.length}) والمهام (${linkedTasks.length}) المرتبطة بالعميل ولن تُحذف، لكن سيتم إلغاء ربطها بهذه الفرصة.`
                : `Delete "${opportunity.title}"? Linked meetings and tasks will be preserved and unlinked.`}
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl bg-stone-100 font-bold text-stone-700 hover:bg-stone-200"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                data-testid="opp-delete-confirm-btn"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-700 font-bold text-white hover:bg-rose-800 disabled:opacity-60"
              >
                {isDeleting
                  ? language === 'ar'
                    ? 'جاري الحذف...'
                    : 'Deleting...'
                  : language === 'ar'
                  ? 'نعم، احذف الفرصة'
                  : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
