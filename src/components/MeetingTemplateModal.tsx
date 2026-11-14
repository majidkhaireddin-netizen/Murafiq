import React, { useState } from 'react';
import { MeetingTemplate, MeetingTemplateAgendaSeed } from '../data/meetingTemplates';
import {
  AlertTriangle,
  Award,
  Check,
  CheckSquare,
  Compass,
  Edit3,
  FileCheck,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';

export interface CustomTemplateOverride {
  title: string;
  duration: number;
  agendaItems: MeetingTemplateAgendaSeed[];
  discussionStarter: string;
}

interface MeetingTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: MeetingTemplate[];
  customOverrides: Record<string, CustomTemplateOverride>;
  onSaveTemplateOverride: (templateId: string, override: CustomTemplateOverride) => void;
  onResetTemplateOverride: (templateId: string) => void;
  onApplyTemplate: (template: MeetingTemplate, override?: CustomTemplateOverride) => void;
  language: 'ar' | 'en';
}

function getTemplateIcon(iconName: string) {
  switch (iconName) {
    case 'Compass':
      return Compass;
    case 'Layers':
      return Layers;
    case 'Award':
      return Award;
    case 'FileCheck':
      return FileCheck;
    case 'AlertTriangle':
      return AlertTriangle;
    case 'CheckSquare':
    default:
      return CheckSquare;
  }
}

