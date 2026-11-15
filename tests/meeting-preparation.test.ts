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
  MAX_AI_BRIEFING_TOTAL_CHARS,
  addPreparationGoal,
  approveAiSuggestedGoalIntoMeeting,
  approveAiTalkingPointIntoAgenda,
  approveSuggestedTopicIntoAgenda,
  buildMeetingAiBriefingInputBundle,
  buildMeetingPreparationBrief,
  canEditMeetingAgendaInPreparation,
  canEditPreparationGoals,
  canUpdatePreparationGoalStatusPostMeeting,
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
import { sanitizeMeetingForSave } from '../src/utils/meetingMinutes.ts';
import { requestMeetingAiBriefingWithDeps } from '../src/services/meetingAi.ts';
import type {
  ActionItem,
  Client,
  CommunicationInteraction,
  Meeting,
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
    category: 'شريك استراتيجي',
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

function createValidGeminiBriefingPayload() {
  return {
    executiveBriefing: {
      currentPicture: 'العميل في مرحلة التفاوض على مشروع المنصة الرقمية مع وجود مهمة متأخرة لمراجعة الملحق المالي.',
      mostImportantBeforeEntry: 'حسم ملاحظات الملحق المالي وتأكيد خطة الإطلاق قبل التوقيع.',
      insufficientContext: false,
    },
    talkingPoints: [
      {
        id: 'tp_1',
        title: 'حسم الملحق المالي المتأخر',
        rationale: 'توجد مهمة متأخرة مرتبطة بمراجعة تسعير المرحلة الثانية.',
        basisType: 'documented_fact',
      },
      {
        id: 'tp_2',
        title: 'مناقشة جاهزية فرق العميل للربط التقني',
        rationale: 'استنتاج من طبيعة المرحلة الحالية للفرصة.',
        basisType: 'inference',
      },
      {
        id: 'tp_3',
        title: 'اقتراح جدولة ورشة عمل تعريفية بعد التوقيع',
        rationale: 'مقترح لتسريع انطلاق المشروع.',
        basisType: 'ai_suggestion',
      },
    ],
    suggestedQuestions: [
      {
        id: 'sq_1',
        question: 'هل تم اعتماد الميزانية النهائية للمرحلة الثانية من الإدارة المالية؟',
        contextNote: 'لإغلاق مرحلة التفاوض الحالية.',
      },
    ],
    potentialRisks: [
      {
        id: 'pr_1',
        risk: 'تأخر التوقيع بسبب عدم إغلاق مهمة الملحق المالي.',
        basisType: 'documented_fact',
      },
    ],
    expectedOutcomes: [
      {
        id: 'eo_1',
        title: 'الموافقة النهائية على جدول الدفعات وتحديد تاريخ التوقيع',
        notes: 'هدف مقترح للاجتماع القادم',
      },
    ],
    warnings: [],
  };
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

function makeBriefingRouterWithStubs(overrides: {
  briefingFn?: AiRouterDeps['generateMeetingBriefing'];
  ownsFn?: AiRouterDeps['verifyMeetingOwnership'];
  rateLimitMaxRequests?: number;
} = {}) {
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
    generateMeetingBriefing:
      overrides.briefingFn ??
      (async () =>
        validateAndNormalizeMeetingBriefingAi(createValidGeminiBriefingPayload(), {
          model: DEFAULT_GEMINI_MEETING_MODEL,
        })),
    rateLimitMaxRequests: overrides.rateLimitMaxRequests ?? 10,
  });
}

// ============================================================================
// SCENARIOS 1 - 10: DETERMINISTIC SMART PREPARATION & DATA AGGREGATION
// ============================================================================

test('1 & 2. Smart Preparation builds full brief for linked client and surfaces client & contacts details', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting();

  const brief = buildMeetingPreparationBrief({
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
  });

  assert.equal(brief.meeting.id, MEETING_CURRENT);
  assert.ok(brief.client);
  assert.equal(brief.client.id, CLIENT_A);
  assert.equal(brief.client.name, 'ماجد السبيعي');
  assert.equal(brief.client.company, 'شركة آفاق الحلول الرقمية');
  assert.ok(brief.primaryContact);
  assert.equal(brief.primaryContact.name, 'سارة المنصور');
  assert.equal(brief.contacts.length, 2);
  assert.equal(brief.completeness.isCompleteOnline, true);
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
    followUpDate: '2026-11-14',
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
  assert.ok(brief.lastConfirmedInteraction);
  assert.equal(brief.lastConfirmedInteraction.id, 'int_confirmed_1');
  assert.ok(brief.lastAttemptInteraction);
  assert.equal(brief.lastAttemptInteraction.id, 'int_attempt_2');
});

