import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAggregatedSyncState, canSafelySignOut, CollectionSyncStatus } from '../src/utils/syncLogic';
import { detectEntityConflict, resolveConflictRecord } from '../src/utils/conflictLogic';
import { isPersistentStorageEnabled, setPersistentStorageEnabled } from '../src/services/firebase';

test('Murafiq Task 003: Offline-First & Reliable Synchronization Tests', async (t) => {
  
  await t.test('1. Shared-device caching restrictions: Memory cache is default', () => {
    // Reset persistence
    setPersistentStorageEnabled(false);
    assert.equal(isPersistentStorageEnabled(), false, 'Persistence must be disabled by default for shared/untrusted devices');
  });

  await t.test('2. Persistent storage opt-in on trusted personal devices', () => {
    setPersistentStorageEnabled(true);
    assert.equal(isPersistentStorageEnabled(), true, 'Persistence should be enabled when explicitly opted-in');
    setPersistentStorageEnabled(false); // Cleanup
  });

  await t.test('3. Account sign-out safety check with pending writes (canSafelySignOut)', () => {
    const statusesClean: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };

    const resultClean = canSafelySignOut(statusesClean);
    assert.equal(resultClean.safe, true);
    assert.equal(resultClean.pendingCollections.length, 0);

    const statusesPending: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: true, fromCache: true, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };

    const resultPending = canSafelySignOut(statusesPending);
    assert.equal(resultPending.safe, false);
    assert.deepEqual(resultPending.pendingCollections, ['clients']);
  });

  await t.test('4. Synchronization state aggregation (computeAggregatedSyncState)', () => {
    const syncedStatuses: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(syncedStatuses, false), 'synced');

    const pendingStatuses: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: true, fromCache: true, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(pendingStatuses, false), 'pending');

    const failedStatuses: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: true },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(failedStatuses, false), 'failed');

    const conflictStatuses: Record<string, CollectionSyncStatus> = {
      clients: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      meetings: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      tasks: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
      notes: { loaded: true, hasPendingWrites: false, fromCache: false, hasError: false },
    };
    assert.equal(computeAggregatedSyncState(conflictStatuses, true), 'conflict');
  });

  await t.test('5. Conflict detection and resolution policy', () => {
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

    const conflict = detectEntityConflict(local, remote, 'client');
    assert.notEqual(conflict, null);
    assert.equal(conflict?.differingFields.length, 2);

    // Test keep_local resolution
    const resolvedLocal = resolveConflictRecord(conflict!, 'keep_local');
    assert.equal(resolvedLocal.name, local.name);

    // Test keep_remote resolution
    const resolvedRemote = resolveConflictRecord(conflict!, 'keep_remote');
    assert.equal(resolvedRemote.name, remote.name);
  });
});
