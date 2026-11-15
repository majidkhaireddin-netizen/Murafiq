# Task 013 — Relationship Playbooks & Follow-Up Sequences (خطط العلاقات والمتابعات المتسلسلة)

**المشروع:** Murafiq — مُرافق  
**قاعدة البيانات المستهدفة:** `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475` (`gen-lang-client-0264525417`)

---

## 1. الهدف الوظيفي

يهدف نظام **خطط العلاقات والمتابعات المتسلسلة (Relationship Playbooks & Follow-Up Sequences)** إلى توفير مسارات عمل مهنية واضحة ومنظمة لإدارة المتابعات الممتدة مع العملاء والفرص بعد الاجتماعات أو العروض أو فترات الانقطاع، مع الالتزام الكامل بمبدأ التحكم البشري الكامل (**Human-in-the-Loop**):

- تنظيم خطوات المتابعة في تسلسل واضح بمواعيد استحقاق نسبية محسوبة حتميًا.
- الفصل الصارم بين **قوالب الخطط** (القوالب الجاهزة والمخصصة) وبين **الخطط المنفذة** (`PlaybookRun`) التي تحتفظ بلقطة مستقلة (`Snapshot`) من الخطوات حتى لا تتأثر بتعديلات القالب لاحقًا.
- ربط خطوات الخطة اختياريًا مع نظام **المهام (`ActionItem`)** و**سجل التواصل (`CommunicationInteraction`)** دون إنشاء أنظمة موازية أو أتمتة صامتة مفرطة.

---

## 2. نماذج البيانات

عُرّفت النماذج في `src/types/index.ts` والمخطط في `firebase-blueprint.json` دون أي حقول موازية غير معتمدة:

### أ. نموذج القالب (`PlaybookTemplate`)
- **المسار في Firestore (للقوالب المخصصة فقط):** `users/{userId}/playbookTemplates/{templateId}`
- **الحقول الأساسية:**
  - `id`, `userId?`, `name` (`1..160` حرف), `description?` (`<= 2000` حرف)
  - `category`: إحدى القيم `'lead_engagement' | 'proposal_follow_up' | 'post_meeting' | 'relationship_reactivation' | 'custom'`
  - `isSystemTemplate`: قيمة `boolean` (`false` حصرًا في Firestore؛ قوالب النظام تُحمّل محليًا من `BUILTIN_PLAYBOOK_TEMPLATES`)
  - `steps`: مصفوفة `PlaybookTemplateStep[]` (`1..20` خطوة)، وتحتوي كل خطوة على: `id`, `title`, `description?`, `stepType` (`'task' | 'communication' | 'manual'`), `order`, `duePolicy`, `priority?`, `suggestedChannel?`
  - `createdAt`, `updatedAt`

### ب. نموذج الخطة المنفذة (`PlaybookRun`)
- **المسار في Firestore:** `users/{userId}/playbookRuns/{runId}`
- **الحقول الأساسية:**
  - `id`, `userId?`, `templateId?`, `templateName`, `clientId`, `opportunityId?`
  - `status`: `'active' | 'paused' | 'completed' | 'cancelled'`
  - `steps`: مصفوفة `PlaybookRunStep[]` (`1..20` خطوة) — تمثل نسخة مستقلة (`Snapshot`) عن القالب
  - `startDateKey?`: تاريخ بدء التقويم بصيغة `YYYY-MM-DD`
  - `startedAt`, `updatedAt`, `completedAt?`, `pausedAt?`, `cancelledAt?`, `cancelReason?`, `revision?` (`>= 1`)

### ج. نموذج خطوة الخطة المنفذة (`PlaybookRunStep`)
- `id`, `title`, `description?`, `stepType`, `order`
- `status`: `'pending' | 'in_progress' | 'completed' | 'skipped'`
- `duePolicy`: `{ type: 'from_start' | 'after_previous_completion', offsetDays: number }` (`0..365`)
- `dueDate?`: بصيغة `YYYY-MM-DD` عند التمكن من الحساب فقط (تظل `undefined` إذا كانت تعتمد على إكمال خطوة سابقة لم تُنجز بعد)
- `priority?`, `suggestedChannel?`, `startedAt?`, `completedAt?`, `skippedAt?`
- `linkedTaskId?`, `linkedInteractionId?`, `completionMethod?` (`'manual' | 'linked_task' | 'linked_communication'`), `note?`

---

## 3. القوالب الجاهزة (`BUILTIN_PLAYBOOK_TEMPLATES`)

