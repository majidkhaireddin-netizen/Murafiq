import React, { useState } from 'react';
import { CacheMode, ReminderItem, SnoozePreset, SyncState } from '../types';
import { DetailedSyncSummary } from '../utils/syncLogic';
import { formatArabicDate } from '../utils/logic';
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
  Bell,
  Clock,
  Check,
  X,
  ArrowLeft,
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
  // Task 006: In-App Notifications Menu
  activeReminders?: ReminderItem[];
  remindersEnabled?: boolean;
  onOpenReminderSource?: (reminder: ReminderItem) => void;
  onSnoozeReminder?: (reminder: ReminderItem, preset: SnoozePreset) => void;
  onDismissReminder?: (reminder: ReminderItem) => void;
  onViewAllReminders?: () => void;
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
  activeReminders = [],
  remindersEnabled = true,
  onOpenReminderSource,
  onSnoozeReminder,
  onDismissReminder,
  onViewAllReminders,
}) => {
  const [showSyncPopover, setShowSyncPopover] = useState(false);
  const [showNotificationsPopover, setShowNotificationsPopover] = useState(false);

  const isOnline = syncSummary?.isOnline ?? true;
  const pendingCount = syncSummary?.pendingOperationsCount ?? 0;
  const activeReminderCount = remindersEnabled ? activeReminders.length : 0;

  const getReminderTypeLabel = (item: ReminderItem) => {
    if (item.sourceType === 'task') return language === 'ar' ? 'مهمة' : 'Task';
    if (item.sourceType === 'meeting') return language === 'ar' ? 'اجتماع' : 'Meeting';
    return language === 'ar' ? 'عميل' : 'Client';
  };

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
          className:
            'bg-orange-100 text-orange-900 border-orange-300 hover:bg-orange-200 ring-2 ring-orange-400/50',
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
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200 px-3 sm:px-5 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
            م
          </div>
          <div className="shrink-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-heading font-bold text-stone-900 text-base leading-tight tracking-tight whitespace-nowrap">
                {language === 'ar' ? 'مُرافق' : 'Murafiq'}
              </h1>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 hidden sm:inline-block">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-stone-500 truncate hidden sm:block">
              {language === 'ar'
                ? 'المساعد اليومي للقاءات والمهام'
                : 'Daily companion for meetings & tasks'}
            </p>
          </div>
        </div>

        {/* Action Controls & Sync State */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Real Firestore Offline/Sync State Badge with Popover */}
          <div className="relative">
            <button
              type="button"
              data-testid="sync-status-badge"
              onClick={() => {
                setShowNotificationsPopover(false);
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
              className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${syncBadge.className}`}
              aria-label="Sync status details"
            >
              {syncBadge.icon}
              <span className="text-[11px] sm:text-xs">{syncBadge.label}</span>
            </button>

            {showSyncPopover && (
              <div
                data-testid="sync-status-popover"
                className="absolute top-full mt-2 rtl:left-0 ltr:right-0 w-76 max-w-[305px] bg-white rounded-xl shadow-xl border border-stone-200 p-3.5 z-50"
                onMouseLeave={() => setShowSyncPopover(false)}
              >
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-stone-100">
                  <span className="text-xs font-bold text-stone-800">
                    {language === 'ar' ? 'حالة التزامن والاتصال' : 'Sync & Connectivity Status'}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${syncBadge.className}`}
                  >
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
                      <span
                        className={`font-bold ${
                          isOnline ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
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
                        <span className="font-bold text-amber-700 tabular-nums">
                          {pendingCount}
                        </span>
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

          {/* In-App Notifications Bell & Dropdown */}
          <div className="relative">
            <button
              type="button"
              data-testid="notifications-bell-button"
              onClick={() => {
                setShowSyncPopover(false);
                setShowNotificationsPopover((prev) => !prev);
              }}
              className={`relative p-1.5 rounded-lg transition-colors ${
                showNotificationsPopover
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
              }`}
              title={language === 'ar' ? 'التنبيهات والتذكيرات' : 'Reminders & Notifications'}
              aria-label={language === 'ar' ? 'التنبيهات والتذكيرات' : 'Notifications'}
              aria-expanded={showNotificationsPopover}
            >
              <Bell className="w-4 h-4" />
              {activeReminderCount > 0 && (
                <span
                  data-testid="notifications-badge-count"
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums shadow-2xs"
                >
                  {activeReminderCount > 99 ? '99+' : activeReminderCount}
                </span>
              )}
            </button>

            {showNotificationsPopover && (
              <div
                data-testid="notifications-popover"
                className="absolute top-full mt-2 rtl:left-0 ltr:right-0 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-stone-200 z-50 overflow-hidden"
              >
                <div className="px-3.5 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-emerald-700" />
                    <span className="text-xs font-bold text-stone-900">
                      {language === 'ar' ? 'التذكيرات النشطة' : 'Active Reminders'}
                    </span>
                    <span className="text-[11px] font-semibold text-stone-500 tabular-nums">
                      ({activeReminderCount})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNotificationsPopover(false)}
                    className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
                    aria-label="إغلاق قائمة التنبيهات"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-stone-100">
                  {!remindersEnabled ? (
                    <div className="p-4 text-center space-y-2">
                      <p className="text-xs font-medium text-stone-700">
                        التذكيرات داخل التطبيق متوقفة حالياً من الإعدادات.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotificationsPopover(false);
                          onOpenSettings();
                        }}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        فتح إعدادات المتابعة
                      </button>
                    </div>
                  ) : activeReminders.length === 0 ? (
                    <div className="p-5 text-center space-y-1">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                      <p className="text-xs font-semibold text-stone-800">
                        لا توجد تذكيرات نشطة الآن
                      </p>
                      <p className="text-[11px] text-stone-500">
                        كل المواعيد والالتزامات الحالية تحت المتابعة.
                      </p>
                    </div>
                  ) : (
                    activeReminders.slice(0, 6).map((rem) => (
                      <div key={rem.id} className="p-3 space-y-2 hover:bg-stone-50/70 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setShowNotificationsPopover(false);
                                onOpenReminderSource?.(rem);
                              }}
                              className="text-xs font-bold text-stone-900 hover:text-emerald-800 text-start block truncate w-full"
                            >
                              {rem.titleArabic}
                            </button>
                            <div className="text-[11px] text-stone-500 flex items-center flex-wrap gap-1.5">
                              <span
                                className={
                                  rem.severity === 'high'
                                    ? 'text-rose-700 font-semibold'
                                    : 'text-amber-800 font-medium'
                                }
                              >
                                {getReminderTypeLabel(rem)}
                              </span>
                              {rem.clientName && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{rem.clientName}</span>
                                </>
                              )}
                              {rem.dueAt && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums">
                                    {formatArabicDate(rem.dueAt, rem.sourceType === 'meeting')}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-[11px] text-stone-600">{rem.subtitleArabic}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-1.5 pt-0.5 flex-wrap">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSnoozeReminder?.(rem, '1h')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-700"
                            >
                              <Clock className="w-3 h-3 text-stone-500" />
                              <span>ساعة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onSnoozeReminder?.(rem, 'tomorrow')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-700"
                            >
                              <span>غداً</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDismissReminder?.(rem)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[10px] font-medium text-stone-600"
                            >
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>إخفاء</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setShowNotificationsPopover(false);
                              onOpenReminderSource?.(rem);
                            }}
                            className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800"
                          >
                            فتح السجل
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-3.5 py-2.5 bg-stone-50 border-t border-stone-200 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-stone-500">
                    تنبيهات داخل التطبيق أثناء الجلسة
                  </span>
                  <button
                    type="button"
                    data-testid="view-all-reminders-link"
                    onClick={() => {
                      setShowNotificationsPopover(false);
                      onViewAllReminders?.();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
                  >
                    <span>عرض جميع التذكيرات</span>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Search */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
            title={language === 'ar' ? 'بحث شامل (عملاء، لقاءات، مهام)' : 'Universal Search'}
            aria-label="Universal Search"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Biometric Security Lock (Demo Only) */}
          <button
            type="button"
            onClick={onTriggerLock}
            className="p-1.5 text-stone-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors hidden xs:inline-flex"
            title={
              language === 'ar'
                ? 'قفل شاشة تجريبي (عرض توضيحي)'
                : 'Demo Screen Lock (Demonstration only)'
            }
            aria-label="Demo Lock"
          >
            <Lock className="w-4 h-4" />
          </button>

          {/* Language Toggle */}
          <button
            type="button"
            onClick={onToggleLanguage}
            className="px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg border border-stone-200 transition-colors"
            title={language === 'ar' ? 'Switch to English' : 'التحويل إلى العربية'}
          >
            {language === 'ar' ? 'EN' : 'عربي'}
          </button>

          {/* Frame Toggle */}
          <button
            type="button"
            data-testid="toggle-frame-mode-button"
            onClick={onToggleFrame}
            className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors inline-flex items-center gap-1 text-xs"
            title={isMobileFrame ? 'عرض كامل للشاشة' : 'محاكي شاشة الجوال (430px)'}
            aria-label="Toggle Frame Mode"
          >
            {isMobileFrame ? (
              <>
                <Maximize2 className="w-4 h-4 text-emerald-700" />
                <span className="text-[11px] text-emerald-700 font-medium hidden sm:inline">
                  شاشة كاملة
                </span>
              </>
            ) : (
              <>
                <Smartphone className="w-4 h-4 text-emerald-700" />
                <span className="text-[11px] text-emerald-700 font-medium hidden sm:inline">
                  إطار جوال
                </span>
              </>
            )}
          </button>

          {/* Settings */}
          <button
            type="button"
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
            <div className="flex items-center gap-1 ps-1 border-s border-stone-200">
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
                  type="button"
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
