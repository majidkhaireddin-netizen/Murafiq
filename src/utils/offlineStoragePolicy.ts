import { CacheInitError, CacheMode, CacheRuntimeState } from '../types';

export interface OptOutEvaluation {
  canProceedImmediately: boolean;
  requiresConfirmation: boolean;
  pendingCount: number;
  pendingWarningArabic: string | null;
  multiTabWarningArabic: string;
  residualDataNoteArabic: string;
}

export interface OptOutExecutionResult {
  preferenceDisabled: boolean;
  clearedIndexedDb: boolean;
  requiresReload: boolean;
  errorCode?: string;
  messageArabic: string;
}

/**
 * Computes the honest runtime cache state.
 * Never reports activeMode as 'persistent' merely because requestedMode (localStorage flag) is 'persistent'.
 */
export function deriveCacheRuntimeState(params: {
  activeMode: CacheMode;
  requestedMode: CacheMode;
  initError: CacheInitError | null;
}): CacheRuntimeState {
  const { activeMode, requestedMode, initError } = params;
  return {
    activeMode,
    requestedMode,
    requiresReload: activeMode !== requestedMode,
    initError,
    isDefaultMemoryOnly: activeMode === 'memory' && requestedMode === 'memory',
  };
}

/**
 * Translates Firestore persistent cache initialization failures into honest Arabic messages.
 */
export function formatPersistenceInitErrorArabic(error: unknown): CacheInitError {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);

  if (rawCode === 'failed-precondition' || rawMessage.includes('failed-precondition')) {
    return {
      code: 'failed-precondition',
      messageArabic:
        'تعذر تفعيل التخزين الدائم (IndexedDB) لأن تبويباً آخر أو جلسة متصفح مفتوحة تستخدم قاعدة البيانات المحلية حالياً. يعمل التطبيق الآن بوضع الذاكرة المؤقتة فقط.',
      detail: rawMessage,
    };
  }

  if (rawCode === 'unimplemented' || rawMessage.includes('unimplemented') || rawMessage.toLowerCase().includes('indexeddb')) {
    return {
      code: rawCode || 'unimplemented',
      messageArabic:
        'هذا المتصفح أو وضع التصفح الخفي لا يدعم التخزين الدائم في IndexedDB. يعمل التطبيق الآن بوضع الذاكرة المؤقتة فقط.',
      detail: rawMessage,
    };
  }

  return {
    code: rawCode,
    messageArabic:
      'حدث خطأ أثناء تهيئة التخزين الدائم على هذا الجهاز، لذا يعمل التطبيق بوضع الذاكرة المؤقتة فقط حتى لا تضيع بيانات الجلسة.',
    detail: rawMessage,
  };
}

/**
 * Evaluates pre-conditions and user warnings before opting out of persistent offline storage.
 */
export function evaluatePersistenceOptOut(params: {
  pendingCount: number;
  activeMode: CacheMode;
}): OptOutEvaluation {
  const { pendingCount } = params;
  const hasPending = pendingCount > 0;

  return {
    canProceedImmediately: !hasPending,
    requiresConfirmation: true,
    pendingCount,
    pendingWarningArabic: hasPending
      ? `تنبيه حرج: توجد حالياً ${pendingCount} عمليات تعديل محلية لم تصل للسحابة بعد. مسح التخزين المحلي قبل المزامنة قد يؤدي لفقدان هذه التعديلات نهائياً.`
      : null,
    multiTabWarningArabic:
      'ملاحظة التبويبات المفتوحة: لمسح قاعدة IndexedDB بنجاح، يجب إغلاق جميع التبويبات الأخرى المفتوحة لتطبيق مُرافق في هذا المتصفح، وإلا ستبقى بقايا محلية حتى تُغلق التبويبات.',
    residualDataNoteArabic:
      'البيانات المخزنة في IndexedDB غير مشفرة تشفيراً تطبيقياً خاصاً. على الأجهزة المشتركة يُنصح أيضاً باستخدام خيار «مسح بيانات الموقع» (Clear Site Data) من إعدادات المتصفح بعد التعطيل.',
  };
}

/**
 * Formats the final status message after attempting opt-out and clearIndexedDbPersistence.
 */
export function formatOptOutExecutionResult(params: {
  clearedIndexedDb: boolean;
  error?: unknown;
}): OptOutExecutionResult {
  const { clearedIndexedDb, error } = params;
  if (clearedIndexedDb) {
    return {
      preferenceDisabled: true,
      clearedIndexedDb: true,
      requiresReload: true,
      messageArabic:
        'تم إيقاف خيار الجهاز الموثوق ومسح بيانات IndexedDB المحلية بنجاح. أعد تحميل التطبيق الآن لتشغيل وضع الذاكرة المؤقتة فقط.',
    };
  }

  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');

  if (rawCode === 'failed-precondition' || rawMessage.includes('failed-precondition')) {
    return {
      preferenceDisabled: true,
      clearedIndexedDb: false,
      requiresReload: true,
      errorCode: 'failed-precondition',
      messageArabic:
        'تم إيقاف التفضيل للجلسات القادمة، لكن تعذر مسح قاعدة IndexedDB الآن بسبب وجود تبويب أو نافذة أخرى مفتوحة للتطبيق. أغلق جميع التبويبات الأخرى أو امسح بيانات الموقع من المتصفح ثم أعد التحميل.',
    };
  }

  return {
    preferenceDisabled: true,
    clearedIndexedDb: false,
    requiresReload: true,
    errorCode: rawCode,
    messageArabic:
      'تم إيقاف تفضيل التخزين الدائم، إلا أن المسح التلقائي لـ IndexedDB لم يكتمل بالكامل؛ قد تبقى آثار بيانات محلية مقروءة في المتصفح حتى تستخدم «مسح بيانات الموقع» ثم تعيد التحميل.',
  };
}

/**
 * Distinguishes Firebase Auth persistence from Firestore offline document caching.
 */
export function describeAuthVsCachePolicy(): {
  authPersistenceArabic: string;
  firestoreCacheArabic: string;
} {
  return {
    authPersistenceArabic:
      'بقاء جلسة الدخول (Firebase Auth): يحتفظ المتصفح برمز المصادقة تلقائياً لتجنب تسجيل الدخول في كل مرة حتى تضغط «تسجيل الخروج».',
    firestoreCacheArabic:
      'تخزين مستندات العمل (Firestore Cache): يتحكم في حفظ نسخة محلية من العملاء واللقاءات والمهام والملاحظات في IndexedDB. الافتراضي هو الذاكرة المؤقتة فقط (RAM) لحماية الأجهزة المشتركة.',
  };
}
