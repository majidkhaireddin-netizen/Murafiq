import { Client, Meeting, ActionItem, Note } from '../types';

export const INITIAL_CLIENTS: Client[] = [
  {
    id: 'c-ahmed',
    name: 'م. أحمد الجاسم',
    company: 'شركة أفق للتقنية',
    phone: '+966 50 123 4567',
    email: 'ahmed@ofoq-tech.sa',
    notes: 'يفضل التواصل عبر واتساب بعد الظهر. حريص جداً على الالتزام بالمواعيد وتوثيق كل بند تعاقدي.',
    color: '#0284c7', // Sky
    avatarPath: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    isFavorite: true,
    createdAt: '2026-05-10T08:00:00Z',
    updatedAt: '2026-07-12T14:30:00Z',
  },
  {
    id: 'c-sara',
    name: 'أ. سارة المنصوري',
    company: 'مؤسسة مدار للدعاية والإعلان',
    phone: '+971 50 987 6543',
    email: 'sara@madar-media.ae',
    notes: 'مديرة تسويق مبدعة، تحتاج تحديثات أسبوعية موجزة مع نماذج بصرية واضحة قبل الاجتماع.',
    color: '#7c3aed', // Violet
    avatarPath: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    isFavorite: true,
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-07-14T09:15:00Z',
  },
  {
    id: 'c-khaled',
    name: 'د. خالد العمري',
    company: 'عيادات النخبة الاستشارية',
    phone: '+966 55 456 7890',
    email: 'dr.khaled@nokhba-clinics.com',
    notes: 'استشاري طب أسرة ومؤسس مجموعة العيادات. يفضل اللقاءات الصباحية المبكرة وجهاً لوجه.',
    color: '#059669', // Emerald
    avatarPath: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150&auto=format&fit=crop&q=80',
    isFavorite: false,
    createdAt: '2026-06-15T11:20:00Z',
    updatedAt: '2026-07-08T16:00:00Z',
  },
  {
    id: 'c-tariq',
    name: 'م. طارق حداد',
    company: 'حلول كود العالمية',
    phone: '+962 79 345 6789',
    email: 'tariq@code-solutions.jo',
    notes: 'شريك تقني خبير. النقاشات معه تقنية ومباشرة حول البنية التحتية ومعمارية السحابة.',
    color: '#ea580c', // Orange
    avatarPath: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    isFavorite: false,
    createdAt: '2026-06-20T09:00:00Z',
    updatedAt: '2026-07-13T12:00:00Z',
  },
  {
    id: 'c-layla',
    name: 'ليلى الشريف',
    company: 'متجر زمرّد الإلكتروني',
    phone: '+973 39 123 987',
    email: 'layla@zomorod-store.com',
    notes: 'رائدة أعمال، أطلقت متجر مجوهرات فاخرة عبر الإنترنت. مرت فترة طويلة منذ آخر مراجعة لاستراتيجية النمو.',
    color: '#db2777', // Pink
    avatarPath: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    isFavorite: false,
    createdAt: '2026-04-10T14:00:00Z',
    updatedAt: '2026-06-05T10:00:00Z',
  },
];

