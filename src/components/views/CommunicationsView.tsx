import React, { useMemo, useState } from 'react';
import type {
  ActionItem,
  Client,
  CommunicationChannel,
  CommunicationDatePreset,
  CommunicationDirection,
  CommunicationFilterState,
  CommunicationInteraction,
  CommunicationOutcome,
  Meeting,
  Opportunity,
  PlaybookRescheduleSuggestion,
  PlaybookRun,
  PlaybookRunStep,
  PlaybookTemplate,
} from '../../types';
import type { AtomicStepTaskCreationOutcome } from '../../utils/playbookEngine';
import { PlaybookRunsView } from './PlaybookRunsView';
import { PlaybookTemplatesView } from './PlaybookTemplatesView';
import { PlaybookRunWorkspace } from '../PlaybookRunWorkspace';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_CHANNELS_ORDER,
  COMMUNICATION_DIRECTION_META,
  COMMUNICATION_OUTCOME_META,
  COMMUNICATION_OUTCOMES_ORDER,
  DEFAULT_COMMUNICATION_FILTER_STATE,
  EXTERNAL_COMMUNICATION_DISCLOSURE_AR,
  EXTERNAL_COMMUNICATION_DISCLOSURE_EN,
  buildWhatsAppExternalUrl,
  computeClientCommunicationSummary,
  computeCommunicationCenterSummary,
  convertInteractionNextStepToTaskDraft,
  filterAndSortInteractions,
  findLinkedTaskForInteraction,
  resolveInteractionContact,
} from '../../utils/communications';
import { CHANNEL_ICON_MAP } from '../InteractionFormModal';
import { formatArabicDate } from '../../utils/logic';
import {
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  RotateCcw,
  Calendar,
  Clock,
  Tag,
  Building2,
  UserCheck,
  Briefcase,
  CheckSquare,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Edit3,
  Trash2,
  Info,
  ExternalLink,
  Sparkles,
  ListChecks,
  Play,
} from 'lucide-react';

export type CommunicationsSubTab = 'interactions' | 'playbooks' | 'templates';

interface CommunicationsViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  opportunities: Opportunity[];
  interactions: CommunicationInteraction[];
  playbookRuns?: PlaybookRun[];
  customPlaybookTemplates?: PlaybookTemplate[];
  currentUserId?: string;
  isOnline?: boolean;
  playbooksLoading?: boolean;
  playbookSubTab?: CommunicationsSubTab;
  onChangePlaybookSubTab?: (tab: CommunicationsSubTab) => void;
  selectedPlaybookRunId?: string | null;
  onSelectPlaybookRun?: (runId: string | null) => void;
  staleThresholdDays?: number;
  language: 'ar' | 'en';
  onOpenNewInteraction: (defaults?: {
    clientId?: string;
    contactId?: string;
    opportunityId?: string;
    channel?: CommunicationChannel;
  }) => void;
  onEditInteraction: (interaction: CommunicationInteraction) => void;
  onDeleteInteraction: (interactionId: string) => void;
  onConvertInteractionToTask: (
    updatedInteraction: CommunicationInteraction,
    taskDraft: ActionItem
  ) => void;
  onSelectClient: (client: Client) => void;
  onSelectOpportunity?: (opportunity: Opportunity) => void;
  onNavigateToTasks?: () => void;
  onOpenTask?: (task: ActionItem) => void;
  onOpenStartPlaybook?: (defaults?: {
    templateId?: string;
    clientId?: string;
    opportunityId?: string;
  }) => void;
  onOpenCreatePlaybookTemplate?: () => void;
  onOpenEditPlaybookTemplate?: (template: PlaybookTemplate) => void;
  onSavePlaybookTemplate?: (template: PlaybookTemplate) => void;
  onDeletePlaybookTemplate?: (templateId: string) => void;
  onSavePlaybookRun?: (run: PlaybookRun) => void;
  onSaveTask?: (task: ActionItem) => void;
  onAtomicConvertStepToTask?: (
    run: PlaybookRun,
    stepId: string
  ) => Promise<AtomicStepTaskCreationOutcome>;
  onApprovePlaybookRescheduleSuggestion?: (
    suggestion: PlaybookRescheduleSuggestion,
    applyToLinkedTask: boolean
  ) => void;
  onLogCommunicationForPlaybookStep?: (params: {
    run: PlaybookRun;
    step: PlaybookRunStep;
    suggestedChannel?: CommunicationChannel;
  }) => void;
  onComposeCommunicationForPlaybookStep?: (params: {
    run: PlaybookRun;
    step: PlaybookRunStep;
    suggestedChannel?: CommunicationChannel;
  }) => void;
  onOpenCommunicationComposer?: (params: {
    clientId: string;
    contactId?: string;
    opportunityId?: string;
    meetingId?: string;
    channel?: CommunicationChannel;
  }) => void;
}

