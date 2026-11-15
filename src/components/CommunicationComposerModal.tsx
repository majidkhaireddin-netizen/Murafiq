import React, { useState, useEffect } from 'react';
import type {
  Client,
  ClientContact,
  CommunicationChannel,
  CommunicationInteraction,
  CommunicationTemplate,
  CommunicationTemplateCategory,
  Opportunity,
  Meeting,
  CommunicationOutreachTone,
  CommunicationOutreachGranularity,
} from '../types/index.ts';
import {
  SYSTEM_COMMUNICATION_TEMPLATES,
  SUPPORTED_COMMUNICATION_VARIABLES,
  interpolateTemplate,
  buildWhatsAppOutreachUrl,
  buildEmailOutreachUrl,
} from '../utils/communicationComposerEngine.ts';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOMES_ORDER,
  COMMUNICATION_OUTCOME_META,
  EXTERNAL_COMMUNICATION_DISCLOSURE_AR,
} from '../utils/communications.ts';
import { Sparkles, MessageCircle, Mail, Copy, Check, Send, ShieldCheck, X, FileText, Plus, HelpCircle } from 'lucide-react';

interface CommunicationComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  clients?: Client[];
  opportunities?: Opportunity[];
  meetings?: Meeting[];
  customTemplates?: CommunicationTemplate[];
  onSaveTemplate?: (template: CommunicationTemplate) => void;
  onLogInteraction: (interaction: CommunicationInteraction) => void;
  initialChannel?: CommunicationChannel;
  initialOpportunityId?: string;
  initialMeetingId?: string;
}