test('4, 5 & 6. Previous meetings are sorted newest-first, cancelled meetings are excluded from lastHeldMeeting, and previous decisions are extracted', () => {
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
    followUpSuggestedDate: '2026-11-16',
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

  // Cancelled meeting is excluded from previousHeldMeetings and lastHeldMeeting
  assert.equal(brief.previousHeldMeetings.length, 2);
  assert.equal(brief.previousHeldMeetings[0].meeting.id, 'meet_prev_newer');
  assert.equal(brief.previousHeldMeetings[1].meeting.id, 'meet_prev_older');
  assert.ok(brief.lastHeldMeeting);
  assert.equal(brief.lastHeldMeeting.id, 'meet_prev_newer');
  assert.equal(brief.cancelledMeetingsCount, 1);

  // Previous decisions from held meetings
  assert.equal(brief.previousDecisions.length, 2);
  assert.equal(
    brief.previousDecisions[0].decision.text,
    'تضمين بوابة الدفع الإلكتروني في المرحلة الأولى'
  );
  assert.equal(brief.previousDecisions[1].decision.text, 'اعتماد خطة التواصل الأسبوعية');
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
      provenance: 'user_approved',
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
      provenance: 'user_approved',
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
      provenance: 'user_approved',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 't_nodate',
      userId: USER_A,
      clientId: CLIENT_A,
      title: 'تحديث قائمة المراجع الفنية',
      status: 'pending',
      priority: 'low',
      provenance: 'user_approved',
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
      provenance: 'user_approved',
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

test('8, 9 & 10. Linked opportunity is surfaced with stage history, other open client opportunities are kept separate, and foreign-client opportunity is rejected', () => {
  const client = createSampleClient();
  const meeting = createSampleMeeting({ opportunityId: OPP_LINKED });

  const linkedOpp: Opportunity = {
    id: OPP_LINKED,
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'مشروع تطوير البوابة الرقمية',
    type: 'new_project',
    stage: 'negotiation',
    value: 250000,
    currency: 'SAR',
    probability: 75,
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
    type: 'renewal',
    stage: 'proposal_sent',
    value: 45000,
    currency: 'USD',
    probability: 60,
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
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const stageEvent: OpportunityStageEvent = {
    id: 'ev_1',
    userId: USER_A,
    opportunityId: OPP_LINKED,
    clientId: CLIENT_A,
    eventType: 'stage_changed',
    fromStage: 'proposal_sent',
    toStage: 'negotiation',
    changedAt: '2026-11-12T10:00:00.000Z',
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

  assert.ok(brief.linkedOpportunity);
  assert.equal(brief.linkedOpportunity.id, OPP_LINKED);
  assert.ok(brief.linkedOpportunityLatestStageEvent);
  assert.equal(brief.linkedOpportunityLatestStageEvent.id, 'ev_1');

  // Other open opportunities for same client are separate and never include foreign client's opportunity
  assert.equal(brief.otherOpenClientOpportunities.length, 1);
  assert.equal(brief.otherOpenClientOpportunities[0].id, OPP_OTHER_OPEN);

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
  assert.equal(briefForeign.linkedOpportunity, null);
});

// ============================================================================
// SCENARIOS 11 - 15: SUGGESTED DISCUSSION TOPICS & AGENDA APPROVAL
// ============================================================================

test('11, 12, 13, 14 & 15. Suggested discussion topics are generated deterministically, avoid duplicates with agendaItems, support editing before adding, save into agendaItems, and support dismissal', () => {
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
    provenance: 'user_approved',
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
    provenance: 'user_approved',
    createdAt: '2026-11-01T10:00:00.000Z',
  };

  const linkedOpp: Opportunity = {
    id: OPP_LINKED,
    userId: USER_A,
    clientId: CLIENT_A,
    title: 'مشروع البوابة',
    type: 'new_project',
    stage: 'negotiation',
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

  // Scenario 12: duplicate title already in agendaItems is excluded
  assert.equal(
    brief.suggestedTopics.some((t) => t.sourceId === 't_dup'),
    false,
    'Topic already in agendaItems must not be suggested again'
  );

  // Scenario 11: overdue task and linked opportunity nextAction are suggested
  const overdueTopic = brief.suggestedTopics.find((t) => t.sourceId === 't_new_overdue');
  assert.ok(overdueTopic);
  assert.equal(overdueTopic.sourceType, 'overdue_task');

  const oppTopic = brief.suggestedTopics.find((t) => t.sourceId === OPP_LINKED);
  assert.ok(oppTopic);
  assert.equal(oppTopic.sourceType, 'linked_opportunity_next_action');

  // Scenario 13 & 14: Edit topic title before adding to meeting.agendaItems in a single save
  const editedTitle = 'مناقشة واعتماد الملحق القانوني النهائي مع المستشار';
  const approveRes = approveSuggestedTopicIntoAgenda({
    meeting,
    topic: overdueTopic,
    customTitle: editedTitle,
    durationMinutes: 15,
  });
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.alreadyExists, false);
  assert.equal(approveRes.meeting.agendaItems?.length, 2);
  assert.equal(approveRes.meeting.agendaItems?.[1].title, editedTitle);
  assert.equal(approveRes.meeting.agendaItems?.[1].durationMinutes, 15);

  // Trying to approve the exact same title again is blocked (no duplicates)
  const dupApproveRes = approveSuggestedTopicIntoAgenda({
    meeting: approveRes.meeting,
    topic: overdueTopic,
    customTitle: editedTitle,
  });
  assert.equal(dupApproveRes.ok, false);
  assert.equal(dupApproveRes.alreadyExists, true);

  // Scenario 15: Dismiss suggested topic removes it from future brief suggestions
  const dismissRes = dismissSuggestedTopicInMeeting(approveRes.meeting, oppTopic.key);
  assert.equal(dismissRes.ok, true);
  assert.ok(
    dismissRes.meeting.preparation?.dismissedTopicKeys?.includes(oppTopic.key)
  );

  const briefAfterDismiss = buildMeetingPreparationBrief({
    meeting: dismissRes.meeting,
    clients: [client],
    meetings: [dismissRes.meeting],
    tasks: [overdueTaskDuplicate, overdueTaskNew],
    notes: [],
    opportunities: [linkedOpp],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
    timeZone: 'UTC',
  });
  assert.equal(
    briefAfterDismiss.suggestedTopics.some((t) => t.key === oppTopic.key),
    false
  );
});

// ============================================================================
// SCENARIOS 16 - 20: GOALS CRUD, MANUAL STATUS, MINUTES LOCK & CANCELLED GUARD
// ============================================================================

test('16 & 17. MeetingPreparationGoal supports add, edit, delete, reorder, and manual-only status updates', () => {
  let meeting = createSampleMeeting();

  // Add Goal 1
  const add1 = addPreparationGoal({
    meeting,
    title: 'الحصول على موافقة مبدئية على العرض المالي',
    notes: 'التركيز على جدول الدفعات',
  });
  assert.equal(add1.ok, true);
  meeting = add1.meeting;

  // Add Goal 2
  const add2 = addPreparationGoal({
    meeting,
    title: 'تحديد موعد انطلاق المشروع',
  });
  assert.equal(add2.ok, true);
  meeting = add2.meeting;

  const goals = meeting.preparation?.goals || [];
  assert.equal(goals.length, 2);
  assert.equal(goals[0].status, 'planned');
  assert.equal(goals[0].order, 1);
  assert.equal(goals[1].order, 2);

  // Reorder Goal 2 up
  const reordered = reorderPreparationGoals({
    meeting,
    goalId: goals[1].id,
    direction: 'up',
  });
  assert.equal(reordered.ok, true);
  meeting = reordered.meeting;
  assert.equal(meeting.preparation?.goals?.[0].id, goals[1].id);
  assert.equal(meeting.preparation?.goals?.[0].order, 1);

  // Manual status update (never automatic)
  const updatedStatus = updatePreparationGoal({
    meeting,
    goalId: goals[0].id,
    status: 'achieved',
    title: 'الحصول على موافقة نهائية على العرض المالي',
  });
  assert.equal(updatedStatus.ok, true);
  meeting = updatedStatus.meeting;
  const updatedGoal = meeting.preparation?.goals?.find((g) => g.id === goals[0].id);
  assert.equal(updatedGoal?.status, 'achieved');
  assert.equal(updatedGoal?.title, 'الحصول على موافقة نهائية على العرض المالي');

  // Update preparation notes
  const withNotes = updatePreparationNotes({
    meeting,
    notes: 'ملاحظة تحضيرية: العميل يفضل البدء بالجانب التشغيلي.',
  });
  assert.equal(withNotes.ok, true);
  meeting = withNotes.meeting;
  assert.equal(
    meeting.preparation?.notes,
    'ملاحظة تحضيرية: العميل يفضل البدء بالجانب التشغيلي.'
  );

  // Remove Goal 2
  const removed = removePreparationGoal({
    meeting,
    goalId: goals[1].id,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.meeting.preparation?.goals?.length, 1);

  // Sanitize meeting for Firestore save preserves preparation
  const sanitized = sanitizeMeetingForSave(removed.meeting);
  assert.equal(sanitized.preparation?.goals?.length, 1);
  assert.equal(sanitized.preparation?.goals?.[0].status, 'achieved');
});

test('18 & 19. Final minutes lock blocks agenda modification unless reopened, while post-meeting goal status update remains allowed without breaking final minutes lock', () => {
  const baseWithGoal = addPreparationGoal({
    meeting: createSampleMeeting(),
    title: 'اعتماد خطة التدريب',
  }).meeting;
  const goalId = baseWithGoal.preparation!.goals![0].id;

  const finalMeeting: Meeting = {
    ...baseWithGoal,
    minutesStatus: 'final',
  };

  assert.equal(canEditMeetingAgendaInPreparation(finalMeeting), false);
  assert.equal(canUpdatePreparationGoalStatusPostMeeting(finalMeeting), true);

  // Attempting to add suggested topic to agenda while minutesStatus === 'final' is blocked
  const topicRes = approveSuggestedTopicIntoAgenda({
    meeting: finalMeeting,
    topic: {
      key: 'overdue_task:t1',
      title: 'مهمة متأخرة',
      sourceType: 'overdue_task',
      sourceLabelAr: 'مهمة متأخرة',
      sourceId: 't1',
      provenance: 'user_approved',
    },
  });
  assert.equal(topicRes.ok, false);
  assert.ok(topicRes.errorAr?.includes('نهائياً'));

  // Updating goal status post-meeting (e.g. achieved / deferred) is allowed and preserves minutesStatus === 'final'
  const goalStatusUpdate = updatePreparationGoal({
    meeting: finalMeeting,
    goalId,
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
  const baseWithGoal = addPreparationGoal({
    meeting: createSampleMeeting(),
    title: 'هدف سابق قبل الإلغاء',
  }).meeting;
  const goalId = baseWithGoal.preparation!.goals![0].id;

  const cancelledMeeting: Meeting = {
    ...baseWithGoal,
    status: 'cancelled',
  };

  assert.equal(canEditMeetingAgendaInPreparation(cancelledMeeting), false);
  assert.equal(canEditPreparationGoals(cancelledMeeting), false);
  assert.equal(canUpdatePreparationGoalStatusPostMeeting(cancelledMeeting), false);

  const addGoalRes = addPreparationGoal({
    meeting: cancelledMeeting,
    title: 'هدف جديد على اجتماع ملغي',
  });
  assert.equal(addGoalRes.ok, false);

  const updateGoalRes = updatePreparationGoal({
    meeting: cancelledMeeting,
    goalId,
    status: 'achieved',
  });
  assert.equal(updateGoalRes.ok, false);

  const notesRes = updatePreparationNotes({
    meeting: cancelledMeeting,
    notes: 'محاولة تعديل ملاحظات اجتماع ملغي',
  });
  assert.equal(notesRes.ok, false);
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
  });

  assert.equal(offlineBrief.completeness.isOnline, false);
  assert.equal(offlineBrief.completeness.isCompleteOnline, false);
  assert.ok(offlineBrief.completeness.disclosureAr.includes('دون اتصال'));

  const plainText = formatPreparationBriefPlainText(offlineBrief);
  assert.ok(plainText.includes(meeting.title));
  assert.ok(plainText.includes(client.name));

  // Scenario 22: AI Briefing client service blocks immediately when offline without calling fetch
  let fetchCalled = false;
  await assert.rejects(
    () =>
      requestMeetingAiBriefingWithDeps(
        {
          meetingId: MEETING_CURRENT,
          includedSections: ['meeting_details'],
          meetingTitle: meeting.title,
        },
        {
          isOnline: () => false,
          getIdToken: async () => 'token_alice',
          fetchImpl: async () => {
            fetchCalled = true;
            throw new Error('Should not be called when offline');
          },
        }
      ),
    (err: Error) => {
      assert.ok(err.message.includes('الاتصال بالإنترنت'));
      return true;
    }
  );
  assert.equal(fetchCalled, false);
});

test('23, 24, 25 & 26. AI Briefing consent bundle builder respects selected sections only, strips URLs/paths/unauthorized fields, and truncates with warning when exceeding MAX_AI_BRIEFING_TOTAL_CHARS', () => {
  const client = createSampleClient({
    notes: 'ملاحظة خاصة تحتوي على رابط https://secret.example.com/file.pdf ومسار clients/u1/avatars/pic.png',
  });
  const meeting = createSampleMeeting({
    notes: 'ملاحظات مع رابط مرفق https://f005.backblazeb2.com/file/Murafiq/secret.pdf ومسار users/u1/meetings/m1/attachments/a1',
  });

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
        provenance: 'user_approved',
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ],
    notes: [
      {
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
      },
    ],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });

  // Scenario 24: Default selection has client_notes = false
  assert.equal(DEFAULT_AI_BRIEFING_SECTION_SELECTION.client_notes, false);

  const bundleWithoutNotes = buildMeetingAiBriefingInputBundle(brief, {
    ...DEFAULT_AI_BRIEFING_SECTION_SELECTION,
    open_tasks: false,
    client_notes: false,
  });

  assert.equal(bundleWithoutNotes.payload.includedSections.includes('open_tasks'), false);
  assert.equal(bundleWithoutNotes.payload.openTasksContext, undefined);
  assert.equal(bundleWithoutNotes.payload.clientNotesContext, undefined);

  // Scenario 25: Redaction of URLs and storage paths
  assert.equal(
    bundleWithoutNotes.previewText.includes('backblazeb2.com'),
    false,
    'Signed B2 URLs must be redacted from AI bundle'
  );
  assert.ok(bundleWithoutNotes.previewText.includes('[تم حجب رابط مرفق خاص]'));
  assert.ok(bundleWithoutNotes.previewText.includes('[تم حجب مسار تخزين خاص]'));

  // Scenario 26: Truncation when exceeding MAX_AI_BRIEFING_TOTAL_CHARS
  const hugeNotesMeeting = createSampleMeeting({
    notes: 'سجل نقاش طويل جداً '.repeat(900),
  });
  const hugeBrief = buildMeetingPreparationBrief({
    meeting: hugeNotesMeeting,
    clients: [client],
    meetings: [hugeNotesMeeting],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
    interactions: [],
    currentUserId: USER_A,
    referenceDate: REF_DATE,
  });
  const hugeBundle = buildMeetingAiBriefingInputBundle(
    hugeBrief,
    DEFAULT_AI_BRIEFING_SECTION_SELECTION
  );
  assert.equal(hugeBundle.wasTruncated, true);
  assert.ok(hugeBundle.totalChars <= MAX_AI_BRIEFING_TOTAL_CHARS + 100);
  assert.ok(hugeBundle.warnings.some((w) => w.includes('اقتطاع')));
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
        includedSections: ['meeting_details'],
        meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
      }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test('28. Security: User B attempting to request AI briefing for User A meeting is rejected with 403', async () => {
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
        includedSections: ['meeting_details'],
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
        includedSections: ['meeting_details'],
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
        includedSections: ['meeting_details'],
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
        return validateAndNormalizeMeetingBriefingAi(createValidGeminiBriefingPayload(), {
          model: DEFAULT_GEMINI_MEETING_MODEL,
        });
      },
    })
  );

  try {
    const reqBody = JSON.stringify({
      meetingId: MEETING_CURRENT,
      includedSections: ['meeting_details'],
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

    // Give first request 30ms to enter inFlightBriefings
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

  await assert.rejects(
    () =>
      requestMeetingAiBriefingWithDeps(
        {
          meetingId: MEETING_CURRENT,
          includedSections: ['meeting_details'],
          meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
        },
        {
          isOnline: () => true,
          getIdToken: async () => 'token_alice',
          fetchImpl: async (_input, init) => {
            if (init?.signal?.aborted) {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              throw abortErr;
            }
            throw new Error('Should have been aborted');
          },
        },
        controller.signal
      ),
    (err: Error) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

// ============================================================================
// SCENARIOS 32 - 35: GEMINI BRIEFING VALIDATION & HUMAN APPROVAL WITHOUT DUPLICATES
// ============================================================================

test('32. Gemini output validator normalizes talkingPoints basisType (documented_fact, inference, ai_suggestion) and rejects malformed payloads', async () => {
  const sanitizedInput = sanitizeIncomingAiBriefingPayload({
    meetingId: MEETING_CURRENT,
    includedSections: ['meeting_details', 'client_overview'],
    meetingTitle: 'اجتماع مراجعة العرض الفني والاعتماد المالي',
    clientOverview: 'العميل: ماجد السبيعي — شركة آفاق الحلول الرقمية',
  });
  assert.equal(sanitizedInput.ok, true);

  const prompt = buildMeetingBriefingUserPrompt(sanitizedInput.payload!);
  assert.ok(prompt.includes('اجتماع مراجعة العرض الفني والاعتماد المالي'));

  const result = await generateMeetingBriefingWithGemini(sanitizedInput.payload!, {
    apiKey: 'test_server_key_only',
    callModel: async () => ({
      text: JSON.stringify(createValidGeminiBriefingPayload()),
    }),
  });

  assert.equal(result.talkingPoints.length, 3);
  assert.equal(result.talkingPoints[0].basisType, 'documented_fact');
  assert.equal(result.talkingPoints[1].basisType, 'inference');
  assert.equal(result.talkingPoints[2].basisType, 'ai_suggestion');
  assert.equal(result.suggestedQuestions.length, 1);
  assert.equal(result.potentialRisks.length, 1);
  assert.equal(result.expectedOutcomes.length, 1);
});

test('33, 34 & 35. Human approval of AI talking point into agendaItems and AI expected outcome into preparation.goals supports editing and prevents duplicates on repeated clicks', () => {
  let meeting = createSampleMeeting();
  const aiResult = validateAndNormalizeMeetingBriefingAi(
    createValidGeminiBriefingPayload(),
    { model: DEFAULT_GEMINI_MEETING_MODEL }
  );

  // Scenario 33: Approve AI talking point into meeting.agendaItems with user edit
  const tp = aiResult.talkingPoints[0];
  const tpApprove1 = approveAiTalkingPointIntoAgenda({
    meeting,
    talkingPoint: tp,
    customTitle: 'مراجعة واعتماد الملحق المالي المتأخر',
    durationMinutes: 15,
  });
  assert.equal(tpApprove1.ok, true);
  assert.equal(tpApprove1.alreadyExists, false);
  meeting = tpApprove1.meeting;
  assert.equal(meeting.agendaItems?.length, 2);
  assert.equal(
    meeting.agendaItems?.[1].title,
    'مراجعة واعتماد الملحق المالي المتأخر'
  );

  // Scenario 35 (part A): Clicking approve again for the same talking point does not duplicate
  const tpApprove2 = approveAiTalkingPointIntoAgenda({
    meeting,
    talkingPoint: tp,
    customTitle: 'مراجعة واعتماد الملحق المالي المتأخر',
  });
  assert.equal(tpApprove2.ok, false);
  assert.equal(tpApprove2.alreadyExists, true);
  assert.equal(tpApprove2.meeting.agendaItems?.length, 2);

  // Scenario 34: Approve AI expected outcome into meeting.preparation.goals with user edit
  const outcome = aiResult.expectedOutcomes[0];
  const goalApprove1 = approveAiSuggestedGoalIntoMeeting({
    meeting,
    suggestedGoal: outcome,
    customTitle: 'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع',
  });
  assert.equal(goalApprove1.ok, true);
  assert.equal(goalApprove1.alreadyExists, false);
  meeting = goalApprove1.meeting;
  assert.equal(meeting.preparation?.goals?.length, 1);
  assert.equal(meeting.preparation?.goals?.[0].status, 'planned');
  assert.equal(
    meeting.preparation?.goals?.[0].title,
    'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع'
  );

  // Scenario 35 (part B): Clicking approve again for the same outcome does not duplicate
  const goalApprove2 = approveAiSuggestedGoalIntoMeeting({
    meeting,
    suggestedGoal: outcome,
    customTitle: 'الاتفاق النهائي على جدول الدفعات وتاريخ التوقيع',
  });
  assert.equal(goalApprove2.ok, false);
  assert.equal(goalApprove2.alreadyExists, true);
  assert.equal(goalApprove2.meeting.preparation?.goals?.length, 1);
});
