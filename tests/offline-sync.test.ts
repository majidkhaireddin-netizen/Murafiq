import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAggregatedSyncState,
  computeDetailedSyncSummary,
  canSafelySignOut,
  countPendingOperations,
  CollectionSyncStatus,
} from '../src/utils/syncLogic';
import { detectEntityConflict, resolveConflictRecord } from '../src/utils/conflictLogic';
import {
  isPersistentStorageEnabled,
  setPersistentStorageEnabled,
  initFirestoreInstanceWithPolicy,
} from '../src/services/firebase';
import {
  deriveCacheRuntimeState,
  evaluatePersistenceOptOut,
  formatOptOutExecutionResult,
  describeAuthVsCachePolicy,
} from '../src/utils/offlineStoragePolicy';

test('Murafiq Task 003-Fix: Offline-First & Reliable Synchronization Policy Tests', async (t) => {
  await t.test('1. Shared-device caching restrictions: Memory cache is default', () => {
    setPersistentStorageEnabled(false);
    assert.equal(
      isPersistentStorageEnabled(),
      false,
      'Persistence must be disabled by default for shared/untrusted devices'
    );
  });

  await t.test('2. Persistent storage opt-in requires reload and never falsely claims active persistence from flag alone', () => {
    setPersistentStorageEnabled(true);
    assert.equal(isPersistentStorageEnabled(), true);

    const runtime = deriveCacheRuntimeState({
      activeMode: 'memory',
      requestedMode: 'persistent',
      initError: null,
    });

    assert.equal(runtime.activeMode, 'memory', 'Active cache stays memory until app reload');
    assert.equal(runtime.requestedMode, 'persistent');
    assert.equal(runtime.requiresReload, true, 'Reload requirement must be explicitly flagged');
    setPersistentStorageEnabled(false);
  });

  await t.test('3. Persistent initialization failure falls back visibly to memory without claiming persistence is active', () => {
    const fakeMemDb = { kind: 'memory' } as any;
    const err = Object.assign(new Error('Failed to obtain exclusive lock (failed-precondition)'), {
      code: 'failed-precondition',
    });

    const outcome = initFirestoreInstanceWithPolicy({
      preferPersistent: true,
      initPersistent: () => {
        throw err;
      },
      initMemory: () => fakeMemDb,
      getExisting: () => fakeMemDb,
    });

    assert.equal(outcome.activeMode, 'memory', 'Fallback activeMode must honestly be memory');
    assert.ok(outcome.initError !== null, 'Initialization error must be captured visibly');
    assert.equal(outcome.initError?.code, 'failed-precondition');

    const runtime = deriveCacheRuntimeState({
      activeMode: outcome.activeMode,
      requestedMode: 'persistent',
      initError: outcome.initError,
    });
    assert.equal(runtime.activeMode, 'memory');
    assert.ok(runtime.initError?.messageArabic.includes('التخزين الدائم'));
  });

  await t.test('4. Safe opt-out evaluates pending writes, multi-tab lock failures, and residual IndexedDB warnings', () => {
    const dirtyOptOut = evaluatePersistenceOptOut({ pendingCount: 3, activeMode: 'persistent' });
    assert.equal(dirtyOptOut.canProceedImmediately, false);
    assert.ok(dirtyOptOut.pendingWarningArabic?.includes('3'));
    assert.ok(dirtyOptOut.multiTabWarningArabic.includes('تبويب'));
    assert.ok(dirtyOptOut.residualDataNoteArabic.includes('غير مشفرة'));

    const lockedResult = formatOptOutExecutionResult({
      clearedIndexedDb: false,
      error: Object.assign(new Error('failed-precondition'), { code: 'failed-precondition' }),
    });
    assert.equal(lockedResult.clearedIndexedDb, false);
    assert.equal(lockedResult.requiresReload, true);
    assert.ok(lockedResult.messageArabic.includes('تبويب'));

    const successResult = formatOptOutExecutionResult({ clearedIndexedDb: true });
    assert.equal(successResult.clearedIndexedDb, true);
    assert.equal(successResult.requiresReload, true);

    const policyDesc = describeAuthVsCachePolicy();
    assert.ok(policyDesc.authPersistenceArabic.includes('Firebase Auth'));
    assert.ok(policyDesc.firestoreCacheArabic.includes('IndexedDB'));
  });

  await t.test('5. Account sign-out safety check with pending writes & memory vs persistent warning', () => {
    const statusesClean: Record<'clients' | 'meetings' | 'tasks' | 'notes', CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };

    const resultClean = canSafelySignOut(statusesClean);
    assert.equal(resultClean.safe, true);
    assert.equal(resultClean.pendingCollections.length, 0);

    const statusesPending: Record<'clients' | 'meetings' | 'tasks' | 'notes', CollectionSyncStatus> = {
      clients: {
        loaded: true,
        hasPendingWrites: true,
        fromCache: true,
        hasError: false,
        pendingDocIds: ['c1', 'c2'],
      },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false, pendingDeletesCount: 1 },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };

    const resultPendingMem = canSafelySignOut(statusesPending, { cacheMode: 'memory' });
    assert.equal(resultPendingMem.safe, false);
    assert.equal(resultPendingMem.pendingCount, 3);
    assert.deepEqual(resultPendingMem.pendingCollections, ['clients', 'tasks']);
    assert.ok(resultPendingMem.warningArabic.includes('الذاكرة المؤقتة'));
  });

  await t.test('6. Synchronization state aggregation never marks pending or offline cache as synced', () => {
    const syncedStatuses: Record<'clients' | 'meetings' | 'tasks' | 'notes', CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(syncedStatuses, false), 'synced');

    // Offline even with loaded snapshots cannot claim 'synced'
    assert.equal(
      computeAggregatedSyncState(syncedStatuses, false, { isOnline: false }),
      'local'
    );

    const pendingStatuses: Record<'clients' | 'meetings' | 'tasks' | 'notes', CollectionSyncStatus> = {
      clients: {
        loaded: true,
        hasPendingWrites: true,
        fromCache: true,
        hasError: false,
        pendingDocIds: ['c-off-1'],
      },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(pendingStatuses, false, { isOnline: false }), 'pending');
    assert.equal(countPendingOperations(pendingStatuses), 1);

    const summary = computeDetailedSyncSummary({
      statuses: pendingStatuses,
      hasActiveConflict: false,
      isOnline: false,
      rejectedWritesCount: 0,
    });
    assert.equal(summary.syncState, 'pending');
    assert.equal(summary.pendingOperationsCount, 1);
    assert.ok(summary.labelArabic.includes('غير متصل'));

    // Rejected write drives state to failed
    const failedSummary = computeDetailedSyncSummary({
      statuses: syncedStatuses,
      hasActiveConflict: false,
      isOnline: true,
      rejectedWritesCount: 1,
    });
    assert.equal(failedSummary.syncState, 'failed');
  });

  await t.test('7. Conflict detection marks simulated conflicts transparently and supports manual resolution', () => {
    const local = {
      id: 'client_1',
      userId: 'user_a',
      name: 'شركة الأفق (تعديل محلي)',
      phone: '+966500000000',
    };
    const remote = {
      id: 'client_1',
      userId: 'user_a',
      name: 'شركة الأفق (تعديل سحابي متزامن)',
      phone: '+966511111111',
    };

    const simConflict = detectEntityConflict(local, remote, 'client', {
      isSimulated: true,
      detectionSource: 'simulated_dev',
    });
    assert.notEqual(simConflict, null);
    assert.equal(simConflict?.isSimulated, true);
    assert.equal(simConflict?.detectionSource, 'simulated_dev');
    assert.equal(simConflict?.differingFields.length, 2);

    const resolvedLocal = resolveConflictRecord(simConflict!, 'keep_local');
    assert.equal(resolvedLocal.name, local.name);

    const resolvedRemote = resolveConflictRecord(simConflict!, 'keep_remote');
    assert.equal(resolvedRemote.name, remote.name);
  });
});