يوفر المحرك `src/utils/playbookEngine.ts` أربعة قوالب نظام عربية جاهزة (`isSystemTemplate: true`) محمية من التعديل أو الحذف المباشر:

1. **`sys_pb_lead_engagement` — التواصل مع عميل محتمل** (`5` خطوات: الاتصال الأولي، التعريف بالخدمات، تحديد احتياجات العميل، ترتيب اجتماع، تحديد الخطوة التالية).
2. **`sys_pb_proposal_follow_up` — متابعة عرض مقدم** (`5` خطوات: إرسال العرض، التأكد من الاستلام، طلب الملاحظات، مناقشة التعديلات، الحصول على القرار).
3. **`sys_pb_post_meeting` — المتابعة بعد اجتماع** (`5` خطوات: إرسال ملخص الاجتماع، مراجعة الالتزامات، متابعة المهام المفتوحة، التواصل مع العميل، تحديد المتابعة القادمة).
4. **`sys_pb_relationship_reactivation` — إعادة تنشيط علاقة** (`5` خطوات: مراجعة آخر تواصل، إجراء اتصال جديد، معرفة المستجدات، اقتراح فرصة تعاون، تحديد متابعة لاحقة).

**آلية التعديل:** يتيح التطبيق استنساخ أي قالب نظام (`clonePlaybookTemplateToCustom`) إلى قالب مخصص جديد (`isSystemTemplate: false`) قابل للتعديل والحفظ والحذف بأمان دون التأثير على الخطط الجارية.

---

## 4. قواعد المواعيد النسبية (`PlaybookDuePolicy`)

تُحسب المواعيد في `playbookEngine.ts` اعتمادًا على دوال التقويم المحصّنة زمنيًا (`addCalendarDaysToKey`, `formatCalendarDateKey`, `getTodayCalendarKey`, `resolveCalendarParts`) من `followUpEngine.ts`:

- **`from_start`**: يُحسب الموعد بإضافة `offsetDays` إلى `startDateKey` (تاريخ بدء الخطة في المنطقة الزمنية النشطة) مع دعم السنة الكبيسة وتعدّد المناطق الزمنية.
- **`after_previous_completion`**:
  - إذا لم تكتمل الخطوة السابقة بعد (`status !== 'completed'` و`status !== 'skipped'`), يظل حقل `dueDate` مساويًا لـ `undefined` ولا يُختلق تاريخ وهمي، وتعرض الواجهة عبارة: **«يُحدد الموعد بعد إكمال الخطوة السابقة.»**
  - عند إكمال الخطوة السابقة (أو تجاوزها باستخدام تاريخ التجاوز/الاعتماد الفعلي)، يُعاد احتساب `dueDate` للخطوات اللاحقة تلقائيًا بإضافة `offsetDays` إلى تاريخ الإنجاز الفعلي.
- **احترام تعديلات المستخدم على المهام المرتبطة:** إذا أعيد احتساب تاريخ خطوة وكان لها `linkedTaskId` مفتوح يعدّله المستخدم أو يملك تاريخ استحقاق مختلفًا، لا يفرض المحرك تغيير `ActionItem.dueDate` تلقائيًا، بل يولّد اقتراحًا غير تطفلي (`PlaybookRescheduleSuggestion`) يراجعه المستخدم ويوافق عليه صراحة.

---

## 5. دورة حياة الخطة (`PlaybookRun`)

- **`active` (نشطة):** الحالة الافتراضية عند البدء عبر `startPlaybookRun`. يُنذر المستخدم وديًا (دون منع صلب) في حال وجود خطة نشطة سابقة لنفس العميل أو الفرصة.
- **`paused` (متوقفة مؤقتًا):** إيقاف مؤقت عبر `pausePlaybookRun` يحفظ `pausedAt`؛ لا تولّد خطواتها تذكيرات مزعجة أثناء التوقف. يمكن استئنافها عبر `resumePlaybookRun`.
- **`completed` (مكتملة):** عند إكمال جميع الخطوات (أو إنهاء الخطة صراحة عندما تكون جاهزة وفق مقاييس الإنجاز).
- **`cancelled` (ملغاة):** عبر `cancelPlaybookRun` مع سبب اختياري (`cancelReason`). **قاعدة حاسمة:** إلغاء الخطة أو إيقافها أو حذفها **لا يحذف** أي مهام (`tasks`) أو سجلات تواصل (`interactions`) مرتبطة بها.
- **استقلالية الحالات الأخرى:** لا تُغيَّر `client.relationshipStatus` أو `opportunity.stage` تلقائيًا عند بدء أو إكمال أو إلغاء الخطة؛ وتعرض مساحة الفرصة تنبيهًا غير معيق إذا أُغلقت الفرصة بينما ما زالت خطة مرتبطة بها نشطة.

