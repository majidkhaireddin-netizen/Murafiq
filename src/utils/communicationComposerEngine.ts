import type {
  Client,
  ClientContact,
  CommunicationChannel,
  CommunicationInteraction,
  CommunicationTemplate,
  CommunicationTemplateCategory,
  Opportunity,
  Meeting,
} from '../types/index.ts';
import type {
  OperationCoordinator,
  WriteErrorClassification,
} from './sessionState.ts';

export const SUPPORTED_COMMUNICATION_VARIABLES = [
  { key: 'clientName', labelAr: 'اسم العميل / الشركة', description: 'اسم العميل أو الجهة الرئيسية' },
  { key: 'companyName', labelAr: 'اسم الشركة', description: 'اسم المنشأة أو الشركة التابعة للعميل' },
  { key: 'contactName', labelAr: 'اسم المسؤول / جهة الاتصال', description: 'اسم الشخص المسؤول أو ممثل العميل' },
  { key: 'contactTitle', labelAr: 'المسمى الوظيفي للمسؤول', description: 'المسمى الوظيفي لجهة الاتصال' },
  { key: 'opportunityTitle', labelAr: 'عنوان الفرصة التجارية', description: 'عنوان أو اسم الفرصة المرتبطة' },
  { key: 'opportunityValue', labelAr: 'قيمة الفرصة المالية', description: 'القيمة المالية والعملة للفرصة' },
  { key: 'nextAction', labelAr: 'الخطوة التالية المطلوبة', description: 'وصف الإجراء أو الخطوة القادمة' },
  { key: 'meetingTitle', labelAr: 'عنوان الاجتماع المرتبط', description: 'عنوان اللقاء السابق أو القادم' },
  { key: 'daysOverdue', labelAr: 'عدد أيام التأخير', description: 'عدد أيام تأخير المتابعة أو الاستحقاق' },
  { key: 'userCompanyName', labelAr: 'اسم شركتك / جهتك', description: 'اسم مزود الخدمة أو شركتك' },
] as const;

