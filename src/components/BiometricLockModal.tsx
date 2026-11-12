import React, { useState } from 'react';
import { Fingerprint, Lock, ShieldCheck, KeyRound, AlertCircle } from 'lucide-react';

interface BiometricLockModalProps {
  isOpen: boolean;
  onUnlock: () => void;
  expectedPin: string;
  language: 'ar' | 'en';
}

export const BiometricLockModal: React.FC<BiometricLockModalProps> = ({
  isOpen,
  onUnlock,
  expectedPin,
  language,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSimulatingBio, setIsSimulatingBio] = useState(false);

  if (!isOpen) return null;

  const handleKeyClick = (num: string) => {
    if (pinInput.length < 4) {
      const nextPin = pinInput + num;
      setPinInput(nextPin);
      setErrorMsg('');

      if (nextPin.length === 4) {
        if (nextPin === expectedPin) {
          onUnlock();
          setPinInput('');
        } else {
          setErrorMsg('رمز PIN غير صحيح (الرمز الافتراضي: 1234)');
          setTimeout(() => setPinInput(''), 600);
        }
      }
    }
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  const handleBiometricScan = () => {
    setIsSimulatingBio(true);
    setTimeout(() => {
      setIsSimulatingBio(false);
      onUnlock();
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-stone-950/90 backdrop-blur-md">
      <div className="bg-stone-900 border border-stone-800 text-white rounded-3xl p-6 sm:p-8 max-w-xs w-full shadow-2xl text-center space-y-6">
        {/* Lock Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center shadow-lg">
          <Lock className="w-8 h-8 text-white" />
        </div>

        <div>
          <h3 className="font-heading font-extrabold text-lg text-white">
            {language === 'ar' ? 'مُرافق محمي بالأمان الحيوي' : 'Murafiq Security Lock'}
          </h3>
          <p className="text-xs text-stone-400 mt-1">
            {language === 'ar'
              ? 'المس مستشعر البصمة أو أدخل رمز PIN'
              : 'Touch fingerprint or enter PIN'}
          </p>
        </div>

        {/* PIN Indicators */}
        <div className="flex items-center justify-center gap-3">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full transition-all ${
                pinInput.length > idx
                  ? 'bg-emerald-400 scale-110 shadow-sm shadow-emerald-500/50'
                  : 'bg-stone-800 border border-stone-700'
              }`}
            />
          ))}
        </div>

        {errorMsg && (
          <p className="text-[11px] text-rose-400 font-medium animate-shake">
            {errorMsg}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2.5 max-w-[220px] mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => handleKeyClick(digit)}
              className="w-14 h-14 rounded-2xl bg-stone-800/80 hover:bg-stone-700 text-stone-100 font-bold text-lg flex items-center justify-center transition-colors active:scale-95"
            >
              {digit}
            </button>
          ))}
          <button
            onClick={handleBiometricScan}
            className="w-14 h-14 rounded-2xl bg-emerald-950/80 hover:bg-emerald-900 text-emerald-400 flex items-center justify-center transition-colors"
            title="بصمة الإصبع"
          >
            <Fingerprint className={`w-6 h-6 ${isSimulatingBio ? 'animate-pulse text-emerald-300' : ''}`} />
          </button>
          <button
            onClick={() => handleKeyClick('0')}
            className="w-14 h-14 rounded-2xl bg-stone-800/80 hover:bg-stone-700 text-stone-100 font-bold text-lg flex items-center justify-center transition-colors active:scale-95"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="w-14 h-14 rounded-2xl bg-stone-800/80 hover:bg-stone-700 text-stone-400 text-xs flex items-center justify-center transition-colors font-medium active:scale-95"
          >
            مسح
          </button>
        </div>

        {/* Default PIN Hint */}
        <div className="pt-2 border-t border-stone-800/60 text-[11px] text-stone-500">
          <span>الرمز التجريبي الافتراضي: </span>
          <span className="font-mono text-emerald-400 font-bold">1234</span>
        </div>
      </div>
    </div>
  );
};
