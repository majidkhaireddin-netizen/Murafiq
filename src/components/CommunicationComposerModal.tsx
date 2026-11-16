import React, { useState, useEffect, useRef } from 'react';
import type {
  Client,
  CommunicationChannel,
  CommunicationInteraction,
  CommunicationTemplate,
  CommunicationTemplateCategory,
  Opportunity,
  Meeting,
  CommunicationOutreachTone,
  CommunicationOutreachGranularity,
  CommunicationOutcome,
} from '../types/index.ts';
import {
  SYSTEM_COMMUNICATION_TEMPLATES,
  SUPPORTED_COMMUNICATION_VARIABLES,
  interpolateTemplate,
  buildWhatsAppOutreachUrl,
  buildEmailOutreachUrl,
  sanitizeCommunicationTemplateForSave,
} from '../utils/communicationComposerEngine.ts';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_OUTCOMES_ORDER,
  COMMUNICATION_OUTCOME_META,
  EXTERNAL_COMMUNICATION_DISCLOSURE_AR,
} from '../utils/communications.ts';
import { requestCommunicationDraft } from '../services/communicationAi.ts';
import {
  Sparkles,
  MessageCircle,
  Mail,
  Copy,
  Check,
  Send,
  ShieldCheck,
  X,
  FileText,
  Plus,
  Trash2,
  Edit3,
  AlertTriangle,
  Lock,
} from 'lucide-react';

interface CommunicationComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  clients?: Client[];
  opportunities?: Opportunity[];
  meetings?: Meeting[];
  customTemplates?: CommunicationTemplate[];
  onSaveTemplate?: (template: CommunicationTemplate) => void;
  onDeleteTemplate?: (templateId: string) => void;
  onLogInteraction: (interaction: CommunicationInteraction) => Promise<void>;
  initialChannel?: CommunicationChannel;
  initialContactId?: string;
  initialOpportunityId?: string;
  initialMeetingId?: string;
  isOnline?: boolean;
}

