# توثيق إنجاز مساعد الاجتماعات الذكي واستخراج المهام والقرارات
# Task 004-C — Intelligent Meeting Assistant & Action Extraction
**مشروع مُرافق — Murafiq CRM**  
**الامتداد المرجعي:** امتداد مباشر لـ `Task 004-B: Professional Meeting Workspace & Structured Minutes`  
**القاعدة المعتمدة حصراً:** `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475` (عزل `/users/{uid}/...`)  
**نموذج الذكاء الاصطناعي الخادمي:** `gemini-4-hydrogen` عبر `@google/genai`  

---

## 1. الملخص التنفيذي (Executive Summary)

تم تطوير ميزة **«المساعد الذكي للاجتماع»** داخل تطبيق «مُرافق» لتُمكّن المستقل وصاحب العمل من تحليل ملاحظات الاجتماع ومحاضره عبر Google Gemini على الخادم، واستخراج مقترحات عملية منظّمة تشمل:
1. ملخص الاجتماع المقترح (`summary`: النظرة العامة، أبرز الموضوعات، أهم النتائج والاتجاهات، التوجه القادم، ومؤشر محدودية المعلومات `insufficientInfo`).
2. القرارات المستخرجة (`decisions`) مع تصنيف الثقة (`explicit` لقرار صريح vs `needs_confirmation` لاقتراح يحتاج تأكيداً).
3. المهام المقترحة (`actionItems`) مع التنبيه لعدم تحديد الموعد أو المسؤول (`needsDueDateConfirmation` / `needsOwnerConfirmation`) ومنع التكرار.
4. النقاط المفتوحة والغامضة والمخاطر (`openQuestions`) للعرض والمراجعة فقط دون تحويلها تلقائياً إلى مهام.
5. مقترحات المتابعة القادمة (`followUpSuggestions`) لجدولة موعد المتابعة أو إنشاء مهمة متابعة دون إنشاء اجتماع تلقائياً.

تعمل الميزة وفق مبدأ **Human-in-the-Loop**: لا يُرسل أي نص إلى Gemini قبل الموافقة الصريحة والمعاينة الحية، ولا يُحفظ أي اقتراح في المحضر أو قائمة المهام أو قاعدة البيانات قبل مراجعته واعتماده صراحةً من المستخدم.

---

## 2. رحلة وتجربة المستخدم (User Experience Flow)

تتكامل الميزة بسلاسة داخل نافذة مساحة عمل اللقاء (`MeetingsView.tsx` عبر زر الرأس السريع `تحليل ذكي` وتبويب/قسم `المساعد الذكي للاجتماع` بواسطة المكوّن `MeetingAiAssistant.tsx`):

1. **البدء:** يضغط المستخدم على زر «تحليل الاجتماع بالذكاء الاصطناعي» (أو «تحليل ذكي» من شريط الرأس).
2. **نافذة الموافقة الصريحة ومعاينة المحتوى (`ai-consent-modal`):**
   - تعرض توضيحاً شفافاً لما سيُرسل (النصوص المحددة فقط عبر خادم مُرافق إلى Google Gemini) وما **لن يُرسل** إطلاقاً (ملفات وصور ومستندات Backblaze B2، روابط التنزيل المؤقتة، وسجلات العملاء الأخرى).
   - تتيح **7 مفاتيح تحكم** لتضمين/استبعاد كل قسم:
     1. `title`: عنوان اللقاء وتاريخه والعميل
     2. `agenda`: جدول الأعمال وملاحظات البنود
     3. `discussions`: ملخص المناقشات المنظّم
     4. `legacyNotes`: الملاحظات النصية الإضافية / السابقة
     5. `participants`: أسماء المشاركين وأدوارهم
     6. `additionalNotes`: الملاحظات الإضافية في المحضر
     7. `existingTasks`: المهام المرتبطة الحالية (لتفادي التكرار)
   - تعرض **عداد الأحرف الحي** (`MAX_AI_TOTAL_INPUT_CHARS = 24,000`) و**معاينة نصية مطابقة تماماً** لما سيصل للخادم بعد تنقيح الروابط والأسرار وتنسيق التاريخ المرجعي (`YYYY-MM-DD (اسم اليوم)` لتجنب تداخل اتجاه RTL).
