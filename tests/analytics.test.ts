import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionItem, Client, Meeting, Note } from '../src/types';
import {
  buildAnalyticsSummaryCsv,
  computeDashboardAnalytics,
  getPreviousEquivalentRange,
  resolveAnalyticsDateRange,
  sanitizeCsvCell,
} from '../src/utils/analytics';
import { evaluateClientAttentionAlerts } from '../src/utils/client360';
import { categorizeDailyWorkTasks } from '../src/utils/followUpEngine';

const REF_DATE = new Date('2026-11-14T10:00:00.000Z'); // 2026-11-14T13:00:00+03:00 in Asia/Riyadh

function makeClient(overrides: Partial<Client> & { id: string; name: string }): Client {
  return {
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeMeeting(
  overrides: Partial<Meeting> & { id: string; clientId: string; title: string; dateTime: string }
): Meeting {
  return {
    type: 'in_person',
    notes: '',
    status: 'confirmed',
    photoPaths: [],
    createdAt: overrides.dateTime,
    updatedAt: overrides.dateTime,
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<ActionItem> & { id: string; clientId: string; title: string }
): ActionItem {
  return {
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeNote(overrides: Partial<Note> & { id: string; title: string }): Note {
  return {
    content: 'ملاحظة اختبارية',
    tags: ['متابعة'],
    isPinned: false,
    createdAt: '2026-11-05T09:00:00.000Z',
    ...overrides,
  };
}

test('resolveAnalyticsDateRange handles all 7 presets and validates custom range boundaries', () => {
  const tz = 'Asia/Riyadh';

  const r7 = resolveAnalyticsDateRange({ preset: '7d', referenceDate: REF_DATE, timeZone: tz });
  assert.equal(r7.startKey, '2026-11-08');
  assert.equal(r7.endKey, '2026-11-14');
  assert.equal(r7.daysCount, 7);
  assert.equal(r7.granularity, 'day');

  const r30 = resolveAnalyticsDateRange({ preset: '30d', referenceDate: REF_DATE, timeZone: tz });
  assert.equal(r30.startKey, '2026-10-16');
  assert.equal(r30.endKey, '2026-11-14');
  assert.equal(r30.daysCount, 30);
  assert.equal(r30.granularity, 'day');

  const r90 = resolveAnalyticsDateRange({ preset: '90d', referenceDate: REF_DATE, timeZone: tz });
  assert.equal(r90.daysCount, 90);
  assert.equal(r90.granularity, 'week');

  const rThisMonth = resolveAnalyticsDateRange({
    preset: 'this_month',
    referenceDate: REF_DATE,
    timeZone: tz,
  });
  assert.equal(rThisMonth.startKey, '2026-11-01');
  assert.equal(rThisMonth.endKey, '2026-11-14');
  assert.equal(rThisMonth.daysCount, 14);

  const rLastMonth = resolveAnalyticsDateRange({
    preset: 'last_month',
    referenceDate: REF_DATE,
    timeZone: tz,
  });
  assert.equal(rLastMonth.startKey, '2026-10-01');
  assert.equal(rLastMonth.endKey, '2026-10-31');
  assert.equal(rLastMonth.daysCount, 31);

  const rThisYear = resolveAnalyticsDateRange({
    preset: 'this_year',
    referenceDate: REF_DATE,
    timeZone: tz,
  });
  assert.equal(rThisYear.startKey, '2026-01-01');
  assert.equal(rThisYear.endKey, '2026-11-14');
  assert.equal(rThisYear.granularity, 'month');

  const rCustomValid = resolveAnalyticsDateRange({
    preset: 'custom',
    customRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
    referenceDate: REF_DATE,
    timeZone: tz,
  });
  assert.equal(rCustomValid.isValid, true);
  assert.equal(rCustomValid.daysCount, 10);

  const rCustomInvalid = resolveAnalyticsDateRange({
    preset: 'custom',
    customRange: { startDate: '2026-11-20', endDate: '2026-11-10' },
    referenceDate: REF_DATE,
    timeZone: tz,
  });
  assert.equal(rCustomInvalid.isValid, false);
  assert.ok(rCustomInvalid.validationErrorAr);
});

test('getPreviousEquivalentRange returns an exact equal-length prior range', () => {
  const current = resolveAnalyticsDateRange({
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  const prev = getPreviousEquivalentRange(current);
  assert.equal(prev.startKey, '2026-11-01');
  assert.equal(prev.endKey, '2026-11-07');
  assert.equal(prev.daysCount, 7);
});

test('strict meeting held semantics: only status=completed counts as held (never past confirmed, cancelled, or final minutes)', () => {
  const clients = [
    makeClient({ id: 'c1', name: 'شركة المدار' }),
    makeClient({ id: 'c2', name: 'مكتب السحاب' }),
  ];

  const meetings: Meeting[] = [
    // Completed -> HELD
    makeMeeting({
      id: 'm1',
      clientId: 'c1',
      title: 'اجتماع منتهي فعليًا',
      dateTime: '2026-11-10T09:00:00.000Z',
      status: 'completed',
      minutesStatus: 'draft',
    }),
    // Past confirmed with final minutes -> NOT held
    makeMeeting({
      id: 'm2',
      clientId: 'c2',
      title: 'اجتماع مؤكد ماضي بمحضر نهائي',
      dateTime: '2026-11-09T09:00:00.000Z',
      status: 'confirmed',
      minutesStatus: 'final',
    }),
    // Past draft -> NOT held
    makeMeeting({
      id: 'm3',
      clientId: 'c2',
      title: 'اجتماع مسودة ماضي',
      dateTime: '2026-11-08T09:00:00.000Z',
      status: 'draft',
    }),
    // Cancelled -> NOT held, NOT in active client count
    makeMeeting({
      id: 'm4',
      clientId: 'c2',
      title: 'اجتماع ملغى',
      dateTime: '2026-11-11T09:00:00.000Z',
      status: 'cancelled',
    }),
    // Upcoming active -> upcomingMeetings
    makeMeeting({
      id: 'm5',
      clientId: 'c1',
      title: 'اجتماع قادم',
      dateTime: '2026-11-16T09:00:00.000Z',
      status: 'confirmed',
    }),
  ];

  const snapshot = computeDashboardAnalytics({
    clients,
    meetings,
    tasks: [],
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });

  assert.equal(snapshot.kpis.heldMeetingsInPeriod, 1);
  assert.equal(snapshot.kpis.cancelledMeetingsInPeriod, 1);
  assert.equal(snapshot.kpis.upcomingMeetings, 1);
  assert.equal(snapshot.kpis.avgMeetingsPerWeek, 1);
  // c1 (m1) + c2 (m2, m3 non-cancelled in period) = 2 clients; m4 cancelled ignored
  assert.equal(snapshot.kpis.clientsWithMeetingsInPeriod, 2);

  // If m2 & m3 were in a different client c3, cancelled m4 alone must NOT count c2
  const snapshotCancelledOnly = computeDashboardAnalytics({
    clients,
    meetings: [meetings[0], meetings[3]],
    tasks: [],
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(snapshotCancelledOnly.kpis.clientsWithMeetingsInPeriod, 1);
});

test('strict task completedAt semantics: legacy completed tasks without completedAt are not guessed into date buckets', () => {
  const clients = [makeClient({ id: 'c1', name: 'شركة الرواد' })];
  const tasks: ActionItem[] = [
    // Created & completed inside 7d with valid completedAt
    makeTask({
      id: 't1',
      clientId: 'c1',
      title: 'مهمة موثقة الإنجاز',
      status: 'completed',
      createdAt: '2026-11-09T09:00:00.000Z',
      completedAt: '2026-11-11T10:00:00.000Z',
    }),
    // Legacy completed WITHOUT completedAt -> must NOT enter tasksCompletedInPeriod or trend buckets
    makeTask({
      id: 't2',
      clientId: 'c1',
      title: 'مهمة منجزة قديمة بلا تاريخ إنجاز',
      status: 'completed',
      createdAt: '2026-11-10T09:00:00.000Z',
      dueDate: '2026-11-12',
    }),
    // Open overdue task
    makeTask({
      id: 't3',
      clientId: 'c1',
      title: 'مهمة متأخرة عاجلة',
      status: 'pending',
      priority: 'urgent',
      dueDate: '2026-11-12',
      createdAt: '2026-11-08T09:00:00.000Z',
    }),
    // Open non-overdue task (due today)
    makeTask({
      id: 't4',
      clientId: 'c1',
      title: 'مهمة اليوم',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-11-14',
      createdAt: '2026-11-14T07:00:00.000Z',
    }),
  ];

  const snapshot = computeDashboardAnalytics({
    clients,
    meetings: [],
    tasks,
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });

  assert.equal(snapshot.kpis.tasksCreatedInPeriod, 4);
  assert.equal(snapshot.kpis.tasksCompletedInPeriod, 1);
  assert.equal(snapshot.kpis.completedTasksTotal, 2);
  assert.equal(snapshot.kpis.completedWithoutTimestampCount, 1);
  assert.equal(snapshot.kpis.openTasksCurrent, 2);
  assert.equal(snapshot.kpis.overdueTasksCurrent, 1);
  // Cohort completion rate: 2 out of 4 tasks created in period are currently completed => 50%
  assert.equal(snapshot.kpis.taskCompletionRateInPeriod, 50);

  const trendSum = snapshot.tasks.completedTrendSeries.reduce(
    (s, p) => s + p.completedTasks,
    0
  );
  assert.equal(trendSum, 1);
  assert.ok(snapshot.insights.some((i) => i.id === 'insight:missing_completed_at'));
});

test('cohort completion rate handles 0 tasks created cleanly without NaN', () => {
  const snapshot = computeDashboardAnalytics({
    clients: [makeClient({ id: 'c1', name: 'عميل' })],
    meetings: [],
    tasks: [],
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(snapshot.kpis.taskCompletionRateInPeriod, null);
});

test('timezone invariance: date-only dueDate behaves consistently across Asia/Riyadh and America/Los_Angeles', () => {
  const client = makeClient({ id: 'c1', name: 'عميل عالمي' });
  const taskDueYesterday = makeTask({
    id: 't-tz',
    clientId: 'c1',
    title: 'مهمة استحقاق يوم محدد',
    dueDate: '2026-11-13',
    createdAt: '2026-11-10T12:00:00.000Z',
  });

  // 2026-11-14T12:00:00Z is Nov 14 in BOTH Riyadh (+3 -> 15:00) and LA (-8 -> 04:00)
  const noonUtcRef = new Date('2026-11-14T12:00:00.000Z');

  const riyadh = computeDashboardAnalytics({
    clients: [client],
    meetings: [],
    tasks: [taskDueYesterday],
    notes: [],
    preset: '7d',
    referenceDate: noonUtcRef,
    timeZone: 'Asia/Riyadh',
  });
  const la = computeDashboardAnalytics({
    clients: [client],
    meetings: [],
    tasks: [taskDueYesterday],
    notes: [],
    preset: '7d',
    referenceDate: noonUtcRef,
    timeZone: 'America/Los_Angeles',
  });

  assert.equal(riyadh.kpis.overdueTasksCurrent, 1);
  assert.equal(la.kpis.overdueTasksCurrent, 1);

  const dailyLa = categorizeDailyWorkTasks([taskDueYesterday], noonUtcRef, 'America/Los_Angeles');
  assert.equal(dailyLa.overdue.length, 1);
});

test('period comparisons prevent misleading percentage when previous baseline is zero and avoid double counting activities', () => {
  const c1 = makeClient({
    id: 'c1',
    name: 'عميل أول',
    createdAt: '2026-11-09T09:00:00.000Z',
  });
  const m1 = makeMeeting({
    id: 'm1',
    clientId: 'c1',
    title: 'لقاء 1',
    dateTime: '2026-11-10T09:00:00.000Z',
    status: 'completed',
  });
  const t1 = makeTask({
    id: 't1',
    clientId: 'c1',
    title: 'مهمة 1',
    status: 'completed',
    createdAt: '2026-11-10T10:00:00.000Z',
    completedAt: '2026-11-11T10:00:00.000Z',
  });
  const n1 = makeNote({
    id: 'n1',
    clientId: 'c1',
    title: 'ملاحظة 1',
    createdAt: '2026-11-12T10:00:00.000Z',
  });

  const snapshot = computeDashboardAnalytics({
    clients: [c1],
    meetings: [m1],
    tasks: [t1],
    notes: [n1],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });

  const heldComp = snapshot.comparisons.find((c) => c.key === 'heldMeetings')!;
  assert.equal(heldComp.current, 1);
  assert.equal(heldComp.previous, 0);
  assert.equal(heldComp.hasValidBase, false);
  assert.equal(heldComp.percentChange, null);
  assert.ok(heldComp.noBaseMessageAr.includes('لا تتوفر قاعدة مناسبة'));

  // Logged activities: 1 meeting + 1 task + 1 note = 3 (no duplicate counting)
  const actComp = snapshot.comparisons.find((c) => c.key === 'loggedActivities')!;
  assert.equal(actComp.current, 3);
});

test('held meetings drop insight triggers only with meaningful baseline (>= 2) and >= 25% drop', () => {
  const c1 = makeClient({ id: 'c1', name: 'عميل' });
  const prevOnlyOne = [
    makeMeeting({
      id: 'm-prev-1',
      clientId: 'c1',
      title: 'لقاء سابق وحيد',
      dateTime: '2026-11-04T09:00:00.000Z',
      status: 'completed',
    }),
  ];

  // Baseline = 1 -> 0 must NOT trigger noisy drop alert
  const snapSmallBase = computeDashboardAnalytics({
    clients: [c1],
    meetings: prevOnlyOne,
    tasks: [],
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(
    snapSmallBase.insights.some((i) => i.id === 'insight:held_meetings_drop'),
    false
  );

  // Baseline = 4 -> 1 (-75%) MUST trigger held_meetings_drop insight
  const prevFourCurrOne = [
    makeMeeting({ id: 'p1', clientId: 'c1', title: '1', dateTime: '2026-11-02T09:00:00.000Z', status: 'completed' }),
    makeMeeting({ id: 'p2', clientId: 'c1', title: '2', dateTime: '2026-11-03T09:00:00.000Z', status: 'completed' }),
    makeMeeting({ id: 'p3', clientId: 'c1', title: '3', dateTime: '2026-11-04T09:00:00.000Z', status: 'completed' }),
    makeMeeting({ id: 'p4', clientId: 'c1', title: '4', dateTime: '2026-11-05T09:00:00.000Z', status: 'completed' }),
    makeMeeting({ id: 'c-now', clientId: 'c1', title: '5', dateTime: '2026-11-10T09:00:00.000Z', status: 'completed' }),
  ];

  const snapRealDrop = computeDashboardAnalytics({
    clients: [c1],
    meetings: prevFourCurrOne,
    tasks: [],
    notes: [],
    preset: '7d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  const dropInsight = snapRealDrop.insights.find((i) => i.id === 'insight:held_meetings_drop');
  assert.ok(dropInsight);
  assert.ok(dropInsight.titleAr.includes('75%'));
});

test('empty workspace and incomplete loading states behave honestly without fabricating insights', () => {
  const emptySnap = computeDashboardAnalytics({
    clients: [],
    meetings: [],
    tasks: [],
    notes: [],
    preset: '30d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(emptySnap.completeness.isEmptyWorkspace, true);
  assert.equal(emptySnap.insights.length, 0);
  assert.equal(emptySnap.kpis.totalClients, 0);

  const loadingSnap = computeDashboardAnalytics({
    clients: [],
    meetings: [],
    tasks: [],
    notes: [],
    collectionsLoaded: { clients: true, meetings: false, tasks: true, notes: true },
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(loadingSnap.completeness.isIncomplete, true);
  assert.equal(loadingSnap.completeness.isEmptyWorkspace, false);
  assert.ok(loadingSnap.completeness.warningAr);
});

test('top task-linked meetings, client distributions, attention reasons, and drill-down payloads are accurate', () => {
  const c1 = makeClient({
    id: 'c1',
    name: 'شركة النخبة',
    relationshipStatus: 'follow_up_needed',
    importance: 'high',
    category: 'corporate',
    industry: 'التقنية',
    createdAt: '2026-09-01T08:00:00.000Z',
  });
  const c2 = makeClient({
    id: 'c2',
    name: 'مؤسسة الأفق',
    relationshipStatus: 'active',
    importance: 'medium',
    createdAt: '2026-11-12T08:00:00.000Z',
  });
  const m1 = makeMeeting({
    id: 'm1',
    clientId: 'c1',
    title: 'اجتماع المراجعة الربعية',
    dateTime: '2026-11-10T10:00:00.000Z',
    status: 'completed',
    type: 'video',
  });
  const m2 = makeMeeting({
    id: 'm2',
    clientId: 'c2',
    title: 'اجتماع تعريفي',
    dateTime: '2026-11-15T10:00:00.000Z',
    status: 'confirmed',
    type: 'in_person',
  });
  const tasks: ActionItem[] = [
    makeTask({
      id: 't1',
      clientId: 'c1',
      meetingId: 'm1',
      title: 'إرسال العرض المحدث',
      dueDate: '2026-11-11',
      priority: 'urgent',
    }),
    makeTask({
      id: 't2',
      clientId: 'c1',
      meetingId: 'm1',
      title: 'مراجعة العقد',
      status: 'completed',
      completedAt: '2026-11-12T08:00:00.000Z',
    }),
  ];

  // Cross-check with client360 engine directly
  const alertsC1 = evaluateClientAttentionAlerts({
    client: c1,
    meetings: [m1],
    tasks,
    referenceDate: REF_DATE,
  });
  assert.ok(alertsC1.some((a) => a.kind === 'overdue_tasks'));

  const snap = computeDashboardAnalytics({
    clients: [c1, c2],
    meetings: [m1, m2],
    tasks,
    notes: [],
    preset: '30d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });

  assert.equal(snap.meetings.topTaskLinkedMeetings.length, 1);
  assert.equal(snap.meetings.topTaskLinkedMeetings[0].meetingId, 'm1');
  assert.equal(snap.meetings.topTaskLinkedMeetings[0].linkedTasksCount, 2);
  assert.equal(snap.meetings.topTaskLinkedMeetings[0].openTasksCount, 1);
  assert.equal(snap.meetings.topTaskLinkedMeetings[0].completedTasksCount, 1);

  assert.equal(snap.clients.mostActiveClients[0].client.id, 'c1');
  assert.equal(snap.clients.newClientsInPeriod.length, 1);
  assert.equal(snap.clients.newClientsInPeriod[0].id, 'c2');

  const overdueInsight = snap.insights.find((i) => i.id === 'insight:overdue_tasks');
  assert.ok(overdueInsight);
  assert.deepEqual(overdueInsight.drillDown, { tab: 'tasks', scope: 'overdue' });

  const upcomingInsight = snap.insights.find((i) => i.id === 'insight:upcoming_7d_meetings');
  assert.ok(upcomingInsight);
  assert.deepEqual(upcomingInsight.drillDown, { tab: 'meetings', upcomingOnly: true });
});

test('CSV export prevents formula injection and excludes secrets, userIds, and Backblaze URLs', () => {
  assert.equal(sanitizeCsvCell('=CMD("calc")'), `"'=CMD(""calc"")"`);
  assert.equal(sanitizeCsvCell('+1+1'), `"'+1+1"`);
  assert.equal(sanitizeCsvCell('-2+3'), `"-2+3"`.replace('"-', `"' -`.replace(' ', '')));
  assert.equal(sanitizeCsvCell('@SUM(A1:A2)'), `"'@SUM(A1:A2)"`);
  assert.equal(sanitizeCsvCell(' =HYPERLINK("http://evil")'), `"' =HYPERLINK(""http://evil"")"`);

  const clientWithSensitiveInfo = makeClient({
    id: 'c-sec',
    userId: 'secret-uid-12345',
    name: '=EVIL_CLIENT',
    phone: '0500000000',
    email: 'secret@example.com',
  });
  const meetingWithB2 = makeMeeting({
    id: 'm-sec',
    userId: 'secret-uid-12345',
    clientId: 'c-sec',
    title: 'لقاء سري',
    dateTime: '2026-11-10T09:00:00.000Z',
    status: 'completed',
    photoPaths: ['https://f005.backblazeb2.com/file/private-bucket/users/secret-uid-12345/file.pdf?Authorization=abc'],
    notes: 'https://s3.us-west-004.backblazeb2.com/secret-key-token',
  });

  const snap = computeDashboardAnalytics({
    clients: [clientWithSensitiveInfo],
    meetings: [meetingWithB2],
    tasks: [],
    notes: [],
    preset: '30d',
    referenceDate: REF_DATE,
    timeZone: 'Asia/Riyadh',
  });

  const csv = buildAnalyticsSummaryCsv(snap, 'ar');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.includes('secret-uid-12345'), false);
  assert.equal(csv.includes('backblazeb2'), false);
  assert.equal(csv.includes('Authorization='), false);
  assert.equal(csv.includes('secret@example.com'), false);
  assert.equal(csv.includes('0500000000'), false);
});
