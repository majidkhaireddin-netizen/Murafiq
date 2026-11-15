import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User } from 'firebase/auth';
import {
  AppState,
  Client,
  Meeting,
  ActionItem,
  Note,
  Opportunity,
  OpportunityStage,
  OpportunityStageEvent,
  CommunicationChannel,
  CommunicationInteraction,
  ConflictItem,
  ResolutionChoice,
  RejectedWriteRecord,
  ReminderStateRecord,
  FollowUpPreferences,
  ReminderItem,
  SnoozePreset,
  PlaybookTemplate,
  PlaybookRun,
  PlaybookRunStep,
  PlaybookRescheduleSuggestion,
} from '../types';
import { categorizeTasks } from '../utils/logic';
import {
  buildOpportunityStageTransition,
  convertNextActionToTaskDraft,
  createInitialOpportunityEvent,
  generateDeterministicOpportunityId,
  linkMeetingToOpportunity,
  linkTaskToOpportunity,
  sanitizeOpportunityForSave,
  unlinkMeetingFromOpportunity,
  unlinkTaskFromOpportunity,
} from '../utils/opportunities';
import { Header } from './Header';
import { BottomNav, NavTab } from './BottomNav';
import { DashboardView } from './views/DashboardView';
import { TodayView } from './views/TodayView';
import { ClientsView, ClientsFilterTrigger } from './views/ClientsView';
import { CommunicationsView, CommunicationsSubTab } from './views/CommunicationsView';
import { OpportunitiesView } from './views/OpportunitiesView';
import { MeetingsView, MeetingsFilterTrigger } from './views/MeetingsView';
import { TasksView, TasksFilterTrigger } from './views/TasksView';
import { ReportsView } from './views/ReportsView';
import { CalendarView, CalendarNavigationTrigger } from './views/CalendarView';
import {
  buildCalendarEvents,
  detectCalendarConflicts,
  getLocalTimeZoneName,
  loadUserCalendarSettings,
  saveUserCalendarSettings,
} from '../utils/calendarEngine';
import type { CalendarSettings, CalendarViewMode } from '../types';
import type { AnalyticsDrillDownTarget } from '../utils/analytics';
import { OpportunityCloseModal } from './OpportunityCloseModal';
import { InteractionFormModal } from './InteractionFormModal';
import { MeetingMinutesPdfModal } from './MeetingMinutesPdfModal';
import { BiometricLockModal } from './BiometricLockModal';
import { SearchModal } from './SearchModal';
import { SettingsModal } from './SettingsModal';
import { ConflictResolutionModal } from './ConflictResolutionModal';
import { PlaybookStartModal } from './PlaybookStartModal';
import { PlaybookTemplateEditorModal } from './PlaybookTemplateEditorModal';
import {
  AtomicStepTaskCreationOutcome,
  PlaybookOfflineSyncQueue,
  checkPlaybookRunRevisionConflict,
  executeAtomicStepTaskConversion,
  linkCommunicationToPlaybookStep,
  sanitizePlaybookRunForSave,
  sanitizePlaybookTemplateForSave,
} from '../utils/playbookEngine';
import {
  computeCommunicationCenterSummary,
  unlinkInteractionReferencesOnDelete,
} from '../utils/communications';
import { detectEntityConflict, resolveConflictRecord } from '../utils/conflictLogic';
import {
  computeDetailedSyncSummary,
  canSafelySignOut,
  CollectionSyncStatus,
  CollectionKey,
} from '../utils/syncLogic';
import {
  DEFAULT_FOLLOW_UP_PREFERENCES,
  FOLLOW_UP_PREFERENCES_DOC_ID,
  buildDailyClientFollowUps,
  buildResolvedStateRecord,
  buildSnoozeStateRecord,
  categorizeDailyWorkTasks,
  computeDailyCommandSummary,
  computeSnoozeUntilIso,
  evaluateReminders,
  getUpcomingMeetingsForDailyCenter,
  normalizeFollowUpPreferences,
} from '../utils/followUpEngine';
import {
  getCacheRuntimeState,
  subscribeClients,
  subscribeMeetings,
  subscribeTasks,
  subscribeNotes,
  subscribeOpportunities,
  subscribeOpportunityStageEvents,
  subscribeInteractions,
  subscribeReminders,
  subscribeFollowUpPreferences,
  saveClient as fbSaveClient,
  deleteClient as fbDeleteClient,
  saveMeeting as fbSaveMeeting,
  deleteMeeting as fbDeleteMeeting,
  saveTask as fbSaveTask,
  deleteTask as fbDeleteTask,
  saveNote as fbSaveNote,
  deleteNote as fbDeleteNote,
  saveOpportunity as fbSaveOpportunity,
  deleteOpportunity as fbDeleteOpportunity,
  saveOpportunityStageEvent as fbSaveOpportunityStageEvent,
  deleteOpportunityStageEvent as fbDeleteOpportunityStageEvent,
  saveInteraction as fbSaveInteraction,
  deleteInteraction as fbDeleteInteraction,
  saveReminderState as fbSaveReminderState,
  deleteReminderState as fbDeleteReminderState,
  saveFollowUpPreferences as fbSaveFollowUpPreferences,
  subscribePlaybookTemplates,
  subscribePlaybookRuns,
  savePlaybookTemplate as fbSavePlaybookTemplate,
  deletePlaybookTemplate as fbDeletePlaybookTemplate,
  savePlaybookRun as fbSavePlaybookRun,
  savePlaybookRunAtomic,
  PlaybookRevisionConflictError,
  deletePlaybookRun as fbDeletePlaybookRun,
  firestorePlaybookAtomicAdapter,
} from '../services/firebase';
import { AlertTriangle, WifiOff, RefreshCw, X, Download, Copy, Check } from 'lucide-react';
import {
  OperationCoordinator,
  WriteErrorClassification,
  applyScopedConfirmation,
  applyScopedRejection,
  serializeRejectedDraftJson,
  formatRejectedDraftClipboardText,
} from '../utils/sessionState';
import { clearAttachmentDownloadCache, syncAttachmentCacheUser } from '../utils/attachmentDownloadCache';
import { MEETING_HAS_ATTACHMENTS_MESSAGE_AR } from '../utils/attachmentPolicy';

interface AuthenticatedSessionProps {
  user: User;
  onSignOut: () => Promise<void>;
  isMobileFrame: boolean;
  onToggleMobileFrame: () => void;
}

