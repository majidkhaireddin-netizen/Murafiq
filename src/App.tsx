import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { subscribeAuthState, logOut } from './services/firebase';
import { clearAttachmentDownloadCache } from './utils/attachmentDownloadCache';
import { AuthScreen } from './components/AuthScreen';
import { AuthenticatedSession } from './components/AuthenticatedSession';
import { Wifi, BatteryMedium, Signal } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthRestoring, setIsAuthRestoring] = useState<boolean>(true);
  const [isMobileFrame, setIsMobileFrame] = useState<boolean>(false);

  // Monitor Authentication State
  useEffect(() => {
    const unsubscribeAuth = subscribeAuthState((user) => {
      if (!user) {
        clearAttachmentDownloadCache();
      }
      setCurrentUser(user);
      setIsAuthRestoring(false);
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  const handleLogOut = async () => {
    try {
      clearAttachmentDownloadCache();
      await logOut();
      setCurrentUser(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Restoring Auth State Screen
  if (isAuthRestoring) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-emerald-700 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-stone-600">
            جارٍ استعادة جلسة العمل الآمنة...
          </span>
        </div>
      </div>
    );
  }

  // Unauthenticated Screen
  if (!currentUser) {
    return (
      <div className="@container min-h-screen bg-stone-100 flex items-center justify-center p-0 sm:p-4">
        <div
          className={`w-full bg-white flex flex-col overflow-hidden transition-all duration-300 ${
            isMobileFrame
              ? 'sm:max-w-[430px] sm:h-[932px] sm:rounded-[48px] sm:shadow-2xl sm:border-[8px] sm:border-stone-800 relative'
              : 'max-w-md h-screen sm:h-auto sm:rounded-2xl shadow-xl'
          }`}
        >
          {isMobileFrame && (
            <div className="hidden sm:flex items-center justify-between px-7 pt-3 pb-1 text-stone-900 text-xs font-semibold select-none z-50">
              <span>9:41</span>
              <div className="w-24 h-4 bg-black rounded-full mx-auto" />
              <div className="flex items-center gap-1.5 text-stone-900">
                <Signal className="w-3.5 h-3.5" />
                <Wifi className="w-3.5 h-3.5" />
                <BatteryMedium className="w-4 h-4" />
              </div>
            </div>
          )}

          <div className="@container flex-1 overflow-y-auto">
            <AuthScreen language="ar" />
          </div>
        </div>
      </div>
    );
  }

  // Explicit UID-Keyed Authenticated User Session Boundary
  // When currentUser.uid changes (Account Switch User A -> User B),
  // React immediately unmounts User A's component tree, terminating subscriptions,
  // wiping all in-memory data, modals, and selections, and mounts a fresh User B session.
  return (
    <div className="@container min-h-screen bg-stone-100 flex items-center justify-center p-0 sm:p-4">
      <div
        className={`w-full bg-white flex flex-col overflow-hidden transition-all duration-300 ${
          isMobileFrame
            ? 'sm:max-w-[430px] sm:h-[932px] sm:rounded-[48px] sm:shadow-2xl sm:border-[8px] sm:border-stone-800 relative'
            : 'w-full max-w-6xl h-screen sm:h-[94vh] sm:rounded-2xl shadow-xl border border-stone-200/80'
        }`}
      >
        {isMobileFrame && (
          <div className="hidden sm:flex items-center justify-between px-7 pt-3 pb-1 text-stone-900 text-xs font-semibold select-none z-50">
            <span>9:41</span>
            <div className="w-24 h-4 bg-black rounded-full mx-auto" />
            <div className="flex items-center gap-1.5 text-stone-900">
              <Signal className="w-3.5 h-3.5" />
              <Wifi className="w-3.5 h-3.5" />
              <BatteryMedium className="w-4 h-4" />
            </div>
          </div>
        )}

        <div className="@container flex-1 overflow-hidden flex flex-col">
          <AuthenticatedSession
            key={currentUser.uid}
            user={currentUser}
            onSignOut={handleLogOut}
            isMobileFrame={isMobileFrame}
            onToggleMobileFrame={() => setIsMobileFrame(!isMobileFrame)}
          />
        </div>
      </div>
    </div>
  );
}
