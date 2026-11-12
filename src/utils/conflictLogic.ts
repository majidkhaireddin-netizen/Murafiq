import { Client, Meeting, ActionItem, Note, ConflictItem, EntityType, ResolutionChoice } from '../types';

export const FIELD_LABELS_ARABIC: Record<string, string> = {
  name: 'الاسم',
  company: 'الشركة أو الجهة',
  phone: 'رقم الهاتف',
  email: 'البريد الإلكتروني',
  notes: 'الملاحظات ومحضر اللقاء',
  title: 'العنوان / الموضوع',
  dateTime: 'موعد اللقاء',
  location: 'مكان اللقاء',
  status: 'الحالة',
  duration: 'المدة الزمنية',
  description: 'التفاصيل',
  dueDate: 'الموعد النهائي',
  priority: 'درجة الأهمية',
  content: 'نص الملاحظة',
  color: 'اللون',
  isFavorite: 'المفضلة',
};

/**
 * Detect differences between a local offline version and a remote cloud version
 */
export function detectEntityConflict(
  local: Record<string, any>,
  remote: Record<string, any>,
  entityType: EntityType
): ConflictItem | null {
  if (!local || !remote || local.id !== remote.id) return null;

  // Fields to ignore in diff comparison
  const ignoredFields = new Set(['updatedAt', 'createdAt', 'userId']);

  const differingFields: {
    field: string;
    fieldLabelArabic: string;
    localValue: any;
    remoteValue: any;
  }[] = [];

  const allKeys = Array.from(new Set([...Object.keys(local), ...Object.keys(remote)]));

  for (const key of allKeys) {
    if (ignoredFields.has(key)) continue;

    const locVal = local[key];
    const remVal = remote[key];

    // Deep compare arrays or primitives
    const areDifferent =
      Array.isArray(locVal) && Array.isArray(remVal)
        ? JSON.stringify(locVal) !== JSON.stringify(remVal)
        : locVal !== remVal;

    if (areDifferent) {
      differingFields.push({
        field: key,
        fieldLabelArabic: FIELD_LABELS_ARABIC[key] || key,
        localValue: locVal,
        remoteValue: remVal,
      });
    }
  }

  if (differingFields.length === 0) return null;

  const entityTitle =
    (local.title as string) || (local.name as string) || (remote.title as string) || (remote.name as string) || local.id;

  return {
    id: `conflict-${local.id}-${Date.now()}`,
    entityType,
    entityTitle,
    localVersion: local as any,
    remoteVersion: remote as any,
    differingFields,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a conflict based on user's choice:
 * - 'keep_local': Use the local device edits.
 * - 'keep_remote': Use the cloud remote version.
 * - 'merge': Intelligently combine notes/content and take latest values.
 */
export function resolveConflictRecord<T extends Record<string, any>>(
  conflict: ConflictItem,
  choice: ResolutionChoice,
  customNotesMerge?: string
): T {
  const local = conflict.localVersion as unknown as Record<string, any>;
  const remote = conflict.remoteVersion as unknown as Record<string, any>;
  const now = new Date().toISOString();

  if (choice === 'keep_local') {
    return {
      ...local,
      updatedAt: now,
    } as unknown as T;
  }

  if (choice === 'keep_remote') {
    return {
      ...remote,
      updatedAt: now,
    } as unknown as T;
  }

  // Merge strategy
  const merged: Record<string, any> = { ...remote, ...local };

  // For long text fields (notes / content), append both with clear provenance timestamps
  if (customNotesMerge) {
    if ('notes' in merged) merged.notes = customNotesMerge;
    if ('content' in merged) merged.content = customNotesMerge;
  } else {
    if ('notes' in local && 'notes' in remote && local.notes !== remote.notes) {
      merged.notes = `[النسخة السحابية]:\n${remote.notes}\n\n---\n[تعديلاتك أثناء عدم الاتصال]:\n${local.notes}`;
    }
    if ('content' in local && 'content' in remote && local.content !== remote.content) {
      merged.content = `[النسخة السحابية]:\n${remote.content}\n\n---\n[تعديلاتك أثناء عدم الاتصال]:\n${local.content}`;
    }
  }

  merged.updatedAt = now;
  return merged as unknown as T;
}