---

## 6. دورة حياة الخطوة (`PlaybookRunStep`)

- الحالات المعتمدة: `'pending' | 'in_progress' | 'completed' | 'skipped'`.
- طرق الإغلاق (`completionMethod`):
  - `'manual'`: إكمال يدوي من المستخدم.
  - `'linked_task'`: عند إكمال المهمة المرتبطة صراحة ومزامنتها أو اختيار الإكمال من المساحة.
  - `'linked_communication'`: عند توثيق تواصل مؤكد مرتبط بالخطوة.
- **قاعدة الصدق في التواصل:** عند تسجيل محاولة تواصل غير مكتملة (`no_answer`, `busy_or_callback`, `message_sent`), يُربط السجل بالخطوة (`linkedInteractionId`) وتتحول الخطوة إلى `in_progress` فقط إذا كانت `pending`، **ولا تُغلق تلقائيًا أبدًا كـ `completed`**.
- **مقياس التقدم الصادق (`computePlaybookProgress`):** تُحتسب الخطوات المنجزة (`completedStepsCount`) بشكل مستقل عن المتجاوزة (`skippedStepsCount`)، وتظهر النسبة والعدادات بوضوح دون تضليل.
- يُتاح للمستخدم دائمًا إعادة فتح خطوة منجزة أو متجاوزة (`reopenPlaybookStep`) أو تخطيها (`skipPlaybookStep`).

---

## 7. ربط الخطوات بالمهام والإنشاء الذري (`Atomic Step-to-Task`)

- لا تنشئ الخطة أي مهام تلقائيًا عند بدئها (`startPlaybookRun`).
- عند رغبة المستخدم في تحويل خطوة إلى مهمة داخل جدول المهام، تُستخدم آلية حتمية ومحصنة في:
  - المنطق النقي: `prepareAtomicStepToTaskPlan` و`applyAtomicStepToTaskInTransactionState` في `src/utils/playbookEngine.ts`
  - التنفيذ عبر Firestore Transaction: `createTaskFromPlaybookStepAtomic` في `src/services/firebase.ts`
- **المعرّف الحتمي للمهمة:** `pbstep_<runId>__<stepId>` (`buildPlaybookStepTaskId`) لربط الخطوة بمهمة واحدة فقط.
- **حارس عدم الاتصال:** تُحجب عملية التحويل الذري الجديدة محليًا إذا كان الجهاز غير متصل بالإنترنت (`isOnline === false`) مع إشعار عربي صريح، لمنع تضارب المهام عند العمل المتعدد الأجهزة.
- إذا كانت المهمة قد أُنشئت مسبقًا (بسبب ضغطة مزدوجة أو استجابة شبكة ضائعة أو سباق متزامن)، يعيد الـ Transaction نفس المهمة القائمة **دون تكرار ودون الكتابة فوق تعديلات المستخدم اللاحقة**.

---

## 8. ربط الخطوات بالتواصل

- يستطيع المستخدم توثيق تواصل مباشر انطلاقًا من أي خطوة من نوع `communication` (أو أي خطوة نشطة) عبر `InteractionFormModal` مع تمرير `clientId` و`opportunityId` والقناة المقترحة (`suggestedChannel`).
- تفرض `playbookEngine.ts` تطابق `interaction.clientId === run.clientId` وترفض ربط أي تواصل يخص عميلًا آخر.
- تظل سجلات التواصل المرتبطة محفوظة ضمن سجل العميل والتواصل حتى لو أُلغيت الخطة لاحقًا.

---

## 9. منع التكرار (`Idempotency & Deduplication`)

1. **منع تكرار المهام:** المعرف الحتمي `pbstep_<runId>__<stepId>` + فحص `step.linkedTaskId` + `runTransaction` في Firestore يضمن استحالة إنشاء أكثر من مهمة واحدة لنفس الخطوة حتى مع الضغطة المزدوجة أو انقطاع الاستجابة.
2. **منع تكرار التذكيرات (`followUpEngine.ts`):** إذا كانت للخطوة مهمة مرتبطة **مفتوحة** (`status !== 'completed' && status !== 'cancelled'`), تُكتم تذكيرات الخطوة تلقائيًا لتجنب ازدواج التنبيه مع تذكير المهمة. وإذا أُلغيت المهمة المرتبطة وبقيت الخطوة نشطة، تعود تذكيرات الخطوة للظهور تلقائيًا.
3. **منع التكرار في التقويم (`calendarEngine.ts`):** يتبع التقويم نفس مبدأ عدم التكرار للخطوات المغطاة بمهمة مفتوحة مرتبطة.

