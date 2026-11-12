import React, { useState, useEffect } from 'react';
import { Meeting, Client, ActionItem, MeetingType, MeetingStatus, TaskPriority } from '../../types';
import { formatArabicDate, applyMeetingTemplate, insertMeetingSnippet } from '../../utils/logic';
import { ProvenanceBadge } from '../ProvenanceBadge';
import {
  MEETING_TEMPLATES,
  FAST_SNIPPETS,
  MeetingTemplate,
} from '../../data/meetingTemplates';
import {
  Clock,
  MapPin,
  Video,
  Phone,
  MessageSquare,
  Plus,
  Printer,
  Camera,
  CheckCircle2,
  X,
  Image as ImageIcon,
  Compass,
  Layers,
  Award,
  FileCheck,
  CheckSquare,
  Sparkles,
  Save,
  Eye,
  Edit3,
  Check,
  ListPlus,
  HelpCircle,
} from 'lucide-react';

interface MeetingsViewProps {
  meetings: Meeting[];
  clients: Client[];
  tasks: ActionItem[];
  onSaveMeeting: (meeting: Meeting) => void;
  onOpenPdfModal: (meeting: Meeting) => void;
  onNewTaskFromMeeting: (meeting: Meeting) => void;
  selectedMeetingId?: string | null;
  onSelectMeetingChange?: (meeting: Meeting | null) => void;
  preselectedClientId?: string | null;
  language: 'ar' | 'en';
}