export const INITIAL_MEETINGS: Meeting[] = [
  {
    id: 'm-101',
    clientId: 'c-ahmed',
    title: 'مراجعة عقد منصة ثقة والمرحلة الثانية',
    dateTime: '2026-11-12T11:30:00', // Tomorrow morning
    duration: 60,
    type: 'in_person',
    location: 'كافيه برو بريك — الرياض (طريق الملك فهد)',
    notes: `### محاور اللقاء المتفق عليها:
1. استعراض إنجاز المرحلة الأولى من منصة ثقة واختبارات الأداء.
2. مراجعة التعديلات المطلوبة على بنود الدفعات ومواعيد التسليم للمرحلة الثانية.
3. اعتماد جدول التدريب لفريق الدعم الداخلي في شركة أفق.

### تحضيرات ما قبل اللقاء:
- إحضار نسختين مطبوعتين من جدول التسليم المعدل.
- مراجعة استهلاك سيرفرات سحابة AWS خلال الشهر المنصرم.`,
    status: 'confirmed',
    photoPaths: [],
    isFollowUpScheduled: true,
    attendees: ['م. أحمد الجاسم', 'م. فهد التميمي (مدير العمليات)', 'أنت'],
    createdAt: '2026-11-08T10:00:00Z',
    updatedAt: '2026-11-10T16:20:00Z',
  },
  {
    id: 'm-102',
    clientId: 'c-sara',
    title: 'ورشة عمل هوية الحملة الرقمية وإطلاق الربع الرابع',
    dateTime: '2026-11-10T14:00:00', // Yesterday
    duration: 75,
    type: 'video',
    location: 'Google Meet',
    notes: `### محضر الاجتماع الرسمي:
تم عقد اللقاء بحضور فريق التسويق لمؤسسة مدار لمراجعة الخطة الإعلانية الشاملة للربع الأخير.

#### القرارات المتفق عليها:
- اعتماد لوحة الألوان الدافئة والتصاميم التفاعلية لشبكات التواصل الاجتماعي.
- تأكيد موعد بدء الحملة التجريبية في 25 من الشهر الجاري.
- زيادة تركيز الرسائل التسويقية على جودة الخدمة وشهادات العملاء الحقيقيين.

#### الملاحظات الفنية:
- تم تصوير لوحة الأفكار والـ Moodboard الرقمي وحفظها كمرجع لفريق التصميم.
- اتفقنا على جدول زمني أسبوعي لمتابعة مؤشرات الأداء ومعدل التحويل (CTR).`,
    status: 'completed',
    photoPaths: [
      'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1542744094-3a31f272c490?w=600&auto=format&fit=crop&q=80',
    ],
    isFollowUpScheduled: true,
    attendees: ['أ. سارة المنصوري', 'ريم الشامسي', 'أنت'],
    createdAt: '2026-11-05T09:00:00Z',
    updatedAt: '2026-11-10T15:30:00Z',
  },
  {
    id: 'm-103',
    clientId: 'c-khaled',
    title: 'تحديد متطلبات نظام المواعيد الإلكتروني للعيادات',
    dateTime: '2026-11-07T09:00:00', // 4 days ago
    duration: 90,
    type: 'in_person',
    location: 'المقر الرئيسي لعيادات النخبة — جدة (حي الروضة)',
    notes: `### محضر النقاش:
جلسة عمل تفصيلية مع د. خالد لدراسة دورة المريض من حجز الموعد عبر الجوال وحتى زيارة الطبيب واستلام الوصفة.

#### أبرز النقاط:
1. ضرورة الربط المباشر مع بوابة الرسائل القصيرة SMS لتأكيد الحجوزات قبل 24 ساعة.
2. تسهيل الدفع الإلكتروني عبر بطاقات مدى وأبل باي.
3. تخصيص لوحة تحكم سريعة للأطباء تعمل على أجهزة الآيباد داخل غرف الكشف.`,
    status: 'completed',
    photoPaths: [
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600&auto=format&fit=crop&q=80',
    ],
    isFollowUpScheduled: false,
    attendees: ['د. خالد العمري', 'أنت'],
    createdAt: '2026-11-04T12:00:00Z',
    updatedAt: '2026-11-07T11:00:00Z',
  },
  {
    id: 'm-104',
    clientId: 'c-tariq',
    title: 'مراجعة معمارية واجهات برمجة التطبيقات API وخدمات الأمان',
    dateTime: '2026-11-14T16:00:00', // In 3 days
    duration: 45,
    type: 'video',
    location: 'Zoom',
    notes: `### مسودة جدول الأعمال:
- فحص مستويات التشفير للبيانات المخزنة والبيانات المتنقلة.
- اختبار زمن الاستجابة في ظل الضغط المرتفع (Load Testing).
- تجهيز وثيقة Swagger التفاعلية لربط الشركاء الخارجيين.`,
    status: 'draft',
    photoPaths: [],
    isFollowUpScheduled: false,
    attendees: ['م. طارق حداد', 'أنت'],
    createdAt: '2026-11-09T14:00:00Z',
    updatedAt: '2026-11-09T14:00:00Z',
  },
  {
    id: 'm-105',
    clientId: 'c-layla',
    title: 'استعراض تقرير المبيعات وخطة التوسع لمتجر زمرّد',
    dateTime: '2026-10-06T13:00:00', // 36 days ago (triggers client review alert!)
    duration: 60,
    type: 'phone',
    location: 'اتصال هاتفي',
    notes: `### ملخص المكالمة:
- ارتفعت مبيعات قسم الخواتم بنسبة 18% بعد تحسين صور المنتجات.
- بحاجة لدراسة إطلاق تطبيق مخصص للهواتف الذكية أو تحسين الموقع كـ PWA.
- وعدت ليلى بالتواصل مجدداً بعد حصر طلبات موسم الأعياد.`,
    status: 'completed',
    photoPaths: [],
    isFollowUpScheduled: false,
    attendees: ['ليلى الشريف', 'أنت'],
    createdAt: '2026-10-06T10:00:00Z',
    updatedAt: '2026-10-06T14:15:00Z',
  },
];

