import React, { useState } from 'react';
import { signInWithGoogle } from '../services/firebase';
import { Shield, Sparkles, CheckCircle2, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
  language: 'ar' | 'en';
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess, language }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await signInWithGoogle();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMessage(err?.message || 'حدث خطأ أثناء تسجيل الدخول. يُرجى المحاولة مرة أخرى.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen w-full bg-stone-100 flex items-center justify-center p-4 sm:p-6"
    >
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-stone-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Top Visual Banner */}
        <div className="bg-gradient-to-b from-stone-900 to-stone-800 text-white p-7 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-600/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-teal-600/10 rounded-full blur-2xl pointer-events-none" />

          {/* Emblem */}
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center font-bold text-2xl shadow-lg border border-emerald-400/30 mb-3">
            م
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 text-[11px] font-semibold mb-2">
            <Shield className="w-3 h-3 text-emerald-400" />
            <span>{language === 'ar' ? 'بيئة سحابية معزولة لكل مستخدم' : 'Isolated Per-User Cloud'}</span>
          </div>

          <h2 className="font-heading font-extrabold text-xl sm:text-2xl tracking-tight text-white">
            {language === 'ar' ? 'مُرافق — Murafiq' : 'Murafiq CRM'}
          </h2>
          <p className="text-xs text-stone-300 max-w-xs mx-auto mt-1 leading-relaxed">
            {language === 'ar'
              ? 'المساعد اليومي الخفيف لإدارة اللقاءات والمهام للمستقلين وأصحاب المكاتب'
              : 'The lightweight companion for meetings and tasks for freelancers and small offices'}
          </p>
        </div>

        {/* Form & Actions Body */}
        <div className="p-6 sm:p-7 space-y-5">
          {/* Feature Highlights */}
          <div className="space-y-2.5 text-xs text-stone-600 bg-stone-50 p-4 rounded-2xl border border-stone-200/80">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{language === 'ar' ? 'عزل كامل لبياناتك واجتماعاتك ومحاضرك في مسارك الخاص' : 'Complete isolation of your data in your own private cloud store'}</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{language === 'ar' ? 'مزامنة فورية وتصدير محاضر رسمية موثقة بصيغة PDF' : 'Real-time synchronization and official formal PDF minutes export'}</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{language === 'ar' ? 'واجهة تفاعلية خفيفة مع مزامنة سحابية مؤمنة لقواعد البيانات' : 'Lightweight interactive interface with secure cloud database synchronization'}</span>
            </div>
          </div>

          {/* Error Message Alert */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">
                  {language === 'ar' ? 'تعذر إتمام تسجيل الدخول' : 'Sign-in Error'}
                </span>
                <p className="text-[11px] leading-relaxed text-rose-700">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Google Sign-In Button */}
          <div className="space-y-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm text-stone-800 bg-white hover:bg-stone-50 active:bg-stone-100 border border-stone-300 shadow-sm transition-all hover:shadow cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed group"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                  <span>{language === 'ar' ? 'جاري التحقق من جلسة Google...' : 'Connecting to Google...'}</span>
                </>
              ) : (
                <>
                  {/* Official Google G Logo */}
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{language === 'ar' ? 'المتابعة باستخدام حساب Google' : 'Continue with Google'}</span>
                </>
              )}
            </button>

            <p className="text-[11px] text-center text-stone-500 leading-relaxed px-2">
              {language === 'ar'
                ? 'تسجيل الدخول الإلزامي بحساب Google يضمن عزل بيانات عملائك واجتماعاتك في مسارك الخاص ومنع وصول أي أطراف أخرى إليها.'
                : 'Mandatory Google authentication guarantees isolated per-user Firestore storage and access control.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-stone-50 px-6 py-3 border-t border-stone-200 text-center text-[10px] text-stone-500">
          <span>مُرافق — Murafiq • الإصدار الأول 1.0</span>
        </div>
      </div>
    </div>
  );
};
