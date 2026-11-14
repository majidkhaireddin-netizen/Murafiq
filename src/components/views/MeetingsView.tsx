import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionItem,
  Client,
  Meeting,
  MeetingAgendaItem,
  MeetingDecision,
  MeetingParticipant,
  MeetingStatus,
  MeetingType,
  MinutesStatus,
  ParticipantParty,
  TaskPriority,
} from '../../types';
import { formatArabicDate } from '../../utils/logic';
import { MeetingAttachmentsSection } from '../MeetingAttachmentsSection';
import { MeetingAiAssistant } from '../MeetingAiAssistant';
import type { requestMeetingAiSuggestions } from '../../services/meetingAi';
import {
  CustomTemplateOverride,
  MeetingTemplateModal,
} from '../MeetingTemplateModal';
import { MEETING_TEMPLATES, MeetingTemplate } from '../../data/meetingTemplates';
import {
  MEETING_HAS_ATTACHMENTS_MESSAGE_AR,
} from '../../utils/attachmentPolicy';
import { cleanupExpiredMeetingAttachments } from '../../services/attachments';
import {
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  MINUTES_FINAL_DISCLAIMER_AR,
  MINUTES_FINAL_DISCLAIMER_EN,
  MINUTES_STATUS_CONFIG,
  addAgendaItemToList,
  addDecisionToList,
  addParticipantToList,
  applyTemplateToMeetingNonDestructive,
  createLinkedMeetingTask,
  getDiscussionSectionsForDisplay,
  getEffectiveParticipants,
  getMinutesStatus,
  isMinutesLocked,
  normalizeAgendaOrder,
  removeAgendaItemFromList,
  removeDecisionFromList,
  removeParticipantFromList,
  reorderAgendaItems,
  sanitizeMeetingForSave,
  syncAttendeesFromParticipants,
  transitionMinutesStatus,
  updateAgendaItemInList,
  updateDecisionInList,
  updateParticipantInList,
} from '../../utils/meetingMinutes';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Lock,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  Video,
  WifiOff,
  X,
} from 'lucide-react';

interface MeetingsViewProps {
  meetings: Meeting[];
  clients: Client[];
  tasks: ActionItem[];
  onSaveMeeting: (meeting: Meeting) => Promise<void> | void;
  onDeleteMeeting?: (
    meetingId: string,
    knownAttachmentsCount?: number
  ) => Promise<{ deleted: boolean; blockedMessageArabic?: string } | void> | void;
  onSaveTask?: (task: ActionItem) => Promise<void> | void;
  onToggleTask?: (taskId: string) => void;
  onOpenPdfModal: (meeting: Meeting) => void;
  onNewTaskFromMeeting: (meeting: Meeting) => void;
  selectedMeetingId?: string | null;
  onSelectMeetingChange?: (meeting: Meeting | null) => void;
  preselectedClientId?: string | null;
  pendingMeetingIds?: string[];
  failedMeetingIds?: string[];
  language: 'ar' | 'en';
  isOnline?: boolean;
  requestAiAnalysisFn?: typeof requestMeetingAiSuggestions;
}

type WorkspaceSectionTab =
  | 'all'
  | 'basic'
  | 'participants'
  | 'agenda'
  | 'discussions'
  | 'decisions'
  | 'followUp'
  | 'ai'
  | 'attachments';

