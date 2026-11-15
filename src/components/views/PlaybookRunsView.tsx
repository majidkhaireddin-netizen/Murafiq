import React, { useMemo, useState } from 'react';
import type {
  Client,
  Opportunity,
  PlaybookRun,
  PlaybookRunStatus,
} from '../../types';
import {
  PLAYBOOK_RUN_STATUS_META,
  computePlaybookRunProgress,
  getPlaybookRunStepPointers,
} from '../../utils/playbookEngine';
import {
  Play,
  Plus,
  Building2,
  Briefcase,
  Clock,
  Search,
  AlertTriangle,
  ListChecks,
  ArrowLeft,
} from 'lucide-react';

interface PlaybookRunsViewProps {
  runs: PlaybookRun[];
  clients: Client[];
  opportunities: Opportunity[];
  isLoading: boolean;
  language: 'ar' | 'en';
  onOpenRun: (run: PlaybookRun) => void;
  onOpenStartPlaybook: () => void;
  onGoToTemplates: () => void;
}

export const PlaybookRunsView: React.FC<PlaybookRunsViewProps> = ({
  runs,
  clients,
  opportunities,
  isLoading,
  onOpenRun,
  onOpenStartPlaybook,
  onGoToTemplates,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | PlaybookRunStatus>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients]
  );
  const opportunityById = useMemo(
    () => new Map(opportunities.map((o) => [o.id, o])),
    [opportunities]
  );

  const counts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let completed = 0;
    let cancelled = 0;
    for (const r of runs) {
      if (r.status === 'active') active += 1;
      else if (r.status === 'paused') paused += 1;
      else if (r.status === 'completed') completed += 1;
      else if (r.status === 'cancelled') cancelled += 1;
    }
    return { total: runs.length, active, paused, completed, cancelled };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...runs]
      .filter((r) => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (clientFilter !== 'all' && r.clientId !== clientFilter) return false;
        if (q) {
          const cName = clientById.get(r.clientId)?.name?.toLowerCase() || '';
          const oName = r.opportunityId
            ? opportunityById.get(r.opportunityId)?.title?.toLowerCase() || ''
            : '';
          const stepText = r.steps.map((s) => s.title.toLowerCase()).join(' ');
          const haystack = `${r.templateName.toLowerCase()} ${cName} ${oName} ${stepText}`;
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.updatedAt || b.startedAt).localeCompare(a.updatedAt || a.startedAt));
  }, [runs, statusFilter, clientFilter, searchQuery, clientById, opportunityById]);

  return (
    <div className="space-y-4" data-testid="playbook-runs-view">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base sm:text-lg font-bold text-stone-900">
            خطط العلاقات والمتابعات النشطة والتاريخية
          </h2>
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
            تتبّع مراحل المتابعة مع كل عميل وفرصة خطوة بخطوة، وحوّل الخطوات عند الحاجة إلى مهام أو تواصل موثق.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0 text-xs">
          <button
            type="button"
            onClick={onGoToTemplates}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-800 font-semibold"
          >
            <ListChecks className="w-4 h-4 text-stone-600" />
            <span>مكتبة القوالب</span>
          </button>
          <button
            type="button"
            data-testid="start-new-playbook-run-btn"
            onClick={onOpenStartPlaybook}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>بدء خطة متابعة</span>
          </button>
        </div>
      </div>

      {/* Status Summary Filter Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          className={`p-3 rounded-2xl border text-start transition-all ${
            statusFilter === 'active'
              ? 'bg-emerald-50 border-emerald-400'
              : 'bg-white border-stone-200 hover:border-emerald-300'
          }`}
        >
          <span className="text-stone-500 text-[11px] block">الخطط النشطة</span>
          <span className="text-xl font-bold text-emerald-900 tabular-nums">{counts.active}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'paused' ? 'all' : 'paused')}
          className={`p-3 rounded-2xl border text-start transition-all ${
            statusFilter === 'paused'
              ? 'bg-amber-50 border-amber-400'
              : 'bg-white border-stone-200 hover:border-amber-300'
          }`}
        >
          <span className="text-stone-500 text-[11px] block">متوقفة مؤقتًا</span>
          <span className="text-xl font-bold text-amber-900 tabular-nums">{counts.paused}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')}
          className={`p-3 rounded-2xl border text-start transition-all ${
            statusFilter === 'completed'
              ? 'bg-teal-50 border-teal-400'
              : 'bg-white border-stone-200 hover:border-teal-300'
          }`}
        >
          <span className="text-stone-500 text-[11px] block">مكتملة</span>
          <span className="text-xl font-bold text-teal-900 tabular-nums">{counts.completed}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'cancelled' ? 'all' : 'cancelled')}
          className={`p-3 rounded-2xl border text-start transition-all ${
            statusFilter === 'cancelled'
              ? 'bg-rose-50 border-rose-400'
              : 'bg-white border-stone-200 hover:border-rose-300'
          }`}
        >
          <span className="text-stone-500 text-[11px] block">ملغاة</span>
          <span className="text-xl font-bold text-rose-900 tabular-nums">{counts.cancelled}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بعنوان الخطة أو العميل أو الخطوة..."
            className="w-full ps-9 pe-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
          />
        </div>

        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
        >
          <option value="all">جميع العملاء</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {(statusFilter !== 'all' || clientFilter !== 'all' || searchQuery.trim()) && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setClientFilter('all');
              setSearchQuery('');
            }}
            className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold"
          >
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* Runs List */}
      {isLoading && runs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center text-xs text-stone-500">
          جارٍ تحميل خطط المتابعة...
        </div>
      ) : filteredRuns.length === 0 ? (
        <div
          data-testid="playbook-runs-empty-state"
          className="bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-3"
        >
          <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto">
            <Play className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <p className="font-bold text-sm text-stone-800">
              {runs.length > 0
                ? 'لا توجد خطط تطابق الفلاتر الحالية'
                : 'لم تبدأ أي خطة متابعة بعد'}
            </p>
            <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
              {runs.length > 0
                ? 'جرّب تغيير حالة الفلترة أو مسح البحث لعرض الخطط المتوفرة.'
                : 'اختر قالبًا جاهزًا أو مخصصًا وابدأ خطة متابعة منظمة مع أحد عملائك أو فرصك الحالية.'}
            </p>
          </div>
          {runs.length === 0 && (
            <button
              type="button"
              onClick={onOpenStartPlaybook}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              <span>بدء أول خطة متابعة</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRuns.map((run) => {
            const client = clientById.get(run.clientId);
            const opp = run.opportunityId ? opportunityById.get(run.opportunityId) : undefined;
            const statusMeta = PLAYBOOK_RUN_STATUS_META[run.status];
            const progress = computePlaybookRunProgress(run);
            const pointers = getPlaybookRunStepPointers(run);

            return (
              <div
                key={run.id}
                data-testid={`playbook-run-card-${run.id}`}
                onClick={() => onOpenRun(run)}
                className="bg-white rounded-2xl border border-stone-200 hover:border-emerald-400 p-4 shadow-2xs cursor-pointer transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.labelAr}
                      </span>
                      {client ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-100 text-stone-800 text-[11px] font-semibold">
                          <Building2 className="w-3 h-3 text-emerald-700" />
                          <span>{client.name}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-[11px] font-semibold">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          <span>عميل محذوف</span>
                        </span>
                      )}
                      {opp && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 text-[11px] font-semibold">
                          <Briefcase className="w-3 h-3 text-indigo-700" />
                          <span>{opp.title}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                      {run.templateName}
                    </h3>
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-900">
                    <span>فتح المساحة</span>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Progress Bar & Pointers */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-stone-600">
                    <span>
                      الإنجاز: {progress.completedStepsCount} / {progress.totalStepsCount} (
                      {progress.completionPercent}%)
                      {progress.skippedStepsCount > 0 &&
                        ` • متجاوزة: ${progress.skippedStepsCount}`}
                    </span>
                    {pointers.nextFollowUpDate && (
                      <span className="inline-flex items-center gap-1 font-semibold text-stone-800">
                        <Clock className="w-3 h-3 text-stone-400" />
                        <span>أقرب موعد: {pointers.nextFollowUpDate}</span>
                      </span>
                    )}
                  </div>
                  <div className="w-full h-2 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-700 transition-all"
                      style={{ width: `${progress.completionPercent}%` }}
                    />
                  </div>
                  {pointers.currentStep && run.status === 'active' && (
                    <p className="text-[11px] text-stone-600">
                      <span className="font-semibold text-stone-800">الخطوة الحالية:</span>{' '}
                      {pointers.currentStep.order}. {pointers.currentStep.title}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
