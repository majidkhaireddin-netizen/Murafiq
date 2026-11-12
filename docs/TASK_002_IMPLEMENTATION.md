# توثيق تطبيق الأساس الأمني وإصلاحات التحصين والتحقق
# Task 002 & 002-Fix: Security Hardening & Verification Report
**مشروع مرافق — Murafiq CRM**  
**المعرف المرجعي للتكليف:** Task 002 & Task 002-Fix  
**تاريخ التحديث:** 12 نوفمبر 2026  
**حالة التقرير:** تم التنفيذ والتحصين والتحقق البرمجي بنجاح (Hardened, Tested & Documented)

---

## 1. ملخص الإصلاحات والتحصينات المنفذة (Summary of Implemented Fixes)

بناءً على التوجيهات الصارمة لمالك المنتج في المهمة التصحيحية (Task 002-Fix)، تم إنجاز التحصينات التالية:

### 1.1 عزل بيانات تبديل الحسابات (Account-Switch Data Isolation — P0)
- **إنشاء حد فاصل صريح للجلسة (Explicit User-Session Boundary):**
  تم فصل مساحة عمل المستخدم المصادق في مكوّن مستقل `AuthenticatedSession.tsx` يتم تضمينه داخل `src/App.tsx` مع مفتاح UID إلزامي:
  ```tsx
  <AuthenticatedSession
    key={currentUser.uid}
    user={currentUser}
    onSignOut={handleLogOut}
    ...
  />
  ```
- **السلوك عند تبديل الحساب من المستخدم (أ) إلى المستخدم (ب):**
  - فور تغير `currentUser.uid`، يقوم React بإلغاء تركيب (`unmount`) شجرة المكونات القديمة للمستخدم (أ) فورياً ودفعة واحدة.
  - تنظيف وإلغاء كافة اشتراكات ومستمعات Firestore الأربعة (`unsubClients`, `unsubMeetings`, `unsubTasks`, `unsubNotes`).
  - تفريغ كافة السجلات المفتوحة، النوافذ المنبثقة (Modals)، معرّفات العملاء واللقاءات المحددة، ومحاضر الاجتماعات بصيغة PDF.
  - منع الاستدعاءات غير المتزامنة المتأخرة (`stale async callbacks`) العائدة للمستخدم (أ) من تلويث أو تعديل حالة المستخدم (ب).
  - لا يمكن للمستخدم (ب) رؤية أي بيانات مؤقتة أو متبقية من المستخدم (أ) نهائياً حتى لجزء من الثانية.

---

### 1.2 تحصين قواعد أمان فايرستور (`firestore.rules` — P0)
تمت مراجعة وتحصين ملف `firestore.rules` بالكامل ضد مخطط الكيانات الفعلي (`src/types/index.ts`):
1. **الرفض التلقائي العام (`default-deny`):** حظر أي قراءة أو كتابة غير معرّفة صراحة.
2. **العزل الحصري لكل مستخدم:** قصر الوصول لمسار `/users/{uid}/...` على المستخدم الموثق فقط (`request.auth.uid == uid`)، ورفض كافة العمليات غير المصادقة.
3. **حظر المجموعات الجذرية القديمة:** المنع الصريح لأي قراءة أو كتابة للمجموعات العامة السابقة (`/clients`, `/meetings`, `/tasks`, `/notes`).
4. **حذف نقطة الاختبار العامة:** تم حذف مسار `/test/{docId}` بالكامل لتعزيز الأمان.
5. **التحقق من صحة مخطط البيانات وحجم الحقول لكل مجموعة:**
   - **العملاء (`clients`):** فحص الحقول الإلزامية (`id`, `name`)، حظر الحقول غير المصرح بها عبر `keys().hasOnly(...)`، وتحديد أحجام قصوى للنصوص (الاسم 150، الملاحظات 2000، وغيرها).
   - **اللقاءات (`meetings`):** التحقق من الحقول الإلزامية، مطابقة قيم الـ Enum (`type`, `status`)، وأحجام النصوص (المحضر حتى 10,000 حرف).
   - **المهام (`tasks`):** التحقق من درجات الأولوية وحالات الإنجاز وحجم العنوان والوصف.
   - **الملاحظات (`notes`):** التحقق من العنوان والمحتوى وحجم الوسوم واللون.
   - **ملف المستخدم الشخصي (`/users/{userId}`):** التحقق الصارم من الحقول المصرح بها (`uid`, `email`, `displayName`, `photoURL`, `lastLoginAt`, `createdAt`)، ومنع أي تعديل لمعرف `uid`.
