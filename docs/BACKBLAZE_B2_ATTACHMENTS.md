# تكامل التخزين السحابي الآمن Backblaze B2 (Task 004-A & Fix-01)

## 1. القدرات الخادمية المتاحة في Google AI Studio

يدعم مشروع **مُرافق — Murafiq** داخل بيئة Google AI Studio التشغيل الموحّد (Full-Stack Node.js Express + Vite) على المنفذ `3000`:
- خادم Express في `server.ts` يتولى نقاط النهاية `/api/attachments/*` وخدمة واجهة React عبر `vite.middlewares` في التطوير (`npm run dev`) أو `dist/` في الإنتاج (`npm run start` عبر `node server.ts` على Node 22).
- يوفّر الخادم فحص الصحة على `GET /api/health` متضمناً حالة التهيئة المنطقية فقط (`b2Configured`, `firebaseAdminConfigured`, `firestoreDatabaseId`) دون كشف أي مفاتيح أو قيم سرية.
- في حال غياب أسرار Backblaze B2 أو صلاحية Firebase Admin لقاعدة البيانات المسماة، يعيد الخادم استجابة واضحة ومفهومة (`503 STORAGE_NOT_CONFIGURED` أو `503 FIREBASE_ADMIN_NOT_CONFIGURED`) دون إسقاط الواجهة أو كشف بيانات حساسة.

---

## 2. البنية الأمنية المعتمدة (بما في ذلك إصلاحات Task 004-A-Fix-01)

1. **عدم تعرض الواجهة لمفاتيح B2 أو مفاتيح Firebase Admin إطلاقاً**:
   - لا يحتوي كود `src/components` أو `src/services` أو `src/utils` أو حزمة `dist/` على `B2_APPLICATION_KEY_ID` أو `B2_APPLICATION_KEY` أو `FIREBASE_SERVICE_ACCOUNT_JSON` أو حزمة `@aws-sdk/client-s3`.
   - تتعامل الواجهة فقط مع نقاط `/api/attachments/*` وتستخدم `Authorization: Bearer <Firebase ID Token>`.

2. **الهوية والملكية وقاعدة البيانات المسماة حصرياً**:
   - يتحقق الخادم من `Firebase ID Token` عبر `firebase-admin/auth` ويستخرج `uid` حصرياً من التوكن الموثق، ويرفض أي طلب يحاول تمرير `uid` أو `userId` أو `storageKey` أو `uploadStatus` أو `deleteStatus` من الواجهة (`403`).
   - تستهدف جميع عمليات العميل والخادم قاعدة Firestore المسماة حصرياً:
     `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`
     تحت المسار `users/{uid}/meetings/{meetingId}` مع منع الرجوع إلى `(default)` صراحةً في `src/server/firebaseServerAuth.ts` و`src/services/firebase.ts`.

3. **اعتماد المرفقات عبر الخادم فقط (Server-Authoritative Metadata Commit)**:
   - عند طلب `/api/attachments/presign-upload`، ينشئ الخادم سجل نية رفع موثقاً (`UploadIntent`) في `users/{uid}/meetings/{meetingId}/uploadIntents/{attachmentId}` بالحالة `pending`.
   - بعد الرفع إلى Backblaze B2 (مباشرة عبر Presigned `PUT` أو عبر مسار التمرير الموثق `PUT /api/attachments/relay-upload` عند حجب CORS)، تستدعي الواجهة `/api/attachments/complete-upload`.
   - يتحقق الخادم في `complete-upload` من `UploadIntent` ومن وجود الملف في B2 ومن حجمه الفعلي وتوقيعه الثنائي (**Magic Bytes**)، ثم يثبّت سجل `MeetingAttachment` داخل قاعدة البيانات المسماة باستخدام **Firebase Admin SDK Transaction** ويحوّل حالة `UploadIntent` إلى `committed`.
   - تكرار استدعاء `complete-upload` بنفس المعرّف يتصرف بشكل **Idempotent** ويعيد السجل المثبّت دون تكرار، وإذا فُقدت استجابة الشبكة أثناء التثبيت تُعيد الواجهة المحاولة بأمان **ولا تستدعي أبداً** مسار التنظيف على عملية محتملة النجاح.
   - في `firestore.rules`: القراءة والكتابة على `uploadIntents` محظورتان تماماً من المتصفح (`allow read, write: if false`)، ومجموعة `attachments` تسمح بقراءة المالك فقط وتمنع الإنشاء أو التعديل أو الحذف المباشر من المتصفح (`allow create, update, delete: if false`).

4. **حماية مسار التنظيف المؤقت `/api/attachments/cleanup-uncommitted` ومنع سباقات التزامن**:
   - يعمل تحت قفل تسلسلي لكل مرفق (`withAttachmentLock`) ويتحقق عبر Transaction من حالة `UploadIntent` وسجل `attachments`.
   - إذا كان المرفق قد ثُبّت بالفعل (`committed` أو `deleted`)، يرفض الخادم التنظيف بـ `409 ATTACHMENT_ALREADY_COMMITTED` ولا يمس الملف في B2 أبداً.
   - فقط الحالات المعلقة (`pending`) يجوز تحويلها إلى `abandoned` ثم حذف كائنها المؤقت من B2.

