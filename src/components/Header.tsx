import React, { useState } from 'react';
import { CacheMode, SyncState } from '../types';
import { DetailedSyncSummary } from '../utils/syncLogic';
import {
  Search,
  Lock,
  Smartphone,
  Maximize2,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  LogOut,
  WifiOff,
  Database,
} from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  syncState: SyncState;
  syncSummary?: DetailedSyncSummary;
  activeCacheMode?: CacheMode;
  onSyncStateChange: (state: SyncState) => void;
  onOpenSearch: () => void;
  onTriggerLock: () => void;
  isMobileFrame: boolean;
  onToggleFrame: () => void;
  language: 'ar' | 'en';
  onToggleLanguage: () => void;
  onOpenSettings: () => void;
  conflictCount?: number;
  onOpenConflictModal?: () => void;
  currentUser?: User | null;
  onLogOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  syncState,
  syncSummary,
  activeCacheMode = 'memory',
  onOpenSearch,
  onTriggerLock,
  isMobileFrame,
  onToggleFrame,
  language,
  onToggleLanguage,
  onOpenSettings,
  conflictCount = 0,
  onOpenConflictModal,
  currentUser,
  onLogOut,
}) => {
  const [showSyncPopover, setShowSyncPopover] = useState(false);

  const isOnline = syncSummary?.isOnline ?? true;
  const pendingCount = syncSummary?.pendingOperationsCount ?? 0;

  const getSyncBadge = () => {
    switch (syncState) {
      case 'local':
        return {
          icon: !isOnline ? (
            <WifiOff className="w-3.5 h-3.5 text-amber-700" />
          ) : (
            <HardDrive className="w-3.5 h-3.5 text-stone-600" />
          ),
          label:
            language === 'ar'
              ? syncSummary?.labelArabic || (!isOnline ? 'غير متصل' : 'محلي فقط')
              : syncSummary?.labelEnglish || (!isOnline ? 'Offline' : 'Local Only'),
          className: !isOnline
            ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
            : 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200',
        };
      case 'pending':
        return {
          icon: !isOnline ? (
            <WifiOff className="w-3.5 h-3.5 text-amber-700" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />
          ),
          label:
            language === 'ar'
              ? syncSummary?.labelArabic || `قيد المزامنة (${pendingCount || 1})`
              : syncSummary?.labelEnglish || `Syncing (${pendingCount || 1})`,
          className: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
        };
      case 'synced':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
          label: language === 'ar' ? 'متزامن' : 'Synced',
          className: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
        };
      case 'conflict':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />,
          label:
            language === 'ar'
              ? `تعارض (${conflictCount || 1})`
              : `Conflict (${conflictCount || 1})`,
          className: 'bg-orange-100 text-orange-900 border-orange-300 hover:bg-orange-200 ring-2 ring-orange-400/50',
        };
      case 'failed':
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
          label:
            language === 'ar'
              ? syncSummary?.labelArabic || 'خطأ مزامنة'
              : syncSummary?.labelEnglish || 'Sync Failed',
          className: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
        };
    }
  };

  const syncBadge = getSyncBadge();

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200 px-4 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3">
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
            م
          </div>
          <div className="truncate">
            <div className="flex items-center gap-1.5">
              <h1 className="font-heading font-bold text-stone-900 text-base leading-tight tracking-tight">
                {language === 'ar' ? 'مُرافق' : 'Murafiq'}
              </h1>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-stone-500 truncate hidden sm:block">
              {language === 'ar' ? 'المساعد اليومي للقاءات والمهام' : 'Daily companion for meetings & tasks'}
            </p>
          </div>
        </div>

        {/* Action Controls & Sync State */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Real Firestore Offline/Sync State Badge with Popover */}
          <div className="relative">
            <button
              type="button"
              data-testid="sync-status-badge"
              onClick={() => {
                if (syncState === 'conflict' && onOpenConflictModal) {
                  onOpenConflictModal();
                } else {
                  setShowSyncPopover(!showSyncPopover);
                }
              }}
              title={
                syncState === 'conflict'
                  ? 'انقر لمعالجة تعارض البيانات'
                  : language === 'ar'
                  ? 'تفاصيل حالة الاتصال والمزامنة'
                  : 'Connection & Sync Details'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${syncBadge.className}`}
              aria-label="Sync status details"
            >
              {syncBadge.icon}
              <span className="hidden xs:inline">{syncBadge.label}</span>
            </button>

            {showSyncPopover && (
              <div
                data-testid="sync-status-popover"
                className="absolute top-full mt-2 rtl:right-0 ltr:left-0 w-76 max-w-[305px] bg-white rounded-xl shadow-xl border border-stone-200 p-3.5 z-50 animate-in fade-in zoom-in-95"
                onMouseLeave={() => setShowSyncPopover(false)}
              >
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-stone-100">
                  <span className="text-xs font-bold text-stone-800">
                    {language === 'ar' ? 'حالة التزامن والاتصال' : 'Sync & Connectivity Status'}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${syncBadge.className}`}>
                    {syncBadge.label}
                  </span>
                </div>
                <div className="text-[11px] text-stone-600 space-y-2 leading-relaxed">
                  <p>
                    {language === 'ar'
                      ? syncSummary?.descriptionArabic
                      : syncSummary?.descriptionEnglish}
                  </p>

                  <div className="bg-stone-50 border border-stone-200/80 rounded-lg p-2 space-y-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">حالة الشبكة:</span>
                      <span className={`font-bold ${isOnline ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {isOnline ? 'متصل بالشبكة' : 'غير متصل (Offline)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">التخزين المحلي النشط:</span>
                      <span className="font-semibold text-stone-800 flex items-center gap-1">
                        <Database className="w-3 h-3 text-stone-500" />
                        {activeCacheMode === 'persistent'
                          ? 'دائم (IndexedDB)'
                          : 'الذاكرة فقط (RAM)'}
                      </span>
                    </div>
                    {pendingCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">تعديلات بانتظار السحابة:</span>
                        <span className="font-bold text-amber-700">{pendingCount}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-1 flex items-center justify-between border-t border-stone-100 text-[10px]">
                    <span className="text-stone-400">مراقبة تلقائية عبر Firestore</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSyncPopover(false);
                        onOpenSettings();
                      }}
                      className="text-emerald-700 hover:text-emerald-800 font-semibold"
                    >
                      إعدادات التخزين
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Search */}
          <button
            onClick={onOpenSearch}
            className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
            title={language === 'ar' ? 'بحث شامل (عملاء، لقاءات، مهام)' : 'Universal Search'}
            aria-label="Universal Search"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Biometric Security Lock (Demo Only) */}
          <button
            onClick={onTriggerLock}
            className="p-1.5 text-stone-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
            title={language === 'ar' ? 'قفل شاشة تجريبي (عرض توضيحي)' : 'Demo Screen Lock (Demonstration only)'}
            aria-label="Demo Lock"
          >
            <Lock className="w-4 h-4" />
          </button>

          {/* Language Toggle */}
          <button
            onClick={onToggleLanguage}
            className="px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg border border-stone-200 transition-colors"
            title={language === 'ar' ? 'Switch to English' : 'التحويل إلى العربية'}
          >
            {language === 'ar' ? 'EN' : 'عربي'}
          </button>

          {/* Frame Toggle */}
          <button
            onClick={onToggleFrame}
            className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors hidden md:flex items-center gap-1 text-xs"
            title={isMobileFrame ? 'عرض كامل للشاشة' : 'محاكي شاشة الجوال (390px)'}
            aria-label="Toggle Frame Mode"
          >
            {isMobileFrame ? (
              <>
                <Maximize2 className="w-4 h-4 text-stone-600" />
                <span className="text-[11px] text-stone-500">شاشة كاملة</span>
              </>
            ) : (
              <>
                <Smartphone className="w-4 h-4 text-emerald-700" />
                <span className="text-[11px] text-emerald-700 font-medium">إطار جوال</span>
              </>
            )}
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            data-testid="open-settings-button"
            className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition-colors"
            title={language === 'ar' ? 'الإعدادات والتخزين المحلي' : 'Settings & Offline Storage'}
            aria-label="Settings"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Authenticated User & Logout */}
          {currentUser && (
            <div className="flex items-center gap-1.5 ps-1 border-s border-stone-200">
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-6 h-6 rounded-full border border-stone-300 object-cover"
                  referrerPolicy="no-referrer"
                  title={currentUser.email || currentUser.displayName || ''}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[10px] font-bold"
                  title={currentUser.email || currentUser.displayName || ''}
                >
                  {(currentUser.displayName || currentUser.email || 'م').charAt(0).toUpperCase()}
                </div>
              )}
              {onLogOut && (
                <button
                  onClick={onLogOut}
                  data-testid="signout-button"
                  className="p-1.5 text-stone-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
                  aria-label="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
