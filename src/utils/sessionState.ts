import { EntityType, WriteErrorCategory } from '../types';

export interface WriteErrorClassification {
  category: WriteErrorCategory;
  isPermanentServerRejection: boolean;
  messageArabic: string;
}

export interface ScopedOperationHandle {
  opId: string;
  opSeq: number;
  acceptedLocally: boolean;
  serverPromise: Promise<void>;
}

/**
 * Classifies Firestore or validation errors into clear categories without losing user context.
 */
export function classifyWriteError(
  error: unknown,
  entityType: EntityType,
  isDelete: boolean = false
): WriteErrorClassification {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const lower = rawMessage.toLowerCase();
  const names: Record<EntityType, string> = {
    client: 'العميل',
    meeting: 'اللقاء',
    task: 'المهمة',
    note: 'الملاحظة',
  };
  const entityName = names[entityType];
  const actionVerb = isDelete ? 'حذف' : 'حفظ';

  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return {
      category: 'permission-denied',
      isPermanentServerRejection: true,
      messageArabic: `رفض الخادم ${actionVerb} ${entityName} بسبب قيود الصلاحيات أو التحقق الأمني (permission-denied). تم الاحتفاظ بنسخة للمراجعة في قائمة الأخطاء لتتمكن من تعديلها وإعادة المحاولة.`,
    };
  }

  if (lower.includes('unauthenticated') || lower.includes('authentication required')) {
    return {
      category: 'unauthenticated',
      isPermanentServerRejection: true,
      messageArabic: `تعذر ${actionVerb} ${entityName} لأن جلسة تسجيل الدخول انتهت أو غير صالحة. أعد تسجيل الدخول ثم أعد المحاولة.`,
    };
  }

  if (lower.includes('invalid-argument') || lower.includes('invalid data')) {
    return {
      category: 'invalid-argument',
      isPermanentServerRejection: true,
      messageArabic: `رفض الخادم ${actionVerb} ${entityName} لعدم تطابق تنسيق البيانات المطلوب. تم حفظ مسودتك في قائمة الأخطاء لتصحيحها.`,
    };
  }

  if (lower.includes('failed-precondition')) {
    return {
      category: 'failed-precondition',
      isPermanentServerRejection: true,
      messageArabic: `تعذر إتمام ${actionVerb} ${entityName} بسبب تعارض في حالة السجل على الخادم (failed-precondition).`,
    };
  }

  if (lower.includes('unavailable') || lower.includes('network') || lower.includes('offline')) {
    return {
      category: 'unavailable',
      isPermanentServerRejection: false,
      messageArabic: `تعذر الوصول للخادم أثناء ${actionVerb} ${entityName}. تبقى العملية في قائمة الانتظار عند عودة الشبكة.`,
    };
  }

  return {
    category: 'unknown',
    isPermanentServerRejection: true,
    messageArabic: getArabicSaveErrorMessage(entityType, isDelete),
  };
}

/**
 * Reconciles a single failed entity operation back to its prior per-entity state
 * without disturbing any other entities in the collection array.
 */
export function reconcileEntityFailure<T extends { id: string }>(
  currentItems: T[],
  entityId: string,
  previousEntity: T | undefined
): T[] {
  const idx = currentItems.findIndex((item) => item.id === entityId);

  // Entity existed prior to the failed operation: restore only this entity
  if (previousEntity) {
    if (idx >= 0) {
      const next = [...currentItems];
      next[idx] = previousEntity;
      return next;
    }
    return [previousEntity, ...currentItems];
  }

  // Entity did not exist prior to the failed create operation: remove only this entity
  if (idx >= 0) {
    return currentItems.filter((item) => item.id !== entityId);
  }

  return currentItems;
}

/**
 * Coordinates overlapping/concurrent per-entity optimistic updates.
 * Uses functional state updaters and per-entity monotonic sequence numbers so that:
 * - An earlier failure on Entity A never overwrites a newer operation on Entity B.
 * - An earlier failure on Entity A (op 1) never overwrites a newer operation on Entity A (op 2).
 * - UI acceptance resolves immediately after local dispatch; server ack/rejection is tracked asynchronously.
 */
