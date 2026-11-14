import React, { useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  ClientContact,
  ClientRelationshipStatus,
  Meeting,
  Note,
} from '../types';
import { formatArabicDate, getRelativeTimeArabic } from '../utils/logic';
import {
  CLIENT_CATEGORY_LABELS,
  CLIENT_IMPORTANCE_CONFIG,
  CLIENT_RELATIONSHIP_STATUS_CONFIG,
  ClientSyncDisplayState,
  ClientTimelineEventType,
  addClientContact,
  buildClientActivityTimeline,
  computeClientKpis,
  evaluateClientAttentionAlerts,
  getClientCategoryLabel,
  isValidEmailAddress,
  isValidPhoneForTel,
  removeClientContact,
  sanitizePhoneForTel,
  sanitizePhoneForWhatsApp,
  sanitizeWebsiteUrl,
  setPrimaryClientContact,
  updateClientContact,
} from '../utils/client360';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Trash2,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';

export type Client360SectionTab =
  | 'overview'
  | 'timeline'
  | 'meetings'
  | 'tasks'
  | 'contacts'
  | 'notes';

interface Client360WorkspaceProps {
  client: Client;
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  syncDisplay: ClientSyncDisplayState;
  collectionsLoaded: boolean;
  onBack: () => void;
  onEditClient: (client: Client) => void;
  onSaveClient: (client: Client) => Promise<void> | void;
  onDeleteClient: (clientId: string) => Promise<void> | void;
  onNewMeeting: (clientId: string) => void;
  onSelectMeeting: (meeting: Meeting) => void;
  onOpenMeetingAttachments: (meeting: Meeting) => void;
  onNewTask: (clientId: string) => void;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (task: ActionItem) => void;
  onNewNote: (clientId: string) => void;
  onOpenNote: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
  language: 'ar' | 'en';
}

