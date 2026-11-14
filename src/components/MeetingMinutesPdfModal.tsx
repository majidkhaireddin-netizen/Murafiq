import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ActionItem,
  Client,
  Meeting,
  MinutesSectionKey,
  TaskPriority,
  TaskStatus,
} from '../types';
import { formatArabicDate, getHijriDateString } from '../utils/logic';
import {
  ALL_MINUTES_SECTIONS,
  DEFAULT_MINUTES_SECTIONS,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  MINUTES_FINAL_DISCLAIMER_AR,
  MINUTES_FINAL_DISCLAIMER_EN,
  MINUTES_STATUS_CONFIG,
  formatMinutesPlainText,
  getDiscussionSectionsForDisplay,
  getEffectiveParticipants,
  getMinutesStatus,
  normalizeAgendaOrder,
  redactTemporaryAttachmentUrls,
} from '../utils/meetingMinutes';
import { Check, Copy, FileText, Printer, Save, Share2, SlidersHorizontal, X } from 'lucide-react';

interface MeetingMinutesPdfModalProps {
  meeting: Meeting;
  client?: Client;
  tasks: ActionItem[];
  isOpen: boolean;
  onClose: () => void;
  onSaveMeeting?: (meeting: Meeting) => Promise<void> | void;
  language: 'ar' | 'en';
}

interface MinutesDocumentSheetProps {
  meeting: Meeting;
  client?: Client;
  linkedTasks: ActionItem[];
  includedSections: MinutesSectionKey[];
  additionalNotes: string;
  language: 'ar' | 'en';
}

function getTaskStatusLabel(status: TaskStatus, language: 'ar' | 'en'): string {
  if (language === 'en') {
    if (status === 'completed') return 'Completed';
    if (status === 'in_progress') return 'In Progress';
    if (status === 'cancelled') return 'Cancelled';
    return 'Pending';
  }
  if (status === 'completed') return 'منجزة';
  if (status === 'in_progress') return 'قيد التنفيذ';
  if (status === 'cancelled') return 'ملغاة';
  return 'معلقة';
}

function getTaskPriorityLabel(priority: TaskPriority, language: 'ar' | 'en'): string {
  if (language === 'en') {
    if (priority === 'urgent') return 'Urgent';
    if (priority === 'high') return 'High';
    if (priority === 'medium') return 'Medium';
    return 'Low';
  }
  if (priority === 'urgent') return 'عاجلة';
  if (priority === 'high') return 'عالية';
  if (priority === 'medium') return 'متوسطة';
  return 'منخفضة';
}

