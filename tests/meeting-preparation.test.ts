import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiRouter, type AiRouterDeps } from '../src/server/aiRouter.ts';
import {
  DEFAULT_GEMINI_MEETING_MODEL,
  buildMeetingBriefingUserPrompt,
  generateMeetingBriefingWithGemini,
} from '../src/server/geminiMeetingAssistant.ts';
import {
  DEFAULT_AI_BRIEFING_SECTION_SELECTION,
  MAX_AI_BRIEFING_INPUT_CHARS,
  addPreparationGoal,
  approveAiSuggestedGoalToPreparation,
  approveAiTalkingPointToAgenda,
  approveSuggestedTopicIntoAgenda,
  buildMeetingAiBriefingInputBundle,
  buildMeetingPreparationBrief,
  dismissSuggestedTopicInMeeting,
  formatPreparationBriefPlainText,
  isAttemptInteraction,
  isConfirmedInteraction,
  removePreparationGoal,
  reorderPreparationGoals,
  sanitizeIncomingAiBriefingPayload,
  updatePreparationGoal,
  updatePreparationNotes,
  validateAndNormalizeMeetingBriefingAi,
} from '../src/utils/meetingPreparation.ts';
import { isMinutesLocked, sanitizeMeetingForSave } from '../src/utils/meetingMinutes.ts';
import { requestMeetingAiBriefingWithDeps } from '../src/services/meetingAi.ts';
import type {
  ActionItem,
  Client,
  CommunicationInteraction,
  Meeting,
  MeetingAiBriefingResult,
  Note,
  Opportunity,
  OpportunityStageEvent,
} from '../src/types/index.ts';

const USER_A = 'user_alice_prep_001';
const USER_B = 'user_bob_prep_002';
const CLIENT_A = 'client_acme_001';
const CLIENT_B = 'client_other_002';
const MEETING_CURRENT = 'meet_prep_current_100';
const OPP_LINKED = 'opp_linked_100';
const OPP_OTHER_OPEN = 'opp_other_open_200';
const OPP_FOREIGN = 'opp_foreign_client_999';

const REF_DATE = new Date('2026-11-15T09:00:00.000Z');

function createSampleClient(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_A,
    userId: USER_A,
    name: 'ماجد السبيعي',
    company: 'شركة آفاق الحلول الرقمية',
    category: 'partner',
    relationshipStatus: 'active',
    importance: 'high',
    industry: 'التقنية المالية',
    phone: '+966501112233',
    email: 'majid@afaq-tech.sa',
    notes: 'عميل يهتم بالتقارير التنفيذية المختصرة.',
    contacts: [
      {
        id: 'cnt_1',
        name: 'سارة المنصور',
        title: 'مديرة العمليات',
        department: 'العمليات',
        phone: '+966509998877',
        email: 'sara@afaq-tech.sa',
        isPrimary: true,
      },
      {
        id: 'cnt_2',
        name: 'فهد الدوسري',
        title: 'المستشار القانوني',
        department: 'الشؤون القانونية',
        isPrimary: false,
      },
    ],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

function createSampleMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_CURRENT,
    userId: USER_A,
    clientId: CLIENT_A,
    opportunityId: OPP_LINKED,
    title: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
    dateTime: '2026-11-16T11:00:00.000Z',
    duration: 60,
    type: 'in_person',
    location: 'الرياض - برج المملكة',
    notes: 'التأكد من جاهزية العرض الفني النهائي قبل الاجتماع.',
    status: 'confirmed',
    photoPaths: [],
    participants: [
      { id: 'p_int', name: 'أنت', role: 'مدير الحساب', party: 'internal' },
      { id: 'p_ext', name: 'سارة المنصور', role: 'مديرة العمليات', party: 'external' },
    ],
    agendaItems: [
      {
        id: 'ag_existing_1',
        order: 1,
        title: 'استعراض بنود العرض الفني',
        durationMinutes: 20,
      },
    ],
    decisions: [],
    minutesStatus: 'draft',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  };
}

function createValidGeminiBriefingRawJson() {
  return {
    executiveBriefing:
      'العميل في مرحلة التفاوض على مشروع المنصة الرقمية مع وجود مهمة متأخرة لمراجعة الملحق المالي. الأولوية قبل الدخول هي حسم ملاحظات الملحق المالي وتأكيد خطة الإطلاق.',
    recommendedTalkingPoints: [
      {
        title: 'حسم الملحق المالي المتأخر',
        rationale: 'توجد مهمة متأخرة مرتبطة بمراجعة تسعير المرحلة الثانية.',
        basisType: 'documented_fact',
        sourceReferenceAr: 'مهمة متأخرة',
      },
      {
        title: 'مناقشة جاهزية فرق العميل للربط التقني',
        rationale: 'استنتاج من طبيعة المرحلة الحالية للفرصة.',
        basisType: 'inference',
      },
      {
        title: 'اقتراح جدولة ورشة عمل تعريفية بعد التوقيع',
        rationale: 'مقترح لتسريع انطلاق المشروع.',
        basisType: 'ai_suggestion',
      },
    ],
    suggestedQuestions: [
      'هل تم اعتماد الميزانية النهائية للمرحلة الثانية من الإدارة المالية؟',
    ],
    potentialRisks: [
      'تأخر التوقيع بسبب عدم إغلاق مهمة الملحق المالي.',
    ],
    expectedOutcomes: [
      {
        text: 'الموافقة النهائية على جدول الدفعات وتحديد تاريخ التوقيع',
        note: 'هدف مقترح للاجتماع القادم',
      },
    ],
    warnings: [],
  };
}

function createValidatedBriefingResult(): MeetingAiBriefingResult {
  const res = validateAndNormalizeMeetingBriefingAi(createValidGeminiBriefingRawJson(), {
    modelUsed: DEFAULT_GEMINI_MEETING_MODEL,
  });
  assert.equal(res.ok, true);
  return res.data;
}