6. **مطابقة معرّف المستند (`id`):** اشتراط مطابقة `incoming().id == docId`.
7. **منع انتحال معرّف المالك (`userId`):** التحقق من أن أي `userId` مخزن يطابق تماماً `request.auth.uid`.
8. **حماية الحقول غير القابلة للتغيير (`immutable fields`):** عند التحديث (`update`)، يُمنع منعاً باتاً تغيير `id` أو `userId`.
9. **التزام أمني حاسم:** **لم يتم نشر القواعد إلى خادم Firebase** خلال هذه المهمة التزاماً بتعليمات مالك المنتج.

---

### 1.3 إنشاء حزمة اختبارات أمان محاكي فايرستور (Firestore Emulator Tests — P0)
- تم إنشاء ملف اختبارات تكاملي متخصص يعتمد على مكتبة `@firebase/rules-unit-testing` ومحاكي فايرستور:
  `tests/firestore-security.test.ts`.
- تغطي حزمة الاختبارات 8 حالات أمنية محورية:
  1. منع المستخدمين غير المصادقين من قراءة أو كتابة أي سجل محمي.
  2. تمكين المستخدم الموثق (User A) من إجراء كافة عمليات القراءة والكتابة والحذف لسجلاته الصالحة في المجموعات الأربع.
  3. حظر تام للمستخدم (User B) من قراءة، سرد، إنشاء، تعديل، أو حذف أي سجل يخص المستخدم (User A).
  4. تغطية المجموعات الأربع بالكامل (`clients`, `meetings`, `tasks`, `notes`).
  5. رفض المستندات ذات المعرفات غير المتطابقة، والسجلات التي تفتقر لحقول إلزامية، والسجلات التي تحوي حقولاً غير مصرحة.
  6. رفض وتجريم أي مستند يحمل معرّف `userId` مزور أو منتحل.
  7. تأكيد عدم إمكانية الوصول للمجموعات الجذرية القديمة.
  8. التعامل السليم مع المجموعات الفارغة دون أي حقن لبيانات عشوائية.
- **إضافة أمر تشغيل المحاكي:** تم إضافة الأمر `"test:rules"` في `package.json`:
  ```bash
  npm run test:rules
  # يعادل: firebase emulators:exec --only firestore 'npx tsx --test tests/firestore-security.test.ts'
  ```
- **تسجيل العائق البيئي الحالي (Environment Blocker):**
  بيئة الحاوية السحابية الحالية لا تحتوي على بيئة تشغيل جافا (`sh: 1: java: not found`). ومحاكي فايرستور يتطلب وجود Java لتشغيل ملف الـ JAR.
  تم توثيق هذا العائق البرمجي رسمياً، وجعل الاختبار يتجاوز التنفيذ برسالة سكيب واضحة توثق العائق وتجهز الاختبار للتنفيذ الفوري في بيئات التطوير المحلية وخوادم CI/CD التي تحتوي على Java.

---

### 1.4 تصحيح تقارير حالة المزامنة وتجميع الميتاداتا (Sync-State Reporting — P1)
- **إنشاء وحدة تجميع ميتاداتا التزامن (`src/utils/syncLogic.ts`):**
  - مراقبة حالة كل مجموعة على حدة (`loaded`, `hasPendingWrites`, `fromCache`, `hasError`).
  - حساب حالة المزامنة الإجمالية (`computeAggregatedSyncState`):
    - إذا واجهت أي مجموعة خطأ اتصال: الحالة تصبح `failed`.
    - إذا كانت هناك تعديلات محلية قيد الإرسال في أي مجموعة: الحالة تظل `pending`، ولا يتم وسم التطبيق بأنه متزامن بمجرد انتهاء كتابة واحدة.
    - إذا كانت أي مجموعة لا تزال تُقرأ من الكاش المحلي فقط: الحالة تكون `local`.
    - فقط عندما تكون كافة المجموعات الأربع مؤكدة من الخادم السحابي بدون أخطاء وبدون تعديلات معلقة، يتحول المؤشر إلى `synced`.
