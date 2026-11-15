import type {
  ActionItem,
  Client,
  CommunicationChannel,
  CommunicationInteraction,
  CommunicationOutcome,
  ConflictItem,
  Opportunity,
  PlaybookCategory,
  PlaybookDuePolicy,
  PlaybookDuePolicyType,
  PlaybookProgressMetrics,
  PlaybookRescheduleSuggestion,
  PlaybookRun,
  PlaybookRunStatus,
  PlaybookRunStep,
  PlaybookStepCompletionMethod,
  PlaybookStepStatus,
  PlaybookStepType,
  PlaybookTemplate,
  PlaybookTemplateStep,
  TaskPriority,
} from '../types/index.ts';
import {
  addCalendarDaysToKey,
  formatCalendarDateKey,
  getTodayCalendarKey,
  parseDateOnlyString,
  resolveCalendarParts,
} from './followUpEngine.ts';
import { detectEntityConflict } from './conflictLogic.ts';

export const MAX_PLAYBOOK_STEPS = 20;
export const MAX_PLAYBOOK_OFFSET_DAYS = 365;
export const PLAYBOOK_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const STEP_DEPENDENCY_PLACEHOLDER_AR = 'يُحدد الموعد بعد إكمال الخطوة السابقة.';

export const PLAYBOOK_CATEGORY_META: Record<
  PlaybookCategory,
  { labelAr: string; labelEn: string; badgeClass: string }
