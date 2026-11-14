import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  Meeting,
  Opportunity,
  OpportunityStage,
  OpportunityStageEvent,
  OpportunityType,
  SyncState,
  TaskPriority,
} from '../../types';
import {
  OPPORTUNITY_ALL_STAGES,
  OPPORTUNITY_STAGE_CONFIG,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_VALID_TYPES,
  OpportunitySortBy,
  aggregateValuesByCurrency,
  computeOpportunityPipelineMetrics,
  evaluateOpportunityFollowUpAlerts,
  filterAndSortOpportunities,
  formatOpportunityMoney,
  groupOpportunitiesByStage,
  isOpportunityClosed,
} from '../../utils/opportunities';
import { getPriorityBadge } from '../../utils/logic';
import { OpportunityFormModal } from '../OpportunityFormModal';
import { OpportunityDetailWorkspace } from '../OpportunityDetailWorkspace';
import {
  AlertTriangle,
  Briefcase,
  Columns3,
  List,
  Plus,
  RotateCcw,
  Search,
  User,
} from 'lucide-react';

interface OpportunitiesViewProps {
  opportunities: Opportunity[];
  stageEvents: OpportunityStageEvent[];
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  selectedOpportunityId?: string | null;
  onSelectOpportunity: (id: string | null) => void;
  onSaveOpportunity: (
    data: Partial<Opportunity> & { clientId: string; title: string },
    initialNote?: string
  ) => Promise<Opportunity | void> | void;
  onRequestStageChange: (opportunity: Opportunity, targetStage: OpportunityStage) => void;
  onDeleteOpportunity: (opportunity: Opportunity) => Promise<void> | void;
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
  createTrigger?: { token: number; clientId?: string } | null;
  isLoading?: boolean;
  syncState?: SyncState;
  language: 'ar' | 'en';
}