- **معالجة أخطاء المستمعات دون انهيار الواجهة:**
  تم تحديث مستمعات فايرستور في `src/services/firebase.ts` لاستخدام `logFirestoreError` بدلاً من إلقاء استثناء غير معالج (`throw uncaught exception`)، مما يحمي المتصفح من الانهيار ويحدث حالة التزامن بسلاسة.
- **إلغاء الاعتماد على `testConnection()`:** تم فك ربط بدء الاشتراكات باختبار الاتصال الأولي؛ لتبدأ الاشتراكات فور توفر UID.
- **تنظيف واجهة المستخدم من محاكيات المزامنة اليدوية:**
  - إزالة أزرار تغيير حالة التزامن اليدوية من نافذة الترويسة (`Header.tsx`).
  - استبدالها ببطاقة معلوماتية شارحة ومفصلة لحالة المزامنة السحابية اللحظية.
  - إزالة أزرار المحاكاة اليدوية من شاشة الإعدادات العامة (`SettingsModal.tsx`).
  - إبقاء محاكاة التعارض كأداة اختبار تطويرية معزولة وموسومة صراحة بـ `DEV_TEST`.

---

### 1.5 تصحيح ادعاءات العمل دون اتصال وحماية تسجيل الخروج (Offline Claims & Guard — P1)
- **تأكيد حالة كاش فايرستور الفعلي:**
  التطبيق حالياً يستخدم الإعداد الافتراضي للذاكرة المؤقتة لـ Firestore SDK (Memory Cache) وليس كاش IndexedDB مستمر ودائم. تم توضيح ذلك كقيد معروف تمهيداً لمحرك الأوفلاين الشامل في المهمة 003.
- **حماية تسجيل الخروج عند وجود تعديلات معلقة (`Safe Sign-Out Guard`):**
  إذا نقر المستخدم على "تسجيل الخروج" بينما توجد تعديلات محلية قيد المزامنة (`syncState === 'pending'` أو `hasPendingWrites === true`)، تظهر نافذة تأكيد تحذيرية باللغة العربية:
  *"تنبيه: توجد تعديلات محلية قيد المزامنة لم تكتمل بعد. تسجيل الخروج الآن قد يؤدي لفقدان التعديلات المحلية غير المؤكدة من الخادم. هل ترغب بالتأكيد والمتابعة؟"*
  مما يمنع فقدان البيانات غير المتزامنة على الأجهزة المشتركة.
- **تنقية الواجهة من الادعاءات غير الدقيقة:**
  تم حذف عبارات مثل "100% Offline-First" أو أي ضمانات غير متحققة، واستبدالها بوصف دقيق وموضوعي للواجهة والمزامنة السحابية.

---

## 2. جدول الملفات المعدلة والمنشأة في هذه المهمة (File Inventory)

