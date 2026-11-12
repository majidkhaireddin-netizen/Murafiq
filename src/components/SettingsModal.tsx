import React, { useState } from 'react';
import { AppState, SyncState } from '../types';
import {
  Settings,
  HardDrive,
  Download,
  Upload,
  Shield,
  Calendar,
  Languages,
  Info,
  X,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appState: AppState;
  onUpdateState: (updates: Partial<AppState>) => void;
  onResetData: () => void;
  language: 'ar' | 'en';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appState,
  onUpdateState,
  onResetData,
  language,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'assumptions'>('general');

  if (!isOpen) return null;

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
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-auto overflow-hidden border border-stone-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-stone-700" />
            <h3 className="font-heading font-bold text-base text-stone-900">
              {language === 'ar' ? 'الإعدادات وفرضيات التصميم' : 'Settings & Design Assumptions'}
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
            إعدادات التطبيق والمزامنة
          </button>
          <button
            onClick={() => setActiveTab('assumptions')}
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeTab === 'assumptions'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            وثيقة فرضيات التصميم (Design Assumptions)
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
          {activeTab === 'general' ? (
            <>
              {/* 1. Offline & Sync Simulation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 block flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-emerald-700" />
                    <span>قاعدة بيانات Firebase Firestore السحابية</span>
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                    متصل بالسحابة
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

                <p className="text-stone-500 text-[11px] leading-relaxed pt-1">
                  يتم حفظ وتحديث بيانات العملاء واللقاءات والمهام في السحابة ومزامنتها لحظياً. يمكنك اختبار التبديل بين الحالات البصرية:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'synced', label: '✅ متزامن بالكامل' },
                    { id: 'pending', label: '⏳ قيد المزامنة' },
                    { id: 'local', label: '⚡ محلي (أوفلاين)' },
                    { id: 'conflict', label: '⚠️ تعارض بيانات' },
                    { id: 'failed', label: '❌ فشل المزامنة' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onUpdateState({ syncState: item.id as SyncState })}
                      className={`p-2 rounded-xl border text-center font-medium transition-colors ${
                        appState.syncState === item.id
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-400 font-bold'
                          : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Hijri Calendar */}
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

              {/* 3. Biometric Security Lock */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-stone-900 block">القفل الحيوي ورمز PIN</span>
                  <span className="text-[11px] text-stone-500">
                    طلب بصمة الإصبع أو رمز PIN عند فتح التطبيق لحماية خصوصية بيانات العملاء
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={appState.isBiometricEnabled}
                  onChange={(e) => onUpdateState({ isBiometricEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-600"
                />
              </div>

              {/* 4. Data Backup & Reset */}
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <span className="font-bold text-stone-900 block">النسخ الاحتياطي وإعادة الضبط</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleExportJson}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير نسخة احتياطية JSON</span>
                  </button>
                  <button
                    onClick={onResetData}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 text-rose-700 font-medium hover:bg-rose-50 border border-stone-200 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>إعادة ضبط البيانات الأولية</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Design Assumptions Tab (Rule 12) */
            <div className="space-y-3 leading-relaxed text-stone-700">
              <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 text-emerald-950">
                <span className="font-bold block mb-1">توثيق فرضيات التصميم (Design Assumptions Log):</span>
                <p className="text-[11px]">
                  التزاماً بالمبدأ التوجيهي (Rule 12)، تم تسجيل الحلول التصميمية القابلة للمراجعة كفرضيات قابلة للتعديل وليست متطلبات ثابتة:
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">1. دورة حياة اللقاء (قبل / أثناء / بعد):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تم تقسيم تفاصيل اللقاء إلى 3 مراحل تبويب واضحة لتعزيز فلسفة &quot;المساعد الذي يسبق اللقاء ويرافقك فيه ويتابعك بعده&quot;، مما يتيح التدوين السريع أثناء الجلسة دون تشتيت.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">2. مؤشرات موثوقية المعلومة (Provenance):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    تمييز المهام بـ (من المحضر / اقتراح ذكي / معتمد شخصياً / يحتاج تدقيق) لضمان الشفافية وثقة المستقل في مخرجات النظام، دون جعله مركز الشاشة.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">3. التنبيه الاستباقي للعملاء غير المتصلين (&gt;30 يوماً):</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    يظهر تنبيه خفيف وهادئ في الصفحة الرئيسية عند مرور أكثر من 30 يوماً دون لقاء مع عميل نشط، مع زر لجدولة متابعة سريعة بنقرة واحدة.
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-900 block">4. إطار شاشة الجوال والشاشة الكاملة:</span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    توفير خيار العرض داخل إطار جوال تفاعلي (390px) وخيار التوسيع للشاشة الكاملة، لتمكين مراجعة معايير اللمس والمساحات الآمنة للموبايل بسهولة.
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
