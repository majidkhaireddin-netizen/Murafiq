import React, { useState } from 'react';
import { Client, Meeting, ActionItem, Note } from '../../types';
import { formatArabicDate, getRelativeTimeArabic } from '../../utils/logic';
import {
  Search,
  Plus,
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  CheckSquare,
  FileText,
  Star,
  ChevronLeft,
  X,
  ExternalLink,
  Edit2,
  Trash2,
} from 'lucide-react';

interface ClientsViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  onSelectMeeting: (meeting: Meeting) => void;
  onNewMeeting: (clientId: string) => void;
  onNewTask: (clientId: string) => void;
  onSaveClient: (client: Client) => void;
  onDeleteClient: (clientId: string) => void;
  selectedClientId?: string | null;
  language: 'ar' | 'en';
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  meetings,
  tasks,
  notes,
  onSelectMeeting,
  onNewMeeting,
  onNewTask,
  onSaveClient,
  onDeleteClient,
  selectedClientId,
  language,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'favorites' | 'needs_review'>('all');
  const [activeClient, setActiveClient] = useState<Client | null>(
    selectedClientId ? clients.find((c) => c.id === selectedClientId) || null : null
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Partial<Client> | null>(null);

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.company && c.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.phone && c.phone.includes(searchQuery));

    if (!matchesSearch) return false;

    if (filterType === 'favorites') return c.isFavorite;
    if (filterType === 'needs_review') {
      const clientMeetings = meetings.filter((m) => m.clientId === c.id);
      if (clientMeetings.length === 0) return true;
      const sorted = [...clientMeetings].sort(
        (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()
      );
      const diffDays = Math.floor(
        (Date.now() - new Date(sorted[0].dateTime).getTime()) / (1000 * 60 * 60 * 24)
      );
      return diffDays >= 30;
    }
    return true;
  });

  const getClientLastMeeting = (clientId: string) => {
    const clientMeetings = meetings
      .filter((m) => m.clientId === clientId)
      .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    return clientMeetings[0] || null;
  };

  const getClientPendingTasksCount = (clientId: string) => {
    return tasks.filter((t) => t.clientId === clientId && t.status !== 'completed').length;
  };

  const handleOpenEdit = (client?: Client) => {
    if (client) {
      setEditingClient({ ...client });
    } else {
      setEditingClient({
        name: '',
        company: '',
        phone: '',
        email: '',
        notes: '',
        color: '#059669',
        isFavorite: false,
      });
    }
    setIsEditModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient?.name) return;

    const saved: Client = {
      id: editingClient.id || `c-${Date.now()}`,
      name: editingClient.name,
      company: editingClient.company || '',
      phone: editingClient.phone || '',
      email: editingClient.email || '',
      notes: editingClient.notes || '',
      color: editingClient.color || '#059669',
      avatarPath: editingClient.avatarPath || '',
      isFavorite: editingClient.isFavorite || false,
      createdAt: editingClient.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveClient(saved);
    if (activeClient?.id === saved.id) {
      setActiveClient(saved);
    }
    setIsEditModalOpen(false);
    setEditingClient(null);
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Top Header & Search */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading font-extrabold text-xl text-stone-900">
          {language === 'ar' ? 'جهات الاتصال والعملاء' : 'Clients & Contacts'}
        </h2>
        <button
          onClick={() => handleOpenEdit()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors"
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
          placeholder={language === 'ar' ? 'ابحث بالاسم، الشركة، أو رقم الهاتف...' : 'Search by name, company, or phone...'}
          className="w-full bg-white rounded-xl border border-stone-200 py-2 ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3 text-xs text-stone-800 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-stone-400 hover:text-stone-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-lg font-medium transition-colors shrink-0 ${
            filterType === 'all'
              ? 'bg-stone-900 text-white'
              : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
          }`}
        >
          الكل ({clients.length})
        </button>
        <button
          onClick={() => setFilterType('favorites')}
          className={`px-3 py-1 rounded-lg font-medium transition-colors shrink-0 flex items-center gap-1 ${
            filterType === 'favorites'
              ? 'bg-stone-900 text-white'
              : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
          }`}
        >
          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
          المفضلة ({clients.filter((c) => c.isFavorite).length})
        </button>
        <button
          onClick={() => setFilterType('needs_review')}
          className={`px-3 py-1 rounded-lg font-medium transition-colors shrink-0 ${
            filterType === 'needs_review'
              ? 'bg-amber-800 text-white'
              : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
          }`}
        >
          يحتاج تواصل (&gt;30 يوماً)
        </button>
      </div>

      {/* Clients Cards Grid */}
      <div className="space-y-2.5">
        {filteredClients.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-stone-200 text-stone-400 text-xs">
            لا توجد جهات اتصال تطابق خيارات البحث الحالية.
          </div>
        ) : (
          filteredClients.map((client) => {
            const lastMeeting = getClientLastMeeting(client.id);
            const pendingTasks = getClientPendingTasksCount(client.id);

            return (
              <div
                key={client.id}
                onClick={() => setActiveClient(client)}
                className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs hover:border-emerald-400 hover:shadow-sm transition-all cursor-pointer flex items-start justify-between gap-3 group"
              >
                <div className="flex items-start gap-3 min-w-0">
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

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 group-hover:text-emerald-800 truncate">
                        {client.name}
                      </h4>
                      {client.isFavorite && (
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                      )}
                    </div>

                    {client.company && (
                      <p className="text-[11px] text-stone-600 truncate mt-0.5">
                        {client.company}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-400 flex-wrap">
                      {lastMeeting ? (
                        <span className="text-stone-600">
                          آخر لقاء: {getRelativeTimeArabic(lastMeeting.dateTime)}
                        </span>
                      ) : (
                        <span className="text-amber-700">لم يسجل لقاء بعد</span>
                      )}

                      {pendingTasks > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded font-medium">
                          <CheckSquare className="w-2.5 h-2.5" />
                          <span>{pendingTasks} مهام معلقة</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-stone-400 group-hover:text-emerald-700 shrink-0 self-center">
                  <ChevronLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detailed Client Sheet / Modal */}
      {activeClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-auto overflow-hidden border border-stone-200 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
            {/* Sheet Header */}
            <div className="p-4 sm:p-5 bg-stone-50 border-b border-stone-200 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                {activeClient.avatarPath ? (
                  <img
                    src={activeClient.avatarPath}
                    alt={activeClient.name}
                    className="w-12 h-12 rounded-xl object-cover border border-stone-200"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl text-white flex items-center justify-center font-bold text-base"
                    style={{ backgroundColor: activeClient.color || '#059669' }}
                  >
                    {activeClient.name.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-heading font-extrabold text-base text-stone-900">
                      {activeClient.name}
                    </h3>
                    {activeClient.isFavorite && (
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                    )}
                  </div>
                  {activeClient.company && (
                    <p className="text-xs text-stone-600 font-medium">
                      {activeClient.company}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenEdit(activeClient)}
                  className="p-1.5 text-stone-600 hover:text-emerald-700 rounded-lg hover:bg-stone-200 transition-colors"
                  title="تعديل بيانات العميل"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setActiveClient(null)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Actions (Call, WhatsApp, Email, New Meeting) */}
            <div className="p-3 bg-stone-100/70 border-b border-stone-200 flex items-center justify-around gap-2 shrink-0">
              {activeClient.phone && (
                <>
                  <a
                    href={`tel:${activeClient.phone}`}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-2xs"
                  >
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>اتصال</span>
                  </a>
                  <a
                    href={`https://wa.me/${activeClient.phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 px-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-2xs"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>واتساب</span>
                  </a>
                </>
              )}
              {activeClient.email && (
                <a
                  href={`mailto:${activeClient.email}`}
                  className="flex-1 py-1.5 px-2 rounded-xl bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-2xs"
                >
                  <Mail className="w-3.5 h-3.5 text-sky-600" />
                  <span>إيميل</span>
                </a>
              )}
              <button
                onClick={() => {
                  onNewMeeting(activeClient.id);
                  setActiveClient(null);
                }}
                className="flex-1 py-1.5 px-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>لقاء جديد</span>
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-4 sm:p-5 space-y-5 overflow-y-auto flex-1">
              {/* Private Notes & Preferences */}
              {activeClient.notes && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-950">
                  <span className="font-bold block mb-1">ملاحظات التفضيلات الخاصة:</span>
                  <p className="leading-relaxed whitespace-pre-line">{activeClient.notes}</p>
                </div>
              )}

              {/* Client Meetings Timeline */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>سجل اللقاءات ({meetings.filter((m) => m.clientId === activeClient.id).length})</span>
                  </h4>
                </div>

                {meetings.filter((m) => m.clientId === activeClient.id).length === 0 ? (
                  <p className="text-xs text-stone-400 py-3 text-center bg-stone-50 rounded-xl">
                    لم يتم تسجيل أي لقاءات مع هذا العميل حتى الآن.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {meetings
                      .filter((m) => m.clientId === activeClient.id)
                      .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
                      .map((meeting) => (
                        <div
                          key={meeting.id}
                          onClick={() => {
                            onSelectMeeting(meeting);
                            setActiveClient(null);
                          }}
                          className="p-2.5 rounded-xl border border-stone-200 hover:border-emerald-300 hover:bg-emerald-50/20 cursor-pointer transition-all flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-xs text-stone-900 block">
                              {meeting.title}
                            </span>
                            <span className="text-[11px] text-stone-500">
                              {formatArabicDate(meeting.dateTime)} ({getRelativeTimeArabic(meeting.dateTime)})
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              meeting.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : meeting.status === 'confirmed'
                                ? 'bg-sky-50 text-sky-700'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            {meeting.status === 'completed' && 'منتهية'}
                            {meeting.status === 'confirmed' && 'مؤكدة'}
                            {meeting.status === 'draft' && 'مسودة'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Client Pending Tasks */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
                    <span>المهام والمتابعات ({tasks.filter((t) => t.clientId === activeClient.id).length})</span>
                  </h4>
                  <button
                    onClick={() => {
                      onNewTask(activeClient.id);
                      setActiveClient(null);
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    + إضافة مهمة
                  </button>
                </div>

                {tasks.filter((t) => t.clientId === activeClient.id).length === 0 ? (
                  <p className="text-xs text-stone-400 py-3 text-center bg-stone-50 rounded-xl">
                    لا توجد مهام مسجلة لهذا العميل.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {tasks
                      .filter((t) => t.clientId === activeClient.id)
                      .map((task) => (
                        <div
                          key={task.id}
                          className="p-2 rounded-lg bg-stone-50 border border-stone-200/80 flex items-center justify-between text-xs"
                        >
                          <span
                            className={
                              task.status === 'completed'
                                ? 'line-through text-stone-400'
                                : 'font-medium text-stone-800'
                            }
                          >
                            {task.title}
                          </span>
                          <span className="text-[10px] text-stone-500 font-mono">
                            {task.dueDate || 'بدون موعد'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Client Modal */}
      {isEditModalOpen && editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto overflow-hidden border border-stone-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4">
              <h3 className="font-heading font-bold text-base text-stone-900">
                {editingClient.id ? 'تعديل بيانات العميل' : 'إضافة جهة اتصال جديدة'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-3.5 text-xs">
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

              <div>
                <label className="block font-semibold text-stone-700 mb-1">الشركة أو الجهة</label>
                <input
                  type="text"
                  value={editingClient.company || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, company: e.target.value })}
                  placeholder="مثال: شركة أفق للتقنية"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={editingClient.phone || ''}
                    onChange={(e) => setEditingClient({ ...editingClient, phone: e.target.value })}
                    placeholder="+966 5..."
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={editingClient.email || ''}
                    onChange={(e) => setEditingClient({ ...editingClient, email: e.target.value })}
                    placeholder="name@company.com"
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  ملاحظات عامة وتفضيلات التواصل
                </label>
                <textarea
                  rows={3}
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
                  onChange={(e) => setEditingClient({ ...editingClient, isFavorite: e.target.checked })}
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
