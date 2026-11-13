# تكامل التخزين السحابي الآمن Backblaze B2 (Task 004-A)

## 1. القدرات الخادمية المتاحة في Google AI Studio

يدعم مشروع **مُرافق — Murafiq** داخل بيئة Google AI Studio التشغيل الموحّد (Full-Stack Node.js Express + Vite) على المنفذ `3000`:
- خادم Express في `server.ts` يتولى نقاط النهاية `/api/attachments/*` وخدمة واجهة React عبر `vite.middlewares` في التطوير أو `dist/` في الإنتاج.
- يتحمل هذا الخادم التحقق من هوية Firebase ID Token وإصدار روابط التوقيع المؤقتة (S3 Presigned URLs) دون الحاجة لنشر خدمة خارجية منفصلة، مع بقاء المفاتيح السرية في متغيرات بيئة الخادم فقط (`process.env`).
- **متطلبات التشغيل قبل الرفع الحقيقي**: ضبط متغيرات/أسرار Backblaze B2 في لوحة **Secrets** في Google AI Studio، وضبط سياسة CORS على Bucket باسم `Murafiq` في لوحة تحكم Backblaze B2.

---

## 2. البنية الأمنية المعتمدة

1. **عدم تعرض الواجهة لمفاتيح B2 إطلاقاً**:
   - لا يحتوي كود `src/components` أو `src/services` أو حزمة `dist/` على `B2_APPLICATION_KEY_ID` أو `B2_APPLICATION_KEY` أو حزمة `@aws-sdk/client-s3`.
   - تتعامل الواجهة فقط مع نقاط `/api/attachments/*` وتستخدم `Authorization: Bearer <Firebase ID Token>`.

2. **الهوية والملكية من الخادم وقاعدة البيانات المسماة فقط**:
   - يتحقق الخادم من `Firebase ID Token` عبر `firebase-admin/auth` ويستخرج `uid` حصرياً من التوكن الموثق، ويرفض أي طلب يحاول تمرير `uid` أو `userId` أو `storageKey` مزيف من الواجهة (`403`).
   - يتحقق الخادم من ملكية اللقاء داخل قاعدة Firestore المسماة حصرياً:
     `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`
     تحت المسار:
     `users/{uid}/meetings/{meetingId}`
     دون الرجوع أبداً إلى `(default)`.

3. **هيكلة المفاتيح في Backblaze B2**:
   - يولّد الخادم `attachmentId` آمن عشوائياً (`crypto.randomUUID()`) ويبني المفتاح حصراً بالصيغة:
     `users/{uid}/meetings/{meetingId}/attachments/{attachmentId}`

4. **الروابط المؤقتة القصيرة العمر (Short-lived S3 Presigned URLs)**:
   - رابط الرفع `PUT`: صالح لمدة **120 ثانية** فقط ومقيّد بـ `Content-Type` محدد.
   - رابط العرض/التنزيل `GET`: صالح لمدة **180 ثانية** فقط ولا يُخزَّن في Firestore أو `localStorage`.

5. **التحقق الثنائي والمحتوى الفعلي (Validation + Magic Bytes)**:
   - الأنواع المسموحة في الإصدار الأول: `image/jpeg`، `image/png`، `image/webp`، `application/pdf`.
   - الحد الأقصى للحجم: `10 MB` (`10,485,760` بايت).
   - حظر الملفات التنفيذية وHTML وJavaScript وSVG.
   - بعد الرفع المباشر إلى B2، ينفّذ المسار `/api/attachments/complete-upload` فحصاً فعلياً على Backblaze عبر `HeadObject` (للحجم) و`GetObject` بالبايتات الأولى `Range: bytes=0-15` للتحقق من توقيع الملف الفعلي (**Magic Bytes**)، وإذا تبيّن تزوير الصيغة يحذف الخادم الملف فوراً من B2 ويرفض التسجيل في Firestore (`422`).

6. **معالجة الإخفاقات ومنع الملفات اليتيمة**:
   - إذا فشل حفظ البيانات الوصفية في Firestore بعد نجاح الرفع إلى B2، يستدعي التطبيق تلقائياً `/api/attachments/cleanup-uncommitted` لحذف الملف غير المثبت من B2.
   - عند الحذف، يحذف الخادم الملف من Backblaze B2 أولاً؛ وإذا فشل حذف B2 لا يحذف سجل Firestore حتى لا يختفي المرفق عن نظر المستخدم.

