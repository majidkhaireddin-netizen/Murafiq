import type { CacheMode, SyncState } from '../types/index.ts';

export interface CollectionSyncStatus {
  loaded: boolean;
  hasPendingWrites: boolean;
  fromCache: boolean;
  hasError: boolean;
  pendingDocIds?: string[];
  pendingDeletesCount?: number;
}

export type CollectionKey =
  | 'clients'
  | 'meetings'
  | 'tasks'
  | 'notes'
  | 'reminders'
  | 'preferences'
  | 'opportunities'
  | 'opportunityStageEvents';

export interface DetailedSyncSummary {
  syncState: SyncState;
  isOnline: boolean;
  pendingOperationsCount: number;
  pendingCollections: CollectionKey[];
  rejectedWritesCount: number;
  hasErrors: boolean;
  labelArabic: string;
  labelEnglish: string;
  descriptionArabic: string;
  descriptionEnglish: string;
}

/**
 * Counts actual pending operations across all monitored collections using Firestore document metadata
 * plus in-flight local deletes (since deleted documents leave snapshot.docs immediately).
 */
export function countPendingOperations(
  statuses: Partial<Record<CollectionKey, CollectionSyncStatus>>
): number {
  let total = 0;
  (Object.keys(statuses) as CollectionKey[]).forEach((key) => {
    const s = statuses[key];
    if (!s) return;
    const docPending = s.pendingDocIds ? new Set(s.pendingDocIds).size : 0;
    const delPending = s.pendingDeletesCount ?? 0;
    const combined = docPending + delPending;
    if (combined > 0) {
      total += combined;
    } else if (s.hasPendingWrites) {
      total += 1;
    }
  });
  return total;
}

/**
 * Aggregates synchronization metadata across all 4 monitored collections.
 *
 * Rules:
 * 1. If any conflict exists, status is 'conflict'.
 * 2. If any collection has an error or rejected write, status is 'failed'.
 * 3. If any collection has pending local writes waiting to sync, status is 'pending' (NEVER 'synced').
 * 4. If any collection is still loaded only from local cache (or not yet loaded) or browser is offline, status is 'local'.
 * 5. Only when ALL collections are loaded, server-confirmed, online, with no pending writes and no errors, status is 'synced'.
 */
export function computeAggregatedSyncState(
  statuses: Partial<Record<CollectionKey, CollectionSyncStatus>>,
  hasActiveConflict: boolean = false,
  options?: { isOnline?: boolean; rejectedWritesCount?: number }
): SyncState {
  if (hasActiveConflict) {
    return 'conflict';
  }

  const values = Object.values(statuses).filter((v): v is CollectionSyncStatus => Boolean(v));
  if (values.length === 0) {
    return 'local';
  }

  // Permanent or active write/subscription error
  if (values.some((v) => v.hasError) || (options?.rejectedWritesCount ?? 0) > 0) {
    return 'failed';
  }

  // Uncommitted local writes pending upload (must NEVER appear as synced)
  if (values.some((v) => v.hasPendingWrites || (v.pendingDeletesCount ?? 0) > 0)) {
    return 'pending';
  }

  // Browser offline or any collection is serving from cache / not yet confirmed by server
  if (options?.isOnline === false || values.some((v) => !v.loaded || v.fromCache)) {
    return 'local';
  }

  // All monitored collections are loaded from server, confirmed with 0 pending writes and 0 errors
  return 'synced';
}

/**
 * Produces full user-facing Arabic & English sync descriptions grounded in real Firestore metadata & network state.
 */