5. **حذف منسق وقابل للاسترداد من الخادم (`/api/attachments/delete`)**:
   - يدير الخادم دورة الحياة: `active` ← `deleting` ← حذف B2 ← `b2_deleted` (أو `delete_failed` عند فشل B2) ← حذف سجل `MeetingAttachment` وتحويل `UploadIntent` إلى `deleted`.
   - إذا فشل حذف B2 (`502 B2_DELETE_FAILED`) يبقى سجل Firestore مع حالة `delete_failed` ورسالة عربية واضحة تتيح إعادة المحاولة بأمان.
   - إذا نجح حذف B2 ثم تعذر حذف Firestore (`502 FIRESTORE_DELETE_INCOMPLETE`) يبقى السجل بحالة `b2_deleted` وتتيح الواجهة زر «إكمال الحذف»؛ وعند إعادة المحاولة يتخطى الخادم حذف B2 (أو يعامله كـ idempotent عند `404/NoSuchKey`) ويكمل تنظيف Firestore بنجاح.
   - أي طلب حذف مكرر لمرفق تم حذفه مسبقاً يعيد `200` (`alreadyDeleted: true`) بأمان.

6. **التمرير الموثّق عبر الخادم (Same-Origin Relay Fallbacks) وعزل الذاكرة المؤقتة لروابط التنزيل**:
   - عند تعذر `PUT` المباشر لـ Backblaze B2 بسبب CORS، تسقط الواجهة تلقائياً إلى `PUT /api/attachments/relay-upload` بنفس المعايير الأمنية.
   - عند تعذر العرض/التنزيل المباشر عبر Presigned `GET`، تستخدم الواجهة `POST /api/attachments/relay-download` مع ترويسات `X-Content-Type-Options: nosniff` و`Cache-Control: private, no-store, no-cache, must-revalidate`.
   - تُعزل ذاكرة روابط التنزيل المؤقتة (`src/utils/attachmentDownloadCache.ts`) حسب `uid:meetingId:attachmentId:disposition`، وتُمسح تلقائياً عند تسجيل الخروج أو تغيّر حساب Google أو انتهاء الجلسة.

7. **التحقق الثنائي والروابط القصيرة العمر**:
   - الأنواع المسموحة: `image/jpeg`، `image/png`، `image/webp`، `application/pdf` بحد أقصى `10 MB` (`10,485,760` بايت).
   - مدة صلاحية رابط الرفع `PUT`: `120` ثانية؛ ورابط العرض/التنزيل `GET`: `180` ثانية.

---

## 3. التوافق مع وضع عدم الاتصال (Offline-First)

- رفع المرفقات وعرضها وتنزيلها وحذفها يتطلب اتصالاً نشطاً بالإنترنت (`navigator.onLine`).
- لا تُخزَّن محتويات المرفقات أو روابطها المؤقتة في `IndexedDB` أو `localStorage`.
- الحفاظ الكامل على سلوك Task 003 الخاص بالمزامنة ومنع فقدان البيانات للعملاء واللقاءات والمهام والملاحظات.

---

## 4. متطلبات الإعداد اليدوي المطلوبة من مالك المنتج قبل التشغيل الحي

1. **إعداد أسرار Backblaze B2 في Google AI Studio Secrets**:
   - `B2_APPLICATION_KEY_ID`
   - `B2_APPLICATION_KEY`
   - `B2_BUCKET_NAME=Murafiq`
   - `B2_REGION=us-east-005`
   - `B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com`

2. **توفير صلاحية خادم Firebase Admin للوصول إلى قاعدة البيانات المسماة**:
   - إضافة السر `FIREBASE_SERVICE_ACCOUNT_JSON` (أو `GOOGLE_APPLICATION_CREDENTIALS`) لحساب خدمة ضمن المشروع السحابي `gen-lang-client-0264525417` يمتلك صلاحية القراءة والكتابة على قاعدة البيانات المسماة `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475` (`roles/datastore.user` أو دور Firebase Admin)، لأن حساب تشغيل الحاوية الافتراضي لا يملك صلاحية Admin Write على المشروع السحابي تلقائياً.

3. **نشر قواعد `firestore.rules` المحدثة على المشروع السحابي**:
   - بعد مراجعة واعتماد التغييرات، يلزم نشر `firestore.rules` يدوياً أو عبر مسار النشر المعتمد لتطبيق منع الإنشاء/التعديل/الحذف المباشر من المتصفح على `attachments` وحظر `uploadIntents` تماماً.

4. **ضبط CORS Rules وLifecycle Rules على Bucket `Murafiq` في Backblaze B2**:
   - يُنصح بإضافة قاعدة CORS لنطاق التطبيق الفعلي (`s3_put`, `s3_get`, `s3_head`) للرفع المباشر وتقليل الاعتماد على الـ Relay، وضبط Lifecycle للنسخ المخفية حسب سياسة الاحتفاظ المطلوبة.