---

## 3. التوافق مع وضع عدم الاتصال (Offline-First)

- رفع المرفقات وعرضها وتنزيلها وحذفها يتطلب اتصالاً نشطاً بالإنترنت (`navigator.onLine`).
- إذا كان المستخدم غير متصل، يعرض التطبيق رسالة عربية واضحة أن المرفقات تتطلب اتصالاً بالإنترنت.
- لا تُخزَّن ملفات المرفقات الحساسة تلقائياً في `IndexedDB` أو `localStorage`.
- لا يظهر الملف كمرفق مكتمل في Firestore إلا بعد تأكيد التحقق منه في Backblaze B2.

---

## 4. سلوك Backblaze B2 مع Versioning والحذف (مهم لمالك المنتج)

وفق تصميم Backblaze B2 Cloud Storage:
- إذا كان خيار **File Versioning / Keep all versions** مفعّلاً في إعدادات Bucket (`Murafiq`)، فإن أمر S3 `DeleteObject` لا يمسح النسخة التاريخية فوراً بل يضع علامة إخفاء (**Hide Marker / Hidden Version**) بحيث تتوقف النسخة عن الظهور في القراءة العادية، لكنها تبقى محفوظة وتُحتسب ضمن سعة التخزين حتى انتهاء دورة الحياة (Lifecycle Rule).
- **التوصية المعتمدة لمالك المنتج**:
  - في إعدادات **Lifecycle Rules** للـ Bucket `Murafiq` داخل Backblaze B2:
    - إما اختيار **Keep only the last version of the file** (مع **Days till hide = 0 / delete hidden immediately**)،
    - أو ضبط قاعدة Lifecycle لحذف النسخ المخفية (`daysFromHidingToDeleting: 1`) إذا رُغب في فترة سماح لاسترجاع المحذوفات.
  - تم توثيق ذلك لأن طلبات S3 `DeleteObject` الموقّعة من التطبيق لا تتجاوز سياسة Versioning الخاصة بالـ Bucket بدون تعديل إعدادات Backblaze نفسها.

---

## 5. إعدادات Backblaze B2 اليدوية المطلوبة من مالك المنتج

قبل تفعيل الرفع الحقيقي في الإنتاج أو التجربة الحية:

1. **التحقق من الأسرار في Google AI Studio Secrets** (لا تُضاف أبداً في كود الواجهة):
   - `B2_APPLICATION_KEY_ID`
   - `B2_APPLICATION_KEY`
   - `B2_BUCKET_NAME=Murafiq`
   - `B2_REGION=us-east-005`
   - `B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com`

2. **صلاحيات Application Key في Backblaze B2**:
   - مقصور على Bucket `Murafiq` فقط (`readFiles`, `writeFiles`, `deleteFiles`, `listFiles`).

3. **ضبط CORS Rules على Bucket `Murafiq` (S3 Compatible API)**:
   لأن المتصفح يرفع الملف مباشرة عبر `PUT` إلى `https://s3.us-east-005.backblazeb2.com` باستخدام Presigned URL، يجب إضافة قاعدة CORS في Backblaze B2 (عبر B2 CLI أو لوحة التحكم) تسمح لنطاق التطبيق الفعلي فقط:
   ```json
   [
     {
       "corsRuleName": "murafiq-s3-presigned-attachments",
       "allowedOrigins": [
         "https://<YOUR_AI_STUDIO_OR_APP_DOMAIN>",
         "http://localhost:3000"
       ],
       "allowedOperations": [
         "s3_put",
         "s3_get",
         "s3_head"
       ],
       "allowedHeaders": [
         "content-type",
         "x-amz-*"
       ],
       "exposeHeaders": [
         "ETag"
       ],
       "maxAgeSeconds": 3600
     }
   ]
   ```

---

## 6. حالة النشر والتغييرات الحساسة

- **لم يتم تنفيذ نشر تلقائي** لقواعد `firestore.rules` أو تشغيل رفع/حذف تجريبي على Bucket `Murafiq` الحقيقي بانتظار موافقة مالك المنتج وتوفير الأسرار وCORS في بيئة التشغيل.
- بعد الموافقة على التغييرات، يلزم نشر التحديث لملف `firestore.rules` على المشروع السحابي لدعم مجموعة `attachments` الفرعية تحت `users/{userId}/meetings/{meetingId}/attachments/{attachmentId}`.