export const MeetingTemplateModal: React.FC<MeetingTemplateModalProps> = ({
  isOpen,
  onClose,
  templates,
  customOverrides,
  onSaveTemplateOverride,
  onResetTemplateOverride,
  onApplyTemplate,
  language,
}) => {
  const isArabic = language === 'ar';
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id || '');
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);

  const activeTemplate = templates.find((t) => t.id === selectedId) || templates[0];
  const activeOverride = activeTemplate ? customOverrides[activeTemplate.id] : undefined;

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDuration, setDraftDuration] = useState<number>(45);
  const [draftAgenda, setDraftAgenda] = useState<MeetingTemplateAgendaSeed[]>([]);
  const [draftDiscussion, setDraftDiscussion] = useState('');

  if (!isOpen || !activeTemplate) return null;

  const effective: CustomTemplateOverride = activeOverride || {
    title: activeTemplate.title,
    duration: activeTemplate.defaultDuration,
    agendaItems: activeTemplate.defaultAgendaItems.map((i) => ({ ...i })),
    discussionStarter: activeTemplate.defaultDiscussionStarter,
  };

  const startEditing = () => {
    setDraftTitle(effective.title);
    setDraftDuration(effective.duration);
    setDraftAgenda(effective.agendaItems.map((i) => ({ ...i })));
    setDraftDiscussion(effective.discussionStarter);
    setIsEditingTemplate(true);
  };

  const handleSaveEdit = () => {
    onSaveTemplateOverride(activeTemplate.id, {
      title: draftTitle.trim() || activeTemplate.title,
      duration: draftDuration > 0 ? draftDuration : activeTemplate.defaultDuration,
      agendaItems: draftAgenda.filter((i) => i.title.trim().length > 0),
      discussionStarter: draftDiscussion,
    });
    setIsEditingTemplate(false);
  };

  const handleSelectTemplate = (tmpl: MeetingTemplate) => {
    setSelectedId(tmpl.id);
    setIsEditingTemplate(false);
  };

  return (
    <div
      data-testid="meeting-template-modal"
      className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div
        dir={isArabic ? 'rtl' : 'ltr'}
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-auto border border-stone-200 max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between gap-2 shrink-0">
          <div>
            <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
              {isArabic
                ? 'قوالب الاجتماعات القابلة للتعديل والتطبيق الآمن'
                : 'Editable Meeting Templates'}
            </h3>
            <p className="text-[11px] text-stone-500">
              {isArabic
                ? 'تطبيق القالب يضيف البنود غير الموجودة ويلحق التمهيد دون مسح أي محتوى حالي في اللقاء.'
                : 'Applying a template merges new agenda items & notes without overwriting existing content.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isArabic ? 'إغلاق القوالب' : 'Close Templates'}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x md:rtl:divide-x-reverse divide-stone-200">
          {/* Templates List */}
          <div className="md:col-span-4 p-3 space-y-1.5 bg-stone-50/50">
            {templates.map((tmpl) => {
              const IconComp = getTemplateIcon(tmpl.icon);
              const isSelected = tmpl.id === activeTemplate.id;
              const isCustomized = Boolean(customOverrides[tmpl.id]);
              return (
                <button
                  key={tmpl.id}
                  type="button"
                  data-testid={`template-option-${tmpl.id}`}
                  onClick={() => handleSelectTemplate(tmpl)}
                  className={`w-full text-start p-2.5 rounded-xl border transition-colors flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-400 text-stone-950'
                      : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <IconComp
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      isSelected ? 'text-emerald-700' : 'text-stone-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs flex items-center justify-between gap-1">
                      <span className="truncate">{tmpl.shortTitle}</span>
                      {isCustomized && (
                        <span className="text-[10px] font-medium text-emerald-700 shrink-0">
                          معدّل
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-stone-500 line-clamp-2 mt-0.5">
                      {tmpl.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Template Preview / Inline Editor */}
          <div className="md:col-span-8 p-4 space-y-4 text-xs">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-200">
              <div>
                <h4 className="font-heading font-bold text-sm text-stone-900">
                  {effective.title}
                </h4>
                <p className="text-[11px] text-stone-500 mt-0.5 tabular-nums">
                  {isArabic ? `المدة المقترحة: ${effective.duration} دقيقة` : `Duration: ${effective.duration} min`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeOverride && !isEditingTemplate && (
                  <button
                    type="button"
                    onClick={() => onResetTemplateOverride(activeTemplate.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 text-[11px]"
                    title="استعادة النص الافتراضي للقالب"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>افتراضي</span>
                  </button>
                )}
                {!isEditingTemplate ? (
                  <button
                    type="button"
                    data-testid="edit-template-btn"
                    onClick={startEditing}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-semibold text-[11px]"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isArabic ? 'تعديل القالب' : 'Edit Template'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="save-template-edit-btn"
                    onClick={handleSaveEdit}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-semibold text-[11px]"
                  >
                    <Check className="w-3 h-3" />
                    <span>{isArabic ? 'حفظ التعديلات' : 'Save Template'}</span>
                  </button>
                )}
              </div>
            </div>

            {isEditingTemplate ? (
              <div className="space-y-3" data-testid="template-editor-form">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-stone-700 mb-1">
                      عنوان القالب المقترح
                    </label>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      المدة (دقيقة)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={480}
                      value={draftDuration}
                      onChange={(e) => setDraftDuration(Number(e.target.value) || 30)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-semibold text-stone-700">بنود جدول الأعمال في القالب</label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftAgenda([
                          ...draftAgenda,
                          { title: '', notes: '', durationMinutes: 10 },
                        ])
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      <span>إضافة بند</span>
                    </button>
                  </div>
                  <div className="space-y-2">
                    {draftAgenda.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/70 space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-stone-500 text-[11px]">{idx + 1}.</span>
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => {
                              const next = [...draftAgenda];
                              next[idx] = { ...next[idx], title: e.target.value };
                              setDraftAgenda(next);
                            }}
                            placeholder="عنوان البند"
                            className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs"
                          />
                          <input
                            type="number"
                            min={1}
                            max={240}
                            value={item.durationMinutes || ''}
                            onChange={(e) => {
                              const next = [...draftAgenda];
                              next[idx] = {
                                ...next[idx],
                                durationMinutes: Number(e.target.value) || undefined,
                              };
                              setDraftAgenda(next);
                            }}
                            placeholder="د"
                            className="w-14 bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDraftAgenda(draftAgenda.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                            aria-label="حذف البند"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={item.notes || ''}
                          onChange={(e) => {
                            const next = [...draftAgenda];
                            next[idx] = { ...next[idx], notes: e.target.value };
                            setDraftAgenda(next);
                          }}
                          placeholder="ملاحظة إرشادية للبند (اختياري)"
                          className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1 text-[11px]"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    نقاط تمهيد المناقشة
                  </label>
                  <textarea
                    rows={4}
                    value={draftDiscussion}
                    onChange={(e) => setDraftDiscussion(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl p-2 text-xs leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="font-bold text-stone-800 mb-1.5">
                    بنود جدول الأعمال ({effective.agendaItems.length})
                  </div>
                  <div className="space-y-1.5">
                    {effective.agendaItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl border border-stone-200 bg-stone-50/70"
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold text-stone-900">
                          <span>
                            {idx + 1}. {item.title}
                          </span>
                          {item.durationMinutes ? (
                            <span className="text-[10px] font-mono text-stone-500 tabular-nums">
                              {item.durationMinutes} د
                            </span>
                          ) : null}
                        </div>
                        {item.notes ? (
                          <p className="text-[11px] text-stone-600 mt-0.5">{item.notes}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="font-bold text-stone-800 mb-1">هيكل ملخص المناقشات</div>
                  <pre className="whitespace-pre-wrap font-sans text-[11px] text-stone-700 bg-stone-50 border border-stone-200 rounded-xl p-3 leading-relaxed">
                    {effective.discussionStarter}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-stone-500">
            {isArabic
              ? 'لن يتم استبدال أي بنود أو مناقشات مسجلة مسبقاً.'
              : 'Existing items and discussion text will be preserved.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-xs text-stone-600 hover:bg-stone-200 font-medium"
            >
              {isArabic ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              data-testid="apply-template-confirm-btn"
              onClick={() => {
                const overrideToApply = isEditingTemplate
                  ? {
                      title: draftTitle.trim() || activeTemplate.title,
                      duration: draftDuration > 0 ? draftDuration : activeTemplate.defaultDuration,
                      agendaItems: draftAgenda.filter((i) => i.title.trim().length > 0),
                      discussionStarter: draftDiscussion,
                    }
                  : activeOverride;
                if (isEditingTemplate && overrideToApply) {
                  onSaveTemplateOverride(activeTemplate.id, overrideToApply);
                }
                onApplyTemplate(activeTemplate, overrideToApply);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isArabic ? 'تطبيق القالب دون مسح الحالي' : 'Apply Safely'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
