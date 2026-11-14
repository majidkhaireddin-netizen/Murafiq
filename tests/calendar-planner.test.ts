import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionItem, Client, Meeting, Opportunity } from '../src/types/index.ts';
import {
  AVAILABLE_SLOTS_DISCLOSURE_AR,
  DEFAULT_CALENDAR_SETTINGS,
  applyMeetingReschedule,
  assignTaskTimeBlock,
  buildCalendarEvents,
  buildMonthCalendarGrid,
  buildWeekDaysRange,
  buildWeeklyPlanData,
  clearTaskTimeBlock,
  computeDayAvailableSlots,
  decodeTaskTimeBlockFromFirestore,
  detectCalendarConflicts,
  encodeTaskTimeBlockForFirestore,
  extractZonedHourAndMinute,
  navigateCalendarDate,
  validateTimeBlockInterval,
} from '../src/utils/calendarEngine.ts';
import { extractZonedCalendarParts, formatCalendarDateKey } from '../src/utils/followUpEngine.ts';

const USER_A = 'user-alpha-100';
const USER_B = 'user-beta-200';
const TZ_RIYADH = 'Asia/Riyadh'; // UTC+3

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    userId: USER_A,
    name: 'شركة النخبة القابضة',
    company: 'النخبة القابضة',
    relationshipStatus: 'active',
    importance: 'high',
    notes: '',
    tags: [],
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-1',
    userId: USER_A,
    clientId: 'client-1',
    title: 'اجتماع مراجعة استراتيجية التوسع',
    dateTime: '2026-05-11T07:00:00.000Z', // 10:00 AM in Asia/Riyadh (Monday)
    duration: 60,
    type: 'in_person',
    status: 'confirmed',
    minutesStatus: 'draft',
    notes: '',
    photoPaths: [],
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'task-1',
    userId: USER_A,
    clientId: 'client-1',
    title: 'إعداد العرض المالي التفصيلي',
    dueDate: '2026-05-12',
    status: 'pending',
    priority: 'high',
    provenance: 'approved',
    createdAt: '2026-05-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    userId: USER_A,
    clientId: 'client-1',
    title: 'مشروع التحول الرقمي الشامل',
    type: 'consulting',
    stage: 'proposal',
    priority: 'high',
    nextAction: 'إرسال النسخة المحدثة من العرض الفني',
    nextActionDate: '2026-05-13',
    expectedCloseDate: '2026-05-15',
    estimatedValue: 180000,
    currency: 'SAR',
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-05T08:00:00.000Z',
    ...overrides,
  };
}