3. **التنفيذ والتحميل:** بعد الضغط على «أوافق، ابدأ التحليل»، يظهر مؤشر تحميل واضح مع زر **«إلغاء التحليل»** لإيقاف الطلب فوراً عبر `AbortController`.
4. **شاشة «نتائج تحليل الاجتماع (بانتظار مراجعتك)»:**
   - تُحفظ النتائج **في ذاكرة الجلسة الحية فقط (RAM)** وتُمسح تلقائياً عند تغيير اللقاء أو إغلاق النافذة، ولا تُكتب أبداً في IndexedDB أو Firestore تلقائياً.
   - يمكن للمستخدم مراجعة كل قسم، تعديله محلياً قبل الحفظ، اعتماده كلياً أو جزئياً، أو تجاهله بشكل مستقل.

---

## 3. المعمارية ونقطة النهاية الخادمية (Architecture & Server Endpoint)

```text
[Client: MeetingAiAssistant.tsx]
        │ (1) Consent + Section Toggles + Redacted Preview (RAM only)
        ▼
[Client Service: src/services/meetingAi.ts -> requestMeetingAiSuggestions]
        │ (2) Offline Check + Payload Size Check + Firebase ID Token (Bearer)
        ▼  POST /api/ai/meeting-suggestions
[Express Router: src/server/aiRouter.ts -> createAiRouter()]
        │ (3) verifyFirebaseBearerToken (401)
        │ (4) Anti-Spoofing uid/userId/ownerId Check (403)
        │ (5) detectDisallowedAiFields Check (400)
        │ (6) sanitizeIncomingAiPayload & 24k Chars Limit (400 / 413)
        │ (7) verifyMeetingOwnershipInNamedDb -> named Firestore DB (403 / 503)
        │ (8) Per-uid Sliding-Window Rate Limit: 10 req / 60s (429)
        │ (9) Per-(uid:meetingId) In-Flight Deduplication (409)
        │ (10) Client Disconnect Abort Listener (res.on('close'))
        ▼
[Server Analyzer: src/server/geminiMeetingAssistant.ts -> analyzeMeetingWithGemini()]
        │ (11) Read GEMINI_API_KEY (503 if missing / placeholder MY_GEMINI_API_KEY)
        │ (12) Timeout 25s (504) + <MEETING_CONTENT_DATA> Isolation
        │ (13) GoogleGenAI (@google/genai) model: gemini-4-hydrogen + JSON responseSchema
        │ (14) validateAndNormalizeMeetingAiAnalysis() -> Strict Schema Normalization
        ▼
[JSON Response -> Client RAM Review Workspace]
```

### الملفات الرئيسية في المنظومة
- `src/types/index.ts`: الأنواع الهيكلية لمدخلات ومخرجات المساعد الذكي وحالات المراجعة (`AiReviewItemState`).
- `src/utils/meetingAiAssistant.ts`: المنطق النقي المشترك (تطهير المدخلات، التنقيح، كشف الحقول المحظورة، التحقق من المخرجات، حماية المحضر النهائي، منع التكرار، واعتماد المهام المتسلسل المقاوم للفشل الجزئي).
- `src/server/geminiMeetingAssistant.ts`: التكامل الخادمي الحصري مع `@google/genai`.
- `src/server/aiRouter.ts` و `server.ts`: مسار `POST /api/ai/meeting-suggestions` المثبّت قبل مسار `404` الاحتياطي لـ `/api`.
- `src/services/meetingAi.ts`: عميل الاتصال الآمن بالخادم مع فحص عدم الاتصال وتمرير `AbortSignal`.
- `src/components/MeetingAiAssistant.tsx` و `src/components/views/MeetingsView.tsx` و `src/components/AuthenticatedSession.tsx`: واجهة المستخدم والتكامل مع الحفظ المؤكد على الخادم.

---

## 4. ضوابط الخصوصية، التحكم في الأقسام، وحماية الأسرار (Privacy & Zero Secret Exposure)

