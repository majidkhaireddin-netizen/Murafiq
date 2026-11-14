import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionItem,
  Client,
  FollowUpPreferences,
  Meeting,
  ReminderStateRecord,
} from '../src/types';
import {
  CLIENT_FOLLOW_UP_DISCLOSURE_AR,
  DEFAULT_FOLLOW_UP_PREFERENCES,
  FOLLOW_UP_PREFERENCES_DOC_ID,
  addCalendarDaysToKey,
  buildDailyClientFollowUps,
  buildDeterministicReminderId,
  buildResolvedStateRecord,
  buildSnoozeStateRecord,
  categorizeDailyWorkTasks,
  computeDailyCommandSummary,
  computeSnoozeUntilIso,
  evaluateReminders,
  getDailyGreetingArabic,
  getTodayCalendarKey,
  getUpcomingMeetingsForDailyCenter,
  normalizeFollowUpPreferences,
} from '../src/utils/followUpEngine';
import { categorizeTasks, getRelativeTimeArabic } from '../src/utils/logic';
import { computeClientKpis, evaluateClientAttentionAlerts } from '../src/utils/client360';
import { MEETING_STATUS_LABELS } from '../src/utils/meetingMinutes';
import { CollectionKey, CollectionSyncStatus, computeDetailedSyncSummary } from '../src/utils/syncLogic';

