import {
  ActionItem,
  Client,
  Meeting,
  Opportunity,
  OpportunityCurrency,
  OpportunityStage,
  OpportunityStageEvent,
  OpportunityStageEventType,
  OpportunityType,
  TaskPriority,
} from '../types';
import {
  calendarDaysDiff,
  extractZonedCalendarParts,
  parseDateOnlyString,
  resolveCalendarParts,
} from './followUpEngine';

// =========================================================================
// Stage, Type, and Currency Configuration
// =========================================================================

export const OPPORTUNITY_OPEN_STAGES: OpportunityStage[] = [
  'new',
  'qualification',
  'proposal',
  'negotiation',
];

export const OPPORTUNITY_CLOSED_STAGES: OpportunityStage[] = ['won', 'lost'];

export const OPPORTUNITY_ALL_STAGES: OpportunityStage[] = [
  ...OPPORTUNITY_OPEN_STAGES,
  ...OPPORTUNITY_CLOSED_STAGES,
];

export const OPPORTUNITY_STAGE_CONFIG: Record<
  OpportunityStage,
  {
    key: OpportunityStage;
    order: number;
    isClosed: boolean;
    labelAr: string;
    labelEn: string;
    badgeClass: string;
    columnAccentClass: string;
  }
> = {
  new: {
    key: 'new',
    order: 1,
    isClosed: false,
    labelAr: 'فرصة جديدة',
    labelEn: 'New Opportunity',
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-300',
    columnAccentClass: 'border-t-stone-500',
  },
  qualification: {
    key: 'qualification',
    order: 2,
    isClosed: false,
    labelAr: 'قيد الدراسة',
    labelEn: 'Qualification',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    columnAccentClass: 'border-t-sky-600',
  },
  proposal: {
    key: 'proposal',
    order: 3,
    isClosed: false,
    labelAr: 'إعداد / تقديم عرض',
    labelEn: 'Proposal',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
    columnAccentClass: 'border-t-amber-600',
  },
  negotiation: {
    key: 'negotiation',
    order: 4,
    isClosed: false,
    labelAr: 'تفاوض / مراجعة',
    labelEn: 'Negotiation',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    columnAccentClass: 'border-t-indigo-600',
  },
  won: {
    key: 'won',
    order: 5,
    isClosed: true,
    labelAr: 'ناجحة',
    labelEn: 'Won',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    columnAccentClass: 'border-t-emerald-700',
  },
  lost: {
    key: 'lost',
    order: 6,
    isClosed: true,
    labelAr: 'غير ناجحة',
    labelEn: 'Lost',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    columnAccentClass: 'border-t-rose-600',
  },
};

export const OPPORTUNITY_TYPE_LABELS: Record<
  OpportunityType,
  { ar: string; en: string }
