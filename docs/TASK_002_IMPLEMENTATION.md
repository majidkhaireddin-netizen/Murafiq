# توثيق تطبيق الأساس الأمني: تسجيل الدخول بـ Google وعزل بيانات المستخدمين
# Task 002 Implementation: Google Authentication & Per-User Data Isolation
**مشروع مرافق — Murafiq CRM**  
**المعرف المرجعي للتكليف (Task ID):** Task 002  
**تاريخ الإنجاز (Completion Date):** 12 نوفمبر 2026  
**حالة التقرير:** تم التنفيذ والتحقق البرمجي بنجاح (Verified & Documented)  

---

## 1. ملخص التغييرات (Summary of Changes)

تنفيذاً للقرارات المعتمدة من مالك المنتج، تم إنجاز الأساس الأمني والإنتاجي الأول لتطبيق «مُرافق»، وتلخيصه كالتالي:

1. **المصادقة الإلزامية بحساب Google (Mandatory Google Auth):**
   - تم دمج دورة حياة Firebase Authentication بالكامل عبر مراقبة `onAuthStateChanged`.
   - لا يُسمح بأي حسابات زوار أو مجهولة (Zero Anonymous Accounts in v1).
   - تصميم وعرض شاشة دخول عربية احترافية (`AuthScreen.tsx`) تدعم اتجاه اليمين إلى اليسار (RTL) وتتسق تماماً مع الهوية البصرية لـ «مُرافق».
   - إظهار حالة تحميل هادئة ومريحة أثناء استعادة الجلسة، والتعامل الذكي مع أخطاء النوافذ المنبثقة المحظورة أو إغلاق النافذة من قِبل المستخدم.

2. **عزل بيانات المستخدمين بالكامل (Per-User Firestore Isolation):**
   - استبدال كافة استعلامات ومستمعات المجموعات الجذرية المشتركة السابقة بمسارات معزولة ومحمية حصرياً تحت:
     `/users/{uid}/clients/{clientId}`  
     `/users/{uid}/meetings/{meetingId}`  
     `/users/{uid}/tasks/{taskId}`  
     `/users/{uid}/notes/{noteId}`  
   - منع أي تمرير عشوائي لـ `userId` من الواجهة؛ حيث تستخلص كافة دوال القراءة والكتابة معرّف المستخدم المعتمد حصرياً من جلسة `auth.currentUser.uid`.
   - تنظيف كافة السجلات والبيانات الحساسة من الذاكرة (`in-memory`) فور تسجيل الخروج لمنع أي تسريب بين الحسابات على الأجهزة المشتركة.

3. **إلغاء الحقن التلقائي للبيانات التجريبية (No Auto-Seeding):**
   - تبدأ الحسابات الجديدة بحسابات فارغة ونظيفة تماماً (`[]`).
   - إلغاء السلوك القديم الذي كان يعيد حقن البيانات التجريبية تلقائياً عند كون المجموعات فارغة.
   - إلغاء زر إعادة التعيين التدميري القديم من الإعدادات، والإبقاء على ملف `mockData.ts` للاختبارات المعزولة فقط.
   - عدم المساس أو الحذف أو التعديل لأي سجلات سابقة في قاعدة البيانات الحالية.

4. **تحديث ملف قواعد الأمان (`firestore.rules`):**
   - صياغة قواعد أمان صارمة تعتمد مبدأ الرفض التلقائي (`default-deny`).
   - حظر الوصول للمجموعات القديمة المشتركة من قِبل واجهات العملاء.
   - قصر الوصول لبيانات ومستندات كل مستخدم على صاحب الحساب نفسه (`request.auth.uid == userId`)، مع التحقق الدقيق من مطابقة معرّف المستند والحقول الإلزامية وطول النصوص.
   - **الالتزام بالقيد الأمني:** تم تحديث ملف `firestore.rules` في المستودع البرمجي، **ولم يتم نشره** إلى مشروع Firebase الحي انتظاراً للمراجعة والاعتماد البشري.

