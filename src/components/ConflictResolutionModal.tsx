import React, { useState } from 'react';
import { ConflictItem, ResolutionChoice } from '../types';
import { AlertTriangle, Check, Layers, ArrowLeftRight, HardDrive, Cloud, X } from 'lucide-react';

interface ConflictResolutionModalProps {
  conflict: ConflictItem | null;
  onResolve: (conflict: ConflictItem, choice: ResolutionChoice, customMergedNotes?: string) => void;
  onClose: () => void;
  language: 'ar' | 'en';
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  conflict,
  onResolve,
  onClose,
  language,
}) => {
  if (!conflict) return null;

  const [activeTab, setActiveTab] = useState<'comparison' | 'custom_merge'>('comparison');
  const [customMergeText, setCustomMergeText] = useState(
    `[النسخة السحابية]:\n${(conflict.remoteVersion as any).notes || (conflict.remoteVersion as any).content || ''}\n\n---\n[تعديلاتك أثناء عدم الاتصال]:\n${(conflict.localVersion as any).notes || (conflict.localVersion as any).content || ''}`
  );

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case 'client':
        return 'بيانات عميل';
      case 'meeting':
        return 'محضر لقاء';
      case 'task':
        return 'مهمة متابعة';
      default:
        return 'ملاحظة عامة';
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-stone-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full my-auto overflow-hidden border border-orange-200 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-orange-500 to-amber-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-heading font-extrabold text-base sm:text-lg">
                  {language === 'ar' ? 'معالجة تعارض البيانات (Conflict Resolution)' : 'Data Conflict Detected'}
                </h3>
                <span className="text-[10px] bg-white/25 px-2 py-0.5 rounded-full font-bold">
                  {getEntityTypeLabel(conflict.entityType)}
                </span>
              </div>
              <p className="text-xs text-white/90 mt-0.5">
                {language === 'ar'
                  ? 'تم تعديل هذا السجل محلياً أوفلاين بينما تم تحديثه على السحابة بالتزامن.'
                  : 'This record was modified offline while also updated remotely on the cloud.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Entity Title Banner */}
        <div className="bg-stone-50 border-b border-stone-200 px-5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-stone-500 font-medium">العنصر المتعارض:</span>
          <span className="font-bold text-stone-900 font-heading text-sm">
            {conflict.entityTitle}
          </span>
        </div>

        {/* Comparison Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Local Copy Card */}
            <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-emerald-200/80">
                <span className="font-bold text-emerald-950 flex items-center gap-1.5 text-xs">
                  <HardDrive className="w-4 h-4 text-emerald-700" />
                  <span>نسختك المحلية (هذا الجهاز)</span>
                </span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                  أوفلاين
                </span>
              </div>

              <div className="space-y-2 text-stone-800">
                {conflict.differingFields.map((field) => (
                  <div key={field.field} className="bg-white p-2.5 rounded-xl border border-emerald-100 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-semibold block mb-0.5">
                      {field.fieldLabelArabic}:
                    </span>
                    <span className="font-medium text-xs whitespace-pre-line text-emerald-950 font-sans">
                      {String(field.localValue || '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cloud/Remote Copy Card */}
            <div className="rounded-2xl border-2 border-sky-300 bg-sky-50/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-sky-200/80">
                <span className="font-bold text-sky-950 flex items-center gap-1.5 text-xs">
                  <Cloud className="w-4 h-4 text-sky-700" />
                  <span>نسخة السحابة (Firestore)</span>
                </span>
                <span className="text-[10px] bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded-full">
                  سحابي
                </span>
              </div>

              <div className="space-y-2 text-stone-800">
                {conflict.differingFields.map((field) => (
                  <div key={field.field} className="bg-white p-2.5 rounded-xl border border-sky-100 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-semibold block mb-0.5">
                      {field.fieldLabelArabic}:
                    </span>
                    <span className="font-medium text-xs whitespace-pre-line text-sky-950 font-sans">
                      {String(field.remoteValue || '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Merge Option preview if notes or content differ */}
          {conflict.differingFields.some((f) => f.field === 'notes' || f.field === 'content') && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-700" />
                  <span>معاينة الدمج الذكي للنصوص والمحاضر:</span>
                </span>
                <span className="text-[10px] text-amber-800">يمنع ضياع أي ملاحظة</span>
              </div>
              <textarea
                rows={4}
                value={customMergeText}
                onChange={(e) => setCustomMergeText(e.target.value)}
                className="w-full bg-white rounded-xl border border-amber-200 p-2.5 text-xs text-stone-800 font-sans focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-stone-100 border-t border-stone-200 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onResolve(conflict, 'keep_local')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>الاحتفاظ بنسختي المحلية</span>
            </button>
            <button
              onClick={() => onResolve(conflict, 'keep_remote')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-700 text-white hover:bg-sky-800 shadow-xs transition-colors"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>اعتماد نسخة السحابة</span>
            </button>
          </div>

          <button
            onClick={() => onResolve(conflict, 'merge', customMergeText)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-stone-900 text-white hover:bg-stone-800 shadow-xs transition-colors"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>دمج النصين ومزامنة</span>
          </button>
        </div>
      </div>
    </div>
  );
};