async function startTestServer(router: express.Router): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: '128kb' }));
  app.use('/api/ai', router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeBriefingRouterWithStubs(
  overrides: {
    briefingFn?: AiRouterDeps['generateBriefing'];
    ownsFn?: AiRouterDeps['verifyMeetingOwnership'];
    rateLimitMaxRequests?: number;
  } = {}
) {
  return createAiRouter({
    verifyBearerToken: async (authHeader) => {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('UNAUTHENTICATED: missing bearer token');
      }
      const token = authHeader.slice('Bearer '.length).trim();
      if (token === 'token_alice') return { uid: USER_A, idToken: 'token_alice' };
      if (token === 'token_bob') return { uid: USER_B, idToken: 'token_bob' };
      throw new Error('UNAUTHENTICATED: invalid token');
    },
    verifyMeetingOwnership:
      overrides.ownsFn ??
      (async ({ uid, meetingId }) => uid === USER_A && meetingId === MEETING_CURRENT),
    generateBriefing:
      overrides.briefingFn ?? (async () => createValidatedBriefingResult()),
    rateLimitMaxRequests: overrides.rateLimitMaxRequests ?? 10,
  });
}

// ============================================================================
// SCENARIOS 1 - 10: DETERMINISTIC SMART PREPARATION & DATA AGGREGATION
// ============================================================================

test('1 & 2. Smart Preparation builds full brief for linked client, isolates user records, and surfaces client & contacts', () => {
  const clientA = createSampleClient();
  const foreignUserClient = createSampleClient({
    id: CLIENT_A,
    userId: USER_B,
    name: 'بيانات مستخدم آخر لا يجب قراءتها',
  });
  const meeting = createSampleMeeting();

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [foreignUserClient, clientA],
    meetings: [meeting],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  assert.equal(brief.meeting.id, MEETING_CURRENT);
  assert.ok(brief.client);
  assert.equal(brief.client.id, CLIENT_A);
  assert.equal(brief.client.name, 'ماجد السبيعي');
  assert.equal(brief.client.company, 'شركة آفاق الحلول الرقمية');
  assert.ok(brief.primaryContact);
  assert.equal(brief.primaryContact.name, 'سارة المنصور');
  assert.equal(brief.contacts.length, 2);
  assert.equal(brief.completeness.status, 'complete_online');
  assert.equal(brief.completeness.allCollectionsLoaded, true);
});

test('3. Confirmed interactions are distinguished from unconfirmed communication attempts (no_answer, busy_or_callback, message_sent)', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting();

  const confirmedInteraction: CommunicationInteraction = {
    id: 'int_confirmed_1',
    userId: USER_A,
    clientId: CLIENT_A,
    channel: 'phone_call',
    direction: 'outbound',
    occurredAt: '2026-11-12T10:00:00.000Z',
    subject: 'اتصال لمناقشة نطاق المشروع',
    summary: 'تم الاتفاق على إرسال النسخة المحدثة من العرض.',
    outcome: 'follow_up_needed',
    nextStep: 'إرسال جدول التسعير النهائي',
    nextFollowUpDate: '2026-11-14',
    createdAt: '2026-11-12T10:05:00.000Z',
    updatedAt: '2026-11-12T10:05:00.000Z',
  };

  const attemptNoAnswer: CommunicationInteraction = {
    id: 'int_attempt_2',
    userId: USER_A,
    clientId: CLIENT_A,
    channel: 'phone_call',
    direction: 'outbound',
    occurredAt: '2026-11-14T15:00:00.000Z',
    subject: 'محاولة اتصال لتأكيد استلام العرض',
    summary: 'لم يتم الرد على المكالمة.',
    outcome: 'no_answer',
    createdAt: '2026-11-14T15:02:00.000Z',
    updatedAt: '2026-11-14T15:02:00.000Z',
  };

  assert.equal(isConfirmedInteraction(confirmedInteraction), true);
  assert.equal(isConfirmedInteraction(attemptNoAnswer), false);
  assert.equal(isAttemptInteraction(attemptNoAnswer), true);

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [confirmedInteraction, attemptNoAnswer],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  // Even though attemptNoAnswer is newer (Nov 14 vs Nov 12), lastConfirmedInteraction MUST be confirmedInteraction
  assert.ok(brief.relationshipSummary.lastConfirmedInteraction);
  assert.equal(brief.relationshipSummary.lastConfirmedInteraction.id, 'int_confirmed_1');
  assert.ok(brief.relationshipSummary.lastAttemptInteraction);
  assert.equal(brief.relationshipSummary.lastAttemptInteraction.id, 'int_attempt_2');
  assert.equal(brief.relationshipSummary.confirmedInteractionsCount, 1);
  assert.equal(brief.relationshipSummary.attemptInteractionsCount, 1);
});

