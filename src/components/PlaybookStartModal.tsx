import React, { useEffect, useMemo, useState } from 'react';
import type {
  Client,
  Opportunity,
  PlaybookRun,
  PlaybookTemplate,
  PlaybookTemplateStep,
} from '../types';
import {
  PLAYBOOK_CATEGORY_META,
  PLAYBOOK_STEP_TYPE_META,
  STEP_DEPENDENCY_PLACEHOLDER_AR,
  getAllAvailablePlaybookTemplates,
  previewTemplateStepDueDates,
  startPlaybookRun,
} from '../utils/playbookEngine';
import { getTodayCalendarKey } from '../utils/followUpEngine';
import {
  X,
  Play,
  AlertTriangle,
  Calendar,
  Building2,
  Briefcase,
  Info,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface PlaybookStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  customTemplates: PlaybookTemplate[];
  clients: Client[];
  opportunities: Opportunity[];
  existingRuns: PlaybookRun[];
  currentUserId: string;
  defaultTemplateId?: string;
  defaultClientId?: string;
  defaultOpportunityId?: string;
  language: 'ar' | 'en';
  onStartRun: (run: PlaybookRun) => void;
}

export const PlaybookStartModal: React.FC<PlaybookStartModalProps> = ({
  isOpen,
  onClose,
  customTemplates,
  clients,
  opportunities,
  existingRuns,
  currentUserId,
  defaultTemplateId,
  defaultClientId,
  defaultOpportunityId,
  language,
  onStartRun,
}) => {
  const availableTemplates = useMemo(
    () => getAllAvailablePlaybookTemplates(customTemplates, currentUserId),
    [customTemplates, currentUserId]
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [runTitle, setRunTitle] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>('');
  const [startDateKey, setStartDateKey] = useState<string>(() => getTodayCalendarKey());
  const [editableSteps, setEditableSteps] = useState<PlaybookTemplateStep[]>([]);
  const [errorAr, setErrorAr] = useState<string | null>(null);
  const [duplicateWarningRuns, setDuplicateWarningRuns] = useState<PlaybookRun[]>([]);

  const selectedTemplate = useMemo(
    () => availableTemplates.find((t) => t.id === selectedTemplateId) || availableTemplates[0],
    [availableTemplates, selectedTemplateId]
  );

  // Sync defaults cleanly on modal open
  useEffect(() => {
    if (!isOpen) return;
    setErrorAr(null);
    setDuplicateWarningRuns([]);

    const initialTpl =
      availableTemplates.find((t) => t.id === defaultTemplateId) || availableTemplates[0];
    if (initialTpl) {
      setSelectedTemplateId(initialTpl.id);
      setRunTitle(initialTpl.name);
      setEditableSteps(
        initialTpl.steps.map((s, idx) => ({
          ...s,
          order: idx + 1,
          duePolicy: { ...s.duePolicy },
        }))
      );
    }

    const validClient =
      clients.find((c) => c.id === defaultClientId) || (clients.length === 1 ? clients[0] : undefined);
    setSelectedClientId(validClient?.id || defaultClientId || '');

    if (
      defaultOpportunityId &&
      validClient &&
      opportunities.some((o) => o.id === defaultOpportunityId && o.clientId === validClient.id)
    ) {
      setSelectedOpportunityId(defaultOpportunityId);
    } else {
      setSelectedOpportunityId('');
    }

    setStartDateKey(getTodayCalendarKey());
  }, [
    isOpen,
    defaultTemplateId,
    defaultClientId,
    defaultOpportunityId,
    availableTemplates,
    clients,
    opportunities,
  ]);

  const handleSelectTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setDuplicateWarningRuns([]);
    setErrorAr(null);
    const tpl = availableTemplates.find((t) => t.id === templateId);
    if (tpl) {
      setRunTitle(tpl.name);
      setEditableSteps(
        tpl.steps.map((s, idx) => ({
          ...s,
          order: idx + 1,
          duePolicy: { ...s.duePolicy },
        }))
      );
    }
  };

  const clientOpportunities = useMemo(
    () =>
      selectedClientId
        ? opportunities.filter((o) => o.clientId === selectedClientId)
        : [],
    [opportunities, selectedClientId]
  );

  const previewDates = useMemo(
    () =>
      previewTemplateStepDueDates({
        steps: editableSteps,
        startDateKey,
      }),
    [editableSteps, startDateKey]
  );

  if (!isOpen) return null;

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const selectedOpportunity = selectedOpportunityId
    ? clientOpportunities.find((o) => o.id === selectedOpportunityId)
    : undefined;

  const updateStepBeforeLaunch = (index: number, patch: Partial<PlaybookTemplateStep>) => {
    setEditableSteps((prev) =>
      prev.map((step, idx) => (idx === index ? { ...step, ...patch } : step))
    );
  };

  const updateStepOffsetBeforeLaunch = (index: number, offsetDays: number) => {
    setEditableSteps((prev) =>
      prev.map((step, idx) =>
        idx === index
          ? {
              ...step,
              duePolicy: {
                ...step.duePolicy,
                offsetDays: Math.max(0, Math.min(365, Math.round(offsetDays || 0))),
              },
            }
          : step
      )
    );
  };

  const handleLaunch = (confirmDuplicate: boolean) => {
    setErrorAr(null);
    if (!selectedTemplate) {
      setErrorAr('اختر قالب خطة متابعة أولًا.');
      return;
    }

    const res = startPlaybookRun({
      userId: currentUserId,
      template: selectedTemplate,
      templateNameOverride: runTitle,
      client: selectedClient,
      opportunity: selectedOpportunity,
      startDateKey,
      customizedSteps: editableSteps,
      existingRuns,
      confirmDuplicate,
    });

    if (!res.ok) {
      if (res.requiresDuplicateConfirmation && res.duplicateRuns) {
        setDuplicateWarningRuns(res.duplicateRuns);
        return;
      }
      setErrorAr(res.errorAr || 'تعذر بدء خطة المتابعة.');
      return;
    }

    if (res.run) {
      onStartRun(res.run);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      data-testid="playbook-start-modal"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-2xl w-full my-auto flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-900 text-white flex items-center justify-center">
              <Play className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-base text-stone-900">
                {language === 'ar'
                  ? 'بدء خطة متابعة وعلاقة منظمة'
                  : 'Start Relationship Follow-Up Playbook'}
              </h2>
              <p className="text-[11px] text-stone-500">
                {language === 'ar'
                  ? 'اربط القالب بعميل وفرصة اختيارية، وراجع الخطوات والمواعيد النسبية قبل البدء.'
                  : 'Link a template to a client and optional opportunity, then review dates before launching.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-stone-500 hover:bg-stone-200/70 hover:text-stone-900"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {errorAr && (
            <div
              data-testid="playbook-start-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-medium">{errorAr}</span>
            </div>
          )}

          {duplicateWarningRuns.length > 0 && (
            <div
              data-testid="playbook-duplicate-warning"
              className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">
                    تنبيه: توجد {duplicateWarningRuns.length} خطة نشطة مطابقة بالفعل لهذا العميل!
                  </p>
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    الخطة النشطة الحالية: «{duplicateWarningRuns[0].templateName}» (بدأت في{' '}
                    {duplicateWarningRuns[0].startDateKey ||
                      duplicateWarningRuns[0].startedAt.slice(0, 10)}
                    ). يمكنك متابعة الخطة الحالية بدل التكرار، أو تأكيد إنشاء خطة إضافية.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDuplicateWarningRuns([])}
                  className="px-3 py-1.5 rounded-xl border border-amber-300 bg-white hover:bg-amber-100 text-amber-950 font-semibold"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  data-testid="confirm-duplicate-playbook-run-btn"
                  onClick={() => handleLaunch(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold"
                >
                  تأكيد إنشاء خطة إضافية رغم ذلك
                </button>
              </div>
            </div>
          )}

          {/* Template & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block font-bold text-stone-800">
                قالب خطة المتابعة <span className="text-rose-600">*</span>
              </label>
              <select
                data-testid="playbook-start-template-select"
                value={selectedTemplateId}
                onChange={(e) => handleSelectTemplateChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              >
                {availableTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.isSystemTemplate ? '★ ' : '• '}
                    {tpl.name} ({PLAYBOOK_CATEGORY_META[tpl.category].labelAr})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-stone-800">اسم هذه الخطة</label>
              <input
                type="text"
                data-testid="playbook-start-title-input"
                value={runTitle}
                onChange={(e) => setRunTitle(e.target.value)}
                maxLength={160}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              />
            </div>
          </div>

          {/* Client, Opportunity, Start Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block font-bold text-stone-800 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>العميل المستهدف <span className="text-rose-600">*</span></span>
              </label>
              <select
                data-testid="playbook-start-client-select"
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  setSelectedOpportunityId('');
                  setDuplicateWarningRuns([]);
                }}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              >
                <option value="">— اختر العميل —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-stone-800 flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5 text-indigo-700" />
                <span>فرصة الأعمال (اختياري)</span>
              </label>
              <select
                data-testid="playbook-start-opportunity-select"
                value={selectedOpportunityId}
                disabled={!selectedClientId}
                onChange={(e) => {
                  setSelectedOpportunityId(e.target.value);
                  setDuplicateWarningRuns([]);
                }}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white disabled:bg-stone-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              >
                <option value="">بدون ربط بفرصة محددة</option>
                {clientOpportunities.map((opp) => (
                  <option key={opp.id} value={opp.id}>
                    {opp.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-stone-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-stone-600" />
                <span>تاريخ بدء الخطة</span>
              </label>
              <input
                type="date"
                data-testid="playbook-start-date-input"
                value={startDateKey}
                onChange={(e) => setStartDateKey(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-700"
              />
            </div>
          </div>

          {/* Pre-Start Steps Review & Custom Adjustment */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-stone-900">
                مراجعة وتخصيص الخطوات قبل البدء ({editableSteps.length} خطوات)
              </h3>
              <span className="text-[11px] text-stone-500">
                تُنسخ نسخة مستقلة خاصة بهذه الخطة
              </span>
            </div>

            <div className="space-y-2">
              {editableSteps.map((step, idx) => {
                const preview = previewDates.find((p) => p.stepId === step.id);
                const typeMeta = PLAYBOOK_STEP_TYPE_META[step.stepType];
                return (
                  <div
                    key={step.id}
                    className="p-3 rounded-2xl border border-stone-200 bg-stone-50/70 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <span className="w-5 h-5 rounded-md bg-emerald-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) =>
                            updateStepBeforeLaunch(idx, { title: e.target.value })
                          }
                          maxLength={200}
                          className="flex-1 px-2 py-1 rounded-lg border border-stone-300 bg-white font-semibold text-stone-900"
                        />
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${typeMeta.badgeClass}`}
                      >
                        {typeMeta.labelAr}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 flex-wrap text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-stone-500">المدة النسبية:</span>
                        <input
                          type="number"
                          min={0}
                          max={365}
                          value={step.duePolicy.offsetDays}
                          onChange={(e) =>
                            updateStepOffsetBeforeLaunch(
                              idx,
                              parseInt(e.target.value || '0', 10)
                            )
                          }
                          className="w-14 px-2 py-0.5 rounded-lg border border-stone-300 bg-white text-center"
                        />
                        <span className="text-stone-600">
                          يوم{' '}
                          {step.duePolicy.type === 'from_start'
                            ? 'من البدء'
                            : 'بعد إكمال السابقة'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 font-semibold">
                        <Clock className="w-3.5 h-3.5 text-stone-400" />
                        {preview?.dueDate ? (
                          <span className="text-emerald-900">
                            الموعد المتوقع: {preview.dueDate}
                          </span>
                        ) : (
                          <span className="text-stone-600">
                            {STEP_DEPENDENCY_PLACEHOLDER_AR}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Honest Automation Disclosure */}
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-stone-600 text-[11px] flex items-start gap-2">
            <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
            <span>
              بدء خطة المتابعة لا يُنشئ مهامًا أو اجتماعات أو رسائل تلقائيًا؛ يمكنك تحويل أي خطوة إلى مهمة أو ربطها بتواصل يدويًا داخل مساحة الخطة.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold"
          >
            إلغاء
          </button>
          <button
            type="button"
            data-testid="launch-playbook-run-btn"
            onClick={() => handleLaunch(false)}
            disabled={!selectedClientId || !selectedTemplate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold shadow-xs transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>بدء خطة المتابعة</span>
          </button>
        </div>
      </div>
    </div>
  );
};
