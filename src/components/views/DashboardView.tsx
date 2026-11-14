import React, { useMemo, useState } from 'react';
import { ActionItem, Client, Meeting, Note, Opportunity } from '../../types';
import { formatArabicDate, getHijriDateString } from '../../utils/logic';
import { computeOpportunityPipelineMetrics } from '../../utils/opportunities';
import {
  ANALYTICS_DATE_PRESETS,
  AnalyticsDatePreset,
  AnalyticsDrillDownTarget,
  buildAnalyticsSummaryCsv,
  computeDashboardAnalytics,
} from '../../utils/analytics';
import { DistributionBarList, TrendTimelineChart } from '../AnalyticsCharts';
import { AnalyticsPrintModal } from '../AnalyticsPrintModal';
import type { NavTab } from '../BottomNav';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpLeft,
  Briefcase,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Info,
  Layers,
  ListChecks,
  Plus,
  Printer,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';

export interface DashboardViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities?: Opportunity[];
  onSelectMeeting: (meeting: Meeting) => void;
  onSelectClient: (client: Client) => void;
  onToggleTask?: (taskId: string) => void;
  onNewMeeting: (preselectedClientId?: string) => void;
  onNewTask: () => void;
  onNewClient: () => void;
  onGoToTab: (tab: NavTab) => void;
  onDrillDown?: (target: AnalyticsDrillDownTarget) => void;
  collectionsLoaded?: {
    clients: boolean;
    meetings: boolean;
    tasks: boolean;
    notes: boolean;
  };
  hasSyncError?: boolean;
  hasPendingWrites?: boolean;
  isOnline?: boolean;
  referenceDate?: Date;
  timeZone?: string;
  showHijri: boolean;
  language: 'ar' | 'en';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  meetings,
  tasks,
  notes,
  opportunities = [],
  onSelectMeeting,
  onSelectClient,
  onNewMeeting,
  onNewTask,
  onNewClient,
  onGoToTab,
  onDrillDown,
  collectionsLoaded = { clients: true, meetings: true, tasks: true, notes: true },
  hasSyncError = false,
  hasPendingWrites = false,
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true,
  referenceDate,
  timeZone,
  showHijri,
  language,
}) => {
  const isAr = language === 'ar';
  const effectiveRefDate = referenceDate || new Date();

  const [preset, setPreset] = useState<AnalyticsDatePreset>('30d');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date(effectiveRefDate.getTime() - 29 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    effectiveRefDate.toISOString().slice(0, 10)
  );
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const snapshot = useMemo(
    () =>
      computeDashboardAnalytics({
        clients,
        meetings,
        tasks,
        notes,
        preset,
        customRange:
          preset === 'custom'
            ? { startDate: customStart, endDate: customEnd }
            : undefined,
        collectionsLoaded,
        referenceDate: effectiveRefDate,
        timeZone,
      }),
    [
      clients,
      meetings,
      tasks,
      notes,
      preset,
      customStart,
      customEnd,
      collectionsLoaded,
      effectiveRefDate,
      timeZone,
    ]
  );

  const dateFormatted = formatArabicDate(effectiveRefDate.toISOString());
  const hijriFormatted = getHijriDateString(effectiveRefDate.toISOString());

  const handleDrill = (target: AnalyticsDrillDownTarget) => {
    if (onDrillDown) {
      onDrillDown(target);
      return;
    }
    onGoToTab(target.tab);
  };

  const handleExportCsv = () => {
    if (typeof document === 'undefined') return;
    const csv = buildAnalyticsSummaryCsv(snapshot, language);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `murafiq-analytics-${snapshot.range.startKey}-to-${snapshot.range.endKey}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const { kpis, range, previousRange, comparisons, completeness } = snapshot;

  const isLoadingInitial = completeness.isIncomplete;

  return (
    <div className="space-y-5 pb-8" data-testid="analytics-dashboard-view">
      {/* Header & Workspace Title */}
      <section className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-stone-500 flex-wrap">
              <span>{dateFormatted}</span>
              {showHijri && (
                <span className="px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                  {hijriFormatted}
                </span>
              )}
            </div>
            <h2 className="font-heading font-extrabold text-xl sm:text-2xl text-stone-900">
              {isAr ? 'التحليلات والرؤى' : 'Analytics & Insights'}
            </h2>
            <p className="text-xs text-stone-600 max-w-2xl leading-relaxed">
              {isAr
                ? 'قياس فعلي لنشاط العملاء والاجتماعات والالتزامات استنادًا إلى سجلاتك المسجلة في مُرافق فقط، مع انتقال مباشر إلى السجلات التي تتطلب إجراءً.'
                : 'Evidence-based overview of your clients, meetings, and tasks derived strictly from your recorded Murafiq data.'}
            </p>
          </div>

          {/* Print & Export Actions */}
          <div className="flex items-center gap-2 flex-wrap shrink-0 sm:self-start">
            <button
              type="button"
              data-testid="analytics-export-csv"
              onClick={handleExportCsv}
              disabled={isLoadingInitial}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-50 text-xs font-medium text-stone-800 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-stone-600" />
              <span>{isAr ? 'تصدير CSV' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              data-testid="analytics-open-print"
              onClick={() => setIsPrintModalOpen(true)}
              disabled={isLoadingInitial}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isAr ? 'طباعة الملخص' : 'Print Summary'}</span>
            </button>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-stone-100">
          <button
            type="button"
            onClick={() => onNewMeeting()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAr ? 'لقاء جديد' : 'New Meeting'}</span>
          </button>
          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-stone-50 text-stone-800 hover:bg-stone-100 border border-stone-200 shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-stone-500" />
            <span>{isAr ? 'مهمة متابعة' : 'New Task'}</span>
          </button>
          <button
            type="button"
            onClick={onNewClient}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-stone-50 text-stone-800 hover:bg-stone-100 border border-stone-200 shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-stone-500" />
            <span>{isAr ? 'عميل جديد' : 'New Client'}</span>
          </button>
          <button
            type="button"
            onClick={() => onGoToTab('today')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200 shrink-0 transition-colors ltr:sm:ml-auto rtl:sm:mr-auto"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            <span>{isAr ? 'فتح «يومي»' : 'Open Today'}</span>
          </button>
        </div>

        {/* Date Range Filter Controls */}
        <div className="pt-2 border-t border-stone-100 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {ANALYTICS_DATE_PRESETS.map((opt) => {
                const active = preset === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    data-testid={`analytics-range-${opt.key}`}
                    onClick={() => setPreset(opt.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      active
                        ? 'bg-stone-900 text-white font-semibold'
                        : 'bg-stone-50 text-stone-700 border border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {isAr ? opt.labelAr : opt.labelEn}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-stone-500 tabular-nums flex items-center gap-1 flex-wrap">
              <span>{isAr ? 'النطاق: من' : 'Range: from'}</span>
              <span dir="ltr" className="inline-block font-mono text-stone-800 font-medium">
                {range.startKey}
              </span>
              <span>{isAr ? 'إلى' : 'to'}</span>
              <span dir="ltr" className="inline-block font-mono text-stone-800 font-medium">
                {range.endKey}
              </span>
              <span>
                ({range.daysCount} {isAr ? 'يوم' : 'days'})
              </span>
            </div>
          </div>

          {preset === 'custom' && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 bg-stone-50 border border-stone-200 rounded-xl p-3 text-xs">
              <div className="flex items-center gap-2">
                <label htmlFor="analytics-start-date" className="text-stone-700 font-medium">
                  {isAr ? 'من:' : 'From:'}
                </label>
                <input
                  id="analytics-start-date"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-xs text-stone-900 tabular-nums"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="analytics-end-date" className="text-stone-700 font-medium">
                  {isAr ? 'إلى:' : 'To:'}
                </label>
                <input
                  id="analytics-end-date"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-xs text-stone-900 tabular-nums"
                />
              </div>
              {!range.isValid && range.validationErrorAr && (
                <div
                  data-testid="analytics-range-error"
                  className="text-rose-700 font-medium flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{isAr ? range.validationErrorAr : range.validationErrorEn}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Honest Data Completeness / Sync State Disclosure */}
      {(isLoadingInitial || hasSyncError || !isOnline || hasPendingWrites) && (
        <div
          data-testid="analytics-sync-notice"
          className={`rounded-xl border p-3 text-xs flex items-start gap-2.5 ${
            hasSyncError
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}
        >
          {!isOnline ? (
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                hasSyncError ? 'text-rose-600' : 'text-amber-700'
              }`}
            />
          )}
          <div className="space-y-0.5 leading-relaxed">
            {isLoadingInitial ? (
              <p className="font-semibold">
                {isAr
                  ? completeness.warningAr
                  : completeness.warningEn}
              </p>
            ) : hasSyncError ? (
              <p className="font-semibold">
                {isAr
                  ? 'تعذر تحديث بعض المجموعات من السحابة؛ الأرقام المعروضة قد تكون غير مكتملة.'
                  : 'Some collections failed to sync; displayed analytics may be incomplete.'}
              </p>
            ) : (
              <p className="font-medium">
                {isAr
                  ? 'تعمل الآن على البيانات المحلية (دون اتصال أو بانتظار تأكيد المزامنة)؛ تُحدَّث التحليلات فور استقرار المزامنة.'
                  : 'Metrics reflect local records while offline or pending cloud confirmation.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Initial Loading Skeleton State (Prevents misleading fake 0s) */}
      {isLoadingInitial ? (
        <div
          data-testid="analytics-loading-skeleton"
          className="bg-white rounded-2xl border border-stone-200 p-6 text-center space-y-3"
        >
          <p className="text-xs font-semibold text-stone-700">
            {isAr
              ? 'جاري تحميل السجلات لحساب التحليلات بدقة...'
              : 'Loading records to compute analytics...'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {[1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="h-20 rounded-xl bg-stone-100 border border-stone-200/70"
              />
            ))}
          </div>
        </div>
      ) : completeness.isEmptyWorkspace ? (
        /* Clean Empty Workspace State */
        <section
          data-testid="analytics-empty-state"
          className="bg-white rounded-2xl border border-dashed border-stone-300 p-8 text-center space-y-3"
        >
          <div className="w-11 h-11 rounded-2xl bg-stone-100 text-stone-600 flex items-center justify-center mx-auto">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <h3 className="font-heading font-bold text-base text-stone-900">
            {isAr
              ? 'لا توجد بيانات كافية للتحليل بعد'
              : 'Not enough data for analytics yet'}
          </h3>
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            {isAr
              ? 'عند إضافة عملائك وتسجيل اللقاءات والمهام، ستظهر هنا مؤشرات الأداء والرسوم البيانية والرؤى المبنية على بياناتك الفعلية.'
              : 'Once you add clients, meetings, and tasks, your real activity KPIs, trends, and insights will appear here.'}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
            <button
              type="button"
              onClick={onNewClient}
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              {isAr ? 'إضافة أول عميل' : 'Add First Client'}
            </button>
            <button
              type="button"
              onClick={() => onNewMeeting()}
              className="px-3.5 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-800 text-xs font-medium"
            >
              {isAr ? 'جدولة لقاء' : 'Schedule Meeting'}
            </button>
            <button
              type="button"
              onClick={onNewTask}
              className="px-3.5 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-800 text-xs font-medium"
            >
              {isAr ? 'إضافة مهمة' : 'Add Task'}
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* 1. Actionable Insights («رؤى تستحق انتباهك») */}
          <section
            data-testid="analytics-insights-section"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                  {isAr ? 'رؤى تستحق انتباهك' : 'Actionable Insights'}
                </h3>
                <p className="text-[11px] text-stone-500">
                  {isAr
                    ? 'ملخص حتمي مستنتج من سجلاتك الحالية فقط، مع إجراء انتقال مباشر'
                    : 'Deterministic insights grounded strictly in your current records'}
                </p>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 font-medium tabular-nums">
                {snapshot.insights.length}
              </span>
            </div>

            {snapshot.insights.length === 0 ? (
              <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs text-stone-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  {isAr
                    ? 'الأمور مستقرة حاليًا؛ لا توجد تنبيهات أو فجوات متابعة تستدعي تدخلًا عاجلًا في سجلاتك.'
                    : 'Everything looks steady; no urgent follow-up gaps detected in your current records.'}
                </span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {snapshot.insights.map((ins) => {
                  const badgeStyle =
                    ins.severity === 'high'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : ins.severity === 'medium'
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-sky-50 text-sky-800 border-sky-200';
                  const severityLabel =
                    ins.severity === 'high'
                      ? isAr
                        ? 'أولوية عالية'
                        : 'High'
                      : ins.severity === 'medium'
                      ? isAr
                        ? 'يحتاج مراجعة'
                        : 'Attention'
                      : isAr
                      ? 'معلومة مفيدة'
                      : 'Info';

                  return (
                    <div
                      key={ins.id}
                      data-testid={`insight-card-${ins.id}`}
                      className="rounded-xl border border-stone-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-stone-300 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badgeStyle}`}
                          >
                            {severityLabel}
                          </span>
                          <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                            {isAr ? ins.titleAr : ins.titleEn}
                          </h4>
                        </div>
                        <p className="text-xs text-stone-600 leading-relaxed">
                          {isAr ? ins.descriptionAr : ins.descriptionEn}
                        </p>
                        <p className="text-[11px] text-stone-400">
                          {isAr ? ins.evidenceAr : ins.evidenceEn}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDrill(ins.drillDown)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shrink-0 transition-colors self-start sm:self-center"
                      >
                        <span>{isAr ? ins.actionLabelAr : ins.actionLabelEn}</span>
                        <ArrowUpLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Key Performance Indicators (13 KPIs across Clients, Meetings, Tasks) */}
          <section data-testid="analytics-kpis-section" className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                {isAr ? 'مؤشرات الأداء الرئيسية' : 'Key Performance Indicators'}
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {isAr ? 'خلال الفترة' : 'Period'}
                </span>
                <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200">
                  {isAr ? 'تراكمي حالي' : 'Cumulative'}
                </span>
              </div>
            </div>

            {/* Clients 4 KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <KpiButtonCard
                testId="kpi-total-clients"
                label={isAr ? 'إجمالي العملاء' : 'Total Clients'}
                value={kpis.totalClients}
                scopeLabel={isAr ? 'تراكمي حالي' : 'Cumulative'}
                scopeType="cumulative"
                onClick={() => handleDrill({ tab: 'clients', quickFilter: 'all' })}
              />
              <KpiButtonCard
                testId="kpi-new-clients"
                label={isAr ? 'العملاء المضافون في الفترة' : 'New Clients in Period'}
                value={kpis.newClientsInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                onClick={() =>
                  handleDrill({
                    tab: 'clients',
                    quickFilter: 'all',
                    createdFrom: range.startKey,
                    createdTo: range.endKey,
                  })
                }
              />
              <KpiButtonCard
                testId="kpi-clients-with-meetings"
                label={isAr ? 'عملاء باجتماعات مسجلة' : 'Clients with Meetings'}
                value={kpis.clientsWithMeetingsInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                subtext={isAr ? 'غير الملغاة' : 'Non-cancelled'}
              />
              <KpiButtonCard
                testId="kpi-clients-follow-up"
                label={isAr ? 'عملاء يحتاجون إلى متابعة' : 'Clients Needing Follow-up'}
                value={kpis.clientsNeedingFollowUp}
                scopeLabel={isAr ? 'تراكمي حالي' : 'Cumulative'}
                scopeType="cumulative"
                tone={kpis.clientsNeedingFollowUp > 0 ? 'amber' : 'neutral'}
                onClick={() =>
                  handleDrill({ tab: 'clients', quickFilter: 'needs_follow_up' })
                }
              />
            </div>

            {/* Meetings 4 KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <KpiButtonCard
                testId="kpi-held-meetings"
                label={isAr ? 'الاجتماعات المنعقدة' : 'Held Meetings'}
                value={kpis.heldMeetingsInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                tone="emerald"
                subtext={isAr ? 'ذات الحالة «منتهية» فقط' : 'Status: completed only'}
                onClick={() => handleDrill({ tab: 'meetings', status: 'completed' })}
              />
              <KpiButtonCard
                testId="kpi-upcoming-meetings"
                label={isAr ? 'الاجتماعات القادمة' : 'Upcoming Meetings'}
                value={kpis.upcomingMeetings}
                scopeLabel={isAr ? 'تراكمي حالي' : 'Cumulative'}
                scopeType="cumulative"
                onClick={() => handleDrill({ tab: 'meetings', upcomingOnly: true })}
              />
              <KpiButtonCard
                testId="kpi-cancelled-meetings"
                label={isAr ? 'الاجتماعات الملغاة في الفترة' : 'Cancelled Meetings'}
                value={kpis.cancelledMeetingsInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                subtext={`${isAr ? 'الإجمالي العام:' : 'All-time:'} ${kpis.cancelledMeetingsTotal}`}
                onClick={() => handleDrill({ tab: 'meetings', status: 'cancelled' })}
              />
              <KpiButtonCard
                testId="kpi-avg-meetings-week"
                label={isAr ? 'متوسط الاجتماعات أسبوعيًا' : 'Avg Held / Week'}
                value={kpis.avgMeetingsPerWeek}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                subtext={isAr ? 'من الاجتماعات المنعقدة' : 'From held meetings'}
              />
            </div>

            {/* Tasks 5 KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <KpiButtonCard
                testId="kpi-tasks-created"
                label={isAr ? 'مهام أُنشئت في الفترة' : 'Tasks Created'}
                value={kpis.tasksCreatedInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                onClick={() => handleDrill({ tab: 'tasks', scope: 'all' })}
              />
              <KpiButtonCard
                testId="kpi-tasks-completed"
                label={isAr ? 'مهام أُنجزت في الفترة' : 'Tasks Completed'}
                value={kpis.tasksCompletedInPeriod}
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                tone="emerald"
                subtext={
                  kpis.completedWithoutTimestampCount > 0
                    ? `${isAr ? 'موثقة التاريخ' : 'Dated'} • +${kpis.completedWithoutTimestampCount} ${
                        isAr ? 'بلا تاريخ' : 'undated'
                      }`
                    : isAr
                    ? 'بتاريخ إنجاز موثق'
                    : 'Verified completedAt'
                }
                onClick={() => handleDrill({ tab: 'tasks', scope: 'completed' })}
              />
              <KpiButtonCard
                testId="kpi-open-tasks"
                label={isAr ? 'المهام المفتوحة حاليًا' : 'Currently Open Tasks'}
                value={kpis.openTasksCurrent}
                scopeLabel={isAr ? 'تراكمي حالي' : 'Cumulative'}
                scopeType="cumulative"
                onClick={() => handleDrill({ tab: 'tasks', scope: 'open' })}
              />
              <KpiButtonCard
                testId="kpi-overdue-tasks"
                label={isAr ? 'المهام المتأخرة حاليًا' : 'Currently Overdue Tasks'}
                value={kpis.overdueTasksCurrent}
                scopeLabel={isAr ? 'تراكمي حالي' : 'Cumulative'}
                scopeType="cumulative"
                tone={kpis.overdueTasksCurrent > 0 ? 'rose' : 'neutral'}
                onClick={() => handleDrill({ tab: 'tasks', scope: 'overdue' })}
              />
              <KpiButtonCard
                testId="kpi-completion-rate"
                label={isAr ? 'معدل إنجاز دفعة الفترة' : 'Cohort Completion Rate'}
                value={
                  kpis.taskCompletionRateInPeriod === null
                    ? '—'
                    : `${kpis.taskCompletionRateInPeriod}%`
                }
                scopeLabel={isAr ? 'خلال الفترة' : 'Period'}
                scopeType="period"
                subtext={`${kpis.cohortTasksCurrentlyCompletedCount} / ${kpis.cohortTasksCreatedCount} ${
                  isAr ? 'مهمة' : 'tasks'
                }`}
              />
            </div>
          </section>

          {/* 3. Period-over-Period Comparison */}
          <section
            data-testid="analytics-comparisons-section"
            className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                  {isAr ? 'مقارنة الأداء بالفترة السابقة' : 'Period-over-Period Comparison'}
                </h3>
                <p className="text-[11px] text-stone-500 tabular-nums">
                  {isAr
                    ? `مقارنة (${range.startKey}..${range.endKey}) مع فترة سابقة مساوية (${previousRange.startKey}..${previousRange.endKey})`
                    : `Comparing ${range.startKey}..${range.endKey} against equal prior range ${previousRange.startKey}..${previousRange.endKey}`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {comparisons.map((comp) => (
                <div
                  key={comp.key}
                  data-testid={`comparison-${comp.key}`}
                  className="rounded-xl border border-stone-200 p-3 space-y-1.5"
                >
                  <div className="text-[11px] font-medium text-stone-600">
                    {isAr ? comp.labelAr : comp.labelEn}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 tabular-nums">
                    <span className="font-heading font-extrabold text-xl text-stone-900">
                      {comp.current}
                    </span>
                    <span className="text-[11px] text-stone-500">
                      {isAr ? 'السابق:' : 'Prev:'} {comp.previous}
                    </span>
                  </div>
                  <div className="text-[11px] tabular-nums">
                    {comp.hasValidBase ? (
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          comp.tone === 'positive'
                            ? 'text-emerald-700'
                            : comp.tone === 'negative'
                            ? 'text-rose-700'
                            : 'text-stone-600'
                        }`}
                      >
                        {comp.delta > 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : comp.delta < 0 ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : null}
                        <span>
                          {comp.delta > 0 ? `+${comp.delta}` : comp.delta} (
                          {comp.percentChange! > 0 ? `+${comp.percentChange}%` : `${comp.percentChange}%`})
                        </span>
                      </span>
                    ) : (
                      <span className="text-stone-500">
                        {isAr ? comp.noBaseMessageAr : comp.noBaseMessageEn}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Meetings Analysis («نشاط الاجتماعات») */}
          <section data-testid="analytics-meetings-section" className="space-y-3">
            <div>
              <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                {isAr ? 'نشاط الاجتماعات' : 'Meetings Activity'}
              </h3>
              <p className="text-[11px] text-stone-500">
                {isAr
                  ? 'توزيع زمني حسب طبيعة الفترة المختارة، وتصنيف أنواع وحالات الاجتماعات والمحاضر'
                  : 'Time trend, type/status distribution, and task-linked meetings'}
              </p>
            </div>

            <TrendTimelineChart
              testId="meetings-trend-chart"
              title={
                isAr
                  ? `الاتجاه الزمني للاجتماعات (${
                      range.granularity === 'day'
                        ? 'يومي'
                        : range.granularity === 'week'
                        ? 'أسبوعي'
                        : 'شهري'
                    })`
                  : `Meetings Timeline (${range.granularity})`
              }
              subtitle={
                isAr
                  ? 'تُحتسب الاجتماعات المنعقدة فقط عندما تكون حالتها «منتهية» (completed).'
                  : 'Held meetings include status="completed" only.'
              }
              series={snapshot.meetings.trendSeries}
              mode="meetings"
              language={language}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DistributionBarList
                title={isAr ? 'توزيع نوع الاجتماع' : 'By Meeting Type'}
                subtitle={isAr ? 'من الاجتماعات غير الملغاة في الفترة' : 'Non-cancelled in period'}
                items={snapshot.meetings.byType}
                language={language}
                barColorClass={(k) =>
                  k === 'in_person'
                    ? 'bg-emerald-700'
                    : k === 'video'
                    ? 'bg-sky-600'
                    : k === 'phone'
                    ? 'bg-amber-600'
                    : 'bg-stone-600'
                }
              />

              <DistributionBarList
                title={isAr ? 'توزيع حالة الاجتماع' : 'By Meeting Status'}
                subtitle={isAr ? 'جميع الاجتماعات المؤرخة في الفترة' : 'All meetings dated in period'}
                items={snapshot.meetings.byStatus}
                language={language}
                barColorClass={(k) =>
                  k === 'completed'
                    ? 'bg-emerald-700'
                    : k === 'confirmed'
                    ? 'bg-sky-600'
                    : k === 'draft'
                    ? 'bg-stone-400'
                    : 'bg-rose-500'
                }
                onItemClick={(item) => handleDrill({ tab: 'meetings', status: item.key })}
              />

              <DistributionBarList
                title={isAr ? 'حالة توثيق المحضر' : 'Minutes Documentation Status'}
                subtitle={
                  isAr
                    ? 'مستقلة عن حالة الانعقاد (المحضر «النهائي» لا يعني انعقاد اللقاء تلقائيًا)'
                    : 'Independent from meeting held status'
                }
                items={snapshot.meetings.byMinutesStatus}
                language={language}
                barColorClass={(k) =>
                  k === 'final'
                    ? 'bg-emerald-700'
                    : k === 'review'
                    ? 'bg-amber-600'
                    : 'bg-stone-400'
                }
              />
            </div>

            {/* Top Task-Linked Meetings */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                    {isAr
                      ? 'الاجتماعات الأكثر ارتباطًا بالمهام'
                      : 'Meetings Most Linked to Tasks'}
                  </h4>
                  <p className="text-[11px] text-stone-500">
                    {isAr
                      ? 'يقيس عدد المهام المرتبطة بالاجتماع فقط ولا يُعد مقياسًا لجودة الاجتماع.'
                      : 'Measures linked task count only; not a measure of meeting quality.'}
                  </p>
                </div>
              </div>

              {snapshot.meetings.topTaskLinkedMeetings.length === 0 ? (
                <p className="text-xs text-stone-400 py-4 text-center">
                  {isAr
                    ? 'لا توجد اجتماعات مرتبطة بمهام ضمن الفترة المختارة.'
                    : 'No task-linked meetings in the selected period.'}
                </p>
              ) : (
                <div className="divide-y divide-stone-100">
                  {snapshot.meetings.topTaskLinkedMeetings.map((entry) => {
                    const meetingObj = meetings.find((m) => m.id === entry.meetingId);
                    return (
                      <div
                        key={entry.meetingId}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-stone-900 truncate">
                            {entry.title}
                          </div>
                          <div className="text-[11px] text-stone-500 mt-0.5 tabular-nums">
                            {entry.clientName} • {formatArabicDate(entry.dateTime)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-800 font-semibold tabular-nums">
                            {entry.linkedTasksCount} {isAr ? 'مهام' : 'tasks'} ({entry.openTasksCount}{' '}
                            {isAr ? 'مفتوحة' : 'open'})
                          </span>
                          {meetingObj && (
                            <button
                              type="button"
                              onClick={() => onSelectMeeting(meetingObj)}
                              className="px-2.5 py-1 rounded-lg border border-stone-200 hover:bg-stone-50 text-[11px] font-medium text-emerald-800"
                            >
                              {isAr ? 'فتح' : 'Open'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* 5. Tasks & Commitments Performance («أداء المهام والالتزامات») */}
          <section data-testid="analytics-tasks-section" className="space-y-3">
            <div>
              <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                {isAr ? 'أداء المهام والالتزامات' : 'Tasks & Commitments Performance'}
              </h3>
              <p className="text-[11px] text-stone-500">
                {isAr
                  ? 'توزيع حالات المهام وأولوياتها، ومسار الإنجاز الموثق، وتحليل الالتزامات المتأخرة'
                  : 'Task status/priority breakdown, verified completion trend, and overdue commitments'}
              </p>
            </div>

            <TrendTimelineChart
              testId="tasks-trend-chart"
              title={isAr ? 'منحنى إنجاز المهام خلال الفترة' : 'Completed Tasks Trend'}
              subtitle={
                snapshot.tasks.completedWithoutTimestampCount > 0
                  ? isAr
                    ? `يعتمد على تاريخ الإنجاز الفعلي (completedAt) فقط. توجد ${snapshot.tasks.completedWithoutTimestampCount} مهام منجزة سابقة بدون تاريخ إنجاز موثق ولا يتم تخمين تاريخها.`
                    : `Uses verified completedAt only. ${snapshot.tasks.completedWithoutTimestampCount} legacy completed task(s) lack completedAt and are excluded from dated trends.`
                  : isAr
                  ? 'يعتمد حصريًا على المهام التي تحتوي على تاريخ إنجاز موثق (completedAt).'
                  : 'Based strictly on tasks with a verified completedAt timestamp.'
              }
              series={snapshot.tasks.completedTrendSeries}
              mode="tasks"
              language={language}
            />

            {/* Cohort Completion Rate Explicit Explanation */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-stone-900">
                  <Info className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    {isAr
                      ? 'تعريف معدل إنجاز دفعة الفترة المختارة'
                      : 'Period Cohort Completion Rate Definition'}
                  </span>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  {isAr
                    ? 'يمثل نسبة المهام التي أُنشئت خلال الفترة المختارة وأصبحت حالتها الحالية «منجزة». يعكس الوضع الحالي لهذه الدفعة ولا يعيد بناء لقطة تاريخية.'
                    : 'Percentage of tasks created during the selected range whose current status is completed.'}
                </p>
              </div>
              <div className="shrink-0 text-start sm:text-end tabular-nums">
                <div className="font-heading font-extrabold text-2xl text-emerald-700">
                  {kpis.taskCompletionRateInPeriod === null
                    ? '—'
                    : `${kpis.taskCompletionRateInPeriod}%`}
                </div>
                <div className="text-[11px] text-stone-500">
                  {kpis.cohortTasksCurrentlyCompletedCount} / {kpis.cohortTasksCreatedCount}{' '}
                  {isAr ? 'مهمة' : 'tasks'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <DistributionBarList
                title={isAr ? 'توزيع المهام حسب الحالة (الإجمالي الحالي)' : 'Tasks by Current Status'}
                items={snapshot.tasks.byStatusCurrent}
                language={language}
                barColorClass={(k) =>
                  k === 'completed'
                    ? 'bg-emerald-700'
                    : k === 'in_progress'
                    ? 'bg-sky-600'
                    : k === 'pending'
                    ? 'bg-amber-600'
                    : 'bg-stone-400'
                }
              />

              <DistributionBarList
                title={isAr ? 'المهام المفتوحة حسب الأولوية' : 'Open Tasks by Priority'}
                items={snapshot.tasks.byPriorityOpenCurrent}
                language={language}
                barColorClass={(k) =>
                  k === 'urgent'
                    ? 'bg-rose-600'
                    : k === 'high'
                    ? 'bg-amber-600'
                    : k === 'medium'
                    ? 'bg-sky-600'
                    : 'bg-stone-400'
                }
              />
            </div>

            {/* Overdue Commitments Breakdown */}
            <div
              data-testid="overdue-commitments-panel"
              className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <AlertCircle
                    className={`w-4 h-4 ${
                      kpis.overdueTasksCurrent > 0 ? 'text-rose-600' : 'text-emerald-700'
                    }`}
                  />
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                    {isAr ? 'الالتزامات المتأخرة حاليًا' : 'Currently Overdue Commitments'}
                  </h4>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-800 font-bold tabular-nums">
                    {kpis.overdueTasksCurrent}
                  </span>
                </div>
                {kpis.overdueTasksCurrent > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDrill({ tab: 'tasks', scope: 'overdue' })}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
                  >
                    <span>{isAr ? 'فتح كل المهام المتأخرة' : 'Open all overdue tasks'}</span>
                    <ArrowUpLeft className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {kpis.overdueTasksCurrent === 0 ? (
                <p className="text-xs text-stone-500">
                  {isAr
                    ? 'لا توجد مهام متأخرة حاليًا عن موعد استحقاقها.'
                    : 'No overdue tasks at the moment.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-stone-600">
                      {isAr ? 'توزيع المتأخرات حسب الأولوية' : 'Overdue by Priority'}
                    </div>
                    <div className="grid grid-cols-2 gap-2 tabular-nums">
                      {snapshot.tasks.byPriorityOverdueCurrent.map((p) => (
                        <div
                          key={p.key}
                          className="rounded-xl border border-stone-200 bg-stone-50/60 p-2.5 flex items-center justify-between text-xs"
                        >
                          <span className="text-stone-700">
                            {isAr ? p.labelAr : p.labelEn}
                          </span>
                          <span className="font-bold text-stone-900">{p.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-stone-600">
                      {isAr ? 'العملاء الأكثر ارتباطًا بالمهام المتأخرة' : 'Clients with Overdue Tasks'}
                    </div>
                    <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                      {snapshot.tasks.overdueAffectedClients.slice(0, 5).map((item) => (
                        <button
                          key={item.clientId}
                          type="button"
                          onClick={() =>
                            handleDrill({
                              tab: 'tasks',
                              scope: 'overdue',
                              clientId: item.clientId,
                            })
                          }
                          className="w-full px-3 py-2 text-start hover:bg-stone-50 flex items-center justify-between gap-2 text-xs transition-colors"
                        >
                          <span className="font-medium text-stone-800 truncate">
                            {item.clientName}
                          </span>
                          <span className="text-rose-700 font-bold tabular-nums shrink-0">
                            {item.overdueCount} {isAr ? 'متأخرة' : 'overdue'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 6. Client Relationship Analysis («نشاط علاقات العملاء») */}
          <section data-testid="analytics-clients-section" className="space-y-3">
            <div>
              <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                {isAr ? 'نشاط علاقات العملاء' : 'Client Relationship Activity'}
              </h3>
              <p className="text-[11px] text-stone-500">
                {isAr
                  ? 'أكثر العملاء نشاطًا، العملاء الذين يحتاجون اهتمامًا، وتوزيع قاعدة العملاء حسب حقولك الفعلية'
                  : 'Most active clients, clients needing attention, and distributions based on actual fields'}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Most Active Clients in Period */}
              <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-emerald-700" />
                    <span>
                      {isAr ? 'أكثر العملاء نشاطًا في الفترة' : 'Most Active Clients'}
                    </span>
                  </h4>
                  <span className="text-[11px] text-stone-400">
                    {isAr ? 'حسب الاجتماعات غير الملغاة' : 'By non-cancelled meetings'}
                  </span>
                </div>

                {snapshot.clients.mostActiveClients.length === 0 ? (
                  <p className="text-xs text-stone-400 py-6 text-center">
                    {isAr
                      ? 'لا توجد اجتماعات مسجلة للعملاء ضمن هذه الفترة.'
                      : 'No client meetings recorded in this period.'}
                  </p>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {snapshot.clients.mostActiveClients.map((entry) => (
                      <div
                        key={entry.client.id}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-stone-900 truncate">
                            {entry.client.name}
                          </div>
                          <div className="text-[11px] text-stone-500 tabular-nums mt-0.5">
                            {entry.meetingsInPeriod} {isAr ? 'اجتماعات' : 'meetings'} (
                            {entry.heldMeetingsInPeriod} {isAr ? 'منعقدة' : 'held'})
                            {entry.lastMeetingAt
                              ? ` • ${isAr ? 'آخر اجتماع:' : 'Last:'} ${formatArabicDate(
                                  entry.lastMeetingAt
                                )}`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectClient(entry.client)}
                          className="px-2.5 py-1 rounded-lg border border-stone-200 hover:bg-stone-50 text-[11px] font-medium text-emerald-800 shrink-0"
                        >
                          {isAr ? 'ملف العميل' : 'Client 360'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clients Needing Attention */}
              <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <span>
                      {isAr ? 'العملاء الذين يحتاجون اهتمامًا' : 'Clients Needing Attention'}
                    </span>
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      handleDrill({ tab: 'clients', quickFilter: 'needs_follow_up' })
                    }
                    className="text-[11px] font-semibold text-emerald-800 hover:underline"
                  >
                    {isAr ? 'عرض القائمة' : 'View list'}
                  </button>
                </div>

                {snapshot.clients.clientsNeedingAttention.length === 0 ? (
                  <p className="text-xs text-stone-400 py-6 text-center">
                    {isAr
                      ? 'لا توجد إشارات تأخر أو فجوات متابعة مسجلة للعملاء حاليًا.'
                      : 'No attention flags detected for clients right now.'}
                  </p>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {snapshot.clients.clientsNeedingAttention.slice(0, 6).map((entry) => (
                      <div
                        key={entry.client.id}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="font-semibold text-xs text-stone-900 truncate">
                            {entry.client.name}
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {(isAr ? entry.reasonsAr : entry.reasonsEn).map((r) => (
                              <span
                                key={r}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectClient(entry.client)}
                          className="px-2.5 py-1 rounded-lg border border-stone-200 hover:bg-stone-50 text-[11px] font-medium text-stone-800 shrink-0"
                        >
                          {isAr ? 'فتح' : 'Open'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Client Attribute Distributions (Real Fields Only — Zero Invented Scores) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <DistributionBarList
                title={isAr ? 'حالة العلاقة' : 'Relationship Status'}
                items={snapshot.clients.byRelationshipStatus}
                language={language}
                hideZeroRows
                barColorClass={(k) =>
                  k === 'active'
                    ? 'bg-emerald-700'
                    : k === 'follow_up_needed'
                    ? 'bg-amber-600'
                    : k === 'lead'
                    ? 'bg-sky-600'
                    : 'bg-stone-500'
                }
              />
              <DistributionBarList
                title={isAr ? 'مستوى الأهمية' : 'Importance'}
                items={snapshot.clients.byImportance}
                language={language}
                hideZeroRows
                barColorClass={(k) =>
                  k === 'high'
                    ? 'bg-rose-600'
                    : k === 'medium'
                    ? 'bg-stone-600'
                    : 'bg-stone-400'
                }
              />
              <DistributionBarList
                title={isAr ? 'تصنيف العميل' : 'Category'}
                items={snapshot.clients.byCategory.slice(0, 6)}
                language={language}
                hideZeroRows
                barColorClass={() => 'bg-emerald-700'}
              />
              <DistributionBarList
                title={isAr ? 'القطاع / المجال' : 'Industry'}
                items={snapshot.clients.byIndustry.slice(0, 6)}
                language={language}
                hideZeroRows
                barColorClass={() => 'bg-sky-700'}
              />
            </div>

            {/* Newly Added Clients in Period */}
            {snapshot.clients.newClientsInPeriod.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-700" />
                    <span>
                      {isAr
                        ? `العملاء المضافون خلال الفترة (${snapshot.clients.newClientsInPeriod.length})`
                        : `New Clients in Period (${snapshot.clients.newClientsInPeriod.length})`}
                    </span>
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      handleDrill({
                        tab: 'clients',
                        quickFilter: 'all',
                        createdFrom: range.startKey,
                        createdTo: range.endKey,
                      })
                    }
                    className="text-[11px] font-semibold text-emerald-800 hover:underline"
                  >
                    {isAr ? 'فتح في قائمة العملاء' : 'Open in Clients'}
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {snapshot.clients.newClientsInPeriod.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectClient(c)}
                      className="px-2.5 py-1 rounded-xl border border-stone-200 bg-stone-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs text-stone-800 font-medium transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Compact Non-Disruptive Business Opportunities Summary Card (Task 008) */}
          {(() => {
            const oppMetrics = computeOpportunityPipelineMetrics(
              opportunities,
              effectiveRefDate,
              timeZone
            );
            return (
              <section
                data-testid="dashboard-opportunities-summary"
                className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-emerald-700" />
                    <h3 className="font-heading font-bold text-sm text-stone-900">
                      {isAr ? 'ملخص فرص الأعمال' : 'Business Opportunities Summary'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    data-testid="dashboard-open-opportunities-btn"
                    onClick={() => onGoToTab('opportunities')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold transition-colors"
                  >
                    <span>{isAr ? 'فتح مسار الفرص' : 'Open Pipeline'}</span>
                    <ArrowUpLeft className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80">
                    <span className="text-stone-500 block text-[11px]">
                      {isAr ? 'الفرص المفتوحة' : 'Open'}
                    </span>
                    <span className="font-extrabold text-stone-900 text-base tabular-nums">
                      {oppMetrics.openCount}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
                    <span className="text-emerald-800 block text-[11px]">
                      {isAr ? 'ناجحة (30 يوماً)' : 'Won (30d)'}
                    </span>
                    <span className="font-extrabold text-emerald-900 text-base tabular-nums">
                      {oppMetrics.wonInPeriodCount}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200/80">
                    <span className="text-rose-800 block text-[11px]">
                      {isAr ? 'غير ناجحة (30 يوماً)' : 'Lost (30d)'}
                    </span>
                    <span className="font-extrabold text-rose-900 text-base tabular-nums">
                      {oppMetrics.lostInPeriodCount}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80">
                    <span className="text-amber-900 block text-[11px]">
                      {isAr ? 'تتطلب متابعة' : 'Needs Follow-Up'}
                    </span>
                    <span className="font-extrabold text-amber-900 text-base tabular-nums">
                      {oppMetrics.needsFollowUpCount}
                    </span>
                  </div>
                </div>
              </section>
            );
          })()}
        </>
      )}

      {/* Printable Summary Modal */}
      {isPrintModalOpen && (
        <AnalyticsPrintModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          snapshot={snapshot}
          language={language}
        />
      )}
    </div>
  );
};

interface KpiButtonCardProps {
  testId: string;
  label: string;
  value: number | string;
  scopeLabel: string;
  scopeType: 'period' | 'cumulative';
  subtext?: string;
  tone?: 'neutral' | 'emerald' | 'amber' | 'rose';
  onClick?: () => void;
}

const KpiButtonCard: React.FC<KpiButtonCardProps> = ({
  testId,
  label,
  value,
  scopeLabel,
  scopeType,
  subtext,
  tone = 'neutral',
  onClick,
}) => {
  const valueClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
      ? 'text-amber-800'
      : tone === 'rose'
      ? 'text-rose-700'
      : 'text-stone-900';

  const scopeClass =
    scopeType === 'period'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : 'bg-stone-100 text-stone-600 border-stone-200';

  const body = (
    <div className="flex flex-col justify-between h-full text-start gap-2">
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-[11px] font-medium text-stone-600 leading-snug">{label}</span>
        <span
          className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${scopeClass}`}
        >
          {scopeLabel}
        </span>
      </div>
      <div>
        <div className={`font-heading font-extrabold text-xl sm:text-2xl tabular-nums ${valueClass}`}>
          {value}
        </div>
        {subtext && (
          <div className="text-[10.5px] text-stone-500 mt-0.5 tabular-nums truncate">
            {subtext}
          </div>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        className="w-full bg-white rounded-xl border border-stone-200 hover:border-emerald-400 p-3 transition-colors cursor-pointer"
      >
        {body}
      </button>
    );
  }

  return (
    <div
      data-testid={testId}
      className="bg-white rounded-xl border border-stone-200 p-3"
    >
      {body}
    </div>
  );
};