---

## 10. آليات التزامن ومعالجة التعارض (`Revision Conflicts`)

- يحمل كل سجل `PlaybookRun` رقم نسخة تصاعدي `revision` (`>= 1`) وطابعًا زمنيًا `updatedAt`.
- عند تحديث الخطة عبر الأجهزة، تقارن `detectPlaybookRunConflict` و`syncLogic.ts` النسخة المحلية المعلقة مع النسخة الواردة من الخادم، وإذا وقع تعارض تعديل متزامن يُعرض في نافذة حل التعارض (`ConflictResolutionModal`) لاختيار النسخة المعتمدة يدويًا دون فقدان بيانات صامت.

---

## 11. العمل دون اتصال (`Offline-First`)

- تعتمد خطط العلاقات على Firestore مع IndexedDB Persistent Cache و`CollectionKey`: `'playbookTemplates'` و`'playbookRuns'` في `syncLogic.ts` و`AuthenticatedSession.tsx`.
- تظهر حالة المزامنة (`local` / `pending` / `synced` / `conflict` / `failed`) بشفافية تامة في الشريط العلوي والواجهات.
- تستمر مراجعة القوالب والخطط وتحديث الخطوات يدويًا وحفظ الخطط المخصصة في وضع عدم الاتصال مع الانتظار في طابور المزامنة، بينما تُعطّل فقط عمليات التحويل الذري عبر الخادم (`createTaskFromPlaybookStepAtomic`) والنسخ/الاستيراد الجماعي حتى عودة الاتصال.
- لا تُخزّن بيانات الخطط أو العملاء في `localStorage`.

---

## 12. التكامل مع أقسام التطبيق

| القسم / الملف | طبيعة التكامل |
|---|---|
| **قوالب وخطط العلاقات** (`PlaybookTemplatesView.tsx`, `PlaybookRunsView.tsx`, `PlaybookRunWorkspace.tsx`, `PlaybookStartModal.tsx`, `PlaybookTemplateEditorModal.tsx`) | استعراض القوالب، استنساخها، إنشاء قوالب مخصصة، بدء الخطط، إدارة دورة حياة الخطوات والخطط، متابعة التقدم الصادق. |
| **ملف العميل 360** (`Client360Workspace.tsx`, `ClientsView.tsx`) | تبويب/بطاقة متكاملة للخطط النشطة والتاريخية للعميل مع زر بدء خطة سريعة. |
| **مساحة الفرصة** (`OpportunityDetailWorkspace.tsx`, `OpportunitiesView.tsx`) | عرض الخطط المرتبطة بالفرصة مع تنبيه هادئ غير معيق عند إغلاق الفرصة مع وجود خطة نشطة. |
| **يومي (`TodayView.tsx`)** | بطاقة للخطوات المستحقة والمتأخرة لليوم من الخطط النشطة مع فتح سريع لمساحة الخطة. |
| **التقويم (`calendarEngine.ts`, `CalendarView.tsx`)** | أحداث يومية من نوع `playbook_step` (تاريخ بدون ساعات مختلقة وبلا تعارضات وقت زائفة) مع خيار إظهار/إخفاء الخطط وخصم الخطوات المغطاة بمهام مفتوحة. |
| **التذكيرات (`followUpEngine.ts`)** | تقييم تذكيرات `playbook_step` (`playbook_step_overdue`, `playbook_step_due_today`, `playbook_step_due_soon`) ودعم التأجيل (`Snooze`) والإبطال (`Invalidation`) عند الإكمال أو الإيقاف المؤقت أو الإلغاء. |
| **المهام (`TasksView.tsx`)** | شارة واضحة على المهمة المنشأة من خطوة خطة مع رابط رجوع للخطة المرتبطة وحفظ التحويل الذري. |
| **البحث الشامل (`searchEngine.ts`, `SearchModal.tsx`)** | فهرسة الخطط والقوالب مع تطبيع النص العربي وعزل تام لبيانات المستخدم (`currentUserId`). |
| **نقل البيانات (`dataPortability.ts`, `SettingsModal.tsx`)** | تصدير `playbookTemplates` (المخصصة فقط) و`playbookRuns` في `murafiq-export-v1` وCSV مع تعقيم وحماية من تزوير `isSystemTemplate` أو تسرب `userId` أو استيراد بدون اتصال. |

