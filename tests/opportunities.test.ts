import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionItem,
  Client,
  FollowUpPreferences,
  Meeting,
  Note,
  Opportunity,
} from '../src/types';
import {
  OPPORTUNITY_ALL_STAGES,
  OPPORTUNITY_CURRENCY_CONFIG,
  OPPORTUNITY_OPEN_STAGES,
  aggregateValuesByCurrency,
  buildOpportunityStageTransition,
  canLinkRecordToOpportunity,
  computeClientOpportunitySummary,
  computeOpportunityPipelineMetrics,
  convertNextActionToTaskDraft,
  createInitialOpportunityEvent,
  evaluateOpportunityFollowUpAlerts,
  extractRelatedDecisionsFromMeetings,
  filterAndSortOpportunities,
  formatOpportunityMoney,
  fromMinorUnits,
  groupOpportunitiesByStage,
  isOpportunityClosed,
  isOpportunityNeedsFollowUp,
  linkMeetingToOpportunity,
  linkTaskToOpportunity,
  sanitizeOpportunityForSave,
  toMinorUnits,
  unlinkMeetingFromOpportunity,
  unlinkTaskFromOpportunity,
  validateOpportunityInput,
} from '../src/utils/opportunities';
import {
  DEFAULT_FOLLOW_UP_PREFERENCES,
  computeDailyCommandSummary,
  evaluateReminders,
} from '../src/utils/followUpEngine';
import { computeDashboardAnalytics, buildAnalyticsSummaryCsv } from '../src/utils/analytics';
import { universalSearch } from '../src/utils/logic';

const REF_DATE = new Date('2026-11-15T10:00:00.000Z');
const REF_NOW_ISO = '2026-11-15T10:00:00.000Z';

const SAMPLE_CLIENTS: Client[] = [
  {
    id: 'client_1',
    userId: 'user_1',
    name: 'شركة الأفق للاستشارات',
    company: 'الأفق',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
  },
  {
    id: 'client_2',
    userId: 'user_1',
    name: 'مجموعة المدار الرقمية',
    company: 'المدار',
    createdAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-11T09:00:00.000Z',
  },
];

