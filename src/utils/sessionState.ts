import { Client, Meeting, ActionItem, Note } from '../types';

export interface OperationResult<T> {
  success: boolean;
  data: T;
  error?: Error;
}

/**
 * Executes a state mutation with atomic rollback if the underlying async operation (e.g. Firestore write) fails.
 */
export async function executeWithRollback<T>(
  currentItems: T[],
  updateState: (items: T[]) => void,
  calculateOptimistic: (items: T[]) => T[],
  asyncOperation: () => Promise<void>,
  onError?: (err: Error) => void
): Promise<OperationResult<T[]>> {
  const previous = [...currentItems];
  const optimistic = calculateOptimistic(currentItems);
  updateState(optimistic);

  try {
    await asyncOperation();
    return { success: true, data: optimistic };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Atomic rollback to previous state
    updateState(previous);
    if (onError) onError(error);
    return { success: false, data: previous, error };
  }
}

/**
 * User-friendly Arabic error message formatter for Firestore save/delete failures.
 */
export function getArabicSaveErrorMessage(entityType: 'client' | 'meeting' | 'task' | 'note', isDelete: boolean = false): string {
  const names = {
    client: 'العميل',
    meeting: 'اللقاء',
    task: 'المهمة',
    note: 'الملاحظة',
  };

  const entityName = names[entityType];
  if (isDelete) {
    return `تعذر حذف ${entityName} من السحابة بسبب رفض الصلاحيات أو انقطاع الاتصال. تم استعادة المستند.`;
  }
  return `تعذر حفظ ${entityName} في السحابة. تم التراجع عن التعديل للحفاظ على اتساق البيانات.`;
}
