import React, { useMemo, useState } from 'react';
import type { PlaybookTemplate } from '../../types';
import {
  BUILTIN_PLAYBOOK_TEMPLATES,
  PLAYBOOK_CATEGORY_META,
  PLAYBOOK_STEP_TYPE_META,
  clonePlaybookTemplateToCustom,
} from '../../utils/playbookEngine';
import {
  Copy,
  Edit3,
  Lock,
  Play,
  Plus,
  Trash2,
  ListChecks,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface PlaybookTemplatesViewProps {
  customTemplates: PlaybookTemplate[];
  currentUserId: string;
  isLoading: boolean;
  language: 'ar' | 'en';
  onCreateTemplate: () => void;
  onEditTemplate: (template: PlaybookTemplate) => void;
  onSaveClonedTemplate: (template: PlaybookTemplate) => void;
  onDeleteTemplate: (templateId: string) => void;
  onStartFromTemplate: (templateId: string) => void;
}

export const PlaybookTemplatesView: React.FC<PlaybookTemplatesViewProps> = ({
  customTemplates,
  currentUserId,
  isLoading,
  onCreateTemplate,
  onEditTemplate,
  onSaveClonedTemplate,
  onDeleteTemplate,
  onStartFromTemplate,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sortedCustom = useMemo(
    () =>
      [...(customTemplates || [])]
        .filter((t) => !t.isSystemTemplate)
        .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)),
    [customTemplates]
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClone = (tpl: PlaybookTemplate) => {
    const res = clonePlaybookTemplateToCustom({
      sourceTemplate: tpl,
      userId: currentUserId,
    });
    if (res.ok && res.template) {
      onSaveClonedTemplate(res.template);
      onEditTemplate(res.template);
    }
  };

  const renderTemplateCard = (tpl: PlaybookTemplate) => {
    const catMeta = PLAYBOOK_CATEGORY_META[tpl.category];
    const isExpanded = expandedIds.has(tpl.id);

    return (
      <div
        key={tpl.id}
        data-testid={`playbook-template-card-${tpl.id}`}
        className="bg-white rounded-2xl border border-stone-200 p-4 shadow-2xs space-y-3"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1.5 flex-1 min-w-[220px]">
            <div className="flex items-center flex-wrap gap-1.5">
              <span
                className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold ${catMeta.badgeClass}`}
              >
                {catMeta.labelAr}
              </span>
              {tpl.isSystemTemplate ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-100 border border-stone-200 text-stone-700 text-[11px] font-semibold">
                  <Lock className="w-3 h-3 text-stone-500" />
                  <span>قالب مدمج (للقراءة فقط)</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold">
                  قالب مخصص
                </span>
              )}
              <span className="text-[11px] text-stone-500 font-medium">
                {tpl.steps.length} خطوات
              </span>
            </div>

            <h3 className="font-heading font-bold text-sm sm:text-base text-stone-900">
              {tpl.name}
            </h3>
            {tpl.description && (
              <p className="text-xs text-stone-600 leading-relaxed">{tpl.description}</p>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-1.5 shrink-0 text-xs">
            <button
              type="button"
              data-testid={`start-from-template-btn-${tpl.id}`}
              onClick={() => onStartFromTemplate(tpl.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold shadow-2xs transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>بدء خطة</span>
            </button>

            <button
              type="button"
              data-testid={`clone-template-btn-${tpl.id}`}
              onClick={() => handleClone(tpl)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-800 font-semibold transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>إنشاء نسخة قابلة للتعديل</span>
            </button>

            {!tpl.isSystemTemplate && (
              <>
                <button
                  type="button"
                  data-testid={`edit-template-btn-${tpl.id}`}
                  onClick={() => onEditTemplate(tpl)}
                  className="p-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700"
                  title="تعديل القالب"
                >
                  <Edit3 className="w-4 h-4" />
                </button>

                {confirmDeleteId === tpl.id ? (
                  <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-1.5">
                    <button
                      type="button"
                      data-testid={`confirm-delete-template-btn-${tpl.id}`}
                      onClick={() => {
                        onDeleteTemplate(tpl.id);
                        setConfirmDeleteId(null);
                      }}
                      className="text-[11px] font-bold text-rose-700 hover:underline"
                    >
                      تأكيد الحذف
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] text-stone-600"
                    >
                      إلغاء
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid={`delete-template-btn-${tpl.id}`}
                    onClick={() => setConfirmDeleteId(tpl.id)}
                    className="p-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600"
                    title="حذف القالب (لا يؤثر على الخطط القائمة)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Steps Toggle */}
        <div>
          <button
            type="button"
            onClick={() => toggleExpanded(tpl.id)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-600 hover:text-emerald-900"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{isExpanded ? 'إخفاء تفاصيل الخطوات' : `عرض الخطوات (${tpl.steps.length})`}</span>
          </button>

          {isExpanded && (
            <div className="mt-2.5 space-y-1.5 border-t border-stone-100 pt-2.5">
              {tpl.steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-xl bg-stone-50 border border-stone-100"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-stone-200 text-stone-800 text-[10px] font-bold flex items-center justify-center">
                      {step.order}
                    </span>
                    <span className="font-semibold text-stone-900">{step.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-stone-500">
                    <span>{PLAYBOOK_STEP_TYPE_META[step.stepType].labelAr}</span>
                    <span>•</span>
                    <span>
                      {step.duePolicy.offsetDays === 0
                        ? 'نفس اليوم'
                        : `+${step.duePolicy.offsetDays} يوم (${
                            step.duePolicy.type === 'from_start'
                              ? 'من البدء'
                              : 'بعد السابقة'
                          })`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid="playbook-templates-view">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base sm:text-lg font-bold text-stone-900">
            مكتبة قوالب خطط العلاقات والمتابعة
          </h2>
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
            استخدم القوالب الجاهزة مباشرة لبدء خطة مع عميل، أو أنشئ نسخة مخصصة وقوالبك الخاصة.
          </p>
        </div>

        <button
          type="button"
          data-testid="create-custom-template-btn"
          onClick={onCreateTemplate}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs shrink-0 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>إنشاء قالب مخصص</span>
        </button>
      </div>

      {/* Custom Templates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-stone-800">
            قوالبي المخصصة ({sortedCustom.length})
          </h3>
          {isLoading && (
            <span className="text-[11px] text-stone-500">جارٍ مزامنة القوالب...</span>
          )}
        </div>

        {sortedCustom.length === 0 ? (
          <div
            data-testid="custom-templates-empty-state"
            className="bg-white rounded-2xl border border-stone-200 p-6 text-center space-y-2.5"
          >
            <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto">
              <ListChecks className="w-5 h-5" />
            </div>
            <p className="font-bold text-xs text-stone-800">لا توجد قوالب مخصصة بعد</p>
            <p className="text-[11px] text-stone-500 max-w-md mx-auto">
              يمكنك إنشاء قالب متابعة خاص بأسلوب عملك أو نسخ أي قالب مدمج والتعديل عليه دون التأثير على القالب الأصلي.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedCustom.map((tpl) => renderTemplateCard(tpl))}
          </div>
        )}
      </div>

      {/* Built-in System Templates */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-stone-800">
          القوالب المدمجة المعتمدة ({BUILTIN_PLAYBOOK_TEMPLATES.length})
        </h3>
        <div className="space-y-3">
          {BUILTIN_PLAYBOOK_TEMPLATES.map((tpl) => renderTemplateCard(tpl))}
        </div>
      </div>
    </div>
  );
};
