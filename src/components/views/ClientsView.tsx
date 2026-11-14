import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  ClientCategory,
  ClientImportanceLevel,
  ClientRelationshipStatus,
  Meeting,
  Note,
  Opportunity,
} from '../../types';
import { getRelativeTimeArabic } from '../../utils/logic';
import {
  CLIENT_CATEGORY_LABELS,
  CLIENT_IMPORTANCE_CONFIG,
  CLIENT_RELATIONSHIP_STATUS_CONFIG,
  ClientListSortBy,
  deriveClientSyncDisplayState,
  filterAndSortClients,
  findPotentialDuplicateClients,
  getClientCategoryLabel,
  sanitizeClientForSave,
} from '../../utils/client360';
import { Client360Workspace } from '../Client360Workspace';
import { formatCalendarDateKey, resolveCalendarParts } from '../../utils/followUpEngine';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckSquare,
  ChevronLeft,
  Clock,
  Plus,
  Search,
  Star,
  Tag,
  WifiOff,
  X,
} from 'lucide-react';

export interface ClientsFilterTrigger {
  quickFilter?: 'all' | 'favorites' | 'needs_follow_up' | 'overdue_tasks';
  createdFrom?: string;
  createdTo?: string;
  nonce: number;
}

interface ClientsViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities?: Opportunity[];
  onSelectMeeting: (meeting: Meeting) => void;
  onOpenMeetingAttachments: (meeting: Meeting) => void;
  onNewMeeting: (clientId: string) => void;
  onNewTask: (clientId: string) => void;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (task: ActionItem) => void;
  onNewNote: (clientId: string) => void;
  onOpenNote: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
  onNewOpportunity?: (clientId: string) => void;
  onSelectOpportunity?: (opportunity: Opportunity) => void;
  onSaveClient: (client: Client) => Promise<void> | void;
  onDeleteClient: (clientId: string) => Promise<void> | void;
  selectedClientId?: string | null;
  onSelectedClientChange?: (clientId: string | null) => void;
  createClientTrigger?: number;
  filterTrigger?: ClientsFilterTrigger | null;
  collectionsLoaded?: {
    clients: boolean;
    meetings: boolean;
    tasks: boolean;
    notes: boolean;
  };
  hasSyncError?: boolean;
  hasPendingWrites?: boolean;
  pendingClientIds?: string[];
  failedClientIds?: string[];
  isOnline?: boolean;
  language: 'ar' | 'en';
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  meetings,
  tasks,
  notes,
  opportunities = [],
  onSelectMeeting,
  onOpenMeetingAttachments,
  onNewMeeting,
  onNewTask,
  onToggleTask,
  onOpenTask,
  onNewNote,
  onOpenNote,
  onDeleteNote,
  onNewOpportunity,
  onSelectOpportunity,
  onSaveClient,
  onDeleteClient,
  selectedClientId,
  onSelectedClientChange,
  createClientTrigger = 0,
  filterTrigger,
  collectionsLoaded = { clients: true, meetings: true, tasks: true, notes: true },
  hasSyncError = false,
  hasPendingWrites = false,
  pendingClientIds = [],
  failedClientIds = [],
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true,
  language,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<
    'all' | 'favorites' | 'needs_follow_up' | 'overdue_tasks'
  >('all');
  const [createdRangeFilter, setCreatedRangeFilter] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClientRelationshipStatus | 'all'>('all');
  const [importanceFilter, setImportanceFilter] = useState<ClientImportanceLevel | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<ClientListSortBy>('last_activity');

  const [activeClientId, setActiveClientId] = useState<string | null>(selectedClientId || null);

  // Add / Edit Client Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<
    (Partial<Client> & { tagsText?: string }) | null
  >(null);

  useEffect(() => {
    setActiveClientId(selectedClientId || null);
  }, [selectedClientId]);

  useEffect(() => {
    if (createClientTrigger > 0) {
      handleOpenEdit();
    }
  }, [createClientTrigger]);

  useEffect(() => {
    if (filterTrigger && filterTrigger.nonce > 0) {
      setSearchQuery('');
      setQuickFilter(filterTrigger.quickFilter || 'all');
      setStatusFilter('all');
      setImportanceFilter('all');
      setCategoryFilter('all');
      if (filterTrigger.createdFrom && filterTrigger.createdTo) {
        setCreatedRangeFilter({
          from: filterTrigger.createdFrom,
          to: filterTrigger.createdTo,
        });
      } else {
        setCreatedRangeFilter(null);
      }
    }
  }, [filterTrigger?.nonce]);

  const selectClient = (clientId: string | null) => {
    setActiveClientId(clientId);
    if (onSelectedClientChange) {
      onSelectedClientChange(clientId);
    }
  };

  const activeClient = useMemo(
    () => (activeClientId ? clients.find((c) => c.id === activeClientId) || null : null),
    [clients, activeClientId]
  );

  // Compute indexed & filtered list once
  const clientSummaries = useMemo(() => {
    const base = filterAndSortClients(clients, meetings, tasks, notes, {
      searchQuery,
      onlyFavorites: quickFilter === 'favorites',
      onlyNeedsFollowUp: quickFilter === 'needs_follow_up',
      onlyWithOverdueTasks: quickFilter === 'overdue_tasks',
      relationshipStatus: statusFilter,
      importance: importanceFilter,
      category: categoryFilter,
      sortBy,
    });
    if (!createdRangeFilter) return base;
    return base.filter(({ client }) => {
      const parts = resolveCalendarParts(client.createdAt);
      if (!parts) return false;
      const key = formatCalendarDateKey(parts);
      return key >= createdRangeFilter.from && key <= createdRangeFilter.to;
    });
  }, [
    clients,
    meetings,
    tasks,
    notes,
    searchQuery,
    quickFilter,
    createdRangeFilter,
    statusFilter,
    importanceFilter,
    categoryFilter,
    sortBy,
  ]);

  // Quick badge counts computed from unfiltered list
  const quickCounts = useMemo(() => {
    const all = filterAndSortClients(clients, meetings, tasks, notes);
    return {
      total: all.length,
      favorites: all.filter((x) => x.client.isFavorite).length,
      needsFollowUp: all.filter((x) => x.needsFollowUp).length,
      overdueTasks: all.filter((x) => x.kpis.overdueTasks > 0).length,
    };
  }, [clients, meetings, tasks, notes]);

  // Duplicate client detection in create/edit modal (non-blocking)
  const duplicateMatches = useMemo(() => {
    if (!isEditModalOpen || !editingClient) return [];
    return findPotentialDuplicateClients(editingClient, clients);
  }, [isEditModalOpen, editingClient, clients]);

  const handleOpenEdit = (client?: Client) => {
    if (client) {
      setEditingClient({
        ...client,
        tagsText: (client.tags || []).join('، '),
      });
    } else {
      setEditingClient({
        name: '',
        company: '',
        phone: '',
        email: '',
        industry: '',
        category: '',
        relationshipStatus: 'active',
        importance: 'medium',
        tagsText: '',
        website: '',
        address: '',
        source: '',
        description: '',
        notes: '',
        color: '#059669',
        isFavorite: false,
      });
    }
    setIsEditModalOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient?.name?.trim()) return;

    const parsedTags = (editingClient.tagsText ?? (editingClient.tags || []).join(','))
      .split(/[,،]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const nowIso = new Date().toISOString();
    const raw: Client = {
      id: editingClient.id || `c-${Date.now()}`,
      name: editingClient.name.trim(),
      company: editingClient.company || undefined,
      phone: editingClient.phone || undefined,
      email: editingClient.email || undefined,
      notes: editingClient.notes || undefined,
      color: editingClient.color || '#059669',
      avatarPath: editingClient.avatarPath || undefined,
      isFavorite: Boolean(editingClient.isFavorite),
      industry: editingClient.industry || undefined,
      category: editingClient.category || undefined,
      relationshipStatus: editingClient.relationshipStatus || undefined,
      importance: editingClient.importance || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      website: editingClient.website || undefined,
      address: editingClient.address || undefined,
      source: editingClient.source || undefined,
      description: editingClient.description || undefined,
      contacts: editingClient.contacts,
      createdAt: editingClient.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const saved = sanitizeClientForSave(raw);

    try {
      await onSaveClient(saved);
      setIsEditModalOpen(false);
      setEditingClient(null);
      if (!editingClient.id) {
        selectClient(saved.id);
      }
    } catch (err) {
      console.warn('ClientsView: Save client failed, keeping modal open for retry:', err);
    }
  };

  const allCollectionsLoaded =
    collectionsLoaded.clients &&
    collectionsLoaded.meetings &&
    collectionsLoaded.tasks &&
    collectionsLoaded.notes;

  const activeClientSyncDisplay = activeClient
    ? deriveClientSyncDisplayState({
        clientsLoaded: collectionsLoaded.clients,
        meetingsLoaded: collectionsLoaded.meetings,
        tasksLoaded: collectionsLoaded.tasks,
        notesLoaded: collectionsLoaded.notes,
        hasAnyError: hasSyncError,
        hasPendingWrites,
        isClientDocPending: pendingClientIds.includes(activeClient.id),
        hasRejectedClientWrite: failedClientIds.includes(activeClient.id),
        isOnline,
      })
    : null;

  return (
    <div className="space-y-4 pb-6">
      {activeClient && activeClientSyncDisplay ? (
        <Client360Workspace
          client={activeClient}
          meetings={meetings}
          tasks={tasks}
          notes={notes}
          opportunities={opportunities}
          syncDisplay={activeClientSyncDisplay}
          collectionsLoaded={allCollectionsLoaded}
          onBack={() => selectClient(null)}
          onEditClient={(c) => handleOpenEdit(c)}
          onSaveClient={onSaveClient}
          onDeleteClient={onDeleteClient}
          onNewMeeting={onNewMeeting}
          onSelectMeeting={onSelectMeeting}
          onOpenMeetingAttachments={onOpenMeetingAttachments}
          onNewTask={onNewTask}
          onToggleTask={onToggleTask}
          onOpenTask={onOpenTask}
          onNewNote={onNewNote}
          onOpenNote={onOpenNote}
          onDeleteNote={onDeleteNote}
          onNewOpportunity={onNewOpportunity}
          onSelectOpportunity={onSelectOpportunity}
          language={language}
        />
      ) : (
        <>
          {/* Top Header & New Client */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-heading font-extrabold text-xl text-stone-900">
                {language === 'ar' ? 'العملاء والعلاقات' : 'Clients & Relationships'}
              </h2>
              <p className="text-[11px] text-stone-500">
                اختر أي عميل لفتح ملف العميل المتكامل وسجل العلاقة والالتزامات
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenEdit()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>عميل جديد</span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute top-1/2 -translate-y-1/2 ltr:left-3 rtl:right-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'ابحث بالاسم، الشركة، الهاتف، البريد، القطاع، أو الوسم...'
                  : 'Search by name, company, phone, email, industry, or tag...'
              }
              className="w-full bg-white rounded-xl border border-stone-200 py-2.5 ltr:pl-9 ltr:pr-8 rtl:pr-9 rtl:pl-8 text-xs text-stone-800 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="مسح البحث"
                className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-stone-400 hover:text-stone-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap pb-1 text-xs">
            <button
              type="button"
              onClick={() => setQuickFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                quickFilter === 'all'
                  ? 'bg-stone-900 text-white'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              الكل ({quickCounts.total})
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('favorites')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 flex items-center gap-1 ${
                quickFilter === 'favorites'
                  ? 'bg-stone-900 text-white'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>المفضلة ({quickCounts.favorites})</span>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('needs_follow_up')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                quickFilter === 'needs_follow_up'
                  ? 'bg-amber-800 text-white'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              يحتاج متابعة ({quickCounts.needsFollowUp})
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('overdue_tasks')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                quickFilter === 'overdue_tasks'
                  ? 'bg-rose-800 text-white'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              عليه مهام متأخرة ({quickCounts.overdueTasks})
            </button>
          </div>

          {/* Structured Filter & Sort Controls */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <select
              aria-label="تصفية حسب حالة العلاقة"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ClientRelationshipStatus | 'all')
              }
              className="bg-white border border-stone-200 rounded-xl px-2.5 py-2 text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            >
              <option value="all">كل حالات العلاقة</option>
              {(
                Object.keys(CLIENT_RELATIONSHIP_STATUS_CONFIG) as ClientRelationshipStatus[]
              ).map((key) => (
                <option key={key} value={key}>
                  {CLIENT_RELATIONSHIP_STATUS_CONFIG[key].labelAr}
                </option>
              ))}
            </select>

            <select
              aria-label="تصفية حسب الأهمية"
              value={importanceFilter}
              onChange={(e) =>
                setImportanceFilter(e.target.value as ClientImportanceLevel | 'all')
              }
              className="bg-white border border-stone-200 rounded-xl px-2.5 py-2 text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            >
              <option value="all">كل درجات الأهمية</option>
              {(Object.keys(CLIENT_IMPORTANCE_CONFIG) as ClientImportanceLevel[]).map((key) => (
                <option key={key} value={key}>
                  {CLIENT_IMPORTANCE_CONFIG[key].labelAr}
                </option>
              ))}
            </select>

            <select
              aria-label="تصفية حسب التصنيف"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-white border border-stone-200 rounded-xl px-2.5 py-2 text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            >
              <option value="all">كل التصنيفات</option>
              {(Object.keys(CLIENT_CATEGORY_LABELS) as ClientCategory[]).map((key) => (
                <option key={key} value={key}>
                  {CLIENT_CATEGORY_LABELS[key].ar}
                </option>
              ))}
            </select>

            <select
              aria-label="ترتيب العملاء"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ClientListSortBy)}
              className="bg-white border border-stone-200 rounded-xl px-2.5 py-2 text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            >
              <option value="last_activity">الترتيب: أحدث نشاط</option>
              <option value="importance">الترتيب: الأهمية</option>
              <option value="name">الترتيب: الاسم (أ-ي)</option>
              <option value="created_at">الترتيب: الأحدث إضافة</option>
            </select>
          </div>

          {createdRangeFilter && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              <span className="tabular-nums">
                عرض العملاء المضافين خلال الفترة: {createdRangeFilter.from} إلى {createdRangeFilter.to}
              </span>
              <button
                type="button"
                onClick={() => setCreatedRangeFilter(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 text-[11px] font-medium"
              >
                <X className="w-3 h-3" />
                <span>إلغاء</span>
              </button>
            </div>
          )}

          {/* Clients Cards List */}
          <div className="space-y-2.5">
            {!collectionsLoaded.clients ? (
              <div className="text-center py-10 bg-white rounded-2xl border border-stone-200 text-stone-500 text-xs">
                جاري تحميل قائمة العملاء...
              </div>
            ) : clientSummaries.length === 0 ? (
              <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-stone-200 text-stone-500 text-xs space-y-2">
                <p>
                  {clients.length === 0
                    ? 'لم تتم إضافة عملاء بعد. ابدأ بإضافة أول عميل لبناء سجل العلاقة.'
                    : 'لا توجد نتائج تطابق البحث أو عوامل التصفية المختارة.'}
                </p>
                {clients.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setQuickFilter('all');
                      setCreatedRangeFilter(null);
                      setStatusFilter('all');
                      setImportanceFilter('all');
                      setCategoryFilter('all');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold"
                  >
                    إعادة ضبط التصفية
                  </button>
                )}
              </div>
            ) : (
              clientSummaries.map(({ client, kpis, needsReviewGap }) => {
                const statusCfg = client.relationshipStatus
                  ? CLIENT_RELATIONSHIP_STATUS_CONFIG[client.relationshipStatus]
                  : null;
                const importanceCfg = client.importance
                  ? CLIENT_IMPORTANCE_CONFIG[client.importance]
                  : null;
                const isPendingDoc = pendingClientIds.includes(client.id);
                const isFailedDoc = failedClientIds.includes(client.id);

                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => selectClient(client.id)}
                    className="w-full text-start bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs hover:border-emerald-400 hover:shadow-sm transition-all flex items-start justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {client.avatarPath ? (
                        <img
                          src={client.avatarPath}
                          alt={client.name}
                          className="w-11 h-11 rounded-xl object-cover border border-stone-200 shrink-0"
                        />
                      ) : (
                        <div
                          className="w-11 h-11 rounded-xl text-white flex items-center justify-center font-bold text-sm shrink-0"
                          style={{ backgroundColor: client.color || '#059669' }}
                        >
                          {client.name.charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 group-hover:text-emerald-800 truncate">
                            {client.name}
                          </h4>
                          {client.isFavorite && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                          )}
                          {statusCfg && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusCfg.badgeClass}`}
                            >
                              {statusCfg.labelAr}
                            </span>
                          )}
                          {importanceCfg && client.importance === 'high' && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${importanceCfg.badgeClass}`}
                            >
                              {importanceCfg.labelAr}
                            </span>
                          )}
                          {isFailedDoc && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              <span>فشل الحفظ</span>
                            </span>
                          )}
                          {!isFailedDoc && (isPendingDoc || !isOnline) && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              <WifiOff className="w-2.5 h-2.5" />
                              <span>بانتظار المزامنة</span>
                            </span>
                          )}
                        </div>

                        {(client.company || client.industry) && (
                          <p className="text-[11px] text-stone-600 truncate mt-0.5 flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-stone-400 shrink-0" />
                            <span>
                              {[client.company, client.industry].filter(Boolean).join(' • ')}
                            </span>
                          </p>
                        )}

                        <div className="flex items-center gap-2.5 mt-2 text-[11px] text-stone-500 flex-wrap">
                          {kpis.lastContactAt ? (
                            <span className="text-stone-600">
                              آخر تواصل: {getRelativeTimeArabic(kpis.lastContactAt)}
                            </span>
                          ) : (
                            <span className={needsReviewGap ? 'text-amber-800 font-medium' : 'text-stone-400'}>
                              لا يوجد تواصل مسجل
                            </span>
                          )}

                          {kpis.overdueTasks > 0 && (
                            <span className="inline-flex items-center gap-1 text-rose-800 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-semibold">
                              <AlertCircle className="w-3 h-3" />
                              <span className="tabular-nums">{kpis.overdueTasks} متأخرة</span>
                            </span>
                          )}

                          {kpis.openTasks > 0 && (
                            <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                              <CheckSquare className="w-3 h-3" />
                              <span className="tabular-nums">{kpis.openTasks} مهام مفتوحة</span>
                            </span>
                          )}

                          {needsReviewGap && (
                            <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
                              <Clock className="w-3 h-3" />
                              <span>تواصل غائب</span>
                            </span>
                          )}
                        </div>

                        {client.tags && client.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            <Tag className="w-2.5 h-2.5 text-stone-400" />
                            {client.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.2 rounded bg-stone-100 text-stone-600"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-stone-400 group-hover:text-emerald-700 shrink-0 self-center">
                      <ChevronLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Add / Edit Client Modal */}
      {isEditModalOpen && editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full my-auto overflow-hidden border border-stone-200 p-5 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4 shrink-0">
              <h3 className="font-heading font-bold text-base text-stone-900">
                {editingClient.id ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="إغلاق نافذة العميل"
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-3.5 text-xs overflow-y-auto pr-0.5">
              {/* Non-Blocking Duplicate Client Warning */}
              {duplicateMatches.length > 0 && (
                <div
                  data-testid="duplicate-client-warning"
                  className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2"
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>تنبيه: يوجد عميل مشابه في قائمتك</span>
                  </div>
                  <div className="space-y-1.5">
                    {duplicateMatches.slice(0, 3).map((m) => (
                      <div
                        key={m.client.id}
                        className="bg-white/90 rounded-lg p-2 border border-amber-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-bold block truncate">{m.client.name}</span>
                          <span className="text-[11px] text-amber-800">{m.reasonLabelArabic}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditModalOpen(false);
                            setEditingClient(null);
                            selectClient(m.client.id);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-800 text-white text-[11px] font-semibold shrink-0"
                        >
                          فتح الملف
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-amber-900">
                    يمكنك المتابعة بالحفظ إذا كان عميلاً مختلفاً، ولن يتم دمج البيانات تلقائياً.
                  </p>
                </div>
              )}

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  الاسم الكامل <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingClient.name || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })}
                  placeholder="مثال: م. أحمد الجاسم"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">الشركة أو الجهة</label>
                  <input
                    type="text"
                    value={editingClient.company || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, company: e.target.value })
                    }
                    placeholder="مثال: شركة أفق للتقنية"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">القطاع / المجال</label>
                  <input
                    type="text"
                    value={editingClient.industry || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, industry: e.target.value })
                    }
                    placeholder="مثال: التقنية والاستشارات"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={editingClient.phone || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, phone: e.target.value })
                    }
                    placeholder="+966 5..."
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={editingClient.email || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, email: e.target.value })
                    }
                    placeholder="name@company.com"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">حالة العلاقة</label>
                  <select
                    value={editingClient.relationshipStatus || 'active'}
                    onChange={(e) =>
                      setEditingClient({
                        ...editingClient,
                        relationshipStatus: e.target.value as ClientRelationshipStatus,
                      })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800"
                  >
                    {(
                      Object.keys(
                        CLIENT_RELATIONSHIP_STATUS_CONFIG
                      ) as ClientRelationshipStatus[]
                    ).map((key) => (
                      <option key={key} value={key}>
                        {CLIENT_RELATIONSHIP_STATUS_CONFIG[key].labelAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">الأهمية</label>
                  <select
                    value={editingClient.importance || 'medium'}
                    onChange={(e) =>
                      setEditingClient({
                        ...editingClient,
                        importance: e.target.value as ClientImportanceLevel,
                      })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800"
                  >
                    {(Object.keys(CLIENT_IMPORTANCE_CONFIG) as ClientImportanceLevel[]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {CLIENT_IMPORTANCE_CONFIG[key].labelAr}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">التصنيف</label>
                  <select
                    value={editingClient.category || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, category: e.target.value })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800"
                  >
                    <option value="">غير محدد</option>
                    {(Object.keys(CLIENT_CATEGORY_LABELS) as ClientCategory[]).map((key) => (
                      <option key={key} value={key}>
                        {getClientCategoryLabel(key, language)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">الموقع الإلكتروني</label>
                  <input
                    type="text"
                    value={editingClient.website || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, website: e.target.value })
                    }
                    placeholder="https://company.com"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">مصدر العميل</label>
                  <input
                    type="text"
                    value={editingClient.source || ''}
                    onChange={(e) =>
                      setEditingClient({ ...editingClient, source: e.target.value })
                    }
                    placeholder="مثال: توصية، معرض، مباشر"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">العنوان / المدينة</label>
                <input
                  type="text"
                  value={editingClient.address || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, address: e.target.value })}
                  placeholder="الرياض - حي العليا"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  الوسوم (مفصولة بفاصلة)
                </label>
                <input
                  type="text"
                  value={editingClient.tagsText ?? ''}
                  onChange={(e) =>
                    setEditingClient({ ...editingClient, tagsText: e.target.value })
                  }
                  placeholder="استراتيجية، عقد سنوي، تقنية"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">نبذة مختصرة</label>
                <textarea
                  rows={2}
                  value={editingClient.description || ''}
                  onChange={(e) =>
                    setEditingClient({ ...editingClient, description: e.target.value })
                  }
                  placeholder="وصف موجز لطبيعة العمل أو الشراكة..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  ملاحظات عامة وتفضيلات التواصل
                </label>
                <textarea
                  rows={2}
                  value={editingClient.notes || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, notes: e.target.value })}
                  placeholder="أوقات الاتصال المفضلة، تفاصيل هامة..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="client-favorite"
                  checked={editingClient.isFavorite || false}
                  onChange={(e) =>
                    setEditingClient({ ...editingClient, isFavorite: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-600"
                />
                <label htmlFor="client-favorite" className="font-semibold text-stone-800 cursor-pointer">
                  تمييز كعميل رئيسي (مفضلة)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-stone-600 hover:bg-stone-100 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-white bg-emerald-700 hover:bg-emerald-800 font-semibold shadow-xs"
                >
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