export const Client360Workspace: React.FC<Client360WorkspaceProps> = ({
  client,
  meetings,
  tasks,
  notes,
  syncDisplay,
  collectionsLoaded,
  onBack,
  onEditClient,
  onSaveClient,
  onDeleteClient,
  onNewMeeting,
  onSelectMeeting,
  onOpenMeetingAttachments,
  onNewTask,
  onToggleTask,
  onOpenTask,
  onNewNote,
  onOpenNote,
  onDeleteNote,
  language,
}) => {
  const [activeSection, setActiveSection] = useState<Client360SectionTab>('overview');
  const [timelineFilter, setTimelineFilter] = useState<'all' | ClientTimelineEventType>('all');
  const [timelineSort, setTimelineSort] = useState<'desc' | 'asc'>('desc');

  // Contacts CRUD local form state
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<{
    name: string;
    title: string;
    department: string;
    phone: string;
    email: string;
    notes: string;
    isPrimary: boolean;
  }>({
    name: '',
    title: '',
    department: '',
    phone: '',
    email: '',
    notes: '',
    isPrimary: false,
  });
  const [pendingDeleteContact, setPendingDeleteContact] = useState<ClientContact | null>(null);
  const [confirmDeleteClientOpen, setConfirmDeleteClientOpen] = useState(false);

  const clientMeetings = useMemo(
    () =>
      meetings
        .filter((m) => m.clientId === client.id)
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()),
    [meetings, client.id]
  );

  const clientTasks = useMemo(
    () => tasks.filter((t) => t.clientId === client.id),
    [tasks, client.id]
  );

  const clientNotes = useMemo(
    () =>
      notes
        .filter((n) => n.clientId === client.id)
        .sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
        }),
    [notes, client.id]
  );

  const kpis = useMemo(
    () =>
      computeClientKpis({
        client,
        meetings: clientMeetings,
        tasks: clientTasks,
        notes: clientNotes,
      }),
    [client, clientMeetings, clientTasks, clientNotes]
  );

  const attentionAlerts = useMemo(
    () =>
      evaluateClientAttentionAlerts({
        client,
        meetings: clientMeetings,
        tasks: clientTasks,
      }),
    [client, clientMeetings, clientTasks]
  );

  const timelineEvents = useMemo(
    () =>
      buildClientActivityTimeline({
        clientId: client.id,
        meetings: clientMeetings,
        tasks: clientTasks,
        notes: clientNotes,
        filterType: timelineFilter,
        sortOrder: timelineSort,
      }),
    [client.id, clientMeetings, clientTasks, clientNotes, timelineFilter, timelineSort]
  );

  const contacts = client.contacts || [];
  const primaryContact = contacts.find((c) => c.isPrimary) || null;

  const validTelHref = sanitizePhoneForTel(client.phone);
  const validWhatsAppDigits = sanitizePhoneForWhatsApp(client.phone);
  const validEmailHref = isValidEmailAddress(client.email) ? client.email!.trim() : null;
  const validWebsiteUrl = sanitizeWebsiteUrl(client.website);

  const handleToggleFavorite = () => {
    void onSaveClient({
      ...client,
      isFavorite: !client.isFavorite,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleStatusChange = (nextStatus: ClientRelationshipStatus) => {
    void onSaveClient({
      ...client,
      relationshipStatus: nextStatus,
      updatedAt: new Date().toISOString(),
    });
  };

  const openAddContactForm = () => {
    setEditingContactId(null);
    setContactForm({
      name: '',
      title: '',
      department: '',
      phone: '',
      email: '',
      notes: '',
      isPrimary: contacts.length === 0,
    });
    setIsContactFormOpen(true);
  };

  const openEditContactForm = (contact: ClientContact) => {
    setEditingContactId(contact.id);
    setContactForm({
      name: contact.name || '',
      title: contact.title || '',
      department: contact.department || '',
      phone: contact.phone || '',
      email: contact.email || '',
      notes: contact.notes || '',
      isPrimary: Boolean(contact.isPrimary),
    });
    setIsContactFormOpen(true);
  };

  const handleSubmitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name.trim()) return;

    const nextContacts = editingContactId
      ? updateClientContact(contacts, editingContactId, {
          name: contactForm.name,
          title: contactForm.title || undefined,
          department: contactForm.department || undefined,
          phone: contactForm.phone || undefined,
          email: contactForm.email || undefined,
          notes: contactForm.notes || undefined,
          isPrimary: contactForm.isPrimary,
        })
      : addClientContact(contacts, {
          name: contactForm.name,
          title: contactForm.title || undefined,
          department: contactForm.department || undefined,
          phone: contactForm.phone || undefined,
          email: contactForm.email || undefined,
          notes: contactForm.notes || undefined,
          isPrimary: contactForm.isPrimary,
        });

    await onSaveClient({
      ...client,
      contacts: nextContacts,
      updatedAt: new Date().toISOString(),
    });
    setIsContactFormOpen(false);
    setEditingContactId(null);
  };

  const handleConfirmRemoveContact = async () => {
    if (!pendingDeleteContact) return;
    const nextContacts = removeClientContact(contacts, pendingDeleteContact.id);
    await onSaveClient({
      ...client,
      contacts: nextContacts,
      updatedAt: new Date().toISOString(),
    });
    setPendingDeleteContact(null);
  };

  const handleMakePrimaryContact = async (contactId: string) => {
    const nextContacts = setPrimaryClientContact(contacts, contactId);
    await onSaveClient({
      ...client,
      contacts: nextContacts,
      updatedAt: new Date().toISOString(),
    });
  };

  const statusConfig = client.relationshipStatus
    ? CLIENT_RELATIONSHIP_STATUS_CONFIG[client.relationshipStatus]
    : null;
  const importanceConfig = client.importance
    ? CLIENT_IMPORTANCE_CONFIG[client.importance]
    : null;

  return (
    <div data-testid="client-360-workspace" className="space-y-4 pb-8">
      {/* Top Breadcrumb / Return & Sync Status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors min-h-[36px]"
        >
          <ArrowRight className="w-3.5 h-3.5 ltr:rotate-180" />
          <span>{language === 'ar' ? 'العودة لقائمة العملاء' : 'Back to Clients'}</span>
        </button>

        {/* Honest Sync Status Badge */}
        <div
          data-testid="client-360-sync-status"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
            syncDisplay.kind === 'failed' || syncDisplay.kind === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : syncDisplay.kind === 'offline_pending'
              ? 'bg-amber-50 text-amber-900 border-amber-200'
              : syncDisplay.kind === 'loading'
              ? 'bg-stone-100 text-stone-600 border-stone-200'
              : 'bg-emerald-50/70 text-emerald-800 border-emerald-200'
          }`}
        >
          {syncDisplay.kind === 'offline_pending' && <WifiOff className="w-3 h-3 shrink-0" />}
          {(syncDisplay.kind === 'failed' || syncDisplay.kind === 'error') && (
            <AlertTriangle className="w-3 h-3 shrink-0" />
          )}
          {syncDisplay.kind === 'synced' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
          <span>{language === 'ar' ? syncDisplay.labelArabic : syncDisplay.labelEnglish}</span>
        </div>
      </div>

      {/* Main Client Header Card */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3.5 min-w-0">
              {client.avatarPath ? (
                <img
                  src={client.avatarPath}
                  alt={client.name}
                  className="w-14 h-14 rounded-2xl object-cover border border-stone-200 shrink-0"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-2xl text-white flex items-center justify-center font-extrabold text-lg shrink-0 shadow-2xs"
                  style={{ backgroundColor: client.color || '#059669' }}
                >
                  {client.name.charAt(0)}
                </div>
              )}

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-heading font-extrabold text-lg sm:text-xl text-stone-900 leading-tight">
                    {client.name}
                  </h2>
                  <button
                    type="button"
                    onClick={handleToggleFavorite}
                    aria-label={client.isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                    className="p-1 rounded-lg hover:bg-stone-100 transition-colors"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        client.isFavorite
                          ? 'text-amber-500 fill-amber-500'
                          : 'text-stone-300 hover:text-amber-400'
                      }`}
                    />
                  </button>
                  {importanceConfig && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${importanceConfig.badgeClass}`}
                    >
                      {importanceConfig.labelAr}
                    </span>
                  )}
                  {client.category && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                      {getClientCategoryLabel(client.category, language)}
                    </span>
                  )}
                </div>

                {(client.company || client.industry) && (
                  <div className="flex items-center gap-2 text-xs text-stone-600 flex-wrap">
                    {client.company && (
                      <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                        <Building2 className="w-3.5 h-3.5 text-stone-400" />
                        <span>{client.company}</span>
                      </span>
                    )}
                    {client.company && client.industry && <span className="text-stone-300">•</span>}
                    {client.industry && <span>{client.industry}</span>}
                  </div>
                )}

                {/* Dates Strip */}
                <div className="flex items-center gap-3 text-[11px] text-stone-500 flex-wrap pt-0.5">
                  <span>تاريخ الإضافة: {formatArabicDate(client.createdAt)}</span>
                  <span className="text-stone-300">|</span>
                  <span>
                    آخر تواصل:{' '}
                    <strong className="font-semibold text-stone-700">
                      {kpis.lastContactAt
                        ? `${formatArabicDate(kpis.lastContactAt)} (${getRelativeTimeArabic(
                            kpis.lastContactAt
                          )})`
                        : 'لا يوجد تواصل مسجل'}
                    </strong>
                  </span>
                  {kpis.nextFollowUpAt && (
                    <>
                      <span className="text-stone-300">|</span>
                      <span className="text-emerald-800 font-semibold">
                        المتابعة القادمة: {formatArabicDate(kpis.nextFollowUpAt)} (
                        {getRelativeTimeArabic(kpis.nextFollowUpAt)})
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Manual Relationship Status Selector & Edit/Delete */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="client360-status-select"
                  className="text-[11px] font-semibold text-stone-500"
                >
                  حالة العلاقة:
                </label>
                <select
                  id="client360-status-select"
                  value={client.relationshipStatus || ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleStatusChange(e.target.value as ClientRelationshipStatus);
                    }
                  }}
                  className={`text-xs font-semibold rounded-xl border px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 ${
                    statusConfig
                      ? statusConfig.badgeClass
                      : 'bg-stone-50 text-stone-700 border-stone-200'
                  }`}
                >
                  <option value="" disabled>
                    غير محددة
                  </option>
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

              <button
                type="button"
                onClick={() => onEditClient(client)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>تعديل</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmDeleteClientOpen(true)}
                aria-label={`حذف العميل ${client.name}`}
                className="p-1.5 rounded-xl border border-stone-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-stone-400 hover:text-rose-700 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Tags Strip */}
          {client.tags && client.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              {client.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200/80"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Direct Quick Actions Row */}
          <div className="pt-3 border-t border-stone-100 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onNewMeeting(client.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>اجتماع جديد</span>
            </button>

            <button
              type="button"
              onClick={() => onNewTask(client.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-800 text-xs font-semibold transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
              <span>مهمة جديدة</span>
            </button>

            <button
              type="button"
              onClick={() => onNewNote(client.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-800 text-xs font-semibold transition-colors"
            >
              <StickyNote className="w-3.5 h-3.5 text-amber-600" />
              <span>ملاحظة جديدة</span>
            </button>

            {validTelHref && (
              <a
                href={`tel:${validTelHref}`}
                data-testid="client-call-link"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-semibold transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-700" />
                <span>اتصال</span>
              </a>
            )}

            {validWhatsAppDigits && (
              <a
                href={`https://wa.me/${validWhatsAppDigits}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                <span>واتساب</span>
              </a>
            )}

            {validEmailHref && (
              <a
                href={`mailto:${validEmailHref}`}
                data-testid="client-email-link"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-semibold transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-sky-700" />
                <span>بريد</span>
              </a>
            )}

            {validWebsiteUrl && (
              <a
                href={validWebsiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-semibold transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-stone-500" />
                <span>الموقع</span>
                <ExternalLink className="w-3 h-3 text-stone-400" />
              </a>
            )}
          </div>
        </div>
      </section>

      {/* KPI Summary Strip */}
      <section aria-label="ملخص مؤشرات العميل" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {[
          {
            label: 'إجمالي الاجتماعات',
            value: collectionsLoaded ? String(kpis.totalMeetings) : '—',
            tone: 'text-stone-900',
            bg: 'bg-white border-stone-200',
          },
          {
            label: 'الاجتماعات القادمة',
            value: collectionsLoaded ? String(kpis.upcomingMeetings) : '—',
            tone: 'text-sky-800',
            bg: 'bg-white border-stone-200',
          },
          {
            label: 'المهام المفتوحة',
            value: collectionsLoaded ? String(kpis.openTasks) : '—',
            tone: 'text-stone-900',
            bg: 'bg-white border-stone-200',
          },
          {
            label: 'المهام المتأخرة',
            value: collectionsLoaded ? String(kpis.overdueTasks) : '—',
            tone: kpis.overdueTasks > 0 ? 'text-rose-700' : 'text-stone-900',
            bg:
              kpis.overdueTasks > 0
                ? 'bg-rose-50/70 border-rose-200'
                : 'bg-white border-stone-200',
          },
          {
            label: 'المهام المنجزة',
            value: collectionsLoaded ? String(kpis.completedTasks) : '—',
            tone: 'text-emerald-700',
            bg: 'bg-white border-stone-200',
          },
          {
            label: 'آخر نشاط مسجل',
            value: collectionsLoaded
              ? kpis.lastActivityAt
                ? getRelativeTimeArabic(kpis.lastActivityAt)
                : 'لا يوجد'
              : '—',
            subtext: collectionsLoaded && kpis.lastActivityAt ? formatArabicDate(kpis.lastActivityAt) : undefined,
            tone: 'text-stone-800',
            bg: 'bg-white border-stone-200',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-2xl border p-3 shadow-2xs flex flex-col justify-between ${stat.bg}`}
          >
            <span className="text-[11px] font-medium text-stone-500">{stat.label}</span>
            <div className="mt-1.5">
              <span className={`font-heading font-extrabold text-lg tabular-nums block ${stat.tone}`}>
                {stat.value}
              </span>
              {stat.subtext && (
                <span className="text-[10px] text-stone-400 block mt-0.5">{stat.subtext}</span>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Deterministic Relationship Attention Section */}
      <section
        aria-label="ما الذي يستحق انتباهك؟"
        className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-heading font-bold text-xs sm:text-sm text-stone-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-700" />
            <span>ما الذي يستحق انتباهك؟</span>
          </h3>
          <span className="text-[11px] text-stone-400">قواعد متابعة مبنية على سجلاتك الفعلية</span>
        </div>

        {!collectionsLoaded ? (
          <p className="text-xs text-stone-400 py-2">جاري فحص سجلات المتابعة...</p>
        ) : attentionAlerts.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-stone-600 bg-stone-50 border border-stone-200/80 rounded-xl px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>لا توجد تنبيهات متابعة ملحة حالياً لهذا العميل.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {attentionAlerts.map((alert) => {
              const style =
                alert.severity === 'high'
                  ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                  : alert.severity === 'medium'
                  ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                  : 'bg-sky-50/70 border-sky-200 text-sky-950';

              return (
                <div
                  key={alert.id}
                  data-testid={`attention-alert-${alert.kind}`}
                  className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${style}`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      {alert.severity === 'high' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                      ) : alert.severity === 'info' ? (
                        <Calendar className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      )}
                      <span>{alert.messageArabic}</span>
                    </div>
                    {alert.basisDisclosureArabic && (
                      <p className="text-[11px] opacity-80 flex items-center gap-1">
                        <Info className="w-3 h-3 shrink-0" />
                        <span>{alert.basisDisclosureArabic}</span>
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (alert.actionType === 'view_tasks') {
                        setActiveSection('tasks');
                      } else if (alert.actionType === 'schedule_meeting') {
                        onNewMeeting(client.id);
                      } else if (alert.actionType === 'open_meeting' && alert.meetingId) {
                        const target = clientMeetings.find((m) => m.id === alert.meetingId);
                        if (target) onSelectMeeting(target);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-black/10 hover:bg-stone-50 text-stone-800 text-xs font-semibold shrink-0 self-start sm:self-center transition-colors"
                  >
                    {alert.actionLabelArabic}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Workspace Section Tabs */}
      <nav
        aria-label="أقسام ملف العميل"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-stone-200 text-xs"
      >
        {(
          [
            { key: 'overview', label: 'نظرة عامة' },
            { key: 'timeline', label: `سجل الأنشطة (${timelineEvents.length})` },
            { key: 'meetings', label: `الاجتماعات (${clientMeetings.length})` },
            { key: 'tasks', label: `المهام (${clientTasks.length})` },
            { key: 'contacts', label: `جهات الاتصال (${contacts.length})` },
            { key: 'notes', label: `الملاحظات (${clientNotes.length})` },
          ] as { key: Client360SectionTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveSection(tab.key)}
            className={`px-3 py-2 rounded-t-xl font-bold shrink-0 transition-colors border-b-2 ${
              activeSection === tab.key
                ? 'border-emerald-700 text-emerald-900 bg-white'
                : 'border-transparent text-stone-600 hover:text-stone-900 hover:bg-stone-100/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* SECTION 1: OVERVIEW */}
      {activeSection === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* About & Business Context */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                  نبذة العميل ومعلومات التواصل
                </h4>
                <button
                  type="button"
                  onClick={() => onEditClient(client)}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  تحديث البيانات
                </button>
              </div>

              {client.description && (
                <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                  {client.description}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <span className="text-[11px] text-stone-400 block">الهاتف</span>
                  {client.phone ? (
                    <span dir="ltr" className="font-medium text-stone-800 inline-block">
                      {client.phone}
                    </span>
                  ) : (
                    <span className="font-medium text-stone-800">غير مسجل</span>
                  )}
                </div>
                <div>
                  <span className="text-[11px] text-stone-400 block">البريد الإلكتروني</span>
                  <span className="font-medium text-stone-800 break-all">
                    {client.email || 'غير مسجل'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-400 block">القطاع / المجال</span>
                  <span className="font-medium text-stone-800">
                    {client.industry || 'غير محدد'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-400 block">التصنيف</span>
                  <span className="font-medium text-stone-800">
                    {client.category
                      ? getClientCategoryLabel(client.category, language)
                      : 'غير محدد'}
                  </span>
                </div>
                {client.address && (
                  <div className="sm:col-span-2">
                    <span className="text-[11px] text-stone-400 block">العنوان / المدينة</span>
                    <span className="font-medium text-stone-800 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-stone-400 shrink-0" />
                      <span>{client.address}</span>
                    </span>
                  </div>
                )}
                {client.source && (
                  <div>
                    <span className="text-[11px] text-stone-400 block">مصدر العميل</span>
                    <span className="font-medium text-stone-800">{client.source}</span>
                  </div>
                )}
              </div>

              {client.notes && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-950">
                  <span className="font-bold block mb-1">ملاحظات وتفضيلات خاصة:</span>
                  <p className="leading-relaxed whitespace-pre-line">{client.notes}</p>
                </div>
              )}
            </div>

            {/* Recent Timeline Preview */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                  أحدث الأنشطة المسجلة
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveSection('timeline')}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  عرض السجل الكامل
                </button>
              </div>

              {timelineEvents.length === 0 ? (
                <p className="text-xs text-stone-400 py-4 text-center bg-stone-50 rounded-xl">
                  لا توجد أنشطة مسجلة لهذا العميل بعد. ابدأ بجدولة اجتماع أو إضافة مهمة أو ملاحظة.
                </p>
              ) : (
                <div className="space-y-2">
                  {timelineEvents.slice(0, 4).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        if (ev.sourceType === 'meeting') {
                          const m = clientMeetings.find((x) => x.id === ev.sourceId);
                          if (m) onSelectMeeting(m);
                        } else if (ev.sourceType === 'task') {
                          const t = clientTasks.find((x) => x.id === ev.sourceId);
                          if (t) onOpenTask(t);
                        } else if (ev.sourceType === 'note') {
                          const n = clientNotes.find((x) => x.id === ev.sourceId);
                          if (n) onOpenNote(n);
                        }
                      }}
                      className="w-full text-start p-2.5 rounded-xl border border-stone-200 hover:border-emerald-300 hover:bg-stone-50 transition-colors flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-700">
                            {ev.type === 'meeting'
                              ? ev.subKind === 'scheduled_follow_up'
                                ? 'متابعة'
                                : 'اجتماع'
                              : ev.type === 'task'
                              ? 'مهمة'
                              : ev.type === 'decision'
                              ? 'قرار'
                              : 'ملاحظة'}
                          </span>
                          <span className="font-semibold text-xs text-stone-900 truncate">
                            {ev.title}
                          </span>
                        </div>
                        {ev.summary && (
                          <p className="text-[11px] text-stone-500 mt-1 line-clamp-1">{ev.summary}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-stone-400 shrink-0">
                        {ev.timestamp ? getRelativeTimeArabic(ev.timestamp) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Primary Contact & Open Commitments */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                  جهة الاتصال الأساسية
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveSection('contacts')}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  إدارة ({contacts.length})
                </button>
              </div>

              {primaryContact ? (
                <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-stone-900">{primaryContact.name}</span>
                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                      رئيسية
                    </span>
                  </div>
                  {(primaryContact.title || primaryContact.department) && (
                    <p className="text-[11px] text-stone-600">
                      {[primaryContact.title, primaryContact.department].filter(Boolean).join(' • ')}
                    </p>
                  )}
                  {primaryContact.phone && (
                    <p dir="ltr" className="text-[11px] text-stone-700 text-right">
                      {primaryContact.phone}
                    </p>
                  )}
                  {primaryContact.email && (
                    <p className="text-[11px] text-stone-700 break-all">{primaryContact.email}</p>
                  )}
                </div>
              ) : (
                <div className="text-xs text-stone-500 bg-stone-50 rounded-xl p-3 space-y-2">
                  <p>لم يتم تعيين جهة اتصال فرعية أساسية بعد.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSection('contacts');
                      openAddContactForm();
                    }}
                    className="text-emerald-700 font-semibold hover:underline"
                  >
                    + إضافة جهة اتصال
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">
                  المهام المفتوحة ({kpis.openTasks})
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveSection('tasks')}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  الكل
                </button>
              </div>
              {clientTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
                .length === 0 ? (
                <p className="text-xs text-stone-400 py-2">لا توجد مهام مفتوحة حالياً.</p>
              ) : (
                <div className="space-y-1.5">
                  {clientTasks
                    .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
                    .slice(0, 4)
                    .map((task) => (
                      <div
                        key={task.id}
                        className="p-2 rounded-xl border border-stone-200/80 bg-stone-50/60 flex items-center justify-between gap-2 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => onToggleTask(task.id)}
                          aria-label={`إنجاز مهمة ${task.title}`}
                          className="w-4 h-4 rounded border border-stone-400 hover:border-emerald-600 shrink-0"
                        />
                        <span className="truncate flex-1 font-medium text-stone-800">
                          {task.title}
                        </span>
                        <span className="text-[10px] text-stone-500 shrink-0">
                          {task.dueDate ? getRelativeTimeArabic(task.dueDate) : 'بدون موعد'}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: ACTIVITY TIMELINE */}
      {activeSection === 'timeline' && (
        <div
          data-testid="client-360-timeline"
          className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="font-heading font-bold text-sm text-stone-900">
                سجل العلاقة والأنشطة
              </h4>
              <p className="text-[11px] text-stone-500">
                تسلسل زمني موحّد لجميع اللقاءات والمهام والملاحظات والقرارات الفعلية
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                aria-label="ترتيب سجل الأنشطة"
                value={timelineSort}
                onChange={(e) => setTimelineSort(e.target.value as 'desc' | 'asc')}
                className="bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
              >
                <option value="desc">الأحدث أولاً</option>
                <option value="asc">الأقدم أولاً</option>
              </select>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'meeting', label: 'اللقاءات' },
                { id: 'task', label: 'المهام' },
                { id: 'note', label: 'الملاحظات' },
                { id: 'decision', label: 'القرارات' },
              ] as { id: 'all' | ClientTimelineEventType; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTimelineFilter(f.id)}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                  timelineFilter === f.id
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-50 text-stone-600 border border-stone-200 hover:bg-stone-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {timelineEvents.length === 0 ? (
            <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              لا توجد أحداث مسجلة ضمن هذا التصنيف حتى الآن.
            </div>
          ) : (
            <div className="space-y-2.5">
              {timelineEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-3 rounded-xl border border-stone-200 hover:border-emerald-300 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          ev.type === 'meeting'
                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                            : ev.type === 'task'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : ev.type === 'decision'
                            ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        {ev.type === 'meeting'
                          ? ev.subKind === 'scheduled_follow_up'
                            ? 'متابعة مجدولة'
                            : 'اجتماع'
                          : ev.type === 'task'
                          ? 'مهمة'
                          : ev.type === 'decision'
                          ? 'قرار'
                          : 'ملاحظة'}
                      </span>
                      <span className="font-bold text-xs text-stone-900">{ev.title}</span>
                      {ev.statusLabelAr && (
                        <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                          {ev.statusLabelAr}
                        </span>
                      )}
                      <ProvenanceBadge type={ev.provenance} showText={false} />
                    </div>
                    {ev.summary && (
                      <p className="text-xs text-stone-600 line-clamp-2 whitespace-pre-line">
                        {ev.summary}
                      </p>
                    )}
                    <div className="text-[11px] text-stone-400">
                      {ev.timestamp ? (
                        <>
                          {formatArabicDate(ev.timestamp, ev.type === 'meeting')} (
                          {getRelativeTimeArabic(ev.timestamp)})
                        </>
                      ) : (
                        'بدون تاريخ محدد'
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (ev.sourceType === 'meeting') {
                        const m = clientMeetings.find((x) => x.id === ev.sourceId);
                        if (m) onSelectMeeting(m);
                      } else if (ev.sourceType === 'task') {
                        const t = clientTasks.find((x) => x.id === ev.sourceId);
                        if (t) onOpenTask(t);
                      } else if (ev.sourceType === 'note') {
                        const n = clientNotes.find((x) => x.id === ev.sourceId);
                        if (n) onOpenNote(n);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-stone-50 hover:bg-emerald-50 border border-stone-200 hover:border-emerald-300 text-stone-700 hover:text-emerald-800 text-[11px] font-semibold shrink-0 self-start sm:self-center"
                  >
                    فتح السجل
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: MEETINGS & ATTACHMENTS LINK */}
      {activeSection === 'meetings' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="font-heading font-bold text-sm text-stone-900">
                اجتماعات العميل ({clientMeetings.length})
              </h4>
              <p className="text-[11px] text-stone-500">
                الوصول المباشر لمساحة عمل الاجتماع، المحضر، وقسم المرفقات المحمية
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNewMeeting(client.id)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>اجتماع جديد</span>
            </button>
          </div>

          {clientMeetings.length === 0 ? (
            <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              لم يتم تسجيل أي اجتماعات مع هذا العميل حتى الآن.
            </div>
          ) : (
            <div className="space-y-2.5">
              {clientMeetings.map((meeting) => {
                const legacyPhotosCount = meeting.photoPaths?.length || 0;
                const decisionsCount = meeting.decisions?.length || 0;
                return (
                  <div
                    key={meeting.id}
                    className="p-3 rounded-xl border border-stone-200 hover:border-emerald-300 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs sm:text-sm text-stone-900">
                          {meeting.title}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                            meeting.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : meeting.status === 'confirmed'
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {meeting.status === 'completed'
                            ? 'منتهي'
                            : meeting.status === 'confirmed'
                            ? 'مؤكد'
                            : 'مسودة'}
                        </span>
                        {meeting.minutesStatus && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700">
                            المحضر:{' '}
                            {meeting.minutesStatus === 'final'
                              ? 'نهائي'
                              : meeting.minutesStatus === 'review'
                              ? 'قيد المراجعة'
                              : 'مسودة'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-500 flex items-center gap-2.5 flex-wrap">
                        <span>
                          {formatArabicDate(meeting.dateTime, true)} (
                          {getRelativeTimeArabic(meeting.dateTime)})
                        </span>
                        {decisionsCount > 0 && <span>• {decisionsCount} قرارات</span>}
                        {legacyPhotosCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-stone-600">
                            <Paperclip className="w-3 h-3" />
                            <span>{legacyPhotosCount} مرفق قديم</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenMeetingAttachments(meeting)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-[11px] font-semibold"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span>المرفقات</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectMeeting(meeting)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[11px] font-semibold"
                      >
                        <FileText className="w-3 h-3" />
                        <span>فتح الاجتماع</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: TASKS */}
      {activeSection === 'tasks' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="font-heading font-bold text-sm text-stone-900">
                المهام والالتزامات ({clientTasks.length})
              </h4>
              <p className="text-[11px] text-stone-500">
                متابعة المهام المفتوحة، المتأخرة، والمنجزة المرتبطة بهذا العميل
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNewTask(client.id)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>مهمة جديدة</span>
            </button>
          </div>

          {clientTasks.length === 0 ? (
            <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              لا توجد مهام مسجلة لهذا العميل.
            </div>
          ) : (
            <div className="space-y-2">
              {clientTasks.map((task) => {
                const isDone = task.status === 'completed';
                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
                      isDone
                        ? 'bg-stone-50/70 border-stone-200 opacity-75'
                        : 'bg-white border-stone-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onToggleTask(task.id)}
                        aria-label={`تبديل حالة مهمة ${task.title}`}
                        className={`w-5 h-5 rounded-md border-2 mt-0.5 shrink-0 flex items-center justify-center transition-colors ${
                          isDone
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-stone-300 hover:border-emerald-600'
                        }`}
                      >
                        {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </button>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-xs font-bold ${
                              isDone ? 'line-through text-stone-400' : 'text-stone-900'
                            }`}
                          >
                            {task.title}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                              task.priority === 'urgent'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : task.priority === 'high'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-stone-100 text-stone-700 border-stone-200'
                            }`}
                          >
                            {task.priority === 'urgent'
                              ? 'عاجلة'
                              : task.priority === 'high'
                              ? 'عالية'
                              : task.priority === 'medium'
                              ? 'متوسطة'
                              : 'منخفضة'}
                          </span>
                          <ProvenanceBadge type={task.provenance} showText={false} />
                        </div>
                        {task.description && (
                          <p className="text-[11px] text-stone-500">{task.description}</p>
                        )}
                        <div className="text-[11px] text-stone-400">
                          {task.dueDate
                            ? `الموعد: ${formatArabicDate(task.dueDate)} (${getRelativeTimeArabic(
                                task.dueDate
                              )})`
                            : 'بدون موعد نهائي'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="px-2.5 py-1 rounded-lg border border-stone-200 hover:bg-stone-50 text-[11px] font-semibold text-stone-700 shrink-0"
                    >
                      تعديل
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 5: CONTACTS */}
      {activeSection === 'contacts' && (
        <div
          data-testid="client-360-contacts"
          className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="font-heading font-bold text-sm text-stone-900">
                جهات الاتصال المرتبطة ({contacts.length})
              </h4>
              <p className="text-[11px] text-stone-500">
                الأشخاص المعنيون داخل الشركة أو المؤسسة مع إمكانية تحديد جهة اتصال رئيسية واحدة
              </p>
            </div>
            <button
              type="button"
              onClick={openAddContactForm}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة جهة اتصال</span>
            </button>
          </div>

          {isContactFormOpen && (
            <form
              onSubmit={handleSubmitContact}
              className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-stone-900">
                  {editingContactId ? 'تعديل جهة الاتصال' : 'جهة اتصال جديدة'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsContactFormOpen(false)}
                  className="text-stone-400 hover:text-stone-700"
                  aria-label="إغلاق نموذج جهة الاتصال"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    الاسم <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    placeholder="مثال: سارة المنصور"
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    المنصب / الدور الوظيفي
                  </label>
                  <input
                    type="text"
                    value={contactForm.title}
                    onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })}
                    placeholder="مثال: مديرة المشاريع"
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">القسم / الإدارة</label>
                  <input
                    type="text"
                    value={contactForm.department}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, department: e.target.value })
                    }
                    placeholder="مثال: تقنية المعلومات"
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    placeholder="+9665..."
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">
                    البريد الإلكتروني
                  </label>
                  <input
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    placeholder="contact@company.com"
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">ملاحظات</label>
                  <input
                    type="text"
                    value={contactForm.notes}
                    onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                    placeholder="ملاحظة مختصرة..."
                    className="w-full bg-white rounded-lg border border-stone-200 p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="contact-is-primary"
                  checked={contactForm.isPrimary}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, isPrimary: e.target.checked })
                  }
                  className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-600"
                />
                <label htmlFor="contact-is-primary" className="font-semibold text-stone-800">
                  تعيين كجهة الاتصال الرئيسية
                </label>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsContactFormOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-stone-600 hover:bg-stone-200"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
                >
                  {editingContactId ? 'حفظ التعديل' : 'إضافة جهة الاتصال'}
                </button>
              </div>
            </form>
          )}

          {contacts.length === 0 ? (
            <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              لا توجد جهات اتصال إضافية مسجلة لهذا العميل حتى الآن.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {contacts.map((c) => {
                const cTel = sanitizePhoneForTel(c.phone);
                const cEmail = isValidEmailAddress(c.email) ? c.email!.trim() : null;
                return (
                  <div
                    key={c.id}
                    className={`p-3.5 rounded-xl border space-y-2 ${
                      c.isPrimary
                        ? 'bg-emerald-50/40 border-emerald-300'
                        : 'bg-white border-stone-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-stone-900">
                            {c.name}
                          </span>
                          {c.isPrimary && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              جهة اتصال رئيسية
                            </span>
                          )}
                        </div>
                        {(c.title || c.department) && (
                          <p className="text-[11px] text-stone-600 mt-0.5">
                            {[c.title, c.department].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditContactForm(c)}
                          aria-label={`تعديل جهة الاتصال ${c.name}`}
                          className="p-1 text-stone-500 hover:text-emerald-700 rounded"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteContact(c)}
                          aria-label={`حذف جهة الاتصال ${c.name}`}
                          className="p-1 text-stone-400 hover:text-rose-700 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-stone-600 space-y-0.5">
                      {c.phone && <div dir="ltr" className="text-right">{c.phone}</div>}
                      {c.email && <div className="break-all">{c.email}</div>}
                      {c.notes && <p className="text-stone-500 pt-1">{c.notes}</p>}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-stone-100 flex-wrap text-[11px]">
                      {!c.isPrimary && (
                        <button
                          type="button"
                          onClick={() => void handleMakePrimaryContact(c.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 font-semibold"
                        >
                          <UserCheck className="w-3 h-3" />
                          <span>تعيين كرئيسية</span>
                        </button>
                      )}
                      {cTel && (
                        <a
                          href={`tel:${cTel}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 border border-stone-200 text-stone-700 font-semibold"
                        >
                          <Phone className="w-3 h-3 text-emerald-700" />
                          <span>اتصال</span>
                        </a>
                      )}
                      {cEmail && (
                        <a
                          href={`mailto:${cEmail}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 border border-stone-200 text-stone-700 font-semibold"
                        >
                          <Mail className="w-3 h-3 text-sky-700" />
                          <span>بريد</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 6: NOTES */}
      {activeSection === 'notes' && (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="font-heading font-bold text-sm text-stone-900">
                ملاحظات العميل ({clientNotes.length})
              </h4>
              <p className="text-[11px] text-stone-500">
                الملاحظات المرتبطة بالعميل بالإضافة إلى تفضيلات التواصل الخاصة
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNewNote(client.id)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ملاحظة جديدة</span>
            </button>
          </div>

          {client.notes && (
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-950">
              <span className="font-bold block mb-1">ملاحظات البطاقة الأساسية:</span>
              <p className="leading-relaxed whitespace-pre-line">{client.notes}</p>
            </div>
          )}

          {clientNotes.length === 0 ? (
            <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              لا توجد ملاحظات مخصصة مرتبطة بهذا العميل بعد.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {clientNotes.map((note) => (
                <div
                  key={note.id}
                  className="p-3.5 rounded-xl border border-stone-200 space-y-2"
                  style={{ backgroundColor: note.color || '#fef3c7' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="font-bold text-xs text-stone-900">{note.title}</h5>
                    <div className="flex items-center gap-1 shrink-0">
                      {note.isPinned && (
                        <Pin className="w-3.5 h-3.5 text-amber-700 fill-amber-700" />
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenNote(note)}
                        aria-label={`تعديل ملاحظة ${note.title}`}
                        className="p-1 text-stone-600 hover:text-stone-900 rounded"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-stone-800 whitespace-pre-line leading-relaxed">
                    {note.content}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-black/5 text-[10px] text-stone-600">
                    <div className="flex items-center gap-1 flex-wrap">
                      {note.tags.map((t) => (
                        <span key={t} className="bg-white/80 px-1.5 py-0.5 rounded">
                          #{t}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note.id)}
                      className="text-stone-500 hover:text-rose-700 font-semibold"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contact Delete Confirmation Dialog */}
      {pendingDeleteContact && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-stone-200 space-y-3">
            <h4 className="font-heading font-bold text-sm text-stone-900">
              تأكيد حذف جهة الاتصال
            </h4>
            <p className="text-xs text-stone-600 leading-relaxed">
              هل تريد حذف جهة الاتصال «{pendingDeleteContact.name}» من ملف العميل؟
            </p>
            <div className="flex items-center justify-end gap-2 text-xs pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteContact(null)}
                className="px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRemoveContact()}
                className="px-4 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-semibold"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Delete Confirmation Dialog */}
      {confirmDeleteClientOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-rose-200 space-y-3">
            <h4 className="font-heading font-bold text-sm text-stone-900">
              تأكيد حذف ملف العميل
            </h4>
            <p className="text-xs text-stone-600 leading-relaxed">
              سيتم حذف العميل «{client.name}» من قائمتك.
              {(clientMeetings.length > 0 || clientTasks.length > 0) &&
                ` ملاحظة: يرتبط بهذا العميل ${clientMeetings.length} اجتماعات و${clientTasks.length} مهام.`}
            </p>
            <div className="flex items-center justify-end gap-2 text-xs pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteClientOpen(false)}
                className="px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmDeleteClientOpen(false);
                  await onDeleteClient(client.id);
                  onBack();
                }}
                className="px-4 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-semibold"
              >
                حذف العميل نهائياً
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
