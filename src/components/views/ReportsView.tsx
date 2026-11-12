import React, { useState } from 'react';
import { Client, Meeting, ActionItem, Note } from '../../types';
import { formatArabicDate } from '../../utils/logic';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  Calendar,
  Users,
  StickyNote,
  Tag,
  Pin,
  Plus,
  X,
  FileText,
} from 'lucide-react';

interface ReportsViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  onSaveNote: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
  language: 'ar' | 'en';
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  clients,
  meetings,
  tasks,
  notes,
  onSaveNote,
  onDeleteNote,
  language,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'notes'>('stats');
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [newNote, setNewNote] = useState<Partial<Note>>({
    title: '',
    content: '',
    tags: ['عام'],
    isPinned: false,
    color: '#fef3c7',
  });

  // Analytics calculations
  const totalMeetings = meetings.length;
  const completedMeetings = meetings.filter((m) => m.status === 'completed').length;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Average duration
  const durations = meetings.map((m) => m.duration || 60);
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 60;

  // Meeting types breakdown
  const meetingTypesCount = {
    in_person: meetings.filter((m) => m.type === 'in_person').length,
    video: meetings.filter((m) => m.type === 'video').length,
    phone: meetings.filter((m) => m.type === 'phone').length,
    chat: meetings.filter((m) => m.type === 'chat').length,
  };

  // Top 5 active clients
  const clientActivity = clients.map((c) => {
    const cMeetings = meetings.filter((m) => m.clientId === c.id).length;
    const cTasks = tasks.filter((t) => t.clientId === c.id).length;
    return { client: c, meetingsCount: cMeetings, tasksCount: cTasks, totalScore: cMeetings * 2 + cTasks };
  }).sort((a, b) => b.totalScore - a.totalScore);

  const handleSaveNoteForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.title || !newNote.content) return;

    const saved: Note = {
      id: `n-${Date.now()}`,
      title: newNote.title,
      content: newNote.content,
      tags: newNote.tags || ['عام'],
      isPinned: newNote.isPinned || false,
      color: newNote.color || '#fef3c7',
      createdAt: new Date().toISOString(),
    };

    onSaveNote(saved);
    setIsAddNoteModalOpen(false);
    setNewNote({ title: '', content: '', tags: ['عام'], isPinned: false, color: '#fef3c7' });
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Top Header & Switcher */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading font-extrabold text-xl text-stone-900">
          {language === 'ar' ? 'التقارير والملاحظات العامة' : 'Reports & Notes'}
        </h2>
        {activeSubTab === 'notes' && (
          <button
            onClick={() => setIsAddNoteModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ملاحظة جديدة</span>
          </button>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-1.5 border-b border-stone-200 pb-2 text-xs">
        <button
          onClick={() => setActiveSubTab('stats')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors ${
            activeSubTab === 'stats'
              ? 'bg-stone-900 text-white'
              : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>إحصائيات v1.0</span>
        </button>
        <button
          onClick={() => setActiveSubTab('notes')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors ${
            activeSubTab === 'notes'
              ? 'bg-stone-900 text-white'
              : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <StickyNote className="w-4 h-4" />
          <span>الملاحظات العامة والوسوم ({notes.length})</span>
        </button>
      </div>

      {/* TAB 1: STATS */}
      {activeSubTab === 'stats' && (
        <div className="space-y-4">
          {/* Key Metric Highlights */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
              <span className="text-[11px] font-semibold text-stone-500 block">
                معدل إنجاز المهام
              </span>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="font-heading font-extrabold text-2xl text-emerald-700">
                  {taskCompletionRate}%
                </span>
                <span className="text-xs text-stone-400">
                  ({completedTasks} من {totalTasks})
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-full bg-stone-100 rounded-full h-2 mt-3 overflow-hidden">
                <div
                  className="bg-emerald-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${taskCompletionRate}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
              <span className="text-[11px] font-semibold text-stone-500 block">
                متوسط مدة اللقاء
              </span>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="font-heading font-extrabold text-2xl text-stone-900">
                  {avgDuration}
                </span>
                <span className="text-xs text-stone-500">دقيقة / اجتماع</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-700 mt-2">
                <TrendingUp className="w-3 h-3" />
                <span>تركيز عالٍ على القرارات</span>
              </div>
            </div>
          </div>

          {/* Meeting Types Breakdown */}
          <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
            <h3 className="font-heading font-bold text-xs text-stone-900 mb-3">
              توزيع نوعية اللقاءات
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100">
                <span className="text-stone-500 text-[10px] block">وجهاً لوجه</span>
                <span className="font-heading font-bold text-lg text-emerald-900 mt-0.5 block">
                  {meetingTypesCount.in_person}
                </span>
              </div>
              <div className="bg-sky-50/60 p-2.5 rounded-xl border border-sky-100">
                <span className="text-stone-500 text-[10px] block">فيديو مرئي</span>
                <span className="font-heading font-bold text-lg text-sky-900 mt-0.5 block">
                  {meetingTypesCount.video}
                </span>
              </div>
              <div className="bg-amber-50/60 p-2.5 rounded-xl border border-amber-100">
                <span className="text-stone-500 text-[10px] block">اتصال هاتفي</span>
                <span className="font-heading font-bold text-lg text-amber-900 mt-0.5 block">
                  {meetingTypesCount.phone}
                </span>
              </div>
              <div className="bg-purple-50/60 p-2.5 rounded-xl border border-purple-100">
                <span className="text-stone-500 text-[10px] block">مراسلة</span>
                <span className="font-heading font-bold text-lg text-purple-900 mt-0.5 block">
                  {meetingTypesCount.chat}
                </span>
              </div>
            </div>
          </div>

          {/* Top 5 Active Clients */}
          <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
            <h3 className="font-heading font-bold text-xs text-stone-900 mb-3">
              أكثر العملاء تفاعلاً
            </h3>
            <div className="divide-y divide-stone-100 text-xs">
              {clientActivity.slice(0, 5).map((item, idx) => (
                <div key={item.client.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 font-mono text-stone-400 font-bold text-[11px]">{idx + 1}</span>
                    <div className="truncate">
                      <span className="font-semibold text-stone-900 block truncate">{item.client.name}</span>
                      {item.client.company && (
                        <span className="text-[10px] text-stone-500 block truncate">{item.client.company}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-stone-600 shrink-0">
                    <span>{item.meetingsCount} لقاءات</span>
                    <span className="text-emerald-700 font-semibold">• {item.tasksCount} مهام</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GENERAL NOTES */}
      {activeSubTab === 'notes' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="p-4 rounded-2xl border border-stone-200 shadow-2xs space-y-2 relative transition-all hover:border-emerald-300"
                style={{ backgroundColor: note.color || '#fef3c7' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 leading-snug">
                    {note.title}
                  </h4>
                  {note.isPinned && (
                    <Pin className="w-3.5 h-3.5 text-amber-700 shrink-0 fill-amber-700" />
                  )}
                </div>

                <p className="text-xs text-stone-800 leading-relaxed whitespace-pre-line font-sans">
                  {note.content}
                </p>

                <div className="flex items-center justify-between pt-2 border-t border-black/5 text-[10px] text-stone-600">
                  <div className="flex items-center gap-1 flex-wrap">
                    {note.tags.map((tag) => (
                      <span
                        key={tag}
                        className="bg-white/80 px-2 py-0.5 rounded-md border border-black/5 font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => onDeleteNote(note.id)}
                    className="text-stone-400 hover:text-rose-600 transition-colors"
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {isAddNoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto overflow-hidden border border-stone-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4">
              <h3 className="font-heading font-bold text-base text-stone-900">
                إضافة ملاحظة عامة
              </h3>
              <button
                onClick={() => setIsAddNoteModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNoteForm} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  عنوان الملاحظة <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNote.title || ''}
                  onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                  placeholder="مثال: قائمة تحقق لقاءات الاستشارات"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  المحتوى (يدعم Markdown) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={newNote.content || ''}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  placeholder="اكتب بنود الملاحظة هنا..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  لون البطاقة
                </label>
                <div className="flex items-center gap-2">
                  {[
                    { color: '#fef3c7', label: 'كهرماني' },
                    { color: '#e0f2fe', label: 'سماوي' },
                    { color: '#f3e8ff', label: 'بنفسجي' },
                    { color: '#dcfce7', label: 'زمردي' },
                  ].map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      onClick={() => setNewNote({ ...newNote, color: c.color })}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        newNote.color === c.color ? 'scale-110 border-stone-900 shadow-sm' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.color }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="note-pinned"
                  checked={newNote.isPinned || false}
                  onChange={(e) => setNewNote({ ...newNote, isPinned: e.target.checked })}
                  className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-600"
                />
                <label htmlFor="note-pinned" className="font-semibold text-stone-800 cursor-pointer">
                  تثبيت الملاحظة في الأعلى (Pin)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsAddNoteModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-stone-600 hover:bg-stone-100 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-white bg-emerald-700 hover:bg-emerald-800 font-semibold shadow-xs"
                >
                  حفظ الملاحظة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
