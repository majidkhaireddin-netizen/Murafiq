import React, { useEffect, useMemo, useState } from 'react';
import type {
  ActionItem,
  Client,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationInteraction,
  CommunicationOutcome,
  Opportunity,
} from '../types';
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_CHANNEL_ORDER,
  COMMUNICATION_DIRECTION_META,
  COMMUNICATION_OUTCOME_META,
  COMMUNICATION_OUTCOME_ORDER,
  convertInteractionNextStepToTaskDraft,
  findLinkedTaskForInteraction,
  sanitizeInteractionForSave,
} from '../utils/communications';
import {
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Video,
  MessageSquare,
  UserCheck,
  X,
  Plus,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
  Tag,
  Briefcase,
  ArrowUpRight,
  ArrowDownLeft,
  CheckSquare,
} from 'lucide-react';

export interface InteractionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  opportunities: Opportunity[];
  tasks: ActionItem[];
  initialInteraction?: CommunicationInteraction | null;
  defaultClientId?: string;
  defaultContactId?: string;
  defaultOpportunityId?: string;
  defaultChannel?: CommunicationChannel;
  onSaveInteraction: (
    interaction: CommunicationInteraction,
    followUpTaskDraft?: ActionItem
  ) => void;
}

const SUGGESTED_TOPICS_AR = [
  'عرض السعر',
  'العقد والبنود',
  'الجدول الزمني',
  'الدفعات والفواتير',
  'متابعة دورية',
  'متطلبات فنية',
  'دعم وتشغيل',
];

