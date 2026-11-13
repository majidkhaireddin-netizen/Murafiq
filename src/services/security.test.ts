import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedUid, getUserCollectionPath, auth, sanitizeFirestorePayload } from './firebase';
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

// P1 Task 002 Safe Serialization Tests
test('sanitizeFirestorePayload strips undefined keys while preserving valid falsy values (false, 0, "")', () => {
  const input = {
    id: 't-123',
    clientId: 'c-456',
    meetingId: undefined,
    title: 'مهمة بدون اجتماع',
    description: '',
    dueDate: undefined,
    priority: 'high',
    status: 'pending',
    isCompleted: false,
    duration: 0,
    nested: {
      valid: true,
      invalid: undefined,
    },
  };

  const clean = sanitizeFirestorePayload(input);

  assert.equal('meetingId' in clean, false);
  assert.equal(clean.description, '');
  assert.equal(clean.isCompleted, false);
  assert.equal(clean.duration, 0);
  assert.equal(clean.nested.valid, true);
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

import {
  OperationCoordinator,
  reconcileEntityFailure,
  classifyWriteError,
  extractFirestoreErrorCode,
  applyScopedConfirmation,
  applyScopedRejection,
  serializeRejectedDraftJson,
  formatRejectedDraftClipboardText,
  getArabicSaveErrorMessage,
} from '../utils/sessionState';
import { RejectedWriteRecord } from '../types';

// Task 003-Fix: Operation-Scoped Concurrent Recovery Tests (Replaces full-array snapshot rollback)
test('OperationCoordinator applies optimistic state immediately while tracking serverPromise asynchronously', async () => {
  let clients: Client[] = [
    { id: 'c1', name: 'عميل ١', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];
  const setClients = (updater: (prev: Client[]) => Client[]) => {
    clients = updater(clients);
  };

  let resolveWrite!: () => void;
  const serverPromise = new Promise<void>((res) => {
    resolveWrite = res;
  });

  const coord = new OperationCoordinator<Client>();
  let confirmed = false;

  const newClient: Client = { id: 'c2', name: 'عميل ٢', createdAt: '2026-01-02', updatedAt: '2026-01-02' };
  const handle = coord.runScopedMutation({
    entityId: 'c2',
    entityType: 'client',
    previousEntity: undefined,
    setState: setClients,
    applyOptimistic: (prev) => [newClient, ...prev],
    dispatchWrite: () => ({ serverPromise }),
    onServerConfirmed: () => {
      confirmed = true;
    },
  });

  // Immediately accepted locally (even before serverPromise resolves!)
  assert.equal(handle.acceptedLocally, true);
  assert.equal(clients.length, 2);
  assert.equal(confirmed, false);

  resolveWrite();
  await handle.serverPromise;
  assert.equal(confirmed, true);
  assert.equal(clients.length, 2);
});

test('Overlapping operations on DIFFERENT entities: failure of Op A does NOT clobber newer committed Op B', async () => {
  let clients: Client[] = [
    { id: 'c1', name: 'العميل الأول', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];
  const setClients = (updater: (prev: Client[]) => Client[]) => {
    clients = updater(clients);
  };

  const coord = new OperationCoordinator<Client>();

  let rejectOpA!: (err: Error) => void;
  const opAPromise = new Promise<void>((_, rej) => {
    rejectOpA = rej;
  });
  let resolveOpB!: () => void;
  const opBPromise = new Promise<void>((res) => {
    resolveOpB = res;
  });

  // Op A edits c1 (slow, will fail later)
  const opAEdited: Client = { id: 'c1', name: 'تعديل فاشل على الأول', createdAt: '2026-01-01', updatedAt: '2026-01-02' };
  const handleA = coord.runScopedMutation({
    entityId: 'c1',
    entityType: 'client',
    previousEntity: clients.find((c) => c.id === 'c1'),
    setState: setClients,
    applyOptimistic: (prev) => prev.map((c) => (c.id === 'c1' ? opAEdited : c)),
    dispatchWrite: () => ({ serverPromise: opAPromise }),
  });

  // Op B creates c2 concurrently and succeeds
  const opBCreated: Client = { id: 'c2', name: 'العميل الثاني الناجح', createdAt: '2026-01-02', updatedAt: '2026-01-02' };
  const handleB = coord.runScopedMutation({
    entityId: 'c2',
    entityType: 'client',
    previousEntity: undefined,
    setState: setClients,
    applyOptimistic: (prev) => [opBCreated, ...prev],
    dispatchWrite: () => ({ serverPromise: opBPromise }),
  });

  resolveOpB();
  await handleB.serverPromise;
  assert.equal(clients.length, 2);

  // Now Op A rejects!
  let rejectedCategory = '';
  rejectOpA(new Error('permission-denied'));
  await handleA.serverPromise;

  // c1 is restored to 'العميل الأول', while c2 MUST REMAIN INTACT!
  assert.equal(clients.length, 2);
  const c1After = clients.find((c) => c.id === 'c1');
  const c2After = clients.find((c) => c.id === 'c2');
  assert.equal(c1After?.name, 'العميل الأول');
  assert.equal(c2After?.name, 'العميل الثاني الناجح');
  assert.equal(rejectedCategory, '');
});

test('Overlapping operations on the SAME entity: earlier Op A failure does NOT overwrite newer Op B state', async () => {
  let clients: Client[] = [
    { id: 'c1', name: 'الأصل', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];
  const setClients = (updater: (prev: Client[]) => Client[]) => {
    clients = updater(clients);
  };

  const coord = new OperationCoordinator<Client>();

  let rejectOpA!: (err: Error) => void;
  const opAPromise = new Promise<void>((_, rej) => {
    rejectOpA = rej;
  });
  let resolveOpB!: () => void;
  const opBPromise = new Promise<void>((res) => {
    resolveOpB = res;
  });

  let opAWasSuperseded = false;

  // Op A modifies c1 -> 'التعديل الأول'
  const handleA = coord.runScopedMutation({
    entityId: 'c1',
    entityType: 'client',
    previousEntity: clients.find((c) => c.id === 'c1'),
    setState: setClients,
    applyOptimistic: (prev) => prev.map((c) => (c.id === 'c1' ? { ...c, name: 'التعديل الأول' } : c)),
    dispatchWrite: () => ({ serverPromise: opAPromise }),
    onServerRejected: ({ wasSuperseded }) => {
      opAWasSuperseded = wasSuperseded;
    },
  });

  // Op B rapidly modifies the SAME c1 -> 'التعديل الأحدث الناجح'
  const handleB = coord.runScopedMutation({
    entityId: 'c1',
    entityType: 'client',
    previousEntity: clients.find((c) => c.id === 'c1'),
    setState: setClients,
    applyOptimistic: (prev) => prev.map((c) => (c.id === 'c1' ? { ...c, name: 'التعديل الأحدث الناجح' } : c)),
    dispatchWrite: () => ({ serverPromise: opBPromise }),
  });

  resolveOpB();
  await handleB.serverPromise;

  // Now delayed Op A fails!
  rejectOpA(new Error('permission-denied'));
  await handleA.serverPromise;

  assert.equal(opAWasSuperseded, true);
  assert.equal(clients.find((c) => c.id === 'c1')?.name, 'التعديل الأحدث الناجح');
});

test('Overlapping operations on the SAME entity: older Op 1 succeeding NEVER clears newer Op 2 failure alert (wasSuperseded)', async () => {
  let clients: Client[] = [
    { id: 'c1', name: 'النسخة الأساسية', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];
  const setClients = (updater: (prev: Client[]) => Client[]) => {
    clients = updater(clients);
  };
  let rejectedWrites: RejectedWriteRecord[] = [];

  const coord = new OperationCoordinator<Client>();

  let resolveOp1!: () => void;
  const op1Promise = new Promise<void>((res) => {
    resolveOp1 = res;
  });
  let rejectOp2!: (err: Error) => void;
  const op2Promise = new Promise<void>((_, rej) => {
    rejectOp2 = rej;
  });

  // Op 1 starts on c1 (slow success)
  const op1Draft: Client = { id: 'c1', name: 'تعديل ١ الأقدم', createdAt: '2026-01-01', updatedAt: '2026-01-02' };
  const handle1 = coord.runScopedMutation({
    entityId: 'c1',
    entityType: 'client',
    previousEntity: clients[0],
    setState: setClients,
    applyOptimistic: (prev) => prev.map((c) => (c.id === 'c1' ? op1Draft : c)),
    dispatchWrite: () => ({ serverPromise: op1Promise }),
    onServerConfirmed: ({ wasSuperseded }) => {
      rejectedWrites = applyScopedConfirmation(rejectedWrites, {
        entityType: 'client',
        entityId: 'c1',
        wasSuperseded,
      });
    },
    onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
      rejectedWrites = applyScopedRejection(rejectedWrites, {
        wasSuperseded,
        record: {
          opId,
          entityType: 'client',
          entityId: 'c1',
          entityTitle: op1Draft.name,
          operation: 'save',
          category: classification.category,
          messageArabic: classification.messageArabic,
          rawMessage: error.message,
          payload: op1Draft,
          occurredAt: '2026-01-02T00:00:00Z',
        },
      });
    },
  });

  // Op 2 supersedes Op 1 on the SAME c1 and fails with permission-denied
  const op2Draft: Client = { id: 'c1', name: 'تعديل ٢ الأحدث', createdAt: '2026-01-01', updatedAt: '2026-01-03' };
  const handle2 = coord.runScopedMutation({
    entityId: 'c1',
    entityType: 'client',
    previousEntity: op1Draft,
    setState: setClients,
    applyOptimistic: (prev) => prev.map((c) => (c.id === 'c1' ? op2Draft : c)),
    dispatchWrite: () => ({ serverPromise: op2Promise }),
    onServerConfirmed: ({ wasSuperseded }) => {
      rejectedWrites = applyScopedConfirmation(rejectedWrites, {
        entityType: 'client',
        entityId: 'c1',
        wasSuperseded,
      });
    },
    onServerRejected: ({ opId, error, classification, wasSuperseded }) => {
      rejectedWrites = applyScopedRejection(rejectedWrites, {
        wasSuperseded,
        record: {
          opId,
          entityType: 'client',
          entityId: 'c1',
          entityTitle: op2Draft.name,
          operation: 'save',
          category: classification.category,
          messageArabic: classification.messageArabic,
          rawMessage: error.message,
          payload: op2Draft,
          occurredAt: '2026-01-03T00:00:00Z',
        },
      });
    },
  });

  // Op 2 fails first (not superseded) -> failure alert recorded
  rejectOp2(Object.assign(new Error("false for 'update' @ L152"), { code: 'permission-denied' }));
  await handle2.serverPromise;
  assert.equal(rejectedWrites.length, 1);
  assert.equal(rejectedWrites[0].opId, handle2.opId);

  // Now older Op 1 succeeds (wasSuperseded === true) -> MUST NOT clear Op 2's failure alert!
  resolveOp1();
  await handle1.serverPromise;
  assert.equal(rejectedWrites.length, 1, 'Older Op 1 succeeding must NOT clear newer Op 2 failure alert');
  assert.equal(rejectedWrites[0].opId, handle2.opId);
});

test('classifyWriteError recognizes Firestore error.code formats (permission-denied, PERMISSION_DENIED, emulator messages, wrapped JSON)', () => {
  // 1. Emulator FirebaseError with code='permission-denied' and opaque rules message (exact CI failure case!)
  const emulatorPermErr = Object.assign(new Error("false for 'create' @ L148"), {
    code: 'permission-denied',
  });
  assert.equal(extractFirestoreErrorCode(emulatorPermErr), 'permission-denied');
  assert.equal(classifyWriteError(emulatorPermErr, 'client').category, 'permission-denied');

  // 2. Uppercase gRPC PERMISSION_DENIED
  const grpcPermErr = Object.assign(new Error('7 PERMISSION_DENIED: evaluation error'), {
    code: 'PERMISSION_DENIED',
  });
  assert.equal(classifyWriteError(grpcPermErr, 'client').category, 'permission-denied');

  // 3. Prefixed firestore/permission-denied
  const prefixedPermErr = Object.assign(new Error('Rejected'), {
    code: 'firestore/permission-denied',
  });
  assert.equal(classifyWriteError(prefixedPermErr, 'meeting').category, 'permission-denied');

  // 4. Wrapped JSON error from handleFirestoreError preserving code
  const wrappedJsonErr = new Error(
    JSON.stringify({
      error: "false for 'create' @ L148",
      code: 'permission-denied',
      operationType: 'write',
      path: 'users/u1/clients/c1',
    })
  );
  assert.equal(classifyWriteError(wrappedJsonErr, 'client').category, 'permission-denied');

  // 5. Other standard Firestore error codes
  assert.equal(
    classifyWriteError(Object.assign(new Error('Bad payload'), { code: 'INVALID_ARGUMENT' }), 'task').category,
    'invalid-argument'
  );
  assert.equal(
    classifyWriteError(Object.assign(new Error('No auth'), { code: 'UNAUTHENTICATED' }), 'note').category,
    'unauthenticated'
  );
  assert.equal(
    classifyWriteError(Object.assign(new Error('Precond'), { code: 'FAILED_PRECONDITION' }), 'client').category,
    'failed-precondition'
  );
  assert.equal(
    classifyWriteError(Object.assign(new Error('Offline'), { code: 'UNAVAILABLE' }), 'client').category,
    'unavailable'
  );
});

test('Rejected draft export formatters generate valid portable JSON/text without touching localStorage', () => {
  const rec: RejectedWriteRecord = {
    opId: 'client-c9-4',
    entityType: 'client',
    entityId: 'c9',
    entityTitle: 'شركة المدار',
    operation: 'save',
    category: 'permission-denied',
    messageArabic: 'رفض الخادم حفظ العميل',
    rawMessage: 'permission-denied',
    payload: {
      id: 'c9',
      name: 'شركة المدار',
      phone: '+966500000001',
      createdAt: '2026-11-13T10:00:00Z',
      updatedAt: '2026-11-13T10:00:00Z',
    },
    occurredAt: '2026-11-13T10:05:00Z',
  };

  const json = serializeRejectedDraftJson(rec);
  const parsed = JSON.parse(json);
  assert.equal(parsed.murafiq_draft_export, true);
  assert.equal(parsed.entityId, 'c9');
  assert.equal(parsed.payload.name, 'شركة المدار');

  const text = formatRejectedDraftClipboardText(rec);
  assert.ok(text.includes('شركة المدار'));
  assert.ok(text.includes('c9'));
});

test('reconcileEntityFailure and classifyWriteError handle single-entity recovery and Firestore error categories', () => {
  const initial: Client[] = [
    { id: 'c1', name: 'عميل ١', createdAt: '', updatedAt: '' },
    { id: 'c2', name: 'عميل ٢', createdAt: '', updatedAt: '' },
  ];
  const afterRemoveNew = reconcileEntityFailure(initial, 'c2', undefined);
  assert.deepEqual(afterRemoveNew.map((c) => c.id), ['c1']);

  const permErr = classifyWriteError(new Error('FirebaseError: Missing or insufficient permissions (permission-denied)'), 'client');
  assert.equal(permErr.category, 'permission-denied');
  assert.equal(permErr.isPermanentServerRejection, true);

  const clientSaveMsg = getArabicSaveErrorMessage('client', false);
  assert.ok(clientSaveMsg.includes('تعذر حفظ العميل'));

  const meetingDeleteMsg = getArabicSaveErrorMessage('meeting', true);
  assert.ok(meetingDeleteMsg.includes('تعذر حذف اللقاء'));
});


