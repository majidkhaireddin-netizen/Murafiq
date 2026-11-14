# Task 008: Opportunity Management & Relationship Pipeline — «فرص الأعمال»

## 1. نظرة عامة والهدف الوظيفي

يُقدّم **Task 008** نظاماً متكاملاً لإدارة **فرص الأعمال والعلاقات التجارية (Opportunity Management & Relationship Pipeline)** داخل تطبيق **«مُرافق — Murafiq»**. صُمم هذا النظام لخدمة أصحاب الأعمال، والمستشارين، ومقدمي الخدمات المهنية، ومديري العلاقات، دون افتراض أن جميع الفرص هي صفقات مبيعات تقليدية، مع دعم العمل دون اتصال (Offline-First) وعزل البيانات الصارم لكل مستخدم.

---

## 2. نموذج البيانات والمسارات السحابية (Data Model & Firestore Paths)

تُخزَّن جميع السجلات حصرياً داخل قاعدة بيانات Firestore المسماة:
`ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`

### المسارات المعتمدة
1. **فرص الأعمال (`Opportunity`)**:
   - المسار: `/users/{userId}/opportunities/{opportunityId}`
   - الحقول الأساسية: `id`, `userId`, `clientId`, `title`, `type`, `stage`, `priority`, `estimatedValue`, `currency`, `expectedCloseDate`, `nextAction`, `nextActionDate`, `source`, `description`, `lostReason`, `closedAt`, `reopenedAt`, `createdAt` (غير قابل للتعديل بعد الإنشاء), `updatedAt`.
2. **سجل تطور المراحل (`OpportunityStageEvent`)**:
   - المسار: `/users/{userId}/opportunityStageEvents/{eventId}`
   - سجل تدقيقي غير قابل للتعديل (`allow update: if false` في `firestore.rules`).
   - الحقول الأساسية: `id`, `userId`, `opportunityId`, `eventType` (`created` | `stage_changed` | `closed_won` | `closed_lost` | `reopened`), `fromStage`, `toStage`, `note`, `occurredAt`.
3. **الربط الاختياري بالاجتماعات والمهام**:
   - أُضيف الحقل الاختياري `opportunityId?: string` إلى كلٍ من `Meeting` (`/users/{userId}/meetings/{meetingId}`) و`ActionItem` (`/users/{userId}/tasks/{taskId}`).

---

## 3. المراحل، الأنواع، والانتقالات (Stages, Types & Transitions)

### المراحل المعتمدة (`OpportunityStage`)
| المفتاح | التسمية العربية | التسمية الإنجليزية | التصنيف |
|---|---|---|---|
| `new` | فرصة جديدة | New Opportunity | مفتوحة (`open`) |
| `qualification` | قيد الدراسة | Qualification | مفتوحة (`open`) |
| `proposal` | إعداد / تقديم عرض | Proposal | مفتوحة (`open`) |
| `negotiation` | تفاوض / مراجعة | Negotiation | مفتوحة (`open`) |
| `won` | ناجحة | Won | مغلقة (`closed`) |
| `lost` | غير ناجحة | Lost | مغلقة (`closed`) |

### أنواع الفرص (`OpportunityType`)
- `service`: خدمة / تنفيذ (`Service`)
- `consulting`: استشارات (`Consulting`)
- `retainer`: عقد شهري / اشتراك (`Retainer`)
- `partnership`: شراكة / تعاون (`Partnership`)
- `project`: مشروع محدد (`Project`)
- `other`: أخرى (`Other`)

### قواعد الانتقال وإغلاق/إعادة فتح الفرصة
- **الانتقال بين المراحل المفتوحة (`new` ↔ `qualification` ↔ `proposal` ↔ `negotiation`)**: يتم مباشرة عبر السحب والإفلات (Drag & Drop) في لوحة Kanban أو عبر قائمة تغيير المرحلة المنسدلة أو شريط المراحل في صفحة التفاصيل، مع توليد حدث `stage_changed` تلقائياً.
- **إغلاق الفرصة (`won` أو `lost`)**: يتطلب تأكيداً صريحاً عبر نافذة `OpportunityCloseModal`، مع إمكانية تدوين سبب عدم النجاح (`lostReason`) وملاحظة الإغلاق، وتسجيل `closedAt` وحدث `closed_won` أو `closed_lost`.
- **إعادة فتح الفرصة (`reopen`)**: يتطلب تأكيداً صريحاً واختيار المرحلة المفتوحة المستهدفة، ويمسح `closedAt` و`lostReason` مع تسجيل `reopenedAt` وحدث `reopened`.
- **منع تكرار الحدث الأولي عند إعادة المحاولة**: يستخدم الحدث الأولي معرّفاً حتمياً `evt_init_${opportunity.id}` لضمان عدم إنشاء أحداث مكررة عند إعادة المزامنة بعد انقطاع الاتصال.