test('4, 5 & 6. Previous meetings are sorted newest-first, cancelled meetings are excluded from lastHeldMeeting, and recentDecisions are extracted', () => {
  const client = createSampleClient();
  const currentMeeting = createSampleMeeting();

  const olderCompletedMeeting = createSampleMeeting({
    id: 'meet_prev_older',
    title: 'اجتماع التعارف الأولي',
    dateTime: '2026-10-20T09:00:00.000Z',
    status: 'completed',
    decisions: [
      {
        id: 'dec_old_1',
        text: 'اعتماد خطة التواصل الأسبوعية',
        ownerName: 'أنت',
        createdAt: '2026-10-20T10:00:00.000Z',
      },
    ],
  });

  const newerConfirmedPastMeeting = createSampleMeeting({
    id: 'meet_prev_newer',
    title: 'ورشة تحليل المتطلبات الفنية',
    dateTime: '2026-11-05T11:00:00.000Z',
    status: 'confirmed',
    discussionSummary: 'تمت مراجعة المتطلبات الفنية وتحديد الواجهات المطلوبة.',
    decisions: [
      {
        id: 'dec_new_1',
        text: 'تضمين بوابة الدفع الإلكتروني في المرحلة الأولى',
        ownerName: 'سارة المنصور',
        createdAt: '2026-11-05T12:00:00.000Z',
      },
    ],
    followUpDateTime: '2026-11-16T10:00:00.000Z',
  });

  const cancelledRecentMeeting = createSampleMeeting({
    id: 'meet_cancelled_recent',
    title: 'اجتماع ملغي الأسبوع الماضي',
    dateTime: '2026-11-12T11:00:00.000Z',
    status: 'cancelled',
    decisions: [
      {
        id: 'dec_cancelled_ignored',
        text: 'قرار من اجتماع ملغي لا يجب احتسابه كاجتماع منعقد',
        createdAt: '2026-11-12T11:30:00.000Z',
      },
    ],
  });

  const brief = buildMeetingPreparationBrief({
    meeting: currentMeeting,
    clients: [client],
    meetings: [
      currentMeeting,
      olderCompletedMeeting,
      newerConfirmedPastMeeting,
      cancelledRecentMeeting,
    ],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  // Cancelled meeting is excluded from previousMeetings and lastHeldMeeting
  assert.equal(brief.previousMeetings.length, 2);
  assert.equal(brief.previousMeetings[0].meeting.id, 'meet_prev_newer');
  assert.equal(brief.previousMeetings[1].meeting.id, 'meet_prev_older');
  assert.ok(brief.relationshipSummary.lastHeldMeeting);
  assert.equal(brief.relationshipSummary.lastHeldMeeting.id, 'meet_prev_newer');

  // Previous decisions from held meetings only
  assert.equal(brief.recentDecisions.length, 2);
  assert.equal(
    brief.recentDecisions[0].decision.text,
    'تضمين بوابة الدفع الإلكتروني في المرحلة الأولى'
  );
  assert.equal(brief.recentDecisions[1].decision.text, 'اعتماد خطة التواصل الأسبوعية');
});

test('7. Open client tasks are accurately categorized into overdue, dueToday, upcoming, and noDueDate (completed tasks excluded)', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting();

  const tasks: ActionItem[] = [
    {
      id: 't_overdue',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'إرسال الملحق المالي المحدث',
      status: 'pending',
      priority: 'urgent',
      dueDate: '2026-11-10',
      provenance: 'approved',
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 't_today',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'مراجعة العرض التقديمي للاجتماع',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-11-15',
      provenance: 'approved',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 't_upcoming',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'تسليم مسودة اتفاقية مستوى الخدمة SLA',
      status: 'pending',
      priority: 'medium',
      dueDate: '2026-11-20',
      provenance: 'approved',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 't_nodate',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'تحديث قائمة المراجع الفنية',
      status: 'pending',
      priority: 'low',
      provenance: 'approved',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 't_completed',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'مهمة مكتملة سابقاً',
      status: 'completed',
      priority: 'high',
      dueDate: '2026-11-05',
      provenance: 'approved',
      createdAt: '2026-11-01T10:00:00.000Z',
    },
  ];

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks,
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
    timeZone: 'UTC',
  });

  assert.equal(brief.openTasks.totalOpenCount, 4);
  assert.equal(brief.openTasks.overdue.length, 1);
  assert.equal(brief.openTasks.overdue[0].id, 't_overdue');
  assert.equal(brief.openTasks.dueToday.length, 1);
  assert.equal(brief.openTasks.dueToday[0].id, 't_today');
  assert.equal(brief.openTasks.upcoming.length, 1);
  assert.equal(brief.openTasks.upcoming[0].id, 't_upcoming');
  assert.equal(brief.openTasks.noDueDate.length, 1);
  assert.equal(brief.openTasks.noDueDate[0].id, 't_nodate');
});

