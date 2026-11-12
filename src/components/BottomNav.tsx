import React from 'react';
import { LayoutDashboard, Users, Calendar, CheckSquare, BarChart3, StickyNote } from 'lucide-react';

export type NavTab = 'dashboard' | 'clients' | 'meetings' | 'tasks' | 'notes' | 'reports';

interface BottomNavProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  overdueTasksCount: number;
  upcomingMeetingsCount: number;
  language: 'ar' | 'en';
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  overdueTasksCount,
  upcomingMeetingsCount,
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
      id: 'clients' as NavTab,
      label: language === 'ar' ? 'العملاء' : 'Clients',
      icon: Users,
      badge: 0,
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
    <nav className="sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 px-2 py-1.5 transition-all">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all duration-150 ${
                isActive
                  ? 'text-emerald-700 font-semibold'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              aria-label={tab.label}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'scale-110 stroke-[2.25px]' : 'stroke-[1.75px]'
                  }`}
                />
                {tab.badge > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-xs ${tab.badgeColor || 'bg-emerald-600'}`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[11px] mt-1 ${isActive ? 'font-bold' : 'font-medium'}`}>
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
