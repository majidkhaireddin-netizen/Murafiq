import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { AppState, Client, Meeting, ActionItem, Note, SyncState, ConflictItem, ResolutionChoice } from '../types';
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
  computeAggregatedSyncState,
  canSafelySignOut,
  CollectionSyncStatus,
  CollectionKey,
} from '../utils/syncLogic';
import {
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
import { AlertTriangle } from 'lucide-react';

import { executeWithRollback, getArabicSaveErrorMessage } from '../utils/sessionState';

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

  // Detailed Synchronization Tracking across all 4 collections
  const [collectionSync, setCollectionSync] = useState<Record<CollectionKey, CollectionSyncStatus>>({
    clients: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false },
    meetings: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false },
    tasks: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false },
    notes: { loaded: false, hasPendingWrites: false, fromCache: true, hasError: false },
  });

  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [activeConflict, setActiveConflict] = useState<ConflictItem | null>(null);

  // App Settings & Protection
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(true);
  const [pinCode, setPinCode] = useState('1234');
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

  // Aggregate Sync State derived purely from active collections metadata
  const currentSyncState: SyncState = computeAggregatedSyncState(collectionSync, conflicts.length > 0);

  // Initialize Isolated Subscriptions for this User UID
  useEffect(() => {
    let isSubscribed = true;
    const sessionUid = user.uid;

    const unsubClients = subscribeClients(
      (data, meta) => {
        if (!isSubscribed) return;
        setClients(data);
        setCollectionSync((prev) => ({
          ...prev,
          clients: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
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
        setMeetings(data);
        setCollectionSync((prev) => ({
          ...prev,
          meetings: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
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
        setTasks(data);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
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
        setNotes(data);
        setCollectionSync((prev) => ({
          ...prev,
          notes: {
            loaded: true,
            hasPendingWrites: meta.hasPendingWrites,
            fromCache: meta.fromCache,
            hasError: false,
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
      unsubClients();
      unsubMeetings();
      unsubTasks();
      unsubNotes();
    };
  }, [user.uid]);

  // Safe Sign-Out Verification
  const handleInitiateSignOut = () => {
    const safetyCheck = canSafelySignOut(collectionSync);
    if (!safetyCheck.safe) {
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

  // Global save error banner state
  const [saveErrorBanner, setSaveErrorBanner] = useState<string | null>(null);

  // Task Mutations
  const handleToggleTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updated: ActionItem = {
      ...task,
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
    };

    const res = await executeWithRollback(
      tasks,
      setTasks,
      (prev) => prev.map((t) => (t.id === taskId ? updated : t)),
      () => fbSaveTask(updated),
      (err) => {
        console.warn('Save task status error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: { ...prev.tasks, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('task', false));
      }
    );
    if (res.success) setSaveErrorBanner(null);
  };

  const handleSaveTask = async (task: ActionItem) => {
    const res = await executeWithRollback(
      tasks,
      setTasks,
      (prev) => {
        const idx = prev.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = task;
          return updated;
        }
        return [task, ...prev];
      },
      () => fbSaveTask(task),
      (err) => {
        console.warn('Save task error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: { ...prev.tasks, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('task', false));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const res = await executeWithRollback(
      tasks,
      setTasks,
      (prev) => prev.filter((t) => t.id !== taskId),
      () => fbDeleteTask(taskId),
      (err) => {
        console.warn('Delete task error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          tasks: { ...prev.tasks, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('task', true));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  // Meeting Mutations
  const handleSaveMeeting = async (meeting: Meeting) => {
    const res = await executeWithRollback(
      meetings,
      setMeetings,
      (prev) => {
        const idx = prev.findIndex((m) => m.id === meeting.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = meeting;
          return updated;
        }
        return [meeting, ...prev];
      },
      () => fbSaveMeeting(meeting),
      (err) => {
        console.warn('Save meeting error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          meetings: { ...prev.meetings, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('meeting', false));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    const res = await executeWithRollback(
      meetings,
      setMeetings,
      (prev) => prev.filter((m) => m.id !== meetingId),
      () => fbDeleteMeeting(meetingId),
      (err) => {
        console.warn('Delete meeting error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          meetings: { ...prev.meetings, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('meeting', true));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  // Client Mutations
  const handleSaveClient = async (client: Client) => {
    const res = await executeWithRollback(
      clients,
      setClients,
      (prev) => {
        const idx = prev.findIndex((c) => c.id === client.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = client;
          return updated;
        }
        return [client, ...prev];
      },
      () => fbSaveClient(client),
      (err) => {
        console.warn('Save client error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          clients: { ...prev.clients, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('client', false));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    const res = await executeWithRollback(
      clients,
      setClients,
      (prev) => prev.filter((c) => c.id !== clientId),
      () => fbDeleteClient(clientId),
      (err) => {
        console.warn('Delete client error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          clients: { ...prev.clients, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('client', true));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  // Note Mutations
  const handleSaveNote = async (note: Note) => {
    const res = await executeWithRollback(
      notes,
      setNotes,
      (prev) => [note, ...prev],
      () => fbSaveNote(note),
      (err) => {
        console.warn('Save note error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          notes: { ...prev.notes, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('note', false));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    const res = await executeWithRollback(
      notes,
      setNotes,
      (prev) => prev.filter((n) => n.id !== noteId),
      () => fbDeleteNote(noteId),
      (err) => {
        console.warn('Delete note error:', err);
        setCollectionSync((prev) => ({
          ...prev,
          notes: { ...prev.notes, hasError: true },
        }));
        setSaveErrorBanner(getArabicSaveErrorMessage('note', true));
      }
    );
    if (!res.success && res.error) {
      throw res.error;
    } else {
      setSaveErrorBanner(null);
    }
  };

  // Conflict Resolution Handlers
  const handleResolveConflict = async (
    conflict: ConflictItem,
    choice: ResolutionChoice,
    customMergedNotes?: string
  ) => {
    if (conflict.entityType === 'meeting') {
      const resolved = resolveConflictRecord<Meeting>(conflict, choice, customMergedNotes);
      setMeetings((prev) => prev.map((m) => (m.id === resolved.id ? resolved : m)));
      await fbSaveMeeting(resolved);
    } else if (conflict.entityType === 'client') {
      const resolved = resolveConflictRecord<Client>(conflict, choice, customMergedNotes);
      setClients((prev) => prev.map((c) => (c.id === resolved.id ? resolved : c)));
      await fbSaveClient(resolved);
    } else if (conflict.entityType === 'task') {
      const resolved = resolveConflictRecord<ActionItem>(conflict, choice, customMergedNotes);
      setTasks((prev) => prev.map((t) => (t.id === resolved.id ? resolved : t)));
      await fbSaveTask(resolved);
    } else if (conflict.entityType === 'note') {
      const resolved = resolveConflictRecord<Note>(conflict, choice, customMergedNotes);
      setNotes((prev) => prev.map((n) => (n.id === resolved.id ? resolved : n)));
      await fbSaveNote(resolved);
    }

    const remaining = conflicts.filter((c) => c.id !== conflict.id);
    setConflicts(remaining);
    setActiveConflict(remaining.length > 0 ? remaining[0] : null);
  };

  // Simulated Conflict Trigger for Development Testing Only
  const handleSimulateConflict = () => {
    const targetMeeting: Meeting = meetings[0] || {
      id: 'demo_meeting_conflict',
      clientId: clients[0]?.id || 'demo_client',
      title: 'جلسة عمل تجريبية لاختبار فض التعارض',
      dateTime: '2026-11-12T14:00:00.000Z',
      type: 'in_person',
      notes: 'النسخة المحلية: اتفقنا على خصم 10% واعتماد المرحلة الأولى.',
      status: 'confirmed',
      photoPaths: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const remoteCopy: Meeting = {
      ...targetMeeting,
      notes: 'النسخة السحابية: اتفقنا على خصم 15% وتأجيل المرحلة الأولى للربع القادم.',
      location: 'الرياض - المقر الرئيسي',
      updatedAt: new Date(Date.now() + 60000).toISOString(),
    };

    const conflict = detectEntityConflict(targetMeeting, remoteCopy, 'meeting');
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
    syncState: currentSyncState,
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
          syncState={currentSyncState}
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
          {saveErrorBanner && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2 shadow-xs animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-medium">{saveErrorBanner}</span>
              </div>
              <button
                onClick={() => setSaveErrorBanner(null)}
                className="text-rose-600 hover:text-rose-900 p-1 font-bold text-xs"
              >
                إغلاق
              </button>
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
              onOpenPdfModal={(m: Meeting) => setPdfMeeting(m)}
              onNewTaskFromMeeting={(m: Meeting) => handleOpenNewTask(m.clientId)}
              selectedMeetingId={selectedMeetingId}
              onSelectMeetingChange={(m: Meeting | null) => setSelectedMeetingId(m ? m.id : null)}
              preselectedClientId={preselectedClientIdForMeeting}
              language={language}
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
        />
      )}

      {pdfMeeting && (
        <MeetingMinutesPdfModal
          isOpen={Boolean(pdfMeeting)}
          meeting={pdfMeeting}
          client={clients.find((c) => c.id === pdfMeeting.clientId)}
          tasks={tasks}
          onClose={() => setPdfMeeting(null)}
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
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-amber-200 animate-in fade-in zoom-in-95 text-stone-800">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold mb-2">
              تنبيه: توجد تعديلات محلية قيد المزامنة
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed mb-6">
              هناك بيانات أو تعديلات أجريتها لم تكتمل مزامنتها مع الخادم السحابي بعد (Pending Writes).
              تسجيل الخروج الآن قد يؤدي لفقدان هذه التعديلات المحلية غير المؤكدة من الخادم.
            </p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => setShowSignOutWarning(false)}
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-medium hover:bg-emerald-800 transition-colors"
              >
                الانتظار لإكمال المزامنة
              </button>
              <button
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
