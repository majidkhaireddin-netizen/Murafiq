import React, { useEffect, useState } from 'react';
import type {
  CommunicationChannel,
  PlaybookCategory,
  PlaybookDuePolicyType,
  PlaybookStepType,
  PlaybookTemplate,
  PlaybookTemplateStep,
  TaskPriority,
} from '../types';
import {
  MAX_PLAYBOOK_OFFSET_DAYS,
  MAX_PLAYBOOK_STEPS,
  PLAYBOOK_CATEGORY_META,
  PLAYBOOK_STEP_TYPE_META,
  createCustomPlaybookTemplate,
  generateStablePlaybookId,
  reorderPlaybookTemplateSteps,
  updateCustomPlaybookTemplate,
} from '../utils/playbookEngine';
import { COMMUNICATION_CHANNEL_META } from '../utils/communications';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  ListChecks,
  Save,
} from 'lucide-react';

interface PlaybookTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTemplate?: PlaybookTemplate | null;
  currentUserId: string;
  language: 'ar' | 'en';
  onSaveTemplate: (template: PlaybookTemplate) => void;
}

const DEFAULT_NEW_STEP = (order: number): PlaybookTemplateStep => ({
  id: generateStablePlaybookId(`step${order}`),
  title: '',
  stepType: 'task',
  order,
  duePolicy: {
    type: order === 1 ? 'from_start' : 'after_previous_completion',
    offsetDays: order === 1 ? 0 : 2,
  },
  priority: 'medium',
});

const CHANNEL_OPTIONS: CommunicationChannel[] = [
  'phone_call',
  'whatsapp',
  'email',
  'in_person_visit',
  'video_call',
  'sms',
  'other',
];

