import { SyncState } from '../types';

export interface CollectionSyncStatus {
  loaded: boolean;
  hasPendingWrites: boolean;
  fromCache: boolean;
  hasError: boolean;
}

export type CollectionKey = 'clients' | 'meetings' | 'tasks' | 'notes';

/**
 * Aggregates synchronization metadata across all 4 monitored collections.
 * 
 * Rules:
 * 1. If any collection has an error, status is 'failed'.
 * 2. If any collection has pending local writes waiting to sync, status is 'pending'.
 * 3. If any collection is still loaded only from local cache (or not yet loaded), status is 'local'.
 * 4. Only when ALL collections are loaded, server-confirmed, with no pending writes and no errors, status is 'synced'.
 */
export function computeAggregatedSyncState(
  statuses: Record<CollectionKey, CollectionSyncStatus>,
  hasActiveConflict: boolean = false
): SyncState {
  if (hasActiveConflict) {
    return 'conflict';
  }

  const values = Object.values(statuses);
  if (values.length === 0) {
    return 'local';
  }

  // Any collection encountered a sync error
  if (values.some((v) => v.hasError)) {
    return 'failed';
  }

  // Any collection has uncommitted local writes pending upload
  if (values.some((v) => v.hasPendingWrites)) {
    return 'pending';
  }

  // Any collection is still serving from cache or hasn't had server confirmation
  if (values.some((v) => !v.loaded || v.fromCache)) {
    return 'local';
  }

  // All 4 collections are loaded from server, confirmed with 0 pending writes and 0 errors
  return 'synced';
}

/**
 * Validates if the user can sign out without risking unacknowledged local data loss.
 */
export function canSafelySignOut(
  statuses: Record<CollectionKey, CollectionSyncStatus>
): { safe: boolean; pendingCollections: string[] } {
  const pending: string[] = [];
  (Object.keys(statuses) as CollectionKey[]).forEach((key) => {
    if (statuses[key].hasPendingWrites) {
      pending.push(key);
    }
  });

  return {
    safe: pending.length === 0,
    pendingCollections: pending,
  };
}