export const CommunicationComposerModal: React.FC<CommunicationComposerModalProps> = ({
  isOpen,
  onClose,
  client,
  opportunities = [],
  meetings = [],
  customTemplates = [],
  onSaveTemplate,
  onDeleteTemplate,
  onLogInteraction,
  initialChannel = 'whatsapp',
  initialContactId,
  initialOpportunityId,
  initialMeetingId,
  isOnline = true,
}) => {
  const clientOpportunities = opportunities.filter((o) => o.clientId === client.id);
  const clientMeetings = meetings.filter((m) => m.clientId === client.id);

  const resolveValidContactId = (candidateId?: string): string => {
    if (candidateId && (client.contacts || []).some((c) => c.id === candidateId)) {
      return candidateId;
    }
    return client.contacts?.find((c) => c.isPrimary)?.id || client.contacts?.[0]?.id || '';
  };

  const resolveValidOpportunityId = (candidateId?: string): string => {
    if (candidateId && clientOpportunities.some((o) => o.id === candidateId)) {
      return candidateId;
    }
    return '';
  };

  const resolveValidMeetingId = (candidateId?: string): string => {
    if (candidateId && clientMeetings.some((m) => m.id === candidateId)) {
      return candidateId;
    }
    return '';
  };

  const [selectedChannel, setSelectedChannel] = useState<CommunicationChannel>(initialChannel);
  const [selectedContactId, setSelectedContactId] = useState<string>(() =>
    resolveValidContactId(initialContactId)
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>(() =>
    resolveValidOpportunityId(initialOpportunityId)
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>(() =>
    resolveValidMeetingId(initialMeetingId)
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('sys-tmpl-intro-lead');
  const [categoryFilter, setCategoryFilter] = useState<CommunicationTemplateCategory | 'all'>('all');

  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Manual Variable Overrides for missing context
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});

  // AI Consent & Draft Modal State
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [showAiConsentModal, setShowAiConsentModal] = useState<boolean>(false);
  const [aiConsentGranted, setAiConsentGranted] = useState<boolean>(false);
  const [aiTone, setAiTone] = useState<CommunicationOutreachTone>('formal');
  const [aiGranularity, setAiGranularity] = useState<CommunicationOutreachGranularity>('medium');
  const [aiCustomPrompt, setAiCustomPrompt] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Custom Template Editor State
  const [showTemplateEditor, setShowTemplateEditor] = useState<boolean>(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<CommunicationTemplate> | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Post-Send Human Confirmation & Logging State
  const [showLogSection, setShowLogSection] = useState<boolean>(false);
  const [logOutcome, setLogOutcome] = useState<CommunicationOutcome>('message_sent');
  const [dispatchConfirmed, setDispatchConfirmed] = useState<boolean>(false);
  const [storeBodyInSummary, setStoreBodyInSummary] = useState<boolean>(false);
  const [logNextStep, setLogNextStep] = useState<string>('');
  const [logNextDate, setLogNextDate] = useState<string>('');
  const [isSubmittingLog, setIsSubmittingLog] = useState<boolean>(false);
  const inFlightSubmitRef = useRef<boolean>(false);
  const stableDraftInteractionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedChannel(initialChannel);
      setSelectedContactId(resolveValidContactId(initialContactId));
      setSelectedOpportunityId(resolveValidOpportunityId(initialOpportunityId));
      setSelectedMeetingId(resolveValidMeetingId(initialMeetingId));
      setActionError(null);
      stableDraftInteractionIdRef.current = null;
      inFlightSubmitRef.current = false;
    }
  }, [isOpen, client.id, initialChannel, initialContactId, initialOpportunityId, initialMeetingId]);

  const allTemplates = [...SYSTEM_COMMUNICATION_TEMPLATES, ...customTemplates];
  const filteredTemplates = allTemplates.filter(
    (t) => categoryFilter === 'all' || t.category === categoryFilter
  );

  const activeContact = client.contacts?.find((c) => c.id === selectedContactId);
  const activeOpportunity = clientOpportunities.find((o) => o.id === selectedOpportunityId);
  const activeMeeting = clientMeetings.find((m) => m.id === selectedMeetingId);

  // Interpolation result
  const currentTemplate = allTemplates.find((t) => t.id === selectedTemplateId);
  const interpolation = interpolateTemplate(
    currentTemplate?.bodyTemplate || body,
    {
      client,
      contact: activeContact,
      opportunity: activeOpportunity,
      meeting: activeMeeting,
      userCompanyName: 'مُرافق',
    },
    manualOverrides
  );

  // Update body and subject when template or overrides change
  useEffect(() => {
    if (currentTemplate) {
      setBody(interpolation.result);
      if (currentTemplate.subjectTemplate) {
        const subInterp = interpolateTemplate(
          currentTemplate.subjectTemplate,
          {
            client,
            contact: activeContact,
            opportunity: activeOpportunity,
            meeting: activeMeeting,
          },
          manualOverrides
        );
        setSubject(subInterp.result);
      } else {
        setSubject('');
      }
    }
  }, [selectedTemplateId, selectedContactId, selectedOpportunityId, selectedMeetingId, manualOverrides]);

  if (!isOpen) return null;

  const handleCopyText = async () => {
    const fullText = subject ? `الموضوع: ${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setActionError('تعذر نسخ النص إلى الحافظة.');
    }
  };

  const handleOpenExternal = () => {
    setActionError(null);
    if (selectedChannel === 'whatsapp') {
      const phone = activeContact?.phone || client.phone;
      const url = buildWhatsAppOutreachUrl(phone, body);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setActionError('رقم الهاتف غير متوفر أو غير صالح لرابط واتساب.');
      }
    } else if (selectedChannel === 'email') {
      const email = activeContact?.email || client.email;
      const url = buildEmailOutreachUrl(email, subject, body);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setActionError('البريد الإلكتروني غير متوفر أو غير صالح للإرسال.');
      }
    } else {
      handleCopyText();
    }
  };

  const handleInitiateAiFlow = () => {
    setAiError(null);
    if (!aiConsentGranted) {
      setShowAiConsentModal(true);
    } else {
      setShowAiModal(true);
    }
  };

  const handleConsentGranted = () => {
    setAiConsentGranted(true);
    setShowAiConsentModal(false);
    setShowAiModal(true);
  };

  const handleGenerateAiDraft = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const draft = await requestCommunicationDraft({
        request: {
          channel: selectedChannel,
          clientId: client.id,
          contactId: selectedContactId || undefined,
          opportunityId: selectedOpportunityId || undefined,
          meetingId: selectedMeetingId || undefined,
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
      });

      if (draft.subject) setSubject(draft.subject);
      if (draft.body) setBody(draft.body);
      setShowAiModal(false);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بخدمة الصياغة الذكية.';
      setAiError(errMsg);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleSaveCustomTemplate = () => {
    setTemplateError(null);
    if (!onSaveTemplate || !editingTemplate) return;
    try {
      const sanitized = sanitizeCommunicationTemplateForSave(
        editingTemplate as CommunicationTemplate,
        client.userId || 'user-local'
      );
      onSaveTemplate(sanitized);
      setShowTemplateEditor(false);
      setEditingTemplate(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ القالب.';
      setTemplateError(msg);
    }
  };

  const handleCloneSystemTemplate = (sysTmpl: CommunicationTemplate) => {
    if (!onSaveTemplate) return;
    const cloned: CommunicationTemplate = {
      ...sysTmpl,
      id: `tmpl-clone-${Date.now()}`,
      title: `${sysTmpl.title} (نسخة مخصصة)`,
      isSystemTemplate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSaveTemplate(cloned);
    setSelectedTemplateId(cloned.id);
  };

  const handleFinalSubmitLog = async () => {
    if (inFlightSubmitRef.current || isSubmittingLog) {
      return;
    }
    if (!dispatchConfirmed) {
      setActionError('يرجى تأكيد أنك قمت بإرسال الرسالة فعلاً عبر القناة الخارجية قبل تسجيلها في السجل.');
      return;
    }
    if (!isOnline) {
      setActionError(
        'أنت في وضع عدم الاتصال بالإنترنت: لا يمكن تأكيد حفظ سجل التواصل سحابياً الآن. ستبقى المسودة مفتوحة ومحفوظة حتى عودة الاتصال.'
      );
      return;
    }

    inFlightSubmitRef.current = true;
    setIsSubmittingLog(true);
    setActionError(null);

    if (!stableDraftInteractionIdRef.current) {
      stableDraftInteractionIdRef.current = `comm-${Date.now()}`;
    }

    const summaryText = storeBodyInSummary
      ? body.slice(0, 1500)
      : `مراسلة عبر ${COMMUNICATION_CHANNEL_META[selectedChannel]?.labelAr || selectedChannel} (بدون حفظ النص الكامل بناءً على تفضيل الخصوصية).`;

    const nowIso = new Date().toISOString();
    const interaction: CommunicationInteraction = {
      id: stableDraftInteractionIdRef.current,
      clientId: client.id,
      contactId: activeContact ? activeContact.id : undefined,
      contactName: activeContact?.name || undefined,
      opportunityId: activeOpportunity ? activeOpportunity.id : undefined,
      meetingId: activeMeeting ? activeMeeting.id : undefined,
      channel: selectedChannel,
      direction: 'outbound',
      occurredAt: nowIso,
      subject: subject
        ? `${subject} - ${client.name}`
        : `مراسلة عبر ${COMMUNICATION_CHANNEL_META[selectedChannel]?.labelAr || selectedChannel}`,
      summary: summaryText,
      outcome: logOutcome,
      nextStep: logNextStep.trim() || undefined,
      nextFollowUpDate: logNextDate || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      await onLogInteraction(interaction);
      stableDraftInteractionIdRef.current = null;
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ سجل النشاط على الخادم.';
      setActionError(msg);
    } finally {
      inFlightSubmitRef.current = false;
      setIsSubmittingLog(false);
    }
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
              <h2 className="text-lg font-bold">مساعد المراسلات الذكي وقوالب التواصل</h2>
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

          {actionError && (
            <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}
          
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

          {/* Row 2: Template Picker & Creator */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                اختر قالباً جاهزاً أو أنشئ قالبك المخصص
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CommunicationTemplateCategory | 'all')}
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
                  <option value="custom">مخصص</option>
                </select>

                <button
                  onClick={() => {
                    setEditingTemplate({
                      id: `tmpl-custom-${Date.now()}`,
                      title: '',
                      category: 'custom',
                      channel: 'any',
                      bodyTemplate: '',
                      variables: [],
                      isSystemTemplate: false,
                    });
                    setShowTemplateEditor(true);
                  }}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  قالب مخصص جديد
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-44 overflow-y-auto p-1">
              {filteredTemplates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  className={`p-3 rounded-xl border text-right cursor-pointer transition relative group ${
                    selectedTemplateId === tmpl.id
                      ? 'bg-indigo-50 border-indigo-300 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 truncate">{tmpl.title}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                        {tmpl.isSystemTemplate ? 'جاهز' : 'مخصص'}
                      </span>
                      {tmpl.isSystemTemplate && onSaveTemplate && (
                        <button
                          title="استنساخ وتعديل"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloneSystemTemplate(tmpl);
                          }}
                          className="p-1 text-slate-400 hover:text-indigo-600 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!tmpl.isSystemTemplate && onDeleteTemplate && (
                        <button
                          title="حذف القالب"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('هل أنت متأكد من حذف هذا القالب المخصص؟')) {
                              onDeleteTemplate(tmpl.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1">{tmpl.bodyTemplate}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Missing Variables Warning & Manual Completion Banner */}
          {interpolation.missingVariables.length > 0 && (
            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-3">
              <div className="flex items-center gap-2 text-amber-900 text-xs font-bold">
                قالب يتطلب استكمال بيانات مفقودة: {interpolation.missingVariables.join(', ')}
              </div>
              <p className="text-[11px] text-amber-700">
                لتجنب إرسال نصوص ناقصة أو افتراضات غير دقيقة، يُرجى إدخال القيم الفورية أدناه:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {interpolation.missingVariables.map((vKey) => (
                  <div key={vKey} className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-700 w-28 truncate">{vKey}:</span>
                    <input
                      type="text"
                      placeholder={`أدخل قيمة ${vKey}...`}
                      value={manualOverrides[vKey] || ''}
                      onChange={(e) =>
                        setManualOverrides({ ...manualOverrides, [vKey]: e.target.value })
                      }
                      className="flex-1 rounded-lg border border-amber-300 px-2 py-1 text-xs bg-white text-slate-800"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
              onClick={handleInitiateAiFlow}
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

          {/* Post-Send Logging Section with Strict Human Confirmation */}
          {showLogSection && (
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                تسجيل تفاصيل التواصل في السجل (مطلوب يدوياً بعد الإرسال الخارجي)
              </h4>

              <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dispatchConfirmed}
                    onChange={(e) => setDispatchConfirmed(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                  />
                  أؤكد بصفتي مستخدماً أنني قمت بإرسال الرسالة فعلاً عبر القناة الخارجية المحددة.
                </label>
                <label className="flex items-center gap-2 text-[11px] text-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storeBodyInSummary}
                    onChange={(e) => setStoreBodyInSummary(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                  />
                  حفظ مقتطف محتوى الرسالة في سجل النشاط (اختياري).
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">نتيجة التواصل</label>
                  <select
                    value={logOutcome}
                    onChange={(e) => setLogOutcome(e.target.value as CommunicationOutcome)}
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

              {!isOnline && (
                <div
                  data-testid="composer-offline-save-warning"
                  className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium"
                >
                  أنت في وضع عدم الاتصال بالإنترنت: تم تعطيل الاعتماد السحابي المؤكد مؤقتاً مع الاحتفاظ بكامل مسودتك حتى عودة الاتصال.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                {actionError && (
                  <button
                    type="button"
                    data-testid="composer-retry-save-btn"
                    onClick={() => void handleFinalSubmitLog()}
                    disabled={isSubmittingLog || !dispatchConfirmed || !isOnline}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span>إعادة المحاولة</span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid="composer-confirm-save-btn"
                  onClick={() => void handleFinalSubmitLog()}
                  disabled={isSubmittingLog || !dispatchConfirmed || !isOnline}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {isSubmittingLog ? 'جاري التأكيد السحابي...' : 'حفظ وتسجيل في السجل'}
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

      {/* Explicit Gemini Privacy & Consent Modal */}
      {showAiConsentModal && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 border border-indigo-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                موافقة صريحة لاستخدام مساعد الذكاء الاصطناعي (Google Gemini)
              </h3>
              <button
                onClick={() => setShowAiConsentModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              <p>
                أنت على وشك إرسال بيانات سياقية محدودة إلى نموذج <strong>Google Gemini</strong> لتوليد مسودة مراسلة احترافية.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1 text-[11px]">
                <p className="font-bold text-slate-800">البيانات المرسلة حصراً:</p>
                <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                  <li>اسم العميل والشركة: {client.name} {client.company ? `(${client.company})` : ''}</li>
                  <li>اسم جهة الاتصال: {activeContact?.name || 'غير مشخص'}</li>
                  <li>عنوان الفرصة التجارية والقيمة: {activeOpportunity?.title || 'بدون'}</li>
                  <li>قناة التواصل المطلوبة: {selectedChannel} والنبرة المفضلة</li>
                </ul>
              </div>
              <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                ملاحظة أمان: لا يتم إرسال أي ملفات مرفقة، روابط سحابية، رموز مصادقة، أو بيانات عملاء آخرين. الهدف هو إنتاج مسودة للاستعراض البشري والمراجعة قبل أي إرسال.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowAiConsentModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleConsentGranted}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                أوافق وأرغب بالمتابعة
              </button>
            </div>
          </div>
        </div>
      )}

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
                  onChange={(e) => setAiTone(e.target.value as CommunicationOutreachTone)}
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
                  onChange={(e) => setAiGranularity(e.target.value as CommunicationOutreachGranularity)}
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

      {/* Custom Template Editor Modal */}
      {showTemplateEditor && editingTemplate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 space-y-4 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-600" />
                إنشاء أو تعديل قالب تواصل مخصص
              </h3>
              <button
                onClick={() => setShowTemplateEditor(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {templateError && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
                {templateError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">عنوان القالب</label>
                <input
                  type="text"
                  value={editingTemplate.title || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, title: e.target.value })}
                  placeholder="مثال: متابعة عرض السعر الدوري..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">التصنيف</label>
                  <select
                    value={editingTemplate.category || 'custom'}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        category: e.target.value as CommunicationTemplateCategory,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                  >
                    <option value="custom">مخصص (Custom)</option>
                    <option value="intro_lead">تعارف وبداية</option>
                    <option value="proposal_send">عروض أسعار</option>
                    <option value="meeting_invite">دعوات اجتماعات</option>
                    <option value="meeting_follow_up">متابعة اجتماعات</option>
                    <option value="opportunity_check_in">استفسارات فرص</option>
                    <option value="payment_reminder">تذكير مالي</option>
                    <option value="reactivation">إعادة تواصل</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">القناة المستهدفة</label>
                  <select
                    value={editingTemplate.channel || 'any'}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        channel: e.target.value as CommunicationChannel | 'any',
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                  >
                    <option value="any">أي قناة (Any)</option>
                    <option value="whatsapp">واتساب (WhatsApp)</option>
                    <option value="email">بريد إلكتروني (Email)</option>
                    <option value="call">مكالمة (Call)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">موضوع البريد (اختياري)</label>
                <input
                  type="text"
                  value={editingTemplate.subjectTemplate || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subjectTemplate: e.target.value })}
                  placeholder="موضوع البريد مع المتغيرات مثل {{opportunityTitle}}"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">محتوى القالب (Body)</label>
                <textarea
                  rows={6}
                  value={editingTemplate.bodyTemplate || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, bodyTemplate: e.target.value })}
                  placeholder="اكتب نص القالب مستخدماً المتغيرات المتاحة مثل {{contactName}}, {{companyName}}, {{opportunityTitle}}..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs bg-white text-slate-800 font-sans leading-relaxed"
                />
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <p className="font-bold text-slate-800">المتغيرات المدعومة المتاحة للإدراج:</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SUPPORTED_COMMUNICATION_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() =>
                        setEditingTemplate({
                          ...editingTemplate,
                          bodyTemplate: `${editingTemplate.bodyTemplate || ''}{{${v.key}}}`,
                        })
                      }
                      className="px-2 py-0.5 bg-white border border-slate-200 hover:border-indigo-400 rounded text-indigo-700 font-mono text-[10px] transition"
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowTemplateEditor(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveCustomTemplate}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                حفظ القالب المخصص
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