test('8, 9 & 10. Linked opportunity is surfaced with stage events, other open client opportunities preserve separate currencies, and foreign-client opportunity is rejected', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting({ opportunityId: OPP_LINKED });

  const linkedOpp: Opportunity = {
    id: OPP_LINKED,
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'مشروع تطوير البوابة الرقمية',
    type: 'project',
    stage: 'negotiation',
    priority: 'high',
    estimatedValue: 250000,
    currency: 'SAR',
    expectedCloseDate: '2026-11-30',
    nextAction: 'تأكيد شروط الدفعة الأولى',
    nextActionDate: '2026-11-16',
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  };

  const otherOpenOpp: Opportunity = {
    id: OPP_OTHER_OPEN,
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'عقد الدعم الفني السنوي',
    type: 'retainer',
    stage: 'proposal',
    priority: 'medium',
    estimatedValue: 45000,
    currency: 'USD',
    nextAction: 'متابعة عرض الدعم الفني',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const foreignOpp: Opportunity = {
    id: OPP_FOREIGN,
    userId: USER_A,
    clientId: CLIENT_B,
    title: 'فرصة تتبع عميلاً آخر',
    type: 'consulting',
    stage: 'qualification',
    priority: 'medium',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const stageEvent: OpportunityStageEvent = {
    id: 'ev_1',
    userId: USER_A,
    opportunityId: OPP_LINKED,
    eventType: 'stage_changed',
    fromStage: 'proposal',
    toStage: 'negotiation',
    occurredAt: '2026-11-12T10:00:00.000Z',
  };

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks: [],
    notes: [],
    opportunities: [linkedOpp, otherOpenOpp, foreignOpp],
    opportunityStageEvents: [stageEvent],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  assert.ok(brief.opportunitiesContext.linkedOpportunity);
  assert.equal(brief.opportunitiesContext.linkedOpportunity.id, OPP_LINKED);
  assert.equal(brief.opportunitiesContext.linkedOpportunity.currency, 'SAR');
  assert.equal(brief.opportunitiesContext.linkedOpportunityStageEvents.length, 1);
  assert.equal(brief.opportunitiesContext.linkedOpportunityStageEvents[0].id, 'ev_1');

  // Other open opportunities for same client keep separate currency (USD) and never include foreign client's opportunity
  assert.equal(brief.opportunitiesContext.otherClientOpportunities.length, 1);
  assert.equal(brief.opportunitiesContext.otherClientOpportunities[0].id, OPP_OTHER_OPEN);
  assert.equal(brief.opportunitiesContext.otherClientOpportunities[0].currency, 'USD');

  // If a meeting mistakenly points to a foreign client's opportunityId, it MUST be rejected
  const meetingWithForeignOpp = createSampleMeeting({ opportunityId: OPP_FOREIGN });
  const briefForeign = buildMeetingPreparationBrief({
    meeting: meetingWithForeignOpp,
    clients: [client],
    meetings: [meetingWithForeignOpp],
    tasks: [],
    notes: [],
    opportunities: [linkedOpp, otherOpenOpp, foreignOpp],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });
  assert.equal(briefForeign.opportunitiesContext.linkedOpportunity, null);
});

// ============================================================================
// SCENARIOS 11 - 15: SUGGESTED DISCUSSION TOPICS & AGENDA APPROVAL
// ============================================================================

test('11, 12, 13, 14 & 15. Suggested discussion topics are generated deterministically, flag existing agendaItems, support editing before adding, and support dismissal', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting({
    agendaItems: [
      {
        id: 'ag_1',
        order: 1,
        title: 'متابعة المهمة المتأخرة: بند موجود مسبقاً في جدول الأعمال',
      },
    ],
  });

  const overdueTaskDuplicate: ActionItem = {
    id: 't_dup',
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'بند موجود مسبقاً في جدول الأعمال',
    status: 'pending',
    priority: 'urgent',
    dueDate: '2026-11-10',
    provenance: 'approved',
    createdAt: '2026-11-01T10:00:00.000Z',
  };

  const overdueTaskNew: ActionItem = {
    id: 't_new_overdue',
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'مراجعة مسودة الملحق القانوني',
    status: 'pending',
    priority: 'high',
    dueDate: '2026-11-11',
    provenance: 'approved',
    createdAt: '2026-11-01T10:00:00.000Z',
  };

  const linkedOpp: Opportunity = {
    id: OPP_LINKED,
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'مشروع البوابة',
    type: 'project',
    stage: 'negotiation',
    priority: 'high',
    nextAction: 'تأكيد شروط الدفعة الأولى',
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  };

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks: [overdueTaskDuplicate, overdueTaskNew],
    notes: [],
    opportunities: [linkedOpp],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
    timeZone: 'UTC',
  });

  // Scenario 12: topic matching an existing agenda item is marked alreadyInAgenda = true
  const dupTopic = brief.suggestedTopics.find((t) => t.sourceId === 't_dup');
  assert.ok(dupTopic);
  assert.equal(dupTopic.alreadyInAgenda, true);

  // Scenario 11: overdue task and linked opportunity nextAction are suggested
  const overdueTopic = brief.suggestedTopics.find((t) => t.sourceId === 't_new_overdue');
  assert.ok(overdueTopic);
  assert.equal(overdueTopic.sourceType, 'overdue_task');
  assert.equal(overdueTopic.alreadyInAgenda, false);

  const oppTopic = brief.suggestedTopics.find((t) => t.sourceId === OPP_LINKED);
  assert.ok(oppTopic);
  assert.equal(oppTopic.sourceType, 'opportunity_next_action');

  // Scenario 13 & 14: Edit topic title before adding to meeting.agendaItems in a single save
  const editedTitle = 'مناقشة واعتماد الملحق القانوني النهائي مع المستشار';
  const approveRes = approveSuggestedTopicIntoAgenda(meeting, {
    title: editedTitle,
    notes: overdueTopic.reasonAr,
    durationMinutes: 15,
  });
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.meeting.agendaItems?.length, 2);
  assert.equal(approveRes.meeting.agendaItems?.[1].title, editedTitle);
  assert.equal(approveRes.meeting.agendaItems?.[1].durationMinutes, 15);

  // Trying to approve the exact same title again is blocked (no duplicates)
  const dupApproveRes = approveSuggestedTopicIntoAgenda(approveRes.meeting, {
    title: editedTitle,
  });
  assert.equal(dupApproveRes.ok, false);
  assert.ok(dupApproveRes.duplicateItem);

  // Scenario 15: Dismiss suggested topic marks it dismissed in future brief builds
  const meetingAfterDismiss = dismissSuggestedTopicInMeeting(approveRes.meeting, oppTopic.key);
  assert.ok(meetingAfterDismiss.preparation?.dismissedTopicKeys?.includes(oppTopic.key));

  const briefAfterDismiss = buildMeetingPreparationBrief({
    meeting: meetingAfterDismiss,
    clients: [client],
    meetings: [meetingAfterDismiss],
    tasks: [overdueTaskDuplicate, overdueTaskNew],
    notes: [],
    opportunities: [linkedOpp],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
    timeZone: 'UTC',
  });
  const dismissedTopicInBrief = briefAfterDismiss.suggestedTopics.find(
    (t) => t.key === oppTopic.key
  );
  assert.ok(dismissedTopicInBrief);
  assert.equal(dismissedTopicInBrief.isDismissed, true);
});

// ============================================================================
// SCENARIOS 16 - 20: GOALS CRUD, MANUAL STATUS, MINUTES LOCK & CANCELLED GUARD
// ============================================================================

