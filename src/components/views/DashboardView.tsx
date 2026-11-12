import React from 'react';
import { Client, Meeting, ActionItem, Note } from '../../types';
import { formatArabicDate, getHijriDateString, getRelativeTimeArabic, categorizeTasks, detectClientsNeedingReview } from '../../utils/logic';
import { ProvenanceBadge } from '../ProvenanceBadge';
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Video,
  Phone,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

interface DashboardViewProps {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  onSelectMeeting: (meeting: Meeting) => void;
  onSelectClient: (client: Client) => void;
  onToggleTask: (taskId: string) => void;
  onNewMeeting: (preselectedClientId?: string) => void;
  onNewTask: () => void;
  onNewClient: () => void;
  onGoToTab: (tab: any) => void;
  showHijri: boolean;
  language: 'ar' | 'en';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  meetings,
  tasks,
  notes,
  onSelectMeeting,
  onSelectClient,
  onToggleTask,
  onNewMeeting,
  onNewTask,
  onNewClient,
  onGoToTab,
  showHijri,
  language,
}) => {
  const now = new Date();
  const dateFormatted = formatArabicDate(now.toISOString());
  const hijriFormatted = getHijriDateString(now.toISOString());

  // Task categories
  const { overdue, today } = categorizeTasks(tasks);

  // Next 7 days upcoming meetings
  const upcomingMeetings = meetings
    .filter((m) => {
      const mDate = new Date(m.dateTime);
      const diffMs = mDate.getTime() - now.getTime();
      return diffMs >= -3600000 && diffMs <= 7 * 24 * 3600000;
    })
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  // Completed tasks count
  const completedTasksCount = tasks.filter((t) => t.status === 'completed').length;

  // Intelligent check: clients with no meeting in >30 days
  const inactiveClients = detectClientsNeedingReview(clients, meetings, 30);
  const topInactive = inactiveClients.length > 0 ? inactiveClients[0] : null;

  const getMeetingTypeBadge = (type: string) => {
    switch (type) {
      case 'in_person':
        return { label: 'وجهاً لوجه', icon: MapPin, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      case 'video':
        return { label: 'فيديو', icon: Video, color: 'text-sky-700 bg-sky-50 border-sky-200' };
      case 'phone':
        return { label: 'هاتف', icon: Phone, color: 'text-amber-700 bg-amber-50 border-amber-200' };
      default:
        return { label: 'مراسلة', icon: MessageSquare, color: 'text-purple-700 bg-purple-50 border-purple-200' };
    }
  };

  return (
    <div className="space-y-5 pb-6">
      {/* Welcome & Date Header */}
      <div className="bg-gradient-to-l from-emerald-800 to-teal-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 space-y-1">
          <div className="flex items-center justify-between text-xs text-emerald-200/90 font-medium">
            <span>{dateFormatted}</span>
            {showHijri && (
              <span className="bg-emerald-700/50 px-2 py-0.5 rounded-full border border-emerald-600/40 text-[11px]">
                {hijriFormatted}
              </span>
            )}
          </div>
          <h2 className="font-heading font-extrabold text-xl sm:text-2xl pt-1">
            {language === 'ar' ? 'أهلاً بك، جاهز للقاءات اليوم؟' : 'Welcome, ready for today?'}
          </h2>
          <p className="text-xs text-emerald-100/80 max-w-md leading-relaxed">
            {upcomingMeetings.length > 0
              ? `لديك ${upcomingMeetings.length} لقاءات مجدولة خلال الأيام القادمة، و${overdue.length + today.length} مهام تتطلب اهتمامك.`
              : 'لا توجد لقاءات ملحة اليوم. وقت ممتاز للمتابعة وترتيب الأولويات.'}
          </p>
        </div>

        {/* Subtle decorative geometry */}
        <div className="absolute -bottom-8 -left-8 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute top-0 right-1/3 w-28 h-28 bg-teal-400/10 rounded-full blur-xl pointer-events-none" />
      </div>

      {/* Mini Stats Bar */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-white rounded-xl p-3 border border-stone-200 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-medium text-stone-500">لقاءات هذا الشهر</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-heading font-bold text-xl text-stone-900">{meetings.length}</span>
            <span className="text-[10px] text-emerald-600 font-medium flex items-center">
              <TrendingUp className="w-2.5 h-2.5 inline" /> +2
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3 border border-stone-200 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-medium text-stone-500">مهام منجزة</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-heading font-bold text-xl text-emerald-700">{completedTasksCount}</span>
            <span className="text-[10px] text-stone-400">من {tasks.length}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3 border border-stone-200 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-medium text-stone-500">عملاء نشطون</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-heading font-bold text-xl text-stone-900">{clients.length}</span>
            <span className="text-[10px] text-emerald-600 font-medium flex items-center">
              <UserCheck className="w-2.5 h-2.5 inline" /> 100%
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action Shortcuts */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => onNewMeeting()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs shrink-0 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>لقاء جديد</span>
        </button>
        <button
          onClick={onNewTask}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white text-stone-800 hover:bg-stone-50 border border-stone-200 shadow-xs shrink-0 transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-stone-500" />
          <span>مهمة متابعة</span>
        </button>
        <button
          onClick={onNewClient}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white text-stone-800 hover:bg-stone-50 border border-stone-200 shadow-xs shrink-0 transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-stone-500" />
          <span>جهة اتصال</span>
        </button>
      </div>

      {/* Proactive Lightweight Intelligence Alert (Rule: AI embedded into workflow, calm & assistive) */}
      {topInactive && (
        <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-3.5 flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-amber-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-heading font-bold text-xs text-amber-950">
                تنبيه ذكي: فرصة للمتابعة والتواصل
              </h4>
              <ProvenanceBadge type="ai_suggested" showText={false} />
            </div>
            <p className="text-[12px] text-amber-900 mt-0.5 leading-relaxed">
              لم تسجل أي لقاء مع <span className="font-bold">{topInactive.client.name}</span> منذ{' '}
              <span className="font-semibold">{topInactive.daysSinceLastMeeting} يوماً</span>. هل تود جدولة مكالمة متابعة سريعة؟
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onNewMeeting(topInactive.client.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-800 text-white hover:bg-amber-900 transition-colors"
              >
                جدولة لقاء مع العميل
              </button>
              <button
                onClick={() => onSelectClient(topInactive.client)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-amber-900 hover:bg-amber-100/80 transition-colors"
              >
                فتح بطاقة العميل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Meetings (Next 7 Days) */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-700" />
            <h3 className="font-heading font-bold text-sm text-stone-900">
              اللقاءات القادمة (خلال 7 أيام)
            </h3>
            <span className="text-[11px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full font-medium">
              {upcomingMeetings.length}
            </span>
          </div>
          <button
            onClick={() => onGoToTab('meetings')}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5"
          >
            <span>عرض الكل</span>
            <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </div>

        {upcomingMeetings.length === 0 ? (
          <div className="text-center py-6 text-stone-400 text-xs">
            لا توجد لقاءات قادمة خلال الأيام السبعة القادمة.
          </div>
        ) : (
          <div className="space-y-2.5">
            {upcomingMeetings.map((meeting) => {
              const client = clients.find((c) => c.id === meeting.clientId);
              const typeBadge = getMeetingTypeBadge(meeting.type);
              const relativeTime = getRelativeTimeArabic(meeting.dateTime);
              const Icon = typeBadge.icon;

              return (
                <div
                  key={meeting.id}
                  onClick={() => onSelectMeeting(meeting)}
                  className="group p-3 rounded-xl border border-stone-200/80 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all cursor-pointer flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {/* Client initial / avatar */}
                    {client?.avatarPath ? (
                      <img
                        src={client.avatarPath}
                        alt={client.name}
                        className="w-9 h-9 rounded-xl object-cover border border-stone-200 shrink-0"
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-xl text-white flex items-center justify-center font-bold text-xs shrink-0"
                        style={{ backgroundColor: client?.color || '#059669' }}
                      >
                        {client?.name ? client.name.charAt(0) : 'ع'}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-heading font-bold text-xs text-stone-900 group-hover:text-emerald-800 truncate">
                          {meeting.title}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeBadge.color}`}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          <span>{typeBadge.label}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-stone-500 flex-wrap">
                        <span className="font-medium text-stone-700">{client?.name}</span>
                        {client?.company && <span>• {client.company}</span>}
                        {meeting.location && (
                          <span className="truncate max-w-[160px]">
                            • {meeting.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Relative date pill */}
                  <div className="text-end shrink-0">
                    <span className="inline-block text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/70">
                      {relativeTime}
                    </span>
                    <span className="block text-[10px] text-stone-400 mt-1">
                      {new Date(meeting.dateTime).toLocaleTimeString('ar-SA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Urgent & Overdue Tasks */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <h3 className="font-heading font-bold text-sm text-stone-900">
              المهام العاجلة ومتابعات اليوم
            </h3>
            {(overdue.length > 0 || today.length > 0) && (
              <span className="text-[11px] bg-rose-50 text-rose-700 border border-rose-200/80 px-2 py-0.5 rounded-full font-bold">
                {overdue.length + today.length}
              </span>
            )}
          </div>
          <button
            onClick={() => onGoToTab('tasks')}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5"
          >
            <span>عرض كل المهام</span>
            <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </div>

        {overdue.length === 0 && today.length === 0 ? (
          <div className="text-center py-6 text-stone-400 text-xs">
            ممتاز! لا توجد مهام متأخرة أو مستحقة اليوم.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Overdue Items */}
            {overdue.map((task) => {
              const client = clients.find((c) => c.id === task.clientId);
              return (
                <div
                  key={task.id}
                  className="p-2.5 rounded-xl border border-rose-200 bg-rose-50/40 flex items-start gap-2.5 transition-colors"
                >
                  <button
                    onClick={() => onToggleTask(task.id)}
                    className="w-5 h-5 rounded-md border-2 border-rose-400 hover:border-emerald-600 hover:bg-emerald-50 mt-0.5 shrink-0 flex items-center justify-center transition-colors"
                    aria-label="Mark task done"
                  >
                    {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-xs text-stone-900 leading-tight">
                        {task.title}
                      </span>
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100/90 px-1.5 py-0.2 rounded">
                        متأخرة ({getRelativeTimeArabic(task.dueDate || '')})
                      </span>
                      <ProvenanceBadge type={task.provenance} showText={false} />
                    </div>
                    {client && (
                      <span className="text-[11px] text-stone-500 block mt-0.5">
                        العميل: {client.name}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Today Items */}
            {today.map((task) => {
              const client = clients.find((c) => c.id === task.clientId);
              return (
                <div
                  key={task.id}
                  className="p-2.5 rounded-xl border border-amber-200/80 bg-amber-50/30 flex items-start gap-2.5 transition-colors"
                >
                  <button
                    onClick={() => onToggleTask(task.id)}
                    className="w-5 h-5 rounded-md border-2 border-stone-300 hover:border-emerald-600 hover:bg-emerald-50 mt-0.5 shrink-0 flex items-center justify-center transition-colors"
                    aria-label="Mark task done"
                  >
                    {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-xs text-stone-900 leading-tight">
                        {task.title}
                      </span>
                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded">
                        مستحقة اليوم
                      </span>
                      <ProvenanceBadge type={task.provenance} showText={false} />
                    </div>
                    {client && (
                      <span className="text-[11px] text-stone-500 block mt-0.5">
                        العميل: {client.name}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Meetings Recap (Last 5) */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
        <h3 className="font-heading font-bold text-sm text-stone-900 mb-3">
          آخر اللقاءات المنجزة
        </h3>
        <div className="divide-y divide-stone-100">
          {meetings
            .filter((m) => m.status === 'completed')
            .slice(0, 3)
            .map((meeting) => {
              const client = clients.find((c) => c.id === meeting.clientId);
              return (
                <div
                  key={meeting.id}
                  onClick={() => onSelectMeeting(meeting)}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between cursor-pointer group"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-stone-800 group-hover:text-emerald-700 truncate">
                      {meeting.title}
                    </p>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {client?.name} • {formatArabicDate(meeting.dateTime)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-stone-400 group-hover:text-emerald-700">
                    <span>محضر اللقاء</span>
                    <ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" />
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
