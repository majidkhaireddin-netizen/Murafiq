import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { MeetingAiBriefingResult, MeetingPreparationBrief } from '../types/index.ts';
import { formatArabicDate, getHijriDateString } from '../utils/logic.ts';
import {
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  normalizeAgendaOrder,
  redactTemporaryAttachmentUrls,
} from '../utils/meetingMinutes.ts';
import {
  formatPreparationBriefPlainText,
  isConfirmedInteraction,
  MEETING_GOAL_STATUS_META,
} from '../utils/meetingPreparation.ts';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOME_META,
} from '../utils/communications.ts';
import {
  formatOpportunityValue,
  OPPORTUNITY_STAGE_CONFIG,
} from '../utils/opportunities.ts';
import { Check, Copy, FileText, Printer, X } from 'lucide-react';

interface MeetingPreparationPrintModalProps {
  brief: MeetingPreparationBrief;
  aiBriefing?: MeetingAiBriefingResult | null;
  isOpen: boolean;
  onClose: () => void;
  language?: 'ar' | 'en';
}

export const PreparationDocumentSheet: React.FC<{
  brief: MeetingPreparationBrief;
  aiBriefing?: MeetingAiBriefingResult | null;
  includeAiSummary: boolean;
  language: 'ar' | 'en';
}> = ({ brief, aiBriefing, includeAiSummary, language }) => {
  const isArabic = language === 'ar';
  const dir = isArabic ? 'rtl' : 'ltr';
  const { meeting, client, relationshipSummary, openTasks, opportunitiesContext } = brief;
  const agenda = normalizeAgendaOrder(meeting.agendaItems || []);
  const typeLabel = MEETING_TYPE_LABELS[meeting.type]?.[language] || meeting.type;
  const statusLabel = MEETING_STATUS_LABELS[meeting.status]?.[language] || meeting.status;

  return (
    <article
      dir={dir}
      data-testid="preparation-a4-sheet"
      className="print-container bg-white text-stone-900 mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[12px] leading-relaxed break-words"
      style={{ overflowWrap: 'anywhere' }}
    >
      {/* Header */}
      <header className="pdf-atomic flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b-2 border-stone-900 pb-4 mb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center font-heading font-bold text-sm shrink-0">
              م
            </div>
            <div>
              <div className="font-heading font-extrabold text-base text-stone-950 tracking-tight">
                {isArabic ? 'مُرافق | ملف التحضير للاجتماع' : 'Murafiq | Meeting Preparation Brief'}
              </div>
              <p className="text-[11px] text-stone-500">
                {isArabic
                  ? 'إحاطة تحضيرية شاملة للعميل والالتزامات والقرارات والفرص'
                  : 'Comprehensive Pre-Meeting Client, Commitments & Opportunities Brief'}
              </p>
            </div>
          </div>
        </div>

        <div className="text-start space-y-0.5 text-[11px] text-stone-700 tabular-nums">
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'حالة الاجتماع: ' : 'Meeting Status: '}
            </span>
            <span>{statusLabel}</span>
          </div>
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'حالة المحضر: ' : 'Minutes Status: '}
            </span>
            <span>{brief.minutesStatusLabelAr}</span>
          </div>
          <div>
            <span className="font-semibold text-stone-900">
              {isArabic ? 'التاريخ الميلادي: ' : 'Date: '}
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

      {/* Disclosure Banner */}
      <div className="pdf-atomic mb-4 px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-[11px] text-stone-600">
        {relationshipSummary.recordsDisclosureAr}
      </div>

      {/* Main Title & Basic Info */}
      <section className="pdf-section pdf-atomic mb-5 pb-4 border-b border-stone-200">
        <p className="text-[11px] font-semibold text-emerald-800 mb-1">
          {client?.name || 'عميل غير محدد'}
          {client?.company ? ` — ${client.company}` : ''}
        </p>
        <h1 className="font-heading font-extrabold text-xl text-stone-950 leading-snug mb-3">
          {redactTemporaryAttachmentUrls(meeting.title)}
        </h1>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-stone-50/80 p-3 rounded-xl border border-stone-200 text-[11px]">
          <div>
            <span className="text-stone-500 block">نوع اللقاء والمكان</span>
            <span className="font-semibold text-stone-900">
              {typeLabel}
              {meeting.location ? ` — ${redactTemporaryAttachmentUrls(meeting.location)}` : ''}
            </span>
          </div>
          <div>
            <span className="text-stone-500 block">جهة الاتصال الرئيسية</span>
            <span className="font-semibold text-stone-900">
              {brief.primaryContact
                ? `${brief.primaryContact.name}${brief.primaryContact.title ? ` (${brief.primaryContact.title})` : ''}`
                : 'غير محددة'}
            </span>
          </div>
          <div>
            <span className="text-stone-500 block">آخر تواصل مؤكد</span>
            <span className="font-semibold text-stone-900">
              {relationshipSummary.lastConfirmedContactAt
                ? `${formatArabicDate(relationshipSummary.lastConfirmedContactAt)}${
                    relationshipSummary.daysSinceLastConfirmedContact !== null
                      ? ` (منذ ${relationshipSummary.daysSinceLastConfirmedContact} يوم)`
                      : ''
                  }`
                : 'لا يوجد تواصل مؤكد سابق'}
            </span>
          </div>
          <div>
            <span className="text-stone-500 block">سجلات التواصل</span>
            <span className="font-semibold text-stone-900">
              {relationshipSummary.confirmedInteractionsCount} مؤكد •{' '}
              {relationshipSummary.attemptInteractionsCount} محاولة غير مؤكدة
            </span>
          </div>
        </div>
      </section>

      {/* 1. Preparation Goals & Agenda */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-2.5">
          1. أهداف الاجتماع وجدول الأعمال
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div className="pdf-atomic border border-stone-200 rounded-xl p-3 bg-stone-50/40">
            <div className="font-bold text-stone-900 mb-1.5">
              أهداف الاجتماع ({brief.goals.length})
            </div>
            {brief.goals.length === 0 ? (
              <p className="text-stone-500">لم تُسجل أهداف خاصة لهذا الاجتماع.</p>
            ) : (
              <ol className="space-y-1.5 list-decimal list-inside">
                {brief.goals.map((g) => (
                  <li key={g.id} className="text-stone-800">
                    <span className="font-semibold">{redactTemporaryAttachmentUrls(g.text)}</span>{' '}
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-stone-300 bg-white">
                      {MEETING_GOAL_STATUS_META[g.status]?.labelAr || g.status}
                    </span>
                    {g.note && (
                      <div className="text-stone-500 ps-4 text-[10px]">
                        ملاحظة: {redactTemporaryAttachmentUrls(g.note)}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="pdf-atomic border border-stone-200 rounded-xl p-3 bg-stone-50/40">
            <div className="font-bold text-stone-900 mb-1.5">
              جدول الأعمال ({agenda.length})
            </div>
            {agenda.length === 0 ? (
              <p className="text-stone-500">لا توجد بنود في جدول الأعمال بعد.</p>
            ) : (
              <ol className="space-y-1.5 list-decimal list-inside">
                {agenda.map((item) => (
                  <li key={item.id} className="text-stone-800">
                    <span className="font-semibold">{redactTemporaryAttachmentUrls(item.title)}</span>
                    {item.durationMinutes ? (
                      <span className="text-stone-500"> ({item.durationMinutes} د)</span>
                    ) : null}
                    {item.notes && (
                      <div className="text-stone-500 ps-4 text-[10px]">
                        {redactTemporaryAttachmentUrls(item.notes)}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {brief.preparationNotes.trim() && (
          <div className="pdf-atomic mt-2.5 p-3 rounded-xl border border-stone-200 bg-stone-50/50 text-[11px]">
            <div className="font-bold text-stone-800 mb-1">ملاحظات التحضير الخاصة:</div>
            <p className="whitespace-pre-line text-stone-700">
              {redactTemporaryAttachmentUrls(brief.preparationNotes.trim())}
            </p>
          </div>
        )}
      </section>

      {/* 2. Linked Opportunity & Open Opportunities */}
      {(opportunitiesContext.linkedOpportunity ||
        opportunitiesContext.otherClientOpportunities.length > 0) && (
        <section className="pdf-section pdf-atomic mb-5">
          <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-2.5">
            2. سياق فرص الأعمال
          </h2>
          {opportunitiesContext.linkedOpportunity && (
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 text-[11px] mb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <span className="font-bold text-stone-950">
                  الفرصة المرتبطة بالاجتماع: {opportunitiesContext.linkedOpportunity.title}
                </span>
                <span className="px-2 py-0.5 rounded bg-white border border-stone-200 font-semibold">
                  المرحلة:{' '}
                  {OPPORTUNITY_STAGE_CONFIG[opportunitiesContext.linkedOpportunity.stage]?.labelAr ||
                    opportunitiesContext.linkedOpportunity.stage}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-stone-700">
                <div>
                  القيمة التقديرية:{' '}
                  <span className="font-semibold text-stone-900">
                    {opportunitiesContext.linkedOpportunity.estimatedValue !== undefined &&
                    opportunitiesContext.linkedOpportunity.currency
                      ? formatOpportunityValue(
                          opportunitiesContext.linkedOpportunity.estimatedValue,
                          opportunitiesContext.linkedOpportunity.currency
                        )
                      : 'غير محددة'}
                  </span>
                </div>
                <div>
                  الإغلاق المتوقع:{' '}
                  <span className="font-semibold text-stone-900">
                    {opportunitiesContext.linkedOpportunity.expectedCloseDate || 'غير محدد'}
                  </span>
                </div>
                <div>
                  الإجراء القادم:{' '}
                  <span className="font-semibold text-stone-900">
                    {opportunitiesContext.linkedOpportunity.nextAction || 'غير محدد'}
                    {opportunitiesContext.linkedOpportunity.nextActionDate
                      ? ` (${opportunitiesContext.linkedOpportunity.nextActionDate})`
                      : ''}
                  </span>
                </div>
              </div>
            </div>
          )}

          {opportunitiesContext.otherClientOpportunities.length > 0 && (
            <div className="p-3 rounded-xl border border-stone-200 bg-stone-50/40 text-[11px]">
              <div className="font-bold text-stone-800 mb-1">
                فرص أخرى مفتوحة مرتبطة بالعميل ({opportunitiesContext.otherClientOpportunities.length}):
              </div>
              <ul className="space-y-1">
                {opportunitiesContext.otherClientOpportunities.map((opp) => (
                  <li key={opp.id} className="text-stone-700">
                    • <span className="font-semibold text-stone-900">{opp.title}</span> — المرحلة:{' '}
                    {OPPORTUNITY_STAGE_CONFIG[opp.stage]?.labelAr || opp.stage}
                    {opp.estimatedValue !== undefined && opp.currency
                      ? ` — القيمة: ${formatOpportunityValue(opp.estimatedValue, opp.currency)}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 3. Open Commitments & Tasks */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-2.5">
          3. الالتزامات والمهام المفتوحة ({openTasks.totalOpenCount})
        </h2>
        {openTasks.totalOpenCount === 0 ? (
          <p className="text-[11px] text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
            لا توجد مهام مفتوحة مرتبطة بهذا العميل حاليًا.
          </p>
        ) : (
          <div className="space-y-1.5 text-[11px]">
            {[
              ...openTasks.overdue.map((t) => ({ t, label: 'متأخرة', cls: 'text-rose-800 bg-rose-50 border-rose-200' })),
              ...openTasks.dueToday.map((t) => ({ t, label: 'اليوم', cls: 'text-amber-800 bg-amber-50 border-amber-200' })),
              ...openTasks.upcoming.map((t) => ({ t, label: 'قادمة', cls: 'text-emerald-800 bg-emerald-50 border-emerald-200' })),
              ...openTasks.noDueDate.map((t) => ({ t, label: 'بدون تاريخ', cls: 'text-stone-700 bg-stone-100 border-stone-200' })),
            ].map(({ t, label, cls }) => (
              <div
                key={t.id}
                className="pdf-atomic flex items-center justify-between gap-2 p-2 rounded-lg border border-stone-200 bg-white"
              >
                <div>
                  <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold me-2 ${cls}`}>
                    {label}
                  </span>
                  <span className="font-semibold text-stone-900">
                    {redactTemporaryAttachmentUrls(t.title)}
                  </span>
                </div>
                <span className="text-stone-500 tabular-nums shrink-0">
                  {t.dueDate ? `الاستحقاق: ${t.dueDate}` : 'غير محدد'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Previous Meetings & Decisions */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-2.5">
          4. ملخص الاجتماعات السابقة والقرارات ({brief.previousMeetings.length})
        </h2>
        {brief.previousMeetings.length === 0 ? (
          <p className="text-[11px] text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
            لا توجد اجتماعات سابقة منعقدة مسجلة لهذا العميل.
          </p>
        ) : (
          <div className="space-y-2.5 text-[11px]">
            {brief.previousMeetings.map((pm) => (
              <div
                key={pm.meeting.id}
                className="pdf-atomic p-3 rounded-xl border border-stone-200 bg-stone-50/40"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-bold text-stone-900">{pm.meeting.title}</span>
                  <span className="text-stone-500 tabular-nums">
                    {formatArabicDate(pm.meeting.dateTime)}
                  </span>
                </div>
                {pm.summaryExcerpt && (
                  <p className="text-stone-700 mb-1.5">{pm.summaryExcerpt}</p>
                )}
                {pm.decisions.length > 0 && (
                  <div className="text-stone-800">
                    <span className="font-semibold">القرارات: </span>
                    {pm.decisions.map((d) => d.text).join(' • ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Recent Interactions */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-950 border-b border-stone-300 pb-1 mb-2.5">
          5. آخر التفاعلات المسجلة ({relationshipSummary.recentInteractions.length})
        </h2>
        {relationshipSummary.recentInteractions.length === 0 ? (
          <p className="text-[11px] text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
            لا توجد تفاعلات مسجلة داخل التطبيق.
          </p>
        ) : (
          <div className="space-y-1.5 text-[11px]">
            {relationshipSummary.recentInteractions.map((item) => {
              const confirmed = isConfirmedInteraction(item);
              return (
                <div
                  key={item.id}
                  className="pdf-atomic p-2.5 rounded-lg border border-stone-200 bg-white flex items-start justify-between gap-2"
                >
                  <div>
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold me-1.5 ${
                        confirmed
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {confirmed ? 'تواصل مؤكد' : 'محاولة غير مؤكدة'}
                    </span>
                    <span className="font-semibold text-stone-900">{item.subject}</span>
                    <span className="text-stone-500 ms-1.5">
                      ({COMMUNICATION_CHANNEL_META[item.channel]?.labelAr || item.channel} —{' '}
                      {COMMUNICATION_OUTCOME_META[item.outcome]?.labelAr || item.outcome})
                    </span>
                    {item.nextStep && (
                      <div className="text-stone-600 text-[10px] mt-0.5">
                        الخطوة التالية: {item.nextStep}
                      </div>
                    )}
                  </div>
                  <span className="text-stone-500 tabular-nums shrink-0">
                    {item.occurredAt.slice(0, 10)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Optional AI Executive Briefing (Only if explicitly generated and checked by user) */}
      {includeAiSummary && aiBriefing && (
        <section className="pdf-section pdf-atomic mb-5 p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/30 text-[11px]">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h2 className="font-heading font-bold text-sm text-indigo-950">
              6. الموجز التنفيذي المساعد (مقترح ذكاء اصطناعي للمراجعة البشرية)
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-semibold">
              مقترح ذكي غير ملزم
            </span>
          </div>
          <p className="text-stone-800 whitespace-pre-line mb-2">{aiBriefing.executiveBriefing}</p>
          {aiBriefing.suggestedQuestions.length > 0 && (
            <div>
              <div className="font-bold text-stone-900 mb-1">أسئلة مقترحة لطرحها:</div>
              <ul className="space-y-0.5 text-stone-700">
                {aiBriefing.suggestedQuestions.map((q, i) => (
                  <li key={i}>• {q}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer className="pdf-atomic pt-3 border-t border-stone-200 flex items-center justify-between text-[10px] text-stone-500">
        <span>تم إنشاء ملف التحضير محليًا عبر تطبيق مُرافق</span>
        <span className="tabular-nums">{new Date().toISOString().slice(0, 10)}</span>
      </footer>
    </article>
  );
};

export const MeetingPreparationPrintModal: React.FC<MeetingPreparationPrintModalProps> = ({
  brief,
  aiBriefing,
  isOpen,
  onClose,
  language = 'ar',
}) => {
  const [copied, setCopied] = useState(false);
  const [includeAiSummary, setIncludeAiSummary] = useState(Boolean(aiBriefing));

  if (!isOpen) return null;

  const isArabic = language === 'ar';

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    const text = formatPreparationBriefPlainText(brief);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Ignore clipboard failures
    }
  };

  const printPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <div id="murafiq-print-portal">
            <PreparationDocumentSheet
              brief={brief}
              aiBriefing={aiBriefing}
              includeAiSummary={includeAiSummary}
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
        data-testid="preparation-print-modal"
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
                  {isArabic ? 'معاينة وطباعة ملف التحضير للاجتماع (A4)' : 'Meeting Preparation Brief Print Preview'}
                </h3>
                <p className="text-[11px] text-stone-500">
                  {isArabic
                    ? 'ملف تحضيري منسق للطباعة أو الحفظ كـ PDF بنص عربي متصل'
                    : 'Formatted A4 preparation brief for printing or saving as PDF'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {aiBriefing && (
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAiSummary}
                    onChange={(e) => setIncludeAiSummary(e.target.checked)}
                    className="accent-indigo-700 rounded"
                  />
                  <span>تضمين الموجز الذكي</span>
                </label>
              )}

              <button
                type="button"
                data-testid="preparation-print-confirm-btn"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isArabic ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}</span>
              </button>

              <button
                type="button"
                data-testid="preparation-copy-text-btn"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Preview Body */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="shadow-sm border border-stone-200 rounded-xl overflow-hidden bg-white mx-auto max-w-[210mm]">
              <PreparationDocumentSheet
                brief={brief}
                aiBriefing={aiBriefing}
                includeAiSummary={includeAiSummary}
                language={language}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