test('16 & 17. MeetingPreparationGoal supports add, edit, delete, reorder, manual-only status updates, and legacy compatibility', () => {
  let meeting = createSampleMeeting();
  assert.equal(meeting.preparation, undefined);

  // Add Goal 1
  const add1 = addPreparationGoal(meeting, {
    text: 'الحصول على موافقة مبدئية على العرض المالي',
    note: 'التركيز على جدول الدفعات',
  });
  assert.equal(add1.ok, true);
  meeting = add1.meeting;

  // Add Goal 2
  const add2 = addPreparationGoal(meeting, {
    text: 'تحديد موعد انطلاق المشروع',
  });
  assert.equal(add2.ok, true);
  meeting = add2.meeting;

  const goals = meeting.preparation?.goals || [];
  assert.equal(goals.length, 2);
  assert.equal(goals[0].status, 'planned');
  assert.equal(goals[0].order, 1);
  assert.equal(goals[1].order, 2);

  // Reorder Goal 2 up
  const reordered = reorderPreparationGoals(meeting, goals[1].id, 'up');
  assert.equal(reordered.ok, true);
  meeting = reordered.meeting;
  assert.equal(meeting.preparation?.goals?.[0].id, goals[1].id);
  assert.equal(meeting.preparation?.goals?.[0].order, 1);

  // Manual status update (never automatic)
  const updatedStatus = updatePreparationGoal(meeting, goals[0].id, {
    status: 'achieved',
    text: 'الحصول على موافقة نهائية على العرض المالي',
  });
  assert.equal(updatedStatus.ok, true);
  meeting = updatedStatus.meeting;
  const updatedGoal = meeting.preparation?.goals?.find((g) => g.id === goals[0].id);
  assert.equal(updatedGoal?.status, 'achieved');
  assert.equal(updatedGoal?.text, 'الحصول على موافقة نهائية على العرض المالي');

  // Update preparation notes
  const withNotes = updatePreparationNotes(
    meeting,
    'ملاحظة تحضيرية: العميل يفضل البدء بالجانب التشغيلي.'
  );
  assert.equal(withNotes.ok, true);
  meeting = withNotes.meeting;
  assert.equal(
    meeting.preparation?.notes,
    'ملاحظة تحضيرية: العميل يفضل البدء بالجانب التشغيلي.'
  );

  // Remove Goal 2
  const removed = removePreparationGoal(meeting, goals[1].id);
  assert.equal(removed.ok, true);
  assert.equal(removed.meeting.preparation?.goals?.length, 1);

  // Sanitize meeting for Firestore save preserves preparation
  const sanitized = sanitizeMeetingForSave(removed.meeting);
  assert.equal(sanitized.preparation?.goals?.length, 1);
  assert.equal(sanitized.preparation?.goals?.[0].status, 'achieved');

  // Legacy meeting without preparation sanitizes cleanly without error
  const legacySanitized = sanitizeMeetingForSave(createSampleMeeting());
  assert.equal(legacySanitized.preparation, undefined);
});

test('18 & 19. Final minutes lock blocks agenda modification unless reopened, while post-meeting goal status update remains allowed without breaking final minutes lock', () => {
  const added = addPreparationGoal(createSampleMeeting(), {
    text: 'اعتماد خطة التدريب',
  });
  assert.equal(added.ok, true);

  const goalId = added.goal.id;
  const finalMeeting: Meeting = {
    ...added.meeting,
    minutesStatus: 'final',
  };

  assert.equal(isMinutesLocked(finalMeeting), true);

  const brief = buildMeetingPreparationBrief({
    meeting: finalMeeting,
    clients: [createSampleClient()],
    meetings: [finalMeeting],
    tasks: [],
  });
  assert.equal(brief.isMinutesFinalLocked, true);
  assert.equal(brief.canEditAgendaAndMinutes, false);
  assert.equal(brief.canUpdatePostMeetingGoalStatus, true);

  // Attempting to add suggested topic to agenda while minutesStatus === 'final' is blocked
  const topicRes = approveSuggestedTopicIntoAgenda(finalMeeting, {
    title: 'مهمة متأخرة',
  });
  assert.equal(topicRes.ok, false);
  assert.ok(topicRes.reasonArabic.includes('نهائي'));

  // Updating goal status post-meeting (e.g. partially_achieved / deferred) is allowed and preserves minutesStatus === 'final'
  const goalStatusUpdate = updatePreparationGoal(finalMeeting, goalId, {
    status: 'partially_achieved',
  });
  assert.equal(goalStatusUpdate.ok, true);
  assert.equal(goalStatusUpdate.meeting.minutesStatus, 'final');
  assert.equal(
    goalStatusUpdate.meeting.preparation?.goals?.[0].status,
    'partially_achieved'
  );
});

test('20. Cancelled meeting blocks all operational edits to agenda, goals, and preparation notes', () => {
  const added = addPreparationGoal(createSampleMeeting(), {
    text: 'هدف سابق قبل الإلغاء',
  });
  assert.equal(added.ok, true);

  const cancelledMeeting: Meeting = {
    ...added.meeting,
    status: 'cancelled',
  };

  const brief = buildMeetingPreparationBrief({
    meeting: cancelledMeeting,
    clients: [createSampleClient()],
    meetings: [cancelledMeeting],
    tasks: [],
  });
  assert.equal(brief.isMeetingCancelled, true);
  assert.equal(brief.canEditAgendaAndMinutes, false);
  assert.equal(brief.canEditGoals, false);
  assert.equal(brief.canUpdatePostMeetingGoalStatus, false);

  const addGoalRes = addPreparationGoal(cancelledMeeting, {
    text: 'هدف جديد على اجتماع ملغي',
  });
  assert.equal(addGoalRes.ok, false);

  const updateGoalRes = updatePreparationGoal(cancelledMeeting, added.goal.id, {
    status: 'achieved',
  });
  assert.equal(updateGoalRes.ok, false);

  const notesRes = updatePreparationNotes(
    cancelledMeeting,
    'محاولة تعديل ملاحظات اجتماع ملغي'
  );
  assert.equal(notesRes.ok, false);

  const agendaRes = approveSuggestedTopicIntoAgenda(cancelledMeeting, {
    title: 'محاولة إضافة بند على اجتماع ملغي',
  });
  assert.equal(agendaRes.ok, false);
});