export function computeDetailedSyncSummary(params: {
  statuses: Partial<Record<CollectionKey, CollectionSyncStatus>>;
  hasActiveConflict: boolean;
  conflictCount?: number;
  isOnline: boolean;
  rejectedWritesCount?: number;
}): DetailedSyncSummary {
  const {
    statuses,
    hasActiveConflict,
    conflictCount = 0,
    isOnline,
    rejectedWritesCount = 0,
  } = params;

  const pendingOperationsCount = countPendingOperations(statuses);
  const pendingCollections = (Object.keys(statuses) as CollectionKey[]).filter((k) => {
    const s = statuses[k];
    return Boolean(s && (s.hasPendingWrites || (s.pendingDeletesCount ?? 0) > 0));
  });
  const hasErrors =
    Object.values(statuses).some((s) => Boolean(s?.hasError)) || rejectedWritesCount > 0;

  const syncState = computeAggregatedSyncState(statuses, hasActiveConflict, {
    isOnline,
    rejectedWritesCount,
  });

  if (syncState === 'conflict') {
    const countLabel = conflictCount > 0 ? conflictCount : 1;
    return {
      syncState,
      isOnline,
      pendingOperationsCount,
      pendingCollections,
      rejectedWritesCount,
      hasErrors,
      labelArabic: `تعارض يتطلب إجراءً (${countLabel})`,
      labelEnglish: `Conflict (${countLabel})`,
      descriptionArabic:
        'يوجد تعارض بيانات معروض للمراجعة اليدوية. اختر النسخة المعتمدة لإتمام الحفظ.',
      descriptionEnglish:
        'A data conflict requires your manual decision before saving.',
    };
  }

  if (syncState === 'failed') {
    return {
      syncState,
      isOnline,
      pendingOperationsCount,
      pendingCollections,
      rejectedWritesCount,
      hasErrors,
      labelArabic: rejectedWritesCount > 0 ? `خطأ مزامنة (${rejectedWritesCount})` : 'خطأ في المزامنة',
      labelEnglish: rejectedWritesCount > 0 ? `Sync Error (${rejectedWritesCount})` : 'Sync Failed',
      descriptionArabic:
        rejectedWritesCount > 0
          ? 'رفض الخادم تعديلاً أو أكثر بعد إعادة الاتصال (مثل قيود الصلاحيات). المسودات محفوظة في تنبيه الخطأ للمراجعة دون فقدان عملك.'
          : 'تعذر إتمام الاتصال أو القراءة من الخادم السحابي. تحقق من صلاحيات الحساب والاتصال.',
      descriptionEnglish:
        rejectedWritesCount > 0
          ? 'The server rejected one or more writes after reconnecting. Your drafts remain preserved in the error notice.'
          : 'Cloud synchronization encountered an error. Check your session permissions and connection.',
    };
  }

  if (syncState === 'pending') {
    const countSuffix = pendingOperationsCount > 0 ? ` (${pendingOperationsCount})` : '';
    return {
      syncState,
      isOnline,
      pendingOperationsCount,
      pendingCollections,
      rejectedWritesCount,
      hasErrors,
      labelArabic: isOnline
        ? `قيد المزامنة${countSuffix}`
        : `غير متصل • محفوظ محلياً${countSuffix}`,
      labelEnglish: isOnline
        ? `Syncing${countSuffix}`
        : `Offline • Saved Locally${countSuffix}`,
      descriptionArabic: isOnline
        ? `توجد ${pendingOperationsCount || 1} تعديلات محلية بانتظار تأكيد الخادم السحابي.`
        : `أنت تعمل دون اتصال بالإنترنت. تم حفظ ${pendingOperationsCount || 1} تعديلات محلياً وسترتفع تلقائياً عند عودة الاتصال (لم تُؤكد سحابياً بعد).`,
      descriptionEnglish: isOnline
        ? `${pendingOperationsCount || 1} local change(s) awaiting cloud server confirmation.`
        : `Offline mode: ${pendingOperationsCount || 1} local change(s) queued locally and not yet confirmed by the cloud.`,
    };
  }

  if (syncState === 'local') {
    return {
      syncState,
      isOnline,
      pendingOperationsCount,
      pendingCollections,
      rejectedWritesCount,
      hasErrors,
      labelArabic: isOnline ? 'محلي فقط' : 'غير متصل بالإنترنت',
      labelEnglish: isOnline ? 'Local Cache' : 'Offline',
      descriptionArabic: isOnline
        ? 'البيانات تُعرض حالياً من الذاكرة المحلية بانتظار تأكيد الخادم السحابي.'
        : 'لا يوجد اتصال بالإنترنت حالياً. تُعرض البيانات المتوفرة من الذاكرة المحلية.',
      descriptionEnglish: isOnline
        ? 'Displaying local cached data awaiting cloud server confirmation.'
        : 'You are currently offline. Viewing available locally cached records.',
    };
  }

  return {
    syncState,
    isOnline,
    pendingOperationsCount: 0,
    pendingCollections: [],
    rejectedWritesCount: 0,
    hasErrors: false,
    labelArabic: 'متزامن تماماً',
    labelEnglish: 'Synced',
    descriptionArabic:
      'كافة العملاء واللقاءات والمهام والملاحظات وفرص الأعمال مؤكدة ومحفوظة بالكامل على خادم السحابة.',
    descriptionEnglish:
      'All clients, meetings, tasks, notes, and opportunities are confirmed and synchronized with the cloud server.',
  };
}

/**
 * Validates if the user can sign out without risking unacknowledged local data loss.
 */
export function canSafelySignOut(
  statuses: Partial<Record<CollectionKey, CollectionSyncStatus>>,
  options?: { cacheMode?: CacheMode; rejectedWritesCount?: number }
): {
  safe: boolean;
  pendingCollections: string[];
  pendingCount: number;
  rejectedWritesCount: number;
  warningArabic: string;
} {
  const pending: string[] = [];
  (Object.keys(statuses) as CollectionKey[]).forEach((key) => {
    const s = statuses[key];
    if (s && (s.hasPendingWrites || (s.pendingDeletesCount ?? 0) > 0)) {
      pending.push(key);
    }
  });

  const pendingCount = countPendingOperations(statuses);
  const rejectedWritesCount = options?.rejectedWritesCount ?? 0;
  const cacheMode = options?.cacheMode ?? 'memory';

  const safe = pending.length === 0 && rejectedWritesCount === 0;

  let warningArabic = '';
  if (!safe) {
    const cacheDetails =
      cacheMode === 'persistent'
        ? 'حتى مع تفعيل التخزين الدائم (IndexedDB)، فإن تسجيل الخروج أو تبديل الحساب قبل اكتمال الرفع للسحابة قد يترك التعديلات غير مرفوعة وقد تبقى بقايا مقروءة على هذا المتصفح.'
        : 'أنت تستخدم وضع الذاكرة المؤقتة فقط (Memory-Only)؛ تسجيل الخروج الآن سيمحو هذه التعديلات المحلية غير المؤكدة فوراً وبشكل نهائي.';

    warningArabic = `توجد ${pendingCount} عمليات معلقة${
      rejectedWritesCount > 0 ? ` و${rejectedWritesCount} عمليات مرفوضة لم تُحل` : ''
    }. ${cacheDetails}`;
  }

  return {
    safe,
    pendingCollections: pending,
    pendingCount,
    rejectedWritesCount,
    warningArabic,
  };
}