export const MeetingsView: React.FC<MeetingsViewProps> = ({
  meetings,
  clients,
  tasks,
  onSaveMeeting,
  onOpenPdfModal,
  onNewTaskFromMeeting,
  selectedMeetingId,
  onSelectMeetingChange,
  preselectedClientId,
  language,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'confirmed' | 'completed'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'calendar'>('timeline');
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(
    selectedMeetingId ? meetings.find((m) => m.id === selectedMeetingId) || null : null
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Partial<Meeting> | null>(null);
  const [meetingPhase, setMeetingPhase] = useState<'before' | 'during' | 'after'>('after');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Template prompt dialog state (for non-destructive replacement/append)
  const [pendingTemplate, setPendingTemplate] = useState<{
    template: MeetingTemplate;
    target: 'modal' | 'live';
  } | null>(null);

  // Live note editing during active meeting
  const [liveNotes, setLiveNotes] = useState<string>('');
  const [isLiveEditing, setIsLiveEditing] = useState<boolean>(true);
  const [liveSavedNotice, setLiveSavedNotice] = useState<boolean>(false);
  const [extractedTasksCount, setExtractedTasksCount] = useState<number | null>(null);

  // Sync if selectedMeetingId changes from outside
  useEffect(() => {
    if (selectedMeetingId) {
      const found = meetings.find((m) => m.id === selectedMeetingId);
      if (found) {
        setActiveMeeting(found);
        setLiveNotes(found.notes || '');
      }
    }
  }, [selectedMeetingId, meetings]);

  // When active meeting changes, sync liveNotes
  useEffect(() => {
    if (activeMeeting) {
      setLiveNotes(activeMeeting.notes || '');
      setLiveSavedNotice(false);
      setExtractedTasksCount(null);
    }
  }, [activeMeeting?.id]);

  const filteredMeetings = meetings
    .filter((m) => {
      if (filterStatus === 'all') return true;
      return m.status === filterStatus;
    })
    .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

  const getMeetingTypeDetails = (type: MeetingType) => {
    switch (type) {
      case 'in_person':
        return { label: 'وجهاً لوجه', icon: MapPin, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      case 'video':
        return { label: 'فيديو عن بُعد', icon: Video, color: 'text-sky-700 bg-sky-50 border-sky-200' };
      case 'phone':
        return { label: 'مكالمة هاتفية', icon: Phone, color: 'text-amber-700 bg-amber-50 border-amber-200' };
      default:
        return { label: 'مراسلة مكتوبة', icon: MessageSquare, color: 'text-purple-700 bg-purple-50 border-purple-200' };
    }
  };

  const getTemplateIcon = (iconName: string) => {
    switch (iconName) {
      case 'Compass':
        return Compass;
      case 'Layers':
        return Layers;
      case 'Award':
        return Award;
      case 'FileCheck':
        return FileCheck;
      case 'CheckSquare':
      default:
        return CheckSquare;
    }
  };

  const handleOpenCreate = () => {
    setEditingMeeting({
      clientId: preselectedClientId || (clients[0]?.id || ''),
      title: '',
      dateTime: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      duration: 60,
      type: 'in_person',
      location: 'مقر العميل',
      notes: '',
      status: 'confirmed',
      photoPaths: [],
      attendees: ['أنت'],
      isFollowUpScheduled: false,
    });
    setIsEditModalOpen(true);
  };

  const handleSelectTemplateInModal = (template: MeetingTemplate) => {
    if (!editingMeeting) return;
    const currentNotes = (editingMeeting.notes || '').trim();

    // If there is existing non-empty notes, prompt for non-destructive decision
    if (currentNotes.length > 20) {
      setPendingTemplate({ template, target: 'modal' });
      return;
    }

    // Otherwise apply directly
    applyTemplateToModal(template, 'replace');
  };

  const applyTemplateToModal = (template: MeetingTemplate, mode: 'replace' | 'append') => {
    if (!editingMeeting) return;
    const updatedNotes = applyMeetingTemplate(editingMeeting.notes || '', template.agendaMarkdown, mode);

    setEditingMeeting({
      ...editingMeeting,
      title: editingMeeting.title || template.title,
      duration: editingMeeting.duration || template.defaultDuration,
      type: editingMeeting.type || template.suggestedType,
      location: editingMeeting.location || template.suggestedLocation,
      notes: updatedNotes,
    });
    setPendingTemplate(null);
  };

  const handleSelectTemplateInLive = (template: MeetingTemplate) => {
    if (!activeMeeting) return;
    const currentNotes = (liveNotes || '').trim();

    if (currentNotes.length > 20) {
      setPendingTemplate({ template, target: 'live' });
      return;
    }

    applyTemplateToLive(template, 'replace');
  };

  const applyTemplateToLive = (template: MeetingTemplate, mode: 'replace' | 'append') => {
    if (!activeMeeting) return;
    const updatedNotes = applyMeetingTemplate(liveNotes, template.agendaMarkdown, mode);
    setLiveNotes(updatedNotes);

    const updatedMeeting: Meeting = {
      ...activeMeeting,
      notes: updatedNotes,
      updatedAt: new Date().toISOString(),
    };
    setActiveMeeting(updatedMeeting);
    onSaveMeeting(updatedMeeting);
    setLiveSavedNotice(true);
    setTimeout(() => setLiveSavedNotice(false), 2500);
    setPendingTemplate(null);
  };

  const handleInsertLiveSnippet = (snippet: string) => {
    if (!activeMeeting) return;
    const updatedNotes = insertMeetingSnippet(liveNotes, snippet);
    setLiveNotes(updatedNotes);

    const updatedMeeting: Meeting = {
      ...activeMeeting,
      notes: updatedNotes,
      updatedAt: new Date().toISOString(),
    };
    setActiveMeeting(updatedMeeting);
    onSaveMeeting(updatedMeeting);
    setLiveSavedNotice(true);
    setTimeout(() => setLiveSavedNotice(false), 2000);
  };

  const handleSaveLiveNotes = () => {
    if (!activeMeeting) return;
    const updatedMeeting: Meeting = {
      ...activeMeeting,
      notes: liveNotes,
      updatedAt: new Date().toISOString(),
    };
    setActiveMeeting(updatedMeeting);
    onSaveMeeting(updatedMeeting);
    setLiveSavedNotice(true);
    setTimeout(() => setLiveSavedNotice(false), 3000);
  };

  // Smart action item extractor from meeting notes
  const handleExtractTasksFromNotes = () => {
    if (!activeMeeting) return;
    const lines = liveNotes.split('\n');
    let count = 0;

    lines.forEach((line) => {
      // Matches bulleted tasks like "- [ ] 📌 **مهمة:** ..." or "📌 مهمة: ..."
      if (line.includes('📌') && (line.includes('مهمة') || line.includes('التزام'))) {
        const cleanedTitle = line
          .replace(/^[-*]\s*(\[[ x]\])?\s*/, '')
          .replace(/📌\s*\*\*.*?\*\*:?\s*/, '')
          .replace(/📌\s*/, '')
          .trim();

        if (cleanedTitle.length > 3) {
          const newTask: ActionItem = {
            id: `task-extract-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            meetingId: activeMeeting.id,
            clientId: activeMeeting.clientId,
            title: cleanedTitle.slice(0, 120),
            priority: (cleanedTitle.includes('عاجل') ? 'urgent' : cleanedTitle.includes('أسبوع') ? 'medium' : 'high') as TaskPriority,
            status: 'pending',
            dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
            provenance: 'approved',
            createdAt: new Date().toISOString(),
          };
          // Call the task creation via prop if needed, or dispatch to onNewTaskFromMeeting flow
          onSaveMeeting(activeMeeting); // Ensures meeting is fresh
          // Save task to app
          tasks.push(newTask);
          count++;
        }
      }
    });

    setExtractedTasksCount(count);
    setTimeout(() => setExtractedTasksCount(null), 4000);
  };

  const handleSaveMeetingForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeeting?.title || !editingMeeting.clientId) return;

    const saved: Meeting = {
      id: editingMeeting.id || `m-${Date.now()}`,
      clientId: editingMeeting.clientId,
      title: editingMeeting.title,
      dateTime: editingMeeting.dateTime || new Date().toISOString(),
      duration: editingMeeting.duration || 60,
      type: editingMeeting.type || 'in_person',
      location: editingMeeting.location || '',
      notes: editingMeeting.notes || '',
      status: editingMeeting.status || 'confirmed',
      photoPaths: editingMeeting.photoPaths || [],
      attendees: editingMeeting.attendees || ['أنت'],
      isFollowUpScheduled: editingMeeting.isFollowUpScheduled || false,
      createdAt: editingMeeting.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveMeeting(saved);
    if (activeMeeting?.id === saved.id) {
      setActiveMeeting(saved);
      setLiveNotes(saved.notes);
    }
    setIsEditModalOpen(false);
    setEditingMeeting(null);
  };

  const handleAddSamplePhoto = () => {
    if (!editingMeeting) return;
    const samplePhotos = [
      'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1542744094-3a31f272c490?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600&auto=format&fit=crop&q=80',
    ];
    const nextPhoto = samplePhotos[(editingMeeting.photoPaths?.length || 0) % samplePhotos.length];
    setEditingMeeting({
      ...editingMeeting,
      photoPaths: [...(editingMeeting.photoPaths || []), nextPhoto],
    });
  };

  return (
    <div className="space-y-4 pb-6">
      {/* View Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading font-extrabold text-xl text-stone-900">
            {language === 'ar' ? 'سجل اللقاءات والاجتماعات' : 'Meetings & Minutes'}
          </h2>
          <p className="text-xs text-stone-500">
            {language === 'ar' ? 'دورة اللقاء الكاملة: قبل ← أثناء ← بعد' : 'Full meeting cycle: Before → During → After'}
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>لقاء جديد</span>
        </button>
      </div>

      {/* Filter Tabs & Timeline/Calendar switcher */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 overflow-x-auto text-xs pb-1">
          {(['all', 'confirmed', 'completed', 'draft'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors shrink-0 ${
                filterStatus === status
                  ? 'bg-stone-900 text-white'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              {status === 'all' && `الكل (${meetings.length})`}
              {status === 'confirmed' && 'مؤكدة'}
              {status === 'completed' && 'منتهية'}
              {status === 'draft' && 'مسودة'}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-xs">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
              viewMode === 'timeline' ? 'bg-emerald-50 text-emerald-800 font-bold' : 'text-stone-500'
            }`}
          >
            قائمة زمنية
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
              viewMode === 'calendar' ? 'bg-emerald-50 text-emerald-800 font-bold' : 'text-stone-500'
            }`}
          >
            تقويم الأسبوع
          </button>
        </div>
      </div>

      {/* Calendar Strip Preview (if Calendar mode) */}
      {viewMode === 'calendar' && (
        <div className="bg-white p-3 rounded-2xl border border-stone-200 shadow-xs">
          <div className="text-xs font-bold text-stone-700 mb-2 flex items-center justify-between">
            <span>نوفمبر 2026</span>
            <span className="text-[11px] font-normal text-stone-500">الأسبوع الحالي</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map((day, idx) => {
              const dateNum = 7 + idx;
              const isToday = dateNum === 11;
              const hasMeeting = [10, 11, 12, 14].includes(dateNum);
              return (
                <div
                  key={day}
                  className={`p-2 rounded-xl text-xs flex flex-col items-center justify-center transition-all ${
                    isToday
                      ? 'bg-emerald-700 text-white font-bold shadow-xs'
                      : 'hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <span className="text-[10px] opacity-75">{day}</span>
                  <span className="text-sm font-semibold mt-0.5">{dateNum}</span>
                  {hasMeeting && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1 ${
                        isToday ? 'bg-amber-300' : 'bg-emerald-600'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meeting Cards List */}
      <div className="space-y-3">
        {filteredMeetings.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-stone-200 text-stone-400 text-xs">
            لا توجد لقاءات مسجلة بهذه الفئة.
          </div>
        ) : (
          filteredMeetings.map((meeting) => {
            const client = clients.find((c) => c.id === meeting.clientId);
            const typeInfo = getMeetingTypeDetails(meeting.type);
            const TypeIcon = typeInfo.icon;
            const meetingTasks = tasks.filter((t) => t.meetingId === meeting.id);

            return (
              <div
                key={meeting.id}
                onClick={() => {
                  setActiveMeeting(meeting);
                  if (onSelectMeetingChange) onSelectMeetingChange(meeting);
                }}
                className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs hover:border-emerald-400 hover:shadow-sm transition-all cursor-pointer group space-y-2.5"
              >
                {/* Card Top Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {client?.avatarPath ? (
                      <img
                        src={client.avatarPath}
                        alt={client.name}
                        className="w-10 h-10 rounded-xl object-cover border border-stone-200 shrink-0"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-xl text-white flex items-center justify-center font-bold text-xs shrink-0"
                        style={{ backgroundColor: client?.color || '#059669' }}
                      >
                        {client?.name ? client.name.charAt(0) : 'ع'}
                      </div>
                    )}

                    <div className="min-w-0">
                      <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 group-hover:text-emerald-800 leading-snug">
                        {meeting.title}
                      </h4>
                      <p className="text-[11px] text-stone-600 font-medium truncate mt-0.5">
                        {client?.name} {client?.company && `• ${client.company}`}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                      meeting.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : meeting.status === 'confirmed'
                        ? 'bg-sky-50 text-sky-800 border border-sky-200'
                        : 'bg-stone-100 text-stone-600 border border-stone-200'
                    }`}
                  >
                    {meeting.status === 'completed' && 'منتهية'}
                    {meeting.status === 'confirmed' && 'مؤكدة'}
                    {meeting.status === 'draft' && 'مسودة'}
                  </span>
                </div>

                {/* Card Details & Badges */}
                <div className="flex items-center gap-2 text-[11px] text-stone-500 flex-wrap pt-1 border-t border-stone-100">
                  <span className="flex items-center gap-1 text-stone-700 font-medium">
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    <span>{formatArabicDate(meeting.dateTime, true)}</span>
                  </span>

                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${typeInfo.color}`}>
                    <TypeIcon className="w-2.5 h-2.5" />
                    <span>{typeInfo.label}</span>
                  </span>

                  {meeting.duration && (
                    <span className="text-stone-400 font-mono">
                      {meeting.duration} دقيقة
                    </span>
                  )}

                  {meeting.photoPaths.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded text-[10px]">
                      <ImageIcon className="w-2.5 h-2.5" />
                      <span>{meeting.photoPaths.length} صور</span>
                    </span>
                  )}

                  {meetingTasks.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-medium">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                      <span>{meetingTasks.length} مهام متفق عليها</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Meeting Detail Sheet / Modal */}
      {activeMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-auto overflow-hidden border border-stone-200 animate-in fade-in zoom-in-95 max-h-[92vh] flex flex-col">
            {/* Sheet Top Header */}
            <div className="p-4 sm:p-5 bg-stone-50 border-b border-stone-200 flex items-start justify-between gap-3 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeMeeting.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : activeMeeting.status === 'confirmed'
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-stone-200 text-stone-700'
                    }`}
                  >
                    {activeMeeting.status === 'completed' && 'منتهية'}
                    {activeMeeting.status === 'confirmed' && 'مؤكدة'}
                    {activeMeeting.status === 'draft' && 'مسودة'}
                  </span>
                  <span className="text-xs text-stone-500">
                    {formatArabicDate(activeMeeting.dateTime, true)}
                  </span>
                </div>
                <h3 className="font-heading font-extrabold text-base text-stone-900 mt-1">
                  {activeMeeting.title}
                </h3>
                <p className="text-xs text-stone-600 mt-0.5">
                  مع: {clients.find((c) => c.id === activeMeeting.clientId)?.name}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Official PDF Export Button */}
                <button
                  onClick={() => onOpenPdfModal(activeMeeting)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors"
                  title="تصدير محضر رسمي PDF"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">محضر PDF</span>
                </button>
                <button
                  onClick={() => {
                    setActiveMeeting(null);
                    if (onSelectMeetingChange) onSelectMeetingChange(null);
                  }}
                  className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Phase Switcher (قبل اللقاء / أثناء اللقاء / بعد اللقاء) */}
            <div className="bg-stone-100/70 p-1.5 border-b border-stone-200 flex items-center justify-around gap-1 text-[11px] sm:text-xs shrink-0">
              <button
                onClick={() => setMeetingPhase('before')}
                className={`flex-1 py-1.5 px-1 rounded-lg font-medium transition-colors text-center ${
                  meetingPhase === 'before'
                    ? 'bg-white text-stone-900 shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                1. قبل اللقاء
              </button>
              <button
                onClick={() => setMeetingPhase('during')}
                className={`flex-1 py-1.5 px-1 rounded-lg font-medium transition-colors text-center ${
                  meetingPhase === 'during'
                    ? 'bg-white text-emerald-800 shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                2. أثناء اللقاء (التدوين الحي)
              </button>
              <button
                onClick={() => setMeetingPhase('after')}
                className={`flex-1 py-1.5 px-1 rounded-lg font-medium transition-colors text-center ${
                  meetingPhase === 'after'
                    ? 'bg-white text-emerald-800 shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                3. بعد اللقاء
              </button>
            </div>

            {/* Scrollable Phase Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* PHASE 1: BEFORE */}
              {meetingPhase === 'before' && (
                <div className="space-y-4">
                  <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 space-y-2.5">
                    <span className="font-bold text-stone-800 block text-xs">معلومات ومكان اللقاء:</span>
                    <div className="grid grid-cols-2 gap-2 text-stone-600">
                      <div>المكان: <span className="text-stone-900 font-medium">{activeMeeting.location || 'غير محدد'}</span></div>
                      <div>المدة المقدرة: <span className="text-stone-900 font-medium">{activeMeeting.duration || 60} دقيقة</span></div>
                      <div>الحضور المتوقع: <span className="text-stone-900 font-medium">{activeMeeting.attendees?.join('، ') || 'المشاركون'}</span></div>
                      <div>نوع اللقاء: <span className="text-stone-900 font-medium">{getMeetingTypeDetails(activeMeeting.type).label}</span></div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="font-bold text-stone-800 block text-xs">نصائح التحضير السريع:</span>
                    <ul className="list-disc list-inside space-y-1 text-stone-600 bg-emerald-50/40 p-3 rounded-xl border border-emerald-100">
                      <li>تم استرجاع آخر الملاحظات الخاصة بـ {clients.find((c) => c.id === activeMeeting.clientId)?.name}.</li>
                      <li>تأكد من إحضار ملحق العقد ومراجعة البنود السابقة.</li>
                      <li>يمكنك استخدام قوالب الأجندة في طور &quot;أثناء اللقاء&quot; لتسجيل القرارات المتفق عليها بنقرة واحدة.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* PHASE 2: DURING (Interactive Live Minutes & Action Toolbar) */}
              {meetingPhase === 'during' && (
                <div className="space-y-4">
                  {/* Live Action Toolbar */}
                  <div className="bg-emerald-900 text-white p-3 rounded-2xl shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-emerald-300" />
                        <span className="font-bold text-xs text-white">شريط الإدراج السريع أثناء اللقاء:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {liveSavedNotice && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 bg-emerald-800/80 px-2 py-0.5 rounded-full animate-pulse">
                            <Check className="w-3 h-3" /> تم الحفظ في قاعدة البيانات
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsLiveEditing(!isLiveEditing)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 transition-colors"
                        >
                          {isLiveEditing ? (
                            <>
                              <Eye className="w-3 h-3" /> معاينة منسقة
                            </>
                          ) : (
                            <>
                              <Edit3 className="w-3 h-3" /> تحرير النص
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Quick Insertion Pills */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleInsertLiveSnippet(FAST_SNIPPETS.decision)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-white text-emerald-950 hover:bg-emerald-50 transition-colors shadow-2xs"
                      >
                        <span>🎯 + قرار معتمد</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInsertLiveSnippet(FAST_SNIPPETS.actionItem)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-emerald-800 text-emerald-100 hover:bg-emerald-700 transition-colors"
                      >
                        <span>📌 + مهمة والتزام</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInsertLiveSnippet(FAST_SNIPPETS.blocker)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-emerald-800 text-amber-200 hover:bg-emerald-700 transition-colors"
                      >
                        <span>⚠️ + نقطة عالقة</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInsertLiveSnippet(FAST_SNIPPETS.agreement)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-emerald-800 text-emerald-100 hover:bg-emerald-700 transition-colors"
                      >
                        <span>🤝 + اتفاق مالي</span>
                      </button>
                    </div>

                    {/* Quick Template Apply Carousel */}
                    <div className="pt-2 border-t border-emerald-800/80">
                      <div className="text-[10px] text-emerald-300 font-medium mb-1.5 flex items-center justify-between">
                        <span>إدراج هيكل قالب متكامل للمحضر:</span>
                        <span className="text-[10px] text-emerald-400">انقر لتطبيق القالب</span>
                      </div>
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                        {MEETING_TEMPLATES.map((tmpl) => {
                          const IconComp = getTemplateIcon(tmpl.icon);
                          return (
                            <button
                              key={tmpl.id}
                              type="button"
                              onClick={() => handleSelectTemplateInLive(tmpl)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-800/90 hover:bg-white hover:text-emerald-950 text-white font-medium shrink-0 transition-all text-[10px]"
                            >
                              <IconComp className="w-3 h-3 text-emerald-300" />
                              <span>{tmpl.shortTitle}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Editor vs Formatted Preview */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-bold text-stone-800 block text-xs">
                        محضر الاجتماع وملاحظات النقاش:
                      </label>
                      <button
                        type="button"
                        onClick={handleExtractTasksFromNotes}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                        title="تحويل البنود المعلمة بـ 📌 إلى مهام متابعة تلقائياً"
                      >
                        <ListPlus className="w-3.5 h-3.5" />
                        <span>استخراج المهام المكتوبة كمهام متابعة</span>
                      </button>
                    </div>

                    {extractedTasksCount !== null && (
                      <div className="mb-2 p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {extractedTasksCount > 0
                            ? `تم استخراج ${extractedTasksCount} مهام جديدة وإضافتها إلى قائمة المهام بنجاح!`
                            : 'لم يتم العثور على أسطر مهام معلمة بـ 📌 في المحضر.'}
                        </span>
                      </div>
                    )}

                    {isLiveEditing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={10}
                          value={liveNotes}
                          onChange={(e) => setLiveNotes(e.target.value)}
                          onBlur={handleSaveLiveNotes}
                          placeholder="اكتب مجريات الاجتماع هنا، أو استخدم الأزرار أعلاه لإدراج القرارات والمهام..."
                          className="w-full bg-stone-50 rounded-xl border border-stone-200 p-3 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden font-mono leading-relaxed"
                        />
                        <div className="flex items-center justify-between text-[11px] text-stone-500">
                          <span>يدعم التنسيق بـ Markdown والعناوين والجداول.</span>
                          <button
                            type="button"
                            onClick={handleSaveLiveNotes}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors"
                          >
                            <Save className="w-3 h-3" />
                            <span>حفظ التعديلات</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 leading-relaxed whitespace-pre-line text-stone-800 font-sans space-y-2">
                        {liveNotes ? (
                          liveNotes.split('\n').map((line, idx) => {
                            if (line.startsWith('> 🎯')) {
                              return (
                                <div key={idx} className="p-2.5 my-1.5 bg-emerald-50 border-r-4 border-emerald-600 text-emerald-950 rounded-md font-medium text-xs">
                                  {line.replace(/^>\s*/, '')}
                                </div>
                              );
                            }
                            if (line.startsWith('> ⚠️')) {
                              return (
                                <div key={idx} className="p-2.5 my-1.5 bg-amber-50 border-r-4 border-amber-600 text-amber-950 rounded-md font-medium text-xs">
                                  {line.replace(/^>\s*/, '')}
                                </div>
                              );
                            }
                            if (line.startsWith('> 🤝')) {
                              return (
                                <div key={idx} className="p-2.5 my-1.5 bg-sky-50 border-r-4 border-sky-600 text-sky-950 rounded-md font-medium text-xs">
                                  {line.replace(/^>\s*/, '')}
                                </div>
                              );
                            }
                            if (line.startsWith('###')) {
                              return (
                                <h4 key={idx} className="font-heading font-bold text-stone-900 text-sm mt-3 mb-1 border-b border-stone-200 pb-1">
                                  {line.replace(/^###\s*/, '')}
                                </h4>
                              );
                            }
                            if (line.startsWith('- [ ]') || line.startsWith('- 📌')) {
                              return (
                                <div key={idx} className="flex items-start gap-1.5 text-stone-800 py-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                                  <span>{line.replace(/^[-*]\s*(\[[ x]\])?\s*/, '')}</span>
                                </div>
                              );
                            }
                            return <p key={idx} className="text-stone-700 min-h-[1.2em]">{line}</p>;
                          })
                        ) : (
                          <p className="text-stone-400 italic text-center py-4">المحضر فارغ حالياً.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Attached Photos Gallery */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-stone-800 block text-xs flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-emerald-700" />
                        <span>صور وملاحظات اللقاء المرفقة ({activeMeeting.photoPaths.length})</span>
                      </span>
                    </div>

                    {activeMeeting.photoPaths.length === 0 ? (
                      <p className="text-stone-400 italic text-center py-4 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                        لا توجد صور مرفقة لهذا اللقاء.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {activeMeeting.photoPaths.map((photo, i) => (
                          <div
                            key={i}
                            onClick={() => setSelectedImage(photo)}
                            className="relative group rounded-xl overflow-hidden border border-stone-200 aspect-video cursor-pointer hover:border-emerald-500 shadow-2xs"
                          >
                            <img src={photo} alt="Meeting note" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-stone-900/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[11px] font-semibold transition-opacity">
                              عرض بحجم كامل
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PHASE 3: AFTER */}
              {meetingPhase === 'after' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-heading font-bold text-stone-900 text-xs">
                        المهام والالتزامات المستخرجة من هذا اللقاء
                      </h4>
                      <p className="text-[11px] text-stone-500">
                        مرتبطة مباشرة بهذا الاجتماع
                      </p>
                    </div>
                    <button
                      onClick={() => onNewTaskFromMeeting(activeMeeting)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة مهمة</span>
                    </button>
                  </div>

                  {tasks.filter((t) => t.meetingId === activeMeeting.id).length === 0 ? (
                    <p className="text-stone-400 italic text-center py-4 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                      لم يتم استخراج أي مهام متابعة بعد. انقر على &quot;إضافة مهمة&quot; أو استخدم &quot;استخراج المهام المكتوبة&quot; في طور أثناء اللقاء.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {tasks
                        .filter((t) => t.meetingId === activeMeeting.id)
                        .map((task) => (
                          <div
                            key={task.id}
                            className="p-3 rounded-xl border border-stone-200 bg-stone-50 flex items-start justify-between gap-2"
                          >
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-stone-900">{task.title}</span>
                                <ProvenanceBadge type={task.provenance} />
                              </div>
                              {task.description && (
                                <p className="text-[11px] text-stone-600 mt-1">{task.description}</p>
                              )}
                              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-stone-500">
                                <span>الموعد: {task.dueDate ? formatArabicDate(task.dueDate) : 'بدون موعد'}</span>
                                <span className="capitalize">الحالة: {task.status === 'completed' ? 'منجزة' : 'معلّقة'}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                    <button
                      onClick={() => onOpenPdfModal(activeMeeting)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 shadow-2xs"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>معاينة وتصدير المحضر الرسمي PDF</span>
                    </button>

                    <button
                      onClick={() => {
                        const nextStatus: MeetingStatus =
                          activeMeeting.status === 'draft'
                            ? 'confirmed'
                            : activeMeeting.status === 'confirmed'
                            ? 'completed'
                            : 'confirmed';
                        const updated = { ...activeMeeting, status: nextStatus };
                        onSaveMeeting(updated);
                        setActiveMeeting(updated);
                      }}
                      className="px-2.5 py-1 text-xs text-stone-600 hover:text-stone-900 underline"
                    >
                      تغيير الحالة إلى ({activeMeeting.status === 'completed' ? 'مؤكدة' : 'منتهية'})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox for attached photos */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <img src={selectedImage} alt="Meeting note zoom" className="rounded-xl max-h-[85vh] object-contain shadow-2xl" />
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-2 right-2 p-2 bg-stone-900/80 text-white rounded-full hover:bg-stone-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Meeting Modal with Templates & Quick Actions */}
      {isEditModalOpen && editingMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-auto overflow-hidden border border-stone-200 p-5 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-stone-900">
                  {editingMeeting.id ? 'تعديل بيانات اللقاء' : 'جدولة لقاء جديد'}
                </h3>
                <p className="text-[11px] text-stone-500">
                  حدد الأجندة أو اختر أحد القوالب التأسيسية الجاهزة
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Template Selector Section */}
            <div className="mb-4 bg-stone-50 p-3 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs text-stone-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>قوالب أجندة جاهزة (اختر لتعبئة المحاور والمحضر):</span>
                </span>
                <span className="text-[10px] text-stone-500">5 قوالب معتمدة</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {MEETING_TEMPLATES.map((tmpl) => {
                  const IconComp = getTemplateIcon(tmpl.icon);
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => handleSelectTemplateInModal(tmpl)}
                      className="p-2 rounded-lg bg-white border border-stone-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-right transition-all group flex flex-col justify-between"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <IconComp className="w-3.5 h-3.5 text-emerald-700 group-hover:scale-110 transition-transform shrink-0" />
                        <span className="font-bold text-[11px] text-stone-900 group-hover:text-emerald-800 truncate">
                          {tmpl.shortTitle}
                        </span>
                      </div>
                      <span className="text-[10px] text-stone-500 line-clamp-1">
                        {tmpl.defaultDuration} د • {tmpl.suggestedLocation.split('/')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleSaveMeetingForm} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  العميل / جهة الاتصال <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={editingMeeting.clientId || ''}
                  onChange={(e) => setEditingMeeting({ ...editingMeeting, clientId: e.target.value })}
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  عنوان أو موضوع اللقاء <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingMeeting.title || ''}
                  onChange={(e) => setEditingMeeting({ ...editingMeeting, title: e.target.value })}
                  placeholder="مثال: استكشاف نطاق المشروع وتحديد المخرجات"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    تاريخ ووقت اللقاء
                  </label>
                  <input
                    type="datetime-local"
                    value={editingMeeting.dateTime || ''}
                    onChange={(e) => setEditingMeeting({ ...editingMeeting, dateTime: e.target.value })}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    نوع اللقاء
                  </label>
                  <select
                    value={editingMeeting.type || 'in_person'}
                    onChange={(e) => setEditingMeeting({ ...editingMeeting, type: e.target.value as MeetingType })}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  >
                    <option value="in_person">وجهاً لوجه</option>
                    <option value="video">مكالمة فيديو</option>
                    <option value="phone">اتصال هاتفي</option>
                    <option value="chat">مراسلة مكتوبة</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">مكان اللقاء</label>
                  <input
                    type="text"
                    value={editingMeeting.location || ''}
                    onChange={(e) => setEditingMeeting({ ...editingMeeting, location: e.target.value })}
                    placeholder="كافيه، مقر العميل، Google Meet..."
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">حالة اللقاء</label>
                  <select
                    value={editingMeeting.status || 'confirmed'}
                    onChange={(e) => setEditingMeeting({ ...editingMeeting, status: e.target.value as MeetingStatus })}
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  >
                    <option value="confirmed">مؤكدة</option>
                    <option value="completed">منتهية</option>
                    <option value="draft">مسودة</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-stone-700">
                    محضر الاجتماع ومحاور النقاش (يدعم Markdown)
                  </label>
                  <div className="flex items-center gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = FAST_SNIPPETS.decision;
                        setEditingMeeting({
                          ...editingMeeting,
                          notes: (editingMeeting.notes || '') + snippet,
                        });
                      }}
                      className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 font-medium"
                    >
                      + قرار
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = FAST_SNIPPETS.actionItem;
                        setEditingMeeting({
                          ...editingMeeting,
                          notes: (editingMeeting.notes || '') + snippet,
                        });
                      }}
                      className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 font-medium"
                    >
                      + مهمة
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = FAST_SNIPPETS.blocker;
                        setEditingMeeting({
                          ...editingMeeting,
                          notes: (editingMeeting.notes || '') + snippet,
                        });
                      }}
                      className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 font-medium"
                    >
                      + عائق
                    </button>
                  </div>
                </div>
                <textarea
                  rows={6}
                  value={editingMeeting.notes || ''}
                  onChange={(e) => setEditingMeeting({ ...editingMeeting, notes: e.target.value })}
                  placeholder="اكتب النقاط المتفق عليها أو اختر أحد القوالب الجاهزة أعلاه..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs text-stone-800 focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden font-mono leading-relaxed"
                />
              </div>

              {/* Photo attachments */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-stone-700">الصور المرفقة (لوحات بيضاء / ملاحظات ورقية)</label>
                  <button
                    type="button"
                    onClick={handleAddSamplePhoto}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    + إرفاق صورة تجريبية
                  </button>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto py-1">
                  {editingMeeting.photoPaths?.map((p, i) => (
                    <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-stone-200 shrink-0">
                      <img src={p} alt="attached" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...(editingMeeting.photoPaths || [])];
                          updated.splice(i, 1);
                          setEditingMeeting({ ...editingMeeting, photoPaths: updated });
                        }}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-rose-600 text-white rounded-full"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  {(!editingMeeting.photoPaths || editingMeeting.photoPaths.length === 0) && (
                    <span className="text-[11px] text-stone-400">لا توجد صور مرفقة بعد.</span>
                  )}
                </div>
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
                  حفظ اللقاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Non-destructive Template Confirmation Dialog */}
      {pendingTemplate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 border border-stone-200 animate-in fade-in zoom-in-95 space-y-3">
            <div className="flex items-center gap-2 text-stone-900">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              <h4 className="font-heading font-bold text-sm">
                تطبيق قالب: {pendingTemplate.template.title}
              </h4>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              يحتوي المحضر الحالي على ملاحظات مسجلة مسبقاً. كيف ترغب في تطبيق القالب الجديد؟
            </p>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (pendingTemplate.target === 'modal') {
                    applyTemplateToModal(pendingTemplate.template, 'append');
                  } else {
                    applyTemplateToLive(pendingTemplate.template, 'append');
                  }
                }}
                className="w-full py-2 px-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold hover:bg-emerald-100 transition-colors text-right flex items-center justify-between"
              >
                <span>إلحاق القالب أسفل المحتوى الحالي (موصى به)</span>
                <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">آمن</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (pendingTemplate.target === 'modal') {
                    applyTemplateToModal(pendingTemplate.template, 'replace');
                  } else {
                    applyTemplateToLive(pendingTemplate.template, 'replace');
                  }
                }}
                className="w-full py-2 px-3 rounded-xl bg-stone-100 hover:bg-rose-50 hover:text-rose-900 border border-stone-200 text-stone-700 text-xs font-semibold transition-colors text-right"
              >
                استبدال المحتوى بالكامل بالقالب الجديد
              </button>

              <button
                type="button"
                onClick={() => setPendingTemplate(null)}
                className="w-full py-1.5 text-stone-500 hover:text-stone-800 text-xs text-center"
              >
                إلغاء التغيير
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