> = {
  lead_engagement: {
    labelAr: 'التواصل مع عميل محتمل',
    labelEn: 'Lead Engagement',
    badgeClass: 'bg-sky-50 text-sky-900 border-sky-200',
  },
  proposal_follow_up: {
    labelAr: 'متابعة عرض مقدم',
    labelEn: 'Proposal Follow-Up',
    badgeClass: 'bg-violet-50 text-violet-900 border-violet-200',
  },
  post_meeting: {
    labelAr: 'المتابعة بعد اجتماع',
    labelEn: 'Post-Meeting',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  relationship_reactivation: {
    labelAr: 'إعادة تنشيط علاقة',
    labelEn: 'Relationship Reactivation',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  custom: {
    labelAr: 'مخصص',
    labelEn: 'Custom',
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-200',
  },
};

export const PLAYBOOK_STEP_TYPE_META: Record<
  PlaybookStepType,
  { labelAr: string; labelEn: string; badgeClass: string }
> = {
  task: {
    labelAr: 'مهمة تنفيذية',
    labelEn: 'Task',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  communication: {
    labelAr: 'تواصل مع العميل',
    labelEn: 'Communication',
    badgeClass: 'bg-sky-50 text-sky-900 border-sky-200',
  },
  manual: {
    labelAr: 'مراجعة وتحقق يدوي',
    labelEn: 'Manual Review',
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-200',
  },
};

export const PLAYBOOK_RUN_STATUS_META: Record<
  PlaybookRunStatus,
  { labelAr: string; labelEn: string; badgeClass: string }
> = {
  active: {
    labelAr: 'نشطة',
    labelEn: 'Active',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  paused: {
    labelAr: 'متوقفة مؤقتًا',
    labelEn: 'Paused',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  completed: {
    labelAr: 'مكتملة',
    labelEn: 'Completed',
    badgeClass: 'bg-teal-50 text-teal-900 border-teal-200',
  },
  cancelled: {
    labelAr: 'ملغاة',
    labelEn: 'Cancelled',
    badgeClass: 'bg-rose-50 text-rose-900 border-rose-200',
  },
};

export const PLAYBOOK_STEP_STATUS_META: Record<
  PlaybookStepStatus,
  { labelAr: string; labelEn: string; badgeClass: string }
> = {
  pending: {
    labelAr: 'لم تبدأ',
    labelEn: 'Pending',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
  },
  in_progress: {
    labelAr: 'قيد التنفيذ',
    labelEn: 'In Progress',
    badgeClass: 'bg-sky-50 text-sky-900 border-sky-200',
  },
  completed: {
    labelAr: 'مكتملة',
    labelEn: 'Completed',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  skipped: {
    labelAr: 'تم تجاوزها',
    labelEn: 'Skipped',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
};

const VALID_CATEGORIES: readonly PlaybookCategory[] = [
  'lead_engagement',
  'proposal_follow_up',
  'post_meeting',
  'relationship_reactivation',
  'custom',
];

const VALID_STEP_TYPES: readonly PlaybookStepType[] = ['task', 'communication', 'manual'];

const VALID_DUE_POLICY_TYPES: readonly PlaybookDuePolicyType[] = [
  'from_start',
  'after_previous_completion',
];

const VALID_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const VALID_CHANNELS: readonly CommunicationChannel[] = [
  'phone_call',
  'whatsapp',
  'email',
  'in_person_visit',
  'video_call',
  'sms',
  'other',
];

const SYSTEM_TEMPLATE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export const BUILTIN_PLAYBOOK_TEMPLATES: readonly PlaybookTemplate[] = [
  {
    id: 'sys_pb_lead_engagement',
    name: 'التواصل مع عميل محتمل',
    description: 'مسار منظم للتأهيل الأولي وبناء الثقة وترتيب الاجتماع الاستكشافي مع عميل جديد.',
    category: 'lead_engagement',
    isSystemTemplate: true,
    createdAt: SYSTEM_TEMPLATE_TIMESTAMP,
    updatedAt: SYSTEM_TEMPLATE_TIMESTAMP,
    steps: [
      {
        id: 'pb_step_lead_init_call',
        title: 'إجراء الاتصال الأولي',
        description: 'مكالمة تعريفية قصيرة للتحقق من الاهتمام والتوقيت المناسب.',
        stepType: 'communication',
        order: 1,
        duePolicy: { type: 'from_start', offsetDays: 0 },
        priority: 'high',
        suggestedChannel: 'phone_call',
      },
      {
        id: 'pb_step_lead_intro_services',
        title: 'التعريف بالخدمات',
        description: 'إرسال نبذة واضحة ومختصرة عن الخدمات ونطاق العمل ذي الصلة.',
        stepType: 'communication',
        order: 2,
        duePolicy: { type: 'after_previous_completion', offsetDays: 2 },
        priority: 'medium',
        suggestedChannel: 'email',
      },
      {
        id: 'pb_step_lead_identify_needs',
        title: 'تحديد احتياجات العميل',
        description: 'توثيق المتطلبات والتحديات والنطاق المتوقع قبل العرض.',
        stepType: 'task',
        order: 3,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'medium',
      },
      {
        id: 'pb_step_lead_arrange_meeting',
        title: 'ترتيب اجتماع',
        description: 'تنسيق موعد اجتماع تعارف أو عرض تفصيلي حسب ملاءمة العميل.',
        stepType: 'task',
        order: 4,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'high',
      },
      {
        id: 'pb_step_lead_next_step',
        title: 'تحديد الخطوة التالية',
        description: 'مراجعة مخرجات المرحلة وتثبيت الالتزام التالي أو إنشاء فرصة أعمال.',
        stepType: 'manual',
        order: 5,
        duePolicy: { type: 'after_previous_completion', offsetDays: 2 },
        priority: 'medium',
      },
    ],
  },
  {
    id: 'sys_pb_proposal_follow_up',
    name: 'متابعة عرض مقدم',
    description: 'تسلسل احترافي لمتابعة العرض المالي والفني بعد الإرسال وحتى وضوح القرار.',
    category: 'proposal_follow_up',
    isSystemTemplate: true,
    createdAt: SYSTEM_TEMPLATE_TIMESTAMP,
    updatedAt: SYSTEM_TEMPLATE_TIMESTAMP,
    steps: [
      {
        id: 'pb_step_prop_send',
        title: 'إرسال العرض',
        description: 'تجهيز النسخة النهائية من العرض ومشاركتها عبر القناة المتفق عليها.',
        stepType: 'task',
        order: 1,
        duePolicy: { type: 'from_start', offsetDays: 0 },
        priority: 'high',
      },
      {
        id: 'pb_step_prop_confirm_receipt',
        title: 'التأكد من الاستلام',
        description: 'رسالة متابعة لطيفة للتأكد من وصول العرض ووضوح بنوده الأساسية.',
        stepType: 'communication',
        order: 2,
        duePolicy: { type: 'after_previous_completion', offsetDays: 1 },
        priority: 'medium',
        suggestedChannel: 'whatsapp',
      },
      {
        id: 'pb_step_prop_request_feedback',
        title: 'طلب الملاحظات',
        description: 'التواصل لسماع التساؤلات أو الملاحظات الفنية والمالية على العرض.',
        stepType: 'communication',
        order: 3,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'high',
        suggestedChannel: 'phone_call',
      },
      {
        id: 'pb_step_prop_discuss_revisions',
        title: 'مناقشة التعديلات',
        description: 'تقييم التعديلات المطلوبة وإعداد الرد أو النسخة المحدثة إذا لزم الأمر.',
        stepType: 'task',
        order: 4,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'high',
      },
      {
        id: 'pb_step_prop_get_decision',
        title: 'الحصول على القرار',
        description: 'التأكد من القرار النهائي للعميل وتحديث السجل المرتبط يدويًا.',
        stepType: 'manual',
        order: 5,
        duePolicy: { type: 'after_previous_completion', offsetDays: 4 },
        priority: 'urgent',
      },
    ],
  },
  {
    id: 'sys_pb_post_meeting',
    name: 'المتابعة بعد اجتماع',
    description: 'ضمان تحويل مخرجات الاجتماع إلى التزامات واضحة ومتابعة منتظمة مع العميل.',
    category: 'post_meeting',
    isSystemTemplate: true,
    createdAt: SYSTEM_TEMPLATE_TIMESTAMP,
    updatedAt: SYSTEM_TEMPLATE_TIMESTAMP,
    steps: [
      {
        id: 'pb_step_post_send_summary',
        title: 'إرسال ملخص الاجتماع',
        description: 'مشاركة أبرز النقاط والقرارات المتفق عليها بعد الاجتماع مباشرة.',
        stepType: 'communication',
        order: 1,
        duePolicy: { type: 'from_start', offsetDays: 0 },
        priority: 'high',
        suggestedChannel: 'email',
      },
      {
        id: 'pb_step_post_review_commitments',
        title: 'مراجعة الالتزامات',
        description: 'التدقيق في الالتزامات المطلوبة من فريقنا ومن العميل وتواريخها.',
        stepType: 'manual',
        order: 2,
        duePolicy: { type: 'after_previous_completion', offsetDays: 1 },
        priority: 'medium',
      },
      {
        id: 'pb_step_post_track_open_tasks',
        title: 'متابعة المهام المفتوحة',
        description: 'التأكد من تقدم المهام الناتجة عن الاجتماع قبل الموعد المتفق عليه.',
        stepType: 'task',
        order: 3,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'high',
      },
      {
        id: 'pb_step_post_contact_client',
        title: 'التواصل مع العميل',
        description: 'إطلاع العميل على المستجدات والتأكد من جاهزية الطرفين.',
        stepType: 'communication',
        order: 4,
        duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
        priority: 'medium',
        suggestedChannel: 'phone_call',
      },
      {
        id: 'pb_step_post_schedule_next',
        title: 'تحديد المتابعة القادمة',
        description: 'تثبيت موعد الخطوة القادمة أو الاجتماع اللاحق بناءً على ما تم إنجازه.',
        stepType: 'manual',
        order: 5,
        duePolicy: { type: 'after_previous_completion', offsetDays: 2 },
        priority: 'medium',
      },
    ],
  },
  {
    id: 'sys_pb_relationship_reactivation',
    name: 'إعادة تنشيط علاقة',
    description: 'خطة هادئة ومحترمة لإحياء التواصل مع عميل سابق أو علاقة متوقفة منذ فترة.',
    category: 'relationship_reactivation',
    isSystemTemplate: true,
    createdAt: SYSTEM_TEMPLATE_TIMESTAMP,
    updatedAt: SYSTEM_TEMPLATE_TIMESTAMP,
    steps: [
      {
        id: 'pb_step_react_review_last',
        title: 'مراجعة آخر تواصل',
        description: 'قراءة آخر الاجتماعات والملاحظات وسجلات التواصل لفهم السياق السابق.',
        stepType: 'manual',
        order: 1,
        duePolicy: { type: 'from_start', offsetDays: 0 },
        priority: 'medium',
      },
      {
        id: 'pb_step_react_new_call',
        title: 'إجراء اتصال جديد',
        description: 'بدء تواصل ودي للاطمئنان واستعادة العلاقة المهنية.',
        stepType: 'communication',
        order: 2,
        duePolicy: { type: 'after_previous_completion', offsetDays: 1 },
        priority: 'high',
        suggestedChannel: 'phone_call',
      },
      {
        id: 'pb_step_react_learn_updates',
        title: 'معرفة المستجدات',
        description: 'الاستماع إلى أولويات العميل الحالية والتغييرات في احتياجاته.',
        stepType: 'communication',
        order: 3,
        duePolicy: { type: 'after_previous_completion', offsetDays: 4 },
        priority: 'medium',
        suggestedChannel: 'whatsapp',
      },
      {
        id: 'pb_step_react_propose_collab',
        title: 'اقتراح فرصة تعاون',
        description: 'صياغة مقترح عملي أو قيمة مضافة تناسب مرحلة العميل الراهنة.',
        stepType: 'task',
        order: 4,
        duePolicy: { type: 'after_previous_completion', offsetDays: 5 },
        priority: 'medium',
      },
      {
        id: 'pb_step_react_set_followup',
        title: 'تحديد متابعة لاحقة',
        description: 'تسجيل موعد متابعة مناسب للمرحلة المقبلة أو حفظ النتيجة في ملف العميل.',
        stepType: 'manual',
        order: 5,
        duePolicy: { type: 'after_previous_completion', offsetDays: 7 },
        priority: 'low',
      },
    ],
  },
];

// =========================================================================
// ID & Ownership Utilities
// =========================================================================

export function isValidPlaybookId(id: unknown): id is string {
  return typeof id === 'string' && PLAYBOOK_ID_REGEX.test(id);
}

export function isOwnedByCurrentUser(
  recordUserId: string | undefined,
  currentUserId?: string
): boolean {
  if (!currentUserId) return true;
  if (!recordUserId) return true;
  return recordUserId === currentUserId;
}

export function generateStablePlaybookId(prefix: string = 'pb'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'pb';
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `${safePrefix}_${rand}`.slice(0, 128);
}

function clampString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function normalizeOffsetDays(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(MAX_PLAYBOOK_OFFSET_DAYS, Math.round(raw)));
}

function cloneDuePolicy(policy: PlaybookDuePolicy): PlaybookDuePolicy {
  return {
    type: VALID_DUE_POLICY_TYPES.includes(policy?.type) ? policy.type : 'from_start',
    offsetDays: normalizeOffsetDays(policy?.offsetDays),
  };
}

function cloneTemplateStep(step: PlaybookTemplateStep, index: number): PlaybookTemplateStep {
  const next: PlaybookTemplateStep = {
    id: step.id,
    title: step.title.trim(),
    stepType: VALID_STEP_TYPES.includes(step.stepType) ? step.stepType : 'task',
    order: index + 1,
    duePolicy: cloneDuePolicy(step.duePolicy),
  };
  if (step.description?.trim()) next.description = step.description.trim();
  if (step.priority && VALID_PRIORITIES.includes(step.priority)) next.priority = step.priority;
  if (step.suggestedChannel && VALID_CHANNELS.includes(step.suggestedChannel)) {
    next.suggestedChannel = step.suggestedChannel;
  }
  return next;
}

export function cloneTemplate(template: PlaybookTemplate): PlaybookTemplate {
  return {
    ...template,
    steps: template.steps.map((s, idx) => cloneTemplateStep(s, idx)),
  };
}

export function getAllAvailablePlaybookTemplates(
  customTemplates: PlaybookTemplate[],
  currentUserId?: string
): PlaybookTemplate[] {
  const builtins = BUILTIN_PLAYBOOK_TEMPLATES.map((t) => cloneTemplate(t));
  const custom = (customTemplates || [])
    .filter((t) => !t.isSystemTemplate && isOwnedByCurrentUser(t.userId, currentUserId))
    .map((t) => cloneTemplate(t))
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

  return [...builtins, ...custom];
}

export function findPlaybookTemplateById(
  templateId: string,
  customTemplates: PlaybookTemplate[],
  currentUserId?: string
): PlaybookTemplate | undefined {
  const builtin = BUILTIN_PLAYBOOK_TEMPLATES.find((t) => t.id === templateId);
  if (builtin) return cloneTemplate(builtin);
  const custom = (customTemplates || []).find(
    (t) => t.id === templateId && isOwnedByCurrentUser(t.userId, currentUserId)
  );
  return custom ? cloneTemplate(custom) : undefined;
}

// =========================================================================
// Template Validation, Creation, Cloning & Reordering
// =========================================================================

export interface PlaybookTemplateValidationResult {
  valid: boolean;
  errorAr?: string;
}

export function validatePlaybookTemplateInput(input: {
  name: string;
  description?: string;
  category?: PlaybookCategory;
  steps: PlaybookTemplateStep[];
}): PlaybookTemplateValidationResult {
  const trimmedName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!trimmedName) {
    return { valid: false, errorAr: 'عنوان القالب مطلوب ولا يمكن تركه فارغًا.' };
  }
  if (trimmedName.length > 160) {
    return { valid: false, errorAr: 'عنوان القالب يتجاوز الحد الأقصى المسموح (160 حرفًا).' };
  }

  if (typeof input.description === 'string' && input.description.trim().length > 2000) {
    return { valid: false, errorAr: 'وصف القالب يتجاوز الحد الأقصى المسموح (2000 حرف).' };
  }

  if (input.category && !VALID_CATEGORIES.includes(input.category)) {
    return { valid: false, errorAr: 'تصنيف القالب غير معتمد.' };
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return { valid: false, errorAr: 'يجب أن يحتوي القالب على خطوة واحدة على الأقل.' };
  }

  if (input.steps.length > MAX_PLAYBOOK_STEPS) {
    return {
      valid: false,
      errorAr: `الحد الأقصى لعدد الخطوات في القالب هو ${MAX_PLAYBOOK_STEPS} خطوة.`,
    };
  }

  const seenStepIds = new Set<string>();
  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    if (!step || typeof step !== 'object') {
      return { valid: false, errorAr: `بيانات الخطوة رقم ${i + 1} غير صالحة.` };
    }
    if (!isValidPlaybookId(step.id)) {
      return {
        valid: false,
        errorAr: `معرف الخطوة رقم ${i + 1} غير صالح؛ يجب أن يكون معرفًا مستقرًا صالحًا.`,
      };
    }
    if (seenStepIds.has(step.id)) {
      return {
        valid: false,
        errorAr: `توجد معرفات خطوات مكررة داخل القالب (${step.id}).`,
      };
    }
    seenStepIds.add(step.id);

    const stepTitle = typeof step.title === 'string' ? step.title.trim() : '';
    if (!stepTitle) {
      return { valid: false, errorAr: `عنوان الخطوة رقم ${i + 1} مطلوب.` };
    }
    if (stepTitle.length > 200) {
      return {
        valid: false,
        errorAr: `عنوان الخطوة رقم ${i + 1} يتجاوز الحد الأقصى (200 حرف).`,
      };
    }
    if (typeof step.description === 'string' && step.description.trim().length > 1500) {
      return {
        valid: false,
        errorAr: `وصف الخطوة رقم ${i + 1} يتجاوز الحد الأقصى (1500 حرف).`,
      };
    }
    if (!VALID_STEP_TYPES.includes(step.stepType)) {
      return { valid: false, errorAr: `نوع الخطوة رقم ${i + 1} غير معتمد.` };
    }
    if (!step.duePolicy || !VALID_DUE_POLICY_TYPES.includes(step.duePolicy.type)) {
      return { valid: false, errorAr: `سياسة الموعد النسبي للخطوة رقم ${i + 1} غير صالحة.` };
    }
    if (
      typeof step.duePolicy.offsetDays !== 'number' ||
      !Number.isFinite(step.duePolicy.offsetDays) ||
      !Number.isInteger(step.duePolicy.offsetDays) ||
      step.duePolicy.offsetDays < 0 ||
      step.duePolicy.offsetDays > MAX_PLAYBOOK_OFFSET_DAYS
    ) {
      return {
        valid: false,
        errorAr: `عدد الأيام للخطوة رقم ${i + 1} يجب أن يكون عددًا صحيحًا بين 0 و${MAX_PLAYBOOK_OFFSET_DAYS}.`,
      };
    }
  }

  return { valid: true };
}

export function reorderPlaybookTemplateSteps(
  steps: PlaybookTemplateStep[],
  fromIndex: number,
  toIndex: number
): PlaybookTemplateStep[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= steps.length ||
    toIndex >= steps.length ||
    fromIndex === toIndex
  ) {
    return steps.map((s, idx) => cloneTemplateStep(s, idx));
  }
  const copy = [...steps];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy.map((s, idx) => cloneTemplateStep(s, idx));
}

export function createCustomPlaybookTemplate(params: {
  id?: string;
  userId?: string;
  name: string;
  description?: string;
  category?: PlaybookCategory;
  steps: PlaybookTemplateStep[];
  nowIso?: string;
}): { ok: boolean; template?: PlaybookTemplate; errorAr?: string } {
  const nowIso = params.nowIso || new Date().toISOString();
  const id = params.id || generateStablePlaybookId('pbtpl');
  if (!isValidPlaybookId(id)) {
    return { ok: false, errorAr: 'معرف القالب غير صالح.' };
  }

  const normalizedSteps = (params.steps || []).map((step, idx) => cloneTemplateStep(step, idx));
  const category: PlaybookCategory =
    params.category && VALID_CATEGORIES.includes(params.category) ? params.category : 'custom';

  const validation = validatePlaybookTemplateInput({
    name: params.name,
    description: params.description,
    category,
    steps: normalizedSteps,
  });
  if (!validation.valid) {
    return { ok: false, errorAr: validation.errorAr };
  }

  const template: PlaybookTemplate = {
    id,
    name: params.name.trim(),
    category,
    steps: normalizedSteps,
    isSystemTemplate: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (params.userId) template.userId = params.userId;
  if (params.description?.trim()) template.description = params.description.trim();

  return { ok: true, template };
}

export function updateCustomPlaybookTemplate(params: {
  existingTemplate: PlaybookTemplate;
  name?: string;
  description?: string;
  category?: PlaybookCategory;
  steps?: PlaybookTemplateStep[];
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; template?: PlaybookTemplate; errorAr?: string } {
  const { existingTemplate, currentUserId, nowIso = new Date().toISOString() } = params;
  if (existingTemplate.isSystemTemplate) {
    return {
      ok: false,
      errorAr:
        'لا يمكن تعديل القالب المدمج مباشرة. استخدم خيار «إنشاء نسخة قابلة للتعديل» لعمل نسخة مخصصة.',
    };
  }
  if (!isOwnedByCurrentUser(existingTemplate.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية تعديل هذا القالب.' };
  }

  const nextName = params.name !== undefined ? params.name : existingTemplate.name;
  const nextDescription =
    params.description !== undefined ? params.description : existingTemplate.description;
  const nextCategory = params.category ?? existingTemplate.category;
  const nextSteps = (params.steps ?? existingTemplate.steps).map((s, idx) =>
    cloneTemplateStep(s, idx)
  );

  const validation = validatePlaybookTemplateInput({
    name: nextName,
    description: nextDescription,
    category: nextCategory,
    steps: nextSteps,
  });
  if (!validation.valid) {
    return { ok: false, errorAr: validation.errorAr };
  }

  const updated: PlaybookTemplate = {
    ...existingTemplate,
    name: nextName.trim(),
    category: nextCategory,
    steps: nextSteps,
    isSystemTemplate: false,
    updatedAt: nowIso,
  };
  if (nextDescription?.trim()) {
    updated.description = nextDescription.trim();
  } else {
    delete updated.description;
  }
  return { ok: true, template: updated };
}

export function clonePlaybookTemplateToCustom(params: {
  sourceTemplate: PlaybookTemplate;
  userId?: string;
  newId?: string;
  newName?: string;
  nowIso?: string;
}): { ok: boolean; template?: PlaybookTemplate; errorAr?: string } {
  const { sourceTemplate, userId, nowIso = new Date().toISOString() } = params;
  const clonedSteps: PlaybookTemplateStep[] = sourceTemplate.steps.map((s, idx) => ({
    ...cloneTemplateStep(s, idx),
    id: generateStablePlaybookId(`step${idx + 1}`),
  }));

  return createCustomPlaybookTemplate({
    id: params.newId,
    userId,
    name: params.newName?.trim() || `نسخة من: ${sourceTemplate.name}`,
    description: sourceTemplate.description,
    category: sourceTemplate.category,
    steps: clonedSteps,
    nowIso,
  });
}

// =========================================================================
// Relative Due Date Engine (Calendar-Safe via followUpEngine.ts)
// =========================================================================

export function resolvePlaybookStartDateKey(run: Pick<PlaybookRun, 'startDateKey' | 'startedAt'>, timeZone?: string): string {
  if (run.startDateKey && parseDateOnlyString(run.startDateKey)) {
    return run.startDateKey;
  }
  const parts = resolveCalendarParts(run.startedAt, timeZone);
  if (parts) {
    return formatCalendarDateKey(parts);
  }
  return getTodayCalendarKey(new Date(), timeZone);
}

export function computeStepDueDateForRun(params: {
  step: PlaybookRunStep;
  stepIndex: number;
  allSteps: PlaybookRunStep[];
  runStartDateKey: string;
  timeZone?: string;
}): string | undefined {
  const { step, stepIndex, allSteps, runStartDateKey, timeZone } = params;
  const policy = step.duePolicy || { type: 'from_start', offsetDays: 0 };
  const offset = normalizeOffsetDays(policy.offsetDays);

  if (policy.type === 'from_start') {
    return addCalendarDaysToKey(runStartDateKey, offset);
  }

  // after_previous_completion
  if (stepIndex === 0) {
    return addCalendarDaysToKey(runStartDateKey, offset);
  }

  const prevStep = allSteps[stepIndex - 1];
  if (!prevStep || prevStep.status !== 'completed' || !prevStep.completedAt) {
    return undefined;
  }

  const prevParts = resolveCalendarParts(prevStep.completedAt, timeZone);
  if (!prevParts) {
    return undefined;
  }
  const prevCompletionDateKey = formatCalendarDateKey(prevParts);
  return addCalendarDaysToKey(prevCompletionDateKey, offset);
}

export function previewTemplateStepDueDates(params: {
  steps: PlaybookTemplateStep[];
  startDateKey: string;
}): Array<{ stepId: string; dueDate?: string; labelAr: string }> {
  const validStart = parseDateOnlyString(params.startDateKey)
    ? params.startDateKey
    : getTodayCalendarKey();

  return params.steps.map((step, idx) => {
    const offset = normalizeOffsetDays(step.duePolicy?.offsetDays);
    if (step.duePolicy?.type === 'from_start') {
      const dueDate = addCalendarDaysToKey(validStart, offset);
      return {
        stepId: step.id,
        dueDate,
        labelAr: dueDate,
      };
    }
    if (idx === 0) {
      const dueDate = addCalendarDaysToKey(validStart, offset);
      return { stepId: step.id, dueDate, labelAr: dueDate };
    }
    return {
      stepId: step.id,
      dueDate: undefined,
      labelAr: STEP_DEPENDENCY_PLACEHOLDER_AR,
    };
  });
}

// =========================================================================
// Playbook Run Lifecycle & Pre-Start Validation
// =========================================================================

export function findMatchingActivePlaybookRuns(params: {
  existingRuns: PlaybookRun[];
  templateId?: string;
  clientId: string;
  opportunityId?: string;
  currentUserId?: string;
}): PlaybookRun[] {
  const { existingRuns, templateId, clientId, opportunityId, currentUserId } = params;
  return (existingRuns || []).filter((r) => {
    if (!isOwnedByCurrentUser(r.userId, currentUserId)) return false;
    if (r.status !== 'active') return false;
    if (r.clientId !== clientId) return false;
    if (templateId && r.templateId !== templateId) return false;
    if (opportunityId) {
      return r.opportunityId === opportunityId;
    }
    return !r.opportunityId;
  });
}

export interface StartPlaybookRunParams {
  id?: string;
  userId?: string;
  template: PlaybookTemplate;
  templateNameOverride?: string;
  client: Client | undefined;
  opportunity?: Opportunity;
  startDateKey?: string;
  customizedSteps?: PlaybookTemplateStep[];
  existingRuns?: PlaybookRun[];
  confirmDuplicate?: boolean;
  nowIso?: string;
  timeZone?: string;
}

export interface StartPlaybookRunResult {
  ok: boolean;
  code?:
    | 'CLIENT_NOT_FOUND'
    | 'USER_MISMATCH'
    | 'OPPORTUNITY_CLIENT_MISMATCH'
    | 'INVALID_START_DATE'
    | 'INVALID_STEPS'
    | 'DUPLICATE_ACTIVE_RUN_CONFIRMATION_REQUIRED';
  requiresDuplicateConfirmation?: boolean;
  duplicateRuns?: PlaybookRun[];
  run?: PlaybookRun;
  errorAr?: string;
}

export function startPlaybookRun(params: StartPlaybookRunParams): StartPlaybookRunResult {
  const nowIso = params.nowIso || new Date().toISOString();
  const { template, client, opportunity, userId, timeZone } = params;

  if (!client) {
    return {
      ok: false,
      code: 'CLIENT_NOT_FOUND',
      errorAr: 'العميل المختار غير موجود ضمن سجلاتك.',
    };
  }

  if (!isOwnedByCurrentUser(client.userId, userId)) {
    return {
      ok: false,
      code: 'USER_MISMATCH',
      errorAr: 'لا يمكن بدء خطة متابعة لعميل لا يخص المستخدم الحالي.',
    };
  }

  if (opportunity) {
    if (!isOwnedByCurrentUser(opportunity.userId, userId)) {
      return {
        ok: false,
        code: 'USER_MISMATCH',
        errorAr: 'الفرصة المختارة لا تخص المستخدم الحالي.',
      };
    }
    if (opportunity.clientId !== client.id) {
      return {
        ok: false,
        code: 'OPPORTUNITY_CLIENT_MISMATCH',
        errorAr: 'لا يمكن ربط الخطة بفرصة أعمال تخص عميلًا آخر.',
      };
    }
  }

  const startDateKey =
    params.startDateKey && params.startDateKey.trim()
      ? params.startDateKey.trim()
      : getTodayCalendarKey(new Date(nowIso), timeZone);

  if (!parseDateOnlyString(startDateKey)) {
    return {
      ok: false,
      code: 'INVALID_START_DATE',
      errorAr: 'تاريخ بداية الخطة يجب أن يكون بصيغة YYYY-MM-DD صحيحة.',
    };
  }

  const rawSteps = (params.customizedSteps ?? template.steps).map((s, idx) =>
    cloneTemplateStep(s, idx)
  );
  const runName = (params.templateNameOverride ?? template.name).trim();
  const validation = validatePlaybookTemplateInput({
    name: runName,
    category: template.category,
    steps: rawSteps,
  });
  if (!validation.valid) {
    return {
      ok: false,
      code: 'INVALID_STEPS',
      errorAr: validation.errorAr,
    };
  }

  if (!params.confirmDuplicate && params.existingRuns && params.existingRuns.length > 0) {
    const duplicateRuns = findMatchingActivePlaybookRuns({
      existingRuns: params.existingRuns,
      templateId: template.id,
      clientId: client.id,
      opportunityId: opportunity?.id,
      currentUserId: userId,
    });
    if (duplicateRuns.length > 0) {
      return {
        ok: false,
        code: 'DUPLICATE_ACTIVE_RUN_CONFIRMATION_REQUIRED',
        requiresDuplicateConfirmation: true,
        duplicateRuns,
        errorAr:
          'توجد خطة نشطة بالفعل من نفس القالب لهذا العميل والفرصة. هل تريد بالتأكيد إنشاء خطة ثانية؟',
      };
    }
  }

  const runId = params.id || generateStablePlaybookId('pbrun');
  if (!isValidPlaybookId(runId)) {
    return {
      ok: false,
      code: 'INVALID_STEPS',
      errorAr: 'معرف الخطة غير صالح.',
    };
  }

  // Deep-clone template steps into independent run snapshot (no runtime dependency on template)
  const snapshotSteps: PlaybookRunStep[] = rawSteps.map((tplStep, idx) => {
    const runStep: PlaybookRunStep = {
      id: tplStep.id,
      title: tplStep.title,
      stepType: tplStep.stepType,
      order: idx + 1,
      status: 'pending',
      duePolicy: cloneDuePolicy(tplStep.duePolicy),
    };
    if (tplStep.description) runStep.description = tplStep.description;
    if (tplStep.priority) runStep.priority = tplStep.priority;
    if (tplStep.suggestedChannel) runStep.suggestedChannel = tplStep.suggestedChannel;
    return runStep;
  });

  // Compute initial due dates (from_start resolved immediately; after_previous_completion stays undefined)
  for (let i = 0; i < snapshotSteps.length; i++) {
    const due = computeStepDueDateForRun({
      step: snapshotSteps[i],
      stepIndex: i,
      allSteps: snapshotSteps,
      runStartDateKey: startDateKey,
      timeZone,
    });
    if (due) {
      snapshotSteps[i].dueDate = due;
    }
  }

  const run: PlaybookRun = {
    id: runId,
    templateId: template.id,
    templateName: runName,
    clientId: client.id,
    status: 'active',
    steps: snapshotSteps,
    startDateKey,
    startedAt: nowIso,
    updatedAt: nowIso,
    revision: 1,
  };
  if (userId) run.userId = userId;
  if (opportunity) run.opportunityId = opportunity.id;

  return { ok: true, run };
}

export interface StepMutationResult {
  ok: boolean;
  run?: PlaybookRun;
  rescheduleSuggestions: PlaybookRescheduleSuggestion[];
  errorAr?: string;
}

export function startPlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  currentUserId?: string;
  nowIso?: string;
}): StepMutationResult {
  const { run, stepId, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (run.status !== 'active') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'لا يمكن بدء خطوة إلا في خطة نشطة.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const step = run.steps[idx];
  if (step.status === 'completed' || step.status === 'skipped') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'تم إغلاق هذه الخطوة مسبقًا؛ أعد فتحها أولًا إذا أردت العمل عليها مجددًا.',
    };
  }

  const nextSteps = run.steps.map((s, i) =>
    i === idx
      ? {
          ...s,
          status: 'in_progress' as PlaybookStepStatus,
          startedAt: s.startedAt || nowIso,
        }
      : s
  );

  return {
    ok: true,
    rescheduleSuggestions: [],
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function completePlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  completionMethod?: PlaybookStepCompletionMethod;
  note?: string;
  linkedTaskId?: string;
  linkedInteractionId?: string;
  tasks?: ActionItem[];
  currentUserId?: string;
  completedAtIso?: string;
  timeZone?: string;
}): StepMutationResult {
  const {
    run,
    stepId,
    completionMethod = 'manual',
    note,
    linkedTaskId,
    linkedInteractionId,
    tasks = [],
    currentUserId,
    completedAtIso = new Date().toISOString(),
    timeZone,
  } = params;

  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (run.status !== 'active') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'يجب أن تكون الخطة نشطة لإكمال الخطوات.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const startDateKey = resolvePlaybookStartDateKey(run, timeZone);
  const nextSteps: PlaybookRunStep[] = run.steps.map((s) => ({ ...s, duePolicy: cloneDuePolicy(s.duePolicy) }));

  const target = nextSteps[idx];
  target.status = 'completed';
  target.startedAt = target.startedAt || completedAtIso;
  target.completedAt = completedAtIso;
  target.completionMethod = completionMethod;
  delete target.skippedAt;
  if (linkedTaskId) target.linkedTaskId = linkedTaskId;
  if (linkedInteractionId) target.linkedInteractionId = linkedInteractionId;
  if (note !== undefined) {
    if (note.trim()) target.note = note.trim().slice(0, 1000);
    else delete target.note;
  }

  // Recompute subsequent step(s) relying on after_previous_completion WITHOUT silently modifying linked tasks
  const rescheduleSuggestions: PlaybookRescheduleSuggestion[] = [];
  const tasksById = new Map<string, ActionItem>();
  for (const t of tasks) tasksById.set(t.id, t);

  if (idx + 1 < nextSteps.length) {
    const nextStep = nextSteps[idx + 1];
    if (
      nextStep.duePolicy?.type === 'after_previous_completion' &&
      (nextStep.status === 'pending' || nextStep.status === 'in_progress')
    ) {
      const suggestedDate = computeStepDueDateForRun({
        step: nextStep,
        stepIndex: idx + 1,
        allSteps: nextSteps,
        runStartDateKey: startDateKey,
        timeZone,
      });

      if (suggestedDate) {
        const linkedTask = nextStep.linkedTaskId ? tasksById.get(nextStep.linkedTaskId) : undefined;
        if (linkedTask && linkedTask.dueDate && linkedTask.dueDate !== suggestedDate) {
          // NEVER silently change a linked task's stored dueDate — emit suggestion requiring user approval
          rescheduleSuggestions.push({
            runId: run.id,
            stepId: nextStep.id,
            stepTitle: nextStep.title,
            linkedTaskId: linkedTask.id,
            currentTaskDueDate: linkedTask.dueDate,
            suggestedDueDate: suggestedDate,
            reasonAr: `بعد إكمال «${target.title}»، الموعد المقترح للخطوة التالية «${nextStep.title}» هو ${suggestedDate} بدلًا من ${linkedTask.dueDate}.`,
          });
        } else {
          nextStep.dueDate = suggestedDate;
        }
      }
    }
  }

  return {
    ok: true,
    rescheduleSuggestions,
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: completedAtIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function skipPlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  note?: string;
  currentUserId?: string;
  nowIso?: string;
}): StepMutationResult {
  const { run, stepId, note, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (run.status !== 'active') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'لا يمكن تجاوز خطوة في خطة غير نشطة.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const nextSteps: PlaybookRunStep[] = run.steps.map((s, i) => {
    if (i !== idx) return s;
    const updated: PlaybookRunStep = {
      ...s,
      status: 'skipped',
      skippedAt: nowIso,
    };
    delete updated.completedAt;
    delete updated.completionMethod;
    if (note !== undefined) {
      if (note.trim()) updated.note = note.trim().slice(0, 1000);
      else delete updated.note;
    }
    return updated;
  });

  return {
    ok: true,
    rescheduleSuggestions: [],
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function reopenPlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  currentUserId?: string;
  nowIso?: string;
}): StepMutationResult {
  const { run, stepId, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (run.status !== 'active') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'لا يمكن إعادة فتح خطوة إلا في خطة نشطة.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const nextSteps = run.steps.map((s, i) => {
    if (i !== idx) return s;
    const updated: PlaybookRunStep = {
      ...s,
      status: s.startedAt ? 'in_progress' : 'pending',
    };
    delete updated.completedAt;
    delete updated.skippedAt;
    delete updated.completionMethod;
    return updated;
  });

  return {
    ok: true,
    rescheduleSuggestions: [],
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function updatePlaybookStepDueDate(params: {
  run: PlaybookRun;
  stepId: string;
  dueDate: string | undefined;
  currentUserId?: string;
  nowIso?: string;
}): StepMutationResult {
  const { run, stepId, dueDate, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (run.status === 'cancelled' || run.status === 'completed') {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'لا يمكن تعديل موعد خطوة في خطة منتهية أو ملغاة.',
    };
  }

  if (dueDate !== undefined && dueDate !== '' && !parseDateOnlyString(dueDate)) {
    return {
      ok: false,
      rescheduleSuggestions: [],
      errorAr: 'صيغة التاريخ يجب أن تكون YYYY-MM-DD صحيحة.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, rescheduleSuggestions: [], errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const cleanDate = dueDate?.trim() || undefined;
  const nextSteps = run.steps.map((s, i) => {
    if (i !== idx) return s;
    const next = { ...s };
    if (cleanDate) next.dueDate = cleanDate;
    else delete next.dueDate;
    return next;
  });

  return {
    ok: true,
    rescheduleSuggestions: [],
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function pausePlaybookRun(params: {
  run: PlaybookRun;
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; run?: PlaybookRun; errorAr?: string } {
  const { run, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية إيقاف هذه الخطة.' };
  }
  if (run.status !== 'active') {
    return { ok: false, errorAr: 'يمكن إيقاف الخطة النشطة مؤقتًا فقط.' };
  }
  return {
    ok: true,
    run: {
      ...run,
      status: 'paused',
      pausedAt: nowIso,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

export function resumePlaybookRun(params: {
  run: PlaybookRun;
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; run?: PlaybookRun; errorAr?: string } {
  const { run, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية استئناف هذه الخطة.' };
  }
  if (run.status !== 'paused') {
    return { ok: false, errorAr: 'يمكن استئناف الخطط المتوقفة مؤقتًا فقط.' };
  }
  // Explicitly preserve all existing step dueDates & linked tasks without silent rescheduling
  const resumed: PlaybookRun = {
    ...run,
    status: 'active',
    updatedAt: nowIso,
    revision: (run.revision ?? 0) + 1,
  };
  delete resumed.pausedAt;
  return { ok: true, run: resumed };
}

export function cancelPlaybookRun(params: {
  run: PlaybookRun;
  confirmed: boolean;
  cancelReason?: string;
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; run?: PlaybookRun; errorAr?: string } {
  const { run, confirmed, cancelReason, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!confirmed) {
    return {
      ok: false,
      errorAr: 'يتطلب إلغاء الخطة تأكيدًا صريحًا من المستخدم.',
    };
  }
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية إلغاء هذه الخطة.' };
  }
  if (run.status === 'cancelled' || run.status === 'completed') {
    return { ok: false, errorAr: 'هذه الخطة منتهية أو ملغاة بالفعل.' };
  }
  const cancelled: PlaybookRun = {
    ...run,
    status: 'cancelled',
    cancelledAt: nowIso,
    updatedAt: nowIso,
    revision: (run.revision ?? 0) + 1,
  };
  if (cancelReason?.trim()) {
    cancelled.cancelReason = cancelReason.trim().slice(0, 500);
  }
  return { ok: true, run: cancelled };
}

export function completePlaybookRun(params: {
  run: PlaybookRun;
  confirmed: boolean;
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; run?: PlaybookRun; errorAr?: string } {
  const { run, confirmed, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!confirmed) {
    return {
      ok: false,
      errorAr: 'يتطلب إنهاء الخطة تأكيدًا صريحًا من المستخدم.',
    };
  }
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية إنهاء هذه الخطة.' };
  }
  if (run.status === 'cancelled' || run.status === 'completed') {
    return { ok: false, errorAr: 'هذه الخطة منتهية أو ملغاة بالفعل.' };
  }
  const completed: PlaybookRun = {
    ...run,
    status: 'completed',
    completedAt: nowIso,
    updatedAt: nowIso,
    revision: (run.revision ?? 0) + 1,
  };
  delete completed.pausedAt;
  return { ok: true, run: completed };
}

// =========================================================================
// Honest Progress & Step Cursor Helpers (Requirement L)
// =========================================================================

export function computePlaybookRunProgress(run: PlaybookRun): PlaybookProgressMetrics {
  const steps = run.steps || [];
  const totalStepsCount = steps.length;
  let completedStepsCount = 0;
  let skippedStepsCount = 0;
  let inProgressStepsCount = 0;
  let pendingStepsCount = 0;

  for (const step of steps) {
    if (step.status === 'completed') completedStepsCount += 1;
    else if (step.status === 'skipped') skippedStepsCount += 1;
    else if (step.status === 'in_progress') inProgressStepsCount += 1;
    else pendingStepsCount += 1;
  }

  const actionableRemainingCount = inProgressStepsCount + pendingStepsCount;
  // Skipped steps are NEVER counted as completed
  const completionRatio = totalStepsCount > 0 ? completedStepsCount / totalStepsCount : 0;
  const completionPercent =
    totalStepsCount > 0 ? Math.round((completedStepsCount / totalStepsCount) * 100) : 0;

  return {
    totalStepsCount,
    completedStepsCount,
    skippedStepsCount,
    inProgressStepsCount,
    pendingStepsCount,
    actionableRemainingCount,
    completionRatio,
    completionPercent,
    isReadyToFinish: run.status === 'active' && actionableRemainingCount === 0,
  };
}

export function getPlaybookRunStepPointers(run: PlaybookRun): {
  currentStep: PlaybookRunStep | null;
  nextStep: PlaybookRunStep | null;
  nextFollowUpDate: string | null;
} {
  const ordered = [...(run.steps || [])].sort((a, b) => a.order - b.order);
  const inProgress = ordered.find((s) => s.status === 'in_progress') || null;
  const firstPending = ordered.find((s) => s.status === 'pending') || null;
  const currentStep = inProgress || firstPending;

  let nextStep: PlaybookRunStep | null = null;
  if (currentStep) {
    nextStep =
      ordered.find(
        (s) =>
          s.id !== currentStep.id &&
          s.order > currentStep.order &&
          (s.status === 'pending' || s.status === 'in_progress')
      ) || null;
  }

  const withDates = ordered
    .filter((s) => (s.status === 'pending' || s.status === 'in_progress') && Boolean(s.dueDate))
    .sort((a, b) => {
      const dateCmp = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (dateCmp !== 0) return dateCmp;
      return a.order - b.order;
    });

  return {
    currentStep,
    nextStep,
    nextFollowUpDate: withDates[0]?.dueDate || null,
  };
}

// =========================================================================
// Task Linking & Atomic Anti-Duplication Coordinator (Requirements I & J)
// =========================================================================

function fnv1aHex8(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeIdSegment(raw: string, maxLen: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, maxLen) || 'x';
}

/**
 * Produces a deterministic, Firestore-safe task ID (< 128 chars, [a-zA-Z0-9_-])
 * uniquely bound to (playbookRunId, playbookStepId).
 */
export function buildPlaybookStepTaskId(runId: string, stepId: string): string {
  const digest = fnv1aHex8(`${runId}::${stepId}`);
  const runPart = sanitizeIdSegment(runId, 44);
  const stepPart = sanitizeIdSegment(stepId, 44);
  return `pbt_${digest}_${runPart}_${stepPart}`.slice(0, 128);
}

export function canLinkExistingTaskToPlaybookStep(params: {
  task: ActionItem;
  run: PlaybookRun;
  stepId: string;
  allRuns: PlaybookRun[];
  currentUserId?: string;
}): { ok: boolean; errorAr?: string } {
  const { task, run, stepId, allRuns, currentUserId } = params;
  if (!isOwnedByCurrentUser(task.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية ربط هذه المهمة.' };
  }
  if (task.clientId !== run.clientId) {
    return { ok: false, errorAr: 'لا يمكن ربط مهمة تخص عميلًا مختلفًا عن عميل الخطة.' };
  }
  if (run.opportunityId && task.opportunityId && task.opportunityId !== run.opportunityId) {
    return { ok: false, errorAr: 'هذه المهمة مرتبطة بفرصة أعمال مختلفة.' };
  }
  if (
    task.playbookRunId &&
    (task.playbookRunId !== run.id || (task.playbookStepId && task.playbookStepId !== stepId))
  ) {
    return { ok: false, errorAr: 'هذه المهمة مرتبطة بالفعل بخطوة في خطة متابعة أخرى.' };
  }
  for (const otherRun of allRuns) {
    for (const s of otherRun.steps || []) {
      if (s.linkedTaskId === task.id && !(otherRun.id === run.id && s.id === stepId)) {
        return { ok: false, errorAr: 'هذه المهمة مرتبطة بالفعل بخطوة متابعة أخرى.' };
      }
    }
  }
  return { ok: true };
}

export function linkExistingTaskToPlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  task: ActionItem;
  allRuns: PlaybookRun[];
  currentUserId?: string;
  nowIso?: string;
}): { ok: boolean; run?: PlaybookRun; updatedTask?: ActionItem; errorAr?: string } {
  const { run, stepId, task, allRuns, currentUserId, nowIso = new Date().toISOString() } = params;
  const check = canLinkExistingTaskToPlaybookStep({
    task,
    run,
    stepId,
    allRuns,
    currentUserId,
  });
  if (!check.ok) {
    return { ok: false, errorAr: check.errorAr };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, errorAr: 'الخطوة المطلوبة غير موجودة.' };
  }

  const nextSteps = run.steps.map((s, i) =>
    i === idx
      ? {
          ...s,
          linkedTaskId: task.id,
        }
      : s
  );

  // Preserve existing task fields (title, description, dueDate, priority, status) completely intact
  const updatedTask: ActionItem = {
    ...task,
    playbookRunId: run.id,
    playbookStepId: stepId,
  };
  if (run.opportunityId && !updatedTask.opportunityId) {
    updatedTask.opportunityId = run.opportunityId;
  }

  return {
    ok: true,
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
    updatedTask,
  };
}

export interface AtomicStepTaskCreationInput {
  userId: string;
  runId: string;
  stepId: string;
  deterministicTaskId: string;
  expectedRunRevision?: number;
  title: string;
  description?: string;
  dueDate?: string;
  priority: TaskPriority;
  nowIso: string;
}

export interface AtomicStepTaskCreationOutcome {
  ok: boolean;
  code?:
    | 'OFFLINE_BLOCKED'
    | 'RUN_NOT_FOUND'
    | 'STEP_NOT_FOUND'
    | 'RUN_NOT_ACTIVE'
    | 'USER_MISMATCH'
    | 'REVISION_CONFLICT'
    | 'STEP_ALREADY_LINKED_DIFFERENT_TASK'
    | 'TRANSACTION_FAILED';
  alreadyExisted?: boolean;
  task?: ActionItem;
  run?: PlaybookRun;
  draftTask?: ActionItem;
  errorAr?: string;
}

export interface PlaybookAtomicPersistencePort {
  runAtomicStepToTask(input: AtomicStepTaskCreationInput): Promise<AtomicStepTaskCreationOutcome>;
}

/**
 * Coordinates atomic creation of an ActionItem from a PlaybookRunStep.
 * - Requires online connectivity (refuses to mint uncoordinated offline duplicates).
 * - Uses deterministic task ID (`buildPlaybookStepTaskId`) + backend transaction.
 * - On retry or concurrent race where the deterministic task already exists,
 *   NEVER overwrites user-modified fields on that existing task.
 */
export async function executeAtomicStepTaskConversion(
  params: {
    userId: string;
    run: PlaybookRun;
    stepId: string;
    isOnline: boolean;
    titleOverride?: string;
    descriptionOverride?: string;
    dueDateOverride?: string;
    priorityOverride?: TaskPriority;
    nowIso?: string;
  },
  port: PlaybookAtomicPersistencePort
): Promise<AtomicStepTaskCreationOutcome> {
  const { run, stepId, userId, isOnline, nowIso = new Date().toISOString() } = params;

  if (!isOwnedByCurrentUser(run.userId, userId)) {
    return {
      ok: false,
      code: 'USER_MISMATCH',
      errorAr: 'لا تملك صلاحية إنشاء مهمة من هذه الخطة.',
    };
  }

  if (run.status !== 'active') {
    return {
      ok: false,
      code: 'RUN_NOT_ACTIVE',
      errorAr: 'لا يمكن تحويل خطوة إلى مهمة إلا عندما تكون الخطة نشطة.',
    };
  }

  const step = run.steps.find((s) => s.id === stepId);
  if (!step) {
    return {
      ok: false,
      code: 'STEP_NOT_FOUND',
      errorAr: 'الخطوة المحددة غير موجودة داخل الخطة.',
    };
  }

  const deterministicTaskId = buildPlaybookStepTaskId(run.id, step.id);
  const title = (params.titleOverride ?? step.title).trim().slice(0, 200) || step.title;
  const description = (params.descriptionOverride ?? step.description)?.trim().slice(0, 2000);
  const dueDate =
    params.dueDateOverride !== undefined
      ? parseDateOnlyString(params.dueDateOverride)
        ? params.dueDateOverride
        : undefined
      : step.dueDate;
  const priority: TaskPriority =
    params.priorityOverride && VALID_PRIORITIES.includes(params.priorityOverride)
      ? params.priorityOverride
      : step.priority && VALID_PRIORITIES.includes(step.priority)
      ? step.priority
      : 'medium';

  const draftTask: ActionItem = {
    id: deterministicTaskId,
    userId,
    clientId: run.clientId,
    playbookRunId: run.id,
    playbookStepId: step.id,
    title,
    priority,
    status: 'pending',
    createdAt: nowIso,
  };
  if (run.opportunityId) draftTask.opportunityId = run.opportunityId;
  if (description) draftTask.description = description;
  if (dueDate) draftTask.dueDate = dueDate;

  if (!isOnline) {
    return {
      ok: false,
      code: 'OFFLINE_BLOCKED',
      draftTask,
      errorAr:
        'تعذر تنفيذ إنشاء المهمة المرتبطة بالخطة ذريًا أثناء عدم الاتصال بالإنترنت لمنع التكرار عبر الأجهزة. تم حفظ المسودة مؤقتًا في الجلسة دون اعتبارها محفوظة سحابيًا، أعد المحاولة فور عودة الاتصال.',
    };
  }

  return port.runAtomicStepToTask({
    userId,
    runId: run.id,
    stepId: step.id,
    deterministicTaskId,
    expectedRunRevision: run.revision,
    title,
    description,
    dueDate,
    priority,
    nowIso,
  });
}

/**
 * Shared pure transactional state machine used by unit tests (simulating concurrent races,
 * lost responses / retries, and preserving user edits on existing tasks).
 */
export function applyAtomicStepToTaskInTransactionState(params: {
  input: AtomicStepTaskCreationInput;
  serverRun: PlaybookRun | undefined;
  serverTaskByDeterministicId: ActionItem | undefined;
  serverLinkedTask: ActionItem | undefined;
}): AtomicStepTaskCreationOutcome & { nextRunToSave?: PlaybookRun; nextTaskToCreate?: ActionItem } {
  const { input, serverRun, serverTaskByDeterministicId, serverLinkedTask } = params;

  if (!serverRun) {
    return {
      ok: false,
      code: 'RUN_NOT_FOUND',
      errorAr: 'لم يتم العثور على خطة المتابعة على الخادم.',
    };
  }

  if (serverRun.userId && serverRun.userId !== input.userId) {
    return {
      ok: false,
      code: 'USER_MISMATCH',
      errorAr: 'خطة المتابعة تخص مستخدمًا آخر.',
    };
  }

  if (serverRun.status !== 'active') {
    return {
      ok: false,
      code: 'RUN_NOT_ACTIVE',
      errorAr: 'لم تعد الخطة نشطة لتنفيذ تحويل الخطوة إلى مهمة.',
    };
  }

  const stepIndex = serverRun.steps.findIndex((s) => s.id === input.stepId);
  if (stepIndex === -1) {
    return {
      ok: false,
      code: 'STEP_NOT_FOUND',
      errorAr: 'الخطوة غير موجودة في الخطة.',
    };
  }

  const serverStep = serverRun.steps[stepIndex];

  // Case 1: The step already points to a linked task on the server -> DO NOT overwrite existing task
  if (serverStep.linkedTaskId) {
    const existingTask =
      serverLinkedTask ||
      (serverStep.linkedTaskId === input.deterministicTaskId
        ? serverTaskByDeterministicId
        : undefined);
    if (existingTask) {
      return {
        ok: true,
        alreadyExisted: true,
        task: existingTask,
        run: serverRun,
      };
    }
    if (serverStep.linkedTaskId !== input.deterministicTaskId) {
      return {
        ok: false,
        code: 'STEP_ALREADY_LINKED_DIFFERENT_TASK',
        errorAr: 'هذه الخطوة مرتبطة بالفعل بمهمة أخرى.',
      };
    }
  }

  // Case 2: Retry or concurrent race where deterministic task doc ALREADY exists on server
  // MUST return existing task WITHOUT overwriting user-modified fields on it!
  if (serverTaskByDeterministicId) {
    if (
      serverTaskByDeterministicId.userId &&
      serverTaskByDeterministicId.userId !== input.userId
    ) {
      return {
        ok: false,
        code: 'USER_MISMATCH',
        errorAr: 'تعارض ملكية المهمة الموجودة.',
      };
    }

    const needsLinkRepair = serverStep.linkedTaskId !== serverTaskByDeterministicId.id;
    let repairedRun = serverRun;
    if (needsLinkRepair) {
      const nextSteps = serverRun.steps.map((s, idx) =>
        idx === stepIndex ? { ...s, linkedTaskId: serverTaskByDeterministicId.id } : s
      );
      repairedRun = {
        ...serverRun,
        steps: nextSteps,
        updatedAt: input.nowIso,
        revision: (serverRun.revision ?? 0) + 1,
      };
    }

    return {
      ok: true,
      alreadyExisted: true,
      task: serverTaskByDeterministicId,
      run: repairedRun,
      nextRunToSave: needsLinkRepair ? repairedRun : undefined,
    };
  }

  // Optional revision guard if another incompatible edit changed the run concurrently
  if (
    typeof input.expectedRunRevision === 'number' &&
    typeof serverRun.revision === 'number' &&
    serverRun.revision > input.expectedRunRevision
  ) {
    return {
      ok: false,
      code: 'REVISION_CONFLICT',
      errorAr:
        'تم تعديل الخطة من جهاز أو تبويب آخر قبل إتمام العملية. يرجى مراجعة النسخة الأحدث ثم إعادة المحاولة.',
    };
  }

  // Case 3: Clean atomic creation
  const newTask: ActionItem = {
    id: input.deterministicTaskId,
    userId: input.userId,
    clientId: serverRun.clientId,
    playbookRunId: serverRun.id,
    playbookStepId: serverStep.id,
    title: input.title,
    priority: input.priority,
    status: 'pending',
    createdAt: input.nowIso,
  };
  if (serverRun.opportunityId) newTask.opportunityId = serverRun.opportunityId;
  if (input.description) newTask.description = input.description;
  if (input.dueDate) newTask.dueDate = input.dueDate;

  const nextSteps = serverRun.steps.map((s, idx) =>
    idx === stepIndex ? { ...s, linkedTaskId: newTask.id } : s
  );
  const nextRun: PlaybookRun = {
    ...serverRun,
    steps: nextSteps,
    updatedAt: input.nowIso,
    revision: (serverRun.revision ?? 0) + 1,
  };

  return {
    ok: true,
    alreadyExisted: false,
    task: newTask,
    run: nextRun,
    nextTaskToCreate: newTask,
    nextRunToSave: nextRun,
  };
}

/**
 * In-memory atomic adapter with simulated serialization queue for concurrency/retry tests.
 */
export function createInMemoryPlaybookAtomicAdapter(initialState: {
  runs: PlaybookRun[];
  tasks: ActionItem[];
}): PlaybookAtomicPersistencePort & {
  getRuns(): PlaybookRun[];
  getTasks(): ActionItem[];
} {
  const runsMap = new Map<string, PlaybookRun>();
  const tasksMap = new Map<string, ActionItem>();
  for (const r of initialState.runs) runsMap.set(r.id, { ...r, steps: r.steps.map((s) => ({ ...s })) });
  for (const t of initialState.tasks) tasksMap.set(t.id, { ...t });

  let tail: Promise<unknown> = Promise.resolve();

  return {
    getRuns: () => Array.from(runsMap.values()),
    getTasks: () => Array.from(tasksMap.values()),
    runAtomicStepToTask(input: AtomicStepTaskCreationInput): Promise<AtomicStepTaskCreationOutcome> {
      const job = tail.then(async () => {
        // Yield microtask to verify true async interleaving protection
        await Promise.resolve();
        const serverRun = runsMap.get(input.runId);
        const serverTaskByDet = tasksMap.get(input.deterministicTaskId);
        const linkedTaskId = serverRun?.steps.find((s) => s.id === input.stepId)?.linkedTaskId;
        const serverLinkedTask = linkedTaskId ? tasksMap.get(linkedTaskId) : undefined;

        const outcome = applyAtomicStepToTaskInTransactionState({
          input,
          serverRun,
          serverTaskByDeterministicId: serverTaskByDet,
          serverLinkedTask,
        });

        if (outcome.ok) {
          if (outcome.nextTaskToCreate) {
            tasksMap.set(outcome.nextTaskToCreate.id, { ...outcome.nextTaskToCreate });
          }
          if (outcome.nextRunToSave) {
            runsMap.set(outcome.nextRunToSave.id, {
              ...outcome.nextRunToSave,
              steps: outcome.nextRunToSave.steps.map((s) => ({ ...s })),
            });
          }
        }
        return {
          ok: outcome.ok,
          code: outcome.code,
          alreadyExisted: outcome.alreadyExisted,
          task: outcome.task,
          run: outcome.run,
          errorAr: outcome.errorAr,
        };
      });
      tail = job.catch(() => undefined);
      return job;
    },
  };
}

// =========================================================================
// Communication Integration (Requirement K)
// =========================================================================

const SUCCESSFUL_CONTACT_OUTCOMES: ReadonlySet<CommunicationOutcome> = new Set([
  'answered',
  'replied',
  'agreement_reached',
  'info_shared',
]);

export function isCommunicationOutcomeConfirmedContact(outcome: CommunicationOutcome): boolean {
  return SUCCESSFUL_CONTACT_OUTCOMES.has(outcome);
}

export function linkCommunicationToPlaybookStep(params: {
  run: PlaybookRun;
  stepId: string;
  interaction: CommunicationInteraction;
  currentUserId?: string;
  nowIso?: string;
}): {
  ok: boolean;
  run?: PlaybookRun;
  isSuccessfulContact?: boolean;
  outcomeNoticeAr?: string;
  errorAr?: string;
} {
  const { run, stepId, interaction, currentUserId, nowIso = new Date().toISOString() } = params;
  if (!isOwnedByCurrentUser(run.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية تعديل هذه الخطة.' };
  }
  if (!isOwnedByCurrentUser(interaction.userId, currentUserId)) {
    return { ok: false, errorAr: 'لا تملك صلاحية ربط سجل التواصل هذا.' };
  }
  if (interaction.clientId !== run.clientId) {
    return {
      ok: false,
      errorAr: 'لا يمكن ربط سجل تواصل يخص عميلًا آخر غير عميل خطة المتابعة.',
    };
  }

  const idx = run.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    return { ok: false, errorAr: 'الخطوة المطلوبة غير موجودة داخل الخطة.' };
  }

  const isSuccessfulContact = isCommunicationOutcomeConfirmedContact(interaction.outcome);

  // Never mark step completed automatically — especially not on no_answer / busy_or_callback!
  const nextSteps = run.steps.map((s, i) => {
    if (i !== idx) return s;
    return {
      ...s,
      linkedInteractionId: interaction.id,
      status: s.status === 'pending' ? ('in_progress' as PlaybookStepStatus) : s.status,
      startedAt: s.startedAt || nowIso,
    };
  });

  const outcomeNoticeAr =
    interaction.outcome === 'no_answer'
      ? 'تم تسجيل محاولة التواصل (لم يتم الرد) وربطها بالخطوة. لا يُعد عدم الرد تواصلًا ناجحًا ولن تُكمل الخطوة تلقائيًا.'
      : isSuccessfulContact
      ? 'تم ربط سجل التواصل بالخطوة بنجاح. يمكنك تأكيد إكمال الخطوة يدويًا عندما تكون جاهزًا.'
      : 'تم ربط سجل التواصل بالخطوة كمتابعة جارية. يمكنك إكمال الخطوة يدويًا عند تحقيق هدفها.';

  return {
    ok: true,
    isSuccessfulContact,
    outcomeNoticeAr,
    run: {
      ...run,
      steps: nextSteps,
      updatedAt: nowIso,
      revision: (run.revision ?? 0) + 1,
    },
  };
}

// =========================================================================
// Sanitization & Multi-Device Revision Conflict Detection
// =========================================================================

export function sanitizePlaybookTemplateForSave(
  template: PlaybookTemplate,
  currentUserId?: string
): PlaybookTemplate {
  const cleanSteps: PlaybookTemplateStep[] = (template.steps || [])
    .slice(0, MAX_PLAYBOOK_STEPS)
    .map((step, idx) => {
      const out: PlaybookTemplateStep = {
        id: isValidPlaybookId(step.id) ? step.id : generateStablePlaybookId(`step${idx + 1}`),
        title: clampString(step.title, 200) || `خطوة ${idx + 1}`,
        stepType: VALID_STEP_TYPES.includes(step.stepType) ? step.stepType : 'task',
        order: idx + 1,
        duePolicy: cloneDuePolicy(step.duePolicy),
      };
      const desc = clampString(step.description, 1500);
      if (desc) out.description = desc;
      if (step.priority && VALID_PRIORITIES.includes(step.priority)) out.priority = step.priority;
      if (step.suggestedChannel && VALID_CHANNELS.includes(step.suggestedChannel)) {
        out.suggestedChannel = step.suggestedChannel;
      }
      return out;
    });

  const out: PlaybookTemplate = {
    id: template.id,
    name: clampString(template.name, 160) || 'قالب متابعة',
    category: VALID_CATEGORIES.includes(template.category) ? template.category : 'custom',
    steps: cleanSteps,
    isSystemTemplate: false,
    createdAt: clampString(template.createdAt, 50) || new Date().toISOString(),
    updatedAt: clampString(template.updatedAt, 50) || new Date().toISOString(),
  };

  const uid = currentUserId || template.userId;
  if (uid) out.userId = uid;
  const desc = clampString(template.description, 2000);
  if (desc) out.description = desc;

  return out;
}

export function sanitizePlaybookRunForSave(
  run: PlaybookRun,
  currentUserId?: string
): PlaybookRun {
  const validStatuses: readonly PlaybookRunStatus[] = ['active', 'paused', 'completed', 'cancelled'];
  const validStepStatuses: readonly PlaybookStepStatus[] = [
    'pending',
    'in_progress',
    'completed',
    'skipped',
  ];
  const validMethods: readonly PlaybookStepCompletionMethod[] = [
    'manual',
    'linked_task',
    'linked_communication',
  ];

  const cleanSteps: PlaybookRunStep[] = (run.steps || [])
    .slice(0, MAX_PLAYBOOK_STEPS)
    .map((step, idx) => {
      const out: PlaybookRunStep = {
        id: isValidPlaybookId(step.id) ? step.id : generateStablePlaybookId(`step${idx + 1}`),
        title: clampString(step.title, 200) || `خطوة ${idx + 1}`,
        stepType: VALID_STEP_TYPES.includes(step.stepType) ? step.stepType : 'task',
        order: idx + 1,
        status: validStepStatuses.includes(step.status) ? step.status : 'pending',
        duePolicy: cloneDuePolicy(step.duePolicy),
      };
      const desc = clampString(step.description, 1500);
      if (desc) out.description = desc;
      if (typeof step.dueDate === 'string' && parseDateOnlyString(step.dueDate)) {
        out.dueDate = step.dueDate;
      }
      if (step.priority && VALID_PRIORITIES.includes(step.priority)) out.priority = step.priority;
      if (step.suggestedChannel && VALID_CHANNELS.includes(step.suggestedChannel)) {
        out.suggestedChannel = step.suggestedChannel;
      }
      const startedAt = clampString(step.startedAt, 50);
      if (startedAt) out.startedAt = startedAt;
      const completedAt = clampString(step.completedAt, 50);
      if (completedAt) out.completedAt = completedAt;
      const skippedAt = clampString(step.skippedAt, 50);
      if (skippedAt) out.skippedAt = skippedAt;
      if (isValidPlaybookId(step.linkedTaskId)) out.linkedTaskId = step.linkedTaskId;
      if (isValidPlaybookId(step.linkedInteractionId)) {
        out.linkedInteractionId = step.linkedInteractionId;
      }
      if (step.completionMethod && validMethods.includes(step.completionMethod)) {
        out.completionMethod = step.completionMethod;
      }
      const note = clampString(step.note, 1000);
      if (note) out.note = note;
      return out;
    });

  const out: PlaybookRun = {
    id: run.id,
    templateName: clampString(run.templateName, 160) || 'خطة متابعة',
    clientId: run.clientId,
    status: validStatuses.includes(run.status) ? run.status : 'active',
    steps: cleanSteps,
    startedAt: clampString(run.startedAt, 50) || new Date().toISOString(),
    updatedAt: clampString(run.updatedAt, 50) || new Date().toISOString(),
    revision:
      typeof run.revision === 'number' && Number.isFinite(run.revision) && run.revision >= 1
        ? Math.floor(run.revision)
        : 1,
  };

  const uid = currentUserId || run.userId;
  if (uid) out.userId = uid;
  if (isValidPlaybookId(run.templateId)) out.templateId = run.templateId;
  if (isValidPlaybookId(run.opportunityId)) out.opportunityId = run.opportunityId;
  if (typeof run.startDateKey === 'string' && parseDateOnlyString(run.startDateKey)) {
    out.startDateKey = run.startDateKey;
  }
  const completedAt = clampString(run.completedAt, 50);
  if (completedAt) out.completedAt = completedAt;
  const pausedAt = clampString(run.pausedAt, 50);
  if (pausedAt) out.pausedAt = pausedAt;
  const cancelledAt = clampString(run.cancelledAt, 50);
  if (cancelledAt) out.cancelledAt = cancelledAt;
  const cancelReason = clampString(run.cancelReason, 500);
  if (cancelReason) out.cancelReason = cancelReason;

  return out;
}

/**
 * Checks whether a remote PlaybookRun advanced past the client's known baseRevision
 * with actual differing content, producing a ConflictItem for manual decision rather
 * than silently overwriting newer cross-device changes.
 */
export function checkPlaybookRunRevisionConflict(params: {
  localRun: PlaybookRun;
  remoteRun: PlaybookRun | undefined;
  expectedBaseRevision?: number;
}): ConflictItem | null {
  const { localRun, remoteRun, expectedBaseRevision } = params;
  if (!remoteRun || localRun.id !== remoteRun.id) return null;

  const remoteRev = remoteRun.revision ?? 0;
  const baseRev = expectedBaseRevision ?? Math.max(0, (localRun.revision ?? 1) - 1);

  if (remoteRev > baseRev) {
    return detectEntityConflict(localRun, remoteRun, 'playbookRun', {
      detectionSource: 'field_diff',
    });
  }
  return null;
}