5. **توضيح القفل البيومتري كعرض تجريبي (Clarification of Demo Lock):**
   - وسم قفل الـ PIN/البصمة صراحة في واجهة المستخدم والإعدادات بأنه "قفل شاشة تجريبي (عرض توضيحي فقط)" لمنع التضليل أو الخلط بينه وبين الأمان الحقيقي المعتمد على Google Auth.

---

## 2. قائمة الملفات المعدلة والمنشأة (Modified & Created Files)

| الملف | نوع التعديل | الدور والوظيفة |
|:---|:---|:---|
| `src/types/index.ts` | تعديل | إضافة حقل `userId?: string` لكافة كيانات `Client`, `Meeting`, `ActionItem`, `Note`. |
| `src/services/firebase.ts` | تعديل جوهري | إضافة دوال `signInWithGoogle`, `logOut`, `subscribeAuthState`, ودوال القراءة والكتابة والمستمعات المعزولة بمسار المستخدم `/users/{uid}/...` مع تتبع ميتاداتا التزامن (`fromCache`, `hasPendingWrites`). |
| `src/components/AuthScreen.tsx` | ملف جديد | شاشة تسجيل الدخول العربية الاحترافية بزر الدخول عبر Google ورسائل الخطأ الذكية وحالات التحميل. |
| `src/components/Header.tsx` | تعديل | إضافة صورة واسم المستخدم المسجل وزر تسجيل الخروج، وتوضيح وسم القفل البيومتري التجريبي. |
| `src/components/SettingsModal.tsx` | تعديل | إزالة زر الحقن التلقائي التدميري وتوضيح أن قفل PIN هو محاكاة تجريبية لشاشة الجهاز. |
| `src/App.tsx` | تعديل جوهري | ربط دورة حياة المصادقة، عدم تهيئة الاشتراكات قبل وجود `currentUser.uid`، تنظيف الذاكرة عند الخروج، وعرض شاشة الدخول أو التطبيق الرئيسي. |
| `firestore.rules` | تعديل | تحديث القواعد لتأمين `/users/{userId}/...` وحظر المجموعات الجذرية القديمة مع التحقق من صحة المدخلات. |
| `firebase-blueprint.json` | تعديل | تحديث مخطط الـ IR ليعكس المسارات المعزولة الجديدة. |
| `src/services/security.test.ts` | ملف جديد | اختبارات وحدة آلية للتحقق من رفض العمليات غير المصادقة، ومنع انتحال UID، وتنظيف البيانات عند الخروج. |
| `docs/TASK_002_IMPLEMENTATION.md` | ملف جديد | وثيقة التقرير والتنفيذ الشاملة (هذا الملف). |

---

## 3. مسار وتدفق المصادقة (Authentication Flow)

```
                       ┌───────────────────────────────┐
                       │     بدء تشغيل تطبيق مُرافق    │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │ isAuthRestoring = true        │
                       │ عرض شاشة الاستعادة الهادئة     │
                       └───────────────┬───────────────┘
                                       │
                         [onAuthStateChanged(auth)]
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
             [user == null]                       [user != null]
                     │                                   │
                     ▼                                   ▼
       ┌───────────────────────────┐       ┌───────────────────────────┐
       │ عرض شاشة الدخول AuthScreen│       │ حفظ currentUser في الحالة  │
       │ زر: المتابعة بحساب Google │       └─────────────┬─────────────┘
       └─────────────┬─────────────┘                     │
                     │                                   ▼
             [signInWithPopup]             ┌───────────────────────────┐
                     │                     │ تهيئة مستمعات Firestore:  │
                     ▼                     │ /users/{uid}/clients      │
       [نجاح تسجيل الدخول وانتقال    │ /users/{uid}/meetings     │
        الجلسة إلى user != null]           │ /users/{uid}/tasks        │
                                           │ /users/{uid}/notes        │
                                           └───────────────────────────┘
```

