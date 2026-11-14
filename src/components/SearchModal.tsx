import React, { useEffect, useMemo, useState } from 'react';
import type {
  ActionItem,
  Client,
  Meeting,
  Note,
  Opportunity,
  SearchCollectionsLoadedState,
  SearchDateRangePreset,
  SearchFilterState,
  SearchOpportunityOpenFilter,
  SearchRecordType,
  SearchResultItem,
  TaskPriority,
} from '../types';
import { formatArabicDate, getPriorityBadge } from '../utils/logic';
import {
  DEFAULT_SEARCH_FILTERS,
  SEARCH_RECORD_TYPE_LABELS,
  buildSearchIndex,
  countActiveSearchFilters,
  executeUniversalSearch,
  extractAvailableSearchTags,
  extractHighlightSegments,
} from '../utils/searchEngine';
import {
  Search,
  Users,
  UserCheck,
  Calendar,
  CheckSquare,
  StickyNote,
  Briefcase,
  X,
  ArrowLeft,
  SlidersHorizontal,
  RotateCcw,
  AlertCircle,
  Tag,
  Building2,
} from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
    opportunities?: Opportunity[];
  };
  currentUserId?: string;
  collectionsLoaded?: Partial<SearchCollectionsLoadedState>;
  onSelectClient: (client: Client) => void;
  onSelectMeeting: (meeting: Meeting) => void;
  onSelectTask: (task: ActionItem) => void;
  onSelectNote?: (note: Note) => void;
  onSelectOpportunity?: (opportunity: Opportunity) => void;
  language: 'ar' | 'en';
}