export const INITIAL_TASKS: ActionItem[] = [
  {
    id: 't-201',
    meetingId: 'm-102',
    clientId: 'c-sara',
    title: 'إرسال مسودة وثيقة النطاق والميزانية لشركة مدار',
    description: 'إعداد ملف PDF يوضح ميزانية الحملة وجدول الدفعات المقترح بناءً على اتفاق ورشة الأمس.',
    dueDate: '2026-11-11', // Today
    priority: 'urgent',
    status: 'pending',
    reminderDate: '2026-11-11T12:00:00',
    provenance: 'source', // Extracted directly from meeting notes
    createdAt: '2026-11-10T15:30:00Z',
  },
  {
    id: 't-202',
    meetingId: 'm-101',
    clientId: 'c-ahmed',
    title: 'طباعة وتجهيز ملحق العقد المعدل لاجتماع الغد',
    description: 'تضمين بنود الدعم الفني وتحديث مؤشرات أداء سيرفرات AWS في الملحق.',
    dueDate: '2026-11-11', // Today
    priority: 'high',
    status: 'pending',
    reminderDate: '2026-11-11T16:00:00',
    provenance: 'approved',
    createdAt: '2026-11-09T11:00:00Z',
  },
  {
    id: 't-203',
    meetingId: 'm-103',
    clientId: 'c-khaled',
    title: 'مقارنة عروض مزودي خدمة الرسائل النصية SMS المعتمدين في المملكة',
    description: 'مقارنة التكلفة لكل رسالة وسرعة التوصيل بين STC وموبايلي وUnifonic لصالح عيادات النخبة.',
    dueDate: '2026-11-09', // Overdue (2 days ago!)
    priority: 'high',
    status: 'pending',
    provenance: 'source',
    createdAt: '2026-11-07T11:00:00Z',
  },
  {
    id: 't-204',
    meetingId: 'm-102',
    clientId: 'c-sara',
    title: 'تزويد المصمم بقائمة الخطوط والألوان المعتمدة للحملة',
    description: 'إرسال ملف الخطوط وملف Adobe Illustrator للمصمم المستقل.',
    dueDate: '2026-11-13', // This week
    priority: 'medium',
    status: 'pending',
    provenance: 'ai_suggested', // AI lightweight inference based on moodboard photos
    createdAt: '2026-11-10T15:30:00Z',
  },
  {
    id: 't-205',
    meetingId: 'm-104',
    clientId: 'c-tariq',
    title: 'مراجعة مسودة توثيق Swagger للـ API قبل جلسة المراجعة',
    description: 'التأكد من توثيق جميع الـ Endpoints الخاصة بمصادقة المستخدمين وحساب التوكنات.',
    dueDate: '2026-11-14', // This week
    priority: 'medium',
    status: 'pending',
    provenance: 'approved',
    createdAt: '2026-11-09T14:00:00Z',
  },
  {
    id: 't-206',
    clientId: 'c-layla',
    title: 'مكالمة استطلاعية مع ليلى الشريف لمتابعة نتائج حملة الخريف',
    description: 'تذكير ذكي: مضى أكثر من 30 يوماً على آخر تواصل مع متجر زمرّد.',
    dueDate: '2026-11-16', // Next week
    priority: 'low',
    status: 'pending',
    provenance: 'ai_suggested',
    createdAt: '2026-11-11T08:00:00Z',
  },
  {
    id: 't-207',
    meetingId: 'm-103',
    clientId: 'c-khaled',
    title: 'إرسال مسودة اتفاقية الحفاظ على سرية معلومات المرضى (NDA)',
    description: 'تم توقيع الاتفاقية وإرسال النسخة الرقمية بالبريد.',
    dueDate: '2026-11-08',
    priority: 'high',
    status: 'completed',
    completedAt: '2026-11-08T15:00:00Z',
    provenance: 'approved',
    createdAt: '2026-11-07T11:00:00Z',
  },
];

export const INITIAL_NOTES: Note[] = [
  {
    id: 'n-301',
    clientId: 'c-ahmed',
    title: 'سياسة التسعير المعتمدة لشركة أفق',
    content: `المعدل المعتمد للمشاريع الاستشارية هو 450 ريال/ساعة.
أي طلبات إضافية خارج وثيقة النطاق (Scope) تُحسب بفاتورة ملحقة منفصلة بموافقة خطية مسبقة.`,
    tags: ['تسعير', 'عقود', 'سياسات'],
    isPinned: true,
    color: '#fef3c7', // Amber light
    createdAt: '2026-06-12T10:00:00Z',
  },
  {
    id: 'n-302',
    title: 'قائمة تحقق قبل الخروج لأي لقاء وجهًا لوجه (Checklist)',
    content: `- مراجعة بطاقة العميل في مرافق وقراءة محضر اللقاء السابق.
- التأكد من شحن الحاسوب المحمول والآيباد.
- إحضار بطاقات العمل الشخصية ونماذج عقود مطبوعة.
- تسجيل الملاحظات مباشرة داخل اللقاء لإنشاء المهام فوراً.`,
    tags: ['نصائح', 'لقاءات', 'إنتاجية'],
    isPinned: true,
    color: '#e0f2fe', // Sky light
    createdAt: '2026-07-01T08:30:00Z',
  },
  {
    id: 'n-303',
    clientId: 'c-sara',
    title: 'المحددات البصرية لهوية مدار 2026',
    content: `تعتمد مؤسسة مدار خط IBM Plex Sans Arabic كخط رسمي رئيسي.
الألوان الأساسية: البنفسجي العميق (#4c1d95) والذهبي الرملي (#d97706).`,
    tags: ['تصميم', 'هوية'],
    isPinned: false,
    color: '#f3e8ff', // Purple light
    createdAt: '2026-07-10T14:00:00Z',
  },
];
