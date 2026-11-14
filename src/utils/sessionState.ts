import { EntityType, RejectedWriteRecord, WriteErrorCategory } from '../types';

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
 * Extracts and normalizes Firestore/Firebase error codes from FirebaseError,
 * wrapped JSON FirestoreErrorInfo errors, or gRPC/emulator error formats.
 * Examples:
 * - "permission-denied" -> "permission-denied"
 * - "PERMISSION_DENIED" -> "permission-denied"
 * - "firestore/permission-denied" -> "permission-denied"
 */
export function extractFirestoreErrorCode(error: unknown): string | undefined {
  const normalize = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return undefined;
    const withoutPrefix = trimmed.startsWith('firestore/')
      ? trimmed.slice('firestore/'.length)
      : trimmed;
    return withoutPrefix.replace(/_/g, '-');
  };

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const directCode = normalize(record.code);
    if (directCode) return directCode;

    if (typeof record.cause === 'object' && record.cause !== null) {
      const causeCode = normalize((record.cause as Record<string, unknown>).code);
      if (causeCode) return causeCode;
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawMessage) as Record<string, unknown>;
      const parsedCode = normalize(parsed.code);
      if (parsedCode) return parsedCode;
    } catch {
      // Ignore invalid JSON
    }
  }

  // Match gRPC/SDK inline codes such as "7 PERMISSION_DENIED" or "(permission-denied)"
  const upperMatch = rawMessage.match(
    /\b(PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT|FAILED_PRECONDITION|UNAVAILABLE)\b/i
  );
  if (upperMatch) {
    return normalize(upperMatch[1]);
  }

  const kebabMatch = rawMessage.match(
    /\b(?:firestore\/)?(permission-denied|unauthenticated|invalid-argument|failed-precondition|unavailable)\b/i
  );
  if (kebabMatch) {
    return normalize(kebabMatch[1]);
  }

  return undefined;
}

function extractCombinedErrorText(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawMessage) as Record<string, unknown>;
      if (typeof parsed.error === 'string') {
        return `${rawMessage} ${parsed.error}`.toLowerCase();
      }
    } catch {
      // Ignore
    }
  }
  return rawMessage.toLowerCase();
}

/**
 * Classifies Firestore or validation errors into clear categories without losing user context.
 * Prioritizes error.code (supporting permission-denied, PERMISSION_DENIED, firestore/permission-denied, etc.).
 */