export const MinutesDocumentSheet: React.FC<MinutesDocumentSheetProps> = ({
  meeting,
  client,
  linkedTasks,
  includedSections,
  additionalNotes,
  language,
}) => {
  const includeSet = new Set<MinutesSectionKey>(includedSections);
  const isArabic = language === 'ar';
  const dir = isArabic ? 'rtl' : 'ltr';

  const minutesStatus = getMinutesStatus(meeting);
  const statusMeta = MINUTES_STATUS_CONFIG[minutesStatus];
  const participants = getEffectiveParticipants(meeting);
  const internalParticipants = participants.filter((p) => p.party === 'internal');
  const externalParticipants = participants.filter((p) => p.party === 'external');
  const agenda = normalizeAgendaOrder(meeting.agendaItems || []);
  const decisions = meeting.decisions || [];
  const discussions = getDiscussionSectionsForDisplay(meeting);
  const safeAdditionalNotes = redactTemporaryAttachmentUrls(additionalNotes.trim());
  const typeLabel = MEETING_TYPE_LABELS[meeting.type]?.[language] || meeting.type;
  const meetingStatusLabel = MEETING_STATUS_LABELS[meeting.status]?.[language] || meeting.status;

  let sectionCounter = 0;
  const nextSectionPrefix = () => {
    sectionCounter += 1;
    return `${sectionCounter}.`;
  };

  return (
    <article
      dir={dir}
      data-testid="minutes-a4-sheet"
      className="print-container bg-white text-stone-900 mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[12px] leading-relaxed break-words"
      style={{ overflowWrap: 'anywhere' }}
    >
      {/* Document Header */}
      <header className="pdf-atomic flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b-2 border-stone-900 pb-4 mb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center font-heading font-bold text-sm shrink-0">
              م
            </div>
            <div>
              <div className="font-heading font-extrabold text-base text-stone-950 tracking-tight">
                {isArabic ? 'مُرافق | محضر اجتماع' : 'Murafiq | Meeting Minutes'}
              </div>
              <p className="text-[11px] text-stone-500">
                {isArabic
                  ? 'توثيق منظم للاجتماعات والقرارات والالتزامات'
                  : 'Structured Meetings, Decisions & Commitments Record'}
              </p>
            </div>
          </div>
        </div>

        <div className="text-start space-y-0.5 text-[11px] text-stone-700 tabular-nums">
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'حالة المحضر: ' : 'Minutes Status: '}
            </span>
            <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${statusMeta.badgeClass}`}>
              {isArabic ? statusMeta.labelAr : statusMeta.labelEn}
            </span>
          </div>
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'رقم المرجع: ' : 'Reference: '}
            </span>
            <span className="font-mono">MIN-{meeting.id.replace('m-', '').toUpperCase()}</span>
          </div>
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'التاريخ الميلادي: ' : 'Gregorian Date: '}
            </span>
            <span>{formatArabicDate(meeting.dateTime, true)}</span>
          </div>
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'التاريخ الهجري: ' : 'Hijri Date: '}
            </span>
            <span>{getHijriDateString(meeting.dateTime)}</span>
          </div>
        </div>
      </header>

      {/* Main Title */}
      <div className="pdf-heading mb-5 pb-3 border-b border-stone-200">
        <p className="text-[11px] font-semibold text-emerald-800 mb-1">
          {client?.name || (isArabic ? 'عميل غير محدد' : 'Unspecified Client')}
          {client?.company ? ` — ${client.company}` : ''}
        </p>
        <h1 className="font-heading font-extrabold text-xl text-stone-950 leading-snug">
          {redactTemporaryAttachmentUrls(meeting.title)}
        </h1>
      </div>

      {/* 1. Basic Info */}
      {includeSet.has('basicInfo') && (
        <section className="pdf-section pdf-atomic mb-6" data-testid="pdf-section-basicInfo">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'المعلومات الأساسية' : 'Basic Information'}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 bg-stone-50/70 p-3.5 rounded-xl border border-stone-200 text-[11px] tabular-nums">
            <div>
              <span className="text-stone-500 block">{isArabic ? 'عنوان اللقاء' : 'Title'}</span>
              <span className="font-bold text-stone-900">{meeting.title}</span>
            </div>
            <div>
              <span className="text-stone-500 block">{isArabic ? 'العميل / الجهة' : 'Client'}</span>
              <span className="font-bold text-stone-900">
                {client?.name || (isArabic ? 'غير محدد' : 'N/A')}
                {client?.company ? ` (${client.company})` : ''}
              </span>
            </div>
            <div>
              <span className="text-stone-500 block">{isArabic ? 'التاريخ والوقت' : 'Date & Time'}</span>
              <span className="font-semibold text-stone-900">
                {formatArabicDate(meeting.dateTime, true)}
              </span>
            </div>
            <div>
              <span className="text-stone-500 block">{isArabic ? 'نوع اللقاء' : 'Type'}</span>
              <span className="font-semibold text-stone-900">{typeLabel}</span>
            </div>
            <div>
              <span className="text-stone-500 block">{isArabic ? 'المكان / القناة' : 'Location'}</span>
              <span className="font-semibold text-stone-900">
                {meeting.location ? redactTemporaryAttachmentUrls(meeting.location) : isArabic ? 'غير محدد' : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-stone-500 block">{isArabic ? 'المدة والحالة' : 'Duration & Status'}</span>
              <span className="font-semibold text-stone-900">
                {meeting.duration ? `${meeting.duration} ${isArabic ? 'دقيقة' : 'min'}` : '—'} •{' '}
                {meetingStatusLabel}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 2. Participants */}
      {includeSet.has('participants') && (
        <section className="pdf-section mb-6" data-testid="pdf-section-participants">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'المشاركون' : 'Participants'}
          </h2>
          {participants.length === 0 ? (
            <p className="text-stone-500 text-[11px] bg-stone-50 p-3 rounded-lg border border-stone-200">
              {isArabic ? 'لم يتم تسجيل أسماء مشاركين لهذا اللقاء.' : 'No participants recorded.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
              <div className="pdf-atomic border border-stone-200 rounded-xl p-3 bg-stone-50/50">
                <div className="font-bold text-stone-800 mb-1.5">
                  {isArabic ? 'الفريق الداخلي' : 'Internal Participants'} ({internalParticipants.length})
                </div>
                {internalParticipants.length === 0 ? (
                  <p className="text-stone-400">{isArabic ? 'لا يوجد' : 'None'}</p>
                ) : (
                  <ul className="space-y-1 text-stone-800">
                    {internalParticipants.map((p) => (
                      <li key={p.id}>
                        • <span className="font-semibold">{p.name}</span>
                        {p.role ? <span className="text-stone-500"> — {p.role}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pdf-atomic border border-stone-200 rounded-xl p-3 bg-stone-50/50">
                <div className="font-bold text-stone-800 mb-1.5">
                  {isArabic ? 'المشاركون الخارجيون / جهة العميل' : 'External / Client Participants'} ({externalParticipants.length})
                </div>
                {externalParticipants.length === 0 ? (
                  <p className="text-stone-400">{isArabic ? 'لا يوجد' : 'None'}</p>
                ) : (
                  <ul className="space-y-1 text-stone-800">
                    {externalParticipants.map((p) => (
                      <li key={p.id}>
                        • <span className="font-semibold">{p.name}</span>
                        {p.role ? <span className="text-stone-500"> — {p.role}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Agenda */}
      {includeSet.has('agenda') && (
        <section className="pdf-section mb-6" data-testid="pdf-section-agenda">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'جدول الأعمال' : 'Agenda'}
          </h2>
          {agenda.length === 0 ? (
            <p className="text-stone-500 text-[11px] bg-stone-50 p-3 rounded-lg border border-stone-200">
              {isArabic ? 'لم تُضف بنود جدول أعمال منفصلة.' : 'No agenda items added.'}
            </p>
          ) : (
            <div className="space-y-2">
              {agenda.map((item) => (
                <div
                  key={item.id}
                  className="pdf-atomic border border-stone-200 rounded-xl p-3 bg-white"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-stone-900 text-xs tabular-nums">
                      {item.order}. {redactTemporaryAttachmentUrls(item.title)}
                    </div>
                    {item.durationMinutes ? (
                      <span className="text-[10px] font-mono text-stone-500 shrink-0 tabular-nums">
                        {item.durationMinutes} {isArabic ? 'د' : 'min'}
                      </span>
                    ) : null}
                  </div>
                  {item.notes ? (
                    <p className="text-[11px] text-stone-700 mt-1.5 whitespace-pre-line leading-relaxed">
                      {redactTemporaryAttachmentUrls(item.notes)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 4. Discussions Summary */}
      {includeSet.has('discussions') && (
        <section className="pdf-section mb-6" data-testid="pdf-section-discussions">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'ملخص المناقشات' : 'Discussions Summary'}
          </h2>
          <div className="border border-stone-200 rounded-xl p-4 bg-stone-50/40 text-xs text-stone-800 whitespace-pre-line leading-relaxed">
            {discussions.primarySummary ||
              (isArabic ? 'لا يوجد ملخص مناقشات مسجل.' : 'No discussion summary recorded.')}
          </div>
          {discussions.hasSeparateLegacyNotes && (
            <div className="mt-2.5 border border-stone-200 rounded-xl p-3.5 bg-white">
              <div className="text-[11px] font-bold text-stone-700 mb-1">
                {isArabic ? 'ملاحظات اللقاء الإضافية / السابقة:' : 'Additional / Previous Notes:'}
              </div>
              <div className="text-[11px] text-stone-700 whitespace-pre-line leading-relaxed">
                {discussions.legacyNotes}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5. Decisions */}
      {includeSet.has('decisions') && (
        <section className="pdf-section mb-6" data-testid="pdf-section-decisions">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'القرارات المعتمدة' : 'Decisions'}
          </h2>
          {decisions.length === 0 ? (
            <p className="text-stone-500 text-[11px] bg-stone-50 p-3 rounded-lg border border-stone-200">
              {isArabic ? 'لا توجد قرارات مسجلة في هذا المحضر.' : 'No decisions recorded.'}
            </p>
          ) : (
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <table className="w-full text-[11px] text-start">
                <thead className="bg-stone-100 text-stone-800 font-bold border-b border-stone-200">
                  <tr>
                    <th className="py-2 px-3 text-start w-10 tabular-nums">#</th>
                    <th className="py-2 px-3 text-start">{isArabic ? 'القرار' : 'Decision'}</th>
                    <th className="py-2 px-3 text-start w-44">
                      {isArabic ? 'البند المرتبط' : 'Agenda Item'}
                    </th>
                    <th className="py-2 px-3 text-start w-32">
                      {isArabic ? 'المسؤول' : 'Owner'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {decisions.map((decision, idx) => {
                    const linkedAgenda = agenda.find((a) => a.id === decision.agendaItemId);
                    return (
                      <tr key={decision.id}>
                        <td className="py-2.5 px-3 font-mono text-stone-500 tabular-nums align-top">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-stone-900 align-top whitespace-pre-line">
                          {redactTemporaryAttachmentUrls(decision.text)}
                        </td>
                        <td className="py-2.5 px-3 text-stone-600 align-top">
                          {linkedAgenda ? `${linkedAgenda.order}. ${linkedAgenda.title}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700 align-top">
                          {decision.ownerName || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 6. Linked Tasks / Commitments */}
      {includeSet.has('tasks') && (
        <section className="pdf-section mb-6" data-testid="pdf-section-tasks">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'المهام والالتزامات المرتبطة' : 'Linked Action Items'}
          </h2>
          {linkedTasks.length === 0 ? (
            <p className="text-stone-500 text-[11px] bg-stone-50 p-3 rounded-lg border border-stone-200">
              {isArabic
                ? 'لا توجد مهام أو التزامات مرتبطة بهذا اللقاء.'
                : 'No action items linked to this meeting.'}
            </p>
          ) : (
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <table className="w-full text-[11px] text-start">
                <thead className="bg-stone-100 text-stone-800 font-bold border-b border-stone-200">
                  <tr>
                    <th className="py-2 px-3 text-start w-10 tabular-nums">#</th>
                    <th className="py-2 px-3 text-start">
                      {isArabic ? 'المهمة / الالتزام' : 'Task / Commitment'}
                    </th>
                    <th className="py-2 px-3 text-start w-28">{isArabic ? 'الحالة' : 'Status'}</th>
                    <th className="py-2 px-3 text-start w-28">
                      {isArabic ? 'الاستحقاق' : 'Due Date'}
                    </th>
                    <th className="py-2 px-3 text-start w-20">
                      {isArabic ? 'الأهمية' : 'Priority'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {linkedTasks.map((task, idx) => (
                    <tr key={task.id}>
                      <td className="py-2.5 px-3 font-mono text-stone-500 tabular-nums align-top">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <span className="font-semibold text-stone-900 block">
                          {redactTemporaryAttachmentUrls(task.title)}
                        </span>
                        {task.description ? (
                          <span className="text-[10px] text-stone-600 block mt-0.5 whitespace-pre-line">
                            {redactTemporaryAttachmentUrls(task.description)}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-stone-800 align-top">
                        {getTaskStatusLabel(task.status, language)}
                      </td>
                      <td className="py-2.5 px-3 text-stone-700 tabular-nums align-top">
                        {task.dueDate ? formatArabicDate(task.dueDate) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-stone-700 align-top">
                        {getTaskPriorityLabel(task.priority, language)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 7. Next Follow-up */}
      {includeSet.has('followUp') && (
        <section className="pdf-section pdf-atomic mb-6" data-testid="pdf-section-followUp">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'موعد المتابعة القادم' : 'Next Follow-up'}
          </h2>
          <div className="border border-stone-200 rounded-xl p-3.5 bg-stone-50/50 text-xs text-stone-800 tabular-nums">
            {meeting.followUpDateTime ? (
              <div>
                <span className="font-bold text-stone-900">
                  {isArabic ? 'التاريخ والوقت المقترح للمتابعة: ' : 'Scheduled Follow-up: '}
                </span>
                <span>{formatArabicDate(meeting.followUpDateTime, true)}</span>
              </div>
            ) : meeting.isFollowUpScheduled ? (
              <span>
                {isArabic
                  ? 'تم تأكيد الحاجة إلى متابعة قادمة (بدون تحديد تاريخ دقيق بعد).'
                  : 'Follow-up requested (exact date pending).'}
              </span>
            ) : (
              <span className="text-stone-500">
                {isArabic ? 'لم يُحدد موعد متابعة قادم.' : 'No follow-up date scheduled.'}
              </span>
            )}
          </div>
        </section>
      )}

      {/* 8. Additional Notes */}
      {includeSet.has('additionalNotes') && (
        <section className="pdf-section pdf-atomic mb-6" data-testid="pdf-section-additionalNotes">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-3">
            {nextSectionPrefix()} {isArabic ? 'ملاحظات إضافية' : 'Additional Notes'}
          </h2>
          <div className="border border-stone-200 rounded-xl p-3.5 bg-white min-h-[56px] text-xs text-stone-800 whitespace-pre-line leading-relaxed">
            {safeAdditionalNotes ||
              (isArabic
                ? 'مساحة ملاحظات إضافية (لا توجد ملاحظات مضافة).'
                : 'No additional notes added.')}
          </div>
        </section>
      )}

      {/* Document Footer & Non-Legal Status Clarification */}
      <footer className="pdf-atomic mt-8 pt-3 border-t border-stone-300 text-[10px] text-stone-500 space-y-1">
        <p className="font-medium text-stone-700">
          {isArabic ? MINUTES_FINAL_DISCLAIMER_AR : MINUTES_FINAL_DISCLAIMER_EN}
        </p>
        <p>
          {isArabic
            ? 'تم إعداد هذا المحضر من البيانات المحلية في مُرافق دون تضمين روابط أو أسرار مرفقات مؤقتة.'
            : 'Generated locally in Murafiq without embedding temporary attachment URLs or secrets.'}
        </p>
      </footer>
    </article>
  );
};

export const MeetingMinutesPdfModal: React.FC<MeetingMinutesPdfModalProps> = ({
  meeting,
  client,
  tasks,
  isOpen,
  onClose,
  onSaveMeeting,
  language,
}) => {
  const isArabic = language === 'ar';
  const [copied, setCopied] = useState(false);
  const [showSectionOptions, setShowSectionOptions] = useState(false);
  const [includedSections, setIncludedSections] = useState<MinutesSectionKey[]>(
    meeting.minutesIncludedSections && meeting.minutesIncludedSections.length > 0
      ? meeting.minutesIncludedSections
      : DEFAULT_MINUTES_SECTIONS
  );
  const [additionalNotes, setAdditionalNotes] = useState<string>(
    meeting.minutesAdditionalNotes || ''
  );
  const [savedPrefsNotice, setSavedPrefsNotice] = useState(false);

  useEffect(() => {
    setIncludedSections(
      meeting.minutesIncludedSections && meeting.minutesIncludedSections.length > 0
        ? meeting.minutesIncludedSections
        : DEFAULT_MINUTES_SECTIONS
    );
    setAdditionalNotes(meeting.minutesAdditionalNotes || '');
    setSavedPrefsNotice(false);
  }, [meeting.id, meeting.minutesIncludedSections, meeting.minutesAdditionalNotes]);

  if (!isOpen) return null;

  const linkedTasks = tasks.filter((t) => t.meetingId === meeting.id);

  const toggleSection = (key: MinutesSectionKey) => {
    setIncludedSections((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // Keep at least one section selected
        return prev.filter((k) => k !== key);
      }
      const ordered = ALL_MINUTES_SECTIONS.map((s) => s.key);
      return ordered.filter((k) => k === key || prev.includes(k));
    });
  };

  const handleSavePdfPreferences = async () => {
    if (!onSaveMeeting) return;
    const updated: Meeting = {
      ...meeting,
      minutesIncludedSections: includedSections,
      minutesAdditionalNotes: additionalNotes,
      updatedAt: new Date().toISOString(),
    };
    await onSaveMeeting(updated);
    setSavedPrefsNotice(true);
    setTimeout(() => setSavedPrefsNotice(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = async () => {
    const text = formatMinutesPlainText({
      meeting,
      clientName: client?.name,
      clientCompany: client?.company,
      linkedTasks,
      includedSections,
      additionalNotes,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const whatsappSummary = encodeURIComponent(
    `${isArabic ? 'السلام عليكم، إليكم ملخص محضر اجتماع' : 'Meeting Minutes Summary'}: "${meeting.title}"\n${
      isArabic ? 'التاريخ' : 'Date'
    }: ${formatArabicDate(meeting.dateTime, true)}`
  );
  const cleanPhone = client?.phone?.replace(/[^0-9]/g, '') || '';
  const whatsappUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${whatsappSummary}`
    : `https://wa.me/?text=${whatsappSummary}`;

  const printPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <div id="murafiq-print-portal">
            <MinutesDocumentSheet
              meeting={meeting}
              client={client}
              linkedTasks={linkedTasks}
              includedSections={includedSections}
              additionalNotes={additionalNotes}
              language={language}
            />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {printPortal}

      <div
        data-testid="minutes-pdf-modal"
        className="no-print fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/65 backdrop-blur-xs overflow-y-auto"
      >
        <div className="bg-stone-100 rounded-2xl shadow-2xl max-w-4xl w-full my-auto overflow-hidden border border-stone-200 max-h-[94vh] flex flex-col">
          {/* Toolbar */}
          <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between flex-wrap gap-2 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center font-bold text-xs">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-heading font-bold text-stone-900 text-sm">
                  {isArabic ? 'معاينة وتصدير محضر الاجتماع (A4)' : 'Meeting Minutes A4 Preview & Export'}
                </h3>
                <p className="text-[11px] text-stone-500">
                  {isArabic
                    ? 'اختر الأقسام المطلوبة ثم اطبع أو احفظ كـ PDF بنص عربي متصل'
                    : 'Choose sections to include, then Print or Save as PDF'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                data-testid="toggle-pdf-sections-btn"
                onClick={() => setShowSectionOptions((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                  showSectionOptions
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{isArabic ? 'تخصيص الأقسام والملاحظات' : 'Customize Sections'}</span>
              </button>

              <button
                type="button"
                data-testid="print-pdf-btn"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isArabic ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}</span>
              </button>

              <button
                type="button"
                data-testid="copy-minutes-text-btn"
                onClick={() => void handleCopyText()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? (isArabic ? 'تم النسخ' : 'Copied') : isArabic ? 'نسخ النص' : 'Copy Text'}</span>
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>{isArabic ? 'واتساب' : 'WhatsApp'}</span>
              </a>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
                aria-label={isArabic ? 'إغلاق المعاينة' : 'Close Preview'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Section Selection & Additional Notes Customization Drawer */}
          {showSectionOptions && (
            <div
              data-testid="pdf-section-options-panel"
              className="bg-white border-b border-stone-200 px-4 py-3 space-y-3 text-xs shrink-0"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-stone-900">
                  {isArabic ? 'الأقسام المضمنة في المحضر النهائي:' : 'Sections included in Minutes:'}
                </span>
                <div className="flex items-center gap-2">
                  {savedPrefsNotice && (
                    <span className="text-[11px] font-medium text-emerald-700">
                      {isArabic ? 'تم حفظ تفضيلات المحضر' : 'Preferences saved'}
                    </span>
                  )}
                  {onSaveMeeting && (
                    <button
                      type="button"
                      data-testid="save-pdf-preferences-btn"
                      onClick={() => void handleSavePdfPreferences()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold"
                    >
                      <Save className="w-3 h-3" />
                      <span>{isArabic ? 'حفظ الاختيارات في اللقاء' : 'Save Choices'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ALL_MINUTES_SECTIONS.map((sec) => {
                  const checked = includedSections.includes(sec.key);
                  return (
                    <label
                      key={sec.key}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-emerald-50/70 border-emerald-300 text-stone-900 font-medium'
                          : 'bg-stone-50 border-stone-200 text-stone-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSection(sec.key)}
                        className="accent-emerald-700 rounded"
                      />
                      <span className="text-[11px]">
                        {isArabic ? sec.labelAr : sec.labelEn}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1 text-[11px]">
                  {isArabic
                    ? 'مساحة ملاحظات إضافية تظهر في أسفل المحضر:'
                    : 'Additional notes area for exported minutes:'}
                </label>
                <textarea
                  rows={2}
                  data-testid="pdf-additional-notes-input"
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder={
                    isArabic
                      ? 'أضف أي ملاحظات ختامية أو توضيحات قبل الطباعة أو الحفظ...'
                      : 'Add closing notes before printing or exporting...'
                  }
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>
            </div>
          )}

          {/* Live A4 Preview Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="shadow-sm border border-stone-200 rounded-xl overflow-hidden bg-white mx-auto max-w-[210mm]">
              <MinutesDocumentSheet
                meeting={meeting}
                client={client}
                linkedTasks={linkedTasks}
                includedSections={includedSections}
                additionalNotes={additionalNotes}
                language={language}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