### معالجة الأخطاء الاستثنائية:
- في حال حظر النوافذ المنبثقة من قِبل المتصفح (`auth/popup-blocked`): يظهر تنبيه عربي واضح: *"حظر المتصفح النافذة المنبثقة. يُرجى السماح بالنوافذ المنبثقة لموقع التطبيق والمحاولة مجدداً."*
- في حال إغلاق النافذة من قِبل المستخدم (`auth/popup-closed-by-user`): يتم تفريغ حالة التحميل بهدوء دون إظهار أخطاء فادحة.
- في حال عدم اعتماد النطاق (`auth/unauthorized-domain`): تظهر رسالة إرشادية للمطور تفيد بوجوب إضافة النطاق في Firebase Console.

---

## 4. هيكلية مسارات Firestore النهائية (Final Firestore Path Structure)

تم تنظيم مسارات البيانات بنمط تسلسلي صارم يضمن العزل التام:

```
/users/{uid}                                    [ملف المستخدم الأساسي: email, displayName, lastLoginAt]
    │
    ├── /clients/{clientId}                     [عملاء المستخدم المصادق فقط]
    │
    ├── /meetings/{meetingId}                   [لقاءات ومحاضر المستخدم فقط]
    │
    ├── /tasks/{taskId}                         [مهام والتزامات المستخدم فقط]
    │
    └── /notes/{noteId}                         [ملاحظات وقوائم المستخدم فقط]
```

- لا توجد أي قراءة أو كتابة على المجموعات الجذرية السابقة.
- معرّف المستند في الرابط يجب أن يطابق تماماً حقل `id` داخل المستند، لمنع التناقضات وحقن مستندات بمعرفات مزورة.

---

## 5. تصميم قواعد الأمان في `firestore.rules` (Security Rules Design)

تعتمد القواعد المطورة في `firestore.rules` 5 ركائز دفاعية:

1. **الرفض التلقائي العام:**
   ```javascript
   match /{document=**} {
     allow read, write: if false;
   }
   ```
2. **قفل المجموعات الجذرية القديمة:**
   ```javascript
   match /clients/{clientId} { allow read, write: if false; }
   match /meetings/{meetingId} { allow read, write: if false; }
   match /tasks/{taskId} { allow read, write: if false; }
   match /notes/{noteId} { allow read, write: if false; }
   ```
3. **التحقق الحصري من المالك:**
   ```javascript
   function isOwner(userId) {
     return request.auth != null && request.auth.uid == userId;
   }
   ```
4. **منع انتحال معرّف المستند وثباته عند التحديث:**
   - في الإنشاء (`create`): يجب أن يطابق `incoming().id == docId`.
   - في التحديث (`update`): يجب أن يظل المعرّف ثابتاً `incoming().id == existing().id`.
5. **التحقق البنيوي الحزمي من صحة الحقول (Data Type & Schema Validation):**
   - التحقق من نوع وحجم الأسماء، العناوين، أرقام الهواتف، وحقول الـ Enum مثل أنواع اللقاءات (`in_person`, `phone`, `video`, `chat`)، حالات المهام، ودرجات الأولوية.

---

## 6. سلوك العمل دون اتصال والقيود الحالية (Offline-First Behavior & Limitations)

### السلوك الفعلي المتحقق:
- يحافظ التطبيق على كاش Firestore المحلي في المتصفح.
- لا يتم حظر الوصول إلى البيانات المخزنة محلياً إذا فشل اختبار الاتصال الخارجي الأولي؛ حيث يتم التحول تلقائياً إلى حالة `local`.
- قراءة البيانات من المستمعات تتضمن الآن معالجة ميتاداتا التزامن (`includeMetadataChanges: true`):
  - إذا كانت التعديلات لا تزال معلقة في انتظار الرفع (`hasPendingWrites: true`)، يُعرض مؤشر التزامن كـ `pending` (قيد المزامنة).
  - إذا كانت البيانات مقروءة من الذاكرة المحلية دون اتصال حي (`fromCache: true`)، يُعرض المؤشر كـ `local`.
  - فقط عندما يؤكد الخادم استلام وحفظ البيانات، يتحول المؤشر إلى `synced` (متزامن).