1. **استبعاد المرفقات والروابط المؤقتة نهائياً:**
   - لا تُقرأ ملفات Backblaze B2 ولا تُمرّر `photoPaths` أو `attachments` إلى حزمة التحليل (`buildMeetingAiInputBundle`).
   - يرفض الخادم صراحةً برمز `400 DISALLOWED_AI_INPUT_FIELD` أي طلب يحتوي على حقول محظورة عبر `detectDisallowedAiFields`:
     `uid`, `userId`, `ownerId`, `firestorePath`, `targetPath`, `collectionPath`, `role`, `isAdmin`, `attachments`, `files`, `downloadUrl`, `presignedUrl`, `signedUrl`, `storageKey`, `apiKey`, `geminiApiKey`, `token`, `idToken`.
2. **التنقيح المزدوج (`redactSensitiveAiText`):**
   - يُطبّق على العميل قبل المعاينة وعلى الخادم قبل الإرسال لـ Gemini؛ لإزالة روابط `backblazeb2.com` وروابط التنزيل الموقعة (`X-Amz-Signature` / `b2_download_file_by_id`) وأي مفاتيح API بنمط `AIza...` أو ترويسات `Bearer ...`.
3. **حصر البيانات في قاعدة البيانات المسماة:**
   - يتحقق الخادم من ملكية اللقاء داخل المسار `/users/{uid}/meetings/{meetingId}` في القاعدة المسماة حصراً (`ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`) عبر `verifyMeetingOwnershipInNamedDb` (ولا يثق أبداً بأي `uid` يرسله العميل في متن الطلب).
4. **عزل الأسرار التام عن المتصفح:**
   - لا يوجد أي استيراد لحزمة `@google/genai` أو إشارة لـ `GEMINI_API_KEY` أو أسرار Backblaze B2 داخل `src/` خارج `src/server/`، كما تؤكد اختبارات الوحدة وفحص مخرجات البناء `dist/`.
   - لا تُسجّل `console.log` في الخادم أي محتوى لاجتماعات العملاء أو استجابات Gemini أو مفاتيح الأسرار.

---

## 5. حماية المحضر النهائي والتوافق مع اللقاءات القديمة والعمل دون اتصال

1. **احترام حالة المحضر النهائي (`minutesStatus === 'final'`):**
   - إذا كان المحضر مضبوطاً على حالة «نهائي»، تمنع كل من الدوال النقية (`applyAiSummaryToMeeting`، `approveAiDecisionIntoMeeting`، `applyAiFollowUpDateToMeeting`) وواجهة `MeetingAiAssistant.tsx` تعديل ملخص المناقشات أو القرارات أو موعد المتابعة داخل المحضر، وتعرض تنبيهاً واضحاً مع زر **«إعادة فتح المحضر»** الذي يمر عبر حوار التأكيد المعتمد في Task 004-B.
   - في الوقت نفسه، **يظل إنشاء المهام المرتبطة المستقلة متاحاً** لأنها كيان منفصل في `/users/{uid}/tasks/{id}` مربوط بـ `meetingId` و`clientId` ولا يمس المحضر المقفل.
2. **صون الملاحظات التاريخية (`meeting.notes`) والتوافق الخلفي:**
   - اعتماد الملخص يحدّث `discussionSummary` فقط ويترك الحقل التاريخي `meeting.notes` سليماً تماماً حتى في خيار «استبدال الملخص الحالي».
   - تعمل اللقاءات القديمة التي لا تحتوي على الحقول المستحدثة في Task 004-B (`discussionSummary` أو `agendaItems` أو `participants`) بصورة طبيعية بالاعتماد على `notes` والعنوان والمعلومات المتاحة.
3. **حارس العمل دون اتصال (`Offline-First Guard`):**
   - التحليل الذكي لـ Gemini يتطلب اتصالاً نشطاً بالإنترنت (`navigator.onLine`). عند انقطاع الاتصال يُعطّل زر التحليل ويظهر تنبيه عربي واضح (`ai-offline-notice`)، كما يرفض عميل الخدمة الطلب فوراً برمز `OFFLINE_BLOCKED` دون التأثير على محرر المحضر أو حفظ التعديلات محلياً في IndexedDB.

---