// ============================================================================
// SCENARIOS 21 - 26: OFFLINE BEHAVIOR, AI CONSENT BUNDLE, REDACTION & TRUNCATION
// ============================================================================

test('21 & 22. Deterministic Smart Preparation works 100% offline with honest completeness disclosure, while AI briefing service rejects when offline with clear Arabic message', async () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting();

  const offlineBrief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
    isOnline: false,
    hasPendingWrites: true,
    collectionsLoaded: {
      interactions: false,
    },
  });

  assert.equal(offlineBrief.completeness.isOnline, false);
  assert.equal(offlineBrief.completeness.status, 'partial_or_offline');
  assert.ok(offlineBrief.completeness.unloadedCollectionsAr.includes('سجل التواصل'));
  assert.ok(offlineBrief.completeness.disclosureAr.includes('عدم الاتصال'));

  const plainText = formatPreparationBriefPlainText(offlineBrief);
  assert.ok(plainText.includes(meeting.title));
  assert.ok(plainText.includes(client.name));

  // Scenario 22: AI Briefing client service blocks immediately when offline without calling fetchApi
  let fetchCalled = false;
  await assert.rejects(
    () =>
      requestMeetingAiBriefingWithDeps(
        {
          brief: offlineBrief,
          includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
        },
        {
          isOnline: () => false,
          getIdToken: async () => 'token_alice',
          fetchApi: async () => {
            fetchCalled = true;
            throw new Error('Should not be called when offline');
          },
        }
      ),
    (err: Error) => {
      assert.ok(err.message.includes('بالإنترنت'));
      return true;
    }
  );
  assert.equal(fetchCalled, false);
});

test('23, 24, 25 & 26. AI Briefing consent bundle builder respects selected sections only, keeps clientNotes off by default, strips URLs/paths, and truncates safely within MAX_AI_BRIEFING_INPUT_CHARS', () => {
  const client = createSampleClient({
    notes:
      'ملاحظة خاصة تحتوي على رابط https://secret.example.com/file.pdf ومسار clients/u1/avatars/pic.png',
  });
  const meeting = createSampleMeeting({
    notes:
      'ملاحظات مع رابط مرفق https://f005.backblazeb2.com/file/Murafiq/secret.pdf ومسار users/u1/meetings/m1/attachments/a1',
    preparation: {
      notes:
        'ملاحظات تحضير تحتوي على رابط https://f005.backblazeb2.com/file/Murafiq/secret.pdf ومسار users/u1/meetings/m1/attachments/a1 ومسار clients/u1/avatars/pic.png',
    },
  });

  const sampleNote: Note = {
    id: 'n_1',
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'ملاحظة خاصة جداً',
    content: 'محتوى الملاحظة الخاصة التي لا تندرج افتراضياً',
    tags: [],
    isPinned: true,
    color: '#fef3c7',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  const brief = buildMeetingPreparationBrief({
    meeting,
    clients: [client],
    meetings: [meeting],
    tasks: [
      {
        id: 't_1',
        userId: USER_A,
        clientId: CLIENT_A,
        title: 'مهمة مفتوحة للعميل',
        status: 'pending',
        priority: 'high',
        dueDate: '2026-11-10',
        provenance: 'approved',
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ],
    notes: [sampleNote],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  // Scenario 24: Default selection has clientNotes = false
  assert.equal(DEFAULT_AI_BRIEFING_SECTION_SELECTION.clientNotes, false);

  const bundleWithoutNotes = buildMeetingAiBriefingInputBundle(brief, {
    ...DEFAULT_AI_BRIEFING_SECTION_SELECTION,
    openTasks: false,
    clientNotes: false,
  });

  assert.equal(bundleWithoutNotes.payload.includedSections.openTasks, false);
  assert.equal(bundleWithoutNotes.payload.openTasks?.length, 0);
  assert.equal(bundleWithoutNotes.payload.clientNotes?.length, 0);
  assert.equal(bundleWithoutNotes.previewText.includes('ملاحظة خاصة جداً'), false);

  // Scenario 25: Redaction of URLs and storage paths
  assert.equal(
    bundleWithoutNotes.previewText.includes('backblazeb2.com'),
    false,
    'Signed B2 URLs must be redacted from AI bundle'
  );
  assert.equal(
    bundleWithoutNotes.previewText.includes('users/u1/meetings'),
    false,
    'Storage paths must be redacted from AI bundle'
  );
  assert.ok(bundleWithoutNotes.previewText.includes('[تم حجب مسار تخزين خاص]'));

  // Scenario 26: Truncation when exceeding MAX_AI_BRIEFING_INPUT_CHARS stays valid on server
  const hugeAgenda = Array.from({ length: 20 }, (_, i) => ({
    id: `ag_big_${i}`,
    order: i + 1,
    title: `محور تفصيلي رقم ${i + 1} `.repeat(10),
    notes: 'تفاصيل مطولة جداً لاختبار الحد الأقصى المسموح به للمدخلات. '.repeat(20),
  }));
  const hugeNotesMeeting = createSampleMeeting({
    agendaItems: hugeAgenda,
    preparation: {
      notes: 'سجل تحضير طويل جداً '.repeat(300),
      goals: Array.from({ length: 15 }, (_, i) => ({
        id: `g_big_${i}`,
        text: `هدف تفصيلي رقم ${i + 1} `.repeat(8),
        note: 'تفاصيل الهدف '.repeat(15),
        status: 'planned',
        order: i + 1,
        createdAt: '2026-11-12T10:00:00.000Z',
      })),
    },
  });
  const hugePreviousMeetings: Meeting[] = Array.from({ length: 4 }, (_, i) =>
    createSampleMeeting({
      id: `meet_huge_prev_${i}`,
      title: `اجتماع مراجعة سابقة رقم ${i + 1} `.repeat(5),
      dateTime: `2026-10-0${i + 1}T10:00:00.000Z`,
      status: 'completed',
      discussionSummary: 'ملخص تفصيلي للنقاشات السابقة والالتزامات التعاقدية والفنية. '.repeat(10),
      decisions: Array.from({ length: 5 }, (_, d) => ({
        id: `dec_huge_${i}_${d}`,
        text: `قرار معتمد رقم ${d + 1} للاجتماع السابق `.repeat(6),
        createdAt: `2026-10-0${i + 1}T11:00:00.000Z`,
      })),
    })
  );
  const hugeBrief = buildMeetingPreparationBrief({
    meeting: hugeNotesMeeting,
    clients: [client],
    meetings: [hugeNotesMeeting, ...hugePreviousMeetings],
    tasks: [],
    notes: [sampleNote],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });
  const hugeBundle = buildMeetingAiBriefingInputBundle(hugeBrief, {
    ...DEFAULT_AI_BRIEFING_SECTION_SELECTION,
    clientNotes: true,
  });
  assert.equal(hugeBundle.wasTruncated, true);
  assert.ok(hugeBundle.charCount <= MAX_AI_BRIEFING_INPUT_CHARS);
  assert.ok(hugeBundle.truncatedSectionsAr.some((w) => w.includes('اقتصاص')));

  const serverValidation = sanitizeIncomingAiBriefingPayload(hugeBundle.payload);
  assert.equal(serverValidation.ok, true);
});

// ============================================================================
// SCENARIOS 27 - 31: SERVER /api/ai/meeting-briefing SECURITY, RATE LIMIT & ABORT
// ============================================================================

test('27. Security: /api/ai/meeting-briefing without valid Bearer token returns 401', async () => {
  const { baseUrl, close } = await startTestServer(makeBriefingRouterWithStubs());
  try {
    const res = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: MEETING_CURRENT,
        includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
        meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
      }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test('28. Security: User B attempting to request AI briefing for User A meeting is rejected with 403 and never invokes Gemini', async () => {
  let geminiCalled = false;
  const { baseUrl, close } = await startTestServer(
    makeBriefingRouterWithStubs({
      briefingFn: async () => {
        geminiCalled = true;
        throw new Error('Should not be called');
      },
    })
  );
  try {
    const res = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_bob',
      },
      body: JSON.stringify({
        meetingId: MEETING_CURRENT,
        includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
        meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
      }),
    });
    assert.equal(res.status, 403);
    assert.equal(geminiCalled, false);
  } finally {
    await close();
  }
});

test('29. Security: spoofing uid/userId/ownerId or sending disallowed attachment fields in /api/ai/meeting-briefing returns 403/400', async () => {
  const { baseUrl, close } = await startTestServer(makeBriefingRouterWithStubs());
  try {
    const resSpoof = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        meetingId: MEETING_CURRENT,
        userId: USER_B,
        includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
        meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
      }),
    });
    assert.equal(resSpoof.status, 403);

    const resDisallowed = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        meetingId: MEETING_CURRENT,
        photoPaths: ['secret.jpg'],
        includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
        meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
      }),
    });
    assert.equal(resDisallowed.status, 400);
  } finally {
    await close();
  }
});