### القيود والاعتبارات المتبقية للأجهزة المشتركة:
- عند تسجيل الخروج، يتم تفريغ مصفوفات الذاكرة الحية فوراً لمنع ظهور بيانات الحساب الأول للحساب الثاني.
- **تنبيه للأجهزة المشتركة:** يعتمد كاش IndexedDB الافتراضي لـ Firestore على المتصفح؛ وفي حال استخدام أكثر من حساب على نفس متصفح الجهاز المشترك، يُوصى في المهام القادمة بتفعيل التخزين المتعدد أو تفريغ الكاش الموضعي لضمان عزل الكاش الفيزيائي تماماً عند تسجيل الخروج.

---

## 7. أوامر الاختبار والنتائج الفعلية (Test Commands & Results)

أُجريت الاختبارات البرمجية محلياً وأظهرت النتائج التالية:

### 1. اختبار التجميع وفحص الأنواع (TypeScript Compilation):
- **الأمر:** `compile_applet` (استدعاء أداة فحص البناء).
- **النتيجة:** `Build succeeded - the applet is compiled` بنجاح تام 0 أخطاء.

### 2. اختبار التدقيق البرمجي (Linting):
- **الأمر:** `lint_applet` (استدعاء أداة الفحص `tsc --noEmit`).
- **النتيجة:** `Linting completed successfully` بنجاح تام 0 أخطاء.

### 3. اختبارات الوحدة الآلية (Automated Unit Tests via `node:test`):
- **الأمر:**
  ```bash
  npx tsx --test src/utils/logic.test.ts src/utils/conflictLogic.test.ts src/services/security.test.ts
  ```
- **النتيجة الفعلية:**
  ```
  TAP version 13
  # Subtest: getAuthenticatedUid throws when no user is signed in
  ok 1 - getAuthenticatedUid throws when no user is signed in
  # Subtest: getUserCollectionPath rejects unauthenticated calls and prevents caller UID spoofing
  ok 2 - getUserCollectionPath rejects unauthenticated calls and prevents caller UID spoofing
  # Subtest: User entities accept optional userId field without breaking schema
  ok 3 - User entities accept optional userId field without breaking schema
  # Subtest: Empty datasets are treated as valid empty states and not automatically populated
  ok 4 - Empty datasets are treated as valid empty states and not automatically populated
  # Subtest: Session reset clears all sensitive arrays to prevent cross-account disclosure
  ok 5 - Session reset clears all sensitive arrays to prevent cross-account disclosure
  # Subtest: detectEntityConflict returns null if no fields differ
  ok 6 - detectEntityConflict returns null if no fields differ
  # Subtest: detectEntityConflict detects differing fields between local and remote
  ok 7 - detectEntityConflict detects differing fields between local and remote
  # Subtest: resolveConflictRecord applies keep_local, keep_remote, and merge appropriately
  ok 8 - resolveConflictRecord applies keep_local, keep_remote, and merge appropriately
  # Subtest: formatArabicDate formats date correctly in Arabic
  ok 9 - formatArabicDate formats date correctly in Arabic
  # Subtest: getRelativeTimeArabic returns today, tomorrow, and past days properly
  ok 10 - getRelativeTimeArabic returns today, tomorrow, and past days properly
  # Subtest: categorizeTasks groups overdue, today, this week, and later tasks properly
  ok 11 - categorizeTasks groups overdue, today, this week, and later tasks properly
  # Subtest: suggestFollowUpDate prioritizes urgent and high actions with closer dates
  ok 12 - suggestFollowUpDate prioritizes urgent and high actions with closer dates
  # Subtest: detectClientsNeedingReview flags clients with no meetings in > 30 days
  ok 13 - detectClientsNeedingReview flags clients with no meetings in > 30 days
  # Subtest: universalSearch finds matching items across all entities
  ok 14 - universalSearch finds matching items across all entities
  # Subtest: applyMeetingTemplate replaces or appends non-destructively
  ok 15 - applyMeetingTemplate replaces or appends non-destructively
  # Subtest: insertMeetingSnippet appends fast snippets cleanly
  ok 16 - insertMeetingSnippet appends fast snippets cleanly
  1..16
  # tests 16
  # suites 0
  # pass 16
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 1017.156571
  ```
  *(تم اجتياز كافة الاختبارات الـ 16 بنسبة نجاح 100%).*