---

## 13. قواعد أمان Firestore (`firestore.rules`)

أُضيفت دوال التحقق الصارمة ومسارات المستخدم المعزولة:
- `/users/{userId}/playbookTemplates/{templateId}` (`isValidPlaybookTemplate`):
  - ملكية صارمة للمستخدم (`isOwner(userId)`).
  - حصر الحقول عبر `hasOnly(...)` ومنع حفظ قوالب النظام (`data.isSystemTemplate == false`).
  - التحقق من عدد الخطوات (`1..20`) وصلاحية `category` وثبات `createdAt`.
- `/users/{userId}/playbookRuns/{runId}` (`isValidPlaybookRun`):
  - ملكية صارمة للمستخدم (`isOwner(userId)`).
  - حصر الحقول عبر `hasOnly(...)` والتحقق من `status` (`active | paused | completed | cancelled`)، وعدد الخطوات (`1..20`)، وصيغة `startDateKey` (`YYYY-MM-DD`)، وثبات `startedAt` عند التحديث، و`revision >= 1`.
- توسيع `isValidTask` لقبول الحقلين الاختياريين `playbookRunId` و`playbookStepId`، وتوسيع `isValidReminderState` لدعم `sourceType == 'playbook_step'` وأسباب التذكير الجديدة.
- تظل جميع المسارات الجذرية غير المعزولة مرفوضة بالكامل.

---

## 14. نتائج الاختبارات الفعلية

- **`npm run lint` (`tsc --noEmit`):** نجاح كامل — **0 أخطاء** في `src/` و`tests/`.
- **`npm run build` (`vite build`):** نجاح كامل في `2.08s` (`1739 modules transformed`).
- **`npm test`:** نجاح **242 / 242** اختبارًا عبر جميع الملفات، منها **21 اختبارًا شاملًا** في `tests/playbooks.test.ts` تغطي:
  - القوالب الجاهزة والمخصصة والاستنساخ وحذف القالب.
  - بدء الخطط، استقلالية اللقطة، دورة حياة الخطوة والخطة، عدم اختلاق التواريخ والسنوات الكبيسة.
  - التحويل الذري للمهمة ومنع التكرار عند السباق/إعادة المحاولة/حجب عدم الاتصال.
  - ربط التواصل وعدم الإغلاق التلقائي لمحاولات التواصل غير المؤكدة.
  - مقاييس التقدم الصادقة، العزل بين المستخدمين، تعارض `revision`، التذكيرات، التقويم، البحث الشامل، والتصدير/الاستيراد الآمن.
- **اختبارات محاكي Firestore (`npm run test:rules` و`npm run test:offline`):**
  - أُضيفت اختبارات الأمان التفصيلية في `tests/firestore-security.test.ts` (القسم الفرعي `8d`).
  - لم يتمكن المحاكي من العمل داخل هذه الحاوية بسبب غياب حزمة Java (`java: not found — Error: Could not spawn java -version`), والاختبارات جاهزة تمامًا للتنفيذ التلقائي ضمن بيئة **GitHub Actions** التي يتوفر فيها Java وFirebase Emulator.

---

## 15. القيود المتبقية وافتراضات التصميم

- **لا توجد أي أتمتة صامتة:** لا يرسل التطبيق رسائل WhatsApp أو SMS أو بريد إلكتروني، ولا ينشئ مهام تلقائيًا عند بدء الخطة، ولا يغير `relationshipStatus` أو `opportunity.stage` من تلقاء نفسه.
- **بيئة المتصفح غير المصادق عليها محليًا:** في الحاوية الحالية دون جلسة Firebase Auth حية، يمكن فحص واجهة الدخول وهيكل RTL وتوافق العرض دون بيانات مستخدم حية، بينما اختُبر المنطق والتكامل والترجمة بالكامل عبر TypeScript والبناء ومجموعة اختبارات الوحدة (`242/242`).
- **افتراض تصميم قابل للعكس:** حُددت فئة الخطة في البحث الشامل اشتقاقًا عبر مطابقة `templateId` مع `BUILTIN_PLAYBOOK_TEMPLATES` عند التصدير/البحث لتجنب تخزين حقل `category` مكرر داخل وثيقة `PlaybookRun` في Firestore.