---

## 4. الدقة المالية وتعدد العملات (Multi-Currency & Minor-Unit Math)

- العملات المدعومة: `JOD` (3 خانات عشرية)، `SAR`, `USD`, `EUR`, `AED`, `EGP` (خانتان عشريتان).
- تستخدم الدوال `toMinorUnits` و`fromMinorUnits` و`aggregateValuesByCurrency` حسابات الأعداد الصحيحة للوحدات الصغرى (Minor Units) لمنع أخطاء الفاصلة العائمة (`0.1 + 0.2`)، مع احترام العملات ذات 3 خانات عشرية مثل الدينار الأردني (`JOD`).
- **منع خلط العملات**: لا يتم جمع قيم الفرص ذات العملات المختلفة في رقم واحد؛ تُعرض الإجماليات مفصولة لكل عملة مع تنبيه واضح بعدم تطبيق أسعار صرف افتراضية.

---

## 5. التكامل مع المنظومة الحالية (Cross-Module Integration)

1. **ملف العميل الشامل (`Client 360 Workspace`)**:
   - تبويب جديد **«فرص الأعمال»** يعرض الفرص المفتوحة والمغلقة الخاصة بالعميل، وإجمالي القيم التقديرية مفصولة حسب العملة، وزر **«فرصة جديدة لهذا العميل»**.
   - عند حذف العميل، يعرض مربع التأكيد عدد الفرص المرتبطة به ويوضح أنها لن تُحذف تلقائياً (تُعرض الفرصة اليتيمة بأمان مع شارة «عميل محذوف أو غير متاح»).
2. **الاجتماعات (`MeetingsView`) والمهام (`TasksView`)**:
   - إمكانية ربط الاجتماع أو المهمة بفرصة عمل تابعة **لنفس العميل حصراً** (`canLinkRecordToOpportunity`).
   - إذا غيّر المستخدم العميل في نموذج الاجتماع أو المهمة، يتم مسح `opportunityId` غير المتطابق تلقائياً.
   - فك ارتباط اجتماع أو مهمة من الفرصة، أو حذف الفرصة نفسها، يزيل `opportunityId` فقط **دون حذف الاجتماع أو المهمة**.
   - استخراج القرارات المعتمدة من الاجتماعات المرتبطة وعرضها داخل مساحة عمل الفرصة (`extractRelatedDecisionsFromMeetings`).
   - تحويل «الخطوة التالية» (`nextAction` + `nextActionDate`) بضغطة واحدة إلى مهمة حقيقية مرتبطة بالعميل والفرصة (`convertNextActionToTaskDraft`).
3. **مركز المتابعة اليومي («يومي — TodayView»)**:
   - قسم مخصص لفرص الأعمال التي تحتاج متابعة (`opportunity_overdue_action`, `opportunity_closing_soon`, `opportunity_missing_next_action`, `opportunity_stale`).
   - تكامل تام مع محرك التذكيرات الذكي (`evaluateReminders`) لدعم الغفوة (`Snooze`) والحل (`Dismiss/Resolve`) وإعادة التفعيل التلقائي عند تغير بصمة الفرصة (`computeOpportunityFingerprint`).
   - **قاعدة صارمة**: الفرص المغلقة (`won` / `lost`) لا تُولّد أي تنبيهات تأخر أو نقص متابعة.
4. **لوحة المعلومات (`DashboardView`) والبحث الشامل (`SearchModal`)**:
   - بطاقة «ملخص فرص الأعمال» في لوحة المعلومات تعرض عدد الفرص المفتوحة والفائزة والتي تحتاج متابعة وإجماليات العملات، **دون المساس بمؤشرات أو رسوم أو تصدير CSV الخاصة بـ Task 007**.
   - البحث الشامل يدعم البحث في عنوان الفرصة، والوصف، والخطوة التالية، والمصدر، واسم العميل.

---

## 6. قواعد الأمان (`firestore.rules`) وحالة النشر

- تم تحديث `firestore.rules` و`firebase-blueprint.json` محلياً لإضافة قواعد التحقق الصارمة لـ `/users/{userId}/opportunities/{opportunityId}` و`/users/{userId}/opportunityStageEvents/{eventId}` والحقل الاختياري `opportunityId` في الاجتماعات والمهام والتذكيرات.
- **التزام تشغيلي**: لم يتم نشر قواعد Firestore (`firestore.rules`) إلى الإنتاج في هذه المهمة التزاماً بتعليمات الحوكمة، ويجب نشرها عبر بوابة إعداد مستقلة قبل تفعيل الميزة على قاعدة البيانات السحابية الحية.
