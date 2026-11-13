import React, { useState } from 'react';
import { AppState, CacheRuntimeState } from '../types';
import {
  getCacheRuntimeState,
  optOutPersistentStorageAndClearCache,
  requestPersistentStorageEnable,
} from '../services/firebase';
import {
  canSafelyReload,
  describeAuthVsCachePolicy,
  evaluatePersistenceOptOut,
  OptOutExecutionResult,
} from '../utils/offlineStoragePolicy';
import {
  Settings,
  HardDrive,
  Download,
  X,
  AlertTriangle,
  Database,
  RefreshCw,
  ShieldAlert,
  Info,
  Trash2,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appState: AppState;
  onUpdateState: (updates: Partial<AppState>) => void;
  onResetData: () => void;
  language: 'ar' | 'en';
  onTriggerSimulatedConflict?: () => void;
  pendingOperationsCount?: number;
  rejectedWritesCount?: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appState,
  onUpdateState,
  language,
  onTriggerSimulatedConflict,
  pendingOperationsCount = 0,
  rejectedWritesCount = 0,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'assumptions'>('general');
  const [cacheState, setCacheState] = useState<CacheRuntimeState>(() => getCacheRuntimeState());
  const [optOutConfirmOpen, setOptOutConfirmOpen] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [optOutResult, setOptOutResult] = useState<OptOutExecutionResult | null>(null);

  if (!isOpen) return null;

  const authVsCache = describeAuthVsCachePolicy();
  const optOutEval = evaluatePersistenceOptOut({
    pendingCount: pendingOperationsCount,
    activeMode: cacheState.activeMode,
  });
  const reloadSafety = canSafelyReload({
    activeMode: cacheState.activeMode,
    pendingOperationsCount,
    rejectedWritesCount,
  });

  const handleTogglePersistentStorage = (checked: boolean) => {
    setOptOutResult(null);
    if (checked) {
      const next = requestPersistentStorageEnable();
      setCacheState(next);
      setOptOutConfirmOpen(false);
    } else {
      // Open explicit safe opt-out confirmation before clearing IndexedDB or losing pending writes
      setOptOutConfirmOpen(true);
    }
  };

  const handleConfirmOptOut = async () => {
    setIsClearingCache(true);
    try {
      const result = await optOutPersistentStorageAndClearCache({
        pendingOperationsCount,
        hasPendingWrites: pendingOperationsCount > 0,
      });
      setOptOutResult(result);
      setCacheState(getCacheRuntimeState());
      if (!result.blockedByPendingWrites && !result.blockedByOtherTabs) {
        setOptOutConfirmOpen(false);
      }
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleReloadApp = () => {
    if (reloadSafety.blocked) {
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleExportJson = () => {
    const payload = {
      murafiq_version: '1.0.0-prototype',
      exported_at: new Date().toISOString(),
      clients: appState.clients,
      meetings: appState.meetings,
      tasks: appState.tasks,
      notes: appState.notes,
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `murafiq-backup-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
      <div
        data-testid="settings-modal"
        className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-auto overflow-hidden border border-stone-200 flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-stone-700" />
            <h3 className="font-heading font-bold text-base text-stone-900">
              {language === 'ar' ? 'الإعدادات والتخزين المحلي' : 'Settings & Offline Storage'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-stone-200 bg-stone-100/50 text-xs font-semibold px-4 pt-2 gap-2">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            التخزين دون اتصال والمزامنة
          </button>
          <button
            onClick={() => setActiveTab('assumptions')}
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeTab === 'assumptions'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            وثيقة فرضيات التصميم
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
          {activeTab === 'general' ? (
            <>
              {/* 1. Offline Storage Policy & Trusted-Device Opt-In (Section A) */}
              <div className="space-y-3" data-testid="offline-storage-section">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-700" />
                    <span>التخزين المحلي والعمل دون اتصال</span>
                  </span>
                  <span
                    data-testid="active-cache-mode-badge"
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                      cacheState.activeMode === 'persistent'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-stone-100 text-stone-700 border-stone-200'
                    }`}
                  >
                    {cacheState.activeMode === 'persistent'
                      ? 'الوضع النشط: دائم (IndexedDB)'
                      : 'الوضع النشط: الذاكرة فقط (RAM)'}
                  </span>
                </div>

                {/* Visible Initialization Error Warning (Never silently claim persistence is active) */}
                {cacheState.initError && (
                  <div
                    data-testid="cache-init-error"
                    className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[11px]">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>فشل تفعيل التخزين الدائم — يعمل التطبيق في الذاكرة فقط</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-rose-800">
                      {cacheState.initError.messageArabic}
                    </p>
                  </div>
                )}

                {/* Reload Required Notice when requestedMode != activeMode */}
                {cacheState.requiresReload && !optOutResult && (
                  <div
                    data-testid="cache-reload-banner"
                    className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 space-y-2"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[11px]">
                      <RefreshCw className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>يتطلب التغيير إعادة تحميل التطبيق لتفعيل وضع التخزين الجديد</span>
                    </div>
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      التفضيل المحفوظ حالياً هو{' '}
                      <strong>
                        {cacheState.requestedMode === 'persistent' ? 'التخزين الدائم (IndexedDB)' : 'الذاكرة فقط (RAM)'}
                      </strong>
                      ، بينما الجلسة الحالية ما زالت تعمل بوضع{' '}
                      <strong>
                        {cacheState.activeMode === 'persistent' ? 'التخزين الدائم' : 'الذاكرة فقط'}
                      </strong>{' '}
                      لأن إعدادات Firestore تُطبَّق عند بدء التشغيل فقط.
                    </p>
                    {reloadSafety.reasonArabic && (
                      <div
                        data-testid="reload-blocked-warning"
                        className="p-2 bg-rose-100 border border-rose-300 rounded-lg text-[11px] font-bold text-rose-950 leading-relaxed"
                      >
                        {reloadSafety.reasonArabic}
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid="reload-app-button"
                      disabled={reloadSafety.blocked}
                      onClick={handleReloadApp}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>إعادة تحميل التطبيق الآن</span>
                    </button>
                  </div>
                )}

                {/* Opt-Out Outcome Banner */}
                {optOutResult && (
                  <div
                    data-testid="cache-optout-result"
                    className={`p-3 rounded-xl border space-y-2 ${
                      optOutResult.clearedIndexedDb
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-300 text-amber-950'
                    }`}
                  >
                    <p className="text-[11px] font-medium leading-relaxed">{optOutResult.messageArabic}</p>
                    {optOutResult.requiresReload && (
                      <>
                        {reloadSafety.reasonArabic && (
                          <div className="p-2 bg-rose-100 border border-rose-300 rounded-lg text-[11px] font-bold text-rose-950 leading-relaxed">
                            {reloadSafety.reasonArabic}
                          </div>
                        )}
                        <button
                          type="button"
                          data-testid="reload-after-optout-button"
                          disabled={reloadSafety.blocked}
                          onClick={handleReloadApp}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>إعادة تشغيل التطبيق الآن</span>
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Trusted-Device Toggle Card */}
                <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <label htmlFor="persistent-storage-toggle" className="font-bold text-stone-900 block cursor-pointer">
                        تفعيل التخزين الدائم على هذا الجهاز الموثوق (IndexedDB)
                      </label>
                      <p className="text-[11px] text-stone-600 leading-relaxed">
                        الوضع الافتراضي هو <strong>الذاكرة المؤقتة فقط (RAM)</strong> لحماية خصوصية الأجهزة المشتركة أو العامة. فعِّل هذا الخيار فقط على جهازك الشخصي المحمي للاحتفاظ بالبيانات والعمل دون اتصال عبر إعادة التحميل.
                      </p>
                    </div>
                    <input
                      id="persistent-storage-toggle"
                      data-testid="persistent-storage-toggle"
                      type="checkbox"
                      checked={cacheState.requestedMode === 'persistent'}
                      onChange={(e) => handleTogglePersistentStorage(e.target.checked)}
                      className="w-4 h-4 mt-1 rounded text-emerald-600 focus:ring-emerald-600 shrink-0 cursor-pointer"
                    />
                  </div>

                  {/* Plaintext / Unencrypted IndexedDB Disclosure */}
                  <div className="p-2.5 bg-amber-50/80 border border-amber-200/90 rounded-lg text-[11px] text-amber-950 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1 leading-relaxed">
                      <span className="font-bold block">تنبيه أمني حول التخزين المحلي:</span>
                      <p>
                        البيانات المحفوظة في <strong>IndexedDB</strong> تُخزَّن بصيغة قابلة للقراءة محلياً ولا تخضع لتشفير تطبيقي خاص (No Application-Level Encryption). تعتمد الحماية على قفل حساب نظام التشغيل وتشفير القرص.
                      </p>
                    </div>
                  </div>

                  {/* Auth Persistence vs Firestore Document Caching Distinction */}
                  <div className="p-2.5 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 space-y-1.5 leading-relaxed">
                    <div className="flex items-center gap-1 font-bold text-stone-800">
                      <Info className="w-3.5 h-3.5 text-sky-700" />
                      <span>الفرق بين بقاء جلسة الدخول وتخزين المستندات:</span>
                    </div>
                    <p>{authVsCache.authPersistenceArabic}</p>
                    <p>{authVsCache.firestoreCacheArabic}</p>
                  </div>
                </div>

                {/* Safe Opt-Out Inline Confirmation Dialog */}
                {optOutConfirmOpen && (
                  <div
                    data-testid="optout-confirm-panel"
                    className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2.5"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-rose-900 text-[11px]">
                      <Trash2 className="w-4 h-4 text-rose-700 shrink-0" />
                      <span>تأكيد إيقاف التخزين الدائم ومسح IndexedDB</span>
                    </div>

                    {optOutEval.pendingWarningArabic && (
                      <div className="p-2 bg-rose-100 border border-rose-300 rounded-lg text-[11px] font-bold text-rose-950">
                        {optOutEval.pendingWarningArabic}
                      </div>
                    )}

                    <p className="text-[11px] text-rose-900 leading-relaxed">
                      {optOutEval.multiTabWarningArabic}
                    </p>
                    <p className="text-[10px] text-rose-800 leading-relaxed">
                      {optOutEval.residualDataNoteArabic}
                    </p>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setOptOutConfirmOpen(false)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-stone-700 font-medium hover:bg-stone-50"
                      >
                        إلغاء والإبقاء على التفعيل
                      </button>
                      <button
                        type="button"
                        data-testid="confirm-optout-button"
                        disabled={isClearingCache || !optOutEval.canProceedImmediately}
                        onClick={handleConfirmOptOut}
                        className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isClearingCache
                          ? 'جاري المسح...'
                          : !optOutEval.canProceedImmediately
                          ? 'مقفل لحين إتمام المزامنة'
                          : 'تأكيد التعطيل ومسح البيانات المحلية'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Cloud Database Connection Info */}
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-emerald-700" />
                    <span>قاعدة بيانات Firebase Firestore السحابية</span>
                  </span>
                </div>
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-[11px] text-stone-600 space-y-1">
                  <div>
                    <span className="font-semibold text-stone-800">مشروع فايربيس: </span>
                    <span className="font-mono text-stone-700">gen-lang-client-0264525417</span>
                  </div>
                  <div>
                    <span className="font-semibold text-stone-800">قاعدة البيانات: </span>
                    <span className="font-mono text-stone-700">ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475</span>
                  </div>
                </div>

                {/* Conflict Policy Explanation & Simulated DEV_TEST Tool (Section E) */}
                <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-[11px] text-stone-700 space-y-1.5 leading-relaxed">
                  <span className="font-bold text-stone-900 block">سياسة تعارض التعديلات (Last-Write-Wins):</span>
                  <p>
                    عند التعديل من أكثر من جلسة وإعادة الاتصال، يطبق Firestore افتراضياً قاعدة <strong>الكتابة الأحدث تفوز (Last-Write-Wins)</strong> عند الخادم. الكشف التلقائي عن تعارضات السحابة قبل الاستبدال يتطلب حقول إصدار (Versioning) ومعاملات تحقق غير مفعلة في الإصدار الحالي.
                  </p>
                </div>

                {onTriggerSimulatedConflict && (
                  <div className="pt-1">
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900 text-[11px]">
                          أداة محاكاة واجهة فض التعارض (للمعاينة والاختبار فقط)
                        </span>
                        <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-mono">
                          DEV_TEST
                        </span>
                      </div>
                      <p className="text-[10px] text-amber-800 leading-relaxed">
                        أداة تطويرية لاختبار شاشة المقارنة والدمج اليدوي فقط؛ لا تمثل كشفاً تلقائياً لتعارض فعلي قادم من السحابة.
                      </p>
                      <button
                        onClick={() => {
                          onTriggerSimulatedConflict();
                          onClose();
                        }}
                        className="w-full py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs transition-colors"
                      >
                        تشغيل معاينة تعارض افتراضي (DEV_TEST)
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Hijri Calendar */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-stone-900 block">عرض التاريخ الهجري</span>
                  <span className="text-[11px] text-stone-500">
                    إظهار التاريخ الهجري إلى جانب الميلادي في الترويسة ومحاضر الاجتماعات
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={appState.showHijri}
                  onChange={(e) => onUpdateState({ showHijri: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                />
              </div>

              {/* 4. Biometric Security Lock (Demo Only) */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-stone-900 block">قفل الشاشة التجريبي</span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.2 rounded">عرض توضيحي فقط</span>
                  </div>
                  <span className="text-[11px] text-stone-500 block mt-0.5">
                    محاكاة لقفل شاشة الجهاز برقم PIN محلي (1234). عزل البيانات السحابية يتم بالكامل عبر حساب Google وقواعد Firestore.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={appState.isBiometricEnabled}
                  onChange={(e) => onUpdateState({ isBiometricEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                />
              </div>

              {/* 5. Data Backup & Storage Info */}
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <span className="font-bold text-stone-900 block">النسخ الاحتياطي وتصدير البيانات</span>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  بياناتك السحابية معزولة حسب معرف المستخدم في Firestore (لا يوجد حقن تلقائي لبيانات تجريبية). التخزين المحلي في IndexedDB غير مشفر تطبيقياً كما هو موضح أعلاه.
                </p>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={handleExportJson}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير نسخة احتياطية JSON</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Design Assumptions Tab */
            <div className="space-y-3 leading-relaxed text-stone-700">
              <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 text-emerald-950">
                <span className="font-bold block mb-1">توثيق فرضيات التصميم (Design Assumptions Log):</span>
                <p className="text-[11px]">
                  تم تسجيل الحلول التصميمية القابلة للمراجعة كفرضيات قابلة للتعديل وليست متطلبات ثابتة:
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">1. دورة حياة اللقاء (قبل / أثناء / بعد):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تم تقسيم تفاصيل اللقاء إلى 3 مراحل تبويب واضحة لتعزيز فلسفة &quot;المساعد الذي يسبق اللقاء ويرافقك فيه ويتابعك بعده&quot;.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">2. مؤشرات موثوقية المعلومة (Provenance):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تمييز المهام بـ (من المحضر / اقتراح ذكي / معتمد شخصياً / يحتاج تدقيق) لضمان الشفافية دون جعل الذكاء الاصطناعي محور الشاشة.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">3. التخزين الدائم للأجهزة الموثوقة فقط:</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    البدء بوضع الذاكرة فقط (memoryLocalCache) افتراضياً، واشتراط موافقة صريحة من المستخدم وإعادة تشغيل لتفعيل IndexedDB نظراً لعدم وجود تشفير تطبيقي محلي.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">4. سياسة التعارض في الإصدار الأول (LWW):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    يعتمد Firestore في الإصدار الحالي Last-Write-Wins عند المزامنة، وتبقى واجهة حل التعارض متاحة للمراجعة اليدوية أو المحاكاة التطويرية إلى أن يضاف ترقيم الإصدارات مستقبلاً.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