function toLocalDateTimeInputValue(isoString?: string): string {
  const date = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export const CHANNEL_ICON_MAP: Record<
  CommunicationChannel,
  React.FC<{ className?: string }>
> = {
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  in_person: MapPin,
  video: Video,
  sms: MessageSquare,
  quick_check_in: UserCheck,
};

export const InteractionFormModal: React.FC<InteractionFormModalProps> = ({
  isOpen,
  onClose,
  clients,
  opportunities,
  tasks,
  initialInteraction,
  defaultClientId,
  defaultContactId,
  defaultOpportunityId,
  defaultChannel,
  onSaveInteraction,
}) => {
  const [clientId, setClientId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [customContactName, setCustomContactName] = useState<string>('');
  const [opportunityId, setOpportunityId] = useState<string>('');
  const [channel, setChannel] = useState<CommunicationChannel>('phone');
  const [direction, setDirection] = useState<CommunicationDirection>('outbound');
  const [occurredAtLocal, setOccurredAtLocal] = useState<string>(() =>
    toLocalDateTimeInputValue()
  );
  const [durationMinutes, setDurationMinutes] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [topics, setTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState<string>('');
  const [outcome, setOutcome] = useState<CommunicationOutcome>('answered');
  const [nextStep, setNextStep] = useState<string>('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState<string>('');
  const [createFollowUpTask, setCreateFollowUpTask] = useState<boolean>(false);
  const [errorAr, setErrorAr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorAr(null);
    setTopicInput('');

    if (initialInteraction) {
      setClientId(initialInteraction.clientId);
      setContactId(initialInteraction.contactId || '');
      setCustomContactName(
        initialInteraction.contactId ? '' : initialInteraction.contactName || ''
      );
      setOpportunityId(initialInteraction.opportunityId || '');
      setChannel(initialInteraction.channel);
      setDirection(initialInteraction.direction);
      setOccurredAtLocal(toLocalDateTimeInputValue(initialInteraction.occurredAt));
      setDurationMinutes(
        typeof initialInteraction.durationMinutes === 'number'
          ? String(initialInteraction.durationMinutes)
          : ''
      );
      setSubject(initialInteraction.subject || '');
      setSummary(initialInteraction.summary || '');
      setTopics(initialInteraction.topics || []);
      setOutcome(initialInteraction.outcome);
      setNextStep(initialInteraction.nextStep || '');
      setNextFollowUpDate(initialInteraction.nextFollowUpDate || '');
      setCreateFollowUpTask(false);
    } else {
      const resolvedClientId = defaultClientId || clients[0]?.id || '';
      setClientId(resolvedClientId);
      setContactId(defaultContactId || '');
      setCustomContactName('');
      setOpportunityId(defaultOpportunityId || '');
      setChannel(defaultChannel || 'phone');
      setDirection('outbound');
      setOccurredAtLocal(toLocalDateTimeInputValue());
      setDurationMinutes('');
      setSubject('');
      setSummary('');
      setTopics([]);
      setOutcome('answered');
      setNextStep('');
      setNextFollowUpDate('');
      setCreateFollowUpTask(false);
    }
  }, [
    isOpen,
    initialInteraction,
    defaultClientId,
    defaultContactId,
    defaultOpportunityId,
    defaultChannel,
    clients,
  ]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId),
    [clients, clientId]
  );

  const clientContacts = useMemo(
    () => selectedClient?.contacts || [],
    [selectedClient]
  );

  const clientOpportunities = useMemo(
    () => opportunities.filter((o) => o.clientId === clientId),
    [opportunities, clientId]
  );

  const existingLinkedTask = useMemo(() => {
    if (!initialInteraction) return undefined;
    return findLinkedTaskForInteraction(initialInteraction, tasks);
  }, [initialInteraction, tasks]);

  // Reset contactId & opportunityId if clientId changes and no longer matches
  useEffect(() => {
    if (contactId && !clientContacts.some((c) => c.id === contactId)) {
      setContactId('');
    }
    if (opportunityId && !clientOpportunities.some((o) => o.id === opportunityId)) {
      setOpportunityId('');
    }
  }, [clientId, contactId, opportunityId, clientContacts, clientOpportunities]);

  if (!isOpen) return null;

  const handleAddTopic = (raw: string) => {
    const cleaned = raw.trim().slice(0, 60);
    if (!cleaned) return;
    if (!topics.includes(cleaned) && topics.length < 15) {
      setTopics([...topics, cleaned]);
    }
    setTopicInput('');
  };

  const handleRemoveTopic = (topicToRemove: string) => {
    setTopics(topics.filter((t) => t !== topicToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorAr(null);

    if (!clientId) {
      setErrorAr('يرجى اختيار العميل المرتبط بهذا التواصل.');
      return;
    }

    if (!summary.trim()) {
      setErrorAr('يرجى كتابة ملخص التواصل أو النقاط التي تمت مناقشتها.');
      return;
    }

    const parsedDate = new Date(occurredAtLocal);
    const occurredAtIso = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();

    const matchedContact = clientContacts.find((c) => c.id === contactId);
    const resolvedContactName = matchedContact
      ? matchedContact.name
      : customContactName.trim() || undefined;

    const parsedDuration =
      durationMinutes.trim() !== '' ? Number(durationMinutes) : undefined;

    const nowIso = new Date().toISOString();
    const interactionId =
      initialInteraction?.id ||
      `ix_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const baseRecord: CommunicationInteraction = sanitizeInteractionForSave({
      id: interactionId,
      userId: initialInteraction?.userId,
      clientId,
      contactId: matchedContact ? matchedContact.id : undefined,
      contactName: resolvedContactName,
      opportunityId: opportunityId || undefined,
      channel,
      direction,
      occurredAt: occurredAtIso,
      durationMinutes:
        parsedDuration !== undefined && Number.isFinite(parsedDuration) && parsedDuration >= 0
          ? parsedDuration
          : undefined,
      subject: subject.trim() || undefined,
      summary: summary.trim(),
      topics: topics.length > 0 ? topics : undefined,
      outcome,
      nextStep: nextStep.trim() || undefined,
      nextFollowUpDate: nextFollowUpDate.trim() || undefined,
      followUpTaskId: existingLinkedTask?.id || initialInteraction?.followUpTaskId,
      createdAt: initialInteraction?.createdAt || nowIso,
      updatedAt: nowIso,
    });

    if (! existingLinkedTask && createFollowUpTask) {
      const converted = convertInteractionNextStepToTaskDraft({
        interaction: baseRecord,
        client: selectedClient,
        existingTasks: tasks,
        nowIso,
      });
      onSaveInteraction(converted.updatedInteraction, converted.taskDraft);
    } else {
      onSaveInteraction(baseRecord);
    }

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={initialInteraction ? 'تعديل سجل التواصل' : 'تسجيل تواصل جديد'}
      data-testid="interaction-form-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-900 text-white flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-sm sm:text-base text-stone-900">
                {initialInteraction ? 'تعديل سجل التواصل' : 'تسجيل تواصل جديد'}
              </h2>
              <p className="text-[11px] text-stone-500">
                توثيق المكالمات والرسائل والزيارات ونتائجها والخطوة التالية مع العميل
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-interaction-modal-btn"
            className="p-1.5 rounded-xl text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {errorAr && (
            <div
              data-testid="interaction-form-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2 text-xs font-medium"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorAr}</span>
            </div>
          )}

          {/* Channel Selection Pills */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1.5">
              وسيلة التواصل <span className="text-rose-600">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {COMMUNICATION_CHANNEL_ORDER.map((ch) => {
                const meta = COMMUNICATION_CHANNEL_META[ch];
                const Icon = CHANNEL_ICON_MAP[ch];
                const isSelected = channel === ch;
                return (
                  <button
                    key={ch}
                    type="button"
                    data-testid={`interaction-channel-${ch}`}
                    onClick={() => setChannel(ch)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-right transition-all font-semibold ${
                      isSelected
                        ? 'bg-emerald-900 text-white border-emerald-900 shadow-2xs'
                        : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{meta.shortLabelAr}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Client & Direction Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="interaction-client-select"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                العميل <span className="text-rose-600">*</span>
              </label>
              <select
                id="interaction-client-select"
                data-testid="interaction-client-select"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
              >
                <option value="">— اختر العميل —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.company ? `(${c.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1">
                اتجاه التواصل
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['outbound', 'inbound'] as CommunicationDirection[]).map((dir) => {
                  const meta = COMMUNICATION_DIRECTION_META[dir];
                  const isSelected = direction === dir;
                  return (
                    <button
                      key={dir}
                      type="button"
                      data-testid={`interaction-direction-${dir}`}
                      onClick={() => setDirection(dir)}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        isSelected
                          ? 'bg-stone-900 text-white border-stone-900'
                          : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {dir === 'outbound' ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      )}
                      <span>{meta.labelAr}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Contact Person & Opportunity Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="interaction-contact-select"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                جهة الاتصال التي تم التحدث معها
              </label>
              {clientContacts.length > 0 ? (
                <div className="space-y-1.5">
                  <select
                    id="interaction-contact-select"
                    data-testid="interaction-contact-select"
                    value={contactId}
                    onChange={(e) => {
                      setContactId(e.target.value);
                      if (e.target.value) setCustomContactName('');
                    }}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                  >
                    <option value="">— تواصل عام مع العميل / اسم آخر —</option>
                    {clientContacts.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name} {ct.role ? `— ${ct.role}` : ''}
                      </option>
                    ))}
                  </select>
                  {!contactId && (
                    <input
                      type="text"
                      data-testid="interaction-custom-contact-input"
                      value={customContactName}
                      onChange={(e) => setCustomContactName(e.target.value)}
                      placeholder="أو اكتب اسم الشخص الذي تحدثت معه (اختياري)..."
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-800"
                    />
                  )}
                </div>
              ) : (
                <input
                  id="interaction-contact-select"
                  type="text"
                  data-testid="interaction-custom-contact-input"
                  value={customContactName}
                  onChange={(e) => setCustomContactName(e.target.value)}
                  placeholder="اسم الشخص الذي تحدثت معه لدى العميل (اختياري)..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              )}
            </div>

            <div>
              <label
                htmlFor="interaction-opportunity-select"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                فرصة العمل المرتبطة (اختياري)
              </label>
              <div className="relative">
                <select
                  id="interaction-opportunity-select"
                  data-testid="interaction-opportunity-select"
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  disabled={clientOpportunities.length === 0}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700 disabled:opacity-60"
                >
                  <option value="">
                    {clientOpportunities.length === 0
                      ? 'لا توجد فرص مسجلة لهذا العميل'
                      : '— بدون ربط بفرصة محددة —'}
                  </option>
                  {clientOpportunities.map((opp) => (
                    <option key={opp.id} value={opp.id}>
                      {opp.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Date/Time & Duration Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="interaction-occurred-at"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                تاريخ ووقت التواصل <span className="text-rose-600">*</span>
              </label>
              <div className="relative flex items-center">
                <Calendar className="w-3.5 h-3.5 text-stone-400 absolute start-3 pointer-events-none" />
                <input
                  id="interaction-occurred-at"
                  data-testid="interaction-occurred-at"
                  type="datetime-local"
                  value={occurredAtLocal}
                  onChange={(e) => setOccurredAtLocal(e.target.value)}
                  required
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl ps-8 pe-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="interaction-duration"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                مدة المكالمة / اللقاء (بالدقائق - اختياري)
              </label>
              <div className="relative flex items-center">
                <Clock className="w-3.5 h-3.5 text-stone-400 absolute start-3 pointer-events-none" />
                <input
                  id="interaction-duration"
                  data-testid="interaction-duration-input"
                  type="number"
                  min={0}
                  max={1440}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="مثال: 15"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl ps-8 pe-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              </div>
            </div>
          </div>

          {/* Outcome Selection */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1.5">
              نتيجة التواصل <span className="text-rose-600">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMUNICATION_OUTCOME_ORDER.map((out) => {
                const meta = COMMUNICATION_OUTCOME_META[out];
                const isSelected = outcome === out;
                return (
                  <button
                    key={out}
                    type="button"
                    data-testid={`interaction-outcome-${out}`}
                    onClick={() => setOutcome(out)}
                    className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      isSelected
                        ? 'bg-emerald-800 text-white border-emerald-800 shadow-2xs'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {meta.labelAr}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject & Summary */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor="interaction-subject"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                عنوان التواصل / الموضوع الرئيسي (اختياري)
              </label>
              <input
                id="interaction-subject"
                data-testid="interaction-subject-input"
                type="text"
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="مثال: مناقشة بنود العرض الفني والجدول الزمني للتنفيذ"
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
              />
            </div>

            <div>
              <label
                htmlFor="interaction-summary"
                className="block text-xs font-bold text-stone-800 mb-1"
              >
                ملخص التواصل وأهم ما دار فيه <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="interaction-summary"
                data-testid="interaction-summary-input"
                rows={3}
                maxLength={4000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                placeholder="وثّق باختصار ما تم نقاشه، موقف العميل، أو الملاحظات المهمة للرجوع إليها لاحقاً..."
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700 leading-relaxed"
              />
            </div>
          </div>

          {/* Discussion Topics Tags */}
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
            <label className="block text-xs font-bold text-stone-800">
              الموضوعات التي نوقشت (كلمات مفتاحية للتذكر والبحث)
            </label>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Tag className="w-3.5 h-3.5 text-stone-400 absolute start-2.5 top-2 pointer-events-none" />
                <input
                  type="text"
                  data-testid="interaction-topic-input"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTopic(topicInput);
                    }
                  }}
                  placeholder="أضف موضوعاً ثم اضغط Enter أو زر الإضافة..."
                  className="w-full bg-white border border-stone-300 rounded-lg ps-8 pe-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              </div>
              <button
                type="button"
                data-testid="interaction-add-topic-btn"
                onClick={() => handleAddTopic(topicInput)}
                className="px-3 py-1.5 rounded-lg bg-stone-800 text-white text-xs font-semibold hover:bg-stone-900 inline-flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة</span>
              </button>
            </div>

            {/* Quick topic suggestions */}
            <div className="flex items-center flex-wrap gap-1 pt-0.5">
              <span className="text-[10px] text-stone-500 me-1">مقترحات سريعة:</span>
              {SUGGESTED_TOPICS_AR.map((sug) => {
                const isAdded = topics.includes(sug);
                return (
                  <button
                    key={sug}
                    type="button"
                    onClick={() =>
                      isAdded ? handleRemoveTopic(sug) : handleAddTopic(sug)
                    }
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                      isAdded
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-900 font-semibold'
                        : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    + {sug}
                  </button>
                );
              })}
            </div>

            {topics.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                {topics.map((tp) => (
                  <span
                    key={tp}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold"
                  >
                    <Tag className="w-3 h-3 text-emerald-700" />
                    <span>{tp}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(tp)}
                      className="text-emerald-700 hover:text-rose-700"
                      aria-label={`إزالة ${tp}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Next Step & Follow-up Date + Task Creation */}
          <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                <CheckSquare className="w-4 h-4 text-amber-700" />
                <span>الخطوة التالية والمتابعة المطلوبة</span>
              </h3>
              <span className="text-[10px] text-stone-500">
                تظهر تلقائياً في التنبيهات والتقويم
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label
                  htmlFor="interaction-next-step"
                  className="block text-[11px] font-bold text-stone-700 mb-1"
                >
                  الإجراء القادم / الخطوة التالية
                </label>
                <input
                  id="interaction-next-step"
                  data-testid="interaction-next-step-input"
                  type="text"
                  maxLength={500}
                  value={nextStep}
                  onChange={(e) => setNextStep(e.target.value)}
                  placeholder="مثال: إرسال المسودة المحدّثة للعرض المالي والاتصال للتأكيد"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              </div>

              <div>
                <label
                  htmlFor="interaction-followup-date"
                  className="block text-[11px] font-bold text-stone-700 mb-1"
                >
                  تاريخ المتابعة القادمة
                </label>
                <input
                  id="interaction-followup-date"
                  data-testid="interaction-followup-date-input"
                  type="date"
                  value={nextFollowUpDate}
                  onChange={(e) => setNextFollowUpDate(e.target.value)}
                  className="w-full bg-white border border-stone-300 rounded-xl px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:border-emerald-700"
                />
              </div>
            </div>

            {existingLinkedTask ? (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2 text-[11px]">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  مرتبط بمهمة متابعة قائمة: <strong>{existingLinkedTask.title}</strong>
                </span>
              </div>
            ) : (
              <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="interaction-create-task-checkbox"
                  checked={createFollowUpTask}
                  onChange={(e) => setCreateFollowUpTask(e.target.checked)}
                  className="rounded border-stone-300 text-emerald-800 focus:ring-emerald-700 w-4 h-4"
                />
                <span className="text-xs font-semibold text-stone-800">
                  إنشاء مهمة متابعة مرتبطة بهذا التواصل تلقائياً في قائمة المهام
                </span>
              </label>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 border-t border-stone-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 font-semibold text-xs hover:bg-stone-100 transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              data-testid="save-interaction-submit-btn"
              className="px-5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{initialInteraction ? 'حفظ التعديلات' : 'حفظ سجل التواصل'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