const SafeHighlightedText: React.FC<{
  text: string;
  query: string;
  className?: string;
}> = ({ text, query, className }) => {
  const segments = useMemo(() => extractHighlightSegments(text, query), [text, query]);
  return (
    <span className={className}>
      {segments.map((seg, idx) =>
        seg.matched ? (
          <mark
            key={idx}
            className="bg-amber-200/85 text-stone-950 font-semibold rounded-xs px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
    </span>
  );
};

const RECORD_TYPE_META: Record<
  SearchRecordType,
  {
    labelAr: string;
    labelEn: string;
    badgeClass: string;
    icon: React.FC<{ className?: string }>;
  }
> = {
  client: {
    labelAr: 'عميل',
    labelEn: 'Client',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: Users,
  },
  contact: {
    labelAr: 'جهة اتصال',
    labelEn: 'Contact',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
    icon: UserCheck,
  },
  opportunity: {
    labelAr: 'فرصة عمل',
    labelEn: 'Opportunity',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    icon: Briefcase,
  },
  meeting: {
    labelAr: 'اجتماع',
    labelEn: 'Meeting',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    icon: Calendar,
  },
  task: {
    labelAr: 'مهمة',
    labelEn: 'Task',
    badgeClass: 'bg-violet-50 text-violet-800 border-violet-200',
    icon: CheckSquare,
  },
  note: {
    labelAr: 'ملاحظة',
    labelEn: 'Note',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: StickyNote,
  },
};

const DATE_PRESET_LABELS_AR: Record<SearchDateRangePreset, string> = {
  all: 'كل الأوقات',
  today: 'اليوم',
  '7d': 'خلال 7 أيام',
  '30d': 'خلال 30 يوماً',
  '90d': 'خلال 90 يوماً',
  custom: 'فترة مخصصة',
};

const OPPORTUNITY_STATE_LABELS_AR: Record<SearchOpportunityOpenFilter, string> = {
  all: 'جميع الفرص',
  open: 'فرص مفتوحة فقط',
  closed: 'فرص مغلقة (مكسوبة / خاسرة)',
  won: 'فرص مكسوبة فقط',
  lost: 'فرص خاسرة فقط',
};

const STATUS_OPTIONS_AR: Array<{ value: string; labelAr: string }> = [
  { value: 'all', labelAr: 'كل الحالات' },
  // Tasks
  { value: 'pending', labelAr: 'مهمة: قيد الانتظار' },
  { value: 'in_progress', labelAr: 'مهمة: قيد التنفيذ' },
  { value: 'completed', labelAr: 'مكتمل (مهمة / اجتماع)' },
  { value: 'cancelled', labelAr: 'ملغى (مهمة / اجتماع)' },
  // Meetings
  { value: 'confirmed', labelAr: 'اجتماع: مؤكد' },
  { value: 'draft', labelAr: 'اجتماع: مسودة' },
  // Clients
  { value: 'active', labelAr: 'عميل: نشط' },
  { value: 'follow_up_needed', labelAr: 'عميل: يحتاج متابعة' },
  { value: 'lead', labelAr: 'عميل: محتمل' },
  { value: 'initial_contact', labelAr: 'عميل: تواصل أولي' },
  { value: 'inactive', labelAr: 'عميل: غير نشط' },
  // Opportunities
  { value: 'new', labelAr: 'فرصة: جديدة' },
  { value: 'qualification', labelAr: 'فرصة: تأهيل' },
  { value: 'proposal', labelAr: 'فرصة: تقديم عرض' },
  { value: 'negotiation', labelAr: 'فرصة: تفاوض' },
  { value: 'won', labelAr: 'فرصة: مكسوبة' },
  { value: 'lost', labelAr: 'فرصة: خاسرة' },
];

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  data,
  currentUserId,
  collectionsLoaded,
  onSelectClient,
  onSelectMeeting,
  onSelectTask,
  onSelectNote,
  onSelectOpportunity,
  language,
}) => {
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTERS);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // Debounce search text (~140ms) for smooth responsiveness without extra queries
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(rawQuery);
    }, 140);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Memoize the in-memory search index so we only rebuild when collections change
  const searchIndex = useMemo(
    () =>
      buildSearchIndex({
        clients: data.clients,
        meetings: data.meetings,
        tasks: data.tasks,
        notes: data.notes,
        opportunities: data.opportunities || [],
        currentUserId,
      }),
    [data.clients, data.meetings, data.tasks, data.notes, data.opportunities, currentUserId]
  );

  const availableTags = useMemo(
    () =>
      extractAvailableSearchTags({
        clients: data.clients,
        notes: data.notes,
        currentUserId,
      }),
    [data.clients, data.notes, currentUserId]
  );

  // Use rawQuery when emptied so clearing the input is instantaneous
  const effectiveQuery = rawQuery.trim() === '' ? '' : debouncedQuery || rawQuery;

  const searchResult = useMemo(
    () =>
      executeUniversalSearch({
        query: effectiveQuery,
        index: searchIndex,
        filters,
        collectionsLoaded,
        limit: 60,
      }),
    [effectiveQuery, searchIndex, filters, collectionsLoaded]
  );

  if (!isOpen) return null;

  const activeFilterCount = countActiveSearchFilters(filters);
  const hasQueryOrFilters = Boolean(effectiveQuery.trim()) || activeFilterCount > 0;

  const updateFilter = <K extends keyof SearchFilterState>(
    key: K,
    value: SearchFilterState[K]
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const clearAllFilters = () => {
    // Preserves rawQuery as required
    setFilters(DEFAULT_SEARCH_FILTERS);
  };

  const handleOpenResult = (item: SearchResultItem) => {
    if (item.recordType === 'client' && item.clientRef) {
      onSelectClient(item.clientRef);
      onClose();
      return;
    }
    if (item.recordType === 'contact' && item.clientRef) {
      onSelectClient(item.clientRef);
      onClose();
      return;
    }
    if (item.recordType === 'meeting' && item.meetingRef) {
      onSelectMeeting(item.meetingRef);
      onClose();
      return;
    }
    if (item.recordType === 'task' && item.taskRef) {
      onSelectTask(item.taskRef);
      onClose();
      return;
    }
    if (item.recordType === 'note' && item.noteRef) {
      if (onSelectNote) {
        onSelectNote(item.noteRef);
      } else if (item.clientRef) {
        onSelectClient(item.clientRef);
      }
      onClose();
      return;
    }
    if (item.recordType === 'opportunity' && item.opportunityRef && onSelectOpportunity) {
      onSelectOpportunity(item.opportunityRef);
      onClose();
    }
  };

  const selectedClientName =
    filters.clientId !== 'all'
      ? data.clients.find((c) => c.id === filters.clientId)?.name || filters.clientId
      : null;

  const selectedStatusLabel =
    filters.status !== 'all'
      ? STATUS_OPTIONS_AR.find((s) => s.value === filters.status)?.labelAr || filters.status
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 pt-8 sm:pt-12 bg-stone-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="البحث الشامل"
      data-testid="universal-search-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-stone-200 flex flex-col max-h-[86vh]">
        {/* Modal Header & Search Bar */}
        <div className="p-3.5 sm:p-4 border-b border-stone-200 bg-stone-50 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-900 text-white flex items-center justify-center shrink-0">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-heading font-bold text-sm text-stone-900">
                  {language === 'ar' ? 'البحث الشامل' : 'Universal Search'}
                </h2>
                <p className="text-[11px] text-stone-500">
                  {language === 'ar'
                    ? 'بحث ذكي موحد في العملاء، جهات الاتصال، الاجتماعات، المهام، الملاحظات، والفرص'
                    : 'Unified search across clients, contacts, meetings, tasks, notes & opportunities'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="toggle-search-filters-btn"
                onClick={() => setShowFiltersPanel((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  showFiltersPanel || activeFilterCount > 0
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>فلاتر ذكية</span>
                {activeFilterCount > 0 && (
                  <span
                    data-testid="active-filter-count-badge"
                    className="px-1.5 py-0.2 rounded-full bg-emerald-700 text-white text-[10px] font-bold"
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="close-search-modal-btn"
                onClick={onClose}
                className="px-2.5 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-200 rounded-xl flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                <span>إغلاق</span>
              </button>
            </div>
          </div>

          {/* Search Input Box */}
          <div className="relative flex items-center bg-white border border-stone-300 focus-within:border-emerald-700 rounded-xl px-3 py-2 shadow-2xs">
            <Search className="w-4 h-4 text-stone-400 shrink-0 me-2" />
            <input
              type="text"
              autoFocus
              data-testid="universal-search-input"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'ابحث بالاسم، الشركة، قرار اجتماع، بند جدول أعمال، وسم، أو إجراء قادم...'
                  : 'Search by name, company, meeting decision, agenda item, tag, or next action...'
              }
              className="flex-1 bg-transparent text-sm text-stone-900 placeholder-stone-400 focus:outline-hidden"
            />
            {rawQuery && (
              <button
                type="button"
                data-testid="clear-search-query-btn"
                onClick={() => {
                  setRawQuery('');
                  setDebouncedQuery('');
                }}
                aria-label="مسح نص البحث"
                className="p-1 text-stone-400 hover:text-stone-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Record-Type Filter Bar */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
            role="tablist"
            aria-label="تصفية حسب نوع السجل"
          >
            <button
              type="button"
              data-testid="filter-type-all"
              onClick={() => updateFilter('recordType', 'all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-colors border ${
                filters.recordType === 'all'
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
              }`}
            >
              الكل
            </button>
            {(
              [
                'client',
                'contact',
                'opportunity',
                'meeting',
                'task',
                'note',
              ] as SearchRecordType[]
            ).map((rt) => {
              const meta = RECORD_TYPE_META[rt];
              const Icon = meta.icon;
              const isSelected = filters.recordType === rt;
              return (
                <button
                  key={rt}
                  type="button"
                  data-testid={`filter-type-${rt}`}
                  onClick={() =>
                    updateFilter('recordType', isSelected ? 'all' : rt)
                  }
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-colors border ${
                    isSelected
                      ? 'bg-emerald-800 text-white border-emerald-800'
                      : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{SEARCH_RECORD_TYPE_LABELS[rt].ar}</span>
                </button>
              );
            })}
          </div>

          {/* Expandable Smart Filters Panel */}
          {showFiltersPanel && (
            <div
              data-testid="smart-filters-panel"
              className="p-3 bg-white border border-stone-200 rounded-xl space-y-3 text-xs animate-in fade-in"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Client Filter */}
                <div>
                  <label
                    htmlFor="search-filter-client"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    العميل المرتبط
                  </label>
                  <select
                    id="search-filter-client"
                    data-testid="search-filter-client"
                    value={filters.clientId}
                    onChange={(e) => updateFilter('clientId', e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    <option value="all">جميع العملاء</option>
                    {data.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Preset Filter */}
                <div>
                  <label
                    htmlFor="search-filter-date"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    الفترة الزمنية
                  </label>
                  <select
                    id="search-filter-date"
                    data-testid="search-filter-date"
                    value={filters.datePreset}
                    onChange={(e) =>
                      updateFilter('datePreset', e.target.value as SearchDateRangePreset)
                    }
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    {(Object.keys(DATE_PRESET_LABELS_AR) as SearchDateRangePreset[]).map(
                      (preset) => (
                        <option key={preset} value={preset}>
                          {DATE_PRESET_LABELS_AR[preset]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Status Filter */}
                <div>
                  <label
                    htmlFor="search-filter-status"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    الحالة
                  </label>
                  <select
                    id="search-filter-status"
                    data-testid="search-filter-status"
                    value={filters.status}
                    onChange={(e) => updateFilter('status', e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    {STATUS_OPTIONS_AR.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.labelAr}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority Filter */}
                <div>
                  <label
                    htmlFor="search-filter-priority"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    الأولوية / الأهمية
                  </label>
                  <select
                    id="search-filter-priority"
                    data-testid="search-filter-priority"
                    value={filters.priority}
                    onChange={(e) =>
                      updateFilter('priority', e.target.value as 'all' | TaskPriority)
                    }
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    <option value="all">جميع الأولويات</option>
                    <option value="urgent">عاجل</option>
                    <option value="high">مرتفع</option>
                    <option value="medium">متوسط</option>
                    <option value="low">منخفض</option>
                  </select>
                </div>

                {/* Tag Filter */}
                <div>
                  <label
                    htmlFor="search-filter-tag"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    الوسوم (Tags)
                  </label>
                  <select
                    id="search-filter-tag"
                    data-testid="search-filter-tag"
                    value={filters.tag}
                    onChange={(e) => updateFilter('tag', e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    <option value="all">جميع الوسوم</option>
                    {availableTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Opportunity Open/Closed Filter */}
                <div>
                  <label
                    htmlFor="search-filter-opp-state"
                    className="block text-[11px] font-bold text-stone-700 mb-1"
                  >
                    حالة الفرص التجارية
                  </label>
                  <select
                    id="search-filter-opp-state"
                    data-testid="search-filter-opp-state"
                    value={filters.opportunityState}
                    onChange={(e) =>
                      updateFilter(
                        'opportunityState',
                        e.target.value as SearchOpportunityOpenFilter
                      )
                    }
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                  >
                    {(
                      Object.keys(
                        OPPORTUNITY_STATE_LABELS_AR
                      ) as SearchOpportunityOpenFilter[]
                    ).map((st) => (
                      <option key={st} value={st}>
                        {OPPORTUNITY_STATE_LABELS_AR[st]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Custom Date Range Inputs */}
              {filters.datePreset === 'custom' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-stone-100">
                  <div>
                    <label
                      htmlFor="search-filter-date-from"
                      className="block text-[11px] font-semibold text-stone-600 mb-1"
                    >
                      من تاريخ
                    </label>
                    <input
                      id="search-filter-date-from"
                      type="date"
                      value={filters.dateFrom || ''}
                      onChange={(e) => updateFilter('dateFrom', e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="search-filter-date-to"
                      className="block text-[11px] font-semibold text-stone-600 mb-1"
                    >
                      إلى تاريخ
                    </label>
                    <input
                      id="search-filter-date-to"
                      type="date"
                      value={filters.dateTo || ''}
                      onChange={(e) => updateFilter('dateTo', e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active Filter Chips with Single-Remove & Clear-All */}
          {activeFilterCount > 0 && (
            <div
              data-testid="active-filter-chips"
              className="flex items-center flex-wrap gap-1.5 pt-0.5"
            >
              <span className="text-[11px] font-semibold text-stone-500">
                الفلاتر المفعّلة:
              </span>

              {filters.recordType !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>النوع: {SEARCH_RECORD_TYPE_LABELS[filters.recordType].ar}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-recordType"
                    onClick={() => updateFilter('recordType', 'all')}
                    aria-label="إزالة فلتر النوع"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {selectedClientName && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>العميل: {selectedClientName}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-clientId"
                    onClick={() => updateFilter('clientId', 'all')}
                    aria-label="إزالة فلتر العميل"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {filters.datePreset !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>الفترة: {DATE_PRESET_LABELS_AR[filters.datePreset]}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-datePreset"
                    onClick={() => {
                      updateFilter('datePreset', 'all');
                      updateFilter('dateFrom', '');
                      updateFilter('dateTo', '');
                    }}
                    aria-label="إزالة فلتر الفترة"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {selectedStatusLabel && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>{selectedStatusLabel}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-status"
                    onClick={() => updateFilter('status', 'all')}
                    aria-label="إزالة فلتر الحالة"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {filters.priority !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>الأولوية: {getPriorityBadge(filters.priority).label}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-priority"
                    onClick={() => updateFilter('priority', 'all')}
                    aria-label="إزالة فلتر الأولوية"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {filters.tag !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>الوسم: {filters.tag}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-tag"
                    onClick={() => updateFilter('tag', 'all')}
                    aria-label="إزالة فلتر الوسم"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {filters.opportunityState !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium">
                  <span>{OPPORTUNITY_STATE_LABELS_AR[filters.opportunityState]}</span>
                  <button
                    type="button"
                    data-testid="remove-filter-opportunityState"
                    onClick={() => updateFilter('opportunityState', 'all')}
                    aria-label="إزالة فلتر حالة الفرصة"
                    className="hover:text-rose-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <button
                type="button"
                data-testid="clear-all-search-filters-btn"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-200/80 hover:bg-stone-300 text-stone-800 text-[11px] font-semibold ms-auto"
              >
                <RotateCcw className="w-3 h-3" />
                <span>مسح كل الفلاتر</span>
              </button>
            </div>
          )}
        </div>

        {/* Incomplete Local Data Disclosure Banner */}
        {searchResult.isDataIncomplete && (
          <div
            data-testid="search-incomplete-data-banner"
            className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px] flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              يجري استكمال تحميل بعض المجموعات (
              {searchResult.incompleteCollectionsAr.join('، ')})؛ النتائج المعروضة تعكس السجلات
              المتاحة محلياً حتى الآن.
            </span>
          </div>
        )}

        {/* Results Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
          {!hasQueryOrFilters ? (
            <div className="text-center py-10 text-stone-500 space-y-2">
              <Search className="w-8 h-8 text-stone-300 mx-auto" />
              <p className="font-semibold text-stone-700">
                اكتب أي كلمة أو اختر فلتراً ذكياً للبحث الموحد في سجلاتك
              </p>
              <p className="text-[11px] text-stone-400 max-w-md mx-auto leading-relaxed">
                يدعم البحث التطبيع العربي التلقائي (أ/إ/آ/ا، ة/ه، ى/ي، والتشكيل، والأرقام
                العربية ٠-٩) عبر العملاء، جهات الاتصال، الاجتماعات، المهام، الملاحظات، وفرص
                الأعمال.
              </p>
            </div>
          ) : searchResult.returnedCount === 0 ? (
            <div
              data-testid="search-empty-results"
              className="text-center py-10 text-stone-500 space-y-2"
            >
              <p className="font-bold text-stone-700">
                لا توجد سجلات مطابقة لمعايير البحث الحالية
              </p>
              <p className="text-[11px] text-stone-400">
                {effectiveQuery
                  ? `لم يتم العثور على نتائج تطابق «${effectiveQuery}»`
                  : 'لا توجد سجلات تطابق الفلاتر المحددة'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة ضبط الفلاتر</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Results Summary Header */}
              <div className="flex items-center justify-between text-[11px] text-stone-500 pb-1 border-b border-stone-100">
                <span>
                  إجمالي النتائج المطابقة:{' '}
                  <strong className="text-stone-900">{searchResult.totalMatched}</strong>
                  {searchResult.truncated &&
                    ` (يتم عرض أعلى ${searchResult.returnedCount} نتيجة حسب الأولوية)`}
                </span>
                <span>مرتبة حسب دقة التطابق والحداثة</span>
              </div>

              {/* Ranked Results List */}
              <div className="space-y-2" data-testid="search-results-list">
                {searchResult.items.map((item) => {
                  const meta = RECORD_TYPE_META[item.recordType];
                  const Icon = meta.icon;
                  const priorityBadge = item.priority
                    ? getPriorityBadge(item.priority)
                    : null;

                  return (
                    <div
                      key={item.id}
                      data-testid={`search-result-${item.recordType}`}
                      onClick={() => handleOpenResult(item)}
                      className="p-3 rounded-xl border border-stone-200 hover:border-emerald-300 hover:bg-stone-50/80 transition-all cursor-pointer flex items-start justify-between gap-3 group"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        {/* Top Metadata Row: Record Type Badge + Matched Field + Client + Status/Priority */}
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${meta.badgeClass}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{item.recordTypeLabelAr}</span>
                          </span>

                          {effectiveQuery.trim() && (
                            <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              تطابق في: {item.matchedFieldLabelAr}
                            </span>
                          )}

                          {item.clientName && item.recordType !== 'client' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-stone-600 bg-stone-100 px-2 py-0.5 rounded">
                              <Building2 className="w-3 h-3 text-stone-400" />
                              <span>{item.clientName}</span>
                            </span>
                          )}

                          {item.statusLabelAr && (
                            <span className="text-[10px] font-medium text-stone-600 bg-stone-100/80 border border-stone-200/80 px-1.5 py-0.5 rounded">
                              {item.statusLabelAr}
                            </span>
                          )}

                          {priorityBadge && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${priorityBadge.color}`}
                            >
                              {priorityBadge.label}
                            </span>
                          )}

                          {item.dateIso && (
                            <span className="text-[10px] text-stone-400 ms-auto">
                              {formatArabicDate(item.dateIso)}
                            </span>
                          )}
                        </div>

                        {/* Title with safe highlighting */}
                        <div className="font-bold text-stone-900 text-sm leading-snug">
                          <SafeHighlightedText text={item.title} query={effectiveQuery} />
                        </div>

                        {/* Snippet / Matched Context with safe highlighting */}
                        {item.snippet && item.snippet !== item.title && (
                          <p className="text-[11px] text-stone-600 line-clamp-2 leading-relaxed">
                            <SafeHighlightedText text={item.snippet} query={effectiveQuery} />
                          </p>
                        )}

                        {/* Tags if present */}
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex items-center flex-wrap gap-1 pt-0.5">
                            {item.tags.slice(0, 5).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 text-[10px]"
                              >
                                <Tag className="w-2.5 h-2.5 text-stone-400" />
                                <SafeHighlightedText text={tag} query={effectiveQuery} />
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Direct Open Record Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenResult(item);
                        }}
                        className="shrink-0 self-center inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-100 group-hover:bg-emerald-800 group-hover:text-white text-stone-700 font-semibold text-[11px] transition-colors"
                      >
                        <span>فتح</span>
                        <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-0 ltr:rotate-180" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