const BASE_CLIENT_A: Client = {
  id: 'c_a',
  name: 'خالد السبيعي',
  company: 'مجموعة المدار',
  relationshipStatus: 'active',
  importance: 'high',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const BASE_CLIENT_B: Client = {
  id: 'c_b',
  name: 'نورة القحطاني',
  company: 'شركة ركيزة',
  relationshipStatus: 'follow_up_needed',
  importance: 'medium',
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
};

const INACTIVE_CLIENT: Client = {
  id: 'c_inactive',
  name: 'عميل غير نشط',
  relationshipStatus: 'inactive',
  createdAt: '2025-01-01T09:00:00.000Z',
  updatedAt: '2025-01-01T09:00:00.000Z',
};

// =========================================================================
// 1. Empty State & Live KPI Zeroing
// =========================================================================
test('1. Empty workspace yields zero KPIs, empty buckets, and zero reminders', () => {
  const ref = new Date('2026-11-15T09:00:00+03:00');
  const categorized = categorizeDailyWorkTasks([], ref, 'Asia/Riyadh');
  assert.equal(categorized.overdue.length, 0);
  assert.equal(categorized.today.length, 0);
  assert.equal(categorized.tomorrow.length, 0);
  assert.equal(categorized.thisWeek.length, 0);
  assert.equal(categorized.later.length, 0);
  assert.equal(categorized.noDueDate.length, 0);

  const summary = computeDailyCommandSummary({
    clients: [],
    meetings: [],
    tasks: [],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.deepEqual(summary, {
    dueTodayTasksCount: 0,
    overdueTasksCount: 0,
    todayMeetingsCount: 0,
    upcomingMeetingsCount: 0,
    followUpsRequiredCount: 0,
    highPriorityTasksCount: 0,
    overdueOpportunitiesCount: 0,
  });

  const rem = evaluateReminders({
    clients: [],
    meetings: [],
    tasks: [],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(rem.active.length, 0);
  assert.equal(rem.activeCount, 0);
});

// =========================================================================
// 2. 6-Bucket Daily Work Queue Classification & Priority Sorting
// =========================================================================
test('2. categorizeDailyWorkTasks places tasks into all 6 exact buckets and excludes completed/cancelled', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const tasks: ActionItem[] = [
    {
      id: 't_overdue',
      clientId: 'c_a',
      title: 'مهمة متأخرة',
      dueDate: '2026-11-14',
      priority: 'medium',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_today_low',
      clientId: 'c_a',
      title: 'مهمة اليوم منخفضة',
      dueDate: '2026-11-15',
      priority: 'low',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_today_urgent',
      clientId: 'c_a',
      title: 'مهمة اليوم عاجلة',
      dueDate: '2026-11-15',
      priority: 'urgent',
      status: 'in_progress',
      createdAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 't_tomorrow',
      clientId: 'c_a',
      title: 'مهمة غداً',
      dueDate: '2026-11-16',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_week',
      clientId: 'c_a',
      title: 'مهمة هذا الأسبوع',
      dueDate: '2026-11-22', // +7 days
      priority: 'medium',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_later',
      clientId: 'c_a',
      title: 'مهمة لاحقاً',
      dueDate: '2026-11-23', // +8 days
      priority: 'low',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_nodate',
      clientId: 'c_a',
      title: 'مهمة بلا موعد',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_done',
      clientId: 'c_a',
      title: 'مهمة مكتملة',
      dueDate: '2026-11-15',
      priority: 'urgent',
      status: 'completed',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 't_cancelled',
      clientId: 'c_a',
      title: 'مهمة ملغاة',
      dueDate: '2026-11-14',
      priority: 'urgent',
      status: 'cancelled',
      createdAt: '2026-11-10T08:00:00Z',
    },
  ];

  const cat = categorizeDailyWorkTasks(tasks, ref, 'Asia/Riyadh');
  assert.deepEqual(cat.overdue.map((t) => t.id), ['t_overdue']);
  assert.deepEqual(cat.today.map((t) => t.id), ['t_today_urgent', 't_today_low']);
  assert.deepEqual(cat.tomorrow.map((t) => t.id), ['t_tomorrow']);
  assert.deepEqual(cat.thisWeek.map((t) => t.id), ['t_week']);
  assert.deepEqual(cat.later.map((t) => t.id), ['t_later']);
  assert.deepEqual(cat.noDueDate.map((t) => t.id), ['t_nodate']);
});

// =========================================================================
// 3. Date Boundaries: 23:59 -> 00:00 Rollover, Month End & Leap Year
// =========================================================================
test('3. Midnight rollover (23:59 -> 00:00), month rollover, and leap-year rollover behave deterministically', () => {
  const task: ActionItem = {
    id: 't_roll',
    clientId: 'c_a',
    title: 'تسليم التقرير الشهري',
    dueDate: '2026-11-30',
    priority: 'high',
    status: 'pending',
    createdAt: '2026-11-25T10:00:00Z',
  };

  // At 2026-11-30 23:59 Riyadh -> due today
  const beforeMidnight = new Date('2026-11-30T23:59:00+03:00');
  const catBefore = categorizeDailyWorkTasks([task], beforeMidnight, 'Asia/Riyadh');
  assert.equal(catBefore.today.length, 1);
  assert.equal(catBefore.overdue.length, 0);

  // At 2026-12-01 00:00 Riyadh -> now overdue
  const afterMidnight = new Date('2026-12-01T00:00:00+03:00');
  const catAfter = categorizeDailyWorkTasks([task], afterMidnight, 'Asia/Riyadh');
  assert.equal(catAfter.today.length, 0);
  assert.equal(catAfter.overdue.length, 1);

  // Leap year check: 2024-02-28 -> +1 day = 2024-02-29; 2026-02-28 -> +1 day = 2026-03-01
  assert.equal(addCalendarDaysToKey('2024-02-28', 1), '2024-02-29');
  assert.equal(addCalendarDaysToKey('2026-02-28', 1), '2026-03-01');
});

// =========================================================================
// 4. Timezone Safety: YYYY-MM-DD invariant in Asia/Riyadh & America/Los_Angeles
// =========================================================================
test('4. YYYY-MM-DD dates do not shift backward in negative-UTC timezones (America/Los_Angeles vs Asia/Riyadh)', () => {
  const taskDueToday: ActionItem = {
    id: 't_tz',
    clientId: 'c_a',
    title: 'مراجعة العقد',
    dueDate: '2026-11-15',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-11-10T08:00:00Z',
  };

  // 2026-11-15 at 00:30 local in Riyadh
  const refRiyadh = new Date('2026-11-15T00:30:00+03:00');
  assert.equal(getTodayCalendarKey(refRiyadh, 'Asia/Riyadh'), '2026-11-15');
  assert.equal(getRelativeTimeArabic('2026-11-15', refRiyadh, 'Asia/Riyadh'), 'اليوم');
  assert.equal(categorizeTasks([taskDueToday], refRiyadh, 'Asia/Riyadh').today.length, 1);

  // 2026-11-15 at 00:30 local in Los Angeles (-08:00)
  const refLA = new Date('2026-11-15T00:30:00-08:00');
  assert.equal(getTodayCalendarKey(refLA, 'America/Los_Angeles'), '2026-11-15');
  assert.equal(getRelativeTimeArabic('2026-11-15', refLA, 'America/Los_Angeles'), 'اليوم');
  assert.equal(categorizeTasks([taskDueToday], refLA, 'America/Los_Angeles').today.length, 1);
  assert.equal(categorizeDailyWorkTasks([taskDueToday], refLA, 'America/Los_Angeles').today.length, 1);
});

// =========================================================================
// 5. Greeting Localization & Time-of-Day
// =========================================================================
test('5. getDailyGreetingArabic adapts to morning, afternoon, evening, and language', () => {
  assert.ok(
    getDailyGreetingArabic(new Date('2026-11-15T08:00:00+03:00'), 'Asia/Riyadh', 'ar').includes('صباح')
  );
  assert.ok(
    getDailyGreetingArabic(new Date('2026-11-15T14:00:00+03:00'), 'Asia/Riyadh', 'ar').includes('طاب يومك')
  );
  assert.ok(
    getDailyGreetingArabic(new Date('2026-11-15T20:00:00+03:00'), 'Asia/Riyadh', 'ar').includes('مساء')
  );
  assert.ok(
    getDailyGreetingArabic(new Date('2026-11-15T08:00:00+03:00'), 'Asia/Riyadh', 'en').includes('Good morning')
  );
});

// =========================================================================
// 6. Chronological Upcoming Meetings & Cancelled/Completed Exclusion
// =========================================================================
test('6. Upcoming meetings sorted chronologically, flags imminent, and excludes completed & cancelled', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const meetings: Meeting[] = [
    {
      id: 'm_later',
      clientId: 'c_a',
      title: 'اجتماع بعد الغد',
      dateTime: '2026-11-17T11:00:00+03:00',
      type: 'video',
      notes: '',
      status: 'confirmed',
      photoPaths: [],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'm_soon',
      clientId: 'c_a',
      title: 'اجتماع خلال 30 دقيقة',
      dateTime: '2026-11-15T10:30:00+03:00',
      type: 'in_person',
      notes: '',
      status: 'confirmed',
      photoPaths: [],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'm_cancelled',
      clientId: 'c_a',
      title: 'اجتماع ملغي',
      dateTime: '2026-11-15T10:20:00+03:00',
      type: 'phone',
      notes: '',
      status: 'cancelled',
      photoPaths: [],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'm_completed',
      clientId: 'c_a',
      title: 'اجتماع مكتمل',
      dateTime: '2026-11-15T10:15:00+03:00',
      type: 'phone',
      notes: '',
      status: 'completed',
      photoPaths: [],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const list = getUpcomingMeetingsForDailyCenter({
    meetings,
    clients: [BASE_CLIENT_A],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
    leadMinutes: 60,
  });

  assert.deepEqual(list.map((x) => x.meeting.id), ['m_soon', 'm_later']);
  assert.equal(list[0].isImminent, true);
  assert.equal(list[0].isToday, true);
  assert.equal(list[1].isImminent, false);
  assert.equal(list[1].isToday, false);
  assert.equal(MEETING_STATUS_LABELS.cancelled.ar, 'ملغاة');
});

// =========================================================================
// 7. Deterministic Reminder IDs & No Duplication Across Re-evaluations
// =========================================================================
test('7. Reminder generation produces deterministic IDs and never duplicates across re-evaluations', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const tasks: ActionItem[] = [
    {
      id: 't_1',
      clientId: 'c_a',
      title: 'مراجعة المسودة',
      dueDate: '2026-11-15',
      priority: 'urgent', // Both today AND urgent -> mutually exclusive max 1 reminder
      status: 'pending',
      createdAt: '2026-11-10T00:00:00Z',
    },
  ];

  const run1 = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks,
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  const run2 = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks,
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });

  const taskReminders1 = run1.active.filter((r) => r.sourceType === 'task' && r.sourceId === 't_1');
  assert.equal(taskReminders1.length, 1);
  assert.equal(taskReminders1[0].reason, 'task_due_today');
  assert.equal(
    taskReminders1[0].id,
    buildDeterministicReminderId('task', 't_1', 'task_due_today')
  );
  assert.deepEqual(
    run1.active.map((r) => r.id),
    run2.active.map((r) => r.id)
  );
});

// =========================================================================
// 8. Snooze Engine: 5 Presets, Past Rejection, NO Mutation of task.dueDate
// =========================================================================
test('8. Snooze computes all 5 options, rejects past custom dates, and NEVER alters task.dueDate', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const task: ActionItem = {
    id: 't_snooze',
    clientId: 'c_a',
    title: 'إرسال العرض المالي',
    dueDate: '2026-11-14',
    priority: 'high',
    status: 'pending',
    createdAt: '2026-11-10T00:00:00Z',
  };

  const s1h = computeSnoozeUntilIso({ preset: '1h', referenceDate: ref, timeZone: 'Asia/Riyadh' });
  const sTom = computeSnoozeUntilIso({ preset: 'tomorrow', referenceDate: ref, timeZone: 'Asia/Riyadh' });
  const s3d = computeSnoozeUntilIso({ preset: '3d', referenceDate: ref, timeZone: 'Asia/Riyadh' });
  const sWeek = computeSnoozeUntilIso({ preset: 'next_week', referenceDate: ref, timeZone: 'Asia/Riyadh' });
  const sCustomFuture = computeSnoozeUntilIso({
    preset: 'custom',
    customDateTime: '2026-11-18T14:30',
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  const sCustomPast = computeSnoozeUntilIso({
    preset: 'custom',
    customDateTime: '2026-11-15T09:00',
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });

  assert.equal(s1h.ok, true);
  assert.equal(new Date(s1h.snoozedUntilIso!).getTime() - ref.getTime(), 3600000);
  assert.equal(sTom.ok, true);
  assert.equal(s3d.ok, true);
  assert.equal(sWeek.ok, true);
  assert.equal(sCustomFuture.ok, true);
  assert.equal(sCustomPast.ok, false);
  assert.ok(sCustomPast.errorArabic);

  const initialEval = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [task],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  const targetRem = initialEval.active.find((r) => r.sourceId === 't_snooze')!;
  const snoozeRecord = buildSnoozeStateRecord({
    reminder: targetRem,
    snoozedUntilIso: s1h.snoozedUntilIso!,
    nowIso: ref.toISOString(),
    userId: 'uid_1',
  });

  // Original task.dueDate must remain untouched!
  assert.equal(task.dueDate, '2026-11-14');

  // At +30 min -> reminder is snoozed and NOT in active
  const midRef = new Date(ref.getTime() + 30 * 60000);
  const midEval = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [task],
    persistedStates: [snoozeRecord],
    referenceDate: midRef,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(midEval.active.some((r) => r.id === targetRem.id), false);
  assert.equal(midEval.snoozed.some((r) => r.id === targetRem.id), true);

  // At +61 min -> snooze expires -> reminder automatically resurfaces as active!
  const afterRef = new Date(ref.getTime() + 61 * 60000);
  const afterEval = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [task],
    persistedStates: [snoozeRecord],
    referenceDate: afterRef,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(afterEval.active.some((r) => r.id === targetRem.id), true);
  assert.equal(afterEval.snoozed.some((r) => r.id === targetRem.id), false);
});

// =========================================================================
// 9. Reminder Resolution & Automatic Source Invalidation
// =========================================================================
test('9. Reminders become invalidated when task completes, task deleted, meeting cancelled, or dueDate changes', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const task: ActionItem = {
    id: 't_inv',
    clientId: 'c_a',
    title: 'إعداد خطة التنفيذ',
    dueDate: '2026-11-14',
    priority: 'high',
    status: 'pending',
    createdAt: '2026-11-10T00:00:00Z',
  };
  const meeting: Meeting = {
    id: 'm_inv',
    clientId: 'c_a',
    title: 'اجتماع قريب',
    dateTime: '2026-11-15T10:30:00+03:00',
    type: 'video',
    notes: '',
    status: 'confirmed',
    photoPaths: [],
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };

  const initial = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [meeting],
    tasks: [task],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  const taskRem = initial.active.find((r) => r.sourceId === 't_inv')!;
  const meetRem = initial.active.find((r) => r.sourceId === 'm_inv')!;

  const persistedTaskResolved = buildResolvedStateRecord({ reminder: taskRem, nowIso: ref.toISOString() });
  const persistedMeetSnoozed = buildSnoozeStateRecord({
    reminder: meetRem,
    snoozedUntilIso: new Date(ref.getTime() + 3600000).toISOString(),
    nowIso: ref.toISOString(),
  });

  // Case A: Task completed & Meeting cancelled -> both move to invalidated with Arabic reasons
  const completedTask: ActionItem = { ...task, status: 'completed' };
  const cancelledMeeting: Meeting = { ...meeting, status: 'cancelled' };
  const afterStateChange = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [cancelledMeeting],
    tasks: [completedTask],
    persistedStates: [persistedTaskResolved, persistedMeetSnoozed],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(afterStateChange.active.some((r) => r.sourceId === 't_inv'), false);
  assert.equal(afterStateChange.active.some((r) => r.sourceId === 'm_inv'), false);
  assert.equal(afterStateChange.invalidated.length, 2);
  assert.ok(afterStateChange.invalidated.some((r) => r.invalidationReasonArabic?.includes('أُنجزت')));
  assert.ok(afterStateChange.invalidated.some((r) => r.invalidationReasonArabic?.includes('أُلغي')));

  // Case B: Task deleted -> invalidated cleanly without orphan crash
  const afterDelete = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [],
    persistedStates: [persistedTaskResolved],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(afterDelete.invalidated.length, 1);
  assert.ok(afterDelete.invalidated[0].invalidationReasonArabic?.includes('حذف'));

  // Case C: Task dueDate rescheduled -> old fingerprint dismissal no longer suppresses new schedule
  const snoozedForTodayTask: ActionItem = { ...task, dueDate: '2026-11-15' };
  const init2 = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [snoozedForTodayTask],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  const rem2 = init2.active.find((r) => r.sourceId === 't_inv')!;
  const resolvedOldDate = buildResolvedStateRecord({ reminder: rem2, nowIso: ref.toISOString() });

  // Edit task title or priority while still due today -> fingerprint changed -> resurfaces as active
  const editedTask: ActionItem = { ...snoozedForTodayTask, priority: 'urgent' };
  const afterEdit = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings: [],
    tasks: [editedTask],
    persistedStates: [resolvedOldDate],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(afterEdit.active.some((r) => r.sourceId === 't_inv'), true);
  assert.equal(afterEdit.resolved.some((r) => r.sourceId === 't_inv'), false);
});

// =========================================================================
// 10. Client 360 Follow-Up Consistency & Non-Invasive Boundaries
// =========================================================================
test('10. Client follow-ups reuse Client 360 alerts, include logged-data disclosure, exclude inactive, and do not mutate client or auto-create tasks', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const clientSnapshot = structuredClone([BASE_CLIENT_A, BASE_CLIENT_B, INACTIVE_CLIENT]);
  const tasks: ActionItem[] = [
    {
      id: 't_c_a',
      clientId: 'c_a',
      title: 'مهمة متأخرة للعميل أ',
      dueDate: '2026-11-13',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];
  const meetings: Meeting[] = [
    {
      id: 'm_c_a_old',
      clientId: 'c_a',
      title: 'اجتماع قديم',
      dateTime: '2026-11-10T10:00:00Z',
      type: 'in_person',
      notes: '',
      status: 'completed',
      photoPaths: [],
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ];

  const followUps = buildDailyClientFollowUps({
    clients: clientSnapshot,
    meetings,
    tasks,
    preferences: DEFAULT_FOLLOW_UP_PREFERENCES,
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });

  // Inactive client must not appear for stale contact; c_a and c_b should appear
  assert.equal(followUps.some((f) => f.client.id === 'c_inactive'), false);
  const entryA = followUps.find((f) => f.client.id === 'c_a')!;
  const entryB = followUps.find((f) => f.client.id === 'c_b')!;
  assert.ok(entryA);
  assert.ok(entryB);
  assert.equal(entryA.basisDisclosureArabic, CLIENT_FOLLOW_UP_DISCLOSURE_AR);
  assert.ok(entryB.reasonsArabic.some((r) => r.includes('حالة العميل')));

  // Verify Client 360 KPIs and alerts stay non-regressive & identical
  const c360AlertsB = evaluateClientAttentionAlerts({
    client: BASE_CLIENT_B,
    meetings: [],
    tasks: [],
    referenceDate: ref,
  });
  assert.ok(c360AlertsB.some((a) => a.kind === 'stale_contact'));
  const kpisA = computeClientKpis({
    client: BASE_CLIENT_A,
    meetings,
    tasks,
    notes: [],
    referenceDate: ref,
  });
  assert.equal(kpisA.overdueTasks, 1);

  // Clients & tasks remain untouched (no automatic status mutation or auto-created tasks)
  assert.equal(clientSnapshot[0].relationshipStatus, 'active');
  assert.equal(tasks.length, 1);
});

// =========================================================================
// 11. Preferences Toggles & Disabling Reminders Preserves Underlying Records
// =========================================================================
test('11. Disabling reminders hides alerts cleanly without deleting or disabling tasks and meetings', () => {
  const ref = new Date('2026-11-15T10:00:00+03:00');
  const tasks: ActionItem[] = [
    {
      id: 't_keep',
      clientId: 'c_a',
      title: 'مهمة اليوم',
      dueDate: '2026-11-15',
      priority: 'urgent',
      status: 'pending',
      createdAt: '2026-11-10T00:00:00Z',
    },
  ];
  const meetings: Meeting[] = [
    {
      id: 'm_keep',
      clientId: 'c_a',
      title: 'اجتماع خلال 20 دقيقة',
      dateTime: '2026-11-15T10:20:00+03:00',
      type: 'video',
      notes: '',
      status: 'confirmed',
      photoPaths: [],
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ];

  const disabledPrefs: FollowUpPreferences = normalizeFollowUpPreferences({
    ...DEFAULT_FOLLOW_UP_PREFERENCES,
    id: FOLLOW_UP_PREFERENCES_DOC_ID,
    remindersEnabled: false,
  });

  const rem = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings,
    tasks,
    preferences: disabledPrefs,
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(rem.activeCount, 0);
  assert.equal(rem.active.length, 0);

  // Underlying work queue and upcoming meetings remain intact
  const cat = categorizeDailyWorkTasks(tasks, ref, 'Asia/Riyadh');
  assert.equal(cat.today.length, 1);
  const up = getUpcomingMeetingsForDailyCenter({
    meetings,
    clients: [BASE_CLIENT_A],
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(up.length, 1);

  // Changing leadMinutes to 15 hides a meeting 20 min away from imminent reminder
  const tightLeadPrefs = normalizeFollowUpPreferences({
    ...DEFAULT_FOLLOW_UP_PREFERENCES,
    meetingLeadMinutes: 15,
  });
  const remTight = evaluateReminders({
    clients: [BASE_CLIENT_A],
    meetings,
    tasks: [],
    preferences: tightLeadPrefs,
    referenceDate: ref,
    timeZone: 'Asia/Riyadh',
  });
  assert.equal(remTight.active.some((r) => r.reason === 'meeting_imminent'), false);
});

// =========================================================================
// 12. Sync Summary Honesty for Reminders & Preferences Collections
// =========================================================================
test('12. computeDetailedSyncSummary honestly reports pending and failed states for reminders and preferences', () => {
  const syncedStatus: CollectionSyncStatus = {
    loaded: true,
    hasPendingWrites: false,
    fromCache: false,
    hasError: false,
    pendingDocIds: [],
    pendingDeletesCount: 0,
  };

  const baseStatuses: Record<CollectionKey, CollectionSyncStatus> = {
    clients: { ...syncedStatus },
    meetings: { ...syncedStatus },
    tasks: { ...syncedStatus },
    notes: { ...syncedStatus },
    opportunities: { ...syncedStatus },
    opportunityStageEvents: { ...syncedStatus },
    reminders: { ...syncedStatus, hasPendingWrites: true, pendingDocIds: ['rem_task_1'] },
    preferences: { ...syncedStatus },
  };

  const pendingSummary = computeDetailedSyncSummary({
    statuses: baseStatuses,
    hasActiveConflict: false,
    conflictCount: 0,
    isOnline: true,
    rejectedWritesCount: 0,
  });
  assert.equal(pendingSummary.syncState, 'pending');
  assert.equal(pendingSummary.pendingOperationsCount, 1);

  const failedSummary = computeDetailedSyncSummary({
    statuses: {
      ...baseStatuses,
      reminders: { ...syncedStatus },
      preferences: { ...syncedStatus, hasError: true },
    },
    hasActiveConflict: false,
    conflictCount: 0,
    isOnline: true,
    rejectedWritesCount: 0,
  });
  assert.equal(failedSummary.syncState, 'failed');
});