export function classifyWriteError(
  error: unknown,
  entityType: EntityType,
  isDelete: boolean = false
): WriteErrorClassification {
  const normalizedCode = extractFirestoreErrorCode(error);
  const lower = extractCombinedErrorText(error);
  const names: Record<EntityType, string> = {
    client: 'العميل',
    meeting: 'اللقاء',
    task: 'المهمة',
    note: 'الملاحظة',
    reminder: 'التذكير',
    preference: 'إعدادات المتابعة',
  };
  const entityName = names[entityType];
  const actionVerb = isDelete ? 'حذف' : 'حفظ';

  if (
    lower.includes('meeting_has_attachments') ||
    lower.includes('لا يمكن حذف اللقاء ما دامت له مرفقات') ||
    lower.includes('لا يمكن حذف اللقاء لوجود مرفقات')
  ) {
    return {
      category: 'failed-precondition',
      isPermanentServerRejection: true,
      messageArabic:
        'لا يمكن حذف اللقاء ما دامت له مرفقات معتمدة. يرجى حذف المرفقات أولاً من قسم المرفقات داخل اللقاء.',
    };
  }

  if (
    lower.includes('meeting_has_pending_attachments') ||
    lower.includes('عمليات رفع مرفقات لم تكتمل')
  ) {
    return {
      category: 'failed-precondition',
      isPermanentServerRejection: true,
      messageArabic:
        'لا يمكن حذف اللقاء لوجود عمليات رفع مرفقات لم تكتمل بعد. يرجى إكمالها أو تنظيفها أولاً من قسم المرفقات.',
    };
  }

  if (
    normalizedCode === 'permission-denied' ||
    lower.includes('permission-denied') ||
    lower.includes('permission_denied') ||
    lower.includes('missing or insufficient permissions') ||
    /false for '(create|update|delete|get|list|write)'/.test(lower)
  ) {
    return {
      category: 'permission-denied',
      isPermanentServerRejection: true,
      messageArabic:
        entityType === 'meeting' && isDelete
          ? 'رفض الخادم حذف اللقاء؛ قد يحتوي اللقاء على مرفقات معتمدة أو عمليات رفع غير مكتملة يجب حذفها أولاً، أو لا تملك صلاحية الحذف.'
          : `رفض الخادم ${actionVerb} ${entityName} بسبب قيود الصلاحيات أو التحقق الأمني (permission-denied). تم الاحتفاظ بنسخة للمراجعة في قائمة الأخطاء لتتمكن من تعديلها وإعادة المحاولة.`,
    };
  }

  if (
    normalizedCode === 'unauthenticated' ||
    lower.includes('unauthenticated') ||
    lower.includes('authentication required')
  ) {
    return {
      category: 'unauthenticated',
      isPermanentServerRejection: true,
      messageArabic: `تعذر ${actionVerb} ${entityName} لأن جلسة تسجيل الدخول انتهت أو غير صالحة. أعد تسجيل الدخول ثم أعد المحاولة.`,
    };
  }

  if (
    normalizedCode === 'invalid-argument' ||
    lower.includes('invalid-argument') ||
    lower.includes('invalid_argument') ||
    lower.includes('invalid data')
  ) {
    return {
      category: 'invalid-argument',
      isPermanentServerRejection: true,
      messageArabic: `رفض الخادم ${actionVerb} ${entityName} لعدم تطابق تنسيق البيانات المطلوب. تم حفظ مسودتك في قائمة الأخطاء لتصحيحها.`,
    };
  }

  if (
    normalizedCode === 'failed-precondition' ||
    lower.includes('failed-precondition') ||
    lower.includes('failed_precondition')
  ) {
    return {
      category: 'failed-precondition',
      isPermanentServerRejection: true,
      messageArabic: `تعذر إتمام ${actionVerb} ${entityName} بسبب تعارض في حالة السجل على الخادم (failed-precondition).`,
    };
  }

  if (
    normalizedCode === 'unavailable' ||
    lower.includes('unavailable') ||
    lower.includes('network') ||
    lower.includes('offline')
  ) {
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
  const names: Record<EntityType, string> = {
    client: 'العميل',
    meeting: 'اللقاء',
    task: 'المهمة',
    note: 'الملاحظة',
    reminder: 'التذكير',
    preference: 'إعدادات المتابعة',
  };

  const entityName = names[entityType];
  if (isDelete) {
    return `تعذر حذف ${entityName} من السحابة بسبب رفض الصلاحيات أو تعذر التنفيذ. تم استعادة السجل ومراجعته متاحة.`;
  }
  return `تعذر حفظ ${entityName} في السحابة. تمت استعادة الحالة السابقة للسجل والاحتفاظ بمسودتك للمراجعة.`;
}

/**
 * Applies a server confirmation outcome to the rejected-writes recovery list ONLY if
 * the operation has NOT been superseded by a newer operation on the same entity.
 * Prevents an older operation succeeding from clearing a newer operation's failure alert.
 */
export function applyScopedConfirmation(
  prev: RejectedWriteRecord[],
  params: { entityType: EntityType; entityId: string; wasSuperseded: boolean }
): RejectedWriteRecord[] {
  if (params.wasSuperseded) {
    return prev;
  }
  return prev.filter((r) => !(r.entityType === params.entityType && r.entityId === params.entityId));
}

/**
 * Applies a server rejection outcome to the rejected-writes recovery list ONLY if
 * the operation has NOT been superseded by a newer operation on the same entity.
 * Prevents an older failure from overwriting or showing stale errors over a newer edit.
 */
export function applyScopedRejection(
  prev: RejectedWriteRecord[],
  params: { record: RejectedWriteRecord; wasSuperseded: boolean }
): RejectedWriteRecord[] {
  if (params.wasSuperseded) {
    return prev;
  }
  return [
    params.record,
    ...prev.filter(
      (r) => !(r.entityType === params.record.entityType && r.entityId === params.record.entityId)
    ),
  ];
}

/**
 * Serializes a rejected draft record as portable JSON for safe user-initiated download.
 * Never writes client PII automatically to localStorage.
 */
export function serializeRejectedDraftJson(rec: RejectedWriteRecord): string {
  return JSON.stringify(
    {
      murafiq_draft_export: true,
      exportedAt: new Date().toISOString(),
      opId: rec.opId,
      entityType: rec.entityType,
      entityId: rec.entityId,
      entityTitle: rec.entityTitle,
      operation: rec.operation,
      errorCategory: rec.category,
      occurredAt: rec.occurredAt,
      messageArabic: rec.messageArabic,
      payload: rec.payload ?? null,
    },
    null,
    2
  );
}

/**
 * Formats a rejected draft record into readable text for safe user-initiated clipboard copy.
 */
export function formatRejectedDraftClipboardText(rec: RejectedWriteRecord): string {
  const lines = [
    `مسودة مُرافق غير متزامنة (${rec.entityType} / ${rec.operation})`,
    `العنوان: ${rec.entityTitle}`,
    `المعرّف: ${rec.entityId}`,
    `الوقت: ${rec.occurredAt}`,
    `سبب الفشل: ${rec.messageArabic}`,
  ];
  if (rec.payload) {
    lines.push('البيانات (JSON):');
    lines.push(JSON.stringify(rec.payload, null, 2));
  }
  return lines.join('\n');
}
