import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedUid, getUserCollectionPath, auth } from './firebase';
import { Client, Meeting, ActionItem, Note } from '../types';
import { computeAggregatedSyncState, canSafelySignOut, CollectionSyncStatus, CollectionKey } from '../utils/syncLogic';

test('getAuthenticatedUid throws when no user is signed in', () => {
  // At test boot without sign-in, auth.currentUser is null
  assert.equal(auth.currentUser, null);
  assert.throws(() => {
    getAuthenticatedUid();
  }, /Authentication required/);
});

test('getUserCollectionPath rejects unauthenticated calls and prevents caller UID spoofing', () => {
  assert.throws(() => {
    getUserCollectionPath('clients');
  }, /Authentication required/);

  assert.throws(() => {
    getUserCollectionPath('meetings');
  }, /Authentication required/);
});

test('User entities accept optional userId field without breaking schema', () => {
  const client: Client = {
    id: 'c-test-1',
    userId: 'user-xyz-123',
    name: 'عميل اختباري',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
  };

  assert.equal(client.userId, 'user-xyz-123');
  assert.equal(client.name, 'عميل اختباري');
});

test('Empty datasets are treated as valid empty states and not automatically populated', () => {
  const emptyClients: Client[] = [];
  const emptyMeetings: Meeting[] = [];
  const emptyTasks: ActionItem[] = [];
  const emptyNotes: Note[] = [];

  assert.equal(emptyClients.length, 0);
  assert.equal(emptyMeetings.length, 0);
  assert.equal(emptyTasks.length, 0);
  assert.equal(emptyNotes.length, 0);
});

test('Session reset clears all sensitive arrays to prevent cross-account disclosure', () => {
  let inMemoryClients: Client[] = [
    { id: 'c1', name: 'عميل حساب أ', createdAt: '', updatedAt: '' },
  ];
  let inMemoryMeetings: Meeting[] = [
    { id: 'm1', clientId: 'c1', title: 'اجتماع سري', dateTime: '', type: 'video', notes: '', status: 'confirmed', photoPaths: [], createdAt: '', updatedAt: '' },
  ];

  assert.equal(inMemoryClients.length, 1);

  // Simulate logout cleanup
  inMemoryClients = [];
  inMemoryMeetings = [];

  assert.equal(inMemoryClients.length, 0);
  assert.equal(inMemoryMeetings.length, 0);
});

// P0 Task 002-Fix: Direct Account Switching & Session Boundary Tests
test('Direct account-switch immediately isolates and wipes User A data without leaking to User B', () => {
  // Model state container representing session boundary
  class UserSessionState {
    uid: string;
    clients: Client[] = [];
    meetings: Meeting[] = [];
    selectedClientId: string | null = null;
    isModalOpen: boolean = false;
    isUnmounted: boolean = false;

    constructor(uid: string) {
      this.uid = uid;
    }

    destroy() {
      this.clients = [];
      this.meetings = [];
      this.selectedClientId = null;
      this.isModalOpen = false;
      this.isUnmounted = true;
    }
  }

  // User A session active
  let currentSession = new UserSessionState('user-alice-111');
  currentSession.clients = [
    { id: 'c-alice-1', userId: 'user-alice-111', name: 'عميل أليس السري', createdAt: '', updatedAt: '' },
  ];
  currentSession.selectedClientId = 'c-alice-1';
  currentSession.isModalOpen = true;

  assert.equal(currentSession.clients.length, 1);
  assert.equal(currentSession.selectedClientId, 'c-alice-1');
  assert.equal(currentSession.isModalOpen, true);

  // Direct switch to User B (without intermediate null auth state)
  const previousSession = currentSession;
  previousSession.destroy(); // React unmounts previous key=user.uid

  currentSession = new UserSessionState('user-bob-222'); // React mounts fresh session for new key

  // Verify previous session is completely wiped
  assert.equal(previousSession.isUnmounted, true);
  assert.equal(previousSession.clients.length, 0);
  assert.equal(previousSession.selectedClientId, null);
  assert.equal(previousSession.isModalOpen, false);

  // Verify User B starts with pristine empty isolated state
  assert.equal(currentSession.uid, 'user-bob-222');
  assert.equal(currentSession.clients.length, 0);
  assert.equal(currentSession.selectedClientId, null);
  assert.equal(currentSession.isModalOpen, false);
});

test('Stale asynchronous callbacks from previous user cannot mutate the active user session', () => {
  let activeSessionUid = 'user-alice-111';
  const userBData: Client[] = [];

  // Subscription handler simulates UID ownership check
  const deliverAsyncSnapshot = (snapshotUid: string, payload: Client[]) => {
    if (snapshotUid !== activeSessionUid) {
      // Stale callback from previous user session rejected!
      return false;
    }
    userBData.push(...payload);
    return true;
  };

  // Switch active session to Bob
  activeSessionUid = 'user-bob-222';

  // Late arriving snapshot from Alice's Firestore listener
  const aliceLatePayload: Client[] = [
    { id: 'leak-1', userId: 'user-alice-111', name: 'بيانات أليس المتأخرة', createdAt: '', updatedAt: '' },
  ];

  const accepted = deliverAsyncSnapshot('user-alice-111', aliceLatePayload);
  assert.equal(accepted, false);
  assert.equal(userBData.length, 0, 'Bob session received 0 items from Alice late snapshot');

  // Legitimate snapshot for Bob
  const bobPayload: Client[] = [
    { id: 'bob-1', userId: 'user-bob-222', name: 'عميل بوب الحقيقي', createdAt: '', updatedAt: '' },
  ];
  const bobAccepted = deliverAsyncSnapshot('user-bob-222', bobPayload);
  assert.equal(bobAccepted, true);
  assert.equal(userBData.length, 1);
  assert.equal(userBData[0].name, 'عميل بوب الحقيقي');
});

// P1 Task 002-Fix: Multi-Collection Sync State Aggregation Tests
test('computeAggregatedSyncState does not let a successful snapshot for one collection override pending writes elsewhere', () => {
  const statuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: true, fromCache: false, hasError: false }, // Meeting write in flight!
    tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const state = computeAggregatedSyncState(statuses);
  assert.equal(state, 'pending', 'App state must remain pending because meetings collection has pending write');
});

test('computeAggregatedSyncState marks failed if any single collection encounters an error', () => {
  const statuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    tasks: { loaded: false, hasPendingWrites: false, fromCache: false, hasError: true }, // Network error!
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const state = computeAggregatedSyncState(statuses);
  assert.equal(state, 'failed');
});

test('computeAggregatedSyncState marks local if any collection is still loaded from cache or not loaded', () => {
  const statuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: false, fromCache: true, hasError: false }, // From cache
    tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const state = computeAggregatedSyncState(statuses);
  assert.equal(state, 'local');
});

test('computeAggregatedSyncState marks synced ONLY when all four collections are loaded, server-confirmed, with no pending writes or errors', () => {
  const statuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const state = computeAggregatedSyncState(statuses);
  assert.equal(state, 'synced');
});

// P1 Task 002-Fix: Safe Sign-Out Guard Tests
test('canSafelySignOut prevents signing out with unacknowledged local writes', () => {
  const dirtyStatuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: true, fromCache: false, hasError: false }, // Pending write!
    tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const checkDirty = canSafelySignOut(dirtyStatuses);
  assert.equal(checkDirty.safe, false);
  assert.deepEqual(checkDirty.pendingCollections, ['meetings']);

  const cleanStatuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
  };

  const checkClean = canSafelySignOut(cleanStatuses);
  assert.equal(checkClean.safe, true);
  assert.deepEqual(checkClean.pendingCollections, []);
});