export const CommunicationComposerModal: React.FC<CommunicationComposerModalProps> = ({
  isOpen,
  onClose,
  client,
  opportunities = [],
  meetings = [],
  customTemplates = [],
  onSaveTemplate,
  onLogInteraction,
  initialChannel = 'whatsapp',
  initialOpportunityId,
  initialMeetingId,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<CommunicationChannel>(initialChannel);
  const [selectedContactId, setSelectedContactId] = useState<string>(
    client.contacts?.find((c) => c.isPrimary)?.id || client.contacts?.[0]?.id || ''
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>(initialOpportunityId || '');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>(initialMeetingId || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('sys-tmpl-intro-lead');
  const [categoryFilter, setCategoryFilter] = useState<CommunicationTemplateCategory | 'all'>('all');

  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // AI Draft State
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiTone, setAiTone] = useState<CommunicationOutreachTone>('professional' as any);
  const [aiGranularity, setAiGranularity] = useState<CommunicationOutreachGranularity>('medium');
  const [aiCustomPrompt, setAiCustomPrompt] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Post-Send Logging State
  const [showLogSection, setShowLogSection] = useState<boolean>(false);
  const [logOutcome, setLogOutcome] = useState<any>('message_sent');
  const [logSummary, setLogSummary] = useState<string>('');
  const [logNextStep, setLogNextStep] = useState<string>('');
  const [logNextDate, setLogNextDate] = useState<string>('');

  const allTemplates = [...SYSTEM_COMMUNICATION_TEMPLATES, ...customTemplates];
  const filteredTemplates = allTemplates.filter(
    (t) => categoryFilter === 'all' || t.category === categoryFilter
  );

  const activeContact = client.contacts?.find((c) => c.id === selectedContactId);
  const activeOpportunity = opportunities.find((o) => o.id === selectedOpportunityId);
  const activeMeeting = meetings.find((m) => m.id === selectedMeetingId);

  // Update body/subject when template changes
  useEffect(() => {
    const tmpl = allTemplates.find((t) => t.id === selectedTemplateId);
    if (tmpl) {
      const interp = interpolateTemplate(tmpl.bodyTemplate, {
        client,
        contact: activeContact,
        opportunity: activeOpportunity,
        meeting: activeMeeting,
      });
      setBody(interp.result);

      if (tmpl.subjectTemplate) {
        const subInterp = interpolateTemplate(tmpl.subjectTemplate, {
          client,
          contact: activeContact,
          opportunity: activeOpportunity,
          meeting: activeMeeting,
        });
        setSubject(subInterp.result);
      } else {
        setSubject('');
      }
    }
  }, [selectedTemplateId, selectedContactId, selectedOpportunityId, selectedMeetingId]);

  if (!isOpen) return null;

  const handleCopyText = async () => {
    const fullText = subject ? `الموضوع: ${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleOpenExternal = () => {
    if (selectedChannel === 'whatsapp') {
      const phone = activeContact?.phone || client.phone;
      const url = buildWhatsAppOutreachUrl(phone, body);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert('رقم الهاتف غير متوفر أو غير صالح لرابط واتساب.');
      }
    } else if (selectedChannel === 'email') {
      const email = activeContact?.email || client.email;
      const url = buildEmailOutreachUrl(email, subject, body);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert('البريد الإلكتروني غير متوفر أو غير صالح.');
      }
    } else {
      handleCopyText();
    }
  };

  const handleGenerateAiDraft = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/communication-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request: {
            channel: selectedChannel,
            clientId: client.id,
            contactId: selectedContactId,
            opportunityId: selectedOpportunityId,
            meetingId: selectedMeetingId,
            tone: aiTone,
            granularity: aiGranularity,
            customPrompt: aiCustomPrompt,
          },
          contextData: {
            clientName: client.name,
            companyName: client.company,
            contactName: activeContact?.name,
            opportunityTitle: activeOpportunity?.title,
            opportunityValue:
              activeOpportunity?.estimatedValue && activeOpportunity?.currency
                ? `${activeOpportunity.estimatedValue.toLocaleString()} ${activeOpportunity.currency}`
                : undefined,
            nextAction: activeOpportunity?.nextAction,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.messageArabic || 'تعذر توليد المسودة الذكية.');
      }

      if (data.subject) setSubject(data.subject);
      if (data.body) setBody(data.body);
      setShowAiModal(false);
    } catch (err: any) {
      setAiError(err.message || 'حدث خطأ أثناء الاتصال بخدمة الصياغة الذكية.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleFinalSubmitLog = () => {
    const interaction: CommunicationInteraction = {
      id: `comm-${Date.now()}`,
      clientId: client.id,
      contactId: selectedContactId || undefined,
      contactName: activeContact?.name || undefined,
      opportunityId: selectedOpportunityId || undefined,
      meetingId: selectedMeetingId || undefined,
      channel: selectedChannel,
      direction: 'outbound',
      occurredAt: new Date().toISOString(),
      subject: subject ? `${subject} - ${client.name}` : `مراسلة عبر ${COMMUNICATION_CHANNEL_META[selectedChannel]?.labelAr || selectedChannel}`,
      summary: body.slice(0, 1500),
      outcome: logOutcome,
      nextStep: logNextStep.trim() || undefined,
      nextFollowUpDate: logNextDate || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onLogInteraction(interaction);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/30 rounded-xl border border-indigo-500/30">
              <Sparkles className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">مساعد المراسلات الذكي والقوالب</h2>
              <p className="text-xs text-slate-300">
                إرسال وتجهيز المراسلات للعميل: <span className="font-semibold text-white">{client.name}</span> {client.company ? `(${client.company})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Row 1: Channel & Recipient Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">قناة التواصل</label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value as CommunicationChannel)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.values(COMMUNICATION_CHANNEL_META).map((ch) => (
                  <option key={ch.key} value={ch.key}>
                    {ch.labelAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">جهة الاتصال المسؤولة</label>
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">(العميل الرئيسي مباشر)</option>
                {client.contacts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.title ? `(${c.title})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الفرصة التجارية المرتبطة (اختياري)</label>
              <select
                value={selectedOpportunityId}
                onChange={(e) => setSelectedOpportunityId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">(بدون فرصة مرتبطة)</option>
                {opportunities
                  .filter((o) => o.clientId === client.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Row 2: Template Picker */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                اختر قالباً جاهزاً أو أنشئ مسودة
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as any)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white text-slate-700"
                >
                  <option value="all">جميع التصنيفات</option>
                  <option value="intro_lead">تعارف وبداية</option>
                  <option value="proposal_send">عروض أسعار</option>
                  <option value="meeting_invite">دعوات اجتماعات</option>
                  <option value="meeting_follow_up">متابعة اجتماعات</option>
                  <option value="opportunity_check_in">استفسارات فرص</option>
                  <option value="payment_reminder">تذكير مالي</option>
                  <option value="reactivation">إعادة تواصل</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-40 overflow-y-auto p-1">
              {filteredTemplates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  className={`p-3 rounded-xl border text-right cursor-pointer transition ${
                    selectedTemplateId === tmpl.id
                      ? 'bg-indigo-50 border-indigo-300 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 truncate">{tmpl.title}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {tmpl.isSystemTemplate ? 'جاهز' : 'مخصص'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1">{tmpl.bodyTemplate}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Row 3: AI Draft Trigger */}
          <div className="flex items-center justify-between bg-indigo-900/5 p-4 rounded-xl border border-indigo-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600 text-white rounded-lg">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">صياغة ذكية متقدمة عبر Google Gemini</h4>
                <p className="text-xs text-slate-600">توليد رسالة مخصصة بناءً على سياق العميل والفرصة بنبرة ومستوى تفصيل تطلبه.</p>
              </div>
            </div>
            <button
              onClick={() => setShowAiModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              صياغة بالذكاء الاصطناعي
            </button>
          </div>

          {/* Row 4: Subject & Body Editor */}
          <div className="space-y-3">
            {selectedChannel === 'email' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">موضوع الرسالة (Subject)</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="موضوع البريد الإلكتروني..."
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700">محتوى المراسلة (قابل للتعديل المباشر)</label>
                <span className="text-[11px] text-slate-400">{body.length} حرف</span>
              </div>
              <textarea
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans leading-relaxed"
                placeholder="اكتب أو عدل محتوى الرسالة هنا..."
              />
            </div>
          </div>

          {/* Row 5: Action & Dispatch Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyText}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-2"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'تم النسخ بنجاح' : 'نسخ النص'}
              </button>

              {selectedChannel === 'whatsapp' && (
                <button
                  onClick={handleOpenExternal}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  فتح في واتساب (wa.me)
                </button>
              )}

              {selectedChannel === 'email' && (
                <button
                  onClick={handleOpenExternal}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  فتح في تطبيق البريد (mailto)
                </button>
              )}
            </div>

            <button
              onClick={() => setShowLogSection(!showLogSection)}
              className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition flex items-center gap-2 border border-indigo-200"
            >
              <Send className="w-4 h-4" />
              {showLogSection ? 'إخفاء تسجيل التواصل' : 'تسجيل الإرسال كنشاط تواصل في السجل'}
            </button>
          </div>

          {/* Post-Send Logging Section */}
          {showLogSection && (
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                تسجيل تفاصيل التواصل في السجل (مطلوب يدوياً بعد الإرسال الخارجي)
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">نتيجة التواصل</label>
                  <select
                    value={logOutcome}
                    onChange={(e) => setLogOutcome(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                  >
                    {COMMUNICATION_OUTCOMES_ORDER.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {COMMUNICATION_OUTCOME_META[outcome]?.labelAr || outcome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">تاريخ المتابعة القادمة (إن وجدت)</label>
                  <input
                    type="date"
                    value={logNextDate}
                    onChange={(e) => setLogNextDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">الخطوة التالية المختصرة</label>
                  <input
                    type="text"
                    value={logNextStep}
                    onChange={(e) => setLogNextStep(e.target.value)}
                    placeholder="مثال: بانتظار رد العميل يوم الأحد"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleFinalSubmitLog}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  حفظ وتسجيل في السجل
                </button>
              </div>
            </div>
          )}

          {/* External Disclosure Footer */}
          <div className="text-[11px] text-slate-500 bg-amber-50/60 p-3 rounded-xl border border-amber-200/60 leading-relaxed">
            {EXTERNAL_COMMUNICATION_DISCLOSURE_AR}
          </div>

        </div>
      </div>

      {/* AI Draft Customization Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                إعدادات صياغة الذكاء الاصطناعي (Gemini)
              </h3>
              <button
                onClick={() => setShowAiModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {aiError && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
                {aiError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">نبرة الخطاب (Tone)</label>
                <select
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                >
                  <option value="formal">رسمية مهنية (Formal)</option>
                  <option value="friendly">ودية وقريبة (Friendly)</option>
                  <option value="persuasive">إقناعية تسويقية (Persuasive)</option>
                  <option value="concise">مختصرة ومباشرة (Concise)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">مستوى التفصيل (Granularity)</label>
                <select
                  value={aiGranularity}
                  onChange={(e) => setAiGranularity(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                >
                  <option value="short">موجزة (Short)</option>
                  <option value="medium">متوسطة (Medium)</option>
                  <option value="detailed">تفصيلية شاملة (Detailed)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">تعليمات إضافية للمساعد (اختياري)</label>
                <textarea
                  rows={3}
                  value={aiCustomPrompt}
                  onChange={(e) => setAiCustomPrompt(e.target.value)}
                  placeholder="مثال: ركز على أهمية الخصم المقترح والتسليم خلال الأسبوع القادم..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs bg-white text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowAiModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleGenerateAiDraft}
                disabled={isGeneratingAi}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                {isGeneratingAi ? 'جاري الصياغة...' : 'توليد المسودة الذكية'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
