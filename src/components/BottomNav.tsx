import React from 'react';
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  Briefcase,
  Calendar,
  CheckSquare,
  BarChart3,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'today'
  | 'clients'
  | 'opportunities'
  | 'meetings'
  | 'tasks'
  | 'notes'
  | 'reports';

interface BottomNavProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  overdueTasksCount: number;
  upcomingMeetingsCount: number;
  activeRemindersCount?: number;
  overdueOpportunitiesCount?: number;
  language: 'ar' | 'en';
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  overdueTasksCount,
  upcomingMeetingsCount,
  activeRemindersCount = 0,
  overdueOpportunitiesCount = 0,
  language,
}) => {
  const tabs = [
    {
      id: 'dashboard' as NavTab,
      label: language === 'ar' ? 'الرئيسية' : 'Home',
      icon: LayoutDashboard,
      badge: 0,
    },
    {
      id: 'today' as NavTab,
      label: language === 'ar' ? 'يومي' : 'Today',
      icon: CalendarCheck,
      badge: activeRemindersCount,
      badgeColor: 'bg-amber-600',
    },
    {
      id: 'clients' as NavTab,
      label: language === 'ar' ? 'العملاء' : 'Clients',
      icon: Users,
      badge: 0,
    },
    {
      id: 'opportunities' as NavTab,
      label: language === 'ar' ? 'الفرص' : 'Pipeline',
      icon: Briefcase,
      badge: overdueOpportunitiesCount,
      badgeColor: 'bg-amber-600',
    },
    {
      id: 'meetings' as NavTab,
      label: language === 'ar' ? 'اللقاءات' : 'Meetings',
      icon: Calendar,
      badge: upcomingMeetingsCount,
      badgeColor: 'bg-emerald-600',
    },
    {
      id: 'tasks' as NavTab,
      label: language === 'ar' ? 'المهام' : 'Tasks',
      icon: CheckSquare,
      badge: overdueTasksCount,
      badgeColor: 'bg-rose-500',
    },
    {
      id: 'reports' as NavTab,
      label: language === 'ar' ? 'التقارير' : 'Reports',
      icon: BarChart3,
      badge: 0,
    },
  ];

  return (
    <nav className="sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 px-1 py-1.5 transition-all">
      <div className="flex items-center justify-around max-w-2xl mx-auto gap-0.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`nav-tab-${tab.id}`}
              onClick={() => onChangeTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-1 sm:px-2.5 rounded-xl transition-all duration-150 min-w-0 whitespace-nowrap shrink-0 ${
                isActive
                  ? 'text-emerald-700 font-semibold'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              aria-label={tab.label}
            >
              <div className="relative">
                <Icon
                  className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${
                    isActive ? 'scale-105 stroke-[2.25px]' : 'stroke-[1.75px]'
                  }`}
                />
                {tab.badge > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-2xs tabular-nums ${
                      tab.badgeColor || 'bg-emerald-600'
                    }`}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[9.5px] sm:text-[11px] mt-1 whitespace-nowrap ${
                  isActive ? 'font-bold' : 'font-medium'
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="w-1 h-1 rounded-full bg-emerald-600 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
