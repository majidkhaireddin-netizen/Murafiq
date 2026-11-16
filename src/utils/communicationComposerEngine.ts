import type {
  Client,
  ClientContact,
  CommunicationChannel,
  CommunicationTemplate,
  CommunicationTemplateCategory,
  Opportunity,
  Meeting,
} from '../types/index.ts';

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
