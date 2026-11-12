import React from 'react';
import { Meeting, Client, ActionItem } from '../types';
import { formatArabicDate, getHijriDateString } from '../utils/logic';
import { Printer, Share2, Copy, X, Check, FileText } from 'lucide-react';

interface MeetingMinutesPdfModalProps {
  meeting: Meeting;
  client?: Client;
  tasks: ActionItem[];
  isOpen: boolean;
  onClose: () => void;
  language: 'ar' | 'en';
}

export const MeetingMinutesPdfModal: React.FC<MeetingMinutesPdfModalProps> = ({
  meeting,
  client,
  tasks,
  isOpen,
  onClose,
  language,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const meetingTasks = tasks.filter((t) => t.meetingId === meeting.id);

  const getMeetingTypeArabic = (type: string) => {
    switch (type) {
      case 'in_person':
        return 'لقاء وجهاً لوجه';
      case 'video':
        return 'مكالمة مرئية عن بُعد';
      case 'phone':
        return 'مكالمة هاتفية';
      case 'chat':
        return 'مراسلة مكتوبة';
      default:
        return type;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    const text = `
مـحـضـر لـقـاء رسـمـي
التاريخ: ${formatArabicDate(meeting.dateTime, true)} (${getHijriDateString(meeting.dateTime)})
العميل: ${client?.name || 'غير محدد'} — ${client?.company || ''}
الموضوع: ${meeting.title}
نوع اللقاء: ${getMeetingTypeArabic(meeting.type)}
المكان: ${meeting.location || 'غير محدد'}
الحضور: ${meeting.attendees?.join('، ') || 'المشاركون'}

--- تفاصيل المحضر والقرارات ---
${meeting.notes}

--- المهام والالتزامات المتفق عليها ---
${meetingTasks.map((t, idx) => `${idx + 1}. ${t.title} — الموعد: ${t.dueDate || 'غير محدد'}`).join('\n')}

تم التوثيق عبر تطبيق مرافق.
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShareWhatsApp = () => {
    const summary = encodeURIComponent(
      `السلام عليكم، إليكم محضر اجتماع: "${meeting.title}"\nتاريخ: ${formatArabicDate(meeting.dateTime)}\nللاطلاع على البنود والمهام المعتمدة.`
    );
    const phone = client?.phone?.replace(/[^0-9]/g, '') || '';
    const url = phone ? `https://wa.me/${phone}?text=${summary}` : `https://wa.me/?text=${summary}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-auto overflow-hidden border border-stone-200">
        {/* Modal Controls Toolbar (Hidden on print) */}
        <div className="no-print bg-stone-50 border-b border-stone-200 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
              PDF
            </div>
            <div>
              <h3 className="font-heading font-bold text-stone-900 text-sm">
                معاينة محضر الاجتماع الرسمي
              </h3>
              <p className="text-[11px] text-stone-500">
                جاهز للطباعة والتوقيع أو المشاركة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة / حفظ PDF</span>
            </button>
            <button
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>واتساب</span>
            </button>
            <button
              onClick={handleCopyText}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Official Document Body */}
        <div className="print-container p-6 sm:p-10 text-stone-900 bg-white">
          {/* Document Header */}
          <div className="flex items-start justify-between border-b-2 border-stone-800 pb-5 mb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center font-bold text-sm">
                  م
                </div>
                <div>
                  <span className="font-heading font-bold text-lg text-stone-900 tracking-tight">
                    مُرافق | Murafiq
                  </span>
                  <p className="text-[11px] text-stone-500">
                    نظام توثيق اللقاءات والاتفاقات المهنية
                  </p>
                </div>
              </div>
            </div>

            <div className="text-start space-y-0.5 text-xs text-stone-600">
              <div>
                <span className="font-semibold text-stone-800">التاريخ الميلادي: </span>
                {formatArabicDate(meeting.dateTime, true)}
              </div>
              <div>
                <span className="font-semibold text-stone-800">التاريخ الهجري: </span>
                {getHijriDateString(meeting.dateTime)}
              </div>
              <div>
                <span className="font-semibold text-stone-800">رقم المحضر: </span>
                <span className="font-mono">MIN-{meeting.id.replace('m-', '').toUpperCase()}</span>
              </div>
            </div>
          </div>

          {/* Title Banner */}
          <div className="text-center my-6">
            <h2 className="font-heading font-extrabold text-xl text-stone-950 inline-block px-6 py-1.5 bg-stone-100 rounded-lg border border-stone-200">
              مـحـضـر اجـتـمـاع رسـمـي
            </h2>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-stone-50/70 p-4 rounded-xl border border-stone-200/80 mb-6 text-xs leading-relaxed">
            <div>
              <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider text-stone-500">
                العميل والجهة:
              </span>
              <p className="font-bold text-stone-900 text-sm mt-0.5">
                {client?.name || 'غير محدد'}
              </p>
              {client?.company && <p className="text-stone-600">{client.company}</p>}
            </div>

            <div>
              <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider text-stone-500">
                موضوع اللقاء:
              </span>
              <p className="font-bold text-stone-900 text-sm mt-0.5">{meeting.title}</p>
            </div>

            <div>
              <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider text-stone-500">
                نوع اللقاء والمكان:
              </span>
              <p className="text-stone-800 mt-0.5">
                {getMeetingTypeArabic(meeting.type)} {meeting.location && `— ${meeting.location}`}
              </p>
            </div>

            <div>
              <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider text-stone-500">
                قائمة الحضور:
              </span>
              <p className="text-stone-800 mt-0.5">
                {meeting.attendees && meeting.attendees.length > 0
                  ? meeting.attendees.join('، ')
                  : 'الطرفان المشاركان'}
              </p>
            </div>
          </div>

          {/* Meeting Notes Content */}
          <div className="mb-8">
            <h4 className="font-heading font-bold text-stone-900 text-sm border-b border-stone-200 pb-1.5 mb-3">
              أولاً: محاور النقاش والقرارات المتفق عليها
            </h4>
            <div className="text-xs text-stone-800 whitespace-pre-line leading-relaxed bg-stone-50/40 p-4 rounded-xl border border-stone-100">
              {meeting.notes}
            </div>
          </div>

          {/* Agreed Action Items Table */}
          <div className="mb-10">
            <h4 className="font-heading font-bold text-stone-900 text-sm border-b border-stone-200 pb-1.5 mb-3">
              ثانياً: خطة العمل والمهام الملزمة
            </h4>

            {meetingTasks.length === 0 ? (
              <p className="text-xs text-stone-500 italic p-3 bg-stone-50 rounded-lg">
                لا توجد مهام معلقة مرتبطة بهذا اللقاء، تم إنجاز كافة المخرجات.
              </p>
            ) : (
              <div className="overflow-x-auto border border-stone-200 rounded-xl">
                <table className="w-full text-xs text-start">
                  <thead className="bg-stone-100 text-stone-700 font-semibold border-b border-stone-200">
                    <tr>
                      <th className="py-2.5 px-3 text-start w-10">#</th>
                      <th className="py-2.5 px-3 text-start">المهمة / الالتزام</th>
                      <th className="py-2.5 px-3 text-start w-32">الموعد النهائي</th>
                      <th className="py-2.5 px-3 text-start w-24">درجة الأهمية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {meetingTasks.map((task, idx) => (
                      <tr key={task.id} className="hover:bg-stone-50/50">
                        <td className="py-2.5 px-3 font-mono font-medium text-stone-500">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-stone-900 block">{task.title}</span>
                          {task.description && (
                            <span className="text-[11px] text-stone-500 block mt-0.5">{task.description}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700 font-medium">
                          {task.dueDate ? formatArabicDate(task.dueDate) : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              task.priority === 'urgent'
                                ? 'bg-rose-100 text-rose-800'
                                : task.priority === 'high'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-stone-100 text-stone-700'
                            }`}
                          >
                            {task.priority === 'urgent' && 'عاجلة'}
                            {task.priority === 'high' && 'عالية'}
                            {task.priority === 'medium' && 'متوسطة'}
                            {task.priority === 'low' && 'منخفضة'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Formal Signature Blocks */}
          <div className="pt-8 border-t-2 border-stone-300 grid grid-cols-2 gap-8 text-xs">
            <div className="space-y-12">
              <div>
                <p className="font-bold text-stone-800">اعتماد وتوقيع العميل:</p>
                <p className="text-[11px] text-stone-500">{client?.name || 'ممثّل الجهة'}</p>
              </div>
              <div className="border-b border-dashed border-stone-400 w-44 pt-6" />
              <p className="text-[10px] text-stone-400">التاريخ: ___ / ___ / 2026 م</p>
            </div>

            <div className="space-y-12 text-start">
              <div>
                <p className="font-bold text-stone-800">مُعدّ المحضر والمسؤول:</p>
                <p className="text-[11px] text-stone-500">المستشار / المستقل</p>
              </div>
              <div className="border-b border-dashed border-stone-400 w-44 pt-6" />
              <p className="text-[10px] text-stone-400">التاريخ: ___ / ___ / 2026 م</p>
            </div>
          </div>

          {/* Footer watermark */}
          <div className="mt-12 text-center text-[10px] text-stone-400 border-t border-stone-100 pt-3">
            تم إصدار وتوثيق هذا المحضر آلياً عبر تطبيق مرافق — Murafiq (v1.0 Offline-First)
          </div>
        </div>
      </div>
    </div>
  );
};
