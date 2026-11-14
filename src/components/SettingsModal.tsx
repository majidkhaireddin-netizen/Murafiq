import React, { useEffect, useRef, useState } from 'react';
import type {
  AppState,
  CacheRuntimeState,
  CsvExportEntityType,
  FollowUpPreferences,
  ImportExecutionReport,
  ImportPreviewResult,
  MeetingLeadMinutesOption,
  Opportunity,
  OpportunityStageEvent,
  UpcomingTaskWindowDaysOption,
} from '../types';
import { DEFAULT_FOLLOW_UP_PREFERENCES } from '../utils/followUpEngine';
import {
  getCacheRuntimeState,
  optOutPersistentStorageAndClearCache,
  requestPersistentStorageEnable,
} from '../services/firebase';
import {
  canSafelyReload,
  describeAuthVsCachePolicy,
  evaluatePersistenceOptOut,
  type OptOutExecutionResult,
} from '../utils/offlineStoragePolicy';
import {
  COMPLETE_ONLINE_EXPORT_DISCLOSURE_AR,
  EXPORT_ATTACHMENT_DISCLOSURE_AR,
  EXPORT_SECURITY_DISCLOSURE_AR,
  PARTIAL_OR_OFFLINE_EXPORT_DISCLOSURE_AR,
  buildEntityCsv,
  buildUserDataExportBundle,
  executeSafeImportPlan,
  validateAndPreviewImport,
  type ImportPersistenceHandlers,
} from '../utils/dataPortability';
import {
  Settings,
  HardDrive,
  Download,
  Upload,
  FileSpreadsheet,
  FileJson,
  CheckCircle2,
  X,
  AlertTriangle,
  Database,
  RefreshCw,
  ShieldAlert,
  Info,
  Trash2,
  Bell,
  RotateCcw,
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
  followUpPreferences?: FollowUpPreferences;
  onUpdateFollowUpPreferences?: (next: FollowUpPreferences) => void;
  // Task 009: Data Portability props
  currentUserId?: string;
  opportunities?: Opportunity[];
  opportunityStageEvents?: OpportunityStageEvent[];
  isOnline?: boolean;
  collectionsLoaded?: {
    clients?: boolean;
    meetings?: boolean;
    tasks?: boolean;
    notes?: boolean;
    opportunities?: boolean;
    opportunityStageEvents?: boolean;
  };
  importHandlers?: ImportPersistenceHandlers;
  initialTab?: 'general' | 'data' | 'assumptions';
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
  followUpPreferences = DEFAULT_FOLLOW_UP_PREFERENCES,
  onUpdateFollowUpPreferences,
  currentUserId = 'anonymous',
  opportunities = [],
  opportunityStageEvents = [],
  isOnline = true,
  collectionsLoaded,
  importHandlers,
  initialTab = 'general',
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'data' | 'assumptions'>(initialTab);
  const [cacheState, setCacheState] = useState<CacheRuntimeState>(() => getCacheRuntimeState());
  const [optOutConfirmOpen, setOptOutConfirmOpen] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [optOutResult, setOptOutResult] = useState<OptOutExecutionResult | null>(null);

  // Task 009: Ephemeral in-memory import wizard state (never persisted to localStorage/IndexedDB)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importConfirmedCheckbox, setImportConfirmedCheckbox] = useState(false);
  const [isExecutingImport, setIsExecutingImport] = useState(false);
  const [importExecutionReport, setImportExecutionReport] =
    useState<ImportExecutionReport | null>(null);
  const [exportFeedbackAr, setExportFeedbackAr] = useState<string | null>(null);

  // Clear temporary import state whenever user changes or modal closes
  const clearTemporaryImportState = () => {
    setSelectedFileName('');
    setImportPreview(null);
    setImportConfirmedCheckbox(false);
    setIsExecutingImport(false);
    setImportExecutionReport(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    clearTemporaryImportState();
  }, [currentUserId]);

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

  const allCollectionsLoaded =
    (collectionsLoaded?.clients ?? true) &&
    (collectionsLoaded?.meetings ?? true) &&
    (collectionsLoaded?.tasks ?? true) &&
    (collectionsLoaded?.notes ?? true) &&
    (collectionsLoaded?.opportunities ?? true) &&
    (collectionsLoaded?.opportunityStageEvents ?? true);

  const isExportCompleteOnline =
    isOnline && allCollectionsLoaded && pendingOperationsCount === 0;

  const handleTogglePersistentStorage = (checked: boolean) => {
    setOptOutResult(null);
    if (checked) {
      const next = requestPersistentStorageEnable();
      setCacheState(next);
      setOptOutConfirmOpen(false);
    } else {
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

  const triggerBrowserDownload = (
    content: string,
    fileName: string,
    mimeType: string
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.setAttribute('href', url);
    anchor.setAttribute('download', fileName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportJson = () => {
    const bundle = buildUserDataExportBundle({
      currentUserId,
      clients: appState.clients,
      meetings: appState.meetings,
      tasks: appState.tasks,
      notes: appState.notes,
      opportunities,
      opportunityStageEvents,
      isOnline,
      collectionsLoaded,
      hasPendingLocalWrites: pendingOperationsCount > 0,
    });

    const dateSuffix = new Date().toISOString().slice(0, 10);
    const statusSuffix = bundle.completeness.status === 'complete_online' ? 'complete' : 'local-partial';
    const fileName = `murafiq-export-${statusSuffix}-${dateSuffix}.json`;

    triggerBrowserDownload(
      JSON.stringify(bundle, null, 2),
      fileName,
      'application/json;charset=utf-8'
    );
    setExportFeedbackAr(
      `تم تجهيز وتنزيل ملف JSON (${fileName}) بنجاح.`
    );
  };

  const handleExportCsv = (entityType: CsvExportEntityType) => {
    const csvContent = buildEntityCsv({
      entityType,
      currentUserId,
      clients: appState.clients,
      meetings: appState.meetings,
      tasks: appState.tasks,
      opportunities,
    });

    const dateSuffix = new Date().toISOString().slice(0, 10);
    const fileName = `murafiq-${entityType}-${dateSuffix}.csv`;

    triggerBrowserDownload(
      csvContent,
      fileName,
      'text/csv;charset=utf-8'
    );
    setExportFeedbackAr(`تم تجهيز وتنزيل ملف CSV (${fileName}) بنجاح.`);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setImportConfirmedCheckbox(false);
    setImportExecutionReport(null);

    try {
      const text = await file.text();
      const preview = validateAndPreviewImport({
        fileContent: text,
        fileName: file.name,
        fileSizeBytes: file.size,
        existingData: {
          currentUserId,
          clients: appState.clients,
          meetings: appState.meetings,
          tasks: appState.tasks,
          notes: appState.notes,
          opportunities,
          opportunityStageEvents,
        },
      });
      setImportPreview(preview);
    } catch {
      setImportPreview({
        canProceed: false,
        fatalErrorAr: 'تعذر قراءة الملف المحدد.',
        format: 'murafiq_json',
        countsByCollection: {
          clients: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
          meetings: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
          tasks: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
          notes: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
          opportunities: { totalInFile: 0, validToImport: 0, duplicateSkipped: 0, rejected: 0 },
          opportunityStageEvents: {
            totalInFile: 0,
            validToImport: 0,
            duplicateSkipped: 0,
            rejected: 0,
          },
        },
        totalInFile: 0,
        totalValidToImport: 0,
        totalDuplicatesSkipped: 0,
        totalRejected: 0,
        brokenRelationshipsCount: 0,
        issues: [],
        sanitizedBatch: {
          clients: [],
          meetings: [],
          tasks: [],
          notes: [],
          opportunities: [],
          opportunityStageEvents: [],
        },
      });
    }
  };

  const handleExecuteConfirmedImport = async (retryOnlyFailed = false) => {
    if (!importPreview || !importHandlers) return;
    setIsExecutingImport(true);
    try {
      const report = await executeSafeImportPlan({
        preview: importPreview,
        confirmed: importConfirmedCheckbox,
        isOnline,
        handlers: importHandlers,
        previousSucceededKeys:
          retryOnlyFailed && importExecutionReport
            ? importExecutionReport.succeededRecordKeys
            : undefined,
      });
      setImportExecutionReport(report);
    } finally {
      setIsExecutingImport(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto">
      <div
        data-testid="settings-modal"
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-auto overflow-hidden border border-stone-200 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-stone-700" />
            <h3 className="font-heading font-bold text-base text-stone-900">
              {language === 'ar'
                ? 'الإعدادات، التخزين المحلي، وإدارة البيانات'
                : 'Settings, Storage & Data Management'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              clearTemporaryImportState();
              onClose();
            }}
            className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-stone-200 bg-stone-100/50 text-xs font-semibold px-4 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            data-testid="settings-tab-general"
            onClick={() => setActiveTab('general')}
            className={`pb-2 px-3 border-b-2 transition-colors shrink-0 ${
              activeTab === 'general'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            التخزين دون اتصال والمزامنة
          </button>
          <button
            type="button"
            data-testid="settings-tab-data"
            onClick={() => setActiveTab('data')}
            className={`pb-2 px-3 border-b-2 transition-colors shrink-0 ${
              activeTab === 'data'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            إدارة البيانات (تصدير واستيراد)
          </button>
          <button
            type="button"
            data-testid="settings-tab-assumptions"
            onClick={() => setActiveTab('assumptions')}
            className={`pb-2 px-3 border-b-2 transition-colors shrink-0 ${
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
          {activeTab === 'general' && (
            <>
              {/* 1. Offline Storage Policy & Trusted-Device Opt-In */}
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
                        {cacheState.requestedMode === 'persistent'
                          ? 'التخزين الدائم (IndexedDB)'
                          : 'الذاكرة فقط (RAM)'}
                      </strong>
                      ، بينما الجلسة الحالية ما زالت تعمل بوضع{' '}
                      <strong>
                        {cacheState.activeMode === 'persistent'
                          ? 'التخزين الدائم'
                          : 'الذاكرة فقط'}
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

                {optOutResult && (
                  <div
                    data-testid="cache-optout-result"
                    className={`p-3 rounded-xl border space-y-2 ${
                      optOutResult.clearedIndexedDb
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-300 text-amber-950'
                    }`}
                  >
                    <p className="text-[11px] font-medium leading-relaxed">
                      {optOutResult.messageArabic}
                    </p>
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

                <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="persistent-storage-toggle"
                        className="font-bold text-stone-900 block cursor-pointer"
                      >
                        تفعيل التخزين الدائم على هذا الجهاز الموثوق (IndexedDB)
                      </label>
                      <p className="text-[11px] text-stone-600 leading-relaxed">
                        الوضع الافتراضي هو <strong>الذاكرة المؤقتة فقط (RAM)</strong> لحماية
                        خصوصية الأجهزة المشتركة أو العامة. فعِّل هذا الخيار فقط على جهازك
                        الشخصي المحمي للاحتفاظ بالبيانات والعمل دون اتصال عبر إعادة التحميل.
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

                  <div className="p-2.5 bg-amber-50/80 border border-amber-200/90 rounded-lg text-[11px] text-amber-950 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1 leading-relaxed">
                      <span className="font-bold block">تنبيه أمني حول التخزين المحلي:</span>
                      <p>
                        البيانات المحفوظة في <strong>IndexedDB</strong> تُخزَّن بصيغة قابلة
                        للقراءة محلياً ولا تخضع لتشفير تطبيقي خاص (No Application-Level
                        Encryption). تعتمد الحماية على قفل حساب نظام التشغيل وتشفير القرص.
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 bg-white border border-stone-200 rounded-lg text-[10px] text-stone-600 space-y-1.5 leading-relaxed">
                    <div className="flex items-center gap-1 font-bold text-stone-800">
                      <Info className="w-3.5 h-3.5 text-sky-700" />
                      <span>الفرق بين بقاء جلسة الدخول وتخزين المستندات:</span>
                    </div>
                    <p>{authVsCache.authPersistenceArabic}</p>
                    <p>{authVsCache.firestoreCacheArabic}</p>
                  </div>
                </div>

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
                    <span className="font-mono text-stone-700">
                      ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-[11px] text-stone-700 space-y-1.5 leading-relaxed">
                  <span className="font-bold text-stone-900 block">
                    سياسة تعارض التعديلات (Last-Write-Wins):
                  </span>
                  <p>
                    عند التعديل من أكثر من جلسة وإعادة الاتصال، يطبق Firestore افتراضياً قاعدة{' '}
                    <strong>الكتابة الأحدث تفوز (Last-Write-Wins)</strong> عند الخادم. الكشف
                    التلقائي عن تعارضات السحابة قبل الاستبدال يتطلب حقول إصدار (Versioning)
                    ومعاملات تحقق غير مفعلة في الإصدار الحالي.
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
                        أداة تطويرية لاختبار شاشة المقارنة والدمج اليدوي فقط؛ لا تمثل كشفاً
                        تلقائياً لتعارض فعلي قادم من السحابة.
                      </p>
                      <button
                        type="button"
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

              {/* 3. Follow-Up & Reminders Settings (Task 006) */}
              <div
                data-testid="followup-preferences-section"
                className="pt-3 border-t border-stone-200 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <Bell className="w-4 h-4 text-emerald-700" />
                    <span>المتابعات والتذكيرات</span>
                  </span>
                  <span className="text-[10px] text-stone-500">إشعارات داخل التطبيق فقط</span>
                </div>

                <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label
                        htmlFor="pref-reminders-enabled"
                        className="font-bold text-stone-900 block cursor-pointer"
                      >
                        تفعيل التذكيرات داخل التطبيق
                      </label>
                      <span className="text-[11px] text-stone-500 block">
                        تعطيلها يخفي التنبيهات فقط ولا يحذف المهام أو الاجتماعات
                      </span>
                    </div>
                    <input
                      id="pref-reminders-enabled"
                      data-testid="pref-reminders-enabled"
                      type="checkbox"
                      checked={followUpPreferences.remindersEnabled}
                      onChange={(e) =>
                        onUpdateFollowUpPreferences?.({
                          ...followUpPreferences,
                          remindersEnabled: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600 cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-stone-200/80">
                    <div>
                      <label
                        htmlFor="pref-meeting-lead"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        توقيت التذكير قبل الاجتماع
                      </label>
                      <select
                        id="pref-meeting-lead"
                        data-testid="pref-meeting-lead"
                        value={followUpPreferences.meetingLeadMinutes}
                        onChange={(e) =>
                          onUpdateFollowUpPreferences?.({
                            ...followUpPreferences,
                            meetingLeadMinutes: Number(
                              e.target.value
                            ) as MeetingLeadMinutesOption,
                          })
                        }
                        className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                      >
                        <option value={15}>قبل الاجتماع بـ 15 دقيقة</option>
                        <option value={30}>قبل الاجتماع بـ 30 دقيقة</option>
                        <option value={60}>قبل الاجتماع بساعة واحدة</option>
                        <option value={120}>قبل الاجتماع بساعتين</option>
                        <option value={1440}>قبل الاجتماع بيوم واحد (24 ساعة)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="pref-task-window"
                        className="block font-semibold text-stone-800 mb-1"
                      >
                        نافذة تنبيهات المهام القادمة
                      </label>
                      <select
                        id="pref-task-window"
                        data-testid="pref-task-window"
                        value={followUpPreferences.upcomingTaskWindowDays}
                        onChange={(e) =>
                          onUpdateFollowUpPreferences?.({
                            ...followUpPreferences,
                            upcomingTaskWindowDays: Number(
                              e.target.value
                            ) as UpcomingTaskWindowDaysOption,
                          })
                        }
                        className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                      >
                        <option value={0}>مهام اليوم فقط</option>
                        <option value={2}>خلال يومين</option>
                        <option value={3}>خلال 3 أيام</option>
                        <option value={7}>خلال أسبوع (7 أيام)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-stone-200/80">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-stone-700 font-medium">
                        إظهار تنبيهات المهام المتأخرة
                      </span>
                      <input
                        type="checkbox"
                        checked={followUpPreferences.showOverdueTasks}
                        onChange={(e) =>
                          onUpdateFollowUpPreferences?.({
                            ...followUpPreferences,
                            showOverdueTasks: e.target.checked,
                          })
                        }
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-stone-700 font-medium">
                        إظهار تنبيهات الاجتماعات القادمة والمتابعات
                      </span>
                      <input
                        type="checkbox"
                        checked={followUpPreferences.showUpcomingMeetings}
                        onChange={(e) =>
                          onUpdateFollowUpPreferences?.({
                            ...followUpPreferences,
                            showUpcomingMeetings: e.target.checked,
                          })
                        }
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-stone-700 font-medium">
                        تنبيهات العملاء دون تواصل مسجّل حديثاً
                      </span>
                      <input
                        type="checkbox"
                        checked={followUpPreferences.showStaleClients}
                        onChange={(e) =>
                          onUpdateFollowUpPreferences?.({
                            ...followUpPreferences,
                            showStaleClients: e.target.checked,
                          })
                        }
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                      />
                    </label>
                  </div>

                  <p className="text-[10px] text-stone-500 leading-relaxed">
                    ملاحظة: تعمل التذكيرات داخل التطبيق أثناء فتحه وتُحفظ إعداداتها وحالات
                    التأجيل لكل حساب على حدة دون إرسال رسائل نصية أو بريد إلكتروني عند الإغلاق.
                  </p>
                </div>
              </div>

              {/* 4. Hijri Calendar */}
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

              {/* 5. Biometric Security Lock (Demo Only) */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-stone-900 block">قفل الشاشة التجريبي</span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.2 rounded">
                      عرض توضيحي فقط
                    </span>
                  </div>
                  <span className="text-[11px] text-stone-500 block mt-0.5">
                    محاكاة لقفل شاشة الجهاز برقم PIN محلي (1234). عزل البيانات السحابية يتم
                    بالكامل عبر حساب Google وقواعد Firestore.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={appState.isBiometricEnabled}
                  onChange={(e) => onUpdateState({ isBiometricEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                />
              </div>

              {/* Quick Jump to Data Management Tab */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-stone-900 block">
                    إدارة البيانات وتصدير / استيراد السجلات
                  </span>
                  <span className="text-[11px] text-stone-500">
                    تصدير JSON وCSV واستيراد البيانات الآمن مع معاينة مسبقة
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('data')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white font-semibold hover:bg-stone-800 transition-colors shrink-0"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>فتح إدارة البيانات</span>
                </button>
              </div>
            </>
          )}

          {activeTab === 'data' && (
            <div className="space-y-5" data-testid="data-management-section">
              {/* Security & Attachment Policy Disclosures */}
              <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl space-y-2 text-amber-950">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-relaxed text-[11px]">
                    <span className="font-bold block">
                      سياسة المرفقات وأمان ملفات التصدير:
                    </span>
                    <p data-testid="attachment-export-disclosure">
                      {EXPORT_ATTACHMENT_DISCLOSURE_AR}
                    </p>
                    <p className="text-amber-900">{EXPORT_SECURITY_DISCLOSURE_AR}</p>
                  </div>
                </div>
              </div>

              {exportFeedbackAr && (
                <div
                  data-testid="export-feedback-banner"
                  className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 font-semibold text-[11px]">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{exportFeedbackAr}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExportFeedbackAr(null)}
                    className="text-emerald-700 hover:text-emerald-950 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Section A: Structured JSON Export */}
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <FileJson className="w-4 h-4 text-emerald-700" />
                    <h4 className="font-bold text-stone-900 text-xs">
                      تصدير بياناتي (JSON الموحد — murafiq-export-v1)
                    </h4>
                  </div>
                  <span
                    data-testid="export-completeness-badge"
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      isExportCompleteOnline
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                    }`}
                  >
                    {isExportCompleteOnline
                      ? 'حالة البيانات: مكتملة ومتصلة'
                      : 'حالة البيانات: محلية / جزئية'}
                  </span>
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed">
                  {isExportCompleteOnline
                    ? COMPLETE_ONLINE_EXPORT_DISCLOSURE_AR
                    : PARTIAL_OR_OFFLINE_EXPORT_DISCLOSURE_AR}
                </p>

                {/* Live Counts Grid */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {appState.clients.length}
                    </span>
                    <span className="text-[10px] text-stone-500">عميل</span>
                  </div>
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {opportunities.length}
                    </span>
                    <span className="text-[10px] text-stone-500">فرصة</span>
                  </div>
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {appState.meetings.length}
                    </span>
                    <span className="text-[10px] text-stone-500">اجتماع</span>
                  </div>
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {appState.tasks.length}
                    </span>
                    <span className="text-[10px] text-stone-500">مهمة</span>
                  </div>
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {appState.notes.length}
                    </span>
                    <span className="text-[10px] text-stone-500">ملاحظة</span>
                  </div>
                  <div className="p-2 bg-white border border-stone-200 rounded-lg text-center">
                    <span className="block font-bold text-stone-900 text-sm">
                      {opportunityStageEvents.length}
                    </span>
                    <span className="text-[10px] text-stone-500">حدث مرحلة</span>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    data-testid="export-json-btn"
                    onClick={handleExportJson}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-semibold text-xs transition-colors shadow-2xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>تصدير بياناتي (JSON)</span>
                  </button>
                </div>
              </div>

              {/* Section B: CSV Exports */}
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <h4 className="font-bold text-stone-900 text-xs">
                    تصدير القوائم بصيغة جداول (CSV متوافق مع العربية UTF-8 BOM)
                  </h4>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  يدعم التصدير العربية في Excel مع حماية تلقائية ضد حقن المعادلات (CSV Formula
                  Injection) وفصل عملات الفرص التجارية دون دمج مضلل.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="export-csv-clients-btn"
                    onClick={() => handleExportCsv('clients')}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-stone-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-stone-800 font-semibold transition-colors"
                  >
                    <span>تصدير قائمة العملاء (CSV)</span>
                    <Download className="w-3.5 h-3.5 text-emerald-700" />
                  </button>
                  <button
                    type="button"
                    data-testid="export-csv-opportunities-btn"
                    onClick={() => handleExportCsv('opportunities')}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-stone-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-stone-800 font-semibold transition-colors"
                  >
                    <span>تصدير قائمة فرص الأعمال (CSV)</span>
                    <Download className="w-3.5 h-3.5 text-emerald-700" />
                  </button>
                  <button
                    type="button"
                    data-testid="export-csv-meetings-btn"
                    onClick={() => handleExportCsv('meetings')}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-stone-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-stone-800 font-semibold transition-colors"
                  >
                    <span>تصدير قائمة الاجتماعات (CSV)</span>
                    <Download className="w-3.5 h-3.5 text-emerald-700" />
                  </button>
                  <button
                    type="button"
                    data-testid="export-csv-tasks-btn"
                    onClick={() => handleExportCsv('tasks')}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-stone-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-stone-800 font-semibold transition-colors"
                  >
                    <span>تصدير قائمة المهام (CSV)</span>
                    <Download className="w-3.5 h-3.5 text-emerald-700" />
                  </button>
                </div>
              </div>

              {/* Section C: Safe 4-Stage Data Import Wizard */}
              <div
                data-testid="safe-import-wizard"
                className="p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-3.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-emerald-700" />
                    <h4 className="font-bold text-stone-900 text-xs">
                      استيراد بيانات آمن (4 مراحل: اختيار ← تحقق ← معاينة ← تأكيد)
                    </h4>
                  </div>
                  {(selectedFileName || importPreview || importExecutionReport) && (
                    <button
                      type="button"
                      data-testid="reset-import-wizard-btn"
                      onClick={clearTemporaryImportState}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-700 text-[11px] font-semibold"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>مسح جلسة الاستيراد</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed">
                  يدعم استيراد ملف تصدير «مُرافق» بصيغة <strong>JSON</strong> أو قائمة عملاء بصيغة{' '}
                  <strong>CSV</strong>. لا يقوم الاستيراد بحذف أي بيانات حالية ولا يستبدل السجلات
                  الموجودة مسبقاً (يتم تخطي السجلات المكررة تلقائياً).
                </p>

                {!isOnline && (
                  <div
                    data-testid="import-offline-warning"
                    className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-center gap-2 text-[11px] font-semibold"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      أنت حالياً في وضع عدم الاتصال (Offline). يمكنك معاينة الملف محلياً، ولكن
                      حفظ الاستيراد يتطلب الاتصال بالإنترنت.
                    </span>
                  </div>
                )}

                {/* Stage 1: File Selection */}
                <div className="p-3 bg-white border border-dashed border-stone-300 rounded-xl flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-0.5">
                    <span className="font-bold text-stone-800 block text-xs">
                      1. اختر ملف التصدير (.json) أو ملف العملاء (.csv)
                    </span>
                    <span className="text-[11px] text-stone-500 block">
                      {selectedFileName
                        ? `الملف المحدد: ${selectedFileName}`
                        : 'الحد الأقصى لحجم الملف: 5 ميجابايت — لا يتم تنفيذ الاستيراد إلا بعد المعاينة والتأكيد'}
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>اختيار ملف للمعاينة</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      data-testid="import-file-input"
                      accept=".json,.csv,application/json,text/csv"
                      onChange={handleFileSelected}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Stage 2 & 3: Validation & Detailed Preview */}
                {importPreview && (
                  <div
                    data-testid="import-preview-panel"
                    className="p-3.5 bg-white border border-stone-200 rounded-xl space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
                      <span className="font-bold text-stone-900">
                        2 &amp; 3. نتائج التحقق الأمني ومعاينة البيانات قبل الاستيراد
                      </span>
                      <span className="text-[10px] font-mono bg-stone-100 px-2 py-0.5 rounded text-stone-700">
                        {importPreview.format === 'clients_csv'
                          ? 'CSV (قائمة عملاء)'
                          : `JSON (${importPreview.schemaVersionDetected || 'غير معروف'})`}
                      </span>
                    </div>

                    {importPreview.fatalErrorAr && (
                      <div
                        data-testid="import-fatal-error"
                        className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-[11px] font-bold flex items-center gap-2"
                      >
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{importPreview.fatalErrorAr}</span>
                      </div>
                    )}

                    {/* Summary Metrics Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-stone-50 border border-stone-200">
                        <span className="block text-sm font-bold text-stone-900">
                          {importPreview.totalInFile}
                        </span>
                        <span className="text-[10px] text-stone-500">إجمالي السجلات بالملف</span>
                      </div>
                      <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                        <span
                          data-testid="preview-valid-count"
                          className="block text-sm font-bold text-emerald-900"
                        >
                          {importPreview.totalValidToImport}
                        </span>
                        <span className="text-[10px] text-emerald-800">صالحة للاستيراد</span>
                      </div>
                      <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                        <span
                          data-testid="preview-duplicate-count"
                          className="block text-sm font-bold text-amber-900"
                        >
                          {importPreview.totalDuplicatesSkipped}
                        </span>
                        <span className="text-[10px] text-amber-800">
                          مكررة (سيتم تخطيها)
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-rose-50 border border-rose-200">
                        <span
                          data-testid="preview-rejected-count"
                          className="block text-sm font-bold text-rose-900"
                        >
                          {importPreview.totalRejected}
                        </span>
                        <span className="text-[10px] text-rose-800">مرفوضة / غير صالحة</span>
                      </div>
                    </div>

                    {/* Per-Collection Breakdown Table */}
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-[11px] text-right">
                        <thead className="bg-stone-100 text-stone-700 font-bold">
                          <tr>
                            <th className="p-2">الكيان</th>
                            <th className="p-2">في الملف</th>
                            <th className="p-2 text-emerald-800">سيتم استيراده</th>
                            <th className="p-2 text-amber-800">مكرر (تخطي)</th>
                            <th className="p-2 text-rose-800">مرفوض</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {(
                            [
                              ['clients', 'العملاء'],
                              ['opportunities', 'فرص الأعمال'],
                              ['meetings', 'الاجتماعات'],
                              ['tasks', 'المهام'],
                              ['notes', 'الملاحظات'],
                              ['opportunityStageEvents', 'سجل مراحل الفرص'],
                            ] as const
                          ).map(([colKey, labelAr]) => {
                            const row = importPreview.countsByCollection[colKey];
                            if (row.totalInFile === 0 && importPreview.format === 'clients_csv' && colKey !== 'clients') {
                              return null;
                            }
                            return (
                              <tr key={colKey}>
                                <td className="p-2 font-semibold text-stone-800">{labelAr}</td>
                                <td className="p-2">{row.totalInFile}</td>
                                <td className="p-2 font-bold text-emerald-800">
                                  {row.validToImport}
                                </td>
                                <td className="p-2 text-amber-800">{row.duplicateSkipped}</td>
                                <td className="p-2 text-rose-800">{row.rejected}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {importPreview.brokenRelationshipsCount > 0 && (
                      <div
                        data-testid="preview-broken-relations-warning"
                        className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-950"
                      >
                        تنبيه العلاقات المرجعية: تم رصد{' '}
                        <strong>{importPreview.brokenRelationshipsCount}</strong> ارتباط مرجعي
                        مفقود (مثل عميل أو فرصة غير موجودة)؛ تم التعامل معها بأمان لمنع إنشاء
                        سجلات يتيمة.
                      </div>
                    )}

                    {/* Issues & Warnings List */}
                    {importPreview.issues.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="font-bold text-stone-700 block text-[11px]">
                          تفاصيل الفحص والتنبيهات ({importPreview.issues.length}):
                        </span>
                        <div className="max-h-36 overflow-y-auto space-y-1 p-2 bg-stone-50 rounded-lg border border-stone-200">
                          {importPreview.issues.slice(0, 30).map((issue) => (
                            <div
                              key={issue.id}
                              className={`text-[10px] flex items-start gap-1.5 ${
                                issue.severity === 'error'
                                  ? 'text-rose-800 font-semibold'
                                  : 'text-amber-900'
                              }`}
                            >
                              <span>{issue.severity === 'error' ? '• [رفض]' : '• [تنبيه]'}</span>
                              <span>{issue.messageAr}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stage 4: Explicit Confirmation & Safe Execution */}
                    {importPreview.canProceed && (
                      <div className="pt-2 border-t border-stone-200 space-y-2.5">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            data-testid="confirm-import-checkbox"
                            checked={importConfirmedCheckbox}
                            onChange={(e) => setImportConfirmedCheckbox(e.target.checked)}
                            className="w-4 h-4 mt-0.5 rounded text-emerald-600 focus:ring-emerald-600"
                          />
                          <span className="text-[11px] font-semibold text-stone-800 leading-relaxed">
                            أؤكد رغبتي في استيراد{' '}
                            <strong>{importPreview.totalValidToImport}</strong> سجل صالح إلى
                            حسابي الحالي مع تخطي السجلات المكررة وعدم المساس ببياناتي السابقة.
                          </span>
                        </label>

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            data-testid="execute-import-btn"
                            disabled={
                              !importConfirmedCheckbox ||
                              !isOnline ||
                              isExecutingImport ||
                              !importHandlers
                            }
                            onClick={() => handleExecuteConfirmedImport(false)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {isExecutingImport
                                ? 'جاري الاستيراد الآمن...'
                                : 'بدء الاستيراد المعتمد الآن'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Execution Report & Safe Retry of Failed Items */}
                {importExecutionReport && (
                  <div
                    data-testid="import-execution-report"
                    className={`p-3.5 rounded-xl border space-y-2.5 ${
                      importExecutionReport.status === 'completed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : importExecutionReport.status === 'partial_failure'
                        ? 'bg-amber-50 border-amber-300 text-amber-950'
                        : 'bg-rose-50 border-rose-200 text-rose-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs">
                        تقرير نتيجة الاستيراد:
                      </span>
                      <span className="text-[11px] font-bold">
                        نجح: {importExecutionReport.totalSucceeded} | تخطي مكرر:{' '}
                        {importExecutionReport.totalSkippedDuplicates} | فشل:{' '}
                        {importExecutionReport.totalFailed}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {importExecutionReport.messageAr}
                    </p>

                    {importExecutionReport.totalFailed > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          data-testid="retry-failed-import-btn"
                          disabled={isExecutingImport || !isOnline}
                          onClick={() => handleExecuteConfirmedImport(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-white font-semibold text-xs disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>إعادة محاولة السجلات الفاشلة فقط (دون تكرار الناجحة)</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'assumptions' && (
            /* Design Assumptions Tab */
            <div className="space-y-3 leading-relaxed text-stone-700">
              <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 text-emerald-950">
                <span className="font-bold block mb-1">
                  توثيق فرضيات التصميم (Design Assumptions Log):
                </span>
                <p className="text-[11px]">
                  تم تسجيل الحلول التصميمية القابلة للمراجعة كفرضيات قابلة للتعديل وليست متطلبات
                  ثابتة:
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">
                    1. دورة حياة اللقاء (قبل / أثناء / بعد):
                  </span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تم تقسيم تفاصيل اللقاء إلى 3 مراحل تبويب واضحة لتعزيز فلسفة &quot;المساعد الذي
                    يسبق اللقاء ويرافقك فيه ويتابعك بعده&quot;.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">
                    2. مؤشرات موثوقية المعلومة (Provenance):
                  </span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تمييز المهام بـ (من المحضر / اقتراح ذكي / معتمد شخصياً / يحتاج تدقيق) لضمان
                    الشفافية دون جعل الذكاء الاصطناعي محور الشاشة.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">
                    3. التخزين الدائم للأجهزة الموثوقة فقط:
                  </span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    البدء بوضع الذاكرة فقط (memoryLocalCache) افتراضياً، واشتراط موافقة صريحة من
                    المستخدم وإعادة تشغيل لتفعيل IndexedDB نظراً لعدم وجود تشفير تطبيقي محلي.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">
                    4. سياسة التعارض في الإصدار الأول (LWW):
                  </span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    يعتمد Firestore في الإصدار الحالي Last-Write-Wins عند المزامنة، وتبقى واجهة حل
                    التعارض متاحة للمراجعة اليدوية أو المحاكاة التطويرية إلى أن يضاف ترقيم
                    الإصدارات مستقبلاً.
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