function getCurrentLocalDateTimeInput(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function toDateTimeInputValue(iso?: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
    return iso.slice(0, 16);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return getCurrentLocalDateTimeInput(d);
}

export const MeetingsView: React.FC<MeetingsViewProps> = ({
  meetings,
  clients,
  tasks,
  onSaveMeeting,
  onDeleteMeeting,
  onSaveTask,
  onToggleTask,
  onOpenPdfModal,
  onNewTaskFromMeeting,
  selectedMeetingId,
  onSelectMeetingChange,
  preselectedClientId,
  pendingMeetingIds = [],
  failedMeetingIds = [],
  language,
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true,
  requestAiAnalysisFn,
}) => {
  const isArabic = language === 'ar';

  const [filterStatus, setFilterStatus] = useState<'all' | MeetingStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'timeline' | 'calendar'>('timeline');
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(
    selectedMeetingId ? meetings.find((m) => m.id === selectedMeetingId) || null : null
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceSectionTab>('all');

  // Create new meeting modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [creatingMeeting, setCreatingMeeting] = useState<Partial<Meeting> | null>(null);

  // Template modal & editable template overrides
  const [templateTarget, setTemplateTarget] = useState<'active' | 'create' | null>(null);
  const [templateOverrides, setTemplateOverrides] = useState<
    Record<string, CustomTemplateOverride>
  >({});

  // Save / Sync feedback inside workspace (preserves draft if save fails)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string | null>(null);

  // Explicit confirmation modal to reopen a finalized minute
  const [pendingReopenTarget, setPendingReopenTarget] = useState<MinutesStatus | null>(null);

  // Inline Basic Info form editing toggle
  const [isEditingBasicInfo, setIsEditingBasicInfo] = useState(false);

  // Inline Participant add/edit state
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantRole, setNewParticipantRole] = useState('');
  const [newParticipantParty, setNewParticipantParty] = useState<ParticipantParty>('external');
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [editPartName, setEditPartName] = useState('');
  const [editPartRole, setEditPartRole] = useState('');
  const [editPartParty, setEditPartParty] = useState<ParticipantParty>('external');

  // Inline Agenda Item add/edit state
  const [newAgendaTitle, setNewAgendaTitle] = useState('');
  const [newAgendaDuration, setNewAgendaDuration] = useState<string>('');
  const [newAgendaNotes, setNewAgendaNotes] = useState('');
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);

  // Inline Discussions editing state
  const [draftDiscussionSummary, setDraftDiscussionSummary] = useState('');
  const [draftLegacyNotes, setDraftLegacyNotes] = useState('');
  const [showLegacyNotesEditor, setShowLegacyNotesEditor] = useState(false);

  // Inline Decision add/edit state
  const [newDecisionText, setNewDecisionText] = useState('');
  const [newDecisionAgendaId, setNewDecisionAgendaId] = useState('');
  const [newDecisionOwner, setNewDecisionOwner] = useState('');
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);

  // Inline Manual Task Creation (in Follow-up section)
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [taskCreateNotice, setTaskCreateNotice] = useState<string | null>(null);

  // Lightbox for legacy photos
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Meeting deletion guard UI state (preserved from Task 004-A-Fix-03)
  const [activeMeetingAttachmentsCount, setActiveMeetingAttachmentsCount] = useState<number>(0);
  const [confirmDeleteMeeting, setConfirmDeleteMeeting] = useState<boolean>(false);
  const [deleteMeetingError, setDeleteMeetingError] = useState<string | null>(null);
  const [deleteMeetingNotice, setDeleteMeetingNotice] = useState<string | null>(null);
  const [isDeletingMeeting, setIsDeletingMeeting] = useState<boolean>(false);
  const [isCleaningExpired, setIsCleaningExpired] = useState<boolean>(false);
  const [aiConsentTrigger, setAiConsentTrigger] = useState<number>(0);

  // Sync external selectedMeetingId
  useEffect(() => {
    if (selectedMeetingId) {
      const found = meetings.find((m) => m.id === selectedMeetingId);
      if (found) {
        setActiveMeeting(found);
      }
    }
  }, [selectedMeetingId, meetings]);

  // Keep activeMeeting hydrated from snapshots ONLY when there is no unsaved local error
  useEffect(() => {
    if (!activeMeeting) return;
    const latest = meetings.find((m) => m.id === activeMeeting.id);
    if (latest && !workspaceSaveError) {
      setActiveMeeting(latest);
    }
  }, [meetings]);

  // Reset per-meeting transient UI states when switching active meeting
  useEffect(() => {
    if (!activeMeeting) return;
    const disc = getDiscussionSectionsForDisplay(activeMeeting);
    setDraftDiscussionSummary(activeMeeting.discussionSummary ?? '');
    setDraftLegacyNotes(activeMeeting.notes ?? '');
    setShowLegacyNotesEditor(disc.hasSeparateLegacyNotes || Boolean(activeMeeting.notes && !activeMeeting.discussionSummary));
    setIsEditingBasicInfo(false);
    setEditingParticipantId(null);
    setEditingAgendaId(null);
    setEditingDecisionId(null);
    setWorkspaceNotice(null);
    setWorkspaceSaveError(null);
    setTaskCreateError(null);
    setTaskCreateNotice(null);
    setPendingReopenTarget(null);
    setActiveMeetingAttachmentsCount(0);
    setConfirmDeleteMeeting(false);
    setDeleteMeetingError(null);
    setDeleteMeetingNotice(null);
    setIsDeletingMeeting(false);
    setAiConsentTrigger(0);
  }, [activeMeeting?.id]);

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return meetings
      .filter((m) => {
        if (filterStatus !== 'all' && m.status !== filterStatus) return false;
        if (!q) return true;
        const client = clients.find((c) => c.id === m.clientId);
        const matchesClient =
          client &&
          (client.name.toLowerCase().includes(q) ||
            (client.company && client.company.toLowerCase().includes(q)));
        const matchesDecisions = (m.decisions || []).some((d) =>
          d.text.toLowerCase().includes(q)
        );
        const matchesAgenda = (m.agendaItems || []).some((a) =>
          a.title.toLowerCase().includes(q)
        );
        return (
          m.title.toLowerCase().includes(q) ||
          (m.location && m.location.toLowerCase().includes(q)) ||
          (m.discussionSummary && m.discussionSummary.toLowerCase().includes(q)) ||
          (m.notes && m.notes.toLowerCase().includes(q)) ||
          Boolean(matchesClient) ||
          matchesDecisions ||
          matchesAgenda
        );
      })
      .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
  }, [meetings, clients, filterStatus, searchQuery]);

  // Dynamic current 7-day calendar strip anchored on today
  const weekDays = useMemo(() => {
    const today = new Date();
    const dayNamesAr = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
    const result: { label: string; dateNum: number; dateKey: string; isToday: boolean; count: number }[] = [];
    for (let offset = -2; offset <= 4; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      const count = meetings.filter((m) => (m.dateTime || '').slice(0, 10) === key).length;
      result.push({
        label: dayNamesAr[d.getDay()],
        dateNum: d.getDate(),
        dateKey: key,
        isToday: offset === 0,
        count,
      });
    }
    return result;
  }, [meetings]);

  const getMeetingTypeDetails = (type: MeetingType) => {
    switch (type) {
      case 'in_person':
        return { label: MEETING_TYPE_LABELS.in_person[language], icon: MapPin };
      case 'video':
        return { label: MEETING_TYPE_LABELS.video[language], icon: Video };
      case 'phone':
        return { label: MEETING_TYPE_LABELS.phone[language], icon: Phone };
      default:
        return { label: MEETING_TYPE_LABELS.chat[language], icon: MessageSquare };
    }
  };

  // Persist updates to activeMeeting cleanly without losing local draft on error
  const persistActiveMeeting = async (nextMeeting: Meeting, noticeMsg?: string) => {
    const sanitized = sanitizeMeetingForSave({
      ...nextMeeting,
      updatedAt: new Date().toISOString(),
    });
    setActiveMeeting(sanitized);
    setDraftDiscussionSummary(sanitized.discussionSummary ?? '');
    setWorkspaceSaveError(null);
    try {
      await onSaveMeeting(sanitized);
      if (noticeMsg) {
        setWorkspaceNotice(noticeMsg);
        setTimeout(() => setWorkspaceNotice(null), 2600);
      }
    } catch (err: any) {
      setWorkspaceSaveError(
        err?.message ||
          'تعذر حفظ التعديلات سحابياً حالياً. تم الإبقاء على مسودتك في هذه الجلسة لتتمكن من إعادة المحاولة.'
      );
    }
  };

  const handleOpenCreate = () => {
    setCreatingMeeting({
      clientId: preselectedClientId || clients[0]?.id || '',
      title: '',
      dateTime: getCurrentLocalDateTimeInput(new Date(Date.now() + 86400000)),
      duration: 45,
      type: 'in_person',
      location: '',
      notes: '',
      discussionSummary: '',
      status: 'confirmed',
      minutesStatus: 'draft',
      photoPaths: [],
      participants: [{ id: `part-${Date.now()}`, name: 'أنت', party: 'internal' }],
      attendees: ['أنت'],
      agendaItems: [],
      decisions: [],
      isFollowUpScheduled: false,
    });
    setIsCreateModalOpen(true);
  };

  const handleSaveNewMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingMeeting?.title?.trim() || !creatingMeeting.clientId) return;

    const participants = getEffectiveParticipants(creatingMeeting);
    const created = sanitizeMeetingForSave({
      ...(creatingMeeting as Partial<Meeting>),
      id: `m-${Date.now()}`,
      clientId: creatingMeeting.clientId,
      title: creatingMeeting.title.trim(),
      dateTime: creatingMeeting.dateTime || new Date().toISOString(),
      type: creatingMeeting.type || 'in_person',
      status: creatingMeeting.status || 'confirmed',
      notes: creatingMeeting.notes || '',
      photoPaths: creatingMeeting.photoPaths || [],
      participants,
      attendees: syncAttendeesFromParticipants(participants),
      minutesStatus: creatingMeeting.minutesStatus || 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    try {
      await onSaveMeeting(created);
      setIsCreateModalOpen(false);
      setCreatingMeeting(null);
      setActiveMeeting(created);
      setWorkspaceTab('all');
      if (onSelectMeetingChange) onSelectMeetingChange(created);
    } catch (err: any) {
      setWorkspaceSaveError(err?.message || 'تعذر حفظ اللقاء الجديد. أعد المحاولة.');
    }
  };

  // Template application (strictly non-destructive)
  const handleApplyTemplate = (
    template: MeetingTemplate,
    override?: CustomTemplateOverride
  ) => {
    if (templateTarget === 'create' && creatingMeeting) {
      const merged = applyTemplateToMeetingNonDestructive(
        creatingMeeting,
        template,
        override
      );
      setCreatingMeeting(merged);
      setTemplateTarget(null);
      return;
    }

    if (templateTarget === 'active' && activeMeeting) {
      if (isMinutesLocked(activeMeeting)) {
        setTemplateTarget(null);
        return;
      }
      const merged = applyTemplateToMeetingNonDestructive(
        activeMeeting,
        template,
        override
      );
      setDraftDiscussionSummary(merged.discussionSummary || '');
      void persistActiveMeeting(
        merged,
        `تم تطبيق قالب «${template.shortTitle}» مع الحفاظ على كامل المحتوى السابق.`
      );
      setTemplateTarget(null);
    }
  };

  // Minutes lifecycle transitions
  const handleSelectMinutesStatus = (targetStatus: MinutesStatus) => {
    if (!activeMeeting) return;
    const current = getMinutesStatus(activeMeeting);
    if (current === targetStatus) return;

    const result = transitionMinutesStatus(activeMeeting, targetStatus, {
      confirmedReopen: false,
    });

    if (!result.allowed) {
      setPendingReopenTarget(targetStatus);
      return;
    }

    void persistActiveMeeting(
      result.meeting,
      `تم تحديث حالة المحضر إلى: ${MINUTES_STATUS_CONFIG[targetStatus].labelAr}`
    );
  };

  const handleConfirmReopenFinalMinutes = () => {
    if (!activeMeeting || !pendingReopenTarget) return;
    const result = transitionMinutesStatus(activeMeeting, pendingReopenTarget, {
      confirmedReopen: true,
    });
    setPendingReopenTarget(null);
    void persistActiveMeeting(
      result.meeting,
      `تمت إعادة فتح المحضر للتعديل (${MINUTES_STATUS_CONFIG[pendingReopenTarget].labelAr}).`
    );
  };

  // Participant CRUD
  const activeParticipants = activeMeeting ? getEffectiveParticipants(activeMeeting) : [];
  const minutesLocked = activeMeeting ? isMinutesLocked(activeMeeting) : false;

  const handleAddParticipant = () => {
    if (!activeMeeting || minutesLocked || !newParticipantName.trim()) return;
    const nextParticipants = addParticipantToList(activeParticipants, {
      name: newParticipantName,
      role: newParticipantRole,
      party: newParticipantParty,
    });
    setNewParticipantName('');
    setNewParticipantRole('');
    void persistActiveMeeting(
      {
        ...activeMeeting,
        participants: nextParticipants,
        attendees: syncAttendeesFromParticipants(nextParticipants),
      },
      'تمت إضافة المشارك.'
    );
  };

  const handleSaveParticipantEdit = () => {
    if (!activeMeeting || minutesLocked || !editingParticipantId) return;
    const nextParticipants = updateParticipantInList(activeParticipants, editingParticipantId, {
      name: editPartName,
      role: editPartRole,
      party: editPartParty,
    });
    setEditingParticipantId(null);
    void persistActiveMeeting({
      ...activeMeeting,
      participants: nextParticipants,
      attendees: syncAttendeesFromParticipants(nextParticipants),
    });
  };

  const handleRemoveParticipant = (id: string) => {
    if (!activeMeeting || minutesLocked) return;
    const nextParticipants = removeParticipantFromList(activeParticipants, id);
    void persistActiveMeeting({
      ...activeMeeting,
      participants: nextParticipants,
      attendees: syncAttendeesFromParticipants(nextParticipants),
    });
  };

  // Agenda CRUD + Reorder
  const activeAgenda = activeMeeting ? normalizeAgendaOrder(activeMeeting.agendaItems || []) : [];

  const handleAddAgendaItem = () => {
    if (!activeMeeting || minutesLocked || !newAgendaTitle.trim()) return;
    const dur = parseInt(newAgendaDuration, 10);
    const nextAgenda = addAgendaItemToList(activeAgenda, {
      title: newAgendaTitle,
      notes: newAgendaNotes,
      durationMinutes: Number.isFinite(dur) && dur > 0 ? dur : undefined,
    });
    setNewAgendaTitle('');
    setNewAgendaDuration('');
    setNewAgendaNotes('');
    void persistActiveMeeting(
      { ...activeMeeting, agendaItems: nextAgenda },
      'تمت إضافة بند جدول الأعمال.'
    );
  };

  const handleReorderAgenda = (id: string, direction: 'up' | 'down') => {
    if (!activeMeeting || minutesLocked) return;
    const nextAgenda = reorderAgendaItems(activeAgenda, id, direction);
    void persistActiveMeeting({ ...activeMeeting, agendaItems: nextAgenda });
  };

  const handleUpdateAgendaItem = (
    id: string,
    patch: Partial<Pick<MeetingAgendaItem, 'title' | 'notes' | 'durationMinutes'>>
  ) => {
    if (!activeMeeting || minutesLocked) return;
    const nextAgenda = updateAgendaItemInList(activeAgenda, id, patch);
    void persistActiveMeeting({ ...activeMeeting, agendaItems: nextAgenda });
  };

  const handleRemoveAgendaItem = (id: string) => {
    if (!activeMeeting || minutesLocked) return;
    const { agendaItems, decisions } = removeAgendaItemFromList(
      activeAgenda,
      id,
      activeMeeting.decisions || []
    );
    void persistActiveMeeting({ ...activeMeeting, agendaItems, decisions });
  };

  // Discussions Save (preserves legacy notes)
  const handleSaveDiscussions = () => {
    if (!activeMeeting || minutesLocked) return;
    void persistActiveMeeting(
      {
        ...activeMeeting,
        discussionSummary: draftDiscussionSummary,
        notes: draftLegacyNotes,
      },
      'تم حفظ ملخص المناقشات.'
    );
  };

  // Decisions CRUD
  const activeDecisions = activeMeeting?.decisions || [];

  const handleAddDecision = () => {
    if (!activeMeeting || minutesLocked || !newDecisionText.trim()) return;
    const nextDecisions = addDecisionToList(activeDecisions, {
      text: newDecisionText,
      agendaItemId: newDecisionAgendaId || undefined,
      ownerName: newDecisionOwner || undefined,
    });
    setNewDecisionText('');
    setNewDecisionAgendaId('');
    setNewDecisionOwner('');
    void persistActiveMeeting(
      { ...activeMeeting, decisions: nextDecisions },
      'تم تسجيل القرار في المحضر.'
    );
  };

  const handleUpdateDecision = (
    id: string,
    patch: Partial<Pick<MeetingDecision, 'text' | 'agendaItemId' | 'ownerName'>>
  ) => {
    if (!activeMeeting || minutesLocked) return;
    const nextDecisions = updateDecisionInList(activeDecisions, id, patch);
    void persistActiveMeeting({ ...activeMeeting, decisions: nextDecisions });
  };

  const handleRemoveDecision = (id: string) => {
    if (!activeMeeting || minutesLocked) return;
    const nextDecisions = removeDecisionFromList(activeDecisions, id);
    void persistActiveMeeting({ ...activeMeeting, decisions: nextDecisions });
  };

  // Follow-up & Manual Task Linking with Duplicate Prevention
  const activeMeetingTasks = activeMeeting
    ? tasks.filter((t) => t.meetingId === activeMeeting.id)
    : [];

  const handleCreateLinkedTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMeeting) return;
    setTaskCreateError(null);
    setTaskCreateNotice(null);

    const result = createLinkedMeetingTask(
      {
        meetingId: activeMeeting.id,
        clientId: activeMeeting.clientId,
        title: newTaskTitle,
        description: newTaskDescription,
        dueDate: newTaskDueDate || undefined,
        priority: newTaskPriority,
      },
      tasks
    );

    if (!result.ok) {
      setTaskCreateError(result.reasonArabic);
      return;
    }

    if (onSaveTask) {
      await onSaveTask(result.task);
      setNewTaskTitle('');
      setNewTaskDescription('');
      setNewTaskDueDate('');
      setTaskCreateNotice(`تم إنشاء المهمة «${result.task.title}» وربطها بهذا اللقاء.`);
      setTimeout(() => setTaskCreateNotice(null), 3000);
    } else {
      onNewTaskFromMeeting(activeMeeting);
    }
  };

  // Safe Delete Handlers (Task 004-A-Fix-03 preserved)
  const handleRequestDeleteMeeting = () => {
    if (!activeMeeting || !onDeleteMeeting) return;
    setDeleteMeetingError(null);
    setDeleteMeetingNotice(null);
    if (activeMeetingAttachmentsCount > 0) {
      setDeleteMeetingError(MEETING_HAS_ATTACHMENTS_MESSAGE_AR);
      return;
    }
    setConfirmDeleteMeeting(true);
  };

  const handleConfirmDeleteMeeting = async () => {
    if (!activeMeeting || !onDeleteMeeting) return;
    setIsDeletingMeeting(true);
    setDeleteMeetingError(null);
    setDeleteMeetingNotice(null);
    try {
      const res = await onDeleteMeeting(activeMeeting.id, activeMeetingAttachmentsCount);
      if (res && res.deleted === false) {
        setDeleteMeetingError(res.blockedMessageArabic || MEETING_HAS_ATTACHMENTS_MESSAGE_AR);
        setConfirmDeleteMeeting(false);
        return;
      }
      setConfirmDeleteMeeting(false);
      setActiveMeeting(null);
      if (onSelectMeetingChange) onSelectMeetingChange(null);
    } catch (err: any) {
      setDeleteMeetingError(err?.message || MEETING_HAS_ATTACHMENTS_MESSAGE_AR);
      setConfirmDeleteMeeting(false);
    } finally {
      setIsDeletingMeeting(false);
    }
  };

  const handleCleanupExpiredForMeeting = async () => {
    if (!activeMeeting || !isOnline) return;
    setIsCleaningExpired(true);
    setDeleteMeetingNotice(null);
    try {
      const summary = await cleanupExpiredMeetingAttachments({ meetingId: activeMeeting.id });
      if (summary.cleaned > 0) {
        setDeleteMeetingError(null);
        setDeleteMeetingNotice(
          `تم تنظيف ${summary.cleaned} عملية رفع منتهية غير مكتملة. يمكنك الآن إعادة محاولة حذف اللقاء.`
        );
      } else if (summary.skipped > 0) {
        setDeleteMeetingNotice(
          'لا تزال هناك عملية رفع قيد الانتظار أو ضمن مهلة الأمان ولم تنتهِ صلاحيتها بعد.'
        );
      } else {
        setDeleteMeetingNotice('لم يتم العثور على عمليات رفع منتهية قابلة للتنظيف.');
      }
    } catch (err: any) {
      setDeleteMeetingError(err?.message || 'تعذر تنظيف عمليات الرفع غير المكتملة.');
    } finally {
      setIsCleaningExpired(false);
    }
  };

  const getSyncBadgeForMeeting = (meetingId: string) => {
    if (failedMeetingIds.includes(meetingId)) {
      return {
        label: isArabic ? 'تعذر الحفظ السحابي' : 'Sync Failed',
        className: 'text-rose-700 bg-rose-50 border-rose-200',
      };
    }
    if (pendingMeetingIds.includes(meetingId)) {
      return {
        label: isOnline
          ? isArabic
            ? 'قيد المزامنة'
            : 'Syncing'
          : isArabic
          ? 'محفوظ محلياً (بانتظار الاتصال)'
          : 'Saved Locally',
        className: 'text-amber-800 bg-amber-50 border-amber-200',
      };
    }
    return null;
  };

  return (
    <div className="space-y-4 pb-8" data-testid="meetings-workspace-view">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-heading font-extrabold text-xl text-stone-900">
            {isArabic ? 'مساحة عمل اللقاءات والمحاضر' : 'Meetings & Minutes Workspace'}
          </h2>
          <p className="text-xs text-stone-500">
            {isArabic
              ? 'إدارة جدول الأعمال، المشاركين، المناقشات، القرارات، والالتزامات المرتبطة'
              : 'Manage agenda, participants, discussions, decisions, and follow-up commitments'}
          </p>
        </div>
        <button
          type="button"
          data-testid="new-meeting-button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shrink-0 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isArabic ? 'لقاء جديد' : 'New Meeting'}</span>
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute top-1/2 -translate-y-1/2 right-3 rtl:right-3 ltr:left-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isArabic
                ? 'ابحث بعنوان اللقاء، العميل، القرارات أو جدول الأعمال...'
                : 'Search meetings, clients, decisions...'
            }
            className="w-full bg-white border border-stone-200 rounded-xl py-2 pr-9 pl-3 rtl:pr-9 rtl:pl-3 ltr:pl-9 ltr:pr-3 text-xs text-stone-800 focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs">
            {(['all', 'confirmed', 'completed', 'draft'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(status)}
                className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                  filterStatus === status
                    ? 'bg-stone-900 text-white'
                    : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                }`}
              >
                {status === 'all' && `${isArabic ? 'الكل' : 'All'} (${meetings.length})`}
                {status === 'confirmed' && MEETING_STATUS_LABELS.confirmed[language]}
                {status === 'completed' && MEETING_STATUS_LABELS.completed[language]}
                {status === 'draft' && MEETING_STATUS_LABELS.draft[language]}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-emerald-50 text-emerald-800 font-bold'
                  : 'text-stone-500'
              }`}
            >
              {isArabic ? 'القائمة' : 'List'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-emerald-50 text-emerald-800 font-bold'
                  : 'text-stone-500'
              }`}
            >
              {isArabic ? 'الأسبوع' : 'Week'}
            </button>
          </div>
        </div>
      </div>

      {/* Real-date Week Calendar Strip */}
      {viewMode === 'calendar' && (
        <div className="bg-white p-3 rounded-2xl border border-stone-200">
          <div className="grid grid-cols-7 gap-1 text-center tabular-nums">
            {weekDays.map((day) => (
              <div
                key={day.dateKey}
                className={`p-2 rounded-xl text-xs flex flex-col items-center justify-center ${
                  day.isToday
                    ? 'bg-emerald-700 text-white font-bold'
                    : 'text-stone-700 bg-stone-50/70'
                }`}
              >
                <span className="text-[10px] opacity-80">{day.label}</span>
                <span className="text-sm font-semibold mt-0.5">{day.dateNum}</span>
                {day.count > 0 && (
                  <span
                    className={`text-[10px] mt-0.5 font-mono ${
                      day.isToday ? 'text-emerald-100' : 'text-emerald-700 font-bold'
                    }`}
                  >
                    {day.count}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meetings Cards List */}
      <div className="space-y-2.5">
        {filteredMeetings.length === 0 ? (
          <div className="text-center py-10 px-4 bg-white rounded-2xl border border-dashed border-stone-300 space-y-2">
            <p className="text-stone-600 text-xs font-medium">
              {isArabic
                ? 'لا توجد لقاءات مطابقة للعرض حالياً.'
                : 'No meetings match the current filter.'}
            </p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isArabic ? 'إنشاء أول لقاء' : 'Create Meeting'}</span>
            </button>
          </div>
        ) : (
          filteredMeetings.map((meeting) => {
            const client = clients.find((c) => c.id === meeting.clientId);
            const typeInfo = getMeetingTypeDetails(meeting.type);
            const TypeIcon = typeInfo.icon;
            const meetingTasks = tasks.filter((t) => t.meetingId === meeting.id);
            const agendaCount = (meeting.agendaItems || []).length;
            const decisionsCount = (meeting.decisions || []).length;
            const minStatus = getMinutesStatus(meeting);
            const minMeta = MINUTES_STATUS_CONFIG[minStatus];
            const syncBadge = getSyncBadgeForMeeting(meeting.id);

            return (
              <div
                key={meeting.id}
                data-testid={`meeting-card-${meeting.id}`}
                onClick={() => {
                  setActiveMeeting(meeting);
                  setWorkspaceTab('all');
                  if (onSelectMeetingChange) onSelectMeetingChange(meeting);
                }}
                className="bg-white p-4 rounded-2xl border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group space-y-2.5"
              >
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
                        style={{ backgroundColor: client?.color || '#047857' }}
                      >
                        {client?.name ? client.name.charAt(0) : 'ع'}
                      </div>
                    )}

                    <div className="min-w-0">
                      <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900 group-hover:text-emerald-800 leading-snug">
                        {meeting.title}
                      </h4>
                      <p className="text-[11px] text-stone-600 font-medium truncate mt-0.5">
                        {client?.name || (isArabic ? 'عميل غير محدد' : 'Client')}
                        {client?.company ? ` • ${client.company}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {syncBadge && (
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${syncBadge.className}`}
                      >
                        {syncBadge.label}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${minMeta.badgeClass}`}
                      title="حالة المحضر"
                    >
                      {isArabic ? `المحضر: ${minMeta.labelAr}` : minMeta.labelEn}
                    </span>
                  </div>
                </div>

                {/* Metadata & Counts Bar */}
                <div className="flex items-center gap-3 text-[11px] text-stone-600 flex-wrap pt-2 border-t border-stone-100 tabular-nums">
                  <span className="inline-flex items-center gap-1 font-medium text-stone-800">
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    <span>{formatArabicDate(meeting.dateTime, true)}</span>
                  </span>

                  <span className="inline-flex items-center gap-1 text-stone-600">
                    <TypeIcon className="w-3 h-3 text-stone-400" />
                    <span>{typeInfo.label}</span>
                  </span>

                  {meeting.duration ? (
                    <span className="text-stone-500">{meeting.duration} دقيقة</span>
                  ) : null}

                  <span className="text-stone-500">
                    {MEETING_STATUS_LABELS[meeting.status][language]}
                  </span>

                  {agendaCount > 0 && (
                    <span className="text-stone-700 font-medium">{agendaCount} بنود</span>
                  )}
                  {decisionsCount > 0 && (
                    <span className="text-emerald-800 font-medium">{decisionsCount} قرارات</span>
                  )}
                  {meetingTasks.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{meetingTasks.length} مهام</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ================================================================= */}
      {/* ACTIVE MEETING PROFESSIONAL WORKSPACE MODAL                       */}
      {/* ================================================================= */}
      {activeMeeting && (
        <div
          data-testid="meeting-workspace-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-auto overflow-hidden border border-stone-200 max-h-[94vh] flex flex-col">
            {/* Workspace Top Header */}
            <div className="p-4 bg-stone-50 border-b border-stone-200 space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[11px] tabular-nums">
                    <span className="px-2 py-0.5 rounded-md border border-stone-200 bg-white text-stone-800 font-semibold">
                      {MEETING_STATUS_LABELS[activeMeeting.status][language]}
                    </span>
                    <span className="text-stone-500">
                      {formatArabicDate(activeMeeting.dateTime, true)}
                    </span>
                    {getSyncBadgeForMeeting(activeMeeting.id) && (
                      <span
                        data-testid="active-meeting-sync-badge"
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                          getSyncBadgeForMeeting(activeMeeting.id)!.className
                        }`}
                      >
                        {getSyncBadgeForMeeting(activeMeeting.id)!.label}
                      </span>
                    )}
                    {!isOnline && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-800">
                        <WifiOff className="w-3 h-3" />
                        <span>يعمل محلياً دون اتصال</span>
                      </span>
                    )}
                  </div>
                  <h3 className="font-heading font-extrabold text-base sm:text-lg text-stone-950 mt-1">
                    {activeMeeting.title}
                  </h3>
                  <p className="text-xs text-stone-600 mt-0.5">
                    {isArabic ? 'العميل: ' : 'Client: '}
                    <span className="font-semibold text-stone-800">
                      {clients.find((c) => c.id === activeMeeting.clientId)?.name || 'غير محدد'}
                    </span>
                  </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                  <button
                    type="button"
                    data-testid="workspace-header-ai-btn"
                    disabled={!isOnline}
                    onClick={() => {
                      if (workspaceTab !== 'all' && workspaceTab !== 'ai') {
                        setWorkspaceTab('ai');
                      }
                      setAiConsentTrigger((c) => c + 1);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                    title="تحليل الاجتماع بالذكاء الاصطناعي"
                    aria-label="تحليل الاجتماع بالذكاء الاصطناعي"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="hidden sm:inline">تحليل ذكي</span>
                  </button>

                  <button
                    type="button"
                    data-testid="open-template-modal-btn"
                    disabled={minutesLocked}
                    onClick={() => setTemplateTarget('active')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-50"
                    title="تطبيق قالب اجتماع دون مسح المحتوى الحالي"
                    aria-label="تطبيق قالب اجتماع دون مسح المحتوى الحالي"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="hidden sm:inline">قالب</span>
                  </button>

                  <button
                    type="button"
                    data-testid="open-pdf-preview-btn"
                    onClick={() => onOpenPdfModal(activeMeeting)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{isArabic ? 'محضر PDF' : 'Minutes PDF'}</span>
                  </button>

                  {onDeleteMeeting && (
                    <button
                      type="button"
                      data-testid="delete-meeting-button"
                      onClick={handleRequestDeleteMeeting}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                      title="حذف اللقاء"
                      aria-label="حذف اللقاء"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setActiveMeeting(null);
                      if (onSelectMeetingChange) onSelectMeetingChange(null);
                    }}
                    aria-label="إغلاق مساحة عمل اللقاء"
                    className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Minutes Lifecycle Bar */}
              <div className="pt-2.5 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-stone-700 text-[11px]">
                    {isArabic ? 'حالة المحضر:' : 'Minutes Lifecycle:'}
                  </span>
                  <div className="inline-flex rounded-xl border border-stone-200 bg-white p-0.5">
                    {(['draft', 'review', 'final'] as MinutesStatus[]).map((st) => {
                      const active = getMinutesStatus(activeMeeting) === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          data-testid={`minutes-status-btn-${st}`}
                          onClick={() => handleSelectMinutesStatus(st)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                            active
                              ? st === 'final'
                                ? 'bg-emerald-700 text-white'
                                : st === 'review'
                                ? 'bg-amber-600 text-white'
                                : 'bg-stone-900 text-white'
                              : 'text-stone-600 hover:bg-stone-100'
                          }`}
                        >
                          {isArabic
                            ? MINUTES_STATUS_CONFIG[st].labelAr
                            : MINUTES_STATUS_CONFIG[st].labelEn}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <span className="text-[10px] text-stone-500 leading-snug">
                  {isArabic ? MINUTES_FINAL_DISCLAIMER_AR : MINUTES_FINAL_DISCLAIMER_EN}
                </span>
              </div>
            </div>

            {/* Locked Final Minutes Banner */}
            {minutesLocked && (
              <div
                data-testid="minutes-locked-banner"
                className="mx-4 mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center justify-between gap-2 flex-wrap shrink-0"
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    هذا المحضر في حالة <strong>نهائي</strong> (تنظيمي فقط وليس توقيعاً رقمياً). التعديل مقفل لمنع التغيير غير المقصود.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="reopen-final-minutes-btn"
                  onClick={() => setPendingReopenTarget('review')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100 font-semibold text-[11px]"
                >
                  <Unlock className="w-3 h-3" />
                  <span>إعادة فتح للتعديل</span>
                </button>
              </div>
            )}

            {/* Save / Sync Feedback Banners */}
            {workspaceNotice && (
              <div
                data-testid="workspace-save-notice"
                className="mx-4 mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 shrink-0"
              >
                <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{workspaceNotice}</span>
              </div>
            )}

            {workspaceSaveError && (
              <div
                data-testid="workspace-save-error"
                className="mx-4 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs flex items-center justify-between gap-2 shrink-0"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                  <span>{workspaceSaveError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void persistActiveMeeting(activeMeeting, 'تم حفظ المسودة.')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-700 text-white text-[11px] font-semibold shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>إعادة الحفظ</span>
                </button>
              </div>
            )}

            {/* Deletion Blocked / Notice Banners */}
            {deleteMeetingError && (
              <div
                data-testid="meeting-delete-blocked-banner"
                className="mx-4 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs space-y-2 shrink-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                    <span className="leading-relaxed font-medium">{deleteMeetingError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteMeetingError(null)}
                    aria-label="إغلاق تنبيه تعذر الحذف"
                    className="text-rose-500 hover:text-rose-800 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isOnline && deleteMeetingError.includes('لم تكتمل') && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleCleanupExpiredForMeeting()}
                      disabled={isCleaningExpired}
                      className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-semibold disabled:opacity-60"
                    >
                      {isCleaningExpired
                        ? 'جاري فحص وتنظيف العمليات المنتهية...'
                        : 'تنظيف عمليات الرفع المنتهية'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {deleteMeetingNotice && (
              <div
                data-testid="meeting-delete-notice-banner"
                className="mx-4 mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2 shrink-0"
              >
                <span>{deleteMeetingNotice}</span>
                <button
                  type="button"
                  onClick={() => setDeleteMeetingNotice(null)}
                  aria-label="إغلاق الملاحظة"
                  className="text-amber-600 hover:text-amber-900"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Section Navigation Bar */}
            <div className="px-4 py-2 bg-stone-100/80 border-b border-stone-200 flex items-center gap-1 overflow-x-auto text-[11px] shrink-0">
              {(
                [
                  { id: 'all', label: 'جميع الأقسام' },
                  { id: 'basic', label: '1. الأساسية' },
                  { id: 'participants', label: `2. المشاركون (${activeParticipants.length})` },
                  { id: 'agenda', label: `3. جدول الأعمال (${activeAgenda.length})` },
                  { id: 'discussions', label: '4. المناقشات' },
                  { id: 'decisions', label: `5. القرارات (${activeDecisions.length})` },
                  { id: 'followUp', label: `6. المتابعة والمهام (${activeMeetingTasks.length})` },
                  { id: 'ai', label: 'المساعد الذكي' },
                  { id: 'attachments', label: `المرفقات (${activeMeetingAttachmentsCount})` },
                ] as { id: WorkspaceSectionTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`workspace-tab-${tab.id}`}
                  onClick={() => setWorkspaceTab(tab.id)}
                  className={`px-2.5 py-1 rounded-lg font-semibold whitespace-nowrap transition-colors shrink-0 ${
                    workspaceTab === tab.id
                      ? 'bg-white text-stone-950 border border-stone-300'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable Workspace Sections */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 text-xs">
              {/* 1. BASIC INFO SECTION */}
              {(workspaceTab === 'all' || workspaceTab === 'basic') && (
                <section
                  data-testid="section-basic-info"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900">
                      1. المعلومات الأساسية للقاء
                    </h4>
                    <button
                      type="button"
                      disabled={minutesLocked}
                      onClick={() => setIsEditingBasicInfo((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 text-[11px] font-medium disabled:opacity-50"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>{isEditingBasicInfo ? 'إغلاق التحرير' : 'تعديل'}</span>
                    </button>
                  </div>

                  {isEditingBasicInfo && !minutesLocked ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block font-semibold text-stone-700 mb-1">
                          عنوان اللقاء
                        </label>
                        <input
                          type="text"
                          value={activeMeeting.title}
                          onChange={(e) =>
                            setActiveMeeting({ ...activeMeeting, title: e.target.value })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          العميل المرتبط
                        </label>
                        <select
                          value={activeMeeting.clientId}
                          onChange={(e) =>
                            setActiveMeeting({ ...activeMeeting, clientId: e.target.value })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
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
                          التاريخ والوقت
                        </label>
                        <input
                          type="datetime-local"
                          value={toDateTimeInputValue(activeMeeting.dateTime)}
                          onChange={(e) =>
                            setActiveMeeting({ ...activeMeeting, dateTime: e.target.value })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">نوع اللقاء</label>
                        <select
                          value={activeMeeting.type}
                          onChange={(e) =>
                            setActiveMeeting({
                              ...activeMeeting,
                              type: e.target.value as MeetingType,
                            })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
                        >
                          <option value="in_person">وجهاً لوجه</option>
                          <option value="video">مكالمة فيديو</option>
                          <option value="phone">مكالمة هاتفية</option>
                          <option value="chat">مراسلة مكتوبة</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">المكان</label>
                        <input
                          type="text"
                          value={activeMeeting.location || ''}
                          onChange={(e) =>
                            setActiveMeeting({ ...activeMeeting, location: e.target.value })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          المدة (بالدقائق)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={1440}
                          value={activeMeeting.duration ?? 60}
                          onChange={(e) =>
                            setActiveMeeting({
                              ...activeMeeting,
                              duration: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          حالة اللقاء
                        </label>
                        <select
                          value={activeMeeting.status}
                          onChange={(e) =>
                            setActiveMeeting({
                              ...activeMeeting,
                              status: e.target.value as MeetingStatus,
                            })
                          }
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
                        >
                          <option value="confirmed">مؤكدة</option>
                          <option value="completed">منتهية</option>
                          <option value="draft">مسودة</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingBasicInfo(false);
                            void persistActiveMeeting(
                              activeMeeting,
                              'تم حفظ المعلومات الأساسية.'
                            );
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white font-semibold text-xs hover:bg-emerald-800"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>حفظ المعلومات الأساسية</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs tabular-nums">
                      <div>
                        <span className="text-stone-500 block text-[11px]">العميل</span>
                        <span className="font-bold text-stone-900">
                          {clients.find((c) => c.id === activeMeeting.clientId)?.name || 'غير محدد'}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[11px]">التاريخ والوقت</span>
                        <span className="font-semibold text-stone-900">
                          {formatArabicDate(activeMeeting.dateTime, true)}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[11px]">النوع</span>
                        <span className="font-semibold text-stone-900">
                          {getMeetingTypeDetails(activeMeeting.type).label}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[11px]">المكان</span>
                        <span className="font-semibold text-stone-900">
                          {activeMeeting.location || 'غير محدد'}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[11px]">المدة</span>
                        <span className="font-semibold text-stone-900">
                          {activeMeeting.duration ? `${activeMeeting.duration} دقيقة` : 'غير محددة'}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-500 block text-[11px]">حالة اللقاء</span>
                        <span className="font-semibold text-stone-900">
                          {MEETING_STATUS_LABELS[activeMeeting.status][language]}
                        </span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* 2. PARTICIPANTS SECTION */}
              {(workspaceTab === 'all' || workspaceTab === 'participants') && (
                <section
                  data-testid="section-participants"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-emerald-700" />
                      <span>2. المشاركون ({activeParticipants.length})</span>
                    </h4>
                    <span className="text-[11px] text-stone-500">
                      تمييز تلقائي بين الداخليين والخارجيين
                    </span>
                  </div>

                  {activeParticipants.length === 0 ? (
                    <p className="text-stone-500 text-xs bg-stone-50 p-3 rounded-xl border border-dashed border-stone-200">
                      لم تتم إضافة مشاركين بعد. أضف أسماء الحضور وصفتهم (داخلي / خارجي).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeParticipants.map((p) => (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/50 flex items-center justify-between gap-2 flex-wrap"
                        >
                          {editingParticipantId === p.id ? (
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <input
                                type="text"
                                value={editPartName}
                                onChange={(e) => setEditPartName(e.target.value)}
                                className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs"
                                placeholder="الاسم"
                              />
                              <input
                                type="text"
                                value={editPartRole}
                                onChange={(e) => setEditPartRole(e.target.value)}
                                className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs"
                                placeholder="الصفة / الدور"
                              />
                              <select
                                value={editPartParty}
                                onChange={(e) =>
                                  setEditPartParty(e.target.value as ParticipantParty)
                                }
                                className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs"
                              >
                                <option value="external">خارجي (العميل)</option>
                                <option value="internal">داخلي (فريقنا)</option>
                              </select>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={handleSaveParticipantEdit}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold"
                                >
                                  حفظ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingParticipantId(null)}
                                  className="px-2 py-1 rounded-lg border border-stone-200 text-stone-600 text-[11px]"
                                >
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-stone-900">{p.name}</span>
                                {p.role && (
                                  <span className="text-stone-500 text-[11px]">— {p.role}</span>
                                )}
                                <span
                                  className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                                    p.party === 'internal'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : 'bg-sky-50 text-sky-800 border-sky-200'
                                  }`}
                                >
                                  {p.party === 'internal' ? 'داخلي' : 'خارجي'}
                                </span>
                              </div>
                              {!minutesLocked && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingParticipantId(p.id);
                                      setEditPartName(p.name);
                                      setEditPartRole(p.role || '');
                                      setEditPartParty(p.party);
                                    }}
                                    className="p-1 text-stone-500 hover:text-stone-900 rounded"
                                    aria-label={`تعديل ${p.name}`}
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveParticipant(p.id)}
                                    className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                    aria-label={`حذف ${p.name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!minutesLocked && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-stone-100">
                      <input
                        type="text"
                        data-testid="participant-name-input"
                        value={newParticipantName}
                        onChange={(e) => setNewParticipantName(e.target.value)}
                        placeholder="اسم المشارك..."
                        className="sm:col-span-4 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                      />
                      <input
                        type="text"
                        value={newParticipantRole}
                        onChange={(e) => setNewParticipantRole(e.target.value)}
                        placeholder="الدور (اختياري)..."
                        className="sm:col-span-3 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                      />
                      <select
                        value={newParticipantParty}
                        onChange={(e) =>
                          setNewParticipantParty(e.target.value as ParticipantParty)
                        }
                        className="sm:col-span-3 bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5 text-xs"
                      >
                        <option value="external">خارجي (العميل)</option>
                        <option value="internal">داخلي (فريقنا)</option>
                      </select>
                      <button
                        type="button"
                        data-testid="add-participant-btn"
                        onClick={handleAddParticipant}
                        className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة</span>
                      </button>
                    </div>
                  )}
                </section>
              )}

              {/* 3. AGENDA SECTION */}
              {(workspaceTab === 'all' || workspaceTab === 'agenda') && (
                <section
                  data-testid="section-agenda"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900">
                      3. جدول الأعمال ({activeAgenda.length})
                    </h4>
                    <span className="text-[11px] text-stone-500">
                      رتّب البنود وسجّل ملاحظات كل بند
                    </span>
                  </div>

                  {activeAgenda.length === 0 ? (
                    <p className="text-stone-500 text-xs bg-stone-50 p-3 rounded-xl border border-dashed border-stone-200">
                      لا توجد بنود في جدول الأعمال بعد. يمكنك إضافتها أدناه أو تطبيق أحد القوالب.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeAgenda.map((item, idx) => (
                        <div
                          key={item.id}
                          data-testid={`agenda-item-${item.id}`}
                          className="p-3 rounded-xl border border-stone-200 bg-stone-50/50 space-y-2"
                        >
                          {editingAgendaId === item.id && !minutesLocked ? (
                            <AgendaInlineEditor
                              item={item}
                              onSave={(patch) => {
                                handleUpdateAgendaItem(item.id, patch);
                                setEditingAgendaId(null);
                              }}
                              onCancel={() => setEditingAgendaId(null)}
                            />
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-bold text-stone-900 tabular-nums">
                                    {item.order}. {item.title}
                                    {item.durationMinutes ? (
                                      <span className="text-[11px] font-mono text-stone-500 font-normal ms-2">
                                        ({item.durationMinutes} د)
                                      </span>
                                    ) : null}
                                  </div>
                                  {item.notes && (
                                    <p className="text-[11px] text-stone-700 mt-1 whitespace-pre-line leading-relaxed">
                                      {item.notes}
                                    </p>
                                  )}
                                </div>

                                {!minutesLocked && (
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                      type="button"
                                      data-testid={`agenda-up-${idx}`}
                                      disabled={idx === 0}
                                      onClick={() => handleReorderAgenda(item.id, 'up')}
                                      className="p-1 text-stone-500 hover:text-stone-900 disabled:opacity-30 rounded"
                                      title="تحريك للأعلى"
                                      aria-label="تحريك البند للأعلى"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`agenda-down-${idx}`}
                                      disabled={idx === activeAgenda.length - 1}
                                      onClick={() => handleReorderAgenda(item.id, 'down')}
                                      className="p-1 text-stone-500 hover:text-stone-900 disabled:opacity-30 rounded"
                                      title="تحريك للأسفل"
                                      aria-label="تحريك البند للأسفل"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingAgendaId(item.id)}
                                      className="p-1 text-stone-500 hover:text-stone-900 rounded"
                                      aria-label="تعديل البند"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAgendaItem(item.id)}
                                      className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                      aria-label="حذف البند"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!minutesLocked && (
                    <div className="pt-2 border-t border-stone-100 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <input
                          type="text"
                          data-testid="new-agenda-title-input"
                          value={newAgendaTitle}
                          onChange={(e) => setNewAgendaTitle(e.target.value)}
                          placeholder="عنوان بند جدول الأعمال..."
                          className="sm:col-span-7 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                        />
                        <input
                          type="number"
                          min={1}
                          max={240}
                          value={newAgendaDuration}
                          onChange={(e) => setNewAgendaDuration(e.target.value)}
                          placeholder="المدة (د)"
                          className="sm:col-span-2 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs tabular-nums"
                        />
                        <button
                          type="button"
                          data-testid="add-agenda-btn"
                          onClick={handleAddAgendaItem}
                          className="sm:col-span-3 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>إضافة بند</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={newAgendaNotes}
                        onChange={(e) => setNewAgendaNotes(e.target.value)}
                        placeholder="ملاحظات البند (اختياري)..."
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  )}
                </section>
              )}

              {/* 4. DISCUSSIONS SECTION (with backward compatibility for legacy `notes`) */}
              {(workspaceTab === 'all' || workspaceTab === 'discussions') && (
                <section
                  data-testid="section-discussions"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900">
                      4. المناقشات ومجريات الاجتماع
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowLegacyNotesEditor((v) => !v)}
                      className="text-[11px] font-medium text-stone-600 hover:text-stone-900 underline"
                    >
                      {showLegacyNotesEditor
                        ? 'إخفاء سجل الملاحظات النصية السابقة'
                        : 'عرض سجل الملاحظات النصية السابقة'}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-semibold text-stone-700 text-[11px]">
                      ملخص المناقشات المنظّم:
                    </label>
                    <textarea
                      rows={5}
                      data-testid="discussion-summary-input"
                      disabled={minutesLocked}
                      value={draftDiscussionSummary}
                      onChange={(e) => setDraftDiscussionSummary(e.target.value)}
                      placeholder="سجّل خلاصة ما تمت مناقشته والاعتبارات المهمة..."
                      className="w-full bg-stone-50 rounded-xl border border-stone-200 p-3 text-xs text-stone-800 leading-relaxed focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden disabled:opacity-70"
                    />
                  </div>

                  {showLegacyNotesEditor && (
                    <div className="space-y-1.5 pt-2 border-t border-stone-100">
                      <label className="block font-semibold text-stone-700 text-[11px]">
                        سجل الملاحظات النصية / المحضر التراكمي (متوافق مع اللقاءات السابقة):
                      </label>
                      <textarea
                        rows={4}
                        data-testid="legacy-notes-input"
                        disabled={minutesLocked}
                        value={draftLegacyNotes}
                        onChange={(e) => setDraftLegacyNotes(e.target.value)}
                        placeholder="ملاحظات نصية عامة أو محتوى محضر سابق..."
                        className="w-full bg-stone-50 rounded-xl border border-stone-200 p-3 text-xs text-stone-700 leading-relaxed font-mono focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden disabled:opacity-70"
                      />
                    </div>
                  )}

                  {!minutesLocked && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="save-discussions-btn"
                        onClick={handleSaveDiscussions}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>حفظ المناقشات</span>
                      </button>
                    </div>
                  )}
                </section>
              )}

              {/* 5. DECISIONS SECTION */}
              {(workspaceTab === 'all' || workspaceTab === 'decisions') && (
                <section
                  data-testid="section-decisions"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900">
                      5. القرارات المعتمدة ({activeDecisions.length})
                    </h4>
                    <span className="text-[11px] text-stone-500">
                      ربط اختياري ببند جدول الأعمال وتحديد المسؤول
                    </span>
                  </div>

                  {activeDecisions.length === 0 ? (
                    <p className="text-stone-500 text-xs bg-stone-50 p-3 rounded-xl border border-dashed border-stone-200">
                      لم تُسجل قرارات منفصلة بعد. أضف كل قرار مع ربطه بالبند المعني إن وجد.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeDecisions.map((decision, idx) => {
                        const linkedAgenda = activeAgenda.find(
                          (a) => a.id === decision.agendaItemId
                        );
                        return (
                          <div
                            key={decision.id}
                            data-testid={`decision-row-${decision.id}`}
                            className="p-3 rounded-xl border border-stone-200 bg-stone-50/50 space-y-1.5"
                          >
                            {editingDecisionId === decision.id && !minutesLocked ? (
                              <DecisionInlineEditor
                                decision={decision}
                                agendaItems={activeAgenda}
                                participants={activeParticipants}
                                onSave={(patch) => {
                                  handleUpdateDecision(decision.id, patch);
                                  setEditingDecisionId(null);
                                }}
                                onCancel={() => setEditingDecisionId(null)}
                              />
                            ) : (
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                  <div className="font-bold text-stone-900 tabular-nums">
                                    {idx + 1}. {decision.text}
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px] text-stone-600 flex-wrap">
                                    {linkedAgenda && (
                                      <span>
                                        البند المرتبط: {linkedAgenda.order}. {linkedAgenda.title}
                                      </span>
                                    )}
                                    {decision.ownerName && (
                                      <span>المسؤول: {decision.ownerName}</span>
                                    )}
                                  </div>
                                </div>

                                {!minutesLocked && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setEditingDecisionId(decision.id)}
                                      className="p-1 text-stone-500 hover:text-stone-900 rounded"
                                      aria-label="تعديل القرار"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveDecision(decision.id)}
                                      className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                      aria-label="حذف القرار"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!minutesLocked && (
                    <div className="pt-2 border-t border-stone-100 space-y-2">
                      <input
                        type="text"
                        data-testid="new-decision-text-input"
                        value={newDecisionText}
                        onChange={(e) => setNewDecisionText(e.target.value)}
                        placeholder="نص القرار المتفق عليه..."
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <select
                          value={newDecisionAgendaId}
                          onChange={(e) => setNewDecisionAgendaId(e.target.value)}
                          className="sm:col-span-5 bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5 text-xs"
                        >
                          <option value="">ربط ببند جدول الأعمال (اختياري)</option>
                          {activeAgenda.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.order}. {item.title}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          list="murafiq-participants-datalist"
                          value={newDecisionOwner}
                          onChange={(e) => setNewDecisionOwner(e.target.value)}
                          placeholder="المسؤول / المتابع (اختياري)"
                          className="sm:col-span-4 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                        />
                        <datalist id="murafiq-participants-datalist">
                          {activeParticipants.map((p) => (
                            <option key={p.id} value={p.name} />
                          ))}
                        </datalist>
                        <button
                          type="button"
                          data-testid="add-decision-btn"
                          onClick={handleAddDecision}
                          className="sm:col-span-3 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>إضافة قرار</span>
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* 6. FOLLOW-UP & LINKED TASKS SECTION */}
              {(workspaceTab === 'all' || workspaceTab === 'followUp') && (
                <section
                  data-testid="section-follow-up"
                  className="border border-stone-200 rounded-2xl p-4 bg-white space-y-4"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
                    <h4 className="font-heading font-bold text-sm text-stone-900 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-emerald-700" />
                      <span>6. المتابعة والمهام المرتبطة ({activeMeetingTasks.length})</span>
                    </h4>
                  </div>

                  {/* Next Follow-up Date/Time */}
                  <div className="p-3 rounded-xl bg-stone-50/70 border border-stone-200 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="block font-semibold text-stone-700 text-[11px]">
                        موعد المتابعة / اللقاء القادم:
                      </label>
                      <input
                        type="datetime-local"
                        data-testid="followup-datetime-input"
                        disabled={minutesLocked}
                        value={toDateTimeInputValue(activeMeeting.followUpDateTime)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setActiveMeeting({
                            ...activeMeeting,
                            followUpDateTime: val,
                            isFollowUpScheduled: Boolean(val),
                          });
                        }}
                        className="w-full sm:w-auto bg-white border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs tabular-nums disabled:opacity-70"
                      />
                    </div>
                    {!minutesLocked && (
                      <button
                        type="button"
                        data-testid="save-followup-date-btn"
                        onClick={() =>
                          void persistActiveMeeting(
                            activeMeeting,
                            'تم حفظ موعد المتابعة القادم.'
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs shrink-0"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>حفظ موعد المتابعة</span>
                      </button>
                    )}
                  </div>

                  {/* Linked Tasks List */}
                  {activeMeetingTasks.length === 0 ? (
                    <p className="text-stone-500 text-xs bg-stone-50 p-3 rounded-xl border border-dashed border-stone-200">
                      لا توجد مهام مرتبطة بهذا اللقاء حتى الآن. أنشئ مهمة يدوياً أدناه.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeMeetingTasks.map((task) => {
                        const isDone = task.status === 'completed';
                        return (
                          <div
                            key={task.id}
                            data-testid={`linked-task-${task.id}`}
                            className="p-3 rounded-xl border border-stone-200 bg-stone-50/50 flex items-start justify-between gap-2.5"
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              {onToggleTask && (
                                <button
                                  type="button"
                                  onClick={() => onToggleTask(task.id)}
                                  className={`w-4 h-4 rounded border mt-0.5 shrink-0 flex items-center justify-center ${
                                    isDone
                                      ? 'bg-emerald-700 border-emerald-700 text-white'
                                      : 'border-stone-400 bg-white'
                                  }`}
                                  aria-label={`تبديل حالة ${task.title}`}
                                >
                                  {isDone && <Check className="w-3 h-3" />}
                                </button>
                              )}
                              <div className="min-w-0">
                                <div
                                  className={`font-bold text-stone-900 ${
                                    isDone ? 'line-through text-stone-500' : ''
                                  }`}
                                >
                                  {task.title}
                                </div>
                                {task.description && (
                                  <p className="text-[11px] text-stone-600 mt-0.5">
                                    {task.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-3 mt-1 text-[10px] text-stone-500 tabular-nums">
                                  <span>
                                    الحالة:{' '}
                                    {task.status === 'completed'
                                      ? 'منجزة'
                                      : task.status === 'in_progress'
                                      ? 'قيد التنفيذ'
                                      : 'معلقة'}
                                  </span>
                                  <span>
                                    الاستحقاق:{' '}
                                    {task.dueDate ? formatArabicDate(task.dueDate) : 'غير محدد'}
                                  </span>
                                  <span>
                                    الأهمية:{' '}
                                    {task.priority === 'urgent'
                                      ? 'عاجلة'
                                      : task.priority === 'high'
                                      ? 'عالية'
                                      : task.priority === 'medium'
                                      ? 'متوسطة'
                                      : 'منخفضة'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Manual Linked Task Form with Duplicate Prevention */}
                  <form
                    onSubmit={handleCreateLinkedTask}
                    className="pt-3 border-t border-stone-100 space-y-2.5"
                    data-testid="manual-meeting-task-form"
                  >
                    <div className="font-bold text-stone-800 text-xs flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                      <span>إنشاء مهمة يدوية مرتبطة بهذا اللقاء:</span>
                    </div>

                    {taskCreateError && (
                      <div
                        data-testid="duplicate-task-warning"
                        className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-[11px] flex items-center gap-2"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>{taskCreateError}</span>
                      </div>
                    )}

                    {taskCreateNotice && (
                      <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>{taskCreateNotice}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <input
                        type="text"
                        data-testid="linked-task-title-input"
                        value={newTaskTitle}
                        onChange={(e) => {
                          setNewTaskTitle(e.target.value);
                          setTaskCreateError(null);
                        }}
                        placeholder="عنوان المهمة أو الالتزام..."
                        className="sm:col-span-5 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                      />
                      <input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="sm:col-span-3 bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5 text-xs tabular-nums"
                      />
                      <select
                        value={newTaskPriority}
                        onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                        className="sm:col-span-2 bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5 text-xs"
                      >
                        <option value="urgent">عاجلة</option>
                        <option value="high">عالية</option>
                        <option value="medium">متوسطة</option>
                        <option value="low">منخفضة</option>
                      </select>
                      <button
                        type="submit"
                        data-testid="create-linked-task-btn"
                        className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newTaskDescription}
                      onChange={(e) => setNewTaskDescription(e.target.value)}
                      placeholder="تفاصيل المهمة أو المسؤول عن التنفيذ (اختياري)..."
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs"
                    />
                  </form>
                </section>
              )}

              {/* Legacy Photos Preview (if any exist on legacy meetings) */}
              {(workspaceTab === 'all' || workspaceTab === 'attachments') &&
                activeMeeting.photoPaths.length > 0 && (
                  <section className="border border-stone-200 rounded-2xl p-4 bg-white space-y-2">
                    <h4 className="font-heading font-bold text-xs text-stone-800">
                      صور سابقة مرفقة ({activeMeeting.photoPaths.length})
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeMeeting.photoPaths.map((photo, i) => (
                        <div
                          key={i}
                          onClick={() => setSelectedImage(photo)}
                          className="relative rounded-xl overflow-hidden border border-stone-200 aspect-video cursor-pointer hover:border-emerald-500"
                        >
                          <img src={photo} alt="Meeting" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

              {/* Cloud Attachments Section (Backblaze B2 metadata + Task 004-A-Fix-03) */}
              {(workspaceTab === 'all' || workspaceTab === 'attachments') && (
                <MeetingAttachmentsSection
                  meetingId={activeMeeting.id}
                  isOnline={isOnline}
                  onAttachmentsCountChange={setActiveMeetingAttachmentsCount}
                />
              )}

              {/* Intelligent Meeting Assistant (Task 004-C) */}
              {(workspaceTab === 'all' || workspaceTab === 'ai') && (
                <MeetingAiAssistant
                  meeting={activeMeeting}
                  clientName={clients.find((c) => c.id === activeMeeting.clientId)?.name}
                  tasks={tasks}
                  agendaItems={activeAgenda}
                  isOnline={isOnline}
                  onPersistMeetingUpdate={persistActiveMeeting}
                  onSaveTask={onSaveTask || (() => onNewTaskFromMeeting(activeMeeting))}
                  onRequestReopenMinutes={() => setPendingReopenTarget('review')}
                  openConsentTrigger={aiConsentTrigger}
                  requestAnalysisFn={requestAiAnalysisFn}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reopen Final Minutes Confirmation Dialog */}
      {pendingReopenTarget && activeMeeting && (
        <div
          data-testid="reopen-final-confirm-modal"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 border border-stone-200 space-y-3">
            <div className="flex items-center gap-2 text-amber-800">
              <Unlock className="w-5 h-5" />
              <h4 className="font-heading font-bold text-sm">
                تأكيد إعادة فتح المحضر النهائي
              </h4>
            </div>
            <p className="text-xs text-stone-700 leading-relaxed">
              هذا المحضر مضبوط حالياً على حالة <strong>نهائي</strong> (تنظيمية). هل تريد إعادة فتحه إلى{' '}
              <strong>{MINUTES_STATUS_CONFIG[pendingReopenTarget].labelAr}</strong> لإتاحة التعديل؟
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingReopenTarget(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-stone-600 hover:bg-stone-100 font-medium"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="confirm-reopen-final-btn"
                onClick={handleConfirmReopenFinalMinutes}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-700 text-white hover:bg-amber-800"
              >
                نعم، أعد الفتح للتعديل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safe Meeting Deletion Confirmation Dialog */}
      {confirmDeleteMeeting && activeMeeting && (
        <div
          data-testid="meeting-delete-confirm-modal"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 border border-stone-200 space-y-3">
            <div className="flex items-center gap-2 text-rose-800">
              <Trash2 className="w-5 h-5" />
              <h4 className="font-heading font-bold text-sm">تأكيد حذف اللقاء</h4>
            </div>
            <p className="text-xs text-stone-700 leading-relaxed">
              هل أنت متأكد من حذف اللقاء{' '}
              <strong className="text-stone-900">{activeMeeting.title}</strong>؟ لا يمكن التراجع عن هذه العملية بعد تأكيدها.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteMeeting(false)}
                disabled={isDeletingMeeting}
                className="px-3 py-1.5 rounded-xl text-xs text-stone-600 hover:bg-stone-100 font-medium"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="confirm-delete-meeting-btn"
                onClick={() => void handleConfirmDeleteMeeting()}
                disabled={isDeletingMeeting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-60"
              >
                <span>{isDeletingMeeting ? 'جاري التحقق والحذف...' : 'تأكيد الحذف'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox for legacy attached photos */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <img
              src={selectedImage}
              alt="Meeting zoom"
              className="rounded-xl max-h-[85vh] object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute top-2 right-2 p-2 bg-stone-900/80 text-white rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Create New Meeting Modal */}
      {isCreateModalOpen && creatingMeeting && (
        <div
          data-testid="create-meeting-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-auto overflow-hidden border border-stone-200 p-5 max-h-[94vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-stone-900">
                  جدولة لقاء جديد
                </h3>
                <p className="text-[11px] text-stone-500">
                  أنشئ اللقاء ثم أكمل المشاركين وجدول الأعمال والمحضر في مساحة العمل
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-xs">
              <span className="text-stone-700 font-medium">
                {creatingMeeting.agendaItems && creatingMeeting.agendaItems.length > 0
                  ? `تم تجهيز ${creatingMeeting.agendaItems.length} بنود جدول أعمال من القالب`
                  : 'تعبئة سريعة من قوالب الاجتماعات القابلة للتعديل'}
              </span>
              <button
                type="button"
                onClick={() => setTemplateTarget('create')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-stone-300 hover:bg-emerald-50 text-emerald-800 font-semibold text-[11px]"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>اختيار / تعديل قالب</span>
              </button>
            </div>

            <form onSubmit={handleSaveNewMeeting} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  العميل / جهة الاتصال <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={creatingMeeting.clientId || ''}
                  onChange={(e) =>
                    setCreatingMeeting({ ...creatingMeeting, clientId: e.target.value })
                  }
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs"
                >
                  {clients.length === 0 ? (
                    <option value="">أضف عميلاً أولاً من تبويب العملاء</option>
                  ) : (
                    clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  عنوان أو موضوع اللقاء <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={creatingMeeting.title || ''}
                  onChange={(e) =>
                    setCreatingMeeting({ ...creatingMeeting, title: e.target.value })
                  }
                  placeholder="مثال: اجتماع مناقشة متطلبات المرحلة الأولى"
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    تاريخ ووقت اللقاء
                  </label>
                  <input
                    type="datetime-local"
                    value={creatingMeeting.dateTime || ''}
                    onChange={(e) =>
                      setCreatingMeeting({ ...creatingMeeting, dateTime: e.target.value })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">نوع اللقاء</label>
                  <select
                    value={creatingMeeting.type || 'in_person'}
                    onChange={(e) =>
                      setCreatingMeeting({
                        ...creatingMeeting,
                        type: e.target.value as MeetingType,
                      })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs"
                  >
                    <option value="in_person">وجهاً لوجه</option>
                    <option value="video">مكالمة فيديو</option>
                    <option value="phone">مكالمة هاتفية</option>
                    <option value="chat">مراسلة مكتوبة</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">المكان</label>
                  <input
                    type="text"
                    value={creatingMeeting.location || ''}
                    onChange={(e) =>
                      setCreatingMeeting({ ...creatingMeeting, location: e.target.value })
                    }
                    placeholder="مقر العميل..."
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">المدة (د)</label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={creatingMeeting.duration ?? 45}
                    onChange={(e) =>
                      setCreatingMeeting({
                        ...creatingMeeting,
                        duration: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">الحالة</label>
                  <select
                    value={creatingMeeting.status || 'confirmed'}
                    onChange={(e) =>
                      setCreatingMeeting({
                        ...creatingMeeting,
                        status: e.target.value as MeetingStatus,
                      })
                    }
                    className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs"
                  >
                    <option value="confirmed">مؤكدة</option>
                    <option value="completed">منتهية</option>
                    <option value="draft">مسودة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  ملخص مبدئي للمناقشة (اختياري)
                </label>
                <textarea
                  rows={3}
                  value={creatingMeeting.discussionSummary || ''}
                  onChange={(e) =>
                    setCreatingMeeting({
                      ...creatingMeeting,
                      discussionSummary: e.target.value,
                    })
                  }
                  placeholder="أهداف اللقاء أو نقاط تمهيدية..."
                  className="w-full bg-stone-50 rounded-xl border border-stone-200 p-2 text-xs leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-stone-600 hover:bg-stone-100 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={!creatingMeeting.clientId || !creatingMeeting.title?.trim()}
                  className="px-4 py-1.5 rounded-xl text-white bg-emerald-700 hover:bg-emerald-800 font-semibold disabled:opacity-50"
                >
                  حفظ وفتح مساحة العمل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Editable Meeting Templates Modal */}
      <MeetingTemplateModal
        isOpen={templateTarget !== null}
        onClose={() => setTemplateTarget(null)}
        templates={MEETING_TEMPLATES}
        customOverrides={templateOverrides}
        onSaveTemplateOverride={(id, override) =>
          setTemplateOverrides((prev) => ({ ...prev, [id]: override }))
        }
        onResetTemplateOverride={(id) =>
          setTemplateOverrides((prev) => {
            const copy = { ...prev };
            delete copy[id];
            return copy;
          })
        }
        onApplyTemplate={handleApplyTemplate}
        language={language}
      />
    </div>
  );
};

// =========================================================================
// Inline Editor Subcomponents
// =========================================================================

const AgendaInlineEditor: React.FC<{
  item: MeetingAgendaItem;
  onSave: (patch: Partial<Pick<MeetingAgendaItem, 'title' | 'notes' | 'durationMinutes'>>) => void;
  onCancel: () => void;
}> = ({ item, onSave, onCancel }) => {
  const [title, setTitle] = useState(item.title);
  const [duration, setDuration] = useState(
    item.durationMinutes ? String(item.durationMinutes) : ''
  );
  const [notes, setNotes] = useState(item.notes || '');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
          placeholder="عنوان البند"
        />
        <input
          type="number"
          min={1}
          max={240}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-16 bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs tabular-nums"
          placeholder="د"
        />
      </div>
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
        placeholder="ملاحظات البند"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 text-[11px]"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={() => {
            const parsed = parseInt(duration, 10);
            onSave({
              title,
              notes,
              durationMinutes: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
            });
          }}
          className="px-3 py-1 rounded-lg bg-emerald-700 text-white font-semibold text-[11px]"
        >
          حفظ البند
        </button>
      </div>
    </div>
  );
};

const DecisionInlineEditor: React.FC<{
  decision: MeetingDecision;
  agendaItems: MeetingAgendaItem[];
  participants: MeetingParticipant[];
  onSave: (patch: Partial<Pick<MeetingDecision, 'text' | 'agendaItemId' | 'ownerName'>>) => void;
  onCancel: () => void;
}> = ({ decision, agendaItems, participants, onSave, onCancel }) => {
  const [text, setText] = useState(decision.text);
  const [agendaItemId, setAgendaItemId] = useState(decision.agendaItemId || '');
  const [ownerName, setOwnerName] = useState(decision.ownerName || '');

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
        placeholder="نص القرار"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={agendaItemId}
          onChange={(e) => setAgendaItemId(e.target.value)}
          className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
        >
          <option value="">بدون ربط ببند</option>
          {agendaItems.map((a) => (
            <option key={a.id} value={a.id}>
              {a.order}. {a.title}
            </option>
          ))}
        </select>
        <input
          type="text"
          list="murafiq-edit-decision-owners"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="المسؤول"
          className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs"
        />
        <datalist id="murafiq-edit-decision-owners">
          {participants.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 text-[11px]"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={() => onSave({ text, agendaItemId, ownerName })}
          className="px-3 py-1 rounded-lg bg-emerald-700 text-white font-semibold text-[11px]"
        >
          حفظ القرار
        </button>
      </div>
    </div>
  );
};