export class OperationCoordinator<T extends { id: string }> {
  private seqCounter = 0;
  private latestSeqByEntityId = new Map<string, number>();

  getLatestSequence(entityId: string): number | undefined {
    return this.latestSeqByEntityId.get(entityId);
  }

  runScopedMutation(params: {
    entityId: string;
    entityType: EntityType;
    isDelete?: boolean;
    previousEntity: T | undefined;
    setState: (updater: (prev: T[]) => T[]) => void;
    applyOptimistic: (prev: T[]) => T[];
    dispatchWrite: () => { serverPromise: Promise<void> };
    onServerConfirmed?: (info: { opId: string; opSeq: number; wasSuperseded: boolean }) => void;
    onServerRejected?: (info: {
      opId: string;
      opSeq: number;
      error: Error;
      classification: WriteErrorClassification;
      wasSuperseded: boolean;
    }) => void;
  }): ScopedOperationHandle {
    const {
      entityId,
      entityType,
      isDelete = false,
      previousEntity,
      setState,
      applyOptimistic,
      dispatchWrite,
      onServerConfirmed,
      onServerRejected,
    } = params;

    const opSeq = ++this.seqCounter;
    const opId = `${entityType}-${entityId}-${opSeq}`;
    this.latestSeqByEntityId.set(entityId, opSeq);

    // Apply optimistic state via pure functional updater (never captures a full-array snapshot)
    setState((prev) => applyOptimistic(prev));

    let writeHandle: { serverPromise: Promise<void> };
    try {
      writeHandle = dispatchWrite();
    } catch (syncErr) {
      const error = syncErr instanceof Error ? syncErr : new Error(String(syncErr));
      const wasSuperseded = this.latestSeqByEntityId.get(entityId) !== opSeq;
      if (!wasSuperseded) {
        setState((prev) => reconcileEntityFailure(prev, entityId, previousEntity));
      }
      const classification = classifyWriteError(error, entityType, isDelete);
      if (onServerRejected) {
        onServerRejected({ opId, opSeq, error, classification, wasSuperseded });
      }
      throw error;
    }

    const trackedServerPromise = writeHandle.serverPromise.then(
      () => {
        const wasSuperseded = this.latestSeqByEntityId.get(entityId) !== opSeq;
        if (onServerConfirmed) {
          onServerConfirmed({ opId, opSeq, wasSuperseded });
        }
      },
      (asyncErr) => {
        const error = asyncErr instanceof Error ? asyncErr : new Error(String(asyncErr));
        const wasSuperseded = this.latestSeqByEntityId.get(entityId) !== opSeq;
        if (!wasSuperseded) {
          setState((prev) => reconcileEntityFailure(prev, entityId, previousEntity));
        }
        const classification = classifyWriteError(error, entityType, isDelete);
        if (onServerRejected) {
          onServerRejected({ opId, opSeq, error, classification, wasSuperseded });
        }
      }
    );

    return {
      opId,
      opSeq,
      acceptedLocally: true,
      serverPromise: trackedServerPromise,
    };
  }
}

/**
 * User-friendly Arabic error message formatter for Firestore save/delete failures.
 */
export function getArabicSaveErrorMessage(entityType: EntityType, isDelete: boolean = false): string {
  const names = {
    client: 'العميل',
    meeting: 'اللقاء',
    task: 'المهمة',
    note: 'الملاحظة',
  };

  const entityName = names[entityType];
  if (isDelete) {
    return `تعذر حذف ${entityName} من السحابة بسبب رفض الصلاحيات أو تعذر التنفيذ. تم استعادة السجل ومراجعته متاحة.`;
  }
  return `تعذر حفظ ${entityName} في السحابة. تمت استعادة الحالة السابقة للسجل والاحتفاظ بمسودتك للمراجعة.`;
}