### 4. الفحص البصري التفاعلي (Interactive Browser Verification via Playwright):
- تم تشغيل التطبيق في المتصفح والتحقق من:
  1. ظهور شاشة الاستعادة الهادئة عند بدء التحميل.
  2. الانتقال النظيف لشاشة `AuthScreen` مع زر Google وشعار مُرافق والترجمة العربية.
  3. عدم انطلاق أي اشتراكات سحابية محمية قبل تسجيل الدخول.
  4. التقاط صورة معاينة محفوظة في المستودع: `auth_screen_preview.png`.

---

## 8. الإعدادات اليدوية المطلوبة في Firebase Console (Manual Configuration Required)

لكي يعمل تسجيل الدخول بـ Google في بيئة الإنتاج الحية، يتعين على مالك المشروع التأكد من الخطوتين التاليتين في [لوحة تحكم Firebase](https://console.firebase.google.com/):

1. **تفعيل موفر Google في قسم Authentication:**
   - التوجه إلى `Authentication` > `Sign-in method`.
   - النقر على `Google` وتفعيله (Enabled).
   - تحديد البريد الإلكتروني لدعم المشروع وحفظ الإعدادات.

2. **إضافة النطاق المصرح به (Authorized Domains):**
   - التوجه إلى `Authentication` > `Settings` > `Authorized domains`.
   - التأكد من إضافة نطاق استضافة التطبيق، على سبيل المثال:
     - `ais-dev-sudxkuph2qfmd5hcxgdl7l-537419615721.europe-west2.run.app`
     - `ais-pre-sudxkuph2qfmd5hcxgdl7l-537419615721.europe-west2.run.app`
     - أي نطاق مخصص إضافي يُستخدم للإنتاج.

---

## 9. تسلسل النشر الآمن وخطة التراجع (Deployment Sequence & Rollback Plan)

عند اتخاذ قرار نشر هذا الأساس إلى الإنتاج الحي مستقبلاً، يجب اتباع التسلسل التالي بدقة:

1. **الخطوة الأولى:** إعداد موفر Google والنطاقات المصرح بها في Firebase Console كما هو موضح أعلاه.
2. **الخطوة الثانية:** نشر كود الواجهة الأمامية المحدث (Frontend Deployment).
3. **الخطوة الثالثة:** بعد التأكد من تسجيل دخول المستخدمين على المسارات المعزولة الجديدة `/users/{uid}/...`، يتم نشر ملف `firestore.rules` إلى السحابة.
4. **خطة التراجع (Rollback Plan):**
   - نظراً لأن السجلات القديمة في المجموعات الجذرية لم تُمس ولم تُحذف، في حال حدوث أي طارئ، يمكن التراجع برمجياً إلى الإصدار السابق دون فقدان أي بيانات تاريخية.

---

## 10. القيود المعروفة والمهام القادمة الموصى بها (Known Limitations & Follow-Up Tasks)

1. **ميزة استيراد عينات تجريبية اختيارية:**
   - الحسابات تبدأ حالياً فارغة بنظافة تامة. يوصى في مهمة مستقلة بتوفير خيار داخل الإعدادات بعنوان *"استيراد عملاء واجتماعات تجريبية لحسابي"* لمن يرغب في استكشاف التطبيق سريعاً، على أن تُحقن حصرياً داخل مساره الخاص `/users/{uid}/`.
2. **عزل الكاش المحلي المتقدم (Multi-User Local Cache):**
   - دراسة استخدام واجهات IndexedDB المعزولة لكل مستخدم في حال مشاركة الجهاز نفسه بين أكثر من مستشار أو مستقل.

---

**تأكيد رسمي للسلامة (Safety Confirmation):**  
نؤكد بشكل قاطع أنه **لم يتم تعديل أو حذف أي بيانات حية في قاعدة بيانات Firestore**، و**لم يتم نشر ملف `firestore.rules` إلى السحابة** خلال تنفيذ هذه المهمة، التزاماً تاماً بالقيود الصارمة المحددة.