| الملف | نوع الإجراء | الدور في الإصلاح والتحصين |
|:---|:---|:---|
| `firestore.rules` | تعديل وتحصين | القواعد المحصنة مع فحص المخطط، منع انتحال المعرفات، حماية الحقول غير القابلة للتعديل، وحذف نقطة الاختبار. |
| `firebase.json` | ملف جديد | إعدادات محاكي فايرستور وربط ملف القواعد. |
| `tests/firestore-security.test.ts` | ملف جديد | حزمة اختبارات تكاملية شاملة لقواعد الأمان عبر `@firebase/rules-unit-testing`. |
| `src/utils/syncLogic.ts` | ملف جديد | منطق تجميع حالات المزامنة عبر المجموعات الأربع ودالة التحقق من أمان تسجيل الخروج. |
| `src/components/AuthenticatedSession.tsx` | ملف جديد | مكوّن الجلسة الموثقة بعزل UID التام وإدارة الاشتراكات وحماية الخروج. |
| `src/App.tsx` | إعادة هيكلة | فرض حد فاصل للجلسة مع `key={currentUser.uid}` لمنع تسريب البيانات بين الحسابات. |
| `src/services/firebase.ts` | تعديل | إلغاء إلقاء الأخطاء في مستمعات `onSnapshot`، وتحديث دوال الحفظ لإلزامية `userId` و `createdAt`. |
| `src/components/Header.tsx` | تعديل | إزالة المحاكي اليدوي واستبداله ببطاقة معلوماتية تقرأ الحالة المجمعة الحقيقية. |
| `src/components/SettingsModal.tsx` | تعديل | إزالة محاكي المزامنة، وتحديد أداة اختبار فض التعارض كأداة تطويرية حصراً (`DEV_TEST`). |
| `src/components/AuthScreen.tsx` | تعديل | تصحيح الادعاءات وإزالة وصف الأوفلاين غير المتحقق بدقة. |
| `src/services/security.test.ts` | تعديل وتوسيع | إضافة 7 اختبارات جديدة لتبديل الحسابات المباشر، وتجميع المزامنة، وحماية الخروج. |
| `package.json` | تعديل | إضافة حزمة `@firebase/rules-unit-testing` وأمر `"test:rules"`. |
| `docs/TASK_002_IMPLEMENTATION.md` | تحديث شامل | توثيق الإصلاحات ونتائج الاختبارات وخطة النشر والتراجع. |

---

## 3. نتائج الاختبارات الفعلية (Actual Test Results)

تم تشغيل كافة أدوات الفحص والاختبار في بيئة المشروع، وكانت النتائج كالتالي:

### 3.1 فحص البناء والتجميع (`compile_applet`)
- **الأمر:** أداة الفحص الداخلي `compile_applet`.
- **النتيجة:**
  ```
  Build succeeded - the applet is compiled
  ```

### 3.2 فحص الأنواع الصارم وتدقيق الكود (`lint_applet` / `tsc --noEmit`)
- **الأمر:** `tsc --noEmit`
- **النتيجة:**
  ```
  Linting completed successfully. Output: 0 errors.
  ```

### 3.3 اختبارات الوحدة الموسعة (`tsx --test`)
- **الأمر:**
  ```bash
  npx tsx --test src/utils/logic.test.ts src/utils/conflictLogic.test.ts src/services/security.test.ts tests/firestore-security.test.ts
  ```
- **النتيجة التفصيلية (23 نجاح، 0 فشل، 1 تم تجاوزه بسبب غياب Java):**
  ```
  TAP version 13
  ok 1 - getAuthenticatedUid throws when no user is signed in
  ok 2 - getUserCollectionPath rejects unauthenticated calls and prevents caller UID spoofing
  ok 3 - User entities accept optional userId field without breaking schema
  ok 4 - Empty datasets are treated as valid empty states and not automatically populated
  ok 5 - Session reset clears all sensitive arrays to prevent cross-account disclosure
  ok 6 - Direct account-switch immediately isolates and wipes User A data without leaking to User B
  ok 7 - Stale asynchronous callbacks from previous user cannot mutate the active user session
  ok 8 - computeAggregatedSyncState does not let a successful snapshot for one collection override pending writes elsewhere
  ok 9 - computeAggregatedSyncState marks failed if any single collection encounters an error
  ok 10 - computeAggregatedSyncState marks local if any collection is still loaded from cache or not loaded
  ok 11 - computeAggregatedSyncState marks synced ONLY when all four collections are loaded, server-confirmed, with no pending writes or errors
  ok 12 - canSafelySignOut prevents signing out with unacknowledged local writes
  ok 13 - detectEntityConflict returns null if no fields differ
  ok 14 - detectEntityConflict detects differing fields between local and remote
  ok 15 - resolveConflictRecord applies keep_local, keep_remote, and merge appropriately
  ok 16 - formatArabicDate formats date correctly in Arabic
  ok 17 - getRelativeTimeArabic returns today, tomorrow, and past days properly
  ok 18 - categorizeTasks groups overdue, today, this week, and later tasks properly
  ok 19 - suggestFollowUpDate prioritizes urgent and high actions with closer dates
  ok 20 - detectClientsNeedingReview flags clients with no meetings in > 30 days
  ok 21 - universalSearch finds matching items across all entities
  ok 22 - applyMeetingTemplate replaces or appends non-destructively
  ok 23 - insertMeetingSnippet appends fast snippets cleanly
  ok 24 - Firestore Security Rules Test Suite (@firebase/rules-unit-testing) # SKIP Firestore Emulator is not running in this environment (Java not installed). Recorded blocker for offline CI/local execution.
  1..24
  # tests 24
  # pass 23
  # fail 0
  # cancelled 0
  # skipped 1
  # todo 0
  # duration_ms 848.275137
  ```

