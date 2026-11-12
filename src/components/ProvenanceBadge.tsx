import React from 'react';
import { ProvenanceType } from '../types';
import { Sparkles, CheckCircle2, FileText, AlertCircle } from 'lucide-react';

interface ProvenanceBadgeProps {
  type?: ProvenanceType;
  showText?: boolean;
  className?: string;
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({
  type = 'source',
  showText = true,
  className = '',
}) => {
  switch (type) {
    case 'ai_suggested':
      return (
        <span
          title="اقتراح ذكي — بناءً على المحضر والوتيرة المعتادة"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200/80 ${className}`}
        >
          <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
          {showText && <span>اقتراح ذكي</span>}
        </span>
      );
    case 'approved':
      return (
        <span
          title="معلومات معتمدة ومؤكدة من المستخدم"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/80 ${className}`}
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
          {showText && <span>معتمد</span>}
        </span>
      );
    case 'uncertain':
      return (
        <span
          title="معلومات غير مؤكدة — بحاجة إلى مراجعة وتأكيد"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200/80 ${className}`}
        >
          <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
          {showText && <span>يحتاج تدقيق</span>}
        </span>
      );
    case 'source':
    default:
      return (
        <span
          title="مستخرجة مباشرة من محضر اللقاء الأصلي"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-700 border border-stone-200 ${className}`}
        >
          <FileText className="w-3 h-3 text-stone-500 shrink-0" />
          {showText && <span>من المحضر</span>}
        </span>
      );
  }
};
