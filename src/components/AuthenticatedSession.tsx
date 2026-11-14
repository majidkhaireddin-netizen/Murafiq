import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  AppState,
  Client,
  Meeting,
  ActionItem,
  Note,
  ConflictItem,
  ResolutionChoice,
  RejectedWriteRecord,
} from '../types';
import { categorizeTasks } from '../utils/logic';
import { Header } from './Header';
import { BottomNav, NavTab } from './BottomNav';
import { DashboardView } from './views/DashboardView';
import { ClientsView } from './views/ClientsView';
import { MeetingsView } from './views/MeetingsView';
import { TasksView } from './views/TasksView';
import { ReportsView } from './views/ReportsView';
import { MeetingMinutesPdfModal } from './MeetingMinutesPdfModal';
import { BiometricLockModal } from './BiometricLockModal';
import { SearchModal } from './SearchModal';
import { SettingsModal } from './SettingsModal';
import { ConflictResolutionModal } from './ConflictResolutionModal';
import { detectEntityConflict, resolveConflictRecord } from '../utils/conflictLogic';
import {
  computeDetailedSyncSummary,
  canSafelySignOut,
  CollectionSyncStatus,
  CollectionKey,
} from '../utils/syncLogic';
import {
  getCacheRuntimeState,
  subscribeClients,
  subscribeMeetings,
  subscribeTasks,
  subscribeNotes,
  saveClient as fbSaveClient,
  deleteClient as fbDeleteClient,
  saveMeeting as fbSaveMeeting,
  deleteMeeting as fbDeleteMeeting,
  saveTask as fbSaveTask,
  deleteTask as fbDeleteTask,
  saveNote as fbSaveNote,
  deleteNote as fbDeleteNote,
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

  // Live refs for deterministic per-entity previous-state lookup across concurrent operations
  const clientsRef = useRef<Client[]>(clients);
  const meetingsRef = useRef<Meeting[]>(meetings);
  const tasksRef = useRef<ActionItem[]>(tasks);
  const notesRef = useRef<Note[]>(notes);
  clientsRef.current = clients;
  meetingsRef.current = meetings;
  tasksRef.current = tasks;
  notesRef.current = notes;

  // Operation-scoped coordinators (prevent cross-entity or out-of-order array clobbering)
  const clientOpsRef = useRef(new OperationCoordinator<Client>());
  const meetingOpsRef = useRef(new OperationCoordinator<Meeting>());
  const taskOpsRef = useRef(new OperationCoordinator<ActionItem>());
  const noteOpsRef = useRef(new OperationCoordinator<Note>());

  // Track active in-flight deletes per collection so pending counts stay accurate when docs leave local snapshots
  const pendingDeleteIdsRef = useRef<Record<CollectionKey, Set<string>>>({
    clients: new Set(),
    meetings: new Set(),
    tasks: new Set(),
    notes: new Set(),
  });

  // Connectivity & Cache Runtime Status
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const cacheRuntime = getCacheRuntimeState();
  const [dismissedCacheError, setDismissedCacheError] = useState(false);

  // Detailed Synchronization Tracking across all 4 collections
  const [collectionSync, setCollectionSync] = useState<Record<CollectionKey, CollectionSyncStatus>>({
    clients: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    meetings: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    tasks: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
    notes: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false, pendingDocIds: [], pendingDeletesCount: 0 },
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
  const [preselectedClientIdForMeeting, setPreselectedClientIdForMeeting] = useState<string | null>(null);
  const [preselectedClientIdForTask, setPreselectedClientIdForTask] = useState<string | null>(null);

  // Listen to browser online/offline transitions
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
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

    return () => {
      isSubscribed = false;
      clearAttachmentDownloadCache();
      unsubClients();
      unsubMeetings();
      unsubTasks();
      unsubNotes();
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
    payload?: Client | Meeting | ActionItem | Note;
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

  // Counts for UI
  const { overdue } = categorizeTasks(tasks);
  const now = new Date();
  const upcomingMeetingsCount = meetings.filter((m) => {
    const diffMs = new Date(m.dateTime).getTime() - now.getTime();
    return diffMs >= -3600000 && diffMs <= 7 * 24 * 3600000;
  }).length;

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

    return new Promise<void>((resolve, reject) => {
      taskOpsRef.current.runScopedMutation({
        entityId: task.id,
        entityType: 'task',
        previousEntity: prevEntity,
        setState: setTasks,
        applyOptimistic: applyUpsert,
        dispatchWrite: () => fbSaveTask(task),
        onServerConfirmed: ({ wasSuperseded }) => {
          clearRejectedForEntity('task', task.id, wasSuperseded);
          resolve();
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
          reject(new Error(classification.messageArabic));
        },
      });

      if (!isOnline) {
        resolve();
      }
    });
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

    meetingOpsRef.current.runScopedMutation({
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

  // Retry a rejected write using its preserved payload
  const handleRetryRejectedWrite = (rec: RejectedWriteRecord) => {
    clearRejectedForEntity(rec.entityType, rec.entityId);

    if (rec.operation === 'delete') {
      if (rec.entityType === 'client') void handleDeleteClient(rec.entityId);
      else if (rec.entityType === 'task') void handleDeleteTask(rec.entityId);
      else if (rec.entityType === 'note') void handleDeleteNote(rec.entityId);
      else if (rec.entityType === 'meeting') {
        void handleDeleteMeeting(rec.entityId);
      }
      return;
    }

    if (!rec.payload) return;
    if (rec.entityType === 'client') void handleSaveClient(rec.payload as Client);
    else if (rec.entityType === 'meeting') void handleSaveMeeting(rec.payload as Meeting);
    else if (rec.entityType === 'task') void handleSaveTask(rec.payload as ActionItem);
    else if (rec.entityType === 'note') void handleSaveNote(rec.payload as Note);
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
  const handleOpenNewMeeting = (clientId?: string) => {
    if (clientId) setPreselectedClientIdForMeeting(clientId);
    setActiveTab('meetings');
  };

  const handleOpenNewTask = (clientId?: string) => {
    if (clientId) setPreselectedClientIdForTask(clientId);
    setActiveTab('tasks');
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
              onSelectMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setActiveTab('meetings');
              }}
              onSelectClient={(c: Client) => {
                setSelectedClientId(c.id);
                setActiveTab('clients');
              }}
              onToggleTask={handleToggleTask}
              onNewMeeting={() => handleOpenNewMeeting()}
              onNewTask={() => handleOpenNewTask()}
              onNewClient={() => {
                setSelectedClientId(null);
                setActiveTab('clients');
              }}
              onGoToTab={(tab: NavTab) => setActiveTab(tab)}
              showHijri={showHijri}
              language={language}
            />
          )}

          {activeTab === 'clients' && (
            <ClientsView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              notes={notes}
              onSelectMeeting={(m: Meeting) => {
                setSelectedMeetingId(m.id);
                setActiveTab('meetings');
              }}
              onNewMeeting={handleOpenNewMeeting}
              onNewTask={handleOpenNewTask}
              onSaveClient={handleSaveClient}
              onDeleteClient={handleDeleteClient}
              selectedClientId={selectedClientId}
              language={language}
            />
          )}

          {activeTab === 'meetings' && (
            <MeetingsView
              meetings={meetings}
              clients={clients}
              tasks={tasks}
              onSaveMeeting={handleSaveMeeting}
              onDeleteMeeting={handleDeleteMeeting}
              onSaveTask={handleSaveTaskWithResult}
              onToggleTask={handleToggleTask}
              onOpenPdfModal={(m: Meeting) => setPdfMeeting(m)}
              onNewTaskFromMeeting={(m: Meeting) => handleOpenNewTask(m.clientId)}
              selectedMeetingId={selectedMeetingId}
              onSelectMeetingChange={(m: Meeting | null) => setSelectedMeetingId(m ? m.id : null)}
              preselectedClientId={preselectedClientIdForMeeting}
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
              onToggleTask={handleToggleTask}
              onSaveTask={handleSaveTask}
              onDeleteTask={handleDeleteTask}
              preselectedClientId={preselectedClientIdForTask}
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
              language={language}
            />
          )}
        </main>

        <BottomNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          overdueTasksCount={overdue.length}
          upcomingMeetingsCount={upcomingMeetingsCount}
          language={language}
        />
      </div>

      {/* Global Modals within User Session Boundary */}
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
          data={{ clients, meetings, tasks, notes }}
          onSelectClient={(client: Client) => {
            setSelectedClientId(client.id);
            setActiveTab('clients');
          }}
          onSelectMeeting={(meeting: Meeting) => {
            setSelectedMeetingId(meeting.id);
            setActiveTab('meetings');
          }}
          onSelectTask={() => {
            setActiveTab('tasks');
          }}
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
