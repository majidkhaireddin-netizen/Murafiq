import React, { useEffect, useState } from 'react';
import {
  Client,
  Opportunity,
  OpportunityCurrency,
  OpportunityStage,
  OpportunityType,
  TaskPriority,
} from '../types';
import {
  OPPORTUNITY_CURRENCY_CONFIG,
  OPPORTUNITY_STAGE_CONFIG,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_VALID_CURRENCIES,
  OPPORTUNITY_VALID_TYPES,
  OPPORTUNITY_OPEN_STAGES,
  OPPORTUNITY_ALL_STAGES,
  validateOpportunityInput,
} from '../utils/opportunities';
import { Briefcase, X, AlertCircle, Calendar, DollarSign } from 'lucide-react';

interface OpportunityFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  initialOpportunity?: Opportunity | null;
  defaultClientId?: string;
  onSubmit: (
    data: Partial<Opportunity> & { clientId: string; title: string },
    initialNote?: string
  ) => Promise<void> | void;
  language: 'ar' | 'en';
}

export const OpportunityFormModal: React.FC<OpportunityFormModalProps> = ({
  isOpen,
  onClose,
  clients,
  initialOpportunity,
  defaultClientId,
  onSubmit,
  language,
}) => {
  const isEditing = Boolean(initialOpportunity);

  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<OpportunityType>('service');
  const [stage, setStage] = useState<OpportunityStage>('new');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [estimatedValueStr, setEstimatedValueStr] = useState('');
  const [currency, setCurrency] = useState<OpportunityCurrency>('JOD');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [initialNote, setInitialNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialOpportunity) {
      setClientId(initialOpportunity.clientId);
      setTitle(initialOpportunity.title);
      setType(initialOpportunity.type);
      setStage(initialOpportunity.stage);
      setPriority(initialOpportunity.priority);
      setEstimatedValueStr(
        typeof initialOpportunity.estimatedValue === 'number'
          ? String(initialOpportunity.estimatedValue)
          : ''
      );
      setCurrency(initialOpportunity.currency || 'JOD');
      setExpectedCloseDate(initialOpportunity.expectedCloseDate || '');
      setNextAction(initialOpportunity.nextAction || '');
      setNextActionDate(initialOpportunity.nextActionDate || '');
      setSource(initialOpportunity.source || '');
      setDescription(initialOpportunity.description || '');
      setInitialNote('');
    } else {
      setClientId(defaultClientId || clients[0]?.id || '');
      setTitle('');
      setType('service');
      setStage('new');
      setPriority('medium');
      setEstimatedValueStr('');
      setCurrency('JOD');
      setExpectedCloseDate('');
      setNextAction('');
      setNextActionDate('');
      setSource('');
      setDescription('');
      setInitialNote('');
    }
    setErrors([]);
    setIsSubmitting(false);
  }, [isOpen, initialOpportunity, defaultClientId, clients]);

  if (!isOpen) return null;

  const clientExistsInList = clients.some((c) => c.id === clientId);
  const decimalsStep = OPPORTUNITY_CURRENCY_CONFIG[currency]?.decimals === 3 ? '0.001' : '0.01';

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedVal = estimatedValueStr.trim();
    let parsedValue: number | undefined = undefined;
    if (trimmedVal !== '') {
      const n = Number(trimmedVal);
      if (!Number.isFinite(n)) {
        setErrors([
          language === 'ar'
            ? 'القيمة التقديرية المدخلة غير صالحة.'
            : 'Invalid estimated value.',
        ]);
        return;
      }
      parsedValue = n;
    }

    const payload: Partial<Opportunity> & { clientId: string; title: string } = {
      ...(initialOpportunity || {}),
      clientId,
      title: title.trim(),
      type,
      stage: initialOpportunity ? initialOpportunity.stage : stage,
      priority,
      estimatedValue: parsedValue,
      currency: parsedValue !== undefined ? currency : undefined,
      expectedCloseDate: expectedCloseDate.trim() || undefined,
      nextAction: nextAction.trim() || undefined,
      nextActionDate: nextActionDate.trim() || undefined,
      source: source.trim() || undefined,
      description: description.trim() || undefined,
    };

    const validation = validateOpportunityInput(payload);
    if (!validation.valid) {
      setErrors(validation.errorsArabic);
      return;
    }

    setErrors([]);
    setIsSubmitting(true);
    try {
      await onSubmit(payload, !isEditing && initialNote.trim() ? initialNote.trim() : undefined);
      onClose();
    } catch (err: any) {
      setErrors([err?.message || 'تعذر حفظ الفرصة حالياً.']);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="opportunity-form-modal"
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-stone-200 flex flex-col max-h-[92vh]"
      >
        <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {isEditing
                  ? language === 'ar'
                    ? 'تعديل بيانات فرصة العمل'
                    : 'Edit Business Opportunity'
                  : language === 'ar'
                  ? 'إنشاء فرصة عمل جديدة'
                  : 'New Business Opportunity'}
              </h2>
              <p className="text-[11px] text-stone-500">
                {language === 'ar'
                  ? 'اربط الفرصة بالعميل وحدد الخطوة التالية والمرحلة'
                  : 'Link opportunity to a client and define stage and next action'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition-colors"
            aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {errors.length > 0 && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{language === 'ar' ? 'يرجى مراجعة الحقول التالية:' : 'Please check inputs:'}</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Client */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'العميل المرتبط *' : 'Client *'}
              </label>
              <select
                data-testid="opp-form-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                required
              >
                <option value="">
                  {language === 'ar' ? '-- اختر العميل --' : '-- Select Client --'}
                </option>
                {!clientExistsInList && clientId && (
                  <option value={clientId}>
                    {language === 'ar' ? 'عميل محذوف أو غير متوفر' : 'Deleted or unavailable client'}
                  </option>
                )}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'عنوان الفرصة *' : 'Opportunity Title *'}
              </label>
              <input
                type="text"
                data-testid="opp-form-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={
                  language === 'ar'
                    ? 'مثال: عقد استشارات مالية سنوي أو تطوير نظام المبيعات'
                    : 'e.g. Annual Advisory Retainer'
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                required
              />
            </div>

            {/* Type */}
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'نوع الفرصة' : 'Opportunity Type'}
              </label>
              <select
                data-testid="opp-form-type"
                value={type}
                onChange={(e) => setType(e.target.value as OpportunityType)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              >
                {OPPORTUNITY_VALID_TYPES.map((tKey) => (
                  <option key={tKey} value={tKey}>
                    {language === 'ar'
                      ? OPPORTUNITY_TYPE_LABELS[tKey].ar
                      : OPPORTUNITY_TYPE_LABELS[tKey].en}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'الأولوية' : 'Priority'}
              </label>
              <select
                data-testid="opp-form-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              >
                <option value="urgent">{language === 'ar' ? 'عاجلة' : 'Urgent'}</option>
                <option value="high">{language === 'ar' ? 'مرتفعة' : 'High'}</option>
                <option value="medium">{language === 'ar' ? 'متوسطة' : 'Medium'}</option>
                <option value="low">{language === 'ar' ? 'منخفضة' : 'Low'}</option>
              </select>
            </div>

            {/* Stage (only selectable on create; stage transitions on existing opps use transition controls) */}
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'المرحلة الحالية' : 'Stage'}
              </label>
              {isEditing ? (
                <div className="px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 text-stone-700 font-semibold">
                  {language === 'ar'
                    ? OPPORTUNITY_STAGE_CONFIG[stage].labelAr
                    : OPPORTUNITY_STAGE_CONFIG[stage].labelEn}
                  <span className="block text-[10px] font-normal text-stone-500 mt-0.5">
                    {language === 'ar'
                      ? 'لتغيير المرحلة أو إغلاق الفرصة استخدم شريط المراحل في بطاقة الفرصة.'
                      : 'Use stage controls to move, close, or reopen.'}
                  </span>
                </div>
              ) : (
                <select
                  data-testid="opp-form-stage"
                  value={stage}
                  onChange={(e) => setStage(e.target.value as OpportunityStage)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                >
                  {OPPORTUNITY_OPEN_STAGES.map((stKey) => (
                    <option key={stKey} value={stKey}>
                      {language === 'ar'
                        ? OPPORTUNITY_STAGE_CONFIG[stKey].labelAr
                        : OPPORTUNITY_STAGE_CONFIG[stKey].labelEn}
                    </option>
                  ))}
                  {OPPORTUNITY_ALL_STAGES.filter((s) => !OPPORTUNITY_OPEN_STAGES.includes(s)).map(
                    (stKey) => (
                      <option key={stKey} value={stKey}>
                        {language === 'ar'
                          ? OPPORTUNITY_STAGE_CONFIG[stKey].labelAr
                          : OPPORTUNITY_STAGE_CONFIG[stKey].labelEn}
                      </option>
                    )
                  )}
                </select>
              )}
            </div>

            {/* Expected Close Date */}
            <div>
              <label className="block font-bold text-stone-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-stone-400" />
                <span>
                  {language === 'ar'
                    ? 'تاريخ الإغلاق المتوقع (تقديري)'
                    : 'Expected Close Date (Estimate)'}
                </span>
              </label>
              <input
                type="date"
                data-testid="opp-form-expected-close"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 tabular-nums focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            {/* Estimated Value & Currency */}
            <div>
              <label className="block font-bold text-stone-700 mb-1 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-stone-400" />
                <span>{language === 'ar' ? 'القيمة التقديرية (اختياري)' : 'Estimated Value'}</span>
              </label>
              <input
                type="number"
                step={decimalsStep}
                min="0"
                data-testid="opp-form-value"
                value={estimatedValueStr}
                onChange={(e) => setEstimatedValueStr(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 tabular-nums focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'العملة' : 'Currency'}
              </label>
              <select
                data-testid="opp-form-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as OpportunityCurrency)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              >
                {OPPORTUNITY_VALID_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {language === 'ar'
                      ? OPPORTUNITY_CURRENCY_CONFIG[code].labelAr
                      : OPPORTUNITY_CURRENCY_CONFIG[code].labelEn}
                  </option>
                ))}
              </select>
            </div>

            {/* Next Action */}
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'الخطوة التالية' : 'Next Action'}
              </label>
              <input
                type="text"
                data-testid="opp-form-next-action"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                maxLength={300}
                placeholder={
                  language === 'ar'
                    ? 'مثال: إرسال العرض المالي ومراجعته مع المدير'
                    : 'e.g. Send financial proposal'
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            {/* Next Action Date */}
            <div>
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'تاريخ الخطوة التالية' : 'Next Action Date'}
              </label>
              <input
                type="date"
                data-testid="opp-form-next-action-date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 tabular-nums focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            {/* Source */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'مصدر الفرصة (اختياري)' : 'Source (Optional)'}
              </label>
              <input
                type="text"
                data-testid="opp-form-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                maxLength={150}
                placeholder={
                  language === 'ar'
                    ? 'مثال: توصية من عميل حالي، اجتماع تعارف، طلب عرض مباشر'
                    : 'e.g. Referral, Existing Client'
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-stone-700 mb-1">
                {language === 'ar' ? 'وصف ونطاق الفرصة' : 'Description / Scope'}
              </label>
              <textarea
                rows={3}
                data-testid="opp-form-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={3000}
                placeholder={
                  language === 'ar'
                    ? 'ملخص احتياج العميل أو نطاق التعاون المطلوب...'
                    : 'Brief scope and client requirements...'
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            {!isEditing && (
              <div className="sm:col-span-2">
                <label className="block font-bold text-stone-700 mb-1">
                  {language === 'ar'
                    ? 'ملاحظة مبدئية لسجل المراحل (اختياري)'
                    : 'Initial Stage Log Note (Optional)'}
                </label>
                <input
                  type="text"
                  value={initialNote}
                  onChange={(e) => setInitialNote(e.target.value)}
                  maxLength={500}
                  placeholder={
                    language === 'ar'
                      ? 'مثال: تم افتتاح الفرصة بعد مكالمة التمهيد الأولى'
                      : 'Optional note recorded in initial stage event'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="opp-form-submit"
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 transition-colors shadow-xs"
            >
              {isSubmitting
                ? language === 'ar'
                  ? 'جاري الحفظ...'
                  : 'Saving...'
                : isEditing
                ? language === 'ar'
                  ? 'حفظ التعديلات'
                  : 'Save Changes'
                : language === 'ar'
                ? 'حفظ الفرصة'
                : 'Create Opportunity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
