import React from 'react';
import { createPortal } from 'react-dom';
import { AnalyticsReportSnapshot } from '../utils/analytics';
import { formatArabicDate } from '../utils/logic';
import { Printer, X } from 'lucide-react';

interface AnalyticsPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: AnalyticsReportSnapshot;
  language: 'ar' | 'en';
}

const AnalyticsPrintSheet: React.FC<{
  snapshot: AnalyticsReportSnapshot;
  language: 'ar' | 'en';
}> = ({ snapshot, language }) => {
  const isAr = language === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const { kpis, range, previousRange, comparisons, insights } = snapshot;

  const kpiItems: { label: string; value: string | number; scope: string }[] = [
    {
      label: isAr ? 'إجمالي العملاء' : 'Total Clients',
      value: kpis.totalClients,
      scope: isAr ? 'تراكمي' : 'Cumulative',
    },
    {
      label: isAr ? 'العملاء الجدد في الفترة' : 'New Clients in Period',
      value: kpis.newClientsInPeriod,
      scope: isAr ? range.labelAr : range.labelEn,
    },
    {
      label: isAr ? 'عملاء باجتماعات مسجلة' : 'Clients with Meetings',
      value: kpis.clientsWithMeetingsInPeriod,
      scope: isAr ? range.labelAr : range.labelEn,
    },
    {
      label: isAr ? 'عملاء يحتاجون إلى متابعة' : 'Clients Needing Follow-up',
      value: kpis.clientsNeedingFollowUp,
      scope: isAr ? 'تراكمي' : 'Cumulative',
    },
    {
      label: isAr ? 'الاجتماعات المنعقدة (منتهية)' : 'Held Meetings',
      value: kpis.heldMeetingsInPeriod,
      scope: isAr ? range.labelAr : range.labelEn,
    },
    {
      label: isAr ? 'الاجتماعات القادمة' : 'Upcoming Meetings',
      value: kpis.upcomingMeetings,
      scope: isAr ? 'تراكمي' : 'Cumulative',
    },
    {
      label: isAr ? 'الاجتماعات الملغاة في الفترة' : 'Cancelled Meetings',
      value: kpis.cancelledMeetingsInPeriod,
      scope: `${isAr ? 'إجمالي الملغاة' : 'All-time'}: ${kpis.cancelledMeetingsTotal}`,
    },
    {
      label: isAr ? 'متوسط الاجتماعات أسبوعيًا' : 'Avg Held / Week',
      value: kpis.avgMeetingsPerWeek,
      scope: isAr ? range.labelAr : range.labelEn,
    },
    {
      label: isAr ? 'المهام المُنشأة في الفترة' : 'Tasks Created',
      value: kpis.tasksCreatedInPeriod,
      scope: isAr ? range.labelAr : range.labelEn,
    },
    {
      label: isAr ? 'المهام المنجزة في الفترة' : 'Tasks Completed',
      value: kpis.tasksCompletedInPeriod,
      scope: isAr ? 'بتاريخ إنجاز موثق' : 'Verified completedAt',
    },
    {
      label: isAr ? 'المهام المفتوحة حاليًا' : 'Open Tasks',
      value: kpis.openTasksCurrent,
      scope: isAr ? 'تراكمي' : 'Cumulative',
    },
    {
      label: isAr ? 'المهام المتأخرة حاليًا' : 'Overdue Tasks',
      value: kpis.overdueTasksCurrent,
      scope: isAr ? 'تراكمي' : 'Cumulative',
    },
    {
      label: isAr ? 'معدل إنجاز دفعة الفترة' : 'Cohort Completion Rate',
      value:
        kpis.taskCompletionRateInPeriod === null
          ? isAr
            ? 'غير متاح'
            : 'N/A'
          : `${kpis.taskCompletionRateInPeriod}%`,
      scope: `${kpis.cohortTasksCurrentlyCompletedCount} / ${kpis.cohortTasksCreatedCount}`,
    },
  ];

  return (
    <article
      dir={dir}
      data-testid="analytics-print-sheet"
      className="print-container bg-white text-stone-900 mx-auto w-full max-w-[210mm] p-6 sm:p-8 text-[12px] leading-relaxed"
    >
      <header className="pdf-atomic border-b-2 border-stone-900 pb-4 mb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-extrabold text-lg text-stone-950">
            {isAr ? 'مُرافق | ملخص التحليلات والرؤى' : 'Murafiq | Analytics & Insights Summary'}
          </h1>
          <p className="text-[11px] text-stone-600 mt-1">
            {isAr ? 'الفترة المختارة:' : 'Selected Period:'}{' '}
            <strong className="text-stone-900">
              {isAr ? range.labelAr : range.labelEn}
            </strong>{' '}
            <span className="font-mono text-stone-500">
              ({isAr ? 'من' : 'from'}{' '}
              <span dir="ltr" className="inline-block">
                {range.startKey}
              </span>{' '}
              {isAr ? 'إلى' : 'to'}{' '}
              <span dir="ltr" className="inline-block">
                {range.endKey}
              </span>
              )
            </span>
          </p>
        </div>
        <div className="text-[10px] text-stone-500 text-end tabular-nums">
          <div>
            {isAr ? 'تاريخ التوليد:' : 'Generated:'} {formatArabicDate(snapshot.generatedAtIso, true)}
          </div>
          <div>
            {isAr ? 'المنطقة الزمنية:' : 'Time Zone:'} {snapshot.timeZone}
          </div>
        </div>
      </header>

      {snapshot.completeness.isIncomplete && (
        <div className="pdf-atomic mb-4 p-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-[11px]">
          {isAr ? snapshot.completeness.warningAr : snapshot.completeness.warningEn}
        </div>
      )}

      {/* KPI Table */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-900 border-b border-stone-300 pb-1 mb-2.5">
          {isAr ? '1. مؤشرات الأداء الرئيسية' : '1. Key Performance Indicators'}
        </h2>
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-[11px] text-start tabular-nums">
            <thead className="bg-stone-100 text-stone-800 border-b border-stone-200">
              <tr>
                <th className="py-2 px-3 text-start">{isAr ? 'المؤشر' : 'KPI'}</th>
                <th className="py-2 px-3 text-start">{isAr ? 'القيمة' : 'Value'}</th>
                <th className="py-2 px-3 text-start">{isAr ? 'النطاق' : 'Scope'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {kpiItems.map((item) => (
                <tr key={item.label}>
                  <td className="py-1.5 px-3 font-medium text-stone-900">{item.label}</td>
                  <td className="py-1.5 px-3 font-bold text-stone-950">{item.value}</td>
                  <td className="py-1.5 px-3 text-stone-500">{item.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Period Comparisons */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-900 border-b border-stone-300 pb-1 mb-2.5">
          {isAr ? '2. مقارنة الأداء بالفترة السابقة المماثلة' : '2. Period-over-Period Comparison'}
        </h2>
        <p className="text-[10px] text-stone-500 mb-2">
          {isAr ? previousRange.labelAr : previousRange.labelEn}
        </p>
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-[11px] text-start tabular-nums">
            <thead className="bg-stone-100 text-stone-800 border-b border-stone-200">
              <tr>
                <th className="py-2 px-3 text-start">{isAr ? 'المقياس' : 'Metric'}</th>
                <th className="py-2 px-3 text-start">{isAr ? 'الحالي' : 'Current'}</th>
                <th className="py-2 px-3 text-start">{isAr ? 'السابق' : 'Previous'}</th>
                <th className="py-2 px-3 text-start">{isAr ? 'التغير' : 'Change'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {comparisons.map((c) => (
                <tr key={c.key}>
                  <td className="py-1.5 px-3 font-medium text-stone-900">
                    {isAr ? c.labelAr : c.labelEn}
                  </td>
                  <td className="py-1.5 px-3 font-bold">{c.current}</td>
                  <td className="py-1.5 px-3 text-stone-600">{c.previous}</td>
                  <td className="py-1.5 px-3 text-stone-700">
                    {c.hasValidBase
                      ? `${c.percentChange! > 0 ? '+' : ''}${c.percentChange}%`
                      : isAr
                      ? c.noBaseMessageAr
                      : c.noBaseMessageEn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top Insights */}
      <section className="pdf-section mb-5">
        <h2 className="pdf-heading font-heading font-bold text-sm text-stone-900 border-b border-stone-300 pb-1 mb-2.5">
          {isAr ? '3. أبرز الرؤى والتوصيات العملية' : '3. Key Actionable Insights'}
        </h2>
        {insights.length === 0 ? (
          <p className="text-[11px] text-stone-500">
            {isAr
              ? 'لا توجد تنبيهات أو رؤى تستدعي إجراءً عاجلًا حاليًا.'
              : 'No actionable insights triggered at this time.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {insights.map((ins) => (
              <li
                key={ins.id}
                className="pdf-atomic p-2.5 rounded-lg border border-stone-200 bg-stone-50/50"
              >
                <div className="font-bold text-stone-900">
                  {isAr ? ins.titleAr : ins.titleEn}
                </div>
                <div className="text-[11px] text-stone-700 mt-0.5">
                  {isAr ? ins.descriptionAr : ins.descriptionEn}
                </div>
                <div className="text-[10px] text-stone-500 mt-0.5">
                  {isAr ? ins.evidenceAr : ins.evidenceEn}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pdf-atomic pt-3 border-t border-stone-200 text-[10px] text-stone-500">
        {isAr
          ? 'تم إعداد هذا التقرير محليًا من بيانات مُرافق الفعلية دون أي أرقام تقديرية أو روابط مرفقات مؤقتة.'
          : 'Generated locally from actual Murafiq records with no fabricated numbers or temporary attachment links.'}
      </footer>
    </article>
  );
};

export const AnalyticsPrintModal: React.FC<AnalyticsPrintModalProps> = ({
  isOpen,
  onClose,
  snapshot,
  language,
}) => {
  const isAr = language === 'ar';
  if (!isOpen) return null;

  const printPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <div id="murafiq-print-portal">
            <AnalyticsPrintSheet snapshot={snapshot} language={language} />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {printPortal}
      <div
        data-testid="analytics-print-modal"
        className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      >
        <div className="bg-stone-100 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-stone-200 shadow-2xl">
          <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-heading font-bold text-sm text-stone-900">
                {isAr ? 'معاينة التقرير القابل للطباعة' : 'Printable Report Preview'}
              </h3>
              <p className="text-[11px] text-stone-500">
                {isAr
                  ? 'يمكنك طباعة التقرير أو حفظه كملف PDF من نافذة الطباعة'
                  : 'Print or save as PDF using the browser print dialog'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="analytics-trigger-print"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isAr ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}</span>
              </button>
              <button
                type="button"
                data-testid="analytics-close-print"
                onClick={onClose}
                className="p-1.5 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                aria-label={isAr ? 'إغلاق المعاينة' : 'Close Preview'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="rounded-xl border border-stone-200 overflow-hidden shadow-xs">
              <AnalyticsPrintSheet snapshot={snapshot} language={language} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