describe('Task 010: Integrated Calendar, Weekly Planner & Time Blocking (30 Scenarios)', () => {
  it('1. يعرض الاجتماع في العرض الشهري (Monthly View) في يومه الصحيح', () => {
    const meeting = makeMeeting({ dateTime: '2026-05-11T07:00:00.000Z' }); // 2026-05-11 in Riyadh
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meeting],
      tasks: [],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const grid = buildMonthCalendarGrid({
      year: 2026,
      month: 5,
      weekStartDay: 6,
      events,
      referenceDate: new Date('2026-05-10T08:00:00.000Z'),
      timeZone: TZ_RIYADH,
    });

    const targetCell = grid.find((c) => c.dateKey === '2026-05-11');
    assert.ok(targetCell, 'يجب العثور على خلية يوم 2026-05-11 في الشبكة الشهرية');
    assert.equal(targetCell.counts.meetings, 1);
    assert.equal(targetCell.events[0]?.title, 'اجتماع مراجعة استراتيجية التوسع');
  });

  it('2. يعرض الاجتماع في العرض الأسبوعي (Weekly View) في ساعته الصحيحة', () => {
    const meeting = makeMeeting({ dateTime: '2026-05-11T07:00:00.000Z', duration: 60 }); // 10:00 -> 11:00 Riyadh
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meeting],
      tasks: [],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const weekDays = buildWeekDaysRange({
      anchorDateKey: '2026-05-11',
      weekStartDay: 6,
      events,
      referenceDate: new Date('2026-05-10T08:00:00.000Z'),
      timeZone: TZ_RIYADH,
    });

    const monday = weekDays.find((d) => d.dateKey === '2026-05-11');
    assert.ok(monday);
    assert.equal(monday.events.length, 1);
    const ev = monday.events[0]!;
    assert.equal(ev.isTimed, true);
    assert.equal(ev.durationMinutes, 60);
    const hm = extractZonedHourAndMinute(new Date(ev.startIso!), TZ_RIYADH);
    assert.equal(hm.hour, 10);
    assert.equal(hm.minute, 0);
  });

  it('3. يعرض الاجتماع في العرض اليومي (Daily View) في ساعته الصحيحة ويحسب الأوقات المتاحة حوله', () => {
    const meeting = makeMeeting({ dateTime: '2026-05-11T07:00:00.000Z', duration: 60 }); // 10:00 -> 11:00 Riyadh
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meeting],
      tasks: [],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const dayEvents = events.filter((e) => e.dateKey === '2026-05-11');
    assert.equal(dayEvents.length, 1);
    const hm = extractZonedHourAndMinute(new Date(dayEvents[0]!.startIso!), TZ_RIYADH);
    assert.equal(hm.hour, 10);

    const gaps = computeDayAvailableSlots({
      dateKey: '2026-05-11',
      events: dayEvents,
      workingDayStartHour: 8,
      workingDayEndHour: 17,
      timeZone: TZ_RIYADH,
    });

    assert.equal(gaps.length, 2);
    assert.equal(gaps[0]?.durationMinutes, 120); // 08:00 -> 10:00
    assert.equal(gaps[1]?.durationMinutes, 360); // 11:00 -> 17:00
    assert.ok(AVAILABLE_SLOTS_DISCLOSURE_AR.includes('الأوقات المتاحة المعروضة تستند فقط إلى الاجتماعات وفترات العمل المجدولة داخل تطبيق «مُرافق»'));
  });

  it('4. يستبعد الاجتماعات الملغاة (cancelled) من الالتزامات النشطة افتراضيًا مع دعم إظهارها اختياريًا', () => {
    const cancelledMeeting = makeMeeting({ id: 'mtg-cancelled', status: 'cancelled' });

    const defaultEvents = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [cancelledMeeting],
      tasks: [],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
      settings: { showCancelledMeetings: false },
    });
    assert.equal(defaultEvents.length, 0);

    const shownEvents = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [cancelledMeeting],
      tasks: [],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
      settings: { showCancelledMeetings: true },
    });
    assert.equal(shownEvents.length, 1);
    assert.equal(shownEvents[0]?.isCancelled, true);
  });

  it('5. يعرض المهمة ذات dueDate فقط في يوم استحقاقها كالتزام يومي دون اختلاق ساعة وهمية', () => {
    const task = makeTask({ dueDate: '2026-05-12', scheduledStartAt: undefined, scheduledEndAt: undefined });
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [task],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.activityType, 'task_due');
    assert.equal(events[0]?.dateKey, '2026-05-12');
    assert.equal(events[0]?.isTimed, false);
    assert.equal(events[0]?.startMs, undefined);
  });

  it('6. يعرض المهمة التي لها فترة عمل محجوزة (Time Block) في الشبكة الساعية للأسبوع واليوم', () => {
    const task = makeTask({
      dueDate: '2026-05-14',
      scheduledStartAt: '2026-05-12T10:30:00.000Z', // 13:30 in Riyadh
      scheduledEndAt: '2026-05-12T12:00:00.000Z',   // 15:00 in Riyadh
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [task],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const blockEvent = events.find((e) => e.activityType === 'task_block');
    const dueEvent = events.find((e) => e.activityType === 'task_due');

    assert.ok(blockEvent, 'يجب إنشاء عنصر task_block في يوم الفترة المحجوزة');
    assert.equal(blockEvent.dateKey, '2026-05-12');
    assert.equal(blockEvent.isTimed, true);
    const hm = extractZonedHourAndMinute(new Date(blockEvent.startIso!), TZ_RIYADH);
    assert.equal(hm.hour, 13);
    assert.equal(hm.minute, 30);
    assert.equal(blockEvent.durationMinutes, 90);

    assert.ok(dueEvent, 'يجب بقاء موعد الاستحقاق في يوم 2026-05-14');
    assert.equal(dueEvent.dateKey, '2026-05-14');
  });

  it('7. يحافظ على dueDate دون تغيير عند إضافة أو تعديل فترة عمل (Time Block) للمهمة', () => {
    const originalTask = makeTask({ dueDate: '2026-05-20' });
    const res = assignTaskTimeBlock(
      originalTask,
      '2026-05-12T06:00:00.000Z',
      '2026-05-12T07:00:00.000Z'
    );

    assert.equal(res.ok, true);
    assert.ok(res.task);
    assert.equal(res.task.dueDate, '2026-05-20');
    assert.equal(res.task.scheduledStartAt, '2026-05-12T06:00:00.000Z');
    assert.equal(res.task.scheduledEndAt, '2026-05-12T07:00:00.000Z');
  });

  it('8. يرفض حجز فترة عمل غير صالحة عندما يكون وقت النهاية أقدم أو مساويًا لوقت البداية', () => {
    const sameTime = validateTimeBlockInterval(
      '2026-05-12T08:00:00.000Z',
      '2026-05-12T08:00:00.000Z'
    );
    assert.equal(sameTime.valid, false);

    const endBeforeStart = assignTaskTimeBlock(
      makeTask(),
      '2026-05-12T09:00:00.000Z',
      '2026-05-12T08:00:00.000Z'
    );
    assert.equal(endBeforeStart.ok, false);
  });

  it('9. يزيل فترة العمل (clearTaskTimeBlock) دون حذف المهمة أو المساس بـ dueDate أو status', () => {
    const blockedTask = makeTask({
      id: 'task-keep',
      dueDate: '2026-05-18',
      status: 'in_progress',
      scheduledStartAt: '2026-05-12T06:00:00.000Z',
      scheduledEndAt: '2026-05-12T07:00:00.000Z',
    });

    const cleared = clearTaskTimeBlock(blockedTask);
    assert.equal(cleared.id, 'task-keep');
    assert.equal(cleared.dueDate, '2026-05-18');
    assert.equal(cleared.status, 'in_progress');
    assert.equal(cleared.scheduledStartAt, undefined);
    assert.equal(cleared.scheduledEndAt, undefined);
  });

  it('10. يضمن أن حجز فترة عمل للمهمة لا يغير حالتها إلى مكتملة (completed)', () => {
    const openTask = makeTask({ status: 'pending' });
    const res = assignTaskTimeBlock(
      openTask,
      '2026-05-12T06:00:00.000Z',
      '2026-05-12T07:30:00.000Z'
    );

    assert.equal(res.ok, true);
    assert.ok(res.task);
    assert.equal(res.task.status, 'pending');
    assert.notEqual(res.task.status, 'completed');
  });

  it('11. يعرض موعد المتابعة القادم (followUpDateTime) المرتبط بالاجتماع على التقويم', () => {
    const meetingWithFollowUp = makeMeeting({
      dateTime: '2026-05-10T07:00:00.000Z',
      followUpDateTime: '2026-05-14T11:00:00.000Z', // 14:00 in Riyadh
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meetingWithFollowUp],
      tasks: [],
      opportunities: [],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const followUpEvent = events.find((e) => e.activityType === 'follow_up');
    assert.ok(followUpEvent, 'يجب ظهور موعد المتابعة كحدث مستقل في التقويم');
    assert.equal(followUpEvent.dateKey, '2026-05-14');
    assert.equal(followUpEvent.isTimed, true);
    const hm = extractZonedHourAndMinute(new Date(followUpEvent.startIso!), TZ_RIYADH);
    assert.equal(hm.hour, 14);
  });

  it('12. يعرض تاريخ الإجراء القادم للفرصة المفتوحة (opportunity.nextActionDate) على التقويم', () => {
    const opp = makeOpportunity({
      stage: 'negotiation',
      nextAction: 'اجتماع تسعير نهائي',
      nextActionDate: '2026-05-13',
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [],
      opportunities: [opp],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const actionEvent = events.find((e) => e.activityType === 'opportunity_action');
    assert.ok(actionEvent);
    assert.equal(actionEvent.dateKey, '2026-05-13');
    assert.equal(actionEvent.isTimed, false);
    assert.ok(actionEvent.title.includes('اجتماع تسعير نهائي'));
  });

  it('13. يعرض تاريخ الإغلاق المتوقع للفرصة المفتوحة بوضوح كتقدير ويستبعد الفرص المغلقة (won/lost)', () => {
    const openOpp = makeOpportunity({
      id: 'opp-open',
      stage: 'proposal',
      expectedCloseDate: '2026-05-15',
    });
    const wonOpp = makeOpportunity({
      id: 'opp-won',
      stage: 'won',
      expectedCloseDate: '2026-05-15',
      nextActionDate: '2026-05-15',
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [],
      opportunities: [openOpp, wonOpp],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const closeEvents = events.filter((e) => e.activityType === 'opportunity_close');
    assert.equal(closeEvents.length, 1);
    assert.equal(closeEvents[0]?.sourceId, 'opp-open');
    assert.ok(closeEvents[0]?.activityTypeLabelAr.includes('تقديري'));
    assert.equal(closeEvents[0]?.isTimed, false);
  });

  it('14. يكتشف التعارض الزمني بين اجتماعين متداخلين في الوقت', () => {
    const m1 = makeMeeting({
      id: 'm1',
      title: 'اجتماع أ',
      dateTime: '2026-05-11T07:00:00.000Z',
      duration: 60, // 07:00 -> 08:00 UTC
    });
    const m2 = makeMeeting({
      id: 'm2',
      title: 'اجتماع ب',
      dateTime: '2026-05-11T07:30:00.000Z',
      duration: 60, // 07:30 -> 08:30 UTC
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [m1, m2],
      tasks: [],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    const conflicts = detectCalendarConflicts(events);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.overlapMinutes, 30);
    assert.equal(conflicts[0]?.firstEvent.sourceId, 'm1');
    assert.equal(conflicts[0]?.secondEvent.sourceId, 'm2');
  });

  it('15. يكتشف التعارض الزمني بين اجتماع وفترة عمل مهمة (Task Time Block) متداخلة معه', () => {
    const meeting = makeMeeting({
      id: 'm1',
      dateTime: '2026-05-11T07:00:00.000Z',
      duration: 60, // 07:00 -> 08:00 UTC
    });
    const taskBlock = makeTask({
      id: 't1',
      dueDate: '2026-05-11',
      scheduledStartAt: '2026-05-11T07:15:00.000Z',
      scheduledEndAt: '2026-05-11T08:15:00.000Z',
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meeting],
      tasks: [taskBlock],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    const conflicts = detectCalendarConflicts(events);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.overlapMinutes, 45);
  });

  it('16. يكتشف التعارض الزمني بين فترتي عمل لمهمتين (Two Task Time Blocks)', () => {
    const t1 = makeTask({
      id: 't1',
      title: 'مهمة 1',
      scheduledStartAt: '2026-05-11T09:00:00.000Z',
      scheduledEndAt: '2026-05-11T10:30:00.000Z',
    });
    const t2 = makeTask({
      id: 't2',
      title: 'مهمة 2',
      scheduledStartAt: '2026-05-11T10:00:00.000Z',
      scheduledEndAt: '2026-05-11T11:00:00.000Z',
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [t1, t2],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    const conflicts = detectCalendarConflicts(events);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.overlapMinutes, 30);
  });

  it('17. لا يعتبر المهمة ذات dueDate فقط بدون Time Block تعارضًا في الساعات مع الاجتماعات', () => {
    const meeting = makeMeeting({
      id: 'm1',
      dateTime: '2026-05-12T07:00:00.000Z',
      duration: 60,
    });
    const dateOnlyTask = makeTask({
      id: 't-date-only',
      dueDate: '2026-05-12',
      scheduledStartAt: undefined,
      scheduledEndAt: undefined,
    });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [meeting],
      tasks: [dateOnlyTask],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    const conflicts = detectCalendarConflicts(events);
    assert.equal(conflicts.length, 0);
  });

  it('18. يعيد جدولة الاجتماع النشط (applyMeetingReschedule) ويحدث dateTime و duration بأمان', () => {
    const meeting = makeMeeting({
      dateTime: '2026-05-11T07:00:00.000Z',
      duration: 60,
      minutesStatus: 'draft',
    });

    const res = applyMeetingReschedule({
      meeting,
      newDateTime: '2026-05-12T09:30:00.000Z',
      newDurationMinutes: 45,
    });

    assert.equal(res.ok, true);
    assert.ok(res.meeting);
    assert.equal(res.meeting.dateTime, '2026-05-12T09:30:00.000Z');
    assert.equal(res.meeting.duration, 45);
    assert.equal(res.previousDateTime, '2026-05-11T07:00:00.000Z');
  });

  it('19. يمنع إعادة جدولة الاجتماع الملغى (cancelled) تلقائيًا', () => {
    const cancelledMeeting = makeMeeting({ status: 'cancelled' });
    const res = applyMeetingReschedule({
      meeting: cancelledMeeting,
      newDateTime: '2026-05-12T09:30:00.000Z',
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, 'CANCELLED_MEETING');
  });

  it('20. يحمي الاجتماع ذو المحضر المعتمد النهائي (final) من التعديل الصامت ويشترط تأكيد إعادة الفتح', () => {
    const finalMeeting = makeMeeting({
      minutesStatus: 'final',
      minutesStatusUpdatedAt: '2026-05-10T10:00:00.000Z',
    });

    const blocked = applyMeetingReschedule({
      meeting: finalMeeting,
      newDateTime: '2026-05-13T08:00:00.000Z',
      confirmReopenFinalMinutes: false,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'FINAL_MINUTES_LOCKED');
    assert.equal(blocked.requiresReopenConfirmation, true);

    const confirmed = applyMeetingReschedule({
      meeting: finalMeeting,
      newDateTime: '2026-05-13T08:00:00.000Z',
      confirmReopenFinalMinutes: true,
    });
    assert.equal(confirmed.ok, true);
    assert.ok(confirmed.meeting);
    assert.equal(confirmed.meeting.minutesStatus, 'draft');
    assert.equal(confirmed.meeting.dateTime, '2026-05-13T08:00:00.000Z');
  });

  it('21. يصفي عناصر التقويم بدقة حسب نوع النشاط (filterScope) وحسب العميل (clientIdFilter)', () => {
    const m1 = makeMeeting({ id: 'm1', clientId: 'client-1' });
    const t1 = makeTask({ id: 't1', clientId: 'client-2' });
    const opp1 = makeOpportunity({ id: 'o1', clientId: 'client-1' });

    const onlyMeetings = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [m1],
      tasks: [t1],
      opportunities: [opp1],
      clients: [],
      timeZone: TZ_RIYADH,
      filterScope: 'meetings',
    });
    assert.equal(onlyMeetings.length, 1);
    assert.equal(onlyMeetings[0]?.activityType, 'meeting');

    const onlyClient2 = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [m1],
      tasks: [t1],
      opportunities: [opp1],
      clients: [],
      timeZone: TZ_RIYADH,
      clientIdFilter: 'client-2',
    });
    assert.equal(onlyClient2.length, 1);
    assert.equal(onlyClient2[0]?.clientId, 'client-2');
  });

  it('22. يتنقل بين الأشهر (navigateCalendarDate) مع معالجة حدود نهاية الشهر بأمان', () => {
    const nextMonth = navigateCalendarDate('2026-01-31', 'month', 'next');
    assert.equal(nextMonth, '2026-02-28');

    const prevMonth = navigateCalendarDate('2026-03-31', 'month', 'prev');
    assert.equal(prevMonth, '2026-02-28');
  });

  it('23. يتنقل بين الأسابيع والأيام (navigateCalendarDate) بدقة', () => {
    const nextWeek = navigateCalendarDate('2026-05-11', 'week', 'next');
    assert.equal(nextWeek, '2026-05-18');

    const prevWeek = navigateCalendarDate('2026-05-11', 'planner', 'prev');
    assert.equal(prevWeek, '2026-05-04');

    const nextDay = navigateCalendarDate('2026-05-31', 'day', 'next');
    assert.equal(nextDay, '2026-06-01');
  });

  it('24. يحسب ملخص «خطتي لهذا الأسبوع» (Weekly Planner) بما يشمل الاجتماعات والمهام والتأخيرات', () => {
    const m1 = makeMeeting({ dateTime: '2026-05-11T07:00:00.000Z', duration: 60 }); // In week May 9 - May 15
    const overdueTask = makeTask({ id: 't-overdue', dueDate: '2026-05-05', status: 'pending' });
    const weekTask = makeTask({
      id: 't-week',
      dueDate: '2026-05-12',
      status: 'pending',
      scheduledStartAt: '2026-05-12T08:00:00.000Z',
      scheduledEndAt: '2026-05-12T09:30:00.000Z',
    });

    const refDate = new Date('2026-05-10T09:00:00.000Z');
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [m1],
      tasks: [overdueTask, weekTask],
      opportunities: [],
      clients: [makeClient()],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    const plan = buildWeeklyPlanData({
      currentUserId: USER_A,
      anchorDateKey: '2026-05-11',
      weekStartDay: 6,
      events,
      allTasks: [overdueTask, weekTask],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    assert.equal(plan.summary.weekStartKey, '2026-05-09');
    assert.equal(plan.summary.weekEndKey, '2026-05-15');
    assert.equal(plan.summary.meetingsCount, 1);
    assert.equal(plan.summary.dueTasksCount, 1);
    assert.equal(plan.summary.timeBlockedTasksCount, 1);
    assert.equal(plan.summary.overdueCommitmentsCount, 1);
  });

  it('25. يحسب ساعات الاجتماعات من الاجتماعات ذات المدة المعلومة فقط ويفصل الاجتماعات غير محددة المدة', () => {
    const mKnown = makeMeeting({
      id: 'm-known',
      dateTime: '2026-05-11T07:00:00.000Z',
      duration: 90, // 1.5 hr
    });
    const mUnknown = makeMeeting({
      id: 'm-unknown',
      dateTime: '2026-05-12T07:00:00.000Z',
      duration: undefined, // No duration recorded
    });

    const refDate = new Date('2026-05-10T09:00:00.000Z');
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [mKnown, mUnknown],
      tasks: [],
      opportunities: [],
      clients: [],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    const plan = buildWeeklyPlanData({
      currentUserId: USER_A,
      anchorDateKey: '2026-05-11',
      weekStartDay: 6,
      events,
      allTasks: [],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    assert.equal(plan.summary.meetingsCount, 2);
    assert.equal(plan.summary.scheduledMeetingHours, 1.5);
    assert.equal(plan.summary.meetingsWithoutDurationCount, 1);
  });

  it('26. يحسب ساعات العمل المخططة للمهام (plannedTaskWorkHours) بدقة من الـ Time Blocks فقط', () => {
    const tBlocked = makeTask({
      id: 't-blocked',
      dueDate: '2026-05-12',
      scheduledStartAt: '2026-05-12T06:00:00.000Z',
      scheduledEndAt: '2026-05-12T08:30:00.000Z', // 2.5 hours
    });
    const tUnscheduled = makeTask({
      id: 't-unscheduled',
      dueDate: '2026-05-13',
    });

    const refDate = new Date('2026-05-10T09:00:00.000Z');
    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [],
      tasks: [tBlocked, tUnscheduled],
      opportunities: [],
      clients: [],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    const plan = buildWeeklyPlanData({
      currentUserId: USER_A,
      anchorDateKey: '2026-05-11',
      weekStartDay: 6,
      events,
      allTasks: [tBlocked, tUnscheduled],
      referenceDate: refDate,
      timeZone: TZ_RIYADH,
    });

    assert.equal(plan.summary.plannedTaskWorkHours, 2.5);
    assert.equal(plan.unscheduledOpenTasks.length, 1);
    assert.equal(plan.unscheduledOpenTasks[0]?.id, 't-unscheduled');
  });

  it('27. يحتفظ بالمرجع الأصلي للسجل (meetingRef / taskRef / opportunityRef) للانتقال المباشر إليه', () => {
    const m = makeMeeting({ id: 'mtg-ref-99' });
    const t = makeTask({ id: 'task-ref-88' });
    const o = makeOpportunity({ id: 'opp-ref-77' });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [m],
      tasks: [t],
      opportunities: [o],
      clients: [makeClient()],
      timeZone: TZ_RIYADH,
    });

    const mtgEvent = events.find((e) => e.activityType === 'meeting');
    const taskEvent = events.find((e) => e.activityType === 'task_due');
    const oppEvent = events.find((e) => e.activityType === 'opportunity_action');

    assert.equal(mtgEvent?.meetingRef?.id, 'mtg-ref-99');
    assert.equal(taskEvent?.taskRef?.id, 'task-ref-88');
    assert.equal(oppEvent?.opportunityRef?.id, 'opp-ref-77');
    assert.equal(mtgEvent?.clientName, 'شركة النخبة القابضة');
  });

  it('28. يفرض عزل المستخدم (User Isolation) فلا تظهر سجلات مستخدم آخر في التقويم أو الخطة الأسبوعية', () => {
    const myMeeting = makeMeeting({ id: 'm-mine', userId: USER_A });
    const foreignMeeting = makeMeeting({ id: 'm-foreign', userId: USER_B });
    const foreignTask = makeTask({ id: 't-foreign', userId: USER_B });
    const foreignOpp = makeOpportunity({ id: 'o-foreign', userId: USER_B });

    const events = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [myMeeting, foreignMeeting],
      tasks: [foreignTask],
      opportunities: [foreignOpp],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.sourceId, 'm-mine');
  });

  it('29. يتعامل مع المناطق الزمنية بدقة عند حدود منتصف الليل دون إزاحة تواريخ YYYY-MM-DD', () => {
    // 2026-05-11T22:30:00.000Z is 2026-05-12 01:30 AM in Asia/Riyadh (UTC+3)
    const lateUtcMeeting = makeMeeting({
      dateTime: '2026-05-11T22:30:00.000Z',
      duration: 60,
    });
    const dateOnlyTask = makeTask({
      dueDate: '2026-05-11',
    });

    const riyadhEvents = buildCalendarEvents({
      currentUserId: USER_A,
      meetings: [lateUtcMeeting],
      tasks: [dateOnlyTask],
      opportunities: [],
      clients: [],
      timeZone: TZ_RIYADH,
    });

    const mtgEv = riyadhEvents.find((e) => e.activityType === 'meeting');
    const taskEv = riyadhEvents.find((e) => e.activityType === 'task_due');

    assert.equal(mtgEv?.dateKey, '2026-05-12');
    const hm = extractZonedHourAndMinute(new Date(mtgEv!.startIso!), TZ_RIYADH);
    assert.equal(hm.hour, 1);
    assert.equal(hm.minute, 30);
    // Date-only task must stay on 2026-05-11 regardless of timezone offset
    assert.equal(taskEv?.dateKey, '2026-05-11');
    const zonedParts = extractZonedCalendarParts(new Date('2026-05-11T22:30:00.000Z'), TZ_RIYADH);
    assert.equal(formatCalendarDateKey(zonedParts), '2026-05-12');
  });

  it('30. يرمّز ويفك ترميز فترة عمل المهمة (Time Block) للتوافق مع قواعد Firestore الحية ضمن حد 50 حرفًا', () => {
    const taskWithBlock = makeTask({
      reminderDate: '2026-05-12',
      scheduledStartAt: '2026-05-12T08:00:00.000Z',
      scheduledEndAt: '2026-05-12T09:30:00.000Z',
    });

    const wirePayload = encodeTaskTimeBlockForFirestore(taskWithBlock);
    assert.equal('scheduledStartAt' in wirePayload, false);
    assert.equal('scheduledEndAt' in wirePayload, false);
    assert.ok(typeof wirePayload.reminderDate === 'string');
    assert.ok(
      wirePayload.reminderDate.length <= 50,
      `يجب ألا يتجاوز reminderDate 50 حرفًا، الطول الفعلي: ${wirePayload.reminderDate.length}`
    );

    const decoded = decodeTaskTimeBlockFromFirestore(wirePayload);
    assert.equal(decoded.reminderDate, '2026-05-12');
    assert.equal(decoded.scheduledStartAt, '2026-05-12T08:00:00.000Z');
    assert.equal(decoded.scheduledEndAt, '2026-05-12T09:30:00.000Z');
    assert.equal(DEFAULT_CALENDAR_SETTINGS.weekStartDay, 6);
  });
});