export const OpportunitiesView: React.FC<OpportunitiesViewProps> = ({
  opportunities,
  stageEvents,
  clients,
  meetings,
  tasks,
  selectedOpportunityId,
  onSelectOpportunity,
  onSaveOpportunity,
  onRequestStageChange,
  onDeleteOpportunity,
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
  createTrigger,
  isLoading = false,
  syncState,
  language,
}) => {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<OpportunityStage | 'all'>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<OpportunityType | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [statusGroup, setStatusGroup] = useState<'all' | 'open' | 'closed'>('all');
  const [needsFollowUpOnly, setNeedsFollowUpOnly] = useState(false);
  const [sortBy, setSortBy] = useState<OpportunitySortBy>('updated_desc');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState<Opportunity | null>(null);
  const [prefillClientId, setPrefillClientId] = useState<string | undefined>(undefined);
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null);

  useEffect(() => {
    if (createTrigger && createTrigger.token > 0) {
      setEditingOpportunity(null);
      setPrefillClientId(createTrigger.clientId);
      setIsFormOpen(true);
    }
  }, [createTrigger]);

  const clientsById = useMemo(
    () => new Map<string, Client>(clients.map((c) => [c.id, c])),
    [clients]
  );

  const selectedOpportunity = useMemo(
    () =>
      selectedOpportunityId
        ? opportunities.find((o) => o.id === selectedOpportunityId) || null
        : null,
    [opportunities, selectedOpportunityId]
  );

  const filteredOpportunities = useMemo(
    () =>
      filterAndSortOpportunities(opportunities, {
        searchQuery,
        stage: stageFilter,
        clientId: clientFilter,
        type: typeFilter,
        priority: priorityFilter,
        statusGroup,
        needsFollowUpOnly,
        sortBy,
        clients,
      }),
    [
      opportunities,
      searchQuery,
      stageFilter,
      clientFilter,
      typeFilter,
      priorityFilter,
      statusGroup,
      needsFollowUpOnly,
      sortBy,
      clients,
    ]
  );

  const groupedByStage = useMemo(
    () => groupOpportunitiesByStage(filteredOpportunities),
    [filteredOpportunities]
  );

  const metrics = useMemo(
    () => computeOpportunityPipelineMetrics(opportunities),
    [opportunities]
  );

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      stageFilter !== 'all' ||
      clientFilter !== 'all' ||
      typeFilter !== 'all' ||
      priorityFilter !== 'all' ||
      statusGroup !== 'all' ||
      needsFollowUpOnly
  );

  const resetFilters = () => {
    setSearchQuery('');
    setStageFilter('all');
    setClientFilter('all');
    setTypeFilter('all');
    setPriorityFilter('all');
    setStatusGroup('all');
    setNeedsFollowUpOnly(false);
  };

  const handleOpenCreate = () => {
    setEditingOpportunity(null);
    setPrefillClientId(clientFilter !== 'all' ? clientFilter : undefined);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (opp: Opportunity) => {
    setEditingOpportunity(opp);
    setPrefillClientId(opp.clientId);
    setIsFormOpen(true);
  };

  if (selectedOpportunity) {
    return (
      <>
        <OpportunityDetailWorkspace
          opportunity={selectedOpportunity}
          client={clientsById.get(selectedOpportunity.clientId)}
          meetings={meetings}
          tasks={tasks}
          stageEvents={stageEvents}
          onBack={() => onSelectOpportunity(null)}
          onEdit={handleOpenEdit}
          onDelete={async (opp) => {
            await onDeleteOpportunity(opp);
            onSelectOpportunity(null);
          }}
          onRequestStageChange={onRequestStageChange}
          onUpdateOpportunity={async (updated) => {
            await onSaveOpportunity(updated);
          }}
          onConvertNextActionToTask={onConvertNextActionToTask}
          onLinkMeeting={onLinkMeeting}
          onUnlinkMeeting={onUnlinkMeeting}
          onLinkTask={onLinkTask}
          onUnlinkTask={onUnlinkTask}
          onToggleTaskStatus={onToggleTaskStatus}
          onCreateLinkedMeeting={onCreateLinkedMeeting}
          onCreateLinkedTask={onCreateLinkedTask}
          onOpenClient={onOpenClient}
          onOpenMeeting={onOpenMeeting}
          onOpenTask={onOpenTask}
          language={language}
        />

        <OpportunityFormModal
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          clients={clients}
          initialOpportunity={editingOpportunity}
          defaultClientId={prefillClientId}
          onSubmit={async (data, note) => {
            await onSaveOpportunity(data, note);
          }}
          language={language}
        />
      </>
    );
  }

  return (
    <div
      className="space-y-4 pb-6"
      data-testid="opportunities-view"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-stone-900 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-emerald-700" />
            <span>{language === 'ar' ? 'فرص الأعمال ومسار العلاقات' : 'Business Opportunities'}</span>
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {language === 'ar'
              ? 'متابعة الفرص المرتبطة بالعملاء واللقاءات والمهام عبر مراحل واضحة'
              : 'Track client opportunities, next actions, and linked engagements'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-stone-200 bg-white p-0.5">
            <button
              type="button"
              data-testid="opp-view-kanban"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-emerald-700 text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'المسار' : 'Pipeline'}</span>
            </button>
            <button
              type="button"
              data-testid="opp-view-list"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                viewMode === 'list'
                  ? 'bg-emerald-700 text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'القائمة' : 'List'}</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="new-opportunity-btn"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{language === 'ar' ? 'فرصة جديدة' : 'New Opportunity'}</span>
          </button>
        </div>
      </div>

      {/* Sync / Offline notice when local/pending */}
      {(syncState === 'local' || syncState === 'pending') && (
        <div className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
          {language === 'ar'
            ? 'أنت تعمل محلياً أو بانتظار المزامنة — تُحفظ الفرص وسجل مراحلها محلياً وتُرفع تلقائياً عند توفر الاتصال.'
            : 'Working offline/pending sync — opportunities sync automatically on reconnect.'}
        </div>
      )}

      {/* Summary KPIs Strip */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3.5 sm:p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80">
            <span className="text-[11px] text-stone-500 block">
              {language === 'ar' ? 'الفرص المفتوحة' : 'Open Opportunities'}
            </span>
            <span className="text-lg font-extrabold text-stone-900 tabular-nums">
              {metrics.openCount}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
            <span className="text-[11px] text-emerald-800 block">
              {language === 'ar' ? 'ناجحة / غير ناجحة (30 يوماً)' : 'Won / Lost (30d)'}
            </span>
            <span className="text-lg font-extrabold text-emerald-900 tabular-nums">
              {metrics.wonInPeriodCount} / {metrics.lostInPeriodCount}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80">
            <span className="text-[11px] text-amber-900 block">
              {language === 'ar' ? 'تتطلب متابعة / متأخرة' : 'Needs Follow-Up / Overdue'}
            </span>
            <span className="text-lg font-extrabold text-amber-900 tabular-nums">
              {metrics.needsFollowUpCount} ({metrics.overdueFollowUpCount})
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-sky-50/70 border border-sky-200/80">
            <span className="text-[11px] text-sky-900 block">
              {language === 'ar' ? 'محدّثة خلال 7 أيام' : 'Updated (7d)'}
            </span>
            <span className="text-lg font-extrabold text-sky-900 tabular-nums">
              {metrics.recentlyUpdatedCount}
            </span>
          </div>
        </div>

        {/* Strict Per-Currency Totals (Open vs Won separated, never mixed across currencies) */}
        {(metrics.openTotalsByCurrency.length > 0 || metrics.wonTotalsByCurrency.length > 0) && (
          <div className="pt-2.5 border-t border-stone-100 flex flex-col gap-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-stone-700">
                {language === 'ar' ? 'إجمالي القيم المفتوحة:' : 'Open Totals:'}
              </span>
              {metrics.openTotalsByCurrency.length === 0 ? (
                <span className="text-stone-400">0</span>
              ) : (
                metrics.openTotalsByCurrency.map((entry) => (
                  <span
                    key={`open-${entry.currency}`}
                    className="px-2 py-0.5 rounded-lg bg-stone-100 text-stone-800 font-bold tabular-nums border border-stone-200"
                  >
                    {entry.formatted} ({entry.count})
                  </span>
                ))
              )}

              {metrics.wonTotalsByCurrency.length > 0 && (
                <>
                  <span className="font-bold text-emerald-800 mr-2">
                    {language === 'ar' ? 'الفرص الناجحة:' : 'Won Totals:'}
                  </span>
                  {metrics.wonTotalsByCurrency.map((entry) => (
                    <span
                      key={`won-${entry.currency}`}
                      className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 font-bold tabular-nums border border-emerald-200"
                    >
                      {entry.formatted} ({entry.count})
                    </span>
                  ))}
                </>
              )}
            </div>
            <p className="text-[10px] text-stone-500">
              {language === 'ar'
                ? 'تُعرض المبالغ التقديرية منفصلة حسب كل عملة دون تحويل عملات أو احتمالات إغلاق مفترضة، مع فصل الفرص المفتوحة عن المغلقة.'
                : 'Totals are shown per currency without automatic FX conversion; open and closed pipelines remain separated.'}
            </p>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3 space-y-2.5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute top-1/2 -translate-y-1/2 right-3" />
            <input
              type="text"
              data-testid="opp-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'بحث في العنوان، العميل، الخطوة التالية...'
                  : 'Search title, client, next action...'
              }
              className="w-full pr-8 pl-3 py-1.5 rounded-xl border border-stone-200 bg-stone-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>

          <select
            data-testid="opp-filter-client"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
          >
            <option value="all">{language === 'ar' ? 'جميع العملاء' : 'All Clients'}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            data-testid="opp-filter-stage"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as OpportunityStage | 'all')}
            className="px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
          >
            <option value="all">{language === 'ar' ? 'جميع المراحل' : 'All Stages'}</option>
            {OPPORTUNITY_ALL_STAGES.map((stKey) => (
              <option key={stKey} value={stKey}>
                {language === 'ar'
                  ? OPPORTUNITY_STAGE_CONFIG[stKey].labelAr
                  : OPPORTUNITY_STAGE_CONFIG[stKey].labelEn}
              </option>
            ))}
          </select>

          <select
            data-testid="opp-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as OpportunityType | 'all')}
            className="px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
          >
            <option value="all">{language === 'ar' ? 'جميع الأنواع' : 'All Types'}</option>
            {OPPORTUNITY_VALID_TYPES.map((tKey) => (
              <option key={tKey} value={tKey}>
                {language === 'ar'
                  ? OPPORTUNITY_TYPE_LABELS[tKey].ar
                  : OPPORTUNITY_TYPE_LABELS[tKey].en}
              </option>
            ))}
          </select>

          <select
            data-testid="opp-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as OpportunitySortBy)}
            className="px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800"
          >
            <option value="updated_desc">{language === 'ar' ? 'الأحدث تحديثاً' : 'Recently Updated'}</option>
            <option value="next_action_asc">{language === 'ar' ? 'أقرب خطوة تالية' : 'Next Action Date'}</option>
            <option value="expected_close_asc">{language === 'ar' ? 'أقرب إغلاق متوقع' : 'Expected Close'}</option>
            <option value="value_desc">{language === 'ar' ? 'الأعلى قيمة' : 'Highest Value'}</option>
            <option value="priority_desc">{language === 'ar' ? 'الأعلى أولوية' : 'Priority'}</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'open', 'closed'] as const).map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => setStatusGroup(grp)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border transition-colors ${
                  statusGroup === grp
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                }`}
              >
                {grp === 'all'
                  ? language === 'ar'
                    ? 'الكل'
                    : 'All'
                  : grp === 'open'
                  ? language === 'ar'
                    ? 'المفتوحة فقط'
                    : 'Open'
                  : language === 'ar'
                  ? 'المغلقة فقط'
                  : 'Closed'}
              </button>
            ))}

            <button
              type="button"
              data-testid="opp-filter-needs-followup"
              onClick={() => setNeedsFollowUpOnly((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-[11px] border transition-colors ${
                needsFollowUpOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>{language === 'ar' ? 'تتطلب متابعة' : 'Needs Follow-Up'}</span>
            </button>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | 'all')}
              className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-[11px] text-stone-700"
            >
              <option value="all">{language === 'ar' ? 'كل الأولويات' : 'All Priorities'}</option>
              <option value="urgent">{language === 'ar' ? 'عاجلة' : 'Urgent'}</option>
              <option value="high">{language === 'ar' ? 'مرتفعة' : 'High'}</option>
              <option value="medium">{language === 'ar' ? 'متوسطة' : 'Medium'}</option>
              <option value="low">{language === 'ar' ? 'منخفضة' : 'Low'}</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:underline"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{language === 'ar' ? 'مسح الفلاتر' : 'Reset Filters'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading / Empty / Board / List */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl bg-white border border-stone-200 animate-pulse p-4 space-y-3"
            >
              <div className="h-4 w-1/2 bg-stone-200 rounded" />
              <div className="h-14 bg-stone-100 rounded-xl" />
              <div className="h-14 bg-stone-100 rounded-xl" />
            </div>
          ))}
        </div>
      ) : opportunities.length === 0 ? (
        <div
          data-testid="opp-empty-state"
          className="bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-3"
        >
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
            <Briefcase className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-stone-900">
            {language === 'ar'
              ? 'لا توجد فرص أعمال مسجلة بعد'
              : 'No business opportunities yet'}
          </h3>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            {language === 'ar'
              ? 'سجّل فرص التعاون أو المشاريع مع عملائك وتابع خطواتها التالية والاجتماعات والمهام المرتبطة بها في مكان واحد.'
              : 'Create your first opportunity linked to a client to track stages, meetings, and next actions.'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
          >
            <Plus className="w-4 h-4" />
            <span>{language === 'ar' ? 'إنشاء أول فرصة عمل' : 'Create First Opportunity'}</span>
          </button>
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-2">
          <p className="text-xs font-bold text-stone-700">
            {language === 'ar'
              ? 'لا توجد فرص تطابق معايير البحث أو التصفية الحالية.'
              : 'No opportunities match current filters.'}
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-bold text-emerald-700 hover:underline"
          >
            {language === 'ar' ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}
          </button>
        </div>
      ) : viewMode === 'kanban' ? (
        /* Kanban Pipeline Board */
        <div
          data-testid="opp-kanban-board"
          className="flex gap-3 overflow-x-auto pb-3 items-start"
        >
          {OPPORTUNITY_ALL_STAGES.map((stKey) => {
            const cfg = OPPORTUNITY_STAGE_CONFIG[stKey];
            const items = groupedByStage[stKey] || [];
            const colTotals = aggregateValuesByCurrency(items);

            return (
              <div
                key={stKey}
                data-testid={`kanban-col-${stKey}`}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!draggedOppId) return;
                  const dragged = opportunities.find((o) => o.id === draggedOppId);
                  setDraggedOppId(null);
                  if (dragged && dragged.stage !== stKey) {
                    onRequestStageChange(dragged, stKey);
                  }
                }}
                className={`min-w-[265px] w-[265px] sm:w-[285px] shrink-0 bg-stone-50/90 rounded-2xl border border-stone-200 border-t-4 ${cfg.columnAccentClass} p-3 space-y-2.5`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-stone-900">
                    {language === 'ar' ? cfg.labelAr : cfg.labelEn}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-white border border-stone-200 text-[11px] font-bold text-stone-700 tabular-nums">
                    {items.length}
                  </span>
                </div>

                {colTotals.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {colTotals.map((ct) => (
                      <span
                        key={ct.currency}
                        className="px-1.5 py-0.5 rounded-md bg-white border border-stone-200 text-stone-600 font-semibold tabular-nums"
                      >
                        {ct.formatted}
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-2 min-h-[70px]">
                  {items.length === 0 ? (
                    <div className="py-5 text-center text-[11px] text-stone-400 border border-dashed border-stone-200 rounded-xl">
                      {language === 'ar' ? 'لا توجد فرص هنا' : 'Empty stage'}
                    </div>
                  ) : (
                    items.map((opp) => {
                      const client = clientsById.get(opp.clientId);
                      const alerts = evaluateOpportunityFollowUpAlerts({ opportunity: opp });
                      const prio = getPriorityBadge(opp.priority);
                      return (
                        <div
                          key={opp.id}
                          draggable
                          onDragStart={() => setDraggedOppId(opp.id)}
                          onDragEnd={() => setDraggedOppId(null)}
                          data-testid={`opp-card-${opp.id}`}
                          className="bg-white rounded-xl border border-stone-200 p-3 space-y-2 shadow-2xs hover:border-emerald-300 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectOpportunity(opp.id)}
                              className="text-right font-bold text-xs text-stone-900 hover:text-emerald-700 leading-snug flex-1"
                            >
                              {opp.title}
                            </button>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${prio.color}`}>
                              {prio.label}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
                            <span className="inline-flex items-center gap-1 truncate">
                              <User className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {client
                                  ? client.name
                                  : language === 'ar'
                                  ? 'عميل محذوف أو غير متوفر'
                                  : 'Deleted client'}
                              </span>
                            </span>
                            {typeof opp.estimatedValue === 'number' && opp.currency && (
                              <span className="font-bold text-stone-800 tabular-nums shrink-0">
                                {formatOpportunityMoney(opp.estimatedValue, opp.currency)}
                              </span>
                            )}
                          </div>

                          {opp.nextAction && (
                            <div className="p-2 rounded-lg bg-stone-50 border border-stone-100 text-[11px] text-stone-700">
                              <span className="block font-medium truncate">{opp.nextAction}</span>
                              {opp.nextActionDate && (
                                <span className="block text-[10px] text-stone-500 tabular-nums mt-0.5">
                                  {opp.nextActionDate}
                                </span>
                              )}
                            </div>
                          )}

                          {alerts.length > 0 && !isOpportunityClosed(opp.stage) && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                              <AlertTriangle className="w-3 h-3 shrink-0 text-amber-700" />
                              <span className="truncate">{alerts[0].messageArabic}</span>
                            </div>
                          )}

                          {/* Accessible Keyboard & Touch Stage Switcher */}
                          <div className="pt-1.5 border-t border-stone-100 flex items-center justify-between gap-2">
                            <select
                              aria-label={language === 'ar' ? 'نقل المرحلة' : 'Move stage'}
                              data-testid={`kanban-stage-select-${opp.id}`}
                              value={opp.stage}
                              onChange={(e) => {
                                const nextSt = e.target.value as OpportunityStage;
                                if (nextSt !== opp.stage) {
                                  onRequestStageChange(opp, nextSt);
                                }
                              }}
                              className="w-full px-2 py-1 rounded-lg border border-stone-200 bg-stone-50 text-[11px] font-semibold text-stone-700 focus:outline-hidden focus:border-emerald-600"
                            >
                              {OPPORTUNITY_ALL_STAGES.map((optSt) => (
                                <option key={optSt} value={optSt}>
                                  {language === 'ar'
                                    ? OPPORTUNITY_STAGE_CONFIG[optSt].labelAr
                                    : OPPORTUNITY_STAGE_CONFIG[optSt].labelEn}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Filterable & Sortable List View */
        <div
          data-testid="opp-list-view"
          className="bg-white rounded-2xl border border-stone-200 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600">
                <tr>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'الفرصة' : 'Opportunity'}</th>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'العميل' : 'Client'}</th>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'المرحلة' : 'Stage'}</th>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'القيمة' : 'Value'}</th>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'الخطوة التالية' : 'Next Action'}</th>
                  <th className="py-2.5 px-3 font-bold">{language === 'ar' ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredOpportunities.map((opp) => {
                  const client = clientsById.get(opp.clientId);
                  const stCfg = OPPORTUNITY_STAGE_CONFIG[opp.stage];
                  const alerts = evaluateOpportunityFollowUpAlerts({ opportunity: opp });
                  return (
                    <tr key={opp.id} className="hover:bg-stone-50/70">
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => onSelectOpportunity(opp.id)}
                          className="font-bold text-stone-900 hover:text-emerald-700 text-right block"
                        >
                          {opp.title}
                        </button>
                        {alerts.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{alerts[0].messageArabic}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-stone-600">
                        {client
                          ? client.name
                          : language === 'ar'
                          ? 'عميل محذوف أو غير متوفر'
                          : 'Deleted client'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${stCfg.badgeClass}`}
                        >
                          {language === 'ar' ? stCfg.labelAr : stCfg.labelEn}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-stone-800 tabular-nums">
                        {typeof opp.estimatedValue === 'number' && opp.currency
                          ? formatOpportunityMoney(opp.estimatedValue, opp.currency)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-stone-600">
                        <span className="block truncate max-w-[200px]">
                          {opp.nextAction || '—'}
                        </span>
                        {opp.nextActionDate && (
                          <span className="text-[10px] text-stone-400 tabular-nums">
                            {opp.nextActionDate}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => onSelectOpportunity(opp.id)}
                          className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-[11px]"
                        >
                          {language === 'ar' ? 'فتح' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OpportunityFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        clients={clients}
        initialOpportunity={editingOpportunity}
        defaultClientId={prefillClientId}
        onSubmit={async (data, note) => {
          await onSaveOpportunity(data, note);
        }}
        language={language}
      />
    </div>
  );
};
