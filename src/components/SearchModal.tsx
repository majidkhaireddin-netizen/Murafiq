import React, { useState } from 'react';
import { Client, Meeting, ActionItem, Note } from '../types';
import { universalSearch, formatArabicDate } from '../utils/logic';
import { Search, Users, Calendar, CheckSquare, StickyNote, X, ArrowLeft } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
  };
  onSelectClient: (client: Client) => void;
  onSelectMeeting: (meeting: Meeting) => void;
  onSelectTask: (task: ActionItem) => void;
  language: 'ar' | 'en';
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  data,
  onSelectClient,
  onSelectMeeting,
  onSelectTask,
  language,
}) => {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const results = universalSearch(query, data);
  const totalResults =
    results.clients.length + results.meetings.length + results.tasks.length + results.notes.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 pt-16 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-stone-200 flex flex-col max-h-[80vh]">
        {/* Search Input Bar */}
        <div className="p-3.5 border-b border-stone-200 flex items-center gap-2.5 bg-stone-50">
          <Search className="w-5 h-5 text-stone-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={language === 'ar' ? 'ابحث في العملاء، محاضر اللقاءات، المهام، الملاحظات...' : 'Search clients, meetings, tasks, notes...'}
            className="flex-1 bg-transparent text-sm text-stone-900 placeholder-stone-400 focus:outline-hidden"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-stone-400 hover:text-stone-600 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-200 rounded-lg"
          >
            إغلاق
          </button>
        </div>

        {/* Results Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
          {!query.trim() ? (
            <div className="text-center py-8 text-stone-400">
              <p>اكتب أي كلمة للبحث الفوري في كافة عناصر مرافق</p>
              <p className="text-[11px] mt-1 text-stone-400">جرب البحث عن: &quot;عقد&quot;، &quot;أحمد&quot;، &quot;تصميم&quot;، أو &quot;فاتورة&quot;</p>
            </div>
          ) : totalResults === 0 ? (
            <div className="text-center py-8 text-stone-400">
              لا توجد نتائج مطابقة لـ &quot;{query}&quot;
            </div>
          ) : (
            <>
              {/* Clients Results */}
              {results.clients.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-bold text-stone-600 flex items-center gap-1.5 text-[11px]">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    <span>العملاء ({results.clients.length})</span>
                  </span>
                  <div className="space-y-1">
                    {results.clients.map((client) => (
                      <div
                        key={client.id}
                        onClick={() => {
                          onSelectClient(client);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-stone-900 block">{client.name}</span>
                          {client.company && (
                            <span className="text-[11px] text-stone-500">{client.company}</span>
                          )}
                        </div>
                        <ArrowLeft className="w-3.5 h-3.5 text-stone-400 rtl:rotate-0 ltr:rotate-180" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meetings Results */}
              {results.meetings.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-bold text-stone-600 flex items-center gap-1.5 text-[11px]">
                    <Calendar className="w-3.5 h-3.5 text-sky-600" />
                    <span>اللقاءات والمحاضر ({results.meetings.length})</span>
                  </span>
                  <div className="space-y-1">
                    {results.meetings.map((meeting) => (
                      <div
                        key={meeting.id}
                        onClick={() => {
                          onSelectMeeting(meeting);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-stone-900 block">{meeting.title}</span>
                          <span className="text-[11px] text-stone-500">
                            {formatArabicDate(meeting.dateTime)}
                          </span>
                        </div>
                        <ArrowLeft className="w-3.5 h-3.5 text-stone-400 rtl:rotate-0 ltr:rotate-180" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks Results */}
              {results.tasks.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-bold text-stone-600 flex items-center gap-1.5 text-[11px]">
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
                    <span>المهام والمتابعات ({results.tasks.length})</span>
                  </span>
                  <div className="space-y-1">
                    {results.tasks.map((task) => (
                      <div
                        key={task.id}
                        onClick={() => {
                          onSelectTask(task);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-stone-900 block">{task.title}</span>
                          {task.dueDate && (
                            <span className="text-[11px] text-stone-500">
                              الموعد: {formatArabicDate(task.dueDate)}
                            </span>
                          )}
                        </div>
                        <ArrowLeft className="w-3.5 h-3.5 text-stone-400 rtl:rotate-0 ltr:rotate-180" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes Results */}
              {results.notes.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-bold text-stone-600 flex items-center gap-1.5 text-[11px]">
                    <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                    <span>الملاحظات ({results.notes.length})</span>
                  </span>
                  <div className="space-y-1">
                    {results.notes.map((note) => (
                      <div
                        key={note.id}
                        className="p-2.5 rounded-xl border border-stone-200 bg-amber-50/40"
                      >
                        <span className="font-bold text-stone-900 block">{note.title}</span>
                        <p className="text-[11px] text-stone-600 line-clamp-2 mt-0.5 font-sans">
                          {note.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