## 6. قواعد الاعتماد البشري، الإسناد، منع التكرار، والتعافي من الفشل الجزئي

1. **المصدر والإسناد (`provenance: 'approved'`):**
   - كل مهمة تُنشأ عبر اعتماد اقتراح الذكاء الاصطناعي تمر عبر `createLinkedMeetingTask` وتُوسم بـ `provenance: 'approved'` وترتبط صراحةً بـ `meetingId` و`clientId`.
2. **منع التكرار الذكي:**
   - تستخدم الواجهة والمنطق دالة `findDuplicateMeetingTask` (بالتطبيع العربي `normalizeTaskTitle` للهمزات والتاء المربوطة والألف المقصورة) لاكتشاف المهام المطابقة الموجودة مسبقاً في نفس اللقاء، فتعرض تحذيراً واضحاً وتُعطّل زر الإنشاء المكرر وتتيح للمستخدم تعديل العنوان أو تجاهل الاقتراح.
3. **التعافي من الفشل الجزئي في الاعتماد الدفعي (`approveSuggestedTasksSequentially`):**
   - في `AuthenticatedSession.tsx` تم تزويد `MeetingsView` بدالة `handleSaveTaskWithResult` التي تنتظر تأكيد الخادم الفعلي (`onServerConfirmed` / `onServerRejected`) عندما يكون المستخدم متصلاً بالإنترنت (وتحل فوراً عند العمل دون اتصال مع قيد المزامنة المعلقة).
   - إذا اعتمد المستخدم عدة مهام دفعة واحدة ونجحت المهمة الأولى ثم فشلت الثالثة مثلاً (بسبب خطأ شبكة أو صلاحية):
     - تبقى المهمة الأولى موسومة كـ **`approved`** ولا تُكرر أبداً عند إعادة المحاولة (`alreadyApprovedIds`).
     - تُوسم المهمة الفاشلة فقط بحالة **`save_failed`** مع رسالة الخطأ وزر **«إعادة محاولة الحفظ»** لإعادة حفظها وحدها بأمان.

---

## 7. مقاومة حقن التوجيهات والتحقق الصارم من المخرجات (Prompt Injection & Schema Controls)

1. **عزل البيانات داخل `<MEETING_CONTENT_DATA>`:**
   - تُمرّر محتويات الاجتماع ضمن وسوم `<MEETING_CONTENT_DATA>...</MEETING_CONTENT_DATA>` مع تعليمات نظامية صارمة تأمر النموذج بمعاملة النص بوصفه بيانات خام فقط، وتجاهل أي أوامر قد يحويها النص.
2. **منع الاختلاق والهلوسة:**
   - تُلزم التعليمات والدالة `validateAndNormalizeMeetingAiAnalysis`:
     - إرجاع `ownerName` فارغاً مع `needsOwnerConfirmation = true` إذا كان الاسم عاماً أو غير مذكور (`غير محدد`، `مجهول`، `N/A`، `TBD`...).
     - حذف التواريخ غير الصالحة (غير `YYYY-MM-DD` الحقيقية) وضبط `needsDueDateConfirmation = true` / `needsDateConfirmation = true`.
     - تصفية أي `agendaItemId` لا يطابق بنود جدول أعمال اللقاء الحقيقي.
     - تقليص القوائم للحدود الآمنة (`MAX_AI_DECISIONS = 12`، `MAX_AI_ACTION_ITEMS = 15`، `MAX_AI_OPEN_QUESTIONS = 12`، `MAX_AI_FOLLOWUPS = 6`) مع إظهار تنبيهات عربية للمستخدم عند قصور المعلومات أو اختصار القوائم.

---

## 8. بيئة التشغيل وإدارة مفتاح `GEMINI_API_KEY`

- يُقرأ `GEMINI_API_KEY` حصراً في الخادم عبر `readGeminiApiKeyFromEnv()` في `src/server/geminiMeetingAssistant.ts`.
- تم تعريف `GEMINI_API_KEY=""` في `.env.example` كمرجع بدون أي قيمة سرية.
- لا توجد أي واجهة لإدخال مفتاح API من طرف المستخدم.
- عند غياب `GEMINI_API_KEY` أو بقائه على القيمة الوهمية `MY_GEMINI_API_KEY`، يعيد الخادم استجابة منظمة برمز الحالة `503 GEMINI_NOT_CONFIGURED` مع رسالة عربية واضحة دون تلفيق أي مخرجات مزيفة.