> = {
  service: { ar: 'خدمة / تنفيذ', en: 'Service' },
  consulting: { ar: 'استشارات', en: 'Consulting' },
  retainer: { ar: 'عقد شهري / اشتراك', en: 'Retainer' },
  partnership: { ar: 'شراكة / تعاون', en: 'Partnership' },
  project: { ar: 'مشروع محدد', en: 'Project' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const OPPORTUNITY_CURRENCY_CONFIG: Record<
  OpportunityCurrency,
  { code: OpportunityCurrency; decimals: number; labelAr: string; labelEn: string }
> = {
  JOD: { code: 'JOD', decimals: 3, labelAr: 'د.أ (JOD)', labelEn: 'JOD' },
  SAR: { code: 'SAR', decimals: 2, labelAr: 'ر.س (SAR)', labelEn: 'SAR' },
  USD: { code: 'USD', decimals: 2, labelAr: 'دولار (USD)', labelEn: 'USD' },
  EUR: { code: 'EUR', decimals: 2, labelAr: 'يورو (EUR)', labelEn: 'EUR' },
  AED: { code: 'AED', decimals: 2, labelAr: 'د.إ (AED)', labelEn: 'AED' },
  EGP: { code: 'EGP', decimals: 2, labelAr: 'ج.م (EGP)', labelEn: 'EGP' },
};

export const OPPORTUNITY_VALID_CURRENCIES = Object.keys(
  OPPORTUNITY_CURRENCY_CONFIG
) as OpportunityCurrency[];

export const OPPORTUNITY_VALID_TYPES = Object.keys(
  OPPORTUNITY_TYPE_LABELS
) as OpportunityType[];

export const OPPORTUNITY_STALE_DAYS_THRESHOLD = 14;
export const OPPORTUNITY_CLOSING_SOON_DAYS = 7;
export const MAX_OPPORTUNITY_VALUE = 1_000_000_000;

export function isOpportunityClosed(stage: OpportunityStage): boolean {
  return stage === 'won' || stage === 'lost';
}

export function isValidOpportunityStage(val: unknown): val is OpportunityStage {
  return typeof val === 'string' && OPPORTUNITY_ALL_STAGES.includes(val as OpportunityStage);
}

export function isValidOpportunityType(val: unknown): val is OpportunityType {
  return typeof val === 'string' && OPPORTUNITY_VALID_TYPES.includes(val as OpportunityType);
}

export function isValidOpportunityCurrency(val: unknown): val is OpportunityCurrency {
  return (
    typeof val === 'string' &&
    OPPORTUNITY_VALID_CURRENCIES.includes(val as OpportunityCurrency)
  );
}

// =========================================================================
// Exact Minor-Unit Money Math (Never mixes currencies or uses FX)
// =========================================================================

export function getCurrencyDecimals(currency: OpportunityCurrency): number {
  return OPPORTUNITY_CURRENCY_CONFIG[currency]?.decimals ?? 2;
}

export function toMinorUnits(amount: number, currency: OpportunityCurrency): number {
  const decimals = getCurrencyDecimals(currency);
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor);
}

export function fromMinorUnits(minorUnits: number, currency: OpportunityCurrency): number {
  const decimals = getCurrencyDecimals(currency);
  const factor = Math.pow(10, decimals);
  return Number((minorUnits / factor).toFixed(decimals));
}

export function formatOpportunityMoney(
  amount: number,
  currency: OpportunityCurrency
): string {
  const decimals = getCurrencyDecimals(currency);
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${currency}`;
}

export interface CurrencyTotalEntry {
  currency: OpportunityCurrency;
  minorUnits: number;
  totalAmount: number;
  formatted: string;
  count: number;
}

/**
 * Aggregates values strictly grouped per currency in minor units.
 * Never converts or sums across different currencies.
 */
export function aggregateValuesByCurrency(
  items: Opportunity[]
): CurrencyTotalEntry[] {
  const map = new Map<OpportunityCurrency, { minorUnits: number; count: number }>();

  for (const item of items) {
    if (
      typeof item.estimatedValue !== 'number' ||
      !Number.isFinite(item.estimatedValue) ||
      !item.currency ||
      !isValidOpportunityCurrency(item.currency)
    ) {
      continue;
    }
    const curr = item.currency;
    const prev = map.get(curr) || { minorUnits: 0, count: 0 };
    map.set(curr, {
      minorUnits: prev.minorUnits + toMinorUnits(item.estimatedValue, curr),
      count: prev.count + 1,
    });
  }

  return Array.from(map.entries())
    .map(([currency, agg]) => {
      const totalAmount = fromMinorUnits(agg.minorUnits, currency);
      return {
        currency,
        minorUnits: agg.minorUnits,
        totalAmount,
        formatted: formatOpportunityMoney(totalAmount, currency),
        count: agg.count,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

// =========================================================================
// ID Generation, Validation & Sanitization
// =========================================================================

export function generateDeterministicOpportunityId(nowMs: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `opp-${nowMs}-${rand}`;
}

export interface OpportunityValidationResult {
  valid: boolean;
  errorsArabic: string[];
}

export function validateOpportunityInput(
  input: Partial<Opportunity>
): OpportunityValidationResult {
  const errors: string[] = [];

  if (!input.clientId || !input.clientId.trim()) {
    errors.push('يجب اختيار العميل المرتبط بالفرصة.');
  }

  const title = (input.title || '').trim();
  if (!title) {
    errors.push('يرجى إدخال عنوان الفرصة.');
  } else if (title.length > 200) {
    errors.push('عنوان الفرصة يجب ألا يتجاوز 200 حرف.');
  }

  if (input.stage !== undefined && !isValidOpportunityStage(input.stage)) {
    errors.push('مرحلة الفرصة المختارة غير صالحة.');
  }

  if (input.type !== undefined && !isValidOpportunityType(input.type)) {
    errors.push('نوع الفرصة المختار غير صالح.');
  }

  if (input.estimatedValue !== undefined && input.estimatedValue !== null) {
    if (typeof input.estimatedValue !== 'number' || !Number.isFinite(input.estimatedValue)) {
      errors.push('القيمة التقديرية يجب أن تكون رقماً صحيحاً.');
    } else if (input.estimatedValue < 0) {
      errors.push('القيمة التقديرية لا يمكن أن تكون سالبة.');
    } else if (input.estimatedValue > MAX_OPPORTUNITY_VALUE) {
      errors.push('القيمة التقديرية تتجاوز الحد المسموح به.');
    } else if (!input.currency || !isValidOpportunityCurrency(input.currency)) {
      errors.push('يجب تحديد العملة عند إدخال قيمة تقديرية.');
    }
  }

  if (input.currency !== undefined && input.currency !== null && input.currency !== ('' as any)) {
    if (!isValidOpportunityCurrency(input.currency)) {
      errors.push('رمز العملة غير مدعوم.');
    }
  }

  if (input.expectedCloseDate && !parseDateOnlyString(input.expectedCloseDate)) {
    errors.push('تاريخ الإغلاق المتوقع يجب أن يكون بصيغة YYYY-MM-DD صحيحة.');
  }

  if (input.nextActionDate && !parseDateOnlyString(input.nextActionDate)) {
    errors.push('تاريخ الخطوة التالية يجب أن يكون بصيغة YYYY-MM-DD صحيحة.');
  }

  return {
    valid: errors.length === 0,
    errorsArabic: errors,
  };
}

/**
 * Sanitizes an Opportunity payload to match Firestore security rules:
 * - No undefined fields
 * - Strict field length bounds
 * - Currency rounded to its exact decimals
 * - Preserves closedAt / reopenedAt / lostReason cleanly
 */
export function sanitizeOpportunityForSave(
  opp: Partial<Opportunity> & { id: string; clientId: string }
): Opportunity {
  const now = new Date().toISOString();
  const stage: OpportunityStage = isValidOpportunityStage(opp.stage) ? opp.stage : 'new';
  const type: OpportunityType = isValidOpportunityType(opp.type) ? opp.type : 'service';
  const priority: TaskPriority =
    opp.priority === 'urgent' ||
    opp.priority === 'high' ||
    opp.priority === 'medium' ||
    opp.priority === 'low'
      ? opp.priority
      : 'medium';

  const sanitized: Opportunity = {
    id: opp.id.trim().slice(0, 128),
    clientId: opp.clientId.trim().slice(0, 128),
    title: (opp.title || 'فرصة بدون عنوان').trim().slice(0, 200),
    type,
    stage,
    priority,
    createdAt: (opp.createdAt || now).slice(0, 50),
    updatedAt: (opp.updatedAt || now).slice(0, 50),
  };

  if (opp.userId) sanitized.userId = opp.userId.slice(0, 128);
  if (opp.description && opp.description.trim()) {
    sanitized.description = opp.description.trim().slice(0, 3000);
  }

  const validCurrency = isValidOpportunityCurrency(opp.currency) ? opp.currency : undefined;
  if (
    typeof opp.estimatedValue === 'number' &&
    Number.isFinite(opp.estimatedValue) &&
    opp.estimatedValue >= 0 &&
    opp.estimatedValue <= MAX_OPPORTUNITY_VALUE &&
    validCurrency
  ) {
    const decimals = getCurrencyDecimals(validCurrency);
    sanitized.estimatedValue = Number(opp.estimatedValue.toFixed(decimals));
    sanitized.currency = validCurrency;
  } else if (validCurrency) {
    sanitized.currency = validCurrency;
  }

  if (opp.expectedCloseDate && parseDateOnlyString(opp.expectedCloseDate)) {
    sanitized.expectedCloseDate = opp.expectedCloseDate.trim();
  }
  if (opp.nextAction && opp.nextAction.trim()) {
    sanitized.nextAction = opp.nextAction.trim().slice(0, 300);
  }
  if (opp.nextActionDate && parseDateOnlyString(opp.nextActionDate)) {
    sanitized.nextActionDate = opp.nextActionDate.trim();
  }
  if (opp.source && opp.source.trim()) {
    sanitized.source = opp.source.trim().slice(0, 150);
  }

  if (stage === 'lost' && opp.lostReason && opp.lostReason.trim()) {
    sanitized.lostReason = opp.lostReason.trim().slice(0, 500);
  }
  if (isOpportunityClosed(stage)) {
    sanitized.closedAt = (opp.closedAt || sanitized.updatedAt).slice(0, 50);
  }
  if (opp.reopenedAt && opp.reopenedAt.trim()) {
    sanitized.reopenedAt = opp.reopenedAt.trim().slice(0, 50);
  }

  return sanitized;
}

// =========================================================================
// Stage Transitions & Immutable Operational Event Log
// =========================================================================

export function createInitialOpportunityEvent(
  opportunity: Opportunity,
  note?: string
): OpportunityStageEvent {
  const occurredAt = opportunity.createdAt || new Date().toISOString();
  const event: OpportunityStageEvent = {
    id: `evt_init_${opportunity.id}`.slice(0, 128),
    opportunityId: opportunity.id,
    eventType:
      opportunity.stage === 'won'
        ? 'closed_won'
        : opportunity.stage === 'lost'
        ? 'closed_lost'
        : 'created',
    toStage: opportunity.stage,
    occurredAt: occurredAt.slice(0, 50),
  };
  if (opportunity.userId) event.userId = opportunity.userId;
  if (note && note.trim()) event.note = note.trim().slice(0, 500);
  return event;
}

export interface StageTransitionResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  confirmationKind?: 'close' | 'reopen';
  reasonArabic?: string;
  opportunity?: Opportunity;
  stageEvent?: OpportunityStageEvent;
}

/**
 * Transitions an opportunity stage safely:
 * - Enforces explicit confirmation for closing (won/lost) or reopening (closed -> open)
 * - Preserves closedAt on close, reopenedAt on reopen, and lostReason on lost
 * - Emits an append-only OpportunityStageEvent document (never overwrites concurrent arrays)
 */
export function buildOpportunityStageTransition(params: {
  opportunity: Opportunity;
  targetStage: OpportunityStage;
  confirmed?: boolean;
  lostReason?: string;
  note?: string;
  nowIso?: string;
}): StageTransitionResult {
  const { opportunity, targetStage, confirmed = false, lostReason, note, nowIso } = params;
  const fromStage = opportunity.stage;

  if (fromStage === targetStage) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reasonArabic: 'الفرصة موجودة بالفعل في هذه المرحلة.',
    };
  }

  const wasClosed = isOpportunityClosed(fromStage);
  const willClose = isOpportunityClosed(targetStage);

  if (willClose && !confirmed) {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationKind: 'close',
      reasonArabic:
        targetStage === 'won'
          ? 'يرجى تأكيد إغلاق الفرصة كفرصة ناجحة.'
          : 'يرجى تأكيد إغلاق الفرصة كغير ناجحة مع إمكانية تسجيل السبب.',
    };
  }

  if (wasClosed && !willClose && !confirmed) {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationKind: 'reopen',
      reasonArabic: 'هذه الفرصة مغلقة. يرجى تأكيد إعادة فتحها ونقلها لمرحلة نشطة.',
    };
  }

  const timestamp = (nowIso || new Date().toISOString()).slice(0, 50);
  const nextRaw: Opportunity = {
    ...opportunity,
    stage: targetStage,
    updatedAt: timestamp,
  };

  let eventType: OpportunityStageEventType = 'stage_changed';
  let eventNote = note?.trim() ? note.trim().slice(0, 500) : undefined;

  if (targetStage === 'won') {
    eventType = 'closed_won';
    nextRaw.closedAt = timestamp;
    nextRaw.lostReason = undefined;
  } else if (targetStage === 'lost') {
    eventType = 'closed_lost';
    nextRaw.closedAt = timestamp;
    if (lostReason && lostReason.trim()) {
      nextRaw.lostReason = lostReason.trim().slice(0, 500);
      if (!eventNote) eventNote = nextRaw.lostReason;
    }
  } else if (wasClosed && !willClose) {
    eventType = 'reopened';
    nextRaw.closedAt = undefined;
    nextRaw.reopenedAt = timestamp;
  }

  const nextOpp = sanitizeOpportunityForSave(nextRaw);
  const rand = Math.random().toString(36).slice(2, 7);
  const eventId = `evt_${Date.now()}_${rand}`.slice(0, 128);

  const stageEvent: OpportunityStageEvent = {
    id: eventId,
    opportunityId: nextOpp.id,
    eventType,
    fromStage,
    toStage: targetStage,
    occurredAt: timestamp,
  };
  if (nextOpp.userId) stageEvent.userId = nextOpp.userId;
  if (eventNote) stageEvent.note = eventNote;

  return {
    allowed: true,
    requiresConfirmation: false,
    opportunity: nextOpp,
    stageEvent,
  };
}

// =========================================================================
// Meeting & Task Linking (Same-Client Integrity, Unlink Preserves Record)
// =========================================================================

export function canLinkRecordToOpportunity(
  recordClientId: string,
  opportunity: Opportunity
): { ok: boolean; errorArabic?: string } {
  if (!recordClientId || recordClientId !== opportunity.clientId) {
    return {
      ok: false,
      errorArabic: 'لا يمكن ربط اجتماع أو مهمة لعميل مختلف عن العميل المرتبط بالفرصة.',
    };
  }
  return { ok: true };
}

export function linkMeetingToOpportunity(
  meeting: Meeting,
  opportunity: Opportunity
): { ok: boolean; meeting?: Meeting; errorArabic?: string } {
  const check = canLinkRecordToOpportunity(meeting.clientId, opportunity);
  if (!check.ok) return { ok: false, errorArabic: check.errorArabic };
  return {
    ok: true,
    meeting: {
      ...meeting,
      opportunityId: opportunity.id,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function unlinkMeetingFromOpportunity(meeting: Meeting): Meeting {
  const next = { ...meeting, updatedAt: new Date().toISOString() };
  delete next.opportunityId;
  return next;
}

export function linkTaskToOpportunity(
  task: ActionItem,
  opportunity: Opportunity
): { ok: boolean; task?: ActionItem; errorArabic?: string } {
  const check = canLinkRecordToOpportunity(task.clientId, opportunity);
  if (!check.ok) return { ok: false, errorArabic: check.errorArabic };
  return {
    ok: true,
    task: {
      ...task,
      opportunityId: opportunity.id,
    },
  };
}

export function unlinkTaskFromOpportunity(task: ActionItem): ActionItem {
  const next = { ...task };
  delete next.opportunityId;
  return next;
}

/**
 * Explicit user action to turn an opportunity's Next Action into a real Task draft.
 * Never invoked silently on opportunity save.
 */
export function convertNextActionToTaskDraft(
  opportunity: Opportunity,
  nowMs: number = Date.now()
): { ok: boolean; task?: ActionItem; errorArabic?: string } {
  const actionTitle = (opportunity.nextAction || '').trim();
  if (!actionTitle) {
    return {
      ok: false,
      errorArabic: 'أدخل وصف الخطوة التالية أولاً لتحويلها إلى مهمة.',
    };
  }
  const rand = Math.random().toString(36).slice(2, 6);
  const task: ActionItem = {
    id: `t-opp-${nowMs}-${rand}`,
    clientId: opportunity.clientId,
    opportunityId: opportunity.id,
    title: actionTitle.slice(0, 250),
    description: `مهمة ناتجة عن الخطوة التالية للفرصة: ${opportunity.title}`.slice(0, 2000),
    dueDate:
      opportunity.nextActionDate && parseDateOnlyString(opportunity.nextActionDate)
        ? opportunity.nextActionDate
        : undefined,
    priority: opportunity.priority || 'medium',
    status: 'pending',
    provenance: 'approved',
    createdAt: new Date(nowMs).toISOString(),
  };
  if (opportunity.userId) task.userId = opportunity.userId;
  return { ok: true, task };
}

export interface LinkedMeetingDecisionItem {
  decisionId: string;
  text: string;
  ownerName?: string;
  createdAt: string;
  meetingId: string;
  meetingTitle: string;
  meetingDateTime: string;
}

export function extractRelatedDecisionsFromMeetings(
  meetings: Meeting[],
  opportunityId: string
): LinkedMeetingDecisionItem[] {
  const items: LinkedMeetingDecisionItem[] = [];
  for (const m of meetings) {
    if (m.opportunityId !== opportunityId) continue;
    for (const d of m.decisions || []) {
      items.push({
        decisionId: d.id,
        text: d.text,
        ownerName: d.ownerName,
        createdAt: d.createdAt || m.dateTime,
        meetingId: m.id,
        meetingTitle: m.title,
        meetingDateTime: m.dateTime,
      });
    }
  }
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// =========================================================================
// Deterministic Follow-Up Alerts (Zero Alerts on Closed Opportunities)
// =========================================================================

export type OpportunityAlertKind =
  | 'overdue_next_action'
  | 'missing_next_action'
  | 'closing_soon'
  | 'stale';

export interface OpportunityFollowUpAlert {
  kind: OpportunityAlertKind;
  severity: 'high' | 'medium' | 'info';
  messageArabic: string;
  messageEnglish: string;
  disclosureArabic?: string;
}

export function evaluateOpportunityFollowUpAlerts(params: {
  opportunity: Opportunity;
  referenceDate?: Date;
  timeZone?: string;
  staleThresholdDays?: number;
  closingSoonDays?: number;
}): OpportunityFollowUpAlert[] {
  const {
    opportunity,
    referenceDate = new Date(),
    timeZone,
    staleThresholdDays = OPPORTUNITY_STALE_DAYS_THRESHOLD,
    closingSoonDays = OPPORTUNITY_CLOSING_SOON_DAYS,
  } = params;

  if (isOpportunityClosed(opportunity.stage)) {
    return [];
  }

  const alerts: OpportunityFollowUpAlert[] = [];
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  // 1. Overdue nextActionDate
  if (opportunity.nextActionDate) {
    const nextParts = parseDateOnlyString(opportunity.nextActionDate);
    if (nextParts) {
      const diff = calendarDaysDiff(nextParts, refParts);
      if (diff < 0) {
        const lateDays = Math.abs(diff);
        alerts.push({
          kind: 'overdue_next_action',
          severity: 'high',
          messageArabic:
            lateDays === 1
              ? 'الخطوة التالية متأخرة منذ يوم واحد'
              : `الخطوة التالية متأخرة منذ ${lateDays} أيام`,
          messageEnglish: `Next action overdue by ${lateDays} day(s)`,
        });
      }
    }
  }

  // 2. Open opportunity without nextAction
  if (!opportunity.nextAction || !opportunity.nextAction.trim()) {
    alerts.push({
      kind: 'missing_next_action',
      severity: 'medium',
      messageArabic: 'فرصة مفتوحة بدون تحديد خطوة تالية',
      messageEnglish: 'Open opportunity has no defined next action',
    });
  }

  // 3. Expected close date passed or within closingSoonDays (strictly non-binding)
  if (opportunity.expectedCloseDate) {
    const closeParts = parseDateOnlyString(opportunity.expectedCloseDate);
    if (closeParts) {
      const diff = calendarDaysDiff(closeParts, refParts);
      if (diff < 0) {
        alerts.push({
          kind: 'closing_soon',
          severity: 'high',
          messageArabic: `تجاوز تاريخ الإغلاق المتوقع منذ ${Math.abs(diff)} يوم`,
          messageEnglish: `Expected close date passed ${Math.abs(diff)} day(s) ago`,
          disclosureArabic: 'تاريخ تقديري مدخل يدوياً وليس التزاماً تعاقدياً.',
        });
      } else if (diff <= closingSoonDays) {
        alerts.push({
          kind: 'closing_soon',
          severity: 'medium',
          messageArabic:
            diff === 0
              ? 'تاريخ الإغلاق المتوقع اليوم'
              : `تاريخ الإغلاق المتوقع خلال ${diff} أيام`,
          messageEnglish:
            diff === 0 ? 'Expected close date is today' : `Expected close in ${diff} days`,
          disclosureArabic: 'تاريخ تقديري مدخل يدوياً وليس التزاماً تعاقدياً.',
        });
      }
    }
  }

  // 4. Stale open opportunity (no logged update in app >= staleThresholdDays)
  const updatedParts = resolveCalendarParts(
    opportunity.updatedAt || opportunity.createdAt,
    timeZone
  );
  if (updatedParts) {
    const ageDays = calendarDaysDiff(refParts, updatedParts);
    if (ageDays >= staleThresholdDays) {
      alerts.push({
        kind: 'stale',
        severity: 'medium',
        messageArabic: `لم يُسجّل تحديث على الفرصة في التطبيق منذ ${ageDays} يوماً`,
        messageEnglish: `No logged update in app for ${ageDays} days`,
        disclosureArabic: 'يعتمد فقط على التحديثات المسجلة داخل مُرافق.',
      });
    }
  }

  return alerts;
}

export function isOpportunityNeedsFollowUp(
  opportunity: Opportunity,
  referenceDate: Date = new Date(),
  timeZone?: string
): boolean {
  return (
    evaluateOpportunityFollowUpAlerts({
      opportunity,
      referenceDate,
      timeZone,
    }).length > 0
  );
}

// =========================================================================
// Filtering, Sorting, Kanban Grouping & Pipeline Summaries
// =========================================================================

export type OpportunitySortBy =
  | 'updated_desc'
  | 'next_action_asc'
  | 'expected_close_asc'
  | 'value_desc'
  | 'priority_desc';

export interface OpportunityFilterOptions {
  searchQuery?: string;
  stage?: OpportunityStage | 'all';
  clientId?: string | 'all';
  type?: OpportunityType | 'all';
  priority?: TaskPriority | 'all';
  statusGroup?: 'all' | 'open' | 'closed';
  overdueOnly?: boolean;
  needsFollowUpOnly?: boolean;
  sortBy?: OpportunitySortBy;
  referenceDate?: Date;
  timeZone?: string;
  clients?: Client[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function filterAndSortOpportunities(
  opportunities: Opportunity[],
  options: OpportunityFilterOptions = {}
): Opportunity[] {
  const {
    searchQuery = '',
    stage = 'all',
    clientId = 'all',
    type = 'all',
    priority = 'all',
    statusGroup = 'all',
    overdueOnly = false,
    needsFollowUpOnly = false,
    sortBy = 'updated_desc',
    referenceDate = new Date(),
    timeZone,
    clients = [],
  } = options;

  const q = searchQuery.trim().toLowerCase();
  const clientNameMap = new Map(clients.map((c) => [c.id, c.name.toLowerCase()]));
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  const filtered = opportunities.filter((opp) => {
    if (stage !== 'all' && opp.stage !== stage) return false;
    if (clientId !== 'all' && opp.clientId !== clientId) return false;
    if (type !== 'all' && opp.type !== type) return false;
    if (priority !== 'all' && opp.priority !== priority) return false;

    const closed = isOpportunityClosed(opp.stage);
    if (statusGroup === 'open' && closed) return false;
    if (statusGroup === 'closed' && !closed) return false;

    if (overdueOnly) {
      if (closed) return false;
      const nextParts = parseDateOnlyString(opp.nextActionDate);
      if (!nextParts || calendarDaysDiff(nextParts, refParts) >= 0) return false;
    }

    if (needsFollowUpOnly) {
      if (!isOpportunityNeedsFollowUp(opp, referenceDate, timeZone)) return false;
    }

    if (q) {
      const clientName = clientNameMap.get(opp.clientId) || '';
      const matches =
        opp.title.toLowerCase().includes(q) ||
        (opp.description && opp.description.toLowerCase().includes(q)) ||
        (opp.nextAction && opp.nextAction.toLowerCase().includes(q)) ||
        (opp.source && opp.source.toLowerCase().includes(q)) ||
        clientName.includes(q);
      if (!matches) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    if (sortBy === 'priority_desc') {
      const diff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (diff !== 0) return diff;
    } else if (sortBy === 'next_action_asc') {
      if (a.nextActionDate && b.nextActionDate) {
        const diff = a.nextActionDate.localeCompare(b.nextActionDate);
        if (diff !== 0) return diff;
      } else if (a.nextActionDate) return -1;
      else if (b.nextActionDate) return 1;
    } else if (sortBy === 'expected_close_asc') {
      if (a.expectedCloseDate && b.expectedCloseDate) {
        const diff = a.expectedCloseDate.localeCompare(b.expectedCloseDate);
        if (diff !== 0) return diff;
      } else if (a.expectedCloseDate) return -1;
      else if (b.expectedCloseDate) return 1;
    } else if (sortBy === 'value_desc') {
      const va = typeof a.estimatedValue === 'number' ? a.estimatedValue : -1;
      const vb = typeof b.estimatedValue === 'number' ? b.estimatedValue : -1;
      if (vb !== va) return vb - va;
    }
    return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  });
}

export function groupOpportunitiesByStage(
  opportunities: Opportunity[]
): Record<OpportunityStage, Opportunity[]> {
  const grouped: Record<OpportunityStage, Opportunity[]> = {
    new: [],
    qualification: [],
    proposal: [],
    negotiation: [],
    won: [],
    lost: [],
  };
  for (const opp of opportunities) {
    const stage: OpportunityStage = isValidOpportunityStage(opp.stage) ? opp.stage : 'new';
    grouped[stage].push(opp);
  }
  return grouped;
}

export interface OpportunityPipelineMetrics {
  totalCount: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
  wonInPeriodCount: number;
  lostInPeriodCount: number;
  overdueFollowUpCount: number;
  needsFollowUpCount: number;
  recentlyUpdatedCount: number;
  stageBreakdown: Array<{
    stage: OpportunityStage;
    labelAr: string;
    labelEn: string;
    count: number;
  }>;
  openTotalsByCurrency: CurrencyTotalEntry[];
  wonTotalsByCurrency: CurrencyTotalEntry[];
}

export function computeOpportunityPipelineMetrics(
  opportunities: Opportunity[],
  referenceDate: Date = new Date(),
  timeZone?: string,
  recentDays: number = 30
): OpportunityPipelineMetrics {
  const refParts = extractZonedCalendarParts(referenceDate, timeZone);

  const openOpps = opportunities.filter((o) => !isOpportunityClosed(o.stage));
  const wonOpps = opportunities.filter((o) => o.stage === 'won');
  const lostOpps = opportunities.filter((o) => o.stage === 'lost');

  const wonInPeriodCount = wonOpps.filter((o) => {
    const p = resolveCalendarParts(o.closedAt || o.updatedAt, timeZone);
    return p !== null && calendarDaysDiff(refParts, p) >= 0 && calendarDaysDiff(refParts, p) <= recentDays;
  }).length;

  const lostInPeriodCount = lostOpps.filter((o) => {
    const p = resolveCalendarParts(o.closedAt || o.updatedAt, timeZone);
    return p !== null && calendarDaysDiff(refParts, p) >= 0 && calendarDaysDiff(refParts, p) <= recentDays;
  }).length;

  const overdueFollowUpCount = openOpps.filter((o) => {
    const nextParts = parseDateOnlyString(o.nextActionDate);
    return nextParts !== null && calendarDaysDiff(nextParts, refParts) < 0;
  }).length;

  const needsFollowUpCount = openOpps.filter((o) =>
    isOpportunityNeedsFollowUp(o, referenceDate, timeZone)
  ).length;

  const recentlyUpdatedCount = opportunities.filter((o) => {
    const p = resolveCalendarParts(o.updatedAt || o.createdAt, timeZone);
    return p !== null && calendarDaysDiff(refParts, p) >= 0 && calendarDaysDiff(refParts, p) <= 7;
  }).length;

  const grouped = groupOpportunitiesByStage(opportunities);
  const stageBreakdown = OPPORTUNITY_ALL_STAGES.map((stage) => ({
    stage,
    labelAr: OPPORTUNITY_STAGE_CONFIG[stage].labelAr,
    labelEn: OPPORTUNITY_STAGE_CONFIG[stage].labelEn,
    count: grouped[stage].length,
  }));

  return {
    totalCount: opportunities.length,
    openCount: openOpps.length,
    wonCount: wonOpps.length,
    lostCount: lostOpps.length,
    wonInPeriodCount,
    lostInPeriodCount,
    overdueFollowUpCount,
    needsFollowUpCount,
    recentlyUpdatedCount,
    stageBreakdown,
    openTotalsByCurrency: aggregateValuesByCurrency(openOpps),
    wonTotalsByCurrency: aggregateValuesByCurrency(wonOpps),
  };
}

export interface ClientOpportunitySummary {
  total: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
  needsFollowUpCount: number;
  latestOpportunity: Opportunity | null;
  openTotalsByCurrency: CurrencyTotalEntry[];
  wonTotalsByCurrency: CurrencyTotalEntry[];
}

export function computeClientOpportunitySummary(
  opportunities: Opportunity[],
  clientId: string,
  referenceDate: Date = new Date(),
  timeZone?: string
): ClientOpportunitySummary {
  const clientOpps = opportunities
    .filter((o) => o.clientId === clientId)
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

  const openOpps = clientOpps.filter((o) => !isOpportunityClosed(o.stage));
  const wonOpps = clientOpps.filter((o) => o.stage === 'won');
  const lostOpps = clientOpps.filter((o) => o.stage === 'lost');
  const needsFollowUpCount = openOpps.filter((o) =>
    isOpportunityNeedsFollowUp(o, referenceDate, timeZone)
  ).length;

  return {
    total: clientOpps.length,
    openCount: openOpps.length,
    wonCount: wonOpps.length,
    lostCount: lostOpps.length,
    needsFollowUpCount,
    latestOpportunity: clientOpps[0] || null,
    openTotalsByCurrency: aggregateValuesByCurrency(openOpps),
    wonTotalsByCurrency: aggregateValuesByCurrency(wonOpps),
  };
}