export function AuthenticatedSession({
  user,
  onSignOut,
  isMobileFrame,
  onToggleMobileFrame,
}: AuthenticatedSessionProps) {
  // Pure User-Scoped State (Instantiated per authenticated UID)
  const [clients, setClients] = useState<Client[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<ActionItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunityStageEvents, setOpportunityStageEvents] = useState<OpportunityStageEvent[]>([]);
  const [interactions, setInteractions] = useState<CommunicationInteraction[]>([]);
  const [reminders, setReminders] = useState<ReminderStateRecord[]>([]);
  const [followUpPreferences, setFollowUpPreferences] = useState<FollowUpPreferences>(() => ({
    ...DEFAULT_FOLLOW_UP_PREFERENCES,
    userId: user.uid,
  }));
  const [playbookTemplates, setPlaybookTemplates] = useState<PlaybookTemplate[]>([]);
  const [playbookRuns, setPlaybookRuns] = useState<PlaybookRun[]>([]);

  // Live clock referenceDate so day rollovers, overdue transitions, imminent meetings, and snooze wake-ups update dynamically
  const [referenceDate, setReferenceDate] = useState<Date>(() => new Date());

  // Live refs for deterministic per-entity previous-state lookup across concurrent operations
  const clientsRef = useRef<Client[]>(clients);
  const meetingsRef = useRef<Meeting[]>(meetings);
  const tasksRef = useRef<ActionItem[]>(tasks);
  const notesRef = useRef<Note[]>(notes);
  const opportunitiesRef = useRef<Opportunity[]>(opportunities);
  const opportunityStageEventsRef = useRef<OpportunityStageEvent[]>(opportunityStageEvents);
  const interactionsRef = useRef<CommunicationInteraction[]>(interactions);
  const remindersRef = useRef<ReminderStateRecord[]>(reminders);
  const followUpPrefsRef = useRef<FollowUpPreferences>(followUpPreferences);
  const playbookTemplatesRef = useRef<PlaybookTemplate[]>(playbookTemplates);
  const playbookRunsRef = useRef<PlaybookRun[]>(playbookRuns);
  const knownPlaybookRunRevisionRef = useRef<Map<string, number>>(new Map());
  const firestorePendingPlaybookIdsRef = useRef<string[]>([]);
  const playbookOfflineQueueRef = useRef<PlaybookOfflineSyncQueue>(new PlaybookOfflineSyncQueue());
  const isFlushingPlaybookQueueRef = useRef<boolean>(false);
  clientsRef.current = clients;
  meetingsRef.current = meetings;
  tasksRef.current = tasks;
  notesRef.current = notes;
  opportunitiesRef.current = opportunities;
  opportunityStageEventsRef.current = opportunityStageEvents;
  interactionsRef.current = interactions;
  remindersRef.current = reminders;
  followUpPrefsRef.current = followUpPreferences;
  playbookTemplatesRef.current = playbookTemplates;
  playbookRunsRef.current = playbookRuns;

  // Operation-scoped coordinators (prevent cross-entity or out-of-order array clobbering)
  const clientOpsRef = useRef(new OperationCoordinator<Client>());
  const meetingOpsRef = useRef(new OperationCoordinator<Meeting>());
  const taskOpsRef = useRef(new OperationCoordinator<ActionItem>());
  const noteOpsRef = useRef(new OperationCoordinator<Note>());
  const opportunityOpsRef = useRef(new OperationCoordinator<Opportunity>());
  const opportunityStageEventOpsRef = useRef(new OperationCoordinator<OpportunityStageEvent>());
  const interactionOpsRef = useRef(new OperationCoordinator<CommunicationInteraction>());
  const reminderOpsRef = useRef(new OperationCoordinator<ReminderStateRecord>());
  const followUpPrefOpsRef = useRef(new OperationCoordinator<FollowUpPreferences>());
  const playbookTemplateOpsRef = useRef(new OperationCoordinator<PlaybookTemplate>());
  const playbookRunOpsRef = useRef(new OperationCoordinator<PlaybookRun>());

  // Track active in-flight deletes per collection so pending counts stay accurate when docs leave local snapshots
  const pendingDeleteIdsRef = useRef<Record<CollectionKey, Set<string>>>({
    clients: new Set(),
    meetings: new Set(),
    tasks: new Set(),
    notes: new Set(),
    opportunities: new Set(),
    opportunityStageEvents: new Set(),
    interactions: new Set(),
    reminders: new Set(),
    preferences: new Set(),
    playbookTemplates: new Set(),
    playbookRuns: new Set(),
  });

  // Connectivity & Cache Runtime Status
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const cacheRuntime = getCacheRuntimeState();
  const [dismissedCacheError, setDismissedCacheError] = useState(false);

  // Detailed Synchronization Tracking across all user collections
  const [collectionSync, setCollectionSync] = useState<Record<CollectionKey, CollectionSyncStatus>>({
    clients: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    meetings: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    tasks: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    notes: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    opportunities: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    opportunityStageEvents: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    interactions: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    reminders: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    preferences: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    playbookTemplates: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    playbookRuns: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
  });

  // Preserved rejected writes (stored ONLY in React session memory — never auto-saved to localStorage)
  const [rejectedWrites, setRejectedWrites] = useState<RejectedWriteRecord[]>([]);
  const [copiedDraftOpId, setCopiedDraftOpId] = useState<string | null>(null);

  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [activeConflict, setActiveConflict] = useState<ConflictItem | null>(null);

  // App Settings & Protection
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(true);
  const [pinCode] = useState('1234');
  const [showHijri, setShowHijri] = useState(true);
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');

  // Navigation
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');

  // Modals & Selections
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pdfMeeting, setPdfMeeting] = useState<Meeting | null>(null);
  const [showSignOutWarning, setShowSignOutWarning] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [preselectedClientIdForMeeting, setPreselectedClientIdForMeeting] = useState<string | null>(null);
  const [preselectedClientIdForTask, setPreselectedClientIdForTask] = useState<string | null>(null);
  const [opportunityCreateTrigger, setOpportunityCreateTrigger] = useState<{ token: number; clientId?: string } | null>(null);
  const [pendingStageTransition, setPendingStageTransition] = useState<{
    mode: 'close' | 'reopen';
    opportunity: Opportunity;
    targetStage: OpportunityStage;
  } | null>(null);

  const [meetingInitialTab, setMeetingInitialTab] = useState<
    'all' | 'preparation' | 'attachments' | null
  >(null);
  const [meetingCreateTrigger, setMeetingCreateTrigger] = useState<{
    clientId?: string;
    opportunityId?: string;
    dateTimeIso?: string;
    nonce: number;
  } | null>(null);
  const [taskCreateTrigger, setTaskCreateTrigger] = useState<{
    clientId?: string;
    meetingId?: string;
    opportunityId?: string;
    dueDate?: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    nonce: number;
  } | null>(null);
  const [taskOpenTrigger, setTaskOpenTrigger] = useState<{ taskId: string; nonce: number } | null>(null);
  const [reportsInitialSubTab, setReportsInitialSubTab] = useState<'stats' | 'notes'>('stats');
  const [noteCreateTrigger, setNoteCreateTrigger] = useState<{ clientId?: string; nonce: number } | null>(null);
  const [noteOpenTrigger, setNoteOpenTrigger] = useState<{ noteId: string; nonce: number } | null>(null);
  const [createClientTrigger, setCreateClientTrigger] = useState(0);
  const [clientsFilterTrigger, setClientsFilterTrigger] = useState<ClientsFilterTrigger | null>(null);
  const [meetingsFilterTrigger, setMeetingsFilterTrigger] = useState<MeetingsFilterTrigger | null>(null);
  const [tasksFilterTrigger, setTasksFilterTrigger] = useState<TasksFilterTrigger | null>(null);
  const [calendarSettings, setCalendarSettings] = useState<CalendarSettings>(() =>
    loadUserCalendarSettings(user.uid)
  );
  const [calendarNavTrigger, setCalendarNavTrigger] = useState<CalendarNavigationTrigger | null>(
    null
  );
  const [interactionModalState, setInteractionModalState] = useState<{
    isOpen: boolean;
    initialInteraction?: CommunicationInteraction | null;
    defaultClientId?: string;
    defaultContactId?: string;
    defaultOpportunityId?: string;
    defaultChannel?: CommunicationChannel;
  }>({ isOpen: false });
  const [communicationsSubTab, setCommunicationsSubTab] =
    useState<CommunicationsSubTab>('interactions');
  const [selectedPlaybookRunId, setSelectedPlaybookRunId] = useState<string | null>(null);
  const [playbookStartModalState, setPlaybookStartModalState] = useState<{
    isOpen: boolean;
    defaultTemplateId?: string;
    defaultClientId?: string;
    defaultOpportunityId?: string;
  }>({ isOpen: false });
  const [playbookTemplateEditorState, setPlaybookTemplateEditorState] = useState<{
    isOpen: boolean;
    initialTemplate?: PlaybookTemplate | null;
  }>({ isOpen: false });
  const [pendingInteractionStepContext, setPendingInteractionStepContext] = useState<{
    runId: string;
    stepId: string;
  } | null>(null);

  // Listen to browser online/offline transitions + live 60s / visibility clock refresh
  useEffect(() => {
    const refreshClock = () => setReferenceDate(new Date());
    const handleOnline = () => {
      setIsOnline(true);
      refreshClock();
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshClock();
      }
    };

    const intervalId =
      typeof window !== 'undefined' ? window.setInterval(refreshClock, 60000) : null;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    return () => {
      if (intervalId !== null && typeof window !== 'undefined') {
        window.clearInterval(intervalId);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, []);

  // Aggregate Sync Summary derived from real Firestore snapshot metadata + online/offline + rejected writes
  const syncSummary = computeDetailedSyncSummary({
    statuses: collectionSync,
    hasActiveConflict: conflicts.length > 0,
    conflictCount: conflicts.length,
    isOnline,
    rejectedWritesCount: rejectedWrites.length,
  });

  // Protect user against accidental browser reload/close when pending writes live only in RAM or rejected drafts exist in React memory
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const shouldWarnOnUnload =
      (cacheRuntime.activeMode === 'memory' && syncSummary.pendingOperationsCount > 0) ||
      rejectedWrites.length > 0;
    if (!shouldWarnOnUnload) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [cacheRuntime.activeMode, syncSummary.pendingOperationsCount, rejectedWrites.length]);

  // Initialize Isolated Subscriptions for this User UID
  useEffect(() => {
    let isSubscribed = true;
    const sessionUid = user.uid;
    syncAttachmentCacheUser(sessionUid);

    const unsubClients = subscribeClients(
      (data, meta) => {
        if (!isSubscribed) return;
        clientsRef.current = data;
        setClients(data);
        setCollectionSync((prev) => ({
          ...prev,
          clients: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.clients.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Clients subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          clients: { ...prev.clients, hasError: true },
        }));
      }
    );

    const unsubMeetings = subscribeMeetings(
      (data, meta) => {
        if (!isSubscribed) return;
        meetingsRef.current = data;
        setMeetings(data);
        setCollectionSync((prev) => ({
          ...prev,
          meetings: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.meetings.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Meetings subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          meetings: { ...prev.meetings, hasError: true },
        }));
      }
    );

    const unsubTasks = subscribeTasks(
      (data, meta) => {
        if (!isSubscribed) return;
        tasksRef.current = data;
        setTasks(data);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.tasks.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Tasks subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: { ...prev.tasks, hasError: true },
        }));
      }
    );

    const unsubNotes = subscribeNotes(
      (data, meta) => {
        if (!isSubscribed) return;
        notesRef.current = data;
        setNotes(data);
        setCollectionSync((prev) => ({
          ...prev,
          notes: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.notes.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Notes subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          notes: { ...prev.notes, hasError: true },
        }));
      }
    );

    const unsubOpportunities = subscribeOpportunities(
      (data, meta) => {
        if (!isSubscribed) return;
        opportunitiesRef.current = data;
        setOpportunities(data);
        setCollectionSync((prev) => ({
          ...prev,
          opportunities: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.opportunities.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Opportunities subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          opportunities: { ...prev.opportunities, hasError: true },
        }));
      }
    );

    const unsubOpportunityStageEvents = subscribeOpportunityStageEvents(
      (data, meta) => {
        if (!isSubscribed) return;
        opportunityStageEventsRef.current = data;
        setOpportunityStageEvents(data);
        setCollectionSync((prev) => ({
          ...prev,
          opportunityStageEvents: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.opportunityStageEvents.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] OpportunityStageEvents subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          opportunityStageEvents: { ...prev.opportunityStageEvents, hasError: true },
        }));
      }
    );

    const unsubReminders = subscribeReminders(
      (data, meta) => {
        if (!isSubscribed) return;
        remindersRef.current = data;
        setReminders(data);
        setCollectionSync((prev) => ({
          ...prev,
          reminders: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.reminders.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Reminders subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          reminders: { ...prev.reminders, hasError: true },
        }));
      }
    );

    const unsubFollowUpPrefs = subscribeFollowUpPreferences(
      (prefs, meta) => {
        if (!isSubscribed) return;
        followUpPrefsRef.current = prefs;
        setFollowUpPreferences(prefs);
        setCollectionSync((prev) => ({
          ...prev,
          preferences: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.preferences.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Follow-up preferences subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          preferences: { ...prev.preferences, hasError: true },
        }));
      }
    );

    const unsubInteractions = subscribeInteractions(
      (data, meta) => {
        if (!isSubscribed) return;
        interactionsRef.current = data;
        setInteractions(data);
        setCollectionSync((prev) => ({
          ...prev,
          interactions: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.interactions.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] Interactions subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          interactions: { ...prev.interactions, hasError: true },
        }));
      }
    );

    const unsubPlaybookTemplates = subscribePlaybookTemplates(
      (data, meta) => {
        if (!isSubscribed) return;
        playbookTemplatesRef.current = data;
        setPlaybookTemplates(data);
        setCollectionSync((prev) => ({
          ...prev,
          playbookTemplates: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: meta.pendingDocIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.playbookTemplates.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] PlaybookTemplates subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          playbookTemplates: { ...prev.playbookTemplates, hasError: true },
        }));
      }
    );

    const unsubPlaybookRuns = subscribePlaybookRuns(
      (data, meta) => {
        if (!isSubscribed) return;
        const pendingSet = new Set(meta.pendingDocIds);
        if (!meta.fromCache) {
          const detectedConflicts: ConflictItem[] = [];
          for (const remoteRun of data) {
            const localRun = playbookRunsRef.current.find((r) => r.id === remoteRun.id);
            const queuedEntry = playbookOfflineQueueRef.current.getEntry(remoteRun.id);
            const expectedBase = queuedEntry
              ? queuedEntry.baseRevision
              : knownPlaybookRunRevisionRef.current.get(remoteRun.id);

            if (
              localRun &&
              (pendingSet.has(remoteRun.id) || Boolean(queuedEntry)) &&
              typeof expectedBase === 'number'
            ) {
              const conflict = checkPlaybookRunRevisionConflict({
                localRun: queuedEntry ? queuedEntry.draftRun : localRun,
                remoteRun,
                expectedBaseRevision: expectedBase,
              });
              if (conflict) {
                detectedConflicts.push(conflict);
              }
            } else if (!pendingSet.has(remoteRun.id) && !queuedEntry) {
              knownPlaybookRunRevisionRef.current.set(
                remoteRun.id,
                remoteRun.revision ?? 1
              );
            }
          }
          if (detectedConflicts.length > 0) {
            setConflicts((prev) => {
              const merged = [...prev];
              for (const c of detectedConflicts) {
                const runId = (c.localVersion as PlaybookRun).id;
                const exists = merged.some(
                  (m) =>
                    m.id === c.id ||
                    (m.entityType === 'playbookRun' && (m.localVersion as PlaybookRun).id === runId)
                );
                if (!exists) merged.push(c);
              }
              return merged;
            });
          }
        }
        const mergedRuns = playbookOfflineQueueRef.current.overlayPendingDrafts(data);
        firestorePendingPlaybookIdsRef.current = meta.pendingDocIds;
        const queuedPendingIds = playbookOfflineQueueRef.current.getPendingRunIds();
        const combinedPendingIds = Array.from(new Set([...meta.pendingDocIds, ...queuedPendingIds]));
        playbookRunsRef.current = mergedRuns;
        setPlaybookRuns(mergedRuns);
        setCollectionSync((prev) => ({
          ...prev,
          playbookRuns: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites || queuedPendingIds.length > 0,
            fromCache: meta.fromCache,
            hasError: false,
            pendingDocIds: combinedPendingIds,
            pendingDeletesCount: pendingDeleteIdsRef.current.playbookRuns.size,
          },
        }));
      },
      (err) => {
        if (!isSubscribed) return;
        console.warn(`[User ${sessionUid}] PlaybookRuns subscription warning:`, err);
        setCollectionSync((prev) => ({
          ...prev,
          playbookRuns: { ...prev.playbookRuns, hasError: true },
        }));
      }
    );

    return () => {
      isSubscribed = false;
      clearAttachmentDownloadCache();
      knownPlaybookRunRevisionRef.current.clear();
      firestorePendingPlaybookIdsRef.current = [];
      playbookOfflineQueueRef.current.clear();
      unsubClients();
      unsubMeetings();
      unsubTasks();
      unsubNotes();
      unsubOpportunities();
      unsubOpportunityStageEvents();
      unsubInteractions();
      unsubReminders();
      unsubFollowUpPrefs();
      unsubPlaybookTemplates();
      unsubPlaybookRuns();
    };
  }, [user.uid]);

  // Helper to update in-flight delete counter
  const markDeleteInFlight = (col: CollectionKey, id: string, active: boolean) => {
    const setRef = pendingDeleteIdsRef.current[col];
    if (active) setRef.add(id);
    else setRef.delete(id);

    setCollectionSync((prev) => ({
      ...prev,
      [col]: {
        ...prev[col],
        pendingDeletesCount: setRef.size,
      },
    }));
  };

  // Helper to record a rejected write without losing user's work (respects wasSuperseded)
  const recordRejectedWrite = (params: {
    opId: string;
    entityType: RejectedWriteRecord['entityType'];
    entityId: string;
    entityTitle: string;
    operation: 'save' | 'delete';
    classification: WriteErrorClassification;
    error: Error;
    payload?:
      | Client
      | Meeting
      | ActionItem
      | Note
      | Opportunity
      | OpportunityStageEvent
      | CommunicationInteraction
      | ReminderStateRecord
      | FollowUpPreferences
      | PlaybookTemplate
      | PlaybookRun;
    wasSuperseded?: boolean;
  }) => {
    if (params.wasSuperseded) return;
    const rec: RejectedWriteRecord = {
      opId: params.opId,
      entityType: params.entityType,
      entityId: params.entityId,
      entityTitle: params.entityTitle,
      operation: params.operation,
      category: params.classification.category,
      messageArabic: params.classification.messageArabic,
      rawMessage: params.error.message,
      payload: params.payload,
      occurredAt: new Date().toISOString(),
    };
    setRejectedWrites((prev) =>
      applyScopedRejection(prev, { record: rec, wasSuperseded: Boolean(params.wasSuperseded) })
    );
  };

  const clearRejectedForEntity = (
    entityType: RejectedWriteRecord['entityType'],
    entityId: string,
    wasSuperseded: boolean = false
  ) => {
    setRejectedWrites((prev) =>
      applyScopedConfirmation(prev, { entityType, entityId, wasSuperseded })
    );
  };

  const handleDownloadRejectedDraft = (rec: RejectedWriteRecord) => {
    const json = serializeRejectedDraftJson(rec);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.setAttribute('href', url);
    anchor.setAttribute('download', `murafiq-draft-${rec.entityType}-${rec.entityId}.json`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopyRejectedDraft = async (rec: RejectedWriteRecord) => {
    const text = formatRejectedDraftClipboardText(rec);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedDraftOpId(rec.opId);
        setTimeout(() => {
          setCopiedDraftOpId((current) => (current === rec.opId ? null : current));
        }, 2000);
      }
    } catch (err) {
      console.warn('Could not copy rejected draft to clipboard:', err);
    }
  };

  // Safe Sign-Out Verification
  const signOutSafety = canSafelySignOut(collectionSync, {
    cacheMode: cacheRuntime.activeMode,
    rejectedWritesCount: rejectedWrites.length,
  });

  const handleInitiateSignOut = () => {
    if (!signOutSafety.safe) {
      setShowSignOutWarning(true);
      return;
    }
    onSignOut();
  };

  const handleConfirmForcedSignOut = () => {
    setShowSignOutWarning(false);
    onSignOut();
  };

  // Live Derived Counts & Daily Command Center Data
  const { overdue } = categorizeTasks(tasks, referenceDate);
  const upcomingMeetingsCount = meetings.filter((m) => {
    if (m.status === 'cancelled' || m.status === 'completed') return false;
    const diffMs = new Date(m.dateTime).getTime() - referenceDate.getTime();
    return diffMs >= -3600000 && diffMs <= 7 * 24 * 3600000;
  }).length;

  const categorizedDaily = useMemo(
    () => categorizeDailyWorkTasks(tasks, referenceDate),
    [tasks, referenceDate]
  );

  const upcomingMeetingsForToday = useMemo(
    () =>
      getUpcomingMeetingsForDailyCenter({
        meetings,
        clients,
        referenceDate,
        leadMinutes: followUpPreferences.meetingLeadMinutes,
      }),
    [meetings, clients, referenceDate, followUpPreferences.meetingLeadMinutes]
  );

  const clientFollowUps = useMemo(
    () =>
      buildDailyClientFollowUps({
        clients,
        meetings,
        tasks,
        interactions,
        preferences: followUpPreferences,
        referenceDate,
      }),
    [clients, meetings, tasks, interactions, followUpPreferences, referenceDate]
  );

  const dailySummary = useMemo(
    () =>
      computeDailyCommandSummary({
        clients,
        meetings,
        tasks,
        opportunities,
        interactions,
        preferences: followUpPreferences,
        referenceDate,
      }),
    [clients, meetings, tasks, opportunities, interactions, followUpPreferences, referenceDate]
  );

  const evaluatedReminders = useMemo(
    () =>
      evaluateReminders({
        clients,
        meetings,
        tasks,
        opportunities,
        interactions,
        playbookRuns,
        persistedStates: reminders,
        preferences: followUpPreferences,
        referenceDate,
      }),
    [clients, meetings, tasks, opportunities, interactions, playbookRuns, reminders, followUpPreferences, referenceDate]
  );

  const commCenterSummary = useMemo(
    () =>
      computeCommunicationCenterSummary(
        interactions,
        clients,
        meetings,
        tasks,
        referenceDate,
        followUpPreferences.staleClientDays
      ),
    [interactions, clients, meetings, tasks, referenceDate, followUpPreferences.staleClientDays]
  );

  const calendarConflictsCount = useMemo(() => {
    const events = buildCalendarEvents({
      clients,
      meetings,
      tasks,
      opportunities,
      interactions,
      playbookRuns,
      currentUserId: user.uid,
      referenceDate,
      timeZone: getLocalTimeZoneName(),
      settings: {
        ...calendarSettings,
        showMeetings: true,
        showTasks: true,
      },
      filterScope: 'all',
    });
    return detectCalendarConflicts(events).length;
  }, [clients, meetings, tasks, opportunities, interactions, playbookRuns, user.uid, referenceDate, calendarSettings]);

  const handleUpdateCalendarSettings = (patch: Partial<CalendarSettings>) => {
    setCalendarSettings((prev) => {
      const next = saveUserCalendarSettings(user.uid, { ...prev, ...patch });
      return next;
    });
  };

  const handleNavigateToCalendar = (params?: {
    mode?: CalendarViewMode;
    dateKey?: string;
    clientId?: string;
    scheduleTaskId?: string;
  }) => {
    setCalendarNavTrigger((prev) => ({
      mode: params?.mode,
      dateKey: params?.dateKey,
      clientId: params?.clientId,
      scheduleTaskId: params?.scheduleTaskId,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('calendar');
  };

  // Task Mutations (Non-blocking offline UI + operation-scoped recovery)
  const handleToggleTask = (taskId: string) => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;

    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updated: ActionItem = {
      ...task,
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
    };

    void handleSaveTask(updated);
  };

  const handleSaveTask = async (task: ActionItem): Promise<void> => {
    const prevEntity = tasksRef.current.find((t) => t.id === task.id);
    const applyUpsert = (prev: ActionItem[]) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = task;
        return next;
      }
      return [task, ...prev];
    };
    tasksRef.current = applyUpsert(tasksRef.current);

    taskOpsRef.current.runScopedMutation({
      entityId: task.id,
      entityType: 'task',
      previousEntity: prevEntity,
      setState: setTasks,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveTask(task),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('task', task.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save task rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'task',
          entityId: task.id,
          entityTitle: task.title,
          operation: 'save',
          classification,
          error,
          payload: task,
          wasSuperseded,
        });
      },
    });
  };

  const handleSaveTaskWithResult = (task: ActionItem): Promise<void> => {
    const prevEntity = tasksRef.current.find((t) => t.id === task.id);
    const applyUpsert = (prev: ActionItem[]) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = task;
        return next;
      }
      return [task, ...prev];
    };
    tasksRef.current = applyUpsert(tasksRef.current);

    if (!isOnline) {
      return Promise.reject(new Error('أنت في وضع عدم الاتصال: لا يمكن إتمام الاعتماد السحابي المؤكد بدون اتصال بالإنترنت.'));
    }

    const handle = taskOpsRef.current.runScopedMutation({
      entityId: task.id,
      entityType: 'task',
      previousEntity: prevEntity,
      setState: setTasks,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveTask(task),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('task', task.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save task rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'task',
          entityId: task.id,
          entityTitle: task.title,
          operation: 'save',
          classification,
          error,
          payload: task,
          wasSuperseded,
        });
      },
    });

    return handle.serverPromise;
  };

  const handleDeleteTask = async (taskId: string): Promise<void> => {
    const prevEntity = tasksRef.current.find((t) => t.id === taskId);
    const applyDelete = (prev: ActionItem[]) => prev.filter((t) => t.id !== taskId);
    tasksRef.current = applyDelete(tasksRef.current);
    markDeleteInFlight('tasks', taskId, true);

    taskOpsRef.current.runScopedMutation({
      entityId: taskId,
      entityType: 'task',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setTasks,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteTask(taskId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('tasks', taskId, false);
        clearRejectedForEntity('task', taskId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('tasks', taskId, false);
        console.warn('Delete task rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'task',
          entityId: taskId,
          entityTitle: prevEntity?.title || taskId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  // Meeting Mutations
  const handleSaveMeeting = async (meeting: Meeting): Promise<void> => {
    const prevEntity = meetingsRef.current.find((m) => m.id === meeting.id);
    const applyUpsert = (prev: Meeting[]) => {
      const idx = prev.findIndex((m) => m.id === meeting.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = meeting;
        return next;
      }
      return [meeting, ...prev];
    };
    meetingsRef.current = applyUpsert(meetingsRef.current);

    if (!isOnline) {
      throw new Error('أنت في وضع عدم الاتصال: لا يمكن تأكيد الحفظ السحابي للقاء حالياً.');
    }

    const handle = meetingOpsRef.current.runScopedMutation({
      entityId: meeting.id,
      entityType: 'meeting',
      previousEntity: prevEntity,
      setState: setMeetings,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveMeeting(meeting),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('meeting', meeting.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save meeting rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'meeting',
          entityId: meeting.id,
          entityTitle: meeting.title,
          operation: 'save',
          classification,
          error,
          payload: meeting,
          wasSuperseded,
        });
      },
    });

    return handle.serverPromise;
  };

  const handleDeleteMeeting = async (
    meetingId: string,
    knownAttachmentsCount?: number
  ): Promise<{ deleted: boolean; blockedMessageArabic?: string }> => {
    if ((knownAttachmentsCount ?? 0) > 0) {
      return {
        deleted: false,
        blockedMessageArabic: MEETING_HAS_ATTACHMENTS_MESSAGE_AR,
      };
    }

    const prevEntity = meetingsRef.current.find((m) => m.id === meetingId);
    const applyDelete = (prev: Meeting[]) => prev.filter((m) => m.id !== meetingId);
    meetingsRef.current = applyDelete(meetingsRef.current);
    markDeleteInFlight('meetings', meetingId, true);

    let rejectionMessageArabic: string | undefined;

    const handle = meetingOpsRef.current.runScopedMutation({
      entityId: meetingId,
      entityType: 'meeting',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setMeetings,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteMeeting(meetingId, { knownAttachmentsCount }),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('meetings', meetingId, false);
        clearRejectedForEntity('meeting', meetingId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('meetings', meetingId, false);
        rejectionMessageArabic = classification.messageArabic;
        console.warn('Delete meeting rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'meeting',
          entityId: meetingId,
          entityTitle: prevEntity?.title || meetingId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });

    if (!isOnline) {
      return { deleted: true };
    }

    try {
      await handle.serverPromise;
    } catch {
      // Handled safely via onServerRejected rollback and recovery banner
    }

    if (rejectionMessageArabic) {
      return {
        deleted: false,
        blockedMessageArabic: rejectionMessageArabic,
      };
    }

    return { deleted: true };
  };

  // Client Mutations
  const handleSaveClient = async (client: Client): Promise<void> => {
    const prevEntity = clientsRef.current.find((c) => c.id === client.id);
    const applyUpsert = (prev: Client[]) => {
      const idx = prev.findIndex((c) => c.id === client.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = client;
        return next;
      }
      return [client, ...prev];
    };
    clientsRef.current = applyUpsert(clientsRef.current);

    clientOpsRef.current.runScopedMutation({
      entityId: client.id,
      entityType: 'client',
      previousEntity: prevEntity,
      setState: setClients,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveClient(client),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('client', client.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save client rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'client',
          entityId: client.id,
          entityTitle: client.name,
          operation: 'save',
          classification,
          error,
          payload: client,
          wasSuperseded,
        });
      },
    });
  };

  const handleDeleteClient = async (clientId: string): Promise<void> => {
    const prevEntity = clientsRef.current.find((c) => c.id === clientId);
    const applyDelete = (prev: Client[]) => prev.filter((c) => c.id !== clientId);
    clientsRef.current = applyDelete(clientsRef.current);
    markDeleteInFlight('clients', clientId, true);

    clientOpsRef.current.runScopedMutation({
      entityId: clientId,
      entityType: 'client',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setClients,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteClient(clientId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('clients', clientId, false);
        clearRejectedForEntity('client', clientId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('clients', clientId, false);
        console.warn('Delete client rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'client',
          entityId: clientId,
          entityTitle: prevEntity?.name || clientId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  // Note Mutations
  const handleSaveNote = async (note: Note): Promise<void> => {
    const prevEntity = notesRef.current.find((n) => n.id === note.id);
    const applyUpsert = (prev: Note[]) => {
      const idx = prev.findIndex((n) => n.id === note.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = note;
        return next;
      }
      return [note, ...prev];
    };
    notesRef.current = applyUpsert(notesRef.current);

    noteOpsRef.current.runScopedMutation({
      entityId: note.id,
      entityType: 'note',
      previousEntity: prevEntity,
      setState: setNotes,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveNote(note),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('note', note.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save note rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'note',
          entityId: note.id,
          entityTitle: note.title,
          operation: 'save',
          classification,
          error,
          payload: note,
          wasSuperseded,
        });
      },
    });
  };

  const handleDeleteNote = async (noteId: string): Promise<void> => {
    const prevEntity = notesRef.current.find((n) => n.id === noteId);
    const applyDelete = (prev: Note[]) => prev.filter((n) => n.id !== noteId);
    notesRef.current = applyDelete(notesRef.current);
    markDeleteInFlight('notes', noteId, true);

    noteOpsRef.current.runScopedMutation({
      entityId: noteId,
      entityType: 'note',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setNotes,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteNote(noteId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('notes', noteId, false);
        clearRejectedForEntity('note', noteId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('notes', noteId, false);
        console.warn('Delete note rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'note',
          entityId: noteId,
          entityTitle: prevEntity?.title || noteId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  // Opportunity & OpportunityStageEvent Mutations
  const handleSaveOpportunityStageEvent = async (event: OpportunityStageEvent): Promise<void> => {
    const prevEntity = opportunityStageEventsRef.current.find((e) => e.id === event.id);
    const applyUpsert = (prev: OpportunityStageEvent[]) => {
      const idx = prev.findIndex((e) => e.id === event.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = event;
        return next;
      }
      return [event, ...prev];
    };
    opportunityStageEventsRef.current = applyUpsert(opportunityStageEventsRef.current);

    opportunityStageEventOpsRef.current.runScopedMutation({
      entityId: event.id,
      entityType: 'opportunityStageEvent',
      previousEntity: prevEntity,
      setState: setOpportunityStageEvents,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveOpportunityStageEvent(event),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('opportunityStageEvent', event.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save opportunity stage event rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'opportunityStageEvent',
          entityId: event.id,
          entityTitle: `حدث مرحلة الفرصة (${event.opportunityId})`,
          operation: 'save',
          classification,
          error,
          payload: event,
          wasSuperseded,
        });
      },
    });
  };

  const handleDeleteOpportunityStageEvent = async (eventId: string): Promise<void> => {
    const prevEntity = opportunityStageEventsRef.current.find((e) => e.id === eventId);
    const applyDelete = (prev: OpportunityStageEvent[]) => prev.filter((e) => e.id !== eventId);
    opportunityStageEventsRef.current = applyDelete(opportunityStageEventsRef.current);
    markDeleteInFlight('opportunityStageEvents', eventId, true);

    opportunityStageEventOpsRef.current.runScopedMutation({
      entityId: eventId,
      entityType: 'opportunityStageEvent',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setOpportunityStageEvents,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteOpportunityStageEvent(eventId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('opportunityStageEvents', eventId, false);
        clearRejectedForEntity('opportunityStageEvent', eventId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('opportunityStageEvents', eventId, false);
        console.warn('Delete opportunity stage event rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'opportunityStageEvent',
          entityId: eventId,
          entityTitle: `حدث مرحلة الفرصة (${eventId})`,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const handleSaveOpportunityRecord = async (opportunity: Opportunity): Promise<void> => {
    const prevEntity = opportunitiesRef.current.find((o) => o.id === opportunity.id);
    const applyUpsert = (prev: Opportunity[]) => {
      const idx = prev.findIndex((o) => o.id === opportunity.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = opportunity;
        return next;
      }
      return [opportunity, ...prev];
    };
    opportunitiesRef.current = applyUpsert(opportunitiesRef.current);

    opportunityOpsRef.current.runScopedMutation({
      entityId: opportunity.id,
      entityType: 'opportunity',
      previousEntity: prevEntity,
      setState: setOpportunities,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveOpportunity(opportunity),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('opportunity', opportunity.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save opportunity rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'opportunity',
          entityId: opportunity.id,
          entityTitle: opportunity.title,
          operation: 'save',
          classification,
          error,
          payload: opportunity,
          wasSuperseded,
        });
      },
    });
  };

  const handleSaveOpportunity = async (
    data: Partial<Opportunity> & { clientId: string; title: string },
    initialNote?: string
  ): Promise<Opportunity | void> => {
    const nowIso = new Date().toISOString();
    const isNew = !data.id || !opportunitiesRef.current.some((o) => o.id === data.id);
    const id = data.id || generateDeterministicOpportunityId();
    const sanitized = sanitizeOpportunityForSave({
      ...data,
      id,
      userId: user.uid,
      updatedAt: nowIso,
    });

    await handleSaveOpportunityRecord(sanitized);

    if (isNew) {
      const initialEvent = createInitialOpportunityEvent(sanitized, initialNote);
      const alreadyExists = opportunityStageEventsRef.current.some(
        (e) => e.id === initialEvent.id
      );
      if (!alreadyExists) {
        await handleSaveOpportunityStageEvent(initialEvent);
      }
    }

    return sanitized;
  };

  const handleRequestOpportunityStageChange = (
    opportunity: Opportunity,
    targetStage: OpportunityStage
  ) => {
    if (opportunity.stage === targetStage) return;
    const nowIso = new Date().toISOString();
    const transition = buildOpportunityStageTransition({
      opportunity,
      targetStage,
      confirmed: false,
      nowIso,
    });

    if (transition.requiresConfirmation) {
      setPendingStageTransition({
        mode: transition.confirmationKind === 'reopen' ? 'reopen' : 'close',
        opportunity,
        targetStage,
      });
      return;
    }

    if (transition.allowed && transition.opportunity && transition.stageEvent) {
      void handleSaveOpportunityRecord(transition.opportunity);
      void handleSaveOpportunityStageEvent(transition.stageEvent);
    }
  };

  const handleConfirmOpportunityStageChange = async (params: {
    targetStage: OpportunityStage;
    lostReason?: string;
    note?: string;
  }) => {
    if (!pendingStageTransition) return;
    const nowIso = new Date().toISOString();
    const transition = buildOpportunityStageTransition({
      opportunity: pendingStageTransition.opportunity,
      targetStage: params.targetStage,
      confirmed: true,
      lostReason: params.lostReason,
      note: params.note,
      nowIso,
    });

    setPendingStageTransition(null);

    if (transition.allowed && transition.opportunity && transition.stageEvent) {
      await handleSaveOpportunityRecord(transition.opportunity);
      await handleSaveOpportunityStageEvent(transition.stageEvent);
    }
  };

  const handleDeleteOpportunity = async (opportunity: Opportunity): Promise<void> => {
    const oppId = opportunity.id;

    // Unlink any linked meetings/tasks while strictly preserving the meetings & tasks themselves
    const linkedMeetings = meetingsRef.current.filter((m) => m.opportunityId === oppId);
    for (const m of linkedMeetings) {
      const unlinked = unlinkMeetingFromOpportunity(m);
      void handleSaveMeeting(unlinked);
    }

    const linkedTasks = tasksRef.current.filter((t) => t.opportunityId === oppId);
    for (const t of linkedTasks) {
      const unlinked = unlinkTaskFromOpportunity(t);
      void handleSaveTask(unlinked);
    }

    const prevEntity = opportunitiesRef.current.find((o) => o.id === oppId);
    const applyDelete = (prev: Opportunity[]) => prev.filter((o) => o.id !== oppId);
    opportunitiesRef.current = applyDelete(opportunitiesRef.current);
    markDeleteInFlight('opportunities', oppId, true);

    if (selectedOpportunityId === oppId) {
      setSelectedOpportunityId(null);
    }

    opportunityOpsRef.current.runScopedMutation({
      entityId: oppId,
      entityType: 'opportunity',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setOpportunities,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteOpportunity(oppId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('opportunities', oppId, false);
        clearRejectedForEntity('opportunity', oppId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('opportunities', oppId, false);
        console.warn('Delete opportunity rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'opportunity',
          entityId: oppId,
          entityTitle: prevEntity?.title || opportunity.title || oppId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const handleConvertNextActionToTask = async (opportunity: Opportunity): Promise<void> => {
    const res = convertNextActionToTaskDraft(opportunity);
    if (!res.ok || !res.task) return;
    await handleSaveTask(res.task);
  };

  const handleLinkMeetingToOpportunity = async (
    meeting: Meeting,
    opportunity: Opportunity
  ): Promise<void> => {
    const res = linkMeetingToOpportunity(meeting, opportunity);
    if (!res.ok || !res.meeting) return;
    await handleSaveMeeting(res.meeting);
  };

  const handleUnlinkMeetingFromOpportunity = async (meeting: Meeting): Promise<void> => {
    const updated = unlinkMeetingFromOpportunity(meeting);
    await handleSaveMeeting(updated);
  };

  const handleLinkTaskToOpportunity = async (
    task: ActionItem,
    opportunity: Opportunity
  ): Promise<void> => {
    const res = linkTaskToOpportunity(task, opportunity);
    if (!res.ok || !res.task) return;
    await handleSaveTask(res.task);
  };

  const handleUnlinkTaskFromOpportunity = async (task: ActionItem): Promise<void> => {
    const updated = unlinkTaskFromOpportunity(task);
    await handleSaveTask(updated);
  };

  // Communication Interaction Mutations (Task 011)
  const handleSaveInteractionRecord = async (
    interaction: CommunicationInteraction
  ): Promise<void> => {
    const withOwner: CommunicationInteraction = {
      ...interaction,
      userId: user.uid,
    };
    const prevEntity = interactionsRef.current.find((i) => i.id === withOwner.id);
    const applyUpsert = (prev: CommunicationInteraction[]) => {
      const idx = prev.findIndex((i) => i.id === withOwner.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = withOwner;
        return next;
      }
      return [withOwner, ...prev];
    };
    interactionsRef.current = applyUpsert(interactionsRef.current);

    interactionOpsRef.current.runScopedMutation({
      entityId: withOwner.id,
      entityType: 'interaction',
      previousEntity: prevEntity,
      setState: setInteractions,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveInteraction(withOwner),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('interaction', withOwner.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save interaction rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'interaction',
          entityId: withOwner.id,
          entityTitle: withOwner.subject || `تواصل (${withOwner.id})`,
          operation: 'save',
          classification,
          error,
          payload: withOwner,
          wasSuperseded,
        });
      },
    });
  };

  const handleSaveInteraction = async (
    interaction: CommunicationInteraction,
    followUpTaskDraft?: ActionItem
  ): Promise<void> => {
    await handleSaveInteractionRecord(interaction);
    if (followUpTaskDraft) {
      await handleSaveTask({
        ...followUpTaskDraft,
        userId: user.uid,
      });
    }
    if (pendingInteractionStepContext) {
      const targetRun = playbookRunsRef.current.find(
        (r) => r.id === pendingInteractionStepContext.runId
      );
      if (targetRun && targetRun.clientId === interaction.clientId) {
        const linkedRes = linkCommunicationToPlaybookStep({
          run: targetRun,
          stepId: pendingInteractionStepContext.stepId,
          interaction,
          currentUserId: user.uid,
        });
        if (linkedRes.ok && linkedRes.run) {
          void handleSavePlaybookRun(linkedRes.run);
        }
      }
      setPendingInteractionStepContext(null);
    }
  };

  const handleDeleteInteraction = async (interactionId: string): Promise<void> => {
    // Unlink any tasks referencing this interaction while preserving the tasks themselves
    const linkedTasks = tasksRef.current.filter((t) => t.interactionId === interactionId);
    if (linkedTasks.length > 0) {
      const unlinkedList = unlinkInteractionReferencesOnDelete(interactionId, linkedTasks);
      for (const unlinked of unlinkedList) {
        void handleSaveTask(unlinked);
      }
    }

    const prevEntity = interactionsRef.current.find((i) => i.id === interactionId);
    const applyDelete = (prev: CommunicationInteraction[]) =>
      prev.filter((i) => i.id !== interactionId);
    interactionsRef.current = applyDelete(interactionsRef.current);
    markDeleteInFlight('interactions', interactionId, true);

    interactionOpsRef.current.runScopedMutation({
      entityId: interactionId,
      entityType: 'interaction',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setInteractions,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteInteraction(interactionId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('interactions', interactionId, false);
        clearRejectedForEntity('interaction', interactionId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('interactions', interactionId, false);
        console.warn('Delete interaction rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'interaction',
          entityId: interactionId,
          entityTitle: prevEntity?.subject || `تواصل (${interactionId})`,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const handleConvertInteractionToTask = async (
    updatedInteraction: CommunicationInteraction,
    taskDraft: ActionItem
  ): Promise<void> => {
    await handleSaveTask({
      ...taskDraft,
      userId: user.uid,
    });
    await handleSaveInteractionRecord(updatedInteraction);
  };

  const handleOpenNewInteraction = (defaults?: {
    clientId?: string;
    contactId?: string;
    opportunityId?: string;
    channel?: CommunicationChannel;
  }) => {
    setInteractionModalState({
      isOpen: true,
      initialInteraction: null,
      defaultClientId: defaults?.clientId,
      defaultContactId: defaults?.contactId,
      defaultOpportunityId: defaults?.opportunityId,
      defaultChannel: defaults?.channel,
    });
  };

  const handleEditInteraction = (interaction: CommunicationInteraction) => {
    setInteractionModalState({
      isOpen: true,
      initialInteraction: interaction,
    });
  };

  // Reminder State & Follow-Up Preferences Mutations (Operation-Scoped + Offline-Honest)
  const handleSaveReminderState = (record: ReminderStateRecord) => {
    const prevEntity = remindersRef.current.find((r) => r.id === record.id);
    const applyUpsert = (prev: ReminderStateRecord[]) => {
      const idx = prev.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [record, ...prev];
    };
    remindersRef.current = applyUpsert(remindersRef.current);

    reminderOpsRef.current.runScopedMutation({
      entityId: record.id,
      entityType: 'reminder',
      previousEntity: prevEntity,
      setState: setReminders,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSaveReminderState(record),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('reminder', record.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save reminder state rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'reminder',
          entityId: record.id,
          entityTitle: `حالة التذكير (${record.sourceId})`,
          operation: 'save',
          classification,
          error,
          payload: record,
          wasSuperseded,
        });
      },
    });
  };

  const handleDeleteReminderState = (reminderId: string) => {
    const prevEntity = remindersRef.current.find((r) => r.id === reminderId);
    if (!prevEntity) return;
    const applyDelete = (prev: ReminderStateRecord[]) =>
      prev.filter((r) => r.id !== reminderId);
    remindersRef.current = applyDelete(remindersRef.current);
    markDeleteInFlight('reminders', reminderId, true);

    reminderOpsRef.current.runScopedMutation({
      entityId: reminderId,
      entityType: 'reminder',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setReminders,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeleteReminderState(reminderId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('reminders', reminderId, false);
        clearRejectedForEntity('reminder', reminderId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('reminders', reminderId, false);
        console.warn('Delete reminder state rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'reminder',
          entityId: reminderId,
          entityTitle: `تذكير (${reminderId})`,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const handleSnoozeReminder = (
    reminder: ReminderItem,
    preset: SnoozePreset,
    customDateTime?: string
  ): { ok: boolean; errorArabic?: string } => {
    const calc = computeSnoozeUntilIso({
      preset,
      customDateTime,
      referenceDate,
    });
    if (!calc.ok || !calc.snoozedUntilIso) {
      return { ok: false, errorArabic: calc.errorArabic };
    }
    const existing = remindersRef.current.find((r) => r.id === reminder.id);
    const record = buildSnoozeStateRecord({
      reminder,
      snoozedUntilIso: calc.snoozedUntilIso,
      existing,
      nowIso: new Date().toISOString(),
      userId: user.uid,
    });
    handleSaveReminderState(record);
    return { ok: true };
  };

  const handleUnsnoozeReminder = (reminder: ReminderItem) => {
    handleDeleteReminderState(reminder.id);
  };

  const handleDismissReminder = (reminder: ReminderItem) => {
    const existing = remindersRef.current.find((r) => r.id === reminder.id);
    const record = buildResolvedStateRecord({
      reminder,
      existing,
      nowIso: new Date().toISOString(),
      userId: user.uid,
    });
    handleSaveReminderState(record);
  };

  const handleUpdateFollowUpPreferences = (nextRaw: FollowUpPreferences) => {
    const prevEntity = followUpPrefsRef.current;
    const normalized = normalizeFollowUpPreferences({
      ...nextRaw,
      id: FOLLOW_UP_PREFERENCES_DOC_ID,
      userId: user.uid,
      updatedAt: new Date().toISOString(),
    });
    followUpPrefsRef.current = normalized;

    followUpPrefOpsRef.current.runScopedMutation({
      entityId: normalized.id,
      entityType: 'preference',
      previousEntity: prevEntity,
      setState: (updater) => {
        setFollowUpPreferences((curr) => {
          const arr = updater([curr]);
          return arr[0] || curr;
        });
      },
      applyOptimistic: () => [normalized],
      dispatchWrite: () => fbSaveFollowUpPreferences(normalized),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('preference', normalized.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save follow-up preferences rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'preference',
          entityId: normalized.id,
          entityTitle: 'تفضيلات المتابعات والتذكيرات',
          operation: 'save',
          classification,
          error,
          payload: normalized,
          wasSuperseded,
        });
      },
    });
  };

  // Task 013: Playbook Templates & Runs Mutations
  const handleSavePlaybookTemplate = (template: PlaybookTemplate): void => {
    const clean = sanitizePlaybookTemplateForSave(
      { ...template, userId: user.uid, isSystemTemplate: false },
      user.uid
    );
    const prevEntity = playbookTemplatesRef.current.find((t) => t.id === clean.id);
    const applyUpsert = (prev: PlaybookTemplate[]) => {
      const idx = prev.findIndex((t) => t.id === clean.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = clean;
        return next;
      }
      return [clean, ...prev];
    };
    playbookTemplatesRef.current = applyUpsert(playbookTemplatesRef.current);

    playbookTemplateOpsRef.current.runScopedMutation({
      entityId: clean.id,
      entityType: 'playbookTemplate',
      previousEntity: prevEntity,
      setState: setPlaybookTemplates,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSavePlaybookTemplate(clean),
      onServerConfirmed: ({ wasSuperseded }) => {
        clearRejectedForEntity('playbookTemplate', clean.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save playbookTemplate rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'playbookTemplate',
          entityId: clean.id,
          entityTitle: clean.name,
          operation: 'save',
          classification,
          error,
          payload: clean,
          wasSuperseded,
        });
      },
    });
  };

  const handleDeletePlaybookTemplate = (templateId: string): void => {
    const prevEntity = playbookTemplatesRef.current.find((t) => t.id === templateId);
    const applyDelete = (prev: PlaybookTemplate[]) => prev.filter((t) => t.id !== templateId);
    playbookTemplatesRef.current = applyDelete(playbookTemplatesRef.current);
    markDeleteInFlight('playbookTemplates', templateId, true);

    playbookTemplateOpsRef.current.runScopedMutation({
      entityId: templateId,
      entityType: 'playbookTemplate',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setPlaybookTemplates,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeletePlaybookTemplate(templateId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('playbookTemplates', templateId, false);
        clearRejectedForEntity('playbookTemplate', templateId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('playbookTemplates', templateId, false);
        console.warn('Delete playbookTemplate rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'playbookTemplate',
          entityId: templateId,
          entityTitle: prevEntity?.name || templateId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const syncPlaybookQueueMetadata = () => {
    const queuedPendingIds = playbookOfflineQueueRef.current.getPendingRunIds();
    const combinedPendingIds = Array.from(
      new Set([...firestorePendingPlaybookIdsRef.current, ...queuedPendingIds])
    );
    setCollectionSync((prev) => ({
      ...prev,
      playbookRuns: {
        ...prev.playbookRuns,
        hasPendingWrites: combinedPendingIds.length > 0,
        pendingDocIds: combinedPendingIds,
      },
    }));
  };

  const openPlaybookConflict = (conflict: ConflictItem) => {
    const runId = (conflict.localVersion as PlaybookRun).id;
    setConflicts((prev) => {
      const filtered = prev.filter(
        (c) => !(c.entityType === 'playbookRun' && (c.localVersion as PlaybookRun).id === runId)
      );
      return [conflict, ...filtered];
    });
    setActiveConflict(conflict);
  };

  const handleSavePlaybookRun = (
    run: PlaybookRun,
    options?: { expectedBaseRevision?: number }
  ): void => {
    const clean = sanitizePlaybookRunForSave({ ...run, userId: user.uid }, user.uid);
    const prevEntity = playbookRunsRef.current.find((r) => r.id === clean.id);
    const queuedEntry = playbookOfflineQueueRef.current.getEntry(clean.id);
    const knownRev = knownPlaybookRunRevisionRef.current.get(clean.id);

    const baseRev =
      typeof options?.expectedBaseRevision === 'number'
        ? options.expectedBaseRevision
        : queuedEntry
        ? queuedEntry.baseRevision
        : typeof knownRev === 'number'
        ? knownRev
        : prevEntity
        ? prevEntity.revision ?? 0
        : 0;

    const applyUpsert = (prev: PlaybookRun[]) => {
      const idx = prev.findIndex((r) => r.id === clean.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = clean;
        return next;
      }
      return [clean, ...prev];
    };

    // Offline-First: keep uncommitted draft locally (pending/local — NEVER marked synced)
    // and verify server revision atomically upon reconnect.
    if (!isOnline) {
      playbookOfflineQueueRef.current.enqueueDraft({
        run: clean,
        baseRevision: baseRev,
      });
      playbookRunsRef.current = applyUpsert(playbookRunsRef.current);
      setPlaybookRuns(applyUpsert);
      syncPlaybookQueueMetadata();
      return;
    }

    playbookRunsRef.current = applyUpsert(playbookRunsRef.current);

    playbookRunOpsRef.current.runScopedMutation({
      entityId: clean.id,
      entityType: 'playbookRun',
      previousEntity: prevEntity,
      setState: setPlaybookRuns,
      applyOptimistic: applyUpsert,
      dispatchWrite: () => fbSavePlaybookRun(clean, { expectedBaseRevision: baseRev }),
      onServerConfirmed: ({ wasSuperseded }) => {
        if (!wasSuperseded) {
          knownPlaybookRunRevisionRef.current.set(
            clean.id,
            Math.max(clean.revision ?? 1, baseRev + 1)
          );
          playbookOfflineQueueRef.current.remove(clean.id);
          syncPlaybookQueueMetadata();
        }
        clearRejectedForEntity('playbookRun', clean.id, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        console.warn('Save playbookRun rejected by server:', error);
        if (wasSuperseded) return;

        if (error instanceof PlaybookRevisionConflictError) {
          if (error.casCode === 'CONFLICT' && error.serverRun) {
            knownPlaybookRunRevisionRef.current.set(clean.id, error.serverRun.revision ?? 1);
            const applyServerSnapshot = (prev: PlaybookRun[]) => {
              const idx = prev.findIndex((r) => r.id === clean.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = error.serverRun!;
                return next;
              }
              return [error.serverRun!, ...prev];
            };
            playbookRunsRef.current = applyServerSnapshot(playbookRunsRef.current);
            setPlaybookRuns(applyServerSnapshot);

            const conflictItem: ConflictItem =
              error.conflict ||
              checkPlaybookRunRevisionConflict({
                localRun: error.localDraft,
                remoteRun: error.serverRun,
                expectedBaseRevision: baseRev,
              }) || {
                id: `conflict-${clean.id}-${Date.now()}`,
                entityType: 'playbookRun',
                entityTitle: error.localDraft.templateName || error.serverRun.templateName || clean.id,
                localVersion: error.localDraft,
                remoteVersion: error.serverRun,
                differingFields: [
                  {
                    field: 'revision',
                    fieldLabelArabic: 'رقم المراجعة',
                    localValue: error.localDraft.revision ?? baseRev,
                    remoteValue: error.serverRun.revision ?? 1,
                  },
                ],
                detectedAt: new Date().toISOString(),
                isSimulated: false,
                detectionSource: 'revision_cas',
              };
            openPlaybookConflict(conflictItem);
            return;
          }

          recordRejectedWrite({
            opId,
            entityType: 'playbookRun',
            entityId: clean.id,
            entityTitle: clean.templateName,
            operation: 'save',
            classification,
            error,
            payload: error.localDraft || clean,
            wasSuperseded,
          });
          return;
        }

        if (classification.category === 'unavailable') {
          playbookOfflineQueueRef.current.enqueueDraft({
            run: clean,
            baseRevision: baseRev,
          });
          playbookRunsRef.current = applyUpsert(playbookRunsRef.current);
          setPlaybookRuns(applyUpsert);
          syncPlaybookQueueMetadata();
          return;
        }

        recordRejectedWrite({
          opId,
          entityType: 'playbookRun',
          entityId: clean.id,
          entityTitle: clean.templateName,
          operation: 'save',
          classification,
          error,
          payload: clean,
          wasSuperseded,
        });
      },
    });
  };

  // Flush queued Offline Playbook drafts through CAS transaction upon reconnect
  useEffect(() => {
    if (!isOnline) return;
    if (playbookOfflineQueueRef.current.getPendingCount() === 0) return;
    if (isFlushingPlaybookQueueRef.current) return;

    let cancelled = false;
    isFlushingPlaybookQueueRef.current = true;

    const flush = async () => {
      try {
        const results = await playbookOfflineQueueRef.current.flushPending(({ nextRun, expectedBaseRevision }) =>
          savePlaybookRunAtomic(nextRun, { expectedBaseRevision })
        );
        if (cancelled) return;

        for (const { runId, outcome } of results) {
          if (outcome.ok && outcome.savedRun) {
            const committed = outcome.savedRun;
            knownPlaybookRunRevisionRef.current.set(runId, committed.revision ?? 1);
            const upsertCommitted = (prev: PlaybookRun[]) => {
              const idx = prev.findIndex((r) => r.id === committed.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = committed;
                return next;
              }
              return [committed, ...prev];
            };
            playbookRunsRef.current = upsertCommitted(playbookRunsRef.current);
            setPlaybookRuns(upsertCommitted);
            clearRejectedForEntity('playbookRun', runId, false);
          } else if (!outcome.ok && outcome.code === 'CONFLICT' && outcome.serverRun) {
            const serverRun = outcome.serverRun;
            knownPlaybookRunRevisionRef.current.set(runId, serverRun.revision ?? 1);
            const applyServer = (prev: PlaybookRun[]) => {
              const idx = prev.findIndex((r) => r.id === runId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = serverRun;
                return next;
              }
              return [serverRun, ...prev];
            };
            playbookRunsRef.current = applyServer(playbookRunsRef.current);
            setPlaybookRuns(applyServer);
            if (outcome.conflict) {
              openPlaybookConflict(outcome.conflict);
            }
          } else if (!outcome.ok && (outcome.code === 'MISSING_ON_SERVER' || outcome.code === 'USER_MISMATCH')) {
            const draft = outcome.localDraft;
            if (draft) {
              const syntheticErr = new Error(
                outcome.errorAr || 'تعذر مزامنة مسودة خطة المتابعة بعد عودة الاتصال.'
              );
              recordRejectedWrite({
                opId: `offline-flush-${runId}-${Date.now()}`,
                entityType: 'playbookRun',
                entityId: runId,
                entityTitle: draft.templateName || runId,
                operation: 'save',
                classification: {
                  category: outcome.code === 'USER_MISMATCH' ? 'permission-denied' : 'failed-precondition',
                  isPermanentServerRejection: true,
                  messageArabic:
                    outcome.errorAr || 'تعذر مزامنة مسودة خطة المتابعة بعد عودة الاتصال.',
                },
                error: syntheticErr,
                payload: draft,
                wasSuperseded: false,
              });
            }
          }
        }
      } catch (err) {
        console.warn('Offline playbook flush paused cleanly:', err);
      } finally {
        isFlushingPlaybookQueueRef.current = false;
        if (!cancelled) {
          syncPlaybookQueueMetadata();
        }
      }
    };

    void flush();
    return () => {
      cancelled = true;
    };
  }, [isOnline, user.uid]);

  const handleDeletePlaybookRun = (runId: string): void => {
    const prevEntity = playbookRunsRef.current.find((r) => r.id === runId);
    const applyDelete = (prev: PlaybookRun[]) => prev.filter((r) => r.id !== runId);
    playbookRunsRef.current = applyDelete(playbookRunsRef.current);
    markDeleteInFlight('playbookRuns', runId, true);

    playbookRunOpsRef.current.runScopedMutation({
      entityId: runId,
      entityType: 'playbookRun',
      isDelete: true,
      previousEntity: prevEntity,
      setState: setPlaybookRuns,
      applyOptimistic: applyDelete,
      dispatchWrite: () => fbDeletePlaybookRun(runId),
      onServerConfirmed: ({ wasSuperseded }) => {
        markDeleteInFlight('playbookRuns', runId, false);
        clearRejectedForEntity('playbookRun', runId, wasSuperseded);
      },
      onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
        markDeleteInFlight('playbookRuns', runId, false);
        console.warn('Delete playbookRun rejected by server:', error);
        recordRejectedWrite({
          opId,
          entityType: 'playbookRun',
          entityId: runId,
          entityTitle: prevEntity?.templateName || runId,
          operation: 'delete',
          classification,
          error,
          payload: prevEntity,
          wasSuperseded,
        });
      },
    });
  };

  const handleAtomicConvertPlaybookStepToTask = async (
    run: PlaybookRun,
    stepId: string
  ): Promise<AtomicStepTaskCreationOutcome> => {
    const outcome = await executeAtomicStepTaskConversion(
      {
        userId: user.uid,
        run,
        stepId,
        isOnline,
      },
      firestorePlaybookAtomicAdapter
    );

    if (outcome.ok) {
      if (outcome.task) {
        const syncedTask = outcome.task;
        setTasks((prev) => {
          const exists = prev.some((t) => t.id === syncedTask.id);
          const next = exists
            ? prev.map((t) => (t.id === syncedTask.id ? syncedTask : t))
            : [syncedTask, ...prev];
          tasksRef.current = next;
          return next;
        });
      }
      if (outcome.run) {
        const syncedRun = outcome.run;
        knownPlaybookRunRevisionRef.current.set(syncedRun.id, syncedRun.revision ?? 1);
        setPlaybookRuns((prev) => {
          const exists = prev.some((r) => r.id === syncedRun.id);
          const next = exists
            ? prev.map((r) => (r.id === syncedRun.id ? syncedRun : r))
            : [syncedRun, ...prev];
          playbookRunsRef.current = next;
          return next;
        });
      }
    }
    return outcome;
  };

  const handleApprovePlaybookRescheduleSuggestion = (
    suggestion: PlaybookRescheduleSuggestion,
    applyToLinkedTask: boolean
  ) => {
    const targetRun = playbookRunsRef.current.find((r) => r.id === suggestion.runId);
    if (targetRun) {
      const baseRev = targetRun.revision ?? 0;
      const nextSteps = targetRun.steps.map((s) =>
        s.id === suggestion.stepId ? { ...s, dueDate: suggestion.suggestedDueDate } : s
      );
      handleSavePlaybookRun(
        {
          ...targetRun,
          steps: nextSteps,
          updatedAt: new Date().toISOString(),
          revision: baseRev + 1,
        },
        { expectedBaseRevision: baseRev }
      );
    }

    if (applyToLinkedTask) {
      const targetTask = tasksRef.current.find((t) => t.id === suggestion.linkedTaskId);
      if (targetTask) {
        void handleSaveTask({
          ...targetTask,
          dueDate: suggestion.suggestedDueDate,
        });
      }
    }
  };

  const handleOpenStartPlaybook = (defaults?: {
    templateId?: string;
    clientId?: string;
    opportunityId?: string;
  }) => {
    setPlaybookStartModalState({
      isOpen: true,
      defaultTemplateId: defaults?.templateId,
      defaultClientId: defaults?.clientId,
      defaultOpportunityId: defaults?.opportunityId,
    });
  };

  const handleOpenPlaybookRun = (runId: string) => {
    setSelectedPlaybookRunId(runId);
    setCommunicationsSubTab('playbooks');
    setActiveTab('communications');
  };

  // Retry a rejected write using its preserved payload
  const handleRetryRejectedWrite = (rec: RejectedWriteRecord) => {
    clearRejectedForEntity(rec.entityType, rec.entityId);

    if (rec.operation === 'delete') {
      if (rec.entityType === 'client') void handleDeleteClient(rec.entityId);
      else if (rec.entityType === 'task') void handleDeleteTask(rec.entityId);
      else if (rec.entityType === 'note') void handleDeleteNote(rec.entityId);
      else if (rec.entityType === 'meeting') {
        void handleDeleteMeeting(rec.entityId);
      } else if (rec.entityType === 'opportunity') {
        const opp = (rec.payload as Opportunity) || opportunitiesRef.current.find((o) => o.id === rec.entityId);
        if (opp) void handleDeleteOpportunity(opp);
      } else if (rec.entityType === 'opportunityStageEvent') {
        void handleDeleteOpportunityStageEvent(rec.entityId);
      } else if (rec.entityType === 'interaction') {
        void handleDeleteInteraction(rec.entityId);
      } else if (rec.entityType === 'reminder') {
        handleDeleteReminderState(rec.entityId);
      } else if (rec.entityType === 'playbookTemplate') {
        handleDeletePlaybookTemplate(rec.entityId);
      } else if (rec.entityType === 'playbookRun') {
        handleDeletePlaybookRun(rec.entityId);
      }
      return;
    }

    if (!rec.payload) return;
    if (rec.entityType === 'client') void handleSaveClient(rec.payload as Client);
    else if (rec.entityType === 'meeting') void handleSaveMeeting(rec.payload as Meeting);
    else if (rec.entityType === 'task') void handleSaveTask(rec.payload as ActionItem);
    else if (rec.entityType === 'note') void handleSaveNote(rec.payload as Note);
    else if (rec.entityType === 'opportunity') {
      void handleSaveOpportunityRecord(rec.payload as Opportunity);
    } else if (rec.entityType === 'opportunityStageEvent') {
      void handleSaveOpportunityStageEvent(rec.payload as OpportunityStageEvent);
    } else if (rec.entityType === 'interaction') {
      void handleSaveInteractionRecord(rec.payload as CommunicationInteraction);
    } else if (rec.entityType === 'reminder') {
      handleSaveReminderState(rec.payload as ReminderStateRecord);
    } else if (rec.entityType === 'preference') {
      handleUpdateFollowUpPreferences(rec.payload as FollowUpPreferences);
    } else if (rec.entityType === 'playbookTemplate') {
      handleSavePlaybookTemplate(rec.payload as PlaybookTemplate);
    } else if (rec.entityType === 'playbookRun') {
      handleSavePlaybookRun(rec.payload as PlaybookRun);
    }
  };

  // Conflict Resolution Handlers
  const handleResolveConflict = (
    conflict: ConflictItem,
    choice: ResolutionChoice,
    customMergedNotes?: string
  ) => {
    const isSyntheticDemo =
      conflict.isSimulated &&
      conflict.entityType === 'meeting' &&
      !meetingsRef.current.some((m) => m.id === (conflict.localVersion as Meeting).id);

    if (!isSyntheticDemo) {
      if (conflict.entityType === 'meeting') {
        const resolved = resolveConflictRecord<Meeting>(conflict, choice, customMergedNotes);
        void handleSaveMeeting(resolved);
      } else if (conflict.entityType === 'client') {
        const resolved = resolveConflictRecord<Client>(conflict, choice, customMergedNotes);
        void handleSaveClient(resolved);
      } else if (conflict.entityType === 'task') {
        const resolved = resolveConflictRecord<ActionItem>(conflict, choice, customMergedNotes);
        void handleSaveTask(resolved);
      } else if (conflict.entityType === 'note') {
        const resolved = resolveConflictRecord<Note>(conflict, choice, customMergedNotes);
        void handleSaveNote(resolved);
      } else if (conflict.entityType === 'playbookTemplate') {
        const resolved = resolveConflictRecord<PlaybookTemplate>(conflict, choice, customMergedNotes);
        handleSavePlaybookTemplate(resolved);
      } else if (conflict.entityType === 'playbookRun') {
        const localRun = conflict.localVersion as PlaybookRun;
        const remoteRun = conflict.remoteVersion as PlaybookRun;
        playbookOfflineQueueRef.current.remove(localRun.id);

        if (choice === 'keep_remote') {
          const acceptedRemote = resolveConflictRecord<PlaybookRun>(conflict, 'keep_remote');
          knownPlaybookRunRevisionRef.current.set(acceptedRemote.id, acceptedRemote.revision ?? 1);
          const applyRemote = (prev: PlaybookRun[]) => {
            const idx = prev.findIndex((r) => r.id === acceptedRemote.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = acceptedRemote;
              return next;
            }
            return [acceptedRemote, ...prev];
          };
          playbookRunsRef.current = applyRemote(playbookRunsRef.current);
          setPlaybookRuns(applyRemote);
          syncPlaybookQueueMetadata();
        } else {
          const resolved = resolveConflictRecord<PlaybookRun>(conflict, choice, customMergedNotes);
          const remoteRev = remoteRun.revision ?? 0;
          const withNextRev: PlaybookRun = {
            ...resolved,
            revision: remoteRev + 1,
            updatedAt: new Date().toISOString(),
          };
          handleSavePlaybookRun(withNextRev, { expectedBaseRevision: remoteRev });
        }
      }
    }

    const remaining = conflicts.filter((c) => c.id !== conflict.id);
    setConflicts(remaining);
    setActiveConflict(remaining.length > 0 ? remaining[0] : null);
  };

  // Simulated Conflict Trigger for Development UI Preview Only (DEV_TEST)
  const handleSimulateConflict = () => {
    const targetMeeting: Meeting = meetings[0] || {
      id: 'demo_meeting_conflict',
      clientId: clients[0]?.id || 'demo_client',
      title: 'جلسة عمل تجريبية لاختبار واجهة فض التعارض',
      dateTime: '2026-11-12T14:00:00.000Z',
      type: 'in_person',
      notes: 'النسخة المحلية (معاينة): اتفقنا على خصم 10% واعتماد المرحلة الأولى.',
      status: 'confirmed',
      photoPaths: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const remoteCopy: Meeting = {
      ...targetMeeting,
      notes: 'النسخة السحابية (معاينة): اتفقنا على خصم 15% وتأجيل المرحلة الأولى للربع القادم.',
      location: 'الرياض - المقر الرئيسي',
      updatedAt: new Date(Date.now() + 60000).toISOString(),
    };

    const conflict = detectEntityConflict(targetMeeting, remoteCopy, 'meeting', {
      isSimulated: true,
      detectionSource: 'simulated_dev',
    });
    if (conflict) {
      setConflicts([conflict]);
      setActiveConflict(conflict);
    }
  };

  // Navigation handlers
  const handleOpenNewMeeting = (
    clientId?: string,
    opportunityId?: string,
    dateTimeIso?: string
  ) => {
    if (clientId) setPreselectedClientIdForMeeting(clientId);
    setMeetingInitialTab('all');
    setMeetingCreateTrigger((prev) => ({
      clientId,
      opportunityId,
      dateTimeIso,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('meetings');
  };

  const handleOpenNewTask = (
    clientId?: string,
    opportunityId?: string,
    dueDate?: string,
    scheduledStartAt?: string,
    scheduledEndAt?: string
  ) => {
    if (clientId) setPreselectedClientIdForTask(clientId);
    setTaskCreateTrigger((prev) => ({
      clientId,
      opportunityId,
      dueDate,
      scheduledStartAt,
      scheduledEndAt,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('tasks');
  };

  const handleOpenNewOpportunity = (clientId?: string) => {
    setSelectedOpportunityId(null);
    setOpportunityCreateTrigger((prev) => ({
      clientId,
      token: (prev?.token || 0) + 1,
    }));
    setActiveTab('opportunities');
  };

  const handleOpenExistingTask = (task: ActionItem) => {
    setTaskOpenTrigger((prev) => ({
      taskId: task.id,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('tasks');
  };

  const handleOpenNewNote = (clientId?: string) => {
    setReportsInitialSubTab('notes');
    setNoteCreateTrigger((prev) => ({
      clientId,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('reports');
  };

  const handleOpenExistingNote = (note: Note) => {
    setReportsInitialSubTab('notes');
    setNoteOpenTrigger((prev) => ({
      noteId: note.id,
      nonce: (prev?.nonce || 0) + 1,
    }));
    setActiveTab('reports');
  };

  const handleOpenMeetingAttachments = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setMeetingInitialTab('attachments');
    setActiveTab('meetings');
  };

  const handlePrepareMeeting = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setMeetingInitialTab('preparation');
    setActiveTab('meetings');
  };

  const handlePrepareClientMeeting = (clientId: string) => {
    const nowMs = referenceDate.getTime() - 3600000;
    const upcomingForClient = meetingsRef.current
      .filter((m) => m.clientId === clientId && m.status !== 'cancelled')
      .filter((m) => {
        const ms = new Date(m.dateTime).getTime();
        return !Number.isNaN(ms) && ms >= nowMs;
      })
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

    if (upcomingForClient.length > 0) {
      handlePrepareMeeting(upcomingForClient[0]);
      return;
    }

    // No upcoming meeting: open new meeting creation for this client (never auto-creates)
    handleOpenNewMeeting(clientId);
  };

  const handleOpenReminderSource = (reminder: ReminderItem) => {
    if (reminder.sourceType === 'opportunity') {
      const opp = opportunitiesRef.current.find((o) => o.id === reminder.sourceId);
      if (opp) {
        setSelectedOpportunityId(opp.id);
        setActiveTab('opportunities');
        return;
      }
    }
    if (reminder.sourceType === 'task') {
      const task = tasksRef.current.find((t) => t.id === reminder.sourceId);
      if (task) {
        handleOpenExistingTask(task);
        return;
      }
    }
    if (reminder.sourceType === 'meeting') {
      const meeting = meetingsRef.current.find((m) => m.id === reminder.sourceId);
      if (meeting) {
        setSelectedMeetingId(meeting.id);
        setMeetingInitialTab('all');
        setActiveTab('meetings');
        return;
      }
    }
    if (reminder.sourceType === 'interaction') {
      const inter = interactionsRef.current.find((i) => i.id === reminder.sourceId);
      if (inter) {
        handleEditInteraction(inter);
        return;
      }
    }
    if (reminder.sourceType === 'playbook_step') {
      const targetRunId =
        reminder.playbookRunId ||
        (reminder.sourceId.includes('__step__')
          ? reminder.sourceId.split('__step__')[0]
          : reminder.sourceId);
      if (targetRunId && playbookRunsRef.current.some((r) => r.id === targetRunId)) {
        handleOpenPlaybookRun(targetRunId);
        return;
      }
    }
    if (reminder.clientId) {
      setSelectedClientId(reminder.clientId);
      setActiveTab('clients');
    }
  };

  const handleAnalyticsDrillDown = (target: AnalyticsDrillDownTarget) => {
    if (target.tab === 'clients') {
      if (target.clientId) {
        setSelectedClientId(target.clientId);
      } else {
        setSelectedClientId(null);
        setClientsFilterTrigger((prev) => ({
          quickFilter: target.quickFilter || 'all',
          createdFrom: target.createdFrom,
          createdTo: target.createdTo,
          nonce: (prev?.nonce || 0) + 1,
        }));
      }
      setActiveTab('clients');
      return;
    }

    if (target.tab === 'meetings') {
      if (target.meetingId) {
        setSelectedMeetingId(target.meetingId);
        setMeetingInitialTab('all');
      } else {
        setSelectedMeetingId(null);
        setMeetingsFilterTrigger((prev) => ({
          status: target.status || 'all',
          upcomingOnly: Boolean(target.upcomingOnly),
          nonce: (prev?.nonce || 0) + 1,
        }));
      }
      setActiveTab('meetings');
      return;
    }

    if (target.tab === 'tasks') {
      setTasksFilterTrigger((prev) => ({
        scope: target.scope || 'all',
        priority: target.priority || 'all',
        clientId: target.clientId || 'all',
        nonce: (prev?.nonce || 0) + 1,
      }));
      setActiveTab('tasks');
    }
  };

  const fullAppState: AppState = {
    clients,
    meetings,
    tasks,
    notes,
    syncState: syncSummary.syncState,
    conflicts,
    isBiometricLocked,
    isBiometricEnabled,
    pinCode,
    showHijri,
    language,
  };

  return (
    <>
      <div className="relative flex flex-col h-full bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
        <Header
          syncState={syncSummary.syncState}
          syncSummary={syncSummary}
          activeCacheMode={cacheRuntime.activeMode}
          onSyncStateChange={() => {}}
          onOpenSearch={() => setIsSearchOpen(true)}
          onTriggerLock={() => setIsBiometricLocked(true)}
          isMobileFrame={isMobileFrame}
          onToggleFrame={onToggleMobileFrame}
          language={language}
          onToggleLanguage={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          conflictCount={conflicts.length}
          onOpenConflictModal={() => {
            if (conflicts.length > 0) setActiveConflict(conflicts[0]);
          }}
          currentUser={user}
          onLogOut={handleInitiateSignOut}
          activeReminders={evaluatedReminders.active}
          remindersEnabled={followUpPreferences.remindersEnabled}
          onOpenReminderSource={handleOpenReminderSource}
          onSnoozeReminder={(rem, preset) => {
            void handleSnoozeReminder(rem, preset);
          }}
          onDismissReminder={handleDismissReminder}
          onViewAllReminders={() => setActiveTab('today')}
        />

        <main className="flex-1 overflow-y-auto px-4 py-4">
          {/* Offline Mode Notice Banner */}
          {!isOnline && (
            <div
              data-testid="offline-mode-banner"
              className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-center justify-between gap-2 shadow-2xs"
            >
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
                <span className="font-medium">
                  {syncSummary.pendingOperationsCount > 0
                    ? `وضع عدم الاتصال: لديك ${syncSummary.pendingOperationsCount} تعديلات محفوظة محلياً وبانتظار عودة الإنترنت للمزامنة.`
                    : 'أنت تعمل الآن دون اتصال بالإنترنت — ستُحفظ تعديلاتك محلياً وتُرفع تلقائياً عند عودة الاتصال.'}
                </span>
              </div>
            </div>
          )}

          {/* Visible Cache Initialization Fallback Error Banner */}
          {cacheRuntime.initError && !dismissedCacheError && (
            <div
              data-testid="session-cache-init-error"
              className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start justify-between gap-2"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{cacheRuntime.initError.messageArabic}</span>
              </div>
              <button
                onClick={() => setDismissedCacheError(true)}
                className="text-rose-600 hover:text-rose-900 p-1"
                aria-label="إغلاق تنبيه التخزين"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Preserved Rejected Writes Recovery Banner (Post-reconnect or permission errors) */}
          {rejectedWrites.length > 0 && (
            <div
              data-testid="rejected-writes-banner"
              className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs space-y-2.5 shadow-xs"
            >
              <div className="flex items-center gap-2 font-bold text-rose-900">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  فشل مزامنة {rejectedWrites.length} عملية مع الخادم — تم الحفاظ على مسودتك للمراجعة
                </span>
              </div>
              <p
                data-testid="rejected-drafts-memory-disclosure"
                className="text-[11px] bg-rose-100/80 border border-rose-200 rounded-lg px-2.5 py-2 text-rose-900 leading-relaxed"
              >
                تنبيه مهم: هذه المسودات محفوظة حالياً في{' '}
                <strong>ذاكرة الجلسة المؤقتة فقط (React Memory)</strong> ولا تُخزَّن تلقائياً في{' '}
                <span className="font-mono">localStorage</span> لحماية سرية بيانات العملاء؛ وقد تُفقد عند إعادة تحميل الصفحة. يرجى تنزيلها أو نسخ محتواها قبل المغادرة.
              </p>
              <div className="space-y-2">
                {rejectedWrites.map((rec) => (
                  <div
                    key={rec.opId}
                    className="bg-white border border-rose-200 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-bold text-stone-900 truncate">{rec.entityTitle}</div>
                      <p className="text-[11px] text-rose-800 leading-relaxed">{rec.messageArabic}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <button
                        type="button"
                        data-testid="download-rejected-draft"
                        onClick={() => handleDownloadRejectedDraft(rec)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-medium text-[11px]"
                      >
                        <Download className="w-3 h-3" />
                        <span>تنزيل (JSON)</span>
                      </button>
                      <button
                        type="button"
                        data-testid="copy-rejected-draft"
                        onClick={() => void handleCopyRejectedDraft(rec)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 font-medium text-[11px]"
                      >
                        {copiedDraftOpId === rec.opId ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-700" />
                            <span className="text-emerald-800">تم النسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>نسخ المحتوى</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRetryRejectedWrite(rec)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-[11px]"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>إعادة المحاولة</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => clearRejectedForEntity(rec.entityType, rec.entityId)}
                        className="px-2 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 text-[11px]"
                      >
                        تجاهل
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              notes={notes}
              opportunities={opportunities}
              interactions={interactions}
              onSelectMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setMeetingInitialTab('all');
                setActiveTab('meetings');
              }}
              onSelectClient={(c: Client) => {
                setSelectedClientId(c.id);
                setActiveTab('clients');
              }}
              onToggleTask={handleToggleTask}
              onNewMeeting={handleOpenNewMeeting}
              onNewTask={() => handleOpenNewTask()}
              onNewClient={() => {
                setSelectedClientId(null);
                setCreateClientTrigger((n) => n + 1);
                setActiveTab('clients');
              }}
              onGoToTab={(tab: NavTab) => setActiveTab(tab)}
              onDrillDown={handleAnalyticsDrillDown}
              collectionsLoaded={{
                clients: collectionSync.clients.loaded,
                meetings: collectionSync.meetings.loaded,
                tasks: collectionSync.tasks.loaded,
                notes: collectionSync.notes.loaded,
              }}
              hasSyncError={
                collectionSync.clients.hasError ||
                collectionSync.meetings.hasError ||
                collectionSync.tasks.hasError ||
                collectionSync.notes.hasError
              }
              hasPendingWrites={
                collectionSync.clients.hasPendingWrites ||
                collectionSync.meetings.hasPendingWrites ||
                collectionSync.tasks.hasPendingWrites ||
                collectionSync.notes.hasPendingWrites
              }
              isOnline={isOnline}
              referenceDate={referenceDate}
              showHijri={showHijri}
              language={language}
            />
          )}

          {activeTab === 'today' && (
            <TodayView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              opportunities={opportunities}
              playbookRuns={playbookRuns}
              categorizedDaily={categorizedDaily}
              upcomingMeetings={upcomingMeetingsForToday}
              clientFollowUps={clientFollowUps}
              evaluatedReminders={evaluatedReminders}
              summary={dailySummary}
              preferences={followUpPreferences}
              referenceDate={referenceDate}
              showHijri={showHijri}
              language={language}
              isOnline={isOnline}
              collectionsLoaded={{
                clients: collectionSync.clients.loaded,
                meetings: collectionSync.meetings.loaded,
                tasks: collectionSync.tasks.loaded,
                reminders: collectionSync.reminders.loaded,
                preferences: collectionSync.preferences.loaded,
              }}
              hasSyncError={
                collectionSync.clients.hasError ||
                collectionSync.meetings.hasError ||
                collectionSync.tasks.hasError ||
                collectionSync.reminders.hasError ||
                collectionSync.preferences.hasError
              }
              hasPendingWrites={
                collectionSync.clients.hasPendingWrites ||
                collectionSync.meetings.hasPendingWrites ||
                collectionSync.tasks.hasPendingWrites ||
                collectionSync.reminders.hasPendingWrites ||
                collectionSync.preferences.hasPendingWrites
              }
              onToggleTask={handleToggleTask}
              onOpenTask={handleOpenExistingTask}
              onSaveTask={handleSaveTask}
              onSelectMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setMeetingInitialTab('all');
                setActiveTab('meetings');
              }}
              onPrepareMeeting={handlePrepareMeeting}
              onSelectClient={(c: Client) => {
                setSelectedClientId(c.id);
                setActiveTab('clients');
              }}
              onSelectOpportunity={(opp: Opportunity) => {
                setSelectedOpportunityId(opp.id);
                setActiveTab('opportunities');
              }}
              onOpenPlaybookRun={handleOpenPlaybookRun}
              onStartPlaybook={() => handleOpenStartPlaybook()}
              onNewTask={handleOpenNewTask}
              onNewMeeting={handleOpenNewMeeting}
              onNewNote={handleOpenNewNote}
              onLogInteraction={(clientId?: string) => handleOpenNewInteraction({ clientId })}
              onOpenReminderSource={handleOpenReminderSource}
              onSnoozeReminder={handleSnoozeReminder}
              onUnsnoozeReminder={handleUnsnoozeReminder}
              onDismissReminder={handleDismissReminder}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenTodayCalendar={() => handleNavigateToCalendar({ mode: 'day', clientId: '' })}
              onOpenWeeklyPlanner={() =>
                handleNavigateToCalendar({ mode: 'planner', clientId: '' })
              }
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              opportunities={opportunities}
              interactions={interactions}
              playbookRuns={playbookRuns}
              currentUserId={user.uid}
              referenceDate={referenceDate}
              isOnline={isOnline}
              collectionsLoaded={{
                clients: collectionSync.clients.loaded,
                meetings: collectionSync.meetings.loaded,
                tasks: collectionSync.tasks.loaded,
                opportunities: collectionSync.opportunities.loaded,
                interactions: collectionSync.interactions.loaded,
                playbookRuns: collectionSync.playbookRuns.loaded,
              }}
              hasPendingWrites={
                collectionSync.clients.hasPendingWrites ||
                collectionSync.meetings.hasPendingWrites ||
                collectionSync.tasks.hasPendingWrites ||
                collectionSync.opportunities.hasPendingWrites ||
                collectionSync.interactions.hasPendingWrites ||
                collectionSync.playbookRuns.hasPendingWrites
              }
              calendarSettings={calendarSettings}
              onUpdateCalendarSettings={handleUpdateCalendarSettings}
              onSaveMeeting={handleSaveMeeting}
              onSaveTask={handleSaveTaskWithResult}
              onToggleTask={handleToggleTask}
              onOpenMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setMeetingInitialTab('all');
                setActiveTab('meetings');
              }}
              onPrepareMeeting={handlePrepareMeeting}
              onOpenTask={handleOpenExistingTask}
              onOpenClient={(c: Client) => {
                setSelectedClientId(c.id);
                setActiveTab('clients');
              }}
              onOpenOpportunity={(opp: Opportunity) => {
                setSelectedOpportunityId(opp.id);
                setActiveTab('opportunities');
              }}
              onOpenPlaybookRun={handleOpenPlaybookRun}
              onCreateNewMeeting={({ clientId, dateTimeIso }) =>
                handleOpenNewMeeting(clientId, undefined, dateTimeIso)
              }
              onCreateNewTask={({ clientId, dueDate, scheduledStartAt, scheduledEndAt }) =>
                handleOpenNewTask(
                  clientId,
                  undefined,
                  dueDate,
                  scheduledStartAt,
                  scheduledEndAt
                )
              }
              navigationTrigger={calendarNavTrigger}
              language={language}
            />
          )}

          {activeTab === 'clients' && (
            <ClientsView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              notes={notes}
              opportunities={opportunities}
              interactions={interactions}
              playbookRuns={playbookRuns}
              onSelectMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setMeetingInitialTab('all');
                setActiveTab('meetings');
              }}
              onPrepareMeeting={handlePrepareMeeting}
              onPrepareClientMeeting={handlePrepareClientMeeting}
              onOpenMeetingAttachments={handleOpenMeetingAttachments}
              onNewMeeting={handleOpenNewMeeting}
              onNewTask={handleOpenNewTask}
              onToggleTask={handleToggleTask}
              onOpenTask={handleOpenExistingTask}
              onNewNote={handleOpenNewNote}
              onOpenNote={handleOpenExistingNote}
              onDeleteNote={handleDeleteNote}
              onNewOpportunity={handleOpenNewOpportunity}
              onSelectOpportunity={(opp: Opportunity) => {
                setSelectedOpportunityId(opp.id);
                setActiveTab('opportunities');
              }}
              onOpenClientCalendar={(clientId: string) =>
                handleNavigateToCalendar({ mode: 'month', clientId })
              }
              onOpenPlaybookRun={handleOpenPlaybookRun}
              onStartPlaybookForClient={(clientId: string) =>
                handleOpenStartPlaybook({ clientId })
              }
              onLogInteraction={handleOpenNewInteraction}
              onEditInteraction={handleEditInteraction}
              onDeleteInteraction={handleDeleteInteraction}
              onConvertInteractionToTask={handleConvertInteractionToTask}
              onSaveClient={handleSaveClient}
              onDeleteClient={handleDeleteClient}
              selectedClientId={selectedClientId}
              onSelectedClientChange={setSelectedClientId}
              createClientTrigger={createClientTrigger}
              filterTrigger={clientsFilterTrigger}
              collectionsLoaded={{
                clients: collectionSync.clients.loaded,
                meetings: collectionSync.meetings.loaded,
                tasks: collectionSync.tasks.loaded,
                notes: collectionSync.notes.loaded,
              }}
              hasSyncError={
                collectionSync.clients.hasError ||
                collectionSync.meetings.hasError ||
                collectionSync.tasks.hasError ||
                collectionSync.notes.hasError
              }
              hasPendingWrites={
                collectionSync.clients.hasPendingWrites ||
                collectionSync.meetings.hasPendingWrites ||
                collectionSync.tasks.hasPendingWrites ||
                collectionSync.notes.hasPendingWrites
              }
              pendingClientIds={collectionSync.clients.pendingDocIds}
              failedClientIds={rejectedWrites
                .filter((r) => r.entityType === 'client')
                .map((r) => r.entityId)}
              isOnline={isOnline}
              language={language}
            />
          )}

          {activeTab === 'communications' && (
            <CommunicationsView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              opportunities={opportunities}
              interactions={interactions}
              playbookRuns={playbookRuns}
              customPlaybookTemplates={playbookTemplates}
              currentUserId={user.uid}
              isOnline={isOnline}
              playbooksLoading={
                !collectionSync.playbookRuns.loaded ||
                !collectionSync.playbookTemplates.loaded
              }
              playbookSubTab={communicationsSubTab}
              onChangePlaybookSubTab={setCommunicationsSubTab}
              selectedPlaybookRunId={selectedPlaybookRunId}
              onSelectPlaybookRun={setSelectedPlaybookRunId}
              staleThresholdDays={followUpPreferences.staleClientDays}
              language={language}
              onOpenNewInteraction={handleOpenNewInteraction}
              onEditInteraction={handleEditInteraction}
              onDeleteInteraction={(id: string) => {
                void handleDeleteInteraction(id);
              }}
              onConvertInteractionToTask={(updated, draft) => {
                void handleConvertInteractionToTask(updated, draft);
              }}
              onSelectClient={(c: Client) => {
                setSelectedClientId(c.id);
                setActiveTab('clients');
              }}
              onSelectOpportunity={(opp: Opportunity) => {
                setSelectedOpportunityId(opp.id);
                setActiveTab('opportunities');
              }}
              onNavigateToTasks={() => setActiveTab('tasks')}
              onOpenTask={handleOpenExistingTask}
              onOpenStartPlaybook={handleOpenStartPlaybook}
              onOpenCreatePlaybookTemplate={() =>
                setPlaybookTemplateEditorState({ isOpen: true, initialTemplate: null })
              }
              onOpenEditPlaybookTemplate={(tpl) =>
                setPlaybookTemplateEditorState({ isOpen: true, initialTemplate: tpl })
              }
              onSavePlaybookTemplate={handleSavePlaybookTemplate}
              onDeletePlaybookTemplate={handleDeletePlaybookTemplate}
              onSavePlaybookRun={handleSavePlaybookRun}
              onSaveTask={(t) => {
                void handleSaveTask(t);
              }}
              onAtomicConvertStepToTask={handleAtomicConvertPlaybookStepToTask}
              onApprovePlaybookRescheduleSuggestion={handleApprovePlaybookRescheduleSuggestion}
              onLogCommunicationForPlaybookStep={({ run, step, suggestedChannel }) => {
                setPendingInteractionStepContext({ runId: run.id, stepId: step.id });
                handleOpenNewInteraction({
                  clientId: run.clientId,
                  opportunityId: run.opportunityId,
                  channel: suggestedChannel || step.suggestedChannel,
                });
              }}
            />
          )}

          {activeTab === 'opportunities' && (
            <OpportunitiesView
              opportunities={opportunities}
              stageEvents={opportunityStageEvents}
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              interactions={interactions}
              playbookRuns={playbookRuns}
              selectedOpportunityId={selectedOpportunityId}
              onSelectOpportunity={setSelectedOpportunityId}
              onSaveOpportunity={handleSaveOpportunity}
              onRequestStageChange={handleRequestOpportunityStageChange}
              onDeleteOpportunity={handleDeleteOpportunity}
              onConvertNextActionToTask={handleConvertNextActionToTask}
              onLinkMeeting={handleLinkMeetingToOpportunity}
              onUnlinkMeeting={handleUnlinkMeetingFromOpportunity}
              onLinkTask={handleLinkTaskToOpportunity}
              onUnlinkTask={handleUnlinkTaskFromOpportunity}
              onToggleTaskStatus={(task: ActionItem) => {
                handleToggleTask(task.id);
              }}
              onCreateLinkedMeeting={(opp: Opportunity) =>
                handleOpenNewMeeting(opp.clientId, opp.id)
              }
              onCreateLinkedTask={(opp: Opportunity) =>
                handleOpenNewTask(opp.clientId, opp.id)
              }
              onLogInteraction={handleOpenNewInteraction}
              onEditInteraction={handleEditInteraction}
              onOpenClient={(clientId: string) => {
                setSelectedClientId(clientId);
                setActiveTab('clients');
              }}
              onOpenMeeting={(meetingId: string) => {
                setSelectedMeetingId(meetingId);
                setMeetingInitialTab('all');
                setActiveTab('meetings');
              }}
              onOpenTask={(taskId: string) => {
                const task = tasksRef.current.find((t) => t.id === taskId);
                if (task) handleOpenExistingTask(task);
              }}
              onOpenPlaybookRun={handleOpenPlaybookRun}
              onStartPlaybookForOpportunity={(opp: Opportunity) =>
                handleOpenStartPlaybook({ clientId: opp.clientId, opportunityId: opp.id })
              }
              createTrigger={opportunityCreateTrigger}
              isLoading={!collectionSync.opportunities.loaded}
              syncState={syncSummary.syncState}
              language={language}
            />
          )}

          {activeTab === 'meetings' && (
            <MeetingsView
              meetings={meetings}
              clients={clients}
              tasks={tasks}
              notes={notes}
              opportunities={opportunities}
              opportunityStageEvents={opportunityStageEvents}
              interactions={interactions}
              currentUserId={user.uid}
              collectionsLoaded={{
                clients: collectionSync.clients.loaded,
                meetings: collectionSync.meetings.loaded,
                tasks: collectionSync.tasks.loaded,
                notes: collectionSync.notes.loaded,
                opportunities: collectionSync.opportunities.loaded,
                opportunityStageEvents: collectionSync.opportunityStageEvents.loaded,
                interactions: collectionSync.interactions.loaded,
              }}
              hasPendingWrites={collectionSync.meetings.hasPendingWrites}
              onSaveMeeting={handleSaveMeeting}
              onDeleteMeeting={handleDeleteMeeting}
              onSaveTask={handleSaveTaskWithResult}
              onToggleTask={handleToggleTask}
              onOpenPdfModal={(m: Meeting) => setPdfMeeting(m)}
              onNewTaskFromMeeting={(m: Meeting) => handleOpenNewTask(m.clientId)}
              onSelectOpportunity={(oppId: string) => {
                setSelectedOpportunityId(oppId);
                setActiveTab('opportunities');
              }}
              onSelectClient={(clientId: string) => {
                setSelectedClientId(clientId);
                setActiveTab('clients');
              }}
              onOpenTask={(taskId: string) => {
                const task = tasksRef.current.find((t) => t.id === taskId);
                if (task) handleOpenExistingTask(task);
              }}
              selectedMeetingId={selectedMeetingId}
              onSelectMeetingChange={(m: Meeting | null) => setSelectedMeetingId(m ? m.id : null)}
              preselectedClientId={preselectedClientIdForMeeting}
              initialWorkspaceTab={meetingInitialTab}
              createTrigger={meetingCreateTrigger}
              filterTrigger={meetingsFilterTrigger}
              pendingMeetingIds={collectionSync.meetings.pendingDocIds}
              failedMeetingIds={rejectedWrites
                .filter((r) => r.entityType === 'meeting')
                .map((r) => r.entityId)}
              language={language}
              isOnline={isOnline}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksView
              tasks={tasks}
              clients={clients}
              meetings={meetings}
              opportunities={opportunities}
              playbookRuns={playbookRuns}
              onToggleTask={handleToggleTask}
              onSaveTask={handleSaveTaskWithResult}
              onDeleteTask={handleDeleteTask}
              onSelectOpportunity={(oppId: string) => {
                setSelectedOpportunityId(oppId);
                setActiveTab('opportunities');
              }}
              onOpenPlaybookRun={handleOpenPlaybookRun}
              onScheduleInCalendar={(task: ActionItem) =>
                handleNavigateToCalendar({
                  mode: 'planner',
                  dateKey: task.dueDate,
                  scheduleTaskId: task.id,
                  clientId: '',
                })
              }
              preselectedClientId={preselectedClientIdForTask}
              createTrigger={taskCreateTrigger}
              openTaskTrigger={taskOpenTrigger}
              filterTrigger={tasksFilterTrigger}
              language={language}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              notes={notes}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              initialSubTab={reportsInitialSubTab}
              createNoteTrigger={noteCreateTrigger}
              openNoteTrigger={noteOpenTrigger}
              language={language}
            />
          )}
        </main>

        <BottomNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          overdueTasksCount={overdue.length}
          upcomingMeetingsCount={upcomingMeetingsCount}
          activeRemindersCount={
            followUpPreferences.remindersEnabled ? evaluatedReminders.activeCount : 0
          }
          overdueOpportunitiesCount={dailySummary.overdueOpportunitiesCount || 0}
          calendarConflictsCount={calendarConflictsCount}
          dueCommunicationsCount={
            commCenterSummary.followUpsDueTodayCount + commCenterSummary.followUpsOverdueCount
          }
          language={language}
        />
      </div>

      {/* Global Modals within User Session Boundary */}
      <InteractionFormModal
        isOpen={interactionModalState.isOpen}
        onClose={() => {
          setInteractionModalState((prev) => ({ ...prev, isOpen: false }));
          setPendingInteractionStepContext(null);
        }}
        clients={clients}
        opportunities={opportunities}
        tasks={tasks}
        initialInteraction={interactionModalState.initialInteraction}
        defaultClientId={interactionModalState.defaultClientId}
        defaultContactId={interactionModalState.defaultContactId}
        defaultOpportunityId={interactionModalState.defaultOpportunityId}
        defaultChannel={interactionModalState.defaultChannel}
        onSaveInteraction={(interaction, followUpTaskDraft) => {
          void handleSaveInteraction(interaction, followUpTaskDraft);
        }}
      />

      <PlaybookStartModal
        isOpen={playbookStartModalState.isOpen}
        onClose={() => setPlaybookStartModalState({ isOpen: false })}
        customTemplates={playbookTemplates}
        clients={clients}
        opportunities={opportunities}
        existingRuns={playbookRuns}
        currentUserId={user.uid}
        defaultTemplateId={playbookStartModalState.defaultTemplateId}
        defaultClientId={playbookStartModalState.defaultClientId}
        defaultOpportunityId={playbookStartModalState.defaultOpportunityId}
        language={language}
        onStartRun={(run) => {
          handleSavePlaybookRun(run);
          handleOpenPlaybookRun(run.id);
        }}
      />

      <PlaybookTemplateEditorModal
        isOpen={playbookTemplateEditorState.isOpen}
        onClose={() => setPlaybookTemplateEditorState({ isOpen: false, initialTemplate: null })}
        initialTemplate={playbookTemplateEditorState.initialTemplate}
        currentUserId={user.uid}
        language={language}
        onSaveTemplate={handleSavePlaybookTemplate}
      />

      {isBiometricLocked && (
        <BiometricLockModal
          isOpen={isBiometricLocked}
          onUnlock={() => setIsBiometricLocked(false)}
          expectedPin={pinCode}
          language={language}
        />
      )}

      {isSearchOpen && (
        <SearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          data={{ clients, meetings, tasks, notes, opportunities, interactions, playbookRuns }}
          currentUserId={user.uid}
          collectionsLoaded={{
            clients: collectionSync.clients.loaded,
            meetings: collectionSync.meetings.loaded,
            tasks: collectionSync.tasks.loaded,
            notes: collectionSync.notes.loaded,
            opportunities: collectionSync.opportunities.loaded,
            interactions: collectionSync.interactions.loaded,
            playbookRuns: collectionSync.playbookRuns.loaded,
          }}
          onSelectClient={(client: Client) => {
            setSelectedClientId(client.id);
            setActiveTab('clients');
          }}
          onSelectMeeting={(meeting: Meeting) => {
            setSelectedMeetingId(meeting.id);
            setMeetingInitialTab('all');
            setActiveTab('meetings');
          }}
          onSelectTask={(task: ActionItem) => {
            handleOpenExistingTask(task);
          }}
          onSelectNote={(note: Note) => {
            handleOpenExistingNote(note);
          }}
          onSelectOpportunity={(opportunity: Opportunity) => {
            setSelectedOpportunityId(opportunity.id);
            setActiveTab('opportunities');
          }}
          onSelectInteraction={(inter: CommunicationInteraction) => {
            handleEditInteraction(inter);
          }}
          onSelectPlaybookRun={(run: PlaybookRun) => {
            handleOpenPlaybookRun(run.id);
          }}
          language={language}
        />
      )}

      {pendingStageTransition && (
        <OpportunityCloseModal
          isOpen={Boolean(pendingStageTransition)}
          mode={pendingStageTransition.mode}
          opportunity={pendingStageTransition.opportunity}
          targetStage={pendingStageTransition.targetStage}
          onCancel={() => setPendingStageTransition(null)}
          onConfirm={handleConfirmOpportunityStageChange}
          language={language}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          appState={fullAppState}
          onUpdateState={(updates: Partial<AppState>) => {
            if (updates.isBiometricEnabled !== undefined) setIsBiometricEnabled(updates.isBiometricEnabled);
            if (updates.showHijri !== undefined) setShowHijri(updates.showHijri);
            if (updates.language !== undefined) setLanguage(updates.language);
          }}
          onResetData={() => {}}
          language={language}
          onTriggerSimulatedConflict={handleSimulateConflict}
          pendingOperationsCount={syncSummary.pendingOperationsCount}
          rejectedWritesCount={rejectedWrites.length}
          followUpPreferences={followUpPreferences}
          onUpdateFollowUpPreferences={handleUpdateFollowUpPreferences}
          currentUserId={user.uid}
          opportunities={opportunities}
          opportunityStageEvents={opportunityStageEvents}
          interactions={interactions}
          playbookTemplates={playbookTemplates}
          playbookRuns={playbookRuns}
          isOnline={isOnline}
          collectionsLoaded={{
            clients: collectionSync.clients.loaded,
            meetings: collectionSync.meetings.loaded,
            tasks: collectionSync.tasks.loaded,
            notes: collectionSync.notes.loaded,
            opportunities: collectionSync.opportunities.loaded,
            opportunityStageEvents: collectionSync.opportunityStageEvents.loaded,
            interactions: collectionSync.interactions.loaded,
            playbookTemplates: collectionSync.playbookTemplates.loaded,
            playbookRuns: collectionSync.playbookRuns.loaded,
          }}
          importHandlers={{
            saveClient: async (client: Client) => {
              const handle = fbSaveClient(client);
              await handle.serverPromise;
            },
            saveOpportunity: async (opp: Opportunity) => {
              const handle = fbSaveOpportunity(opp);
              await handle.serverPromise;
            },
            saveMeeting: async (meeting: Meeting) => {
              const handle = fbSaveMeeting(meeting);
              await handle.serverPromise;
            },
            saveTask: async (task: ActionItem) => {
              const handle = fbSaveTask(task);
              await handle.serverPromise;
            },
            saveNote: async (note: Note) => {
              const handle = fbSaveNote(note);
              await handle.serverPromise;
            },
            saveOpportunityStageEvent: async (ev: OpportunityStageEvent) => {
              const handle = fbSaveOpportunityStageEvent(ev);
              await handle.serverPromise;
            },
            saveInteraction: async (inter: CommunicationInteraction) => {
              const handle = fbSaveInteraction(inter);
              await handle.serverPromise;
            },
            savePlaybookTemplate: async (tpl: PlaybookTemplate) => {
              const handle = fbSavePlaybookTemplate(tpl);
              await handle.serverPromise;
            },
            savePlaybookRun: async (run: PlaybookRun) => {
              const handle = fbSavePlaybookRun(run, { expectedBaseRevision: 0 });
              await handle.serverPromise;
            },
          }}
        />
      )}

      {pdfMeeting && (
        <MeetingMinutesPdfModal
          isOpen={Boolean(pdfMeeting)}
          meeting={meetings.find((m) => m.id === pdfMeeting.id) || pdfMeeting}
          client={clients.find((c) => c.id === pdfMeeting.clientId)}
          tasks={tasks}
          onClose={() => setPdfMeeting(null)}
          onSaveMeeting={handleSaveMeeting}
          language={language}
        />
      )}

      {activeConflict && (
        <ConflictResolutionModal
          conflict={activeConflict}
          onResolve={handleResolveConflict}
          onClose={() => setActiveConflict(null)}
          language={language}
        />
      )}

      {/* Safe Sign-Out Guard Dialog for Pending Local Writes */}
      {showSignOutWarning && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            data-testid="signout-pending-warning"
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-amber-200 animate-in fade-in zoom-in-95 text-stone-800"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold mb-2">
              تنبيه: توجد تعديلات محلية لم تُؤكد سحابياً بعد
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed mb-6">
              {signOutSafety.warningArabic}
            </p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => setShowSignOutWarning(false)}
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-medium hover:bg-emerald-800 transition-colors"
              >
                الانتظار لإكمال المزامنة
              </button>
              <button
                data-testid="confirm-forced-signout"
                onClick={handleConfirmForcedSignOut}
                className="px-4 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                تأكيد تسجيل الخروج رغم ذلك
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