---

## 9. ملخص الاختبارات المنفذة (`tests/ai-meeting-assistant.test.ts` وحزمة المشروع)

تم إنشاء **22 اختباراً مؤتمتاً** في `tests/ai-meeting-assistant.test.ts` (تعمل جميعها دون اتصال حقيقي بـ Gemini وباستخدام محاكاة كاملة لضمان الحتمية وعدم استهلاك الحصة)، وتغطي:
1. **اختبارات الأمان (1–8):** رفض الطلبات بدون مصادقة (`401`)، الرمز غير الصالح (`401`)، وصول مستخدم آخر للقاء (`403`)، انتحال `uid/userId/ownerId` (`403`)، حقول المرفقات/الروابط المؤقتة/التحكم المحظورة (`400`)، خلو ملفات العميل من `@google/genai` و`GEMINI_API_KEY` و`B2_APPLICATION_KEY`، تجاوز الحد الأقصى لحجم النص (`413`)، وعزل `<MEETING_CONTENT_DATA>` ضد حقن التوجيهات.
2. **اختبارات التحليل والتطبيع (9–13):** تحليل JSON البنيوي الصحيح، رفض الاستجابة المكسورة بـ `502 INVALID_AI_RESPONSE`، منع اختلاق التواريخ والمسؤولين عند ضعف المعلومات، إعادة `503 GEMINI_NOT_CONFIGURED` عند غياب المفتاح، وتفعيل Rate Limit برمز `429`.
3. **اختبارات المراجعة والاعتماد (14–19):** عدم تعديل اللقاء أو المهام عند مجرد توليد الاقتراحات، اعتماد مهمة معدّلة مع `provenance: 'approved'`، منع تكرار المهام عند اختلاف الهمزات/التاء المربوطة، التعافي من الفشل الجزئي دون تكرار المهمة الناجحة، احترام قفل `minutesStatus === 'final'` مع بقاء إنشاء المهام المستقلة متاحاً، وصون `meeting.notes` عند اعتماد الملخص.
4. **اختبارات الخصوصية والتوافق (20–22):** استبعاد الأقسام المعطّلة وتنقيح روابط Backblaze B2 الموقعة، حظر التحليل دون اتصال (`OFFLINE_BLOCKED`) وتوافق اللقاءات القديمة دون حقول 004-B، والتحقق من حد `24,000` حرف قبل الإرسال.

---

## 10. العناصر المؤجلة صراحةً وقائمة الجاهزية الإنتاجية

### ما يظل مؤجلاً (خارج نطاق Task 004-C)
- تحليل ملفات المرفقات الفعلية (PDF، الصور، المستندات المرفوعة في Backblaze B2) أو قراءتها بالذكاء الاصطناعي.
- تخزين تاريخ تحليلات الذكاء الاصطناعي أو سجلات الدردشة الدائمة داخل Firestore.
- إعادة التوليد الجزئي لكل قسم منفرد أو الدردشة التفاعلية متعددة الأدوار (تم الالتزام بعدم تحويل التطبيق إلى ChatGPT clone).
- أي ميزات من Task 005 أو المهام اللاحقة (لم يتم البدء بها).

### قائمة التحقق قبل التفعيل الفعلي في الإنتاج
1. إضافة `GEMINI_API_KEY` الصالح في **AI Studio Secrets** أو متغيرات بيئة الخادم الإنتاجية فقط.
2. تهيئة اعتماد Firebase Admin (`FIREBASE_SERVICE_ACCOUNT_JSON` أو ADC مُدار على Cloud Run) للوصول للقاعدة المسماة `ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`.
3. تشغيل سير عمل GitHub Actions (`.github/workflows/ci.yml`) الذي يتضمن تشغيل `npm run test:rules` و`npm run test:offline` على بيئة مزوّدة بـ Java Runtime لعدم توفر Java في حاوية التطوير الحالية.
