import React, { useState, useEffect } from 'react';
import { AppState, Client, Meeting, ActionItem, Note, SyncState } from './types';
import { INITIAL_CLIENTS, INITIAL_MEETINGS, INITIAL_TASKS, INITIAL_NOTES } from './data/mockData';
import { categorizeTasks } from './utils/logic';
import { Header } from './components/Header';
import { BottomNav, NavTab } from './components/BottomNav';
import { DashboardView } from './components/views/DashboardView';
import { ClientsView } from './components/views/ClientsView';
import { MeetingsView } from './components/views/MeetingsView';
import { TasksView } from './components/views/TasksView';
import { ReportsView } from './components/views/ReportsView';
import { MeetingMinutesPdfModal } from './components/MeetingMinutesPdfModal';
import { BiometricLockModal } from './components/BiometricLockModal';
import { SearchModal } from './components/SearchModal';
import { SettingsModal } from './components/SettingsModal';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { ConflictItem, ResolutionChoice } from './types';
import { detectEntityConflict, resolveConflictRecord } from './utils/conflictLogic';
import {
  testConnection,
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
  seedInitialData,
} from './services/firebase';
import { Wifi, BatteryMedium, Signal } from 'lucide-react';

export default function App() {
  // Main app state
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
  const [meetings, setMeetings] = useState<Meeting[]>(INITIAL_MEETINGS);
  const [tasks, setTasks] = useState<ActionItem[]>(INITIAL_TASKS);
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);

  // System & Settings state
  const [syncState, setSyncState] = useState<SyncState>('pending');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [activeConflict, setActiveConflict] = useState<ConflictItem | null>(null);
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(true);
  const [pinCode, setPinCode] = useState('1234');
  const [showHijri, setShowHijri] = useState(true);
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [isMobileFrame, setIsMobileFrame] = useState(true);

  // Navigation state
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pdfMeeting, setPdfMeeting] = useState<Meeting | null>(null);

  // Cross-view selection helpers
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [preselectedClientIdForMeeting, setPreselectedClientIdForMeeting] = useState<string | null>(null);
  const [preselectedClientIdForTask, setPreselectedClientIdForTask] = useState<string | null>(null);

  // Firestore Live Subscriptions on Mount
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const initFirebaseSync = async () => {
      setSyncState('pending');
      const isConnected = await testConnection();
      if (!isConnected) {
        setSyncState('local');
        return;
      }

      const unsubClients = subscribeClients(
        (data) => {
          if (data.length > 0) {
            setClients(data);
          } else {
            // Seed database with authentic initial Arabic data if completely empty
            seedInitialData(INITIAL_CLIENTS, INITIAL_MEETINGS, INITIAL_TASKS, INITIAL_NOTES);
          }
          setSyncState('synced');
        },
        () => setSyncState('failed')
      );

      const unsubMeetings = subscribeMeetings(
        (data) => {
          if (data.length > 0) setMeetings(data);
          setSyncState('synced');
        },
        () => setSyncState('failed')
      );

      const unsubTasks = subscribeTasks(
        (data) => {
          if (data.length > 0) setTasks(data);
          setSyncState('synced');
        },
        () => setSyncState('failed')
      );

      const unsubNotes = subscribeNotes(
        (data) => {
          if (data.length > 0) setNotes(data);
          setSyncState('synced');
        },
        () => setSyncState('failed')
      );

      unsubs = [unsubClients, unsubMeetings, unsubTasks, unsubNotes];
    };

    initFirebaseSync();

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  // Counts for badges
  const { overdue } = categorizeTasks(tasks);
  const now = new Date();
  const upcomingMeetingsCount = meetings.filter((m) => {
    const diffMs = new Date(m.dateTime).getTime() - now.getTime();
    return diffMs >= -3600000 && diffMs <= 7 * 24 * 3600000;
  }).length;

  // Task Actions
  const handleToggleTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updated: ActionItem = {
      ...task,
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
    };

    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
    try {
      setSyncState('pending');
      await fbSaveTask(updated);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  const handleSaveTask = async (task: ActionItem) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = task;
        return updated;
      }
      return [task, ...prev];
    });

    try {
      setSyncState('pending');
      await fbSaveTask(task);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      setSyncState('pending');
      await fbDeleteTask(taskId);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  // Meeting Actions
  const handleSaveMeeting = async (meeting: Meeting) => {
    setMeetings((prev) => {
      const idx = prev.findIndex((m) => m.id === meeting.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = meeting;
        return updated;
      }
      return [meeting, ...prev];
    });

    try {
      setSyncState('pending');
      await fbSaveMeeting(meeting);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  // Client Actions
  const handleSaveClient = async (client: Client) => {
    setClients((prev) => {
      const idx = prev.findIndex((c) => c.id === client.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = client;
        return updated;
      }
      return [client, ...prev];
    });

    try {
      setSyncState('pending');
      await fbSaveClient(client);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    try {
      setSyncState('pending');
      await fbDeleteClient(clientId);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  // Note Actions
  const handleSaveNote = async (note: Note) => {
    setNotes((prev) => [note, ...prev]);
    try {
      setSyncState('pending');
      await fbSaveNote(note);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    try {
      setSyncState('pending');
      await fbDeleteNote(noteId);
      setSyncState('synced');
    } catch {
      setSyncState('failed');
    }
  };

  // Conflict Resolution Handlers
  const handleResolveConflict = async (
    conflict: ConflictItem,
    choice: ResolutionChoice,
    customMergedNotes?: string
  ) => {
    setSyncState('pending');

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

    if (remaining.length === 0) {
      setSyncState('synced');
    }
  };

  // Helper to trigger a realistic conflict simulation for demonstration
  const handleSimulateConflict = () => {
    const targetMeeting = meetings[0] || INITIAL_MEETINGS[0];
    const localCopy: Meeting = {
      ...targetMeeting,
      location: 'كافيه برو بريك — الرياض (تعديل محلي بدون إنترنت)',
      notes: `${targetMeeting.notes}\n\n### تعديلات تمت أثناء وضع الأوفلاين:\n- إضافة بند تسليم فوري في ملحق العقد.\n- اعتماد جدول تسليم أسبوعي جديد.`,
      status: 'confirmed',
    };
    const remoteCopy: Meeting = {
      ...targetMeeting,
      location: 'مقر شركة أفق — قاعة الاجتماعات الرئيسية (تم تحديثه عبر السحابة)',
      notes: `${targetMeeting.notes}\n\n### تعديلات تمت عبر السحابة من جهاز آخر:\n- تم تغيير المكان بطلب من العميل وتأكيد حضور المحامي.`,
      status: 'completed',
    };

    const detected = detectEntityConflict(localCopy, remoteCopy, 'meeting');
    if (detected) {
      setConflicts([detected]);
      setActiveConflict(detected);
      setSyncState('conflict');
    }
  };

  // Reset / Reseed data to Firestore
  const handleResetData = async () => {
    setClients(INITIAL_CLIENTS);
    setMeetings(INITIAL_MEETINGS);
    setTasks(INITIAL_TASKS);
    setNotes(INITIAL_NOTES);
    setConflicts([]);
    setActiveConflict(null);
    setIsSettingsOpen(false);

    try {
      setSyncState('pending');
      await seedInitialData(INITIAL_CLIENTS, INITIAL_MEETINGS, INITIAL_TASKS, INITIAL_NOTES);
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  };

  // Navigation helpers
  const handleOpenNewMeeting = (clientId?: string) => {
    setPreselectedClientIdForMeeting(clientId || null);
    setActiveTab('meetings');
  };

  const handleOpenNewTask = (clientId?: string) => {
    setPreselectedClientIdForTask(clientId || null);
    setActiveTab('tasks');
  };

  const handleSelectClientFromDashboard = (client: Client) => {
    setSelectedClientId(client.id);
    setActiveTab('clients');
  };

  const handleSelectMeetingFromDashboard = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setActiveTab('meetings');
  };

  // Direction and Language
  const isRtl = language === 'ar';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`min-h-screen bg-stone-100 text-stone-900 flex flex-col justify-center items-center ${
        isMobileFrame ? 'p-0 sm:py-6 sm:px-4' : 'p-0'
      }`}
    >
      {/* App Shell */}
      <div
        className={`w-full bg-stone-50 flex flex-col relative transition-all duration-200 overflow-hidden ${
          isMobileFrame
            ? 'max-w-[430px] min-h-screen sm:min-h-[860px] sm:max-h-[920px] sm:rounded-[40px] sm:shadow-2xl sm:border-[8px] sm:border-stone-800'
            : 'max-w-4xl min-h-screen shadow-lg'
        }`}
      >
        {/* Mobile Phone Simulated Status Bar (Visible on mobile frame mode) */}
        {isMobileFrame && (
          <div className="bg-stone-900 text-white px-6 pt-3 pb-2 text-[11px] font-medium flex items-center justify-between select-none">
            <span className="font-semibold tracking-tight">9:41</span>
            {/* Dynamic Island / Camera Notch Pill */}
            <div className="w-20 h-4 bg-black rounded-full hidden sm:block" />
            <div className="flex items-center gap-1.5 opacity-90">
              <Signal className="w-3 h-3" />
              <Wifi className="w-3 h-3" />
              <BatteryMedium className="w-3.5 h-3.5" />
            </div>
          </div>
        )}

        {/* Global Header */}
        <Header
          syncState={syncState}
          onSyncStateChange={(st) => {
            if (st === 'conflict') {
              handleSimulateConflict();
            } else {
              setSyncState(st);
            }
          }}
          onOpenSearch={() => setIsSearchOpen(true)}
          onTriggerLock={() => setIsBiometricLocked(true)}
          isMobileFrame={isMobileFrame}
          onToggleFrame={() => setIsMobileFrame(!isMobileFrame)}
          language={language}
          onToggleLanguage={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          conflictCount={conflicts.length}
          onOpenConflictModal={() => {
            if (conflicts.length > 0) {
              setActiveConflict(conflicts[0]);
            } else {
              handleSimulateConflict();
            }
          }}
        />

        {/* Scrollable Main View Container */}
        <main className="flex-1 overflow-y-auto px-4 py-4">
          {activeTab === 'dashboard' && (
            <DashboardView
              clients={clients}
              meetings={meetings}
              tasks={tasks}
              notes={notes}
              onSelectMeeting={handleSelectMeetingFromDashboard}
              onSelectClient={handleSelectClientFromDashboard}
              onToggleTask={handleToggleTask}
              onNewMeeting={handleOpenNewMeeting}
              onNewTask={() => handleOpenNewTask()}
              onNewClient={() => {
                setSelectedClientId(null);
                setActiveTab('clients');
              }}
              onGoToTab={setActiveTab}
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
              onSelectMeeting={handleSelectMeetingFromDashboard}
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
              onOpenPdfModal={(m) => setPdfMeeting(m)}
              onNewTaskFromMeeting={(m) => handleOpenNewTask(m.clientId)}
              selectedMeetingId={selectedMeetingId}
              onSelectMeetingChange={(m) => setSelectedMeetingId(m ? m.id : null)}
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

        {/* Bottom Navigation */}
        <BottomNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          overdueTasksCount={overdue.length}
          upcomingMeetingsCount={upcomingMeetingsCount}
          language={language}
        />
      </div>

      {/* Official Meeting Minutes Printable PDF Modal */}
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

      {/* Biometric Security Lock Screen */}
      <BiometricLockModal
        isOpen={isBiometricLocked}
        onUnlock={() => setIsBiometricLocked(false)}
        expectedPin={pinCode}
        language={language}
      />

      {/* Universal Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        data={{ clients, meetings, tasks, notes }}
        onSelectClient={(client) => {
          setSelectedClientId(client.id);
          setActiveTab('clients');
        }}
        onSelectMeeting={(meeting) => {
          setSelectedMeetingId(meeting.id);
          setActiveTab('meetings');
        }}
        onSelectTask={() => {
          setActiveTab('tasks');
        }}
        language={language}
      />

      {/* Conflict Resolution Modal */}
      <ConflictResolutionModal
        conflict={activeConflict}
        onResolve={handleResolveConflict}
        onClose={() => setActiveConflict(null)}
        language={language}
      />

      {/* Settings & Design Assumptions Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        appState={{
          clients,
          meetings,
          tasks,
          notes,
          syncState,
          conflicts,
          isBiometricLocked,
          isBiometricEnabled,
          pinCode,
          showHijri,
          language,
        }}
        onUpdateState={(updates) => {
          if (updates.syncState !== undefined) setSyncState(updates.syncState);
          if (updates.showHijri !== undefined) setShowHijri(updates.showHijri);
          if (updates.isBiometricEnabled !== undefined) setIsBiometricEnabled(updates.isBiometricEnabled);
          if (updates.pinCode !== undefined) setPinCode(updates.pinCode);
          if (updates.language !== undefined) setLanguage(updates.language);
        }}
        onResetData={handleResetData}
        language={language}
      />
    </div>
  );
}