const DATE_PRESET_LABELS: Record<CommunicationDatePreset, { ar: string; en: string }> = {
  all: { ar: 'كل الأوقات', en: 'All time' },
  today: { ar: 'اليوم', en: 'Today' },
  '7d': { ar: 'آخر 7 أيام', en: 'Last 7 days' },
  '30d': { ar: 'آخر 30 يوماً', en: 'Last 30 days' },
  '90d': { ar: 'آخر 90 يوماً', en: 'Last 90 days' },
  custom: { ar: 'فترة مخصصة', en: 'Custom range' },
};

export const CommunicationsView: React.FC<CommunicationsViewProps> = ({
  clients,
  meetings,
  tasks,
  opportunities,
  interactions,
  playbookRuns = [],
  customPlaybookTemplates = [],
  currentUserId = '',
  isOnline = true,
  playbooksLoading = false,
  playbookSubTab: controlledSubTab,
  onChangePlaybookSubTab,
  selectedPlaybookRunId: controlledRunId,
  onSelectPlaybookRun,
  staleThresholdDays = 14,
  language,
  onOpenNewInteraction,
  onEditInteraction,
  onDeleteInteraction,
  onConvertInteractionToTask,
  onSelectClient,
  onSelectOpportunity,
  onNavigateToTasks,
  onOpenTask,
  onOpenStartPlaybook,
  onOpenCreatePlaybookTemplate,
  onOpenEditPlaybookTemplate,
  onSavePlaybookTemplate,
  onDeletePlaybookTemplate,
  onSavePlaybookRun,
  onSaveTask,
  onAtomicConvertStepToTask,
  onApprovePlaybookRescheduleSuggestion,
  onLogCommunicationForPlaybookStep,
  onComposeCommunicationForPlaybookStep,
  onOpenCommunicationComposer,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<CommunicationsSubTab>('interactions');
  const activeSubTab = controlledSubTab ?? internalSubTab;
  const setActiveSubTab = (next: CommunicationsSubTab) => {
    setInternalSubTab(next);
    onChangePlaybookSubTab?.(next);
    onSelectPlaybookRun?.(null);
  };

  const [internalRunId, setInternalRunId] = useState<string | null>(null);
  const selectedRunId = controlledRunId !== undefined ? controlledRunId : internalRunId;
  const setSelectedRunId = (id: string | null) => {
    setInternalRunId(id);
    onSelectPlaybookRun?.(id);
  };

  const [filters, setFilters] = useState<CommunicationFilterState>(
    DEFAULT_COMMUNICATION_FILTER_STATE
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showStaleClientsPanel, setShowStaleClientsPanel] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => (selectedRunId ? playbookRuns.find((r) => r.id === selectedRunId) : undefined),
    [playbookRuns, selectedRunId]
  );

  const activePlaybookRunsCount = useMemo(
    () => playbookRuns.filter((r) => r.status === 'active').length,
    [playbookRuns]
  );

  const clientById = useMemo(
    () => new Map<string, Client>(clients.map((c) => [c.id, c])),
    [clients]
  );

  const opportunityById = useMemo(
    () => new Map<string, Opportunity>(opportunities.map((o) => [o.id, o])),
    [opportunities]
  );

  const centerSummary = useMemo(
    () =>
      computeCommunicationCenterSummary(
        interactions,
        clients,
        meetings,
        tasks,
        new Date(),
        staleThresholdDays
      ),
    [clients, interactions, meetings, tasks, staleThresholdDays]
  );

  const staleClients = useMemo(() => {
    const now = new Date();
    return clients
      .filter((c) => c.relationshipStatus !== 'inactive')
      .map((client) => ({
        client,
        summary: computeClientCommunicationSummary(
          client,
          interactions,
          meetings,
          tasks,
          now,
          staleThresholdDays
        ),
      }))
      .filter(
        ({ client, summary }) =>
          summary.isStaleContact || client.relationshipStatus === 'follow_up_needed'
      )
      .sort((a, b) => (b.summary.daysSinceLastContact ?? 9999) - (a.summary.daysSinceLastContact ?? 9999));
  }, [clients, interactions, meetings, tasks, staleThresholdDays]);

  const filteredInteractions = useMemo(
    () =>
      filterAndSortInteractions(interactions, filters, {
        clients,
        opportunities,
        tasks,
      }),
    [interactions, clients, opportunities, tasks, filters]
  );

  const selectedFilterClient = useMemo(
    () =>
      filters.clientId !== 'all' ? clientById.get(filters.clientId) : undefined,
    [filters.clientId, clientById]
  );

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.searchQuery.trim()) count += 1;
    if (filters.channel !== 'all') count += 1;
    if (filters.outcome !== 'all') count += 1;
    if (filters.direction !== 'all') count += 1;
    if (filters.followUpFilter !== 'all') count += 1;
    if (filters.clientId !== 'all') count += 1;
    if (filters.contactId !== 'all') count += 1;
    if (filters.datePreset !== 'all') count += 1;
    return count;
  }, [filters]);

  const updateFilter = <K extends keyof CommunicationFilterState>(
    key: K,
    value: CommunicationFilterState[K]
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'clientId' ? { contactId: 'all' } : {}),
    }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_COMMUNICATION_FILTER_STATE);
  };

  const handleConvertNextStep = (interaction: CommunicationInteraction) => {
    const { task, updatedInteraction, alreadyExisted } =
      convertInteractionNextStepToTaskDraft(interaction, tasks);
    if (!alreadyExisted) {
      onConvertInteractionToTask(updatedInteraction, task);
    }
  };

  return (
    <div className="space-y-5 pb-8" data-testid="communications-center-view">
      {/* Unified Sub-Navigation (Communications | Playbooks | Playbook Templates) */}
      <div
        data-testid="communications-subnav"
        className="bg-white rounded-2xl border border-stone-200 p-1.5 flex items-center gap-1.5 flex-wrap shadow-2xs text-xs"
      >
        <button
          type="button"
          data-testid="comm-subtab-interactions"
          onClick={() => setActiveSubTab('interactions')}
          className={`flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold transition-colors ${
            activeSubTab === 'interactions' && !selectedRun
              ? 'bg-emerald-900 text-white shadow-2xs'
              : 'text-stone-700 hover:bg-stone-100'
          }`}
        >
          <Phone className="w-3.5 h-3.5" />
          <span>سجل التواصل</span>
        </button>

        <button
          type="button"
          data-testid="comm-subtab-playbooks"
          onClick={() => setActiveSubTab('playbooks')}
          className={`flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold transition-colors ${
            activeSubTab === 'playbooks' || Boolean(selectedRun)
              ? 'bg-emerald-900 text-white shadow-2xs'
              : 'text-stone-700 hover:bg-stone-100'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          <span>خطط المتابعة</span>
          {activePlaybookRunsCount > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                activeSubTab === 'playbooks' || Boolean(selectedRun)
                  ? 'bg-white/20 text-white'
                  : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              {activePlaybookRunsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          data-testid="comm-subtab-templates"
          onClick={() => setActiveSubTab('templates')}
          className={`flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold transition-colors ${
            activeSubTab === 'templates' && !selectedRun
              ? 'bg-emerald-900 text-white shadow-2xs'
              : 'text-stone-700 hover:bg-stone-100'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5" />
          <span>مكتبة خطط المتابعة</span>
        </button>
      </div>

      {selectedRun && onSavePlaybookRun && onAtomicConvertStepToTask ? (
        <PlaybookRunWorkspace
          run={selectedRun}
          allRuns={playbookRuns}
          clients={clients}
          opportunities={opportunities}
          tasks={tasks}
          interactions={interactions}
          currentUserId={currentUserId}
          isOnline={isOnline}
          language={language}
          onBack={() => setSelectedRunId(null)}
          onSaveRun={onSavePlaybookRun}
          onSaveTask={(t) => onSaveTask?.(t)}
          onAtomicConvertStepToTask={onAtomicConvertStepToTask}
          onApproveRescheduleSuggestion={(sug, applyTask) =>
            onApprovePlaybookRescheduleSuggestion?.(sug, applyTask)
          }
          onLogCommunicationForStep={(params) =>
            onLogCommunicationForPlaybookStep?.(params)
          }
          onComposeCommunicationForStep={(params) =>
            onComposeCommunicationForPlaybookStep?.(params)
          }
          onOpenCommunicationComposer={onOpenCommunicationComposer}
          onSelectClient={onSelectClient}
          onSelectOpportunity={(opp) => onSelectOpportunity?.(opp)}
          onOpenTask={(t) => onOpenTask?.(t)}
          onOpenInteraction={onEditInteraction}
        />
      ) : activeSubTab === 'playbooks' ? (
        <PlaybookRunsView
          runs={playbookRuns}
          clients={clients}
          opportunities={opportunities}
          isLoading={playbooksLoading}
          language={language}
          onOpenRun={(run) => setSelectedRunId(run.id)}
          onOpenStartPlaybook={() => onOpenStartPlaybook?.()}
          onGoToTemplates={() => setActiveSubTab('templates')}
        />
      ) : activeSubTab === 'templates' ? (
        <PlaybookTemplatesView
          customTemplates={customPlaybookTemplates}
          currentUserId={currentUserId}
          isLoading={playbooksLoading}
          language={language}
          onCreateTemplate={() => onOpenCreatePlaybookTemplate?.()}
          onEditTemplate={(tpl) => onOpenEditPlaybookTemplate?.(tpl)}
          onSaveClonedTemplate={(tpl) => onSavePlaybookTemplate?.(tpl)}
          onDeleteTemplate={(id) => onDeletePlaybookTemplate?.(id)}
          onStartFromTemplate={(templateId) => onOpenStartPlaybook?.({ templateId })}
        />
      ) : (
        <>
      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-bold mb-1.5">
              <Phone className="w-3 h-3 text-emerald-700" />
              <span>
                {language === 'ar'
                  ? 'إدارة العلاقات وسجل التواصل الموحد'
                  : 'Unified Relationship & Communication Log'}
              </span>
            </div>
            <h1 className="font-heading text-lg sm:text-xl font-bold text-stone-900">
              {language === 'ar'
                ? 'مركز التواصل وسجل التفاعلات'
                : 'Communication Center & Interaction History'}
            </h1>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
              {language === 'ar'
                ? 'وثّق المكالمات والرسائل والزيارات مع العملاء وجهات الاتصال، وتابع الموضوعات المناقشة والخطوات التالية بوضوح.'
                : 'Document calls, messages, and visits with clients and contacts, and track discussed topics and next steps.'}
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            {onOpenCommunicationComposer && (
              <button
                type="button"
                data-testid="comm-center-open-composer-btn"
                onClick={() => {
                  const targetClientId =
                    filters.clientId !== 'all'
                      ? filters.clientId
                      : staleClients[0]?.client.id || clients[0]?.id || '';
                  onOpenCommunicationComposer({
                    clientId: targetClientId,
                    contactId:
                      filters.clientId !== 'all' && filters.contactId !== 'all'
                        ? filters.contactId
                        : undefined,
                    channel: filters.channel !== 'all' ? filters.channel : 'whatsapp',
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-900 font-bold text-xs shadow-2xs transition-colors"
              >
                <Sparkles className="w-4 h-4 text-teal-700" />
                <span>{language === 'ar' ? 'مساعد المراسلات الذكي' : 'Smart Composer'}</span>
              </button>
            )}
            <button
              type="button"
              data-testid="open-new-interaction-btn"
              onClick={() => onOpenNewInteraction()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{language === 'ar' ? 'تسجيل تواصل جديد' : 'Log Interaction'}</span>
            </button>
          </div>
        </div>

        {/* Quick Channel Action Buttons */}
        <div className="flex items-center flex-wrap gap-1.5 pt-3 border-t border-stone-100">
          <span className="text-[11px] font-semibold text-stone-500 me-1">
            {language === 'ar' ? 'توثيق سريع حسب الوسيلة:' : 'Quick log by channel:'}
          </span>
          {(
            ['phone_call', 'whatsapp', 'email', 'in_person_visit', 'video_call', 'other'] as CommunicationChannel[]
          ).map((ch) => {
            const meta = COMMUNICATION_CHANNEL_META[ch];
            const Icon = CHANNEL_ICON_MAP[ch];
            return (
              <button
                key={ch}
                type="button"
                data-testid={`quick-log-channel-${ch}`}
                onClick={() => onOpenNewInteraction({ channel: ch })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-stone-50 hover:bg-emerald-50 border border-stone-200 hover:border-emerald-300 text-stone-700 hover:text-emerald-900 text-[11px] font-semibold transition-colors"
              >
                <Icon className="w-3.5 h-3.5 text-emerald-700" />
                <span>+ {meta.shortLabelAr}</span>
              </button>
            );
          })}
        </div>

        {/* Honest External Dialer / App Disclosure Banner */}
        <div
          data-testid="external-communication-disclosure"
          className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/90 text-stone-600 text-[11px] flex items-start gap-2"
        >
          <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
          <span>
            {language === 'ar'
              ? EXTERNAL_COMMUNICATION_DISCLOSURE_AR
              : EXTERNAL_COMMUNICATION_DISCLOSURE_EN}
          </span>
        </div>
      </div>

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          onClick={() => resetFilters()}
          className="bg-white rounded-2xl border border-stone-200 p-3.5 shadow-2xs cursor-pointer hover:border-emerald-300 transition-all"
          data-testid="comm-kpi-total"
        >
          <div className="flex items-center justify-between text-stone-500 text-[11px] font-semibold">
            <span>إجمالي التفاعلات الموثقة</span>
            <Phone className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-stone-900 tabular-nums">
              {centerSummary.totalInteractions}
            </span>
            <span className="text-[11px] text-stone-500">سجل تواصل</span>
          </div>
          <p className="text-[10px] text-stone-400 mt-1">
            مكالمات: {centerSummary.byChannel.phone_call || 0} • واتساب:{' '}
            {centerSummary.byChannel.whatsapp || 0} • زيارات:{' '}
            {centerSummary.byChannel.in_person_visit || 0}
          </p>
        </div>

        <div
          onClick={() => updateFilter('datePreset', '7d')}
          className="bg-white rounded-2xl border border-stone-200 p-3.5 shadow-2xs cursor-pointer hover:border-emerald-300 transition-all"
          data-testid="comm-kpi-7d"
        >
          <div className="flex items-center justify-between text-stone-500 text-[11px] font-semibold">
            <span>التواصل خلال 7 أيام</span>
            <Clock className="w-4 h-4 text-sky-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-stone-900 tabular-nums">
              {centerSummary.interactionsLast7Days}
            </span>
            {centerSummary.interactionsToday > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                اليوم: {centerSummary.interactionsToday}
              </span>
            )}
          </div>
          <p className="text-[10px] text-stone-400 mt-1">
            انقر لعرض تفاعلات آخر 7 أيام
          </p>
        </div>

        <div
          onClick={() =>
            updateFilter(
              'followUpFilter',
              filters.followUpFilter === 'needs_follow_up' ? 'all' : 'needs_follow_up'
            )
          }
          className={`bg-white rounded-2xl border p-3.5 shadow-2xs cursor-pointer transition-all ${
            centerSummary.followUpsOverdueCount > 0
              ? 'border-amber-300 bg-amber-50/20'
              : 'border-stone-200 hover:border-emerald-300'
          }`}
          data-testid="comm-kpi-followups"
        >
          <div className="flex items-center justify-between text-stone-600 text-[11px] font-semibold">
            <span>متابعات تواصل مطلوبة</span>
            <CheckSquare className="w-4 h-4 text-amber-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-stone-900 tabular-nums">
              {centerSummary.followUpsPendingTotalCount}
            </span>
            {centerSummary.followUpsOverdueCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-bold">
                متأخرة: {centerSummary.followUpsOverdueCount}
              </span>
            )}
          </div>
          <p className="text-[10px] text-stone-500 mt-1">
            انقر لتصفية التفاعلات التي تتطلب متابعة
          </p>
        </div>

        <div
          onClick={() => setShowStaleClientsPanel((prev) => !prev)}
          className={`bg-white rounded-2xl border p-3.5 shadow-2xs cursor-pointer transition-all ${
            centerSummary.staleClientsCount > 0
              ? 'border-rose-200 bg-rose-50/20'
              : 'border-stone-200 hover:border-emerald-300'
          }`}
          data-testid="comm-kpi-stale-clients"
        >
          <div className="flex items-center justify-between text-stone-600 text-[11px] font-semibold">
            <span>عملاء انقطع التواصل معهم</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-stone-900 tabular-nums">
              {centerSummary.staleClientsCount}
            </span>
            <span className="text-[11px] text-stone-500">
              (&ge; {staleThresholdDays} يوم)
            </span>
          </div>
          <p className="text-[10px] text-stone-500 mt-1">
            استناداً إلى الاجتماعات وسجل التفاعلات معاً
          </p>
        </div>
      </div>

      {/* Stale Clients Radar Panel */}
      {staleClients.length > 0 && showStaleClientsPanel && (
        <div
          data-testid="stale-clients-radar-panel"
          className="bg-white rounded-2xl border border-amber-200/90 p-4 shadow-2xs space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                  رادار انقطاع التواصل ({staleClients.length} عملاء)
                </h2>
                <p className="text-[11px] text-stone-500">
                  عملاء لم يُسجل معهم اجتماع أو تواصل خلال آخر {staleThresholdDays} يوماً أو
                  مُصنّفون بحالة «يحتاج متابعة»
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowStaleClientsPanel(false)}
              className="text-[11px] font-semibold text-stone-500 hover:text-stone-800 px-2 py-1 rounded-lg"
            >
              إخفاء
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {staleClients.slice(0, 6).map(({ client, summary }) => {
              const whatsappUrl = buildWhatsAppExternalUrl(client.phone);
              return (
                <div
                  key={client.id}
                  data-testid={`stale-client-card-${client.id}`}
                  className="p-3 rounded-xl border border-stone-200 bg-stone-50/70 flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectClient(client)}
                        className="font-bold text-xs text-stone-900 hover:text-emerald-800 truncate block text-right"
                      >
                        {client.name}
                      </button>
                      {client.company && (
                        <p className="text-[11px] text-stone-500 truncate">
                          {client.company}
                        </p>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold shrink-0">
                      {summary.daysSinceLastContact !== null
                        ? `منذ ${summary.daysSinceLastContact} يوم`
                        : 'بدون تواصل مسجل'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-stone-200/70">
                    <div className="flex items-center gap-1">
                      {client.phone && (
                        <a
                          href={`tel:${client.phone}`}
                          title="فتح تطبيق الاتصال الخارجي على جهازك"
                          className="p-1.5 rounded-lg bg-white border border-stone-200 text-stone-700 hover:text-emerald-800 hover:border-emerald-300"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {whatsappUrl && (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="فتح محادثة واتساب في تطبيق الجهاز"
                          className="p-1.5 rounded-lg bg-white border border-stone-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {client.email && (
                        <a
                          href={`mailto:${client.email}`}
                          title="فتح تطبيق البريد الإلكتروني على جهازك"
                          className="p-1.5 rounded-lg bg-white border border-stone-200 text-sky-700 hover:bg-sky-50 hover:border-sky-300"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {onOpenCommunicationComposer && (
                        <button
                          type="button"
                          data-testid={`compose-stale-client-btn-${client.id}`}
                          onClick={() =>
                            onOpenCommunicationComposer({
                              clientId: client.id,
                              channel: 'whatsapp',
                            })
                          }
                          className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-900 text-[11px] font-bold inline-flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-teal-700" />
                          <span>مراسلة ذكية</span>
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`log-stale-client-btn-${client.id}`}
                        onClick={() => onOpenNewInteraction({ clientId: client.id })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>توثيق تواصل</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search & Smart Filters Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3.5 sm:p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 flex items-center bg-stone-50 border border-stone-300 focus-within:border-emerald-700 focus-within:bg-white rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-stone-400 shrink-0 me-2" />
            <input
              type="text"
              data-testid="communications-search-input"
              value={filters.searchQuery}
              onChange={(e) => updateFilter('searchQuery', e.target.value)}
              placeholder="ابحث في سجل التواصل بالعميل، جهة الاتصال، الموضوع، الملخص، أو الخطوة التالية..."
              className="w-full bg-transparent text-xs text-stone-900 placeholder-stone-400 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="toggle-comm-filters-btn"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                showAdvancedFilters || activeFiltersCount > 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>فلاتر متقدمة</span>
              {activeFiltersCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-800 text-white text-[10px] font-bold">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                type="button"
                data-testid="reset-comm-filters-btn"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة ضبط</span>
              </button>
            )}
          </div>
        </div>

        {/* Channel Quick Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            data-testid="comm-filter-channel-all"
            onClick={() => updateFilter('channel', 'all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border shrink-0 transition-colors ${
              filters.channel === 'all'
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
            }`}
          >
            كل الوسائل ({interactions.length})
          </button>
          {COMMUNICATION_CHANNELS_ORDER.map((ch) => {
            const meta = COMMUNICATION_CHANNEL_META[ch];
            const Icon = CHANNEL_ICON_MAP[ch];
            const count = centerSummary.byChannel[ch] || 0;
            const isSelected = filters.channel === ch;
            return (
              <button
                key={ch}
                type="button"
                data-testid={`comm-filter-channel-${ch}`}
                onClick={() => updateFilter('channel', isSelected ? 'all' : ch)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-emerald-800 text-white border-emerald-800'
                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>
                  {meta.shortLabelAr} ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Advanced Filter Dropdowns */}
        {showAdvancedFilters && (
          <div
            data-testid="comm-advanced-filters-panel"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-stone-100 text-xs"
          >
            <div>
              <label className="block text-[11px] font-bold text-stone-700 mb-1">
                العميل
              </label>
              <select
                data-testid="comm-filter-client-select"
                value={filters.clientId}
                onChange={(e) => updateFilter('clientId', e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
              >
                <option value="all">جميع العملاء</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.company ? `(${c.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedFilterClient &&
              (selectedFilterClient.contacts || []).length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-stone-700 mb-1">
                    جهة الاتصال لدى العميل
                  </label>
                  <select
                    data-testid="comm-filter-contact-select"
                    value={filters.contactId}
                    onChange={(e) => updateFilter('contactId', e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    <option value="all">جميع جهات الاتصال</option>
                    {(selectedFilterClient.contacts || []).map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name} {ct.title ? `(${ct.title})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

            <div>
              <label className="block text-[11px] font-bold text-stone-700 mb-1">
                نتيجة التواصل
              </label>
              <select
                data-testid="comm-filter-outcome-select"
                value={filters.outcome}
                onChange={(e) =>
                  updateFilter('outcome', e.target.value as 'all' | CommunicationOutcome)
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
              >
                <option value="all">كل النتائج</option>
                {COMMUNICATION_OUTCOMES_ORDER.map((out) => (
                  <option key={out} value={out}>
                    {COMMUNICATION_OUTCOME_META[out].labelAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-stone-700 mb-1">
                حالة المتابعة
              </label>
              <select
                data-testid="comm-filter-followup-select"
                value={filters.followUpFilter}
                onChange={(e) =>
                  updateFilter(
                    'followUpFilter',
                    e.target.value as CommunicationFilterState['followUpFilter']
                  )
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
              >
                <option value="all">الكل</option>
                <option value="needs_follow_up">يتطلب متابعة (بدون مهمة مكتملة)</option>
                <option value="overdue_follow_up">متابعة متأخرة أو مستحقة</option>
                <option value="has_linked_task">مرتبط بمهمة متابعة</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-stone-700 mb-1">
                الفترة الزمنية
              </label>
              <select
                data-testid="comm-filter-date-select"
                value={filters.datePreset}
                onChange={(e) =>
                  updateFilter('datePreset', e.target.value as CommunicationDatePreset)
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
              >
                {(Object.keys(DATE_PRESET_LABELS) as CommunicationDatePreset[]).map(
                  (preset) => (
                    <option key={preset} value={preset}>
                      {DATE_PRESET_LABELS[preset].ar}
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-stone-700 mb-1">
                اتجاه التواصل
              </label>
              <select
                data-testid="comm-filter-direction-select"
                value={filters.direction}
                onChange={(e) =>
                  updateFilter(
                    'direction',
                    e.target.value as 'all' | CommunicationDirection
                  )
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
              >
                <option value="all">صادر ووارد</option>
                <option value="outbound">صادر (بادرت بالتواصل)</option>
                <option value="inbound">وارد (العميل بادر بالتواصل)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Interaction History List */}
      <div className="space-y-3" data-testid="interactions-history-list">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-heading font-bold text-sm text-stone-800">
            سجل التفاعلات الزمني ({filteredInteractions.length})
          </h2>
          <span className="text-[11px] text-stone-500">
            مرتب من الأحدث إلى الأقدم
          </span>
        </div>

        {filteredInteractions.length === 0 ? (
          <div
            data-testid="interactions-empty-state"
            className="bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-3"
          >
            <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto">
              <Phone className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-sm text-stone-800">
                {activeFiltersCount > 0
                  ? 'لا توجد سجلات تواصل تطابق الفلاتر المحددة'
                  : 'لم يتم تسجيل أي تفاعلات أو اتصالات بعد'}
              </p>
              <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
                {activeFiltersCount > 0
                  ? 'جرّب تعديل كلمات البحث أو مسح الفلاتر لعرض جميع السجلات.'
                  : 'ابدأ بتوثيق مكالماتك ورسائلك وزياراتك مع العملاء لبناء ذاكرة علاقات متكاملة وتنبيهات متابعة دقيقة.'}
              </p>
            </div>
            <div className="pt-1 flex items-center justify-center gap-2">
              {activeFiltersCount > 0 ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold"
                >
                  مسح الفلاتر
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenNewInteraction()}
                  className="px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>تسجيل أول تواصل</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredInteractions.map((interaction) => {
              const client = clientById.get(interaction.clientId);
              const opportunity = interaction.opportunityId
                ? opportunityById.get(interaction.opportunityId)
                : undefined;
              const resolvedContact = resolveInteractionContact(client, interaction.contactId);
              const contactDisplayName = resolvedContact?.name || interaction.contactName;
              const contactRole = resolvedContact?.title;
              const linkedTask = findLinkedTaskForInteraction(interaction, tasks);
              const channelMeta = COMMUNICATION_CHANNEL_META[interaction.channel];
              const outcomeMeta = COMMUNICATION_OUTCOME_META[interaction.outcome];
              const directionMeta = COMMUNICATION_DIRECTION_META[interaction.direction];
              const ChannelIcon = CHANNEL_ICON_MAP[interaction.channel];

              const contactPhone = resolvedContact?.phone || client?.phone;
              const contactEmail = resolvedContact?.email || client?.email;
              const whatsappUrl = buildWhatsAppExternalUrl(contactPhone);

              return (
                <div
                  key={interaction.id}
                  data-testid={`interaction-card-${interaction.id}`}
                  className="bg-white rounded-2xl border border-stone-200 hover:border-stone-300 p-4 shadow-2xs transition-all space-y-3"
                >
                  {/* Top Row: Channel + Direction + Outcome + Timestamp + Actions */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${channelMeta.badgeClass}`}
                      >
                        <ChannelIcon className="w-3.5 h-3.5" />
                        <span>{channelMeta.labelAr}</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${directionMeta.badgeClass}`}
                      >
                        {interaction.direction === 'outbound' ? (
                          <ArrowUpRight className="w-3 h-3" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3" />
                        )}
                        <span>{directionMeta.labelAr}</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${outcomeMeta.badgeClass}`}
                      >
                        <span>{outcomeMeta.labelAr}</span>
                      </span>

                      {typeof interaction.durationMinutes === 'number' &&
                        interaction.durationMinutes > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-100 text-stone-600 text-[11px] font-medium">
                            <Clock className="w-3 h-3 text-stone-400" />
                            <span>{interaction.durationMinutes} دقيقة</span>
                          </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        <span>{formatArabicDate(interaction.occurredAt)}</span>
                      </span>

                      <button
                        type="button"
                        data-testid={`edit-interaction-btn-${interaction.id}`}
                        onClick={() => onEditInteraction(interaction)}
                        className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                        title="تعديل سجل التواصل"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {confirmDeleteId === interaction.id ? (
                        <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-lg px-2 py-0.5">
                          <button
                            type="button"
                            data-testid={`confirm-delete-interaction-btn-${interaction.id}`}
                            onClick={() => {
                              onDeleteInteraction(interaction.id);
                              setConfirmDeleteId(null);
                            }}
                            className="text-[11px] font-bold text-rose-700 hover:underline"
                          >
                            تأكيد الحذف
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[11px] text-stone-500 hover:text-stone-800 px-1"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`delete-interaction-btn-${interaction.id}`}
                          onClick={() => setConfirmDeleteId(interaction.id)}
                          className="p-1.5 rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-700"
                          title="حذف سجل التواصل"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Client, Contact Person & Opportunity Context Row */}
                  <div className="flex items-center flex-wrap gap-2 text-xs">
                    {client && (
                      <button
                        type="button"
                        data-testid={`interaction-client-link-${interaction.id}`}
                        onClick={() => onSelectClient(client)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-emerald-50 text-stone-800 hover:text-emerald-900 font-bold transition-colors"
                      >
                        <Building2 className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{client.name}</span>
                        {client.company && (
                          <span className="text-stone-500 font-normal">
                            ({client.company})
                          </span>
                        )}
                      </button>
                    )}

                    {contactDisplayName && (
                      <span
                        data-testid={`interaction-contact-badge-${interaction.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 font-semibold text-[11px]"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-teal-700" />
                        <span>مع: {contactDisplayName}</span>
                        {contactRole && (
                          <span className="text-teal-700 font-normal">
                            ({contactRole})
                          </span>
                        )}
                      </span>
                    )}

                    {opportunity && (
                      <button
                        type="button"
                        onClick={() => onSelectOpportunity?.(opportunity)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 font-semibold text-[11px] hover:bg-indigo-100 transition-colors"
                      >
                        <Briefcase className="w-3.5 h-3.5 text-indigo-700" />
                        <span>الفرصة: {opportunity.title}</span>
                      </button>
                    )}

                    {/* Quick external call/WhatsApp/email shortcuts */}
                    <div className="ms-auto flex items-center gap-1">
                      {contactPhone && (
                        <a
                          href={`tel:${contactPhone}`}
                          title={`اتصال خارجي بـ ${contactPhone}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-[11px] font-medium"
                        >
                          <Phone className="w-3 h-3 text-emerald-700" />
                          <span className="hidden sm:inline">اتصال</span>
                        </a>
                      )}
                      {whatsappUrl && (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="فتح محادثة واتساب في تطبيق الجهاز"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/70 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-[11px] font-medium"
                        >
                          <MessageCircle className="w-3 h-3 text-emerald-700" />
                          <span className="hidden sm:inline">واتساب</span>
                        </a>
                      )}
                      {contactEmail && (
                        <a
                          href={`mailto:${contactEmail}`}
                          title={`إرسال بريد خارجي إلى ${contactEmail}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50/70 hover:bg-sky-100 border border-sky-200 text-sky-900 text-[11px] font-medium"
                        >
                          <Mail className="w-3 h-3 text-sky-700" />
                          <span className="hidden sm:inline">بريد</span>
                        </a>
                      )}
                      {onOpenCommunicationComposer && client && (
                        <button
                          type="button"
                          data-testid={`compose-interaction-btn-${interaction.id}`}
                          onClick={() =>
                            onOpenCommunicationComposer({
                              clientId: interaction.clientId,
                              contactId: resolvedContact ? interaction.contactId : undefined,
                              opportunityId: opportunity ? interaction.opportunityId : undefined,
                              channel: interaction.channel,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-900 text-[11px] font-bold"
                        >
                          <Sparkles className="w-3 h-3 text-teal-700" />
                          <span>مراسلة ذكية</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Subject & Summary */}
                  <div className="space-y-1">
                    {interaction.subject && (
                      <h3 className="font-bold text-stone-900 text-xs sm:text-sm">
                        {interaction.subject}
                      </h3>
                    )}
                    <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                      {interaction.summary}
                    </p>
                  </div>

                  {/* Discussion Topics Pills */}
                  {interaction.topics && interaction.topics.length > 0 && (
                    <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
                      <span className="text-[11px] text-stone-500 font-medium">
                        الموضوعات المناقشة:
                      </span>
                      {interaction.topics.map((tp) => (
                        <button
                          key={tp}
                          type="button"
                          onClick={() => updateFilter('searchQuery', tp)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-900 border border-stone-200/80 text-[11px] font-medium transition-colors"
                        >
                          <Tag className="w-2.5 h-2.5 text-stone-400" />
                          <span>{tp}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Next Step / Follow-Up Section */}
                  {(interaction.nextStep ||
                    interaction.nextFollowUpDate ||
                    interaction.outcome === 'follow_up_needed' ||
                    linkedTask) && (
                    <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="space-y-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                            <span>الخطوة التالية:</span>
                          </span>
                          <span className="text-xs font-semibold text-stone-900">
                            {interaction.nextStep || 'متابعة مع العميل'}
                          </span>
                          {interaction.nextFollowUpDate && (
                            <span className="px-2 py-0.5 rounded-md bg-white border border-amber-300 text-amber-900 text-[11px] font-bold">
                              موعد المتابعة: {interaction.nextFollowUpDate}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {linkedTask ? (
                          <button
                            type="button"
                            data-testid={`linked-task-badge-${interaction.id}`}
                            onClick={() => onNavigateToTasks?.()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100/80 hover:bg-emerald-100 border border-emerald-300 text-emerald-950 text-[11px] font-bold transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            <span>
                              مهمة مرتبطة ({linkedTask.status === 'completed' ? 'مكتملة' : 'مفتوحة'}
                              )
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid={`convert-interaction-to-task-btn-${interaction.id}`}
                            onClick={() => handleConvertNextStep(interaction)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-emerald-900 text-white text-[11px] font-bold transition-colors shadow-2xs"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            <span>تحويل إلى مهمة متابعة</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};