test('30. Rate Limiting & Concurrent Lock: /api/ai/meeting-briefing blocks concurrent duplicate requests (409) and enforces rate limit (429)', async () => {
  let releasePending!: () => void;
  const blocker = new Promise<void>((resolve) => {
    releasePending = resolve;
  });

  const { baseUrl, close } = await startTestServer(
    makeBriefingRouterWithStubs({
      rateLimitMaxRequests: 2,
      briefingFn: async () => {
        await blocker;
        return createValidatedBriefingResult();
      },
    })
  );

  try {
    const reqBody = JSON.stringify({
      meetingId: MEETING_CURRENT,
      includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
      meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
    });

    const firstPromise = fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: reqBody,
    });

    // Give first request 30ms to enter inFlightKeys
    await new Promise((r) => setTimeout(r, 30));

    // Concurrent second request for same meeting -> 409
    const secondRes = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: reqBody,
    });
    assert.equal(secondRes.status, 409);

    releasePending();
    const firstRes = await firstPromise;
    assert.equal(firstRes.status, 200);

    // Third request exceeds rateLimitMaxRequests=2 -> 429
    const thirdRes = await fetch(`${baseUrl}/api/ai/meeting-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: reqBody,
    });
    assert.equal(thirdRes.status, 429);
  } finally {
    await close();
  }
});

test('31. AbortController cancellation: client service aborts in-flight AI briefing request cleanly', async () => {
  const controller = new AbortController();
  controller.abort();

  const brief = buildMeetingPreparationBrief({
    meeting: createSampleMeeting(),
    clients: [createSampleClient()],
    meetings: [createSampleMeeting()],
    tasks: [],
  });

  await assert.rejects(
    () =>
      requestMeetingAiBriefingWithDeps(
        {
          brief,
          includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
          signal: controller.signal,
        },
        {
          isOnline: () => true,
          getIdToken: async () => 'token_alice',
          fetchApi: async (_input, init) => {
            if (init?.signal?.aborted) {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              throw abortErr;
            }
            throw new Error('Should have been aborted');
          },
        }
      ),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, 'AI_ABORTED');
      return true;
    }
  );
});

// ============================================================================
// SCENARIOS 32 - 35: GEMINI BRIEFING VALIDATION & HUMAN APPROVAL WITHOUT DUPLICATES
// ============================================================================

test('32. Gemini output validator normalizes recommendedTalkingPoints basisType (documented_fact, inference, ai_suggestion) and rejects malformed payloads', async () => {
  const sanitizedInput = sanitizeIncomingAiBriefingPayload({
    meetingId: MEETING_CURRENT,
    includedSections: DEFAULT_AI_BRIEFING_SECTION_SELECTION,
    meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
    clientSummary: {
      name: 'ماجد السبيعي',
      company: 'شركة آفاق الحلول الرقمية',
    },
  });
  assert.equal(sanitizedInput.ok, true);

  const prompt = buildMeetingBriefingUserPrompt(sanitizedInput.data);
  assert.ok(prompt.includes('اجتماع مراجعة العرض الفني والاعتماد المالي'));

  const result = await generateMeetingBriefingWithGemini(
    { payload: sanitizedInput.data },
    {
      getApiKey: () => 'test_server_key_only',
      generateStructuredJson: async () => JSON.stringify(createValidGeminiBriefingRawJson()),
    }
  );

  assert.equal(result.recommendedTalkingPoints.length, 3);
  assert.equal(result.recommendedTalkingPoints[0].basisType, 'documented_fact');
  assert.equal(result.recommendedTalkingPoints[1].basisType, 'inference');
  assert.equal(result.recommendedTalkingPoints[2].basisType, 'ai_suggestion');
  assert.equal(result.suggestedQuestions.length, 1);
  assert.equal(result.potentialRisks.length, 1);
  assert.equal(result.expectedOutcomes.length, 1);

  const malformed = validateAndNormalizeMeetingBriefingAi({ foo: 'bar' });
  assert.equal(malformed.ok, false);
});

test('33, 34 & 35. Human approval of AI talking point into agendaItems and AI expected outcome into preparation.goals supports editing and prevents duplicates on repeated clicks', () => {
  let meeting = createSampleMeeting();
  const aiResult = createValidatedBriefingResult();

  // Scenario 33: Approve AI talking point into meeting.agendaItems with user edit
  const tp = aiResult.recommendedTalkingPoints[0];
  const tpApprove1 = approveAiTalkingPointToAgenda(meeting, {
    title: 'مراجعة واعتماد الملحق المالي المتأخر',
    rationale: tp.rationale,
  });
  assert.equal(tpApprove1.ok, true);
  meeting = tpApprove1.meeting;
  assert.equal(meeting.agendaItems?.length, 2);
  assert.equal(
    meeting.agendaItems?.[1].title,
    'مراجعة واعتماد الملحق المالي المتأخر'
  );

  // Scenario 35 (part A): Clicking approve again for the same talking point does not duplicate
  const tpApprove2 = approveAiTalkingPointToAgenda(meeting, {
    title: 'مراجعة واعتماد الملحق المالي المتأخر',
    rationale: tp.rationale,
  });
  assert.equal(tpApprove2.ok, false);
  assert.ok(tpApprove2.duplicateItem);
  assert.equal(meeting.agendaItems?.length, 2);

  // Scenario 34: Approve AI expected outcome into meeting.preparation.goals with user edit
  const outcome = aiResult.expectedOutcomes[0];
  const goalApprove1 = approveAiSuggestedGoalToPreparation(meeting, {
    text: 'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع',
    note: outcome.note,
  });
  assert.equal(goalApprove1.ok, true);
  meeting = goalApprove1.meeting;
  assert.equal(meeting.preparation?.goals?.length, 1);
  assert.equal(meeting.preparation?.goals?.[0].status, 'planned');
  assert.equal(
    meeting.preparation?.goals?.[0].text,
    'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع'
  );

  // Scenario 35 (part B): Clicking approve again for the same outcome does not duplicate
  const goalApprove2 = approveAiSuggestedGoalToPreparation(meeting, {
    text: 'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع',
    note: outcome.note,
  });
  assert.equal(goalApprove2.ok, false);
  assert.equal(meeting.preparation?.goals?.length, 1);
});

test('36 & 37. Legacy preparation without goals preserves notes/dismissedTopicKeys on edits, and MeetingPreparationWorkspace renders isolated mock data cleanly', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MeetingPreparationWorkspace } = await import(
    '../src/components/MeetingPreparationWorkspace.tsx'
  );

  // Preparation object that has notes & dismissedTopicKeys but NO goals (goals === undefined)
  const meetingWithoutGoals = createSampleMeeting({
    preparation: {
      notes: 'ملاحظة سابقة محفوظة يجب عدم الكتابة فوقها',
      dismissedTopicKeys: ['topic-dismissed-1'],
    },
  });

  const addRes = addPreparationGoal(meetingWithoutGoals, {
    text: 'هدف جديد دون مساس بالملاحظات السابقة',
  });
  assert.equal(addRes.ok, true);
  assert.equal(addRes.meeting.preparation?.notes, 'ملاحظة سابقة محفوظة يجب عدم الكتابة فوقها');
  assert.deepEqual(addRes.meeting.preparation?.dismissedTopicKeys, ['topic-dismissed-1']);
  assert.equal(addRes.meeting.preparation?.goals?.length, 1);

  const client = createSampleClient();
  const markup = renderToStaticMarkup(
    React.createElement(MeetingPreparationWorkspace, {
      meeting: addRes.meeting,
      clients: [client],
      meetings: [addRes.meeting],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
      interactions: [],
      currentUserId: USER_A,
      isOnline: true,
      onSaveMeeting: () => undefined,
    })
  );

  assert.ok(markup.includes('ملف التحضير الذكي للاجتماع'));
  assert.ok(markup.includes(client.name));
  assert.ok(markup.includes('هدف جديد دون مساس بالملاحظات السابقة'));
  assert.ok(markup.includes('ملاحظة سابقة محفوظة يجب عدم الكتابة فوقها'));
  assert.ok(markup.includes('تحضير ذكي متقدم (اختياري)'));
});