test('Task 008 — Opportunity Management & Relationship Pipeline Domain Suite', async (t) => {
  await t.test('1. Validation: required fields, numeric bounds, currency, and date formats', () => {
    const emptyTitle = validateOpportunityInput({
      title: '   ',
      clientId: 'client_1',
      type: 'consulting',
      stage: 'new',
      priority: 'high',
    });
    assert.equal(emptyTitle.valid, false);
    assert.ok(emptyTitle.errorsArabic.some((e: string) => e.includes('عنوان الفرصة')));

    const missingClient = validateOpportunityInput({
      title: 'مشروع حوكمة البيانات',
      clientId: '',
      type: 'consulting',
      stage: 'new',
      priority: 'high',
    });
    assert.equal(missingClient.valid, false);
    assert.ok(missingClient.errorsArabic.some((e: string) => e.includes('العميل')));

    const negativeValue = validateOpportunityInput({
      title: 'مشروع حوكمة البيانات',
      clientId: 'client_1',
      type: 'consulting',
      stage: 'new',
      priority: 'high',
      estimatedValue: -500,
      currency: 'SAR',
    });
    assert.equal(negativeValue.valid, false);

    const missingCurrencyWithValue = validateOpportunityInput({
      title: 'مشروع حوكمة البيانات',
      clientId: 'client_1',
      type: 'consulting',
      stage: 'new',
      priority: 'high',
      estimatedValue: 15000,
    });
    assert.equal(missingCurrencyWithValue.valid, false);

    const invalidDate = validateOpportunityInput({
      title: 'مشروع حوكمة البيانات',
      clientId: 'client_1',
      type: 'consulting',
      stage: 'new',
      priority: 'high',
      expectedCloseDate: '15-11-2026',
    });
    assert.equal(invalidDate.valid, false);

    const validInput = validateOpportunityInput({
      title: 'مشروع التحول المؤسسي',
      clientId: 'client_1',
      type: 'consulting',
      stage: 'proposal',
      priority: 'urgent',
      estimatedValue: 120000,
      currency: 'SAR',
      expectedCloseDate: '2026-12-01',
      nextAction: 'إرسال العرض المالي النهائي',
      nextActionDate: '2026-11-20',
    });
    assert.equal(validInput.valid, true);
    assert.equal(validInput.errorsArabic.length, 0);
  });

  await t.test('2. Sanitization & Initial Stage Event deterministic ID (prevents duplicate retry events)', () => {
    const opp = sanitizeOpportunityForSave({
      id: 'opp_fixed_1',
      userId: 'user_1',
      clientId: 'client_1',
      title: '  عقد استشارات استراتيجية  ',
      type: 'consulting',
      stage: 'qualification',
      priority: 'high',
      estimatedValue: 45000.556,
      currency: 'SAR',
      nextAction: '  إعداد مسودة العرض  ',
      nextActionDate: '2026-11-20',
      createdAt: REF_NOW_ISO,
      updatedAt: REF_NOW_ISO,
    });

    assert.equal(opp.id, 'opp_fixed_1');
    assert.equal(opp.title, 'عقد استشارات استراتيجية');
    assert.equal(opp.estimatedValue, 45000.56);
    assert.equal(opp.currency, 'SAR');
    assert.equal(opp.updatedAt, REF_NOW_ISO);

    const evt1 = createInitialOpportunityEvent(opp, 'ملاحظة أولية');
    const evt2 = createInitialOpportunityEvent(opp, 'ملاحظة أولية');
    assert.equal(evt1.id, 'evt_init_opp_fixed_1');
    assert.equal(
      evt1.id,
      evt2.id,
      'Initial event ID must be deterministic per opportunity ID to prevent duplicate retry events'
    );
    assert.equal(evt1.eventType, 'created');
    assert.equal(evt1.toStage, 'qualification');
    assert.equal(evt1.fromStage, undefined);
  });

  await t.test('3. Stage Transitions: open-to-open transitions immediately, closing & reopening require explicit confirmation', () => {
    const baseOpp = sanitizeOpportunityForSave({
      id: 'opp_trans_1',
      userId: 'user_1',
      clientId: 'client_1',
      title: 'فرصة شراكة تقنية',
      type: 'partnership',
      stage: 'new',
      priority: 'medium',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    });

    // Open -> Open (new -> proposal) does not require modal confirmation
    const openMove = buildOpportunityStageTransition({
      opportunity: baseOpp,
      targetStage: 'proposal',
      confirmed: false,
      nowIso: '2026-11-05T10:00:00.000Z',
    });
    assert.equal(openMove.allowed, true);
    assert.equal(openMove.requiresConfirmation, false);
    assert.equal(openMove.opportunity?.stage, 'proposal');
    assert.equal(openMove.stageEvent?.eventType, 'stage_changed');
    assert.equal(openMove.stageEvent?.fromStage, 'new');
    assert.equal(openMove.stageEvent?.toStage, 'proposal');

    // Open -> Won WITHOUT confirmation must require confirmation
    const unconfirmedWon = buildOpportunityStageTransition({
      opportunity: openMove.opportunity!,
      targetStage: 'won',
      confirmed: false,
      nowIso: '2026-11-10T10:00:00.000Z',
    });
    assert.equal(unconfirmedWon.allowed, false);
    assert.equal(unconfirmedWon.requiresConfirmation, true);
    assert.equal(unconfirmedWon.confirmationKind, 'close');

    // Open -> Lost WITH confirmation records closedAt, lostReason, and closed_lost event
    const confirmedLost = buildOpportunityStageTransition({
      opportunity: openMove.opportunity!,
      targetStage: 'lost',
      confirmed: true,
      lostReason: 'تأجيل الميزانية للعام القادم',
      note: 'سيتم التواصل مجدداً في الربع الأول',
      nowIso: '2026-11-12T10:00:00.000Z',
    });
    assert.equal(confirmedLost.allowed, true);
    assert.equal(confirmedLost.opportunity?.stage, 'lost');
    assert.equal(confirmedLost.opportunity?.closedAt, '2026-11-12T10:00:00.000Z');
    assert.equal(confirmedLost.opportunity?.lostReason, 'تأجيل الميزانية للعام القادم');
    assert.equal(confirmedLost.stageEvent?.eventType, 'closed_lost');
    assert.equal(confirmedLost.stageEvent?.note, 'سيتم التواصل مجدداً في الربع الأول');

    // Closed -> Reopen WITHOUT confirmation must require confirmation
    const unconfirmedReopen = buildOpportunityStageTransition({
      opportunity: confirmedLost.opportunity!,
      targetStage: 'negotiation',
      confirmed: false,
      nowIso: '2026-11-14T10:00:00.000Z',
    });
    assert.equal(unconfirmedReopen.allowed, false);
    assert.equal(unconfirmedReopen.requiresConfirmation, true);
    assert.equal(unconfirmedReopen.confirmationKind, 'reopen');

    // Closed -> Reopen WITH confirmation clears closedAt and records reopenedAt + reopened event
    const confirmedReopen = buildOpportunityStageTransition({
      opportunity: confirmedLost.opportunity!,
      targetStage: 'negotiation',
      confirmed: true,
      note: 'العميل أعاد تفعيل الميزانية',
      nowIso: '2026-11-14T12:00:00.000Z',
    });
    assert.equal(confirmedReopen.allowed, true);
    assert.equal(confirmedReopen.opportunity?.stage, 'negotiation');
    assert.equal(confirmedReopen.opportunity?.closedAt, undefined);
    assert.equal(confirmedReopen.opportunity?.lostReason, undefined);
    assert.equal(confirmedReopen.opportunity?.reopenedAt, '2026-11-14T12:00:00.000Z');
    assert.equal(confirmedReopen.stageEvent?.eventType, 'reopened');
    assert.equal(confirmedReopen.stageEvent?.fromStage, 'lost');
    assert.equal(confirmedReopen.stageEvent?.toStage, 'negotiation');
  });

  await t.test('4. Multi-currency minor-unit integer math & JOD 3-decimal precision without FX mixing', () => {
    assert.equal(OPPORTUNITY_CURRENCY_CONFIG.JOD.decimals, 3);
    assert.equal(OPPORTUNITY_CURRENCY_CONFIG.SAR.decimals, 2);

    // Classic float drift check: 10.125 + 20.375 in JOD
    const jodMinor1 = toMinorUnits(10.125, 'JOD');
    const jodMinor2 = toMinorUnits(20.375, 'JOD');
    assert.equal(jodMinor1, 10125);
    assert.equal(jodMinor2, 20375);
    assert.equal(fromMinorUnits(jodMinor1 + jodMinor2, 'JOD'), 30.5);

    const opps: Opportunity[] = [
      sanitizeOpportunityForSave({
        id: 'o_sar_1',
        userId: 'u1',
        clientId: 'client_1',
        title: 'فرصة 1',
        stage: 'proposal',
        estimatedValue: 100.1,
        currency: 'SAR',
      }),
      sanitizeOpportunityForSave({
        id: 'o_sar_2',
        userId: 'u1',
        clientId: 'client_1',
        title: 'فرصة 2',
        stage: 'negotiation',
        estimatedValue: 200.2,
        currency: 'SAR',
      }),
      sanitizeOpportunityForSave({
        id: 'o_jod_1',
        userId: 'u1',
        clientId: 'client_2',
        title: 'فرصة الأردن',
        stage: 'proposal',
        estimatedValue: 1500.125,
        currency: 'JOD',
      }),
      sanitizeOpportunityForSave({
        id: 'o_usd_1',
        userId: 'u1',
        clientId: 'client_2',
        title: 'فرصة دولية',
        stage: 'new',
        estimatedValue: 5000,
        currency: 'USD',
      }),
    ];

    const totals = aggregateValuesByCurrency(opps);
    assert.equal(totals.length, 3, 'Must keep SAR, USD, and JOD strictly separated');
    const sarTotal = totals.find((t) => t.currency === 'SAR');
    const jodTotal = totals.find((t) => t.currency === 'JOD');
    const usdTotal = totals.find((t) => t.currency === 'USD');

    assert.equal(sarTotal?.totalAmount, 300.3);
    assert.equal(sarTotal?.count, 2);
    assert.equal(jodTotal?.totalAmount, 1500.125);
    assert.equal(jodTotal?.count, 1);
    assert.equal(usdTotal?.totalAmount, 5000);
    assert.ok(formatOpportunityMoney(1500.125, 'JOD').includes('1,500.125'));
  });

  await t.test('5. Linking & Unlinking Meetings and Tasks (Same-Client enforcement & record preservation)', () => {
    const oppClient1 = sanitizeOpportunityForSave({
      id: 'opp_c1',
      userId: 'user_1',
      clientId: 'client_1',
      title: 'فرصة العميل الأول',
      stage: 'proposal',
    });

    const meetingClient1: Meeting = {
      id: 'm_c1',
      userId: 'user_1',
      clientId: 'client_1',
      title: 'اجتماع العميل الأول',
      dateTime: '2026-11-16T10:00:00.000Z',
      type: 'video',
      status: 'confirmed',
      notes: 'ملاحظات هامة',
      photoPaths: [],
      decisions: [
        {
          id: 'dec_1',
          text: 'الموافقة المبدئية على النطاق الفني',
          ownerName: 'أ. خالد',
          createdAt: '2026-11-16T10:30:00.000Z',
        },
      ],
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z',
    };

    const meetingClient2: Meeting = {
      ...meetingClient1,
      id: 'm_c2',
      clientId: 'client_2',
    };

    // Cross-client link MUST fail
    assert.equal(canLinkRecordToOpportunity('client_2', oppClient1).ok, false);
    const crossLinkRes = linkMeetingToOpportunity(meetingClient2, oppClient1);
    assert.equal(crossLinkRes.ok, false);

    // Same-client link succeeds
    const validLinkRes = linkMeetingToOpportunity(meetingClient1, oppClient1);
    assert.equal(validLinkRes.ok, true);
    assert.equal(validLinkRes.meeting?.opportunityId, 'opp_c1');

    // Decisions extracted from linked meetings
    const decisions = extractRelatedDecisionsFromMeetings([validLinkRes.meeting!], 'opp_c1');
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].text, 'الموافقة المبدئية على النطاق الفني');

    // Unlinking removes opportunityId ONLY and preserves the meeting intact
    const unlinkedMeeting = unlinkMeetingFromOpportunity(validLinkRes.meeting!);
    assert.equal(unlinkedMeeting.opportunityId, undefined);
    assert.equal(unlinkedMeeting.id, 'm_c1');
    assert.equal(unlinkedMeeting.title, 'اجتماع العميل الأول');
    assert.equal(unlinkedMeeting.decisions?.length, 1);

    // Task linking & unlinking
    const taskClient1: ActionItem = {
      id: 't_c1',
      userId: 'user_1',
      clientId: 'client_1',
      title: 'مهمة العميل الأول',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-10T10:00:00.000Z',
    };
    const linkedTaskRes = linkTaskToOpportunity(taskClient1, oppClient1);
    assert.equal(linkedTaskRes.ok, true);
    assert.equal(linkedTaskRes.task?.opportunityId, 'opp_c1');

    const unlinkedTask = unlinkTaskFromOpportunity(linkedTaskRes.task!);
    assert.equal(unlinkedTask.opportunityId, undefined);
    assert.equal(unlinkedTask.id, 't_c1');
    assert.equal(unlinkedTask.title, 'مهمة العميل الأول');

    // Converting Next Action to a linked Task
    const oppWithNextAction = sanitizeOpportunityForSave({
      ...oppClient1,
      nextAction: 'إرسال مسودة الاتفاقية القانونية',
      nextActionDate: '2026-11-22',
    });
    const draftRes = convertNextActionToTaskDraft(oppWithNextAction, REF_DATE.getTime());
    assert.equal(draftRes.ok, true);
    assert.equal(draftRes.task?.clientId, 'client_1');
    assert.equal(draftRes.task?.opportunityId, 'opp_c1');
    assert.equal(draftRes.task?.title, 'إرسال مسودة الاتفاقية القانونية');
    assert.equal(draftRes.task?.dueDate, '2026-11-22');
  });

  await t.test('6. Follow-Up Alerts & Closed Opportunity Exclusion (Won/Lost never trigger overdue alerts)', () => {
    const overdueOpenOpp = sanitizeOpportunityForSave({
      id: 'opp_overdue_open',
      userId: 'user_1',
      clientId: 'client_1',
      title: 'فرصة مفتوحة متأخرة',
      stage: 'negotiation',
      expectedCloseDate: '2026-11-10', // before 2026-11-15
      nextAction: '', // missing next action!
      nextActionDate: '2026-11-12', // before 2026-11-15
      updatedAt: '2026-10-20T10:00:00.000Z', // > 14 days stale
    });

    const openAlerts = evaluateOpportunityFollowUpAlerts({
      opportunity: overdueOpenOpp,
      referenceDate: REF_DATE,
    });
    assert.equal(openAlerts.length, 4);
    assert.equal(isOpportunityNeedsFollowUp(overdueOpenOpp, REF_DATE), true);

    // Now close as Won or Lost -> MUST return 0 follow-up alerts
    const closedWonOpp: Opportunity = {
      ...overdueOpenOpp,
      id: 'opp_closed_won',
      stage: 'won',
      closedAt: '2026-11-14T10:00:00.000Z',
    };
    const closedLostOpp: Opportunity = {
      ...overdueOpenOpp,
      id: 'opp_closed_lost',
      stage: 'lost',
      closedAt: '2026-11-14T10:00:00.000Z',
    };

    assert.equal(isOpportunityClosed(closedWonOpp.stage), true);
    assert.equal(isOpportunityClosed(closedLostOpp.stage), true);
    assert.equal(
      evaluateOpportunityFollowUpAlerts({
        opportunity: closedWonOpp,
        referenceDate: REF_DATE,
      }).length,
      0
    );
    assert.equal(
      evaluateOpportunityFollowUpAlerts({
        opportunity: closedLostOpp,
        referenceDate: REF_DATE,
      }).length,
      0
    );
  });

  await t.test('7. Smart Follow-Up Engine («يومي») integration for overdue opportunities', () => {
    const prefs: FollowUpPreferences = {
      ...DEFAULT_FOLLOW_UP_PREFERENCES,
      userId: 'user_1',
    };

    const opps: Opportunity[] = [
      sanitizeOpportunityForSave({
        id: 'opp_rem_1',
        userId: 'user_1',
        clientId: 'client_1',
        title: 'فرصة متابعة عاجلة',
        stage: 'proposal',
        priority: 'high',
        nextAction: 'الاتصال بالمدير المالي',
        nextActionDate: '2026-11-12', // Overdue relative to 2026-11-15
        expectedCloseDate: '2026-11-14', // Overdue close date
      }),
      sanitizeOpportunityForSave({
        id: 'opp_rem_closed',
        userId: 'user_1',
        clientId: 'client_1',
        title: 'فرصة مغلقة لا تنبه',
        stage: 'won',
        nextActionDate: '2026-11-01',
        expectedCloseDate: '2026-11-01',
        closedAt: '2026-11-05T10:00:00.000Z',
      }),
    ];

    const summary = computeDailyCommandSummary({
      clients: SAMPLE_CLIENTS,
      meetings: [],
      tasks: [],
      opportunities: opps,
      preferences: prefs,
      referenceDate: REF_DATE,
    });
    assert.equal(summary.overdueOpportunitiesCount, 1);

    const evaluated = evaluateReminders({
      clients: SAMPLE_CLIENTS,
      meetings: [],
      tasks: [],
      opportunities: opps,
      persistedStates: [],
      preferences: prefs,
      referenceDate: REF_DATE,
    });

    const oppReminders = evaluated.active.filter((r) => r.sourceType === 'opportunity');
    assert.ok(oppReminders.length >= 1);
    assert.ok(oppReminders.every((r) => r.sourceId === 'opp_rem_1'));
  });

  await t.test('8. Filtering, Sorting, Kanban Grouping, Client 360 Summary & Orphan Client Resilience', () => {
    const opps: Opportunity[] = [
      sanitizeOpportunityForSave({
        id: 'o1',
        userId: 'u1',
        clientId: 'client_1',
        title: 'تطوير منصة سحابية',
        type: 'project',
        stage: 'proposal',
        priority: 'high',
        estimatedValue: 90000,
        currency: 'SAR',
        expectedCloseDate: '2026-12-01',
        nextAction: 'مراجعة العرض',
        nextActionDate: '2026-11-18',
        updatedAt: '2026-11-14T10:00:00.000Z',
      }),
      sanitizeOpportunityForSave({
        id: 'o2',
        userId: 'u1',
        clientId: 'deleted_client_999', // Orphan client!
        title: 'استشارة حوكمة لعميل محذوف',
        type: 'consulting',
        stage: 'won',
        priority: 'medium',
        estimatedValue: 30000,
        currency: 'SAR',
        closedAt: '2026-11-13T10:00:00.000Z',
        updatedAt: '2026-11-13T10:00:00.000Z',
      }),
    ];

    // Search by client name or title
    const searchHorizon = filterAndSortOpportunities(opps, {
      clients: SAMPLE_CLIENTS,
      searchQuery: 'الأفق',
      referenceDate: REF_DATE,
    });
    assert.equal(searchHorizon.length, 1);
    assert.equal(searchHorizon[0].id, 'o1');

    // Kanban grouping has all 6 stages
    const grouped = groupOpportunitiesByStage(opps);
    assert.equal(OPPORTUNITY_ALL_STAGES.length, 6);
    assert.equal(OPPORTUNITY_OPEN_STAGES.length, 4);
    assert.equal(grouped.proposal.length, 1);
    assert.equal(grouped.won.length, 1);

    // Pipeline metrics
    const metrics = computeOpportunityPipelineMetrics(opps, REF_DATE);
    assert.equal(metrics.openCount, 1);
    assert.equal(metrics.wonCount, 1);
    assert.equal(metrics.lostCount, 0);

    // Client 360 summary for client_1
    const c1Summary = computeClientOpportunitySummary(opps, 'client_1', REF_DATE);
    assert.equal(c1Summary.openCount, 1);
    assert.equal(c1Summary.openTotalsByCurrency[0].totalAmount, 90000);

    // Universal search includes opportunities
    const searchRes = universalSearch('منصة سحابية', {
      clients: SAMPLE_CLIENTS,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: opps,
    });
    assert.equal(searchRes.opportunities.length, 1);
    assert.equal(searchRes.opportunities[0].id, 'o1');
  });

  await t.test('9. Regression Invariance: Task 007 Analytics metrics & CSV remain 100% unchanged', () => {
    const meetings: Meeting[] = [
      {
        id: 'm1',
        userId: 'user_1',
        clientId: 'client_1',
        title: 'اجتماع تحليلي',
        dateTime: '2026-11-10T10:00:00.000Z',
        type: 'in_person',
        status: 'completed',
        notes: 'تم الاجتماع',
        photoPaths: [],
        createdAt: '2026-11-10T09:00:00.000Z',
        updatedAt: '2026-11-10T09:00:00.000Z',
      },
    ];
    const tasks: ActionItem[] = [
      {
        id: 't1',
        userId: 'user_1',
        clientId: 'client_1',
        title: 'مهمة مكتملة',
        priority: 'high',
        status: 'completed',
        dueDate: '2026-11-12',
        completedAt: '2026-11-11T10:00:00.000Z',
        createdAt: '2026-11-05T10:00:00.000Z',
      },
    ];
    const notes: Note[] = [];

    const report = computeDashboardAnalytics({
      clients: SAMPLE_CLIENTS,
      meetings,
      tasks,
      notes,
      preset: '30d',
      referenceDate: REF_DATE,
    });

    assert.equal(report.kpis.heldMeetingsInPeriod, 1);
    assert.equal(report.kpis.tasksCompletedInPeriod, 1);
    const csv = buildAnalyticsSummaryCsv(report, 'ar');
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('المهام المنجزة خلال الفترة'));
  });
});
