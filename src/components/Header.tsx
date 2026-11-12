import React, { useState } from 'react';
import { SyncState } from '../types';
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
  Languages,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  syncState: SyncState;
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
  onSyncStateChange,
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

  const getSyncBadge = () => {
    switch (syncState) {
      case 'local':
        return {
          icon: <HardDrive className="w-3.5 h-3.5 text-stone-600" />,
          label: language === 'ar' ? 'محلي فقط' : 'Local Only',
          className: 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200',
        };
      case 'pending':
        return {
          icon: <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />,
          label: language === 'ar' ? 'قيد المزامنة' : 'Syncing...',
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
          icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-600 animate-bounce" />,
          label: language === 'ar' ? `تعارض بيانات (${conflictCount || 1})` : `Conflict (${conflictCount || 1})`,
          className: 'bg-orange-100 text-orange-900 border-orange-300 hover:bg-orange-200 ring-2 ring-orange-400/50',
        };
      case 'failed':
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
          label: language === 'ar' ? 'فشل المزامنة' : 'Sync Failed',
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
          {/* Offline/Sync State Badge with Popover */}
          <div className="relative">
            <button
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
                  ? 'حالة التخزين والمزامنة (انقر للتغيير)'
                  : 'Storage & Sync status (Click to toggle)'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${syncBadge.className}`}
              aria-label="Toggle sync states"
            >
              {syncBadge.icon}
              <span className="hidden xs:inline">{syncBadge.label}</span>
            </button>

            {showSyncPopover && (
              <div
                className="absolute top-full mt-2 rtl:right-0 ltr:left-0 w-64 max-w-[280px] bg-white rounded-xl shadow-xl border border-stone-200 p-3 z-50 animate-in fade-in zoom-in-95"
                onMouseLeave={() => setShowSyncPopover(false)}
              >
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-stone-100">
                  <span className="text-xs font-semibold text-stone-800">
                    {language === 'ar' ? 'محاكي حالات المزامنة' : 'Sync State Simulator'}
                  </span>
                  <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                    Offline-First
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
                  {language === 'ar'
                    ? 'في الإصدار الأول، يعمل مرافق محلياً 100%. يمكنك اختبار ظهور الحالات البصرية الخمس للمزامنة:'
                    : 'In v1.0, Murafiq is 100% offline-first. Preview the 5 visual sync states:'}
                </p>
                <div className="space-y-1">
                  {(['local', 'pending', 'synced', 'conflict', 'failed'] as SyncState[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        onSyncStateChange(st);
                        setShowSyncPopover(false);
                      }}
                      className={`w-full text-start flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        syncState === st
                          ? 'bg-emerald-50 text-emerald-800 font-semibold'
                          : 'hover:bg-stone-50 text-stone-700'
                      }`}
                    >
                      <span className="capitalize">
                        {st === 'local' && (language === 'ar' ? '⚡ محلي فقط (الافتراضي)' : '⚡ Local Only (Default)')}
                        {st === 'pending' && (language === 'ar' ? '⏳ قيد المزامنة' : '⏳ Pending Sync')}
                        {st === 'synced' && (language === 'ar' ? '✅ متزامن بالكامل' : '✅ Synced')}
                        {st === 'conflict' && (language === 'ar' ? '⚠️ تعارض يحتاج حسم' : '⚠️ Conflict')}
                        {st === 'failed' && (language === 'ar' ? '❌ فشل الاتصال' : '❌ Sync Failed')}
                      </span>
                      {syncState === st && <span className="text-emerald-600 font-bold">✓</span>}
                    </button>
                  ))}
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

          {/* Biometric Security Lock (Clearly labeled as Demo Screen Lock per Requirement 7) */}
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

          {/* Frame Toggle (Phone mockup vs Fluid desktop) */}
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

          {/* Help / Settings */}
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition-colors"
            title={language === 'ar' ? 'الإعدادات وفرضيات التصميم' : 'Settings & Design Assumptions'}
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