export const PlaybookTemplateEditorModal: React.FC<PlaybookTemplateEditorModalProps> = ({
  isOpen,
  onClose,
  initialTemplate,
  currentUserId,
  language,
  onSaveTemplate,
}) => {
  const isEditing = Boolean(initialTemplate && !initialTemplate.isSystemTemplate);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PlaybookCategory>('custom');
  const [steps, setSteps] = useState<PlaybookTemplateStep[]>([DEFAULT_NEW_STEP(1)]);
  const [errorAr, setErrorAr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorAr(null);
    if (initialTemplate && !initialTemplate.isSystemTemplate) {
      setName(initialTemplate.name);
      setDescription(initialTemplate.description || '');
      setCategory(initialTemplate.category);
      setSteps(
        initialTemplate.steps.map((s, idx) => ({
          ...s,
          order: idx + 1,
          duePolicy: { ...s.duePolicy },
        }))
      );
    } else {
      setName('');
      setDescription('');
      setCategory('custom');
      setSteps([DEFAULT_NEW_STEP(1)]);
    }
  }, [isOpen, initialTemplate]);

  if (!isOpen) return null;

  const handleAddStep = () => {
    if (steps.length >= MAX_PLAYBOOK_STEPS) {
      setErrorAr(`الحد الأقصى لعدد الخطوات هو ${MAX_PLAYBOOK_STEPS} خطوة.`);
      return;
    }
    setErrorAr(null);
    setSteps((prev) => [...prev, DEFAULT_NEW_STEP(prev.length + 1)]);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) {
      setErrorAr('يجب أن يحتوي القالب على خطوة واحدة على الأقل.');
      return;
    }
    setErrorAr(null);
    setSteps((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((s, idx) => ({ ...s, order: idx + 1 }))
    );
  };

  const handleMoveStep = (fromIndex: number, toIndex: number) => {
    setErrorAr(null);
    setSteps((prev) => reorderPlaybookTemplateSteps(prev, fromIndex, toIndex));
  };

  const updateStep = (index: number, patch: Partial<PlaybookTemplateStep>) => {
    setSteps((prev) =>
      prev.map((step, idx) => (idx === index ? { ...step, ...patch } : step))
    );
  };

  const updateStepDuePolicy = (
    index: number,
    patch: { type?: PlaybookDuePolicyType; offsetDays?: number }
  ) => {
    setSteps((prev) =>
      prev.map((step, idx) =>
        idx === index
          ? {
              ...step,
              duePolicy: {
                type: patch.type ?? step.duePolicy.type,
                offsetDays:
                  patch.offsetDays !== undefined
                    ? patch.offsetDays
                    : step.duePolicy.offsetDays,
              },
            }
          : step
      )
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorAr(null);

    if (isEditing && initialTemplate) {
      const res = updateCustomPlaybookTemplate({
        existingTemplate: initialTemplate,
        name,
        description,
        category,
        steps,
        currentUserId,
      });
      if (!res.ok || !res.template) {
        setErrorAr(res.errorAr || 'تعذر حفظ القالب. تحقق من الحقول.');
        return;
      }
      onSaveTemplate(res.template);
      onClose();
      return;
    }

    const res = createCustomPlaybookTemplate({
      userId: currentUserId,
      name,
      description,
      category,
      steps,
    });
    if (!res.ok || !res.template) {
      setErrorAr(res.errorAr || 'تعذر إنشاء القالب. تحقق من الحقول.');
      return;
    }
    onSaveTemplate(res.template);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      data-testid="playbook-template-editor-modal"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-3xl w-full my-auto flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-900 text-white flex items-center justify-center">
              <ListChecks className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-base text-stone-900">
                {isEditing
                  ? language === 'ar'
                    ? 'تعديل قالب خطة المتابعة'
                    : 'Edit Playbook Template'
                  : language === 'ar'
                  ? 'إنشاء قالب خطة متابعة مخصص'
                  : 'Create Custom Playbook Template'}
              </h2>
              <p className="text-[11px] text-stone-500">
                {language === 'ar'
                  ? 'عرّف الخطوات المتسلسلة والمواعيد النسبية لتكرار استخدامها مع العملاء والفرص.'
                  : 'Define sequential steps and relative timing rules for client follow-up.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-xs">
          {errorAr && (
            <div
              data-testid="playbook-template-editor-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-medium">{errorAr}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="block font-bold text-stone-800">
                عنوان القالب <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                data-testid="playbook-template-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
                placeholder="مثال: متابعة عرض الباقة السنوية"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-stone-800">التصنيف</label>
              <select
                data-testid="playbook-template-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as PlaybookCategory)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              >
                {(Object.keys(PLAYBOOK_CATEGORY_META) as PlaybookCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {PLAYBOOK_CATEGORY_META[cat].labelAr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block font-bold text-stone-800">وصف القالب والهدف (اختياري)</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="متى يُنصح باستخدام هذا القالب وما النتيجة المرجوة منه؟"
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
            />
          </div>

          {/* Steps Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-bold text-sm text-stone-900">
                  خطوات الخطة ({steps.length} / {MAX_PLAYBOOK_STEPS})
                </h3>
                <p className="text-[11px] text-stone-500">
                  التعديلات على القالب لا تؤثر بأثر رجعي على الخطط المنطلقة مسبقًا.
                </p>
              </div>
              <button
                type="button"
                data-testid="add-playbook-template-step-btn"
                onClick={handleAddStep}
                disabled={steps.length >= MAX_PLAYBOOK_STEPS}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة خطوة</span>
              </button>
            </div>

            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  data-testid={`template-step-row-${idx}`}
                  className="p-3.5 rounded-2xl border border-stone-200 bg-stone-50/70 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-900 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-stone-800">
                        الخطوة {idx + 1}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, idx - 1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 disabled:opacity-40"
                        title="تحريك للأعلى"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, idx + 1)}
                        disabled={idx === steps.length - 1}
                        className="p-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 disabled:opacity-40"
                        title="تحريك للأسفل"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid={`remove-template-step-btn-${idx}`}
                        onClick={() => handleRemoveStep(idx)}
                        disabled={steps.length <= 1}
                        className="p-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                        title="حذف الخطوة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-6 space-y-1">
                      <label className="block text-[11px] font-semibold text-stone-700">
                        عنوان الخطوة <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        data-testid={`template-step-title-input-${idx}`}
                        value={step.title}
                        onChange={(e) => updateStep(idx, { title: e.target.value })}
                        maxLength={200}
                        placeholder="مثال: اتصال متابعة للتأكد من استلام العرض"
                        className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                      <label className="block text-[11px] font-semibold text-stone-700">
                        نوع الخطوة
                      </label>
                      <select
                        value={step.stepType}
                        onChange={(e) => {
                          const nextType = e.target.value as PlaybookStepType;
                          updateStep(idx, {
                            stepType: nextType,
                            suggestedChannel:
                              nextType === 'communication'
                                ? step.suggestedChannel || 'phone_call'
                                : undefined,
                          });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                      >
                        {(Object.keys(PLAYBOOK_STEP_TYPE_META) as PlaybookStepType[]).map(
                          (st) => (
                            <option key={st} value={st}>
                              {PLAYBOOK_STEP_TYPE_META[st].labelAr}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                      <label className="block text-[11px] font-semibold text-stone-700">
                        الأولوية المقترحة
                      </label>
                      <select
                        value={step.priority || 'medium'}
                        onChange={(e) =>
                          updateStep(idx, { priority: e.target.value as TaskPriority })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="urgent">عاجلة</option>
                        <option value="high">مرتفعة</option>
                        <option value="medium">متوسطة</option>
                        <option value="low">منخفضة</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-5 space-y-1">
                      <label className="block text-[11px] font-semibold text-stone-700">
                        سياسة التوقيت النسبي
                      </label>
                      <select
                        value={step.duePolicy.type}
                        onChange={(e) =>
                          updateStepDuePolicy(idx, {
                            type: e.target.value as PlaybookDuePolicyType,
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="from_start">من تاريخ بدء الخطة</option>
                        <option value="after_previous_completion">
                          بعد إكمال الخطوة السابقة
                        </option>
                      </select>
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                      <label className="block text-[11px] font-semibold text-stone-700">
                        عدد الأيام (Offset)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={MAX_PLAYBOOK_OFFSET_DAYS}
                        step={1}
                        value={step.duePolicy.offsetDays}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value || '0', 10);
                          updateStepDuePolicy(idx, {
                            offsetDays: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                          });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    {step.stepType === 'communication' && (
                      <div className="sm:col-span-4 space-y-1">
                        <label className="block text-[11px] font-semibold text-stone-700">
                          الوسيلة المقترحة
                        </label>
                        <select
                          value={step.suggestedChannel || 'phone_call'}
                          onChange={(e) =>
                            updateStep(idx, {
                              suggestedChannel: e.target.value as CommunicationChannel,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                        >
                          {CHANNEL_OPTIONS.map((ch) => (
                            <option key={ch} value={ch}>
                              {COMMUNICATION_CHANNEL_META[ch].labelAr}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-stone-700">
                      إرشادات الخطوة (اختياري)
                    </label>
                    <input
                      type="text"
                      value={step.description || ''}
                      onChange={(e) => updateStep(idx, { description: e.target.value })}
                      maxLength={1500}
                      placeholder="وصف مختصر يوضح الهدف من الخطوة"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions inside form */}
          <div className="pt-3 border-t border-stone-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              data-testid="save-playbook-template-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold shadow-xs transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{isEditing ? 'حفظ تعديلات القالب' : 'حفظ القالب المخصص'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
