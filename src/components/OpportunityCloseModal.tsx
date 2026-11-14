import React, { useEffect, useState } from 'react';
import { Opportunity, OpportunityStage } from '../types';
import {
  OPPORTUNITY_OPEN_STAGES,
  OPPORTUNITY_STAGE_CONFIG,
} from '../utils/opportunities';
import { CheckCircle2, XCircle, RotateCcw, X, ShieldCheck } from 'lucide-react';

interface OpportunityCloseModalProps {
  isOpen: boolean;
  mode: 'close' | 'reopen';
  opportunity: Opportunity | null;
  targetStage: OpportunityStage;
  onCancel: () => void;
  onConfirm: (params: {
    targetStage: OpportunityStage;
    lostReason?: string;
    note?: string;
  }) => Promise<void> | void;
  language: 'ar' | 'en';
}

export const OpportunityCloseModal: React.FC<OpportunityCloseModalProps> = ({
  isOpen,
  mode,
  opportunity,
  targetStage,
  onCancel,
  onConfirm,
  language,
}) => {
  const [selectedOpenStage, setSelectedOpenStage] = useState<OpportunityStage>('negotiation');
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedOpenStage(
      OPPORTUNITY_OPEN_STAGES.includes(targetStage) ? targetStage : 'negotiation'
    );
    setLostReason(opportunity?.lostReason || '');
    setNote('');
    setIsSubmitting(false);
  }, [isOpen, targetStage, opportunity]);

  if (!isOpen || !opportunity) return null;

  const effectiveTargetStage = mode === 'reopen' ? selectedOpenStage : targetStage;
  const isWon = effectiveTargetStage === 'won';
  const isLost = effectiveTargetStage === 'lost';

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm({
        targetStage: effectiveTargetStage,
        lostReason: isLost && lostReason.trim() ? lostReason.trim() : undefined,
        note: note.trim() || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-stone-900/60 backdrop-blur-xs"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="opportunity-close-modal"
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-stone-200"
      >
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            mode === 'reopen'
              ? 'bg-sky-50 border-sky-200'
              : isWon
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {mode === 'reopen' ? (
              <RotateCcw className="w-5 h-5 text-sky-700" />
            ) : isWon ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-700" />
            )}
            <h3 className="text-sm font-bold text-stone-900">
              {mode === 'reopen'
                ? language === 'ar'
                  ? 'تأكيد إعادة فتح الفرصة'
                  : 'Confirm Reopen Opportunity'
                : isWon
                ? language === 'ar'
                  ? 'تأكيد إغلاق الفرصة كفرصة ناجحة'
                  : 'Confirm Close as Won'
                : language === 'ar'
                ? 'تأكيد إغلاق الفرصة كغير ناجحة'
                : 'Confirm Close as Lost'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg text-stone-500 hover:bg-white/70"
            aria-label={language === 'ar' ? 'إلغاء' : 'Cancel'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
            <span className="text-[11px] text-stone-500 block">
              {language === 'ar' ? 'الفرصة:' : 'Opportunity:'}
            </span>
            <span className="font-bold text-stone-900 text-sm">{opportunity.title}</span>
          </div>

          {mode === 'reopen' && (
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar'
                  ? 'اختر المرحلة النشطة بعد إعادة الفتح:'
                  : 'Target Active Stage:'}
              </label>
              <select
                data-testid="opp-reopen-stage-select"
                value={selectedOpenStage}
                onChange={(e) => setSelectedOpenStage(e.target.value as OpportunityStage)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600"
              >
                {OPPORTUNITY_OPEN_STAGES.map((stKey) => (
                  <option key={stKey} value={stKey}>
                    {language === 'ar'
                      ? OPPORTUNITY_STAGE_CONFIG[stKey].labelAr
                      : OPPORTUNITY_STAGE_CONFIG[stKey].labelEn}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'close' && isLost && (
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar'
                  ? 'سبب عدم النجاح (اختياري)'
                  : 'Reason Lost (Optional)'}
              </label>
              <textarea
                rows={2}
                data-testid="opp-lost-reason-input"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                maxLength={500}
                placeholder={
                  language === 'ar'
                    ? 'مثال: تأجيل المشروع من طرف العميل أو فرق في الميزانية'
                    : 'e.g. Budget mismatch or postponed'
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
          )}

          <div>
            <label className="block font-bold text-stone-700 mb-1">
              {language === 'ar'
                ? 'ملاحظة لسجل تطور المرحلة (اختياري)'
                : 'Stage History Note (Optional)'}
            </label>
            <input
              type="text"
              data-testid="opp-transition-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={
                language === 'ar'
                  ? 'وثّق سياق القرار لمرجعك المستقبلي...'
                  : 'Document transition context...'
              }
              className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-[11px] text-stone-600">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>
              {language === 'ar'
                ? 'سيتم الاحتفاظ بكافة الاجتماعات والمهام والقرارات المرتبطة بهذه الفرصة دون أي حذف، مع تسجيل الانتقال في سجل المراحل.'
                : 'All linked meetings, tasks, and decisions will be preserved.'}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
            >
              {language === 'ar' ? 'تراجع' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="opp-close-confirm-btn"
              className={`px-4 py-2 rounded-xl font-bold text-white transition-colors disabled:opacity-60 ${
                mode === 'reopen'
                  ? 'bg-sky-700 hover:bg-sky-800'
                  : isWon
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-rose-700 hover:bg-rose-800'
              }`}
            >
              {isSubmitting
                ? language === 'ar'
                  ? 'جاري التأكيد...'
                  : 'Confirming...'
                : mode === 'reopen'
                ? language === 'ar'
                  ? 'تأكيد إعادة الفتح'
                  : 'Confirm Reopen'
                : isWon
                ? language === 'ar'
                  ? 'تأكيد الإغلاق كناجحة'
                  : 'Confirm Won'
                : language === 'ar'
                ? 'تأكيد الإغلاق كغير ناجحة'
                : 'Confirm Lost'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
