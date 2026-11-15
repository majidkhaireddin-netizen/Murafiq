import type {
  Client,
  Meeting,
  ActionItem,
  Note,
  ConflictItem,
  EntityType,
  ResolutionChoice,
  PlaybookRunStep,
  PlaybookStepStatus,
} from '../types/index.ts';

export const FIELD_LABELS_ARABIC: Record<string, string> = {
  name: 'الاسم',
  company: 'الشركة أو الجهة',
  phone: 'رقم الهاتف',
  email: 'البريد الإلكتروني',
  notes: 'الملاحظات السابقة / المحضر النصي',
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
  attendees: 'الحضور (قائمة مختصرة)',
  participants: 'المشاركون',
  agendaItems: 'جدول الأعمال',
  discussionSummary: 'ملخص المناقشات',
  decisions: 'القرارات المعتمدة',
  followUpDateTime: 'موعد المتابعة القادم',
  minutesStatus: 'حالة المحضر',
  minutesAdditionalNotes: 'ملاحظات إضافية للمحضر',
  minutesIncludedSections: 'أقسام المحضر المختارة',
  templateName: 'عنوان الخطة',
  steps: 'خطوات الخطة',
  startedAt: 'تاريخ البدء',
  pausedAt: 'تاريخ الإيقاف المؤقت',
  cancelledAt: 'تاريخ الإلغاء',
  cancelReason: 'سبب الإلغاء',
  revision: 'رقم المراجعة',
  category: 'التصنيف',
};

/**
 * Conflict Policy (v1.0):
 * - Native Firestore offline synchronization uses Last-Write-Wins (LWW) at the server upon reconnect.
 * - Automatic detection of concurrent multi-device edits before overwrite requires schema versioning
 *   (e.g., monotonic revision/version fields checked via Firestore transactions), which is NOT implemented in v1.0.
 * - `detectEntityConflict` performs a field-level diff for manual comparison or simulated UI testing (`DEV_TEST`).
 */
export function detectEntityConflict(
  local: Record<string, any>,
  remote: Record<string, any>,
  entityType: EntityType,
  options?: {
    isSimulated?: boolean;
    detectionSource?: ConflictItem['detectionSource'];
  }
): ConflictItem | null {
  if (!local || !remote || local.id !== remote.id) return null;

  // Fields to ignore in diff comparison
  const ignoredFields = new Set(['updatedAt', 'createdAt', 'userId', 'minutesStatusUpdatedAt']);

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

    // Deep compare arrays/objects or primitives
    const isLocObj = typeof locVal === 'object' && locVal !== null;
    const isRemObj = typeof remVal === 'object' && remVal !== null;
    const areDifferent =
      isLocObj || isRemObj
        ? JSON.stringify(locVal ?? null) !== JSON.stringify(remVal ?? null)
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
    (local.title as string) ||
    (local.name as string) ||
    (local.templateName as string) ||
    (remote.title as string) ||
    (remote.name as string) ||
    (remote.templateName as string) ||
    local.id;

  return {
    id: `conflict-${local.id}-${Date.now()}`,
    entityType,
    entityTitle,
    localVersion: local as any,
    remoteVersion: remote as any,
    differingFields,
    detectedAt: new Date().toISOString(),
    isSimulated: options?.isSimulated ?? false,
    detectionSource: options?.detectionSource ?? 'field_diff',
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

  if (conflict.entityType === 'playbookRun') {
    const remoteRev = typeof remote.revision === 'number' && Number.isFinite(remote.revision) ? remote.revision : 0;

    if (choice === 'keep_local') {
      return {
        ...local,
        startedAt: remote.startedAt || local.startedAt,
        revision: remoteRev + 1,
        updatedAt: now,
      } as unknown as T;
    }

    if (choice === 'keep_remote') {
      return {
        ...remote,
      } as unknown as T;
    }

    // Smart per-step merge for PlaybookRun so concurrent edits on different steps are BOTH preserved
    const statusWeight: Record<PlaybookStepStatus, number> = {
      pending: 0,
      in_progress: 1,
      skipped: 2,
      completed: 3,
    };
    const remoteSteps: PlaybookRunStep[] = Array.isArray(remote.steps) ? remote.steps : [];
    const localSteps: PlaybookRunStep[] = Array.isArray(local.steps) ? local.steps : [];
    const localById = new Map<string, PlaybookRunStep>();
    for (const ls of localSteps) localById.set(ls.id, ls);

    const seenIds = new Set<string>();
    const mergedSteps: PlaybookRunStep[] = remoteSteps.map((rs) => {
      seenIds.add(rs.id);
      const ls = localById.get(rs.id);
      if (!ls) return rs;

      const rsW = statusWeight[rs.status] ?? 0;
      const lsW = statusWeight[ls.status] ?? 0;
      const rsTime = rs.completedAt || rs.skippedAt || rs.startedAt || '';
      const lsTime = ls.completedAt || ls.skippedAt || ls.startedAt || '';

      let primary: PlaybookRunStep;
      let secondary: PlaybookRunStep;
      if (lsW !== rsW) {
        primary = lsW > rsW ? ls : rs;
        secondary = lsW > rsW ? rs : ls;
      } else if (lsTime !== rsTime) {
        primary = lsTime > rsTime ? ls : rs;
        secondary = lsTime > rsTime ? rs : ls;
      } else {
        primary = ls;
        secondary = rs;
      }

      const combined: PlaybookRunStep = { ...primary };
      if (!combined.linkedTaskId && secondary.linkedTaskId) {
        combined.linkedTaskId = secondary.linkedTaskId;
      }
      if (rs.linkedTaskId && ls.linkedTaskId && rs.linkedTaskId !== ls.linkedTaskId) {
        // Cloud-confirmed task link takes precedence on conflicting IDs
        combined.linkedTaskId = rs.linkedTaskId;
      }
      if (!combined.linkedInteractionId && secondary.linkedInteractionId) {
        combined.linkedInteractionId = secondary.linkedInteractionId;
      }
      if (rs.note && ls.note && rs.note.trim() !== ls.note.trim()) {
        combined.note = `[السحابة]: ${rs.note.trim()} | [المحلي]: ${ls.note.trim()}`.slice(0, 1000);
      } else if (!combined.note && secondary.note) {
        combined.note = secondary.note;
      }
      if (!combined.dueDate && secondary.dueDate) {
        combined.dueDate = secondary.dueDate;
      }
      return combined;
    });

    for (const ls of localSteps) {
      if (!seenIds.has(ls.id)) {
        mergedSteps.push(ls);
      }
    }

    const mergedRun: Record<string, any> = {
      ...remote,
      steps: mergedSteps,
      startedAt: remote.startedAt || local.startedAt,
      revision: remoteRev + 1,
      updatedAt: now,
    };
    return mergedRun as unknown as T;
  }

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