export const SYSTEM_COMMUNICATION_TEMPLATES: CommunicationTemplate[] = [
  {
    id: 'sys-tmpl-intro-lead',
    title: 'مقدمة تواصل أولية مع عميل محتمل (Lead Intro)',
    category: 'intro_lead',
    channel: 'any',
    subjectTemplate: 'مبادرة تعاون مهني وبحث فرص الشراكة مع {{companyName}}',
    bodyTemplate: `السلام عليكم ورحمة الله وبركاته،
الأستاذ/ة {{contactName}}،
مرحباً بك، بصفتي ممثلاً عن {{userCompanyName}}، أود التواصل معك لبحث سبل التعاون المشترك مع {{companyName}}.
لقد تابعنا بإعجاب نشاطكم المتميز، ونعتقد أن هناك فرصًا واعدة لتقديم قيمة مضافة تدعم أهدافكم الاستراتيجية.
هل تسنح لكم فرصة لعقد لقاء تعريفي مقتضب خلال الأسبوع الحالي لتبادل الأفكار؟

مع خالص التقدير،
{{userCompanyName}}`,
    variables: ['contactName', 'companyName', 'userCompanyName'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-proposal-send',
    title: 'إرسال عرض سعر / مقترح تجاري (Proposal Send)',
    category: 'proposal_send',
    channel: 'email',
    subjectTemplate: 'المقترح التجاري وعرض الخدمات بخصوص: {{opportunityTitle}}',
    bodyTemplate: `السلام عليكم ورحمة الله وبركاته،
الأستاذ/ة {{contactName}} - {{companyName}}،
تحية طيبة وبعد،
بناءً على نقاشاتنا المثمرة السابقة، يسرنا أن نرفق لكم طيه المقترح التجاري التفصيلي الخاص بـ "{{opportunityTitle}}".
يتضمن العرض النطاق الزمني والمالي المقترح (القيمة: {{opportunityValue}}) لتحقيق أفضل عائد استثماري لكم.
نحن بانتظار ملاحظاتكم الكريمة، ومستعدون لأي استفسار أو تعديل يناسب تطلعاتكم.

مع خالص التقدير،`,
    variables: ['contactName', 'companyName', 'opportunityTitle', 'opportunityValue'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-meeting-invite',
    title: 'دعوة لعقد اجتماع أو جلسة نقاش (Meeting Invite)',
    category: 'meeting_invite',
    channel: 'whatsapp',
    subjectTemplate: 'دعوة لاجتماع تنسيقي: {{meetingTitle}}',
    bodyTemplate: `مرحباً بك أ. {{contactName}}،
نأمل أن تكونوا بخير وعافية.
تنسيقاً للخطوة التالية بخصوص مشروع "{{opportunityTitle}}"، نود دعوتكم لحضور اجتماع تنسيقي تحت عنوان "{{meetingTitle}}".
نرجو تأكيد إمكانية الحضور والوقت المناسب لكم خلال الأيام القادمة.
شكراً لتعاونكم المستمر.`,
    variables: ['contactName', 'opportunityTitle', 'meetingTitle'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-meeting-follow-up',
    title: 'متابعة ما بعد الاجتماع وتأكيد المهام (Meeting Follow-Up)',
    category: 'meeting_follow_up',
    channel: 'any',
    subjectTemplate: 'شكر وتقدير وملخص متابعة اجتماع: {{meetingTitle}}',
    bodyTemplate: `السلام عليكم ورحمة الله وبركاته،
أ. {{contactName}}،
شكراً جزيلاً لحضوركم اجتماعنا المثمر اليوم بخصوص "{{meetingTitle}}".
تلخيصاً لما تم نقاشه، تم الاتفاق على الخطوة التالية: "{{nextAction}}".
نسعد بمتابعة التنفيذ معكم والاطلاع على المستجدات في أقرب وقت.

مع أطيب التحيات،`,
    variables: ['contactName', 'meetingTitle', 'nextAction'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-opp-check-in',
    title: 'متابعة دورية للفرصة التجارية (Opportunity Check-In)',
    category: 'opportunity_check_in',
    channel: 'whatsapp',
    subjectTemplate: 'استفسار ومتابعة مستجدات: {{opportunityTitle}}',
    bodyTemplate: `مرحباً أ. {{contactName}}،
نأمل أن تكون أموركم في {{companyName}} على أحسن ما يرام.
نتواصل معكم للاطمئنان على مستجدات الفرصة التجارية "{{opportunityTitle}}" وبحث ما إذا كنتم بحاجة لأي توضيحات إضافية لدعم اتخاذ القرار.
نحن في الخدمة دائماً.`,
    variables: ['contactName', 'companyName', 'opportunityTitle'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-payment-reminder',
    title: 'تذكير بخصوص استحقاق أو دفعة متأخرة (Payment Reminder)',
    category: 'payment_reminder',
    channel: 'whatsapp',
    subjectTemplate: 'تذكير ودي بخصوص استحقاق مالي معلق لـ {{companyName}}',
    bodyTemplate: `السلام عليكم أ. {{contactName}}،
نتواصل معكم بخصوص الاستحقاق المالي المعلق المرتبط بـ "{{opportunityTitle}}" (تاريخ الاستحقاق أو التأخير: {{daysOverdue}}).
نرجو منكم التكرم بمراجعة الأمر وترتيب عملية السداد في أقرب وقت ممكن لاستمرار سير العمل بسلاسة.
شاكرين ومقدرين حسن تعاونكم الدائم معنا.`,
    variables: ['contactName', 'companyName', 'opportunityTitle', 'daysOverdue'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sys-tmpl-reactivation',
    title: 'إعادة تواصل مع عميل هادئ / منقطع (Client Reactivation)',
    category: 'reactivation',
    channel: 'any',
    subjectTemplate: 'تواصل وتجديد الشراكة مع {{companyName}}',
    bodyTemplate: `السلام عليكم ورحمة الله وبركاته،
أ. {{contactName}}،
لقد مرّ وقت طويل منذ آخر لقاء جمعنا بـ {{companyName}}، ونود بهذه المناسبة الاطمئنان عليكم.
لدينا اليوم خدمات وتحديثات جديدة قد تهمكم وتعزز أعمالكم القادمة.
يسعدنا جداً ترتيب اتصال قصير للاستماع إليكم ومناقشة فرص التعاون المستقبلية.

مع أطيب التمنيات بالتوفيق،`,
    variables: ['contactName', 'companyName'],
    isSystemTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export interface InterpolationContext {
  client?: Client;
  contact?: ClientContact;
  opportunity?: Opportunity;
  meeting?: Meeting;
  daysOverdue?: number | string;
  userCompanyName?: string;
}

export interface InterpolationResult {
  result: string;
  variablesUsed: Record<string, string>;
  missingVariables: string[];
  warningsArabic: string[];
  usedRealData: boolean;
}

const SUPPORTED_KEYS_SET = new Set<string>(SUPPORTED_COMMUNICATION_VARIABLES.map((v) => v.key));

/**
 * Pure variable interpolation engine with strict anti-fabrication guards.
 * Forbids inventing unregistered names, dues, or dates. Missing variables are flagged.
 */
export function interpolateTemplate(
  templateStr: string,
  context: InterpolationContext,
  fallbackMap: Record<string, string> = {}
): InterpolationResult {
  if (!templateStr || typeof templateStr !== 'string') {
    return {
      result: '',
      variablesUsed: {},
      missingVariables: [],
      warningsArabic: [],
      usedRealData: false,
    };
  }

  const client = context.client;
  const contact = context.contact;
  const opportunity = context.opportunity;
  const meeting = context.meeting;

  let hasRealData = false;
  const rawValues: Record<string, string | undefined> = {
    clientName: client?.name,
    companyName: client?.company || client?.name,
    contactName: contact?.name,
    contactTitle: contact?.title,
    opportunityTitle: opportunity?.title,
    opportunityValue:
      opportunity?.estimatedValue !== undefined && opportunity?.currency
        ? `${opportunity.estimatedValue.toLocaleString()} ${opportunity.currency}`
        : undefined,
    nextAction: opportunity?.nextAction,
    meetingTitle: meeting?.title,
    daysOverdue: context.daysOverdue !== undefined ? String(context.daysOverdue) : undefined,
    userCompanyName: context.userCompanyName || 'مُرافق',
  };

  if (client || contact || opportunity || meeting) {
    hasRealData = true;
  }

  const variablesUsed: Record<string, string> = {};
  const missingSet = new Set<string>();

  // Extract variables present in the template string
  const matches = templateStr.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  for (const match of matches) {
    const varName = match[1];
    if (!varName) continue;

    if (!SUPPORTED_KEYS_SET.has(varName)) {
      missingSet.add(varName);
      continue;
    }

    const val = rawValues[varName];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      variablesUsed[varName] = String(val).trim();
    } else {
      // Check fallbackMap ONLY if key is supported and explicitly provided
      const fallbackVal = fallbackMap[varName];
      if (fallbackVal !== undefined && fallbackVal !== null && String(fallbackVal).trim() !== '') {
        variablesUsed[varName] = String(fallbackVal).trim();
      } else {
        missingSet.add(varName);
      }
    }
  }

  const result = templateStr.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, varName) => {
    if (Object.prototype.hasOwnProperty.call(variablesUsed, varName)) {
      return variablesUsed[varName]!;
    }
    // Return placeholder indicator for unresolvable variables rather than fabricated guesses
    return `[${varName} مفقود]`;
  });

  const missingVariables = Array.from(missingSet);
  const warningsArabic: string[] = [];
  if (missingVariables.length > 0) {
    warningsArabic.push(
      `تنبيه: المتغيرات التالية غير متوفرة في بيانات العميل أو السياق المحدد وتم إظهار مؤشرات لها: ${missingVariables.join(
        '، '
      )}. يُرجى استكمالها يدويًا قبل الإرسال.`
    );
  }

  return {
    result,
    variablesUsed,
    missingVariables,
    warningsArabic,
    usedRealData: hasRealData && missingVariables.length === 0,
  };
}

/**
 * Builds a secure WhatsApp external link (wa.me) with strict phone normalization and encoding.
 */
export function buildWhatsAppOutreachUrl(phone?: string, body?: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 20) return null;
  const normalized = digits.startsWith('00') ? digits.slice(2) : digits;
  const baseUrl = `https://wa.me/${normalized}`;
  if (!body || !body.trim()) {
    return baseUrl;
  }
  const encodedText = encodeURIComponent(body.trim());
  return `${baseUrl}?text=${encodedText}`;
}

const EMAIL_STRICT_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Builds a secure Email mailto link with strict email validation and header injection prevention.
 */
export function buildEmailOutreachUrl(
  email?: string,
  subject?: string,
  body?: string
): string | null {
  if (!email || typeof email !== 'string') return null;
  const cleanEmail = email.trim();
  // Prevent CRLF and header injection characters
  if (/[\r\n\t,;?]/.test(cleanEmail) || !EMAIL_STRICT_REGEX.test(cleanEmail)) {
    return null;
  }

  const params: string[] = [];
  if (subject && typeof subject === 'string' && subject.trim()) {
    const cleanSubj = subject.replace(/[\r\n]/g, ' ').trim();
    params.push(`subject=${encodeURIComponent(cleanSubj)}`);
  }
  if (body && typeof body === 'string' && body.trim()) {
    params.push(`body=${encodeURIComponent(body.trim())}`);
  }
  const queryString = params.length > 0 ? `?${params.join('&')}` : '';
  return `mailto:${cleanEmail}${queryString}`;
}

const COMMUNICATION_TEMPLATE_CATEGORIES: CommunicationTemplateCategory[] = [
  'intro_lead',
  'proposal_send',
  'meeting_invite',
  'meeting_follow_up',
  'opportunity_check_in',
  'payment_reminder',
  'reactivation',
  'custom',
];

/**
 * Validates and sanitizes a custom communication template before saving.
 */
export function sanitizeCommunicationTemplateForSave(
  template: CommunicationTemplate,
  userId: string,
  nowIso: string = new Date().toISOString()
): CommunicationTemplate {
  const title = (template.title || '').trim().slice(0, 160);
  if (!title) {
    throw new Error('يرجى إدخال عنوان القالب.');
  }

  const category = COMMUNICATION_TEMPLATE_CATEGORIES.includes(template.category)
    ? template.category
    : 'custom';
  const channel: CommunicationChannel | 'any' =
    template.channel === 'whatsapp' ||
    template.channel === 'email' ||
    template.channel === 'phone_call' ||
    template.channel === 'in_person_visit' ||
    template.channel === 'video_call' ||
    template.channel === 'other' ||
    template.channel === 'any'
      ? template.channel
      : 'any';

  const subjectTemplate = template.subjectTemplate?.trim()
    ? template.subjectTemplate.trim().slice(0, 200)
    : undefined;

  const bodyTemplate = (template.bodyTemplate || '').trim().slice(0, 5000);
  if (!bodyTemplate) {
    throw new Error('يرجى إدخال نص محتوى القالب.');
  }

  // Prevent forging system templates
  const isSystemTemplate = false;

  const id = (template.id || '').trim() || `tmpl-${Date.now()}`;
  const createdAt =
    template.createdAt && !Number.isNaN(new Date(template.createdAt).getTime())
      ? template.createdAt
      : nowIso;

  const combinedText = `${subjectTemplate || ''} ${bodyTemplate}`;
  const foundVars: string[] = [];
  const matches = combinedText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  for (const match of matches) {
    if (match[1] && !foundVars.includes(match[1])) {
      foundVars.push(match[1]);
    }
  }

  return {
    id,
    userId,
    title,
    category,
    channel,
    ...(subjectTemplate ? { subjectTemplate } : {}),
    bodyTemplate,
    variables: foundVars,
    isSystemTemplate,
    createdAt,
    updatedAt: nowIso,
  };
}

export type ComposerSourceWorkspace =
  | 'communications'
  | 'client360'
  | 'opportunity'
  | 'today'
  | 'playbook';

export interface ComposerOpenParams {
  clientId: string;
  contactId?: string;
  opportunityId?: string;
  meetingId?: string;
  channel?: CommunicationChannel;
  sourceWorkspace?: ComposerSourceWorkspace;
}

export type ComposerOpenValidationResult =
  | {
      ok: true;
      client: Client;
      context: {
        clientId: string;
        contactId?: string;
        opportunityId?: string;
        meetingId?: string;
        channel: CommunicationChannel;
        sourceWorkspace?: ComposerSourceWorkspace;
      };
    }
  | {
      ok: false;
      errorCode:
        | 'CLIENT_NOT_FOUND'
        | 'CONTACT_CLIENT_MISMATCH'
        | 'OPPORTUNITY_CLIENT_MISMATCH'
        | 'MEETING_CLIENT_MISMATCH';
      messageArabic: string;
    };

/**
 * Validates and resolves the context for opening CommunicationComposerModal across all 5 workspaces.
 * - Never substitutes an invalid/missing clientId with clients[0] or a fake client.
 * - Rejects any contactId, opportunityId, or meetingId that does not belong to the specified client.
 */
export function validateAndResolveComposerContext(
  params: ComposerOpenParams,
  records: {
    clients: Client[];
    opportunities: Opportunity[];
    meetings: Meeting[];
  }
): ComposerOpenValidationResult {
  const cleanClientId = typeof params.clientId === 'string' ? params.clientId.trim() : '';
  const client = records.clients.find((c) => c.id === cleanClientId);
  if (!cleanClientId || !client) {
    return {
      ok: false,
      errorCode: 'CLIENT_NOT_FOUND',
      messageArabic: 'تعذر فتح مساعد المراسلات: العميل المحدد غير موجود في السجلات.',
    };
  }

  let resolvedContactId: string | undefined;
  if (params.contactId && params.contactId.trim()) {
    const cleanContactId = params.contactId.trim();
    const matchedContact = (client.contacts || []).find((c) => c.id === cleanContactId);
    if (!matchedContact) {
      return {
        ok: false,
        errorCode: 'CONTACT_CLIENT_MISMATCH',
        messageArabic: 'تعذر فتح مساعد المراسلات: جهة الاتصال المحددة لا تتبع هذا العميل.',
      };
    }
    resolvedContactId = matchedContact.id;
  } else {
    resolvedContactId =
      client.contacts?.find((c) => c.isPrimary)?.id || client.contacts?.[0]?.id || undefined;
  }

  let resolvedOpportunityId: string | undefined;
  if (params.opportunityId && params.opportunityId.trim()) {
    const cleanOppId = params.opportunityId.trim();
    const matchedOpp = records.opportunities.find((o) => o.id === cleanOppId);
    if (!matchedOpp || matchedOpp.clientId !== client.id) {
      return {
        ok: false,
        errorCode: 'OPPORTUNITY_CLIENT_MISMATCH',
        messageArabic: 'تعذر فتح مساعد المراسلات: الفرصة التجارية المحددة لا تتبع هذا العميل.',
      };
    }
    resolvedOpportunityId = matchedOpp.id;
  }

  let resolvedMeetingId: string | undefined;
  if (params.meetingId && params.meetingId.trim()) {
    const cleanMtgId = params.meetingId.trim();
    const matchedMtg = records.meetings.find((m) => m.id === cleanMtgId);
    if (!matchedMtg || matchedMtg.clientId !== client.id) {
      return {
        ok: false,
        errorCode: 'MEETING_CLIENT_MISMATCH',
        messageArabic: 'تعذر فتح مساعد المراسلات: الاجتماع المحدد لا يتبع هذا العميل.',
      };
    }
    resolvedMeetingId = matchedMtg.id;
  }

  return {
    ok: true,
    client,
    context: {
      clientId: client.id,
      ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
      ...(resolvedOpportunityId ? { opportunityId: resolvedOpportunityId } : {}),
      ...(resolvedMeetingId ? { meetingId: resolvedMeetingId } : {}),
      channel: params.channel || 'whatsapp',
      ...(params.sourceWorkspace ? { sourceWorkspace: params.sourceWorkspace } : {}),
    },
  };
}

/**
 * Executes a cloud-confirmed save of a CommunicationInteraction through OperationCoordinator.
 * - Rejects immediately if offline so no fake cloud confirmation occurs.
 * - Awaits the underlying Firestore serverPromise.
 * - Propagates server rejections (e.g. PERMISSION_DENIED) as thrown errors after rolling back optimistic state.
 */
export async function executeConfirmedInteractionSave(params: {
  interaction: CommunicationInteraction;
  userId: string;
  isOnline: boolean;
  coordinator: OperationCoordinator<CommunicationInteraction>;
  currentInteractions: CommunicationInteraction[];
  setState: (
    updater: (prev: CommunicationInteraction[]) => CommunicationInteraction[]
  ) => void;
  dispatchWrite: (record: CommunicationInteraction) => { serverPromise: Promise<void> };
  onConfirmed?: (info: {
    opId: string;
    opSeq: number;
    wasSuperseded: boolean;
    record: CommunicationInteraction;
  }) => void;
  onRejected?: (info: {
    opId: string;
    opSeq: number;
    error: Error;
    classification: WriteErrorClassification;
    wasSuperseded: boolean;
    record: CommunicationInteraction;
  }) => void;
}): Promise<{ status: 'synced'; record: CommunicationInteraction }> {
  if (!params.isOnline) {
    throw new Error(
      'أنت في وضع عدم الاتصال بالإنترنت: لا يمكن تأكيد حفظ سجل التواصل سحابياً الآن. ستبقى المسودة مفتوحة ومحفوظة حتى عودة الاتصال.'
    );
  }

  const withOwner: CommunicationInteraction = {
    ...params.interaction,
    userId: params.userId,
  };

  const prevEntity = params.currentInteractions.find((i) => i.id === withOwner.id);
  const applyUpsert = (prev: CommunicationInteraction[]) => {
    const idx = prev.findIndex((i) => i.id === withOwner.id);
    if (idx >= 0) {
      const next = [...prev];
      next[idx] = withOwner;
      return next;
    }
    return [withOwner, ...prev];
  };

  let serverConfirmed = false;
  let serverRejection: { error: Error; classification: WriteErrorClassification } | null = null;

  const handle = params.coordinator.runScopedMutation({
    entityId: withOwner.id,
    entityType: 'interaction',
    previousEntity: prevEntity,
    setState: params.setState,
    applyOptimistic: applyUpsert,
    dispatchWrite: () => params.dispatchWrite(withOwner),
    onServerConfirmed: ({ opId, opSeq, wasSuperseded }) => {
      serverConfirmed = true;
      params.onConfirmed?.({ opId, opSeq, wasSuperseded, record: withOwner });
    },
    onServerRejected: ({ opId, opSeq, error, classification, wasSuperseded }) => {
      serverRejection = { error, classification };
      params.onRejected?.({
        opId,
        opSeq,
        error,
        classification,
        wasSuperseded,
        record: withOwner,
      });
    },
  });

  await handle.serverPromise;

  if (serverRejection) {
    const rej = serverRejection as { error: Error; classification: WriteErrorClassification };
    throw new Error(rej.classification.messageArabic || rej.error.message);
  }

  if (!serverConfirmed) {
    throw new Error('تعذر تأكيد حفظ سجل التواصل على الخادم السحابي.');
  }

  return {
    status: 'synced',
    record: withOwner,
  };
}

export interface ComposerDraftSnapshot {
  subject: string;
  body: string;
  channel: CommunicationChannel;
  contactId?: string;
  opportunityId?: string;
  meetingId?: string;
  outcome: CommunicationInteraction['outcome'];
  nextStep?: string;
  nextFollowUpDate?: string;
  storeBodyInSummary: boolean;
}

export type ComposerSubmissionOutcome =
  | {
      status: 'ignored_in_flight';
      isOpen: true;
      syncState: 'saving';
      draft: ComposerDraftSnapshot;
    }
  | {
      status: 'synced';
      isOpen: false;
      syncState: 'synced';
      interaction: CommunicationInteraction;
      draft: ComposerDraftSnapshot;
    }
  | {
      status: 'failed';
      isOpen: true;
      syncState: 'failed';
      errorArabic: string;
      draft: ComposerDraftSnapshot;
    };

/**
 * Single-flight submission controller for CommunicationComposerModal interaction logging.
 * Guarantees:
 * - Double-clicks while saving are ignored without creating duplicate records.
 * - Never reports 'synced' or closes the modal before onLogInteraction resolves.
 * - Preserves the full draft and keeps the modal open when the server rejects.
 */
export function createComposerSubmissionController(params: {
  client: Client;
  contacts?: ClientContact[];
  onLogInteraction: (interaction: CommunicationInteraction) => Promise<void>;
  onStateChange?: (state: {
    isSubmitting: boolean;
    syncState: 'idle' | 'saving' | 'synced' | 'failed';
    isOpen: boolean;
    errorArabic: string | null;
  }) => void;
}) {
  let inFlight = false;
  let stableInteractionId: string | null = null;

  return {
    isInFlight: () => inFlight,
    getStableInteractionId: () => stableInteractionId,
    async submit(
      draft: ComposerDraftSnapshot,
      dispatchConfirmed: boolean
    ): Promise<ComposerSubmissionOutcome> {
      if (inFlight) {
        return {
          status: 'ignored_in_flight',
          isOpen: true,
          syncState: 'saving',
          draft,
        };
      }

      if (!dispatchConfirmed) {
        const msg =
          'يرجى تأكيد أنك قمت بإرسال الرسالة فعلاً عبر القناة الخارجية قبل تسجيلها في السجل.';
        params.onStateChange?.({
          isSubmitting: false,
          syncState: 'failed',
          isOpen: true,
          errorArabic: msg,
        });
        return {
          status: 'failed',
          isOpen: true,
          syncState: 'failed',
          errorArabic: msg,
          draft,
        };
      }

      inFlight = true;
      if (!stableInteractionId) {
        stableInteractionId = `comm-${Date.now()}`;
      }

      params.onStateChange?.({
        isSubmitting: true,
        syncState: 'saving',
        isOpen: true,
        errorArabic: null,
      });

      const activeContact = (params.contacts || params.client.contacts || []).find(
        (c) => c.id === draft.contactId
      );
      const summaryText = draft.storeBodyInSummary
        ? draft.body.slice(0, 1500)
        : `مراسلة عبر ${draft.channel} (بدون حفظ النص الكامل بناءً على تفضيل الخصوصية).`;

      const nowIso = new Date().toISOString();
      const interaction: CommunicationInteraction = {
        id: stableInteractionId,
        clientId: params.client.id,
        ...(draft.contactId ? { contactId: draft.contactId } : {}),
        ...(activeContact?.name ? { contactName: activeContact.name } : {}),
        ...(draft.opportunityId ? { opportunityId: draft.opportunityId } : {}),
        ...(draft.meetingId ? { meetingId: draft.meetingId } : {}),
        channel: draft.channel,
        direction: 'outbound',
        occurredAt: nowIso,
        subject: draft.subject
          ? `${draft.subject} - ${params.client.name}`
          : `مراسلة مع ${params.client.name}`,
        summary: summaryText,
        outcome: draft.outcome,
        ...(draft.nextStep?.trim() ? { nextStep: draft.nextStep.trim() } : {}),
        ...(draft.nextFollowUpDate ? { nextFollowUpDate: draft.nextFollowUpDate } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      try {
        await params.onLogInteraction(interaction);
        inFlight = false;
        stableInteractionId = null;
        params.onStateChange?.({
          isSubmitting: false,
          syncState: 'synced',
          isOpen: false,
          errorArabic: null,
        });
        return {
          status: 'synced',
          isOpen: false,
          syncState: 'synced',
          interaction,
          draft,
        };
      } catch (err: unknown) {
        inFlight = false;
        const msg = err instanceof Error ? err.message : 'تعذر حفظ سجل النشاط على الخادم.';
        params.onStateChange?.({
          isSubmitting: false,
          syncState: 'failed',
          isOpen: true,
          errorArabic: msg,
        });
        return {
          status: 'failed',
          isOpen: true,
          syncState: 'failed',
          errorArabic: msg,
          draft,
        };
      }
    },
  };
}