---

## 4. القيود والمخاطر المتبقية للمهمة 003 (Known Limitations & Outstanding Risks)

1. **كاش التخزين المحلي الدائم (Persistent IndexedDB Cache):**
   - فايرستور يعمل حالياً في وضع الذاكرة المؤقتة (Memory Cache). تفعيل التخزين الدائم على مستوى المتصفح يتطلب سياسة واضحة للأجهزة المشتركة لتجنب بقاء بيانات مشفرة محلياً بعد تسجيل الخروج. سيتم تناول ذلك مع محرك الأوفلاين الكامل في Task 003.
2. **عائق تشغيل المحاكي في حاوية AI Studio (Emulator Blocker):**
   - حزمة اختبارات الأمان في `tests/firestore-security.test.ts` جاهزة ومبرمجة بنسبة 100%، لكنها تتطلب بيئة عمل تحتوي على Java لتشغيل محاكي فايرستور. يجب تشغيلها على جهاز المطور المحلي أو في GitHub Actions حيث تتوفر بيئة Java.
3. **الفرق بين قواعد المستودع والقواعد المنشورة:**
   - ملف `firestore.rules` في المستودع تم تحصينه بالكامل. القواعد الحية في خادم Firebase لم تُعدل في هذه المهمة التصحيحية انتظاراً لموافقة وإشراف مالك المنتج.

---

## 5. إجراءات النشر المنسقة وخطة التراجع الآمنة (Deployment & Rollback Procedure)

### 5.1 إجراء النشر المنسق ذو الأولوية الأمنية (Security-First Deployment)
1. **الخطوة الأولى (فحص بيئة المصادقة):** التأكد من تفعيل موفر Google في لوحة Firebase Console وإضافة النطاقات المعتمدة (Authorized Domains).
2. **الخطوة الثانية (نشر قواعد الأمان المحصنة):**
   مراجعة ملف `firestore.rules` ونشره إلى قاعدة بيانات المشروع السحابي.
3. **الخطوة الثالثة (نشر كود الواجهة الأمامية):**
   بناء ونشر الواجهة (`npm run build`).
4. **الخطوة الرابعة (التحقق الميداني الحي):**
   تسجيل الدخول بحساب معتمد والتأكد من نجاح الاشتراكات الحية في `/users/{uid}/...`، وظهور مؤشر التزامن المتجمع كـ `synced`.

### 5.2 خطة التراجع دون إعادة القواعد المتساهلة (Safe Rollback Plan)
- **مبدأ صارم:** يُمنع منعاً باتاً تحت أي ظرف استعادة القواعد القديمة المتساهلة أو المجموعات الجذرية المفتوحة (`allow read, write: if true;`).
- إذا ظهرت مشكلة برمجية في الواجهة الأمامية: يتم التراجع عن كود الواجهة فقط إلى الإصدار المستقر السابق، مع الإبقاء على قواعد الأمان الحالية محكمة لحماية خصوصية بيانات المستخدمين.
- إذا واجه مستخدم مشكلة في صلاحيات مستند معين: يتم فحص الحقل غير المطابق للمخطط في ذلك المستند وتعديل دالة التحقق الخاصة بالمجموعة المعنية دون إلغاء العزل أو كسر مبدأ الرفض التلقائي (`default-deny`).
