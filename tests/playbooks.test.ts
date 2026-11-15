import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ActionItem,
  Client,
  CommunicationInteraction,
  Opportunity,
  PlaybookRun,
  PlaybookTemplateStep,
} from '../src/types/index.ts';
import {
  BUILTIN_PLAYBOOK_TEMPLATES,
  MAX_PLAYBOOK_STEPS,
  STEP_DEPENDENCY_PLACEHOLDER_AR,
  buildPlaybookStepTaskId,
  cancelPlaybookRun,
  checkPlaybookRunRevisionConflict,
  clonePlaybookTemplateToCustom,
  completePlaybookRun,
  completePlaybookStep,
  computePlaybookRunProgress,
  computeStepDueDateForRun,
  createCustomPlaybookTemplate,
  createInMemoryPlaybookAtomicAdapter,
  executeAtomicStepTaskConversion,
  findPlaybookTemplateById,
  getAllAvailablePlaybookTemplates,
  getPlaybookRunStepPointers,
  linkCommunicationToPlaybookStep,
  linkExistingTaskToPlaybookStep,
  pausePlaybookRun,
  previewTemplateStepDueDates,
  reopenPlaybookStep,
  reorderPlaybookTemplateSteps,
  resumePlaybookRun,
  skipPlaybookStep,
  startPlaybookRun,
  startPlaybookStep,
  updateCustomPlaybookTemplate,
  updatePlaybookStepDueDate,
} from '../src/utils/playbookEngine.ts';
import {
  DEFAULT_CALENDAR_SETTINGS,
  buildCalendarEvents,
  buildWeekDaysRange,
  buildWeeklyPlanData,
  detectCalendarConflicts,
  sanitizeTaskForFirestoreSave,
} from '../src/utils/calendarEngine.ts';
import {
  DEFAULT_FOLLOW_UP_PREFERENCES,
  buildPlaybookStepReminderSourceId,
  computePlaybookStepFingerprint,
  evaluateReminders,
} from '../src/utils/followUpEngine.ts';
import {
  DEFAULT_SEARCH_FILTERS,
  buildSearchIndex,
  executeUniversalSearch,
} from '../src/utils/searchEngine.ts';
import {
  buildUserDataExportBundle,
  executeSafeImportPlan,
  validateAndPreviewImport,
} from '../src/utils/dataPortability.ts';

const USER_A = 'uid_alpha_1';
const USER_B = 'uid_beta_2';

function makeClient(overrides?: Partial<Client>): Client {
  return {
    id: 'cli_1',
    userId: USER_A,
    name: 'شركة المدار للتقنية',
    company: 'المدار',
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-01-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeOpportunity(overrides?: Partial<Opportunity>): Opportunity {
  return {
    id: 'opp_1',
    userId: USER_A,
    clientId: 'cli_1',
    title: 'تطوير منصة المبيعات',
    type: 'project',
    stage: 'proposal',
    priority: 'high',
    createdAt: '2026-01-12T09:00:00.000Z',
    updatedAt: '2026-01-12T09:00:00.000Z',
    ...overrides,
  };
}

function makeSteps(count: number = 3): PlaybookTemplateStep[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `tpl_step_${idx + 1}`,
    title: `خطوة رقم ${idx + 1}`,
    stepType: idx === 0 ? 'communication' : idx === 1 ? 'task' : 'manual',
    order: idx + 1,
    duePolicy:
      idx === 0
        ? { type: 'from_start', offsetDays: 0 }
        : { type: 'after_previous_completion', offsetDays: idx * 2 },
    priority: 'medium',
  }));
}

// 1. القوالب المدمجة الأربعة
test('01. Built-in templates include the 4 required Arabic playbooks with stable unique IDs', () => {
  assert.equal(BUILTIN_PLAYBOOK_TEMPLATES.length, 4);
  const names = BUILTIN_PLAYBOOK_TEMPLATES.map((t) => t.name);
  assert.deepEqual(names, [
    'التواصل مع عميل محتمل',
    'متابعة عرض مقدم',
    'المتابعة بعد اجتماع',
    'إعادة تنشيط علاقة',
  ]);
  for (const tpl of BUILTIN_PLAYBOOK_TEMPLATES) {
    assert.equal(tpl.isSystemTemplate, true);
    assert.equal(tpl.steps.length, 5);
    const ids = new Set(tpl.steps.map((s) => s.id));
    assert.equal(ids.size, tpl.steps.length);
  }
});

// 2. إنشاء قالب مخصص
test('02. Creates a valid custom playbook template', () => {
  const res = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'خطة متابعة كبار العملاء',
    description: 'خطة ربع سنوية',
    category: 'custom',
    steps: makeSteps(3),
  });
  assert.equal(res.ok, true);
  assert.ok(res.template);
  assert.equal(res.template!.isSystemTemplate, false);
  assert.equal(res.template!.userId, USER_A);
  assert.equal(res.template!.steps.length, 3);
});

// 3. تعديل قالب مخصص ومنع تعديل المدمج مباشرة
test('03. Updates custom template and blocks direct mutation of built-in system template', () => {
  const sysRes = updateCustomPlaybookTemplate({
    existingTemplate: BUILTIN_PLAYBOOK_TEMPLATES[0],
    name: 'تعديل غير مسموح',
    currentUserId: USER_A,
  });
  assert.equal(sysRes.ok, false);
  assert.ok(sysRes.errorAr?.includes('إنشاء نسخة قابلة للتعديل'));

  const created = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'قالب مبدئي',
    steps: makeSteps(2),
  }).template!;

  const reordered = reorderPlaybookTemplateSteps(created.steps, 0, 1);
  assert.equal(reordered[0].id, 'tpl_step_2');
  assert.equal(reordered[0].order, 1);
  assert.equal(reordered[1].id, 'tpl_step_1');
  assert.equal(reordered[1].order, 2);

  const updated = updateCustomPlaybookTemplate({
    existingTemplate: created,
    name: 'قالب محدث',
    steps: reordered,
    currentUserId: USER_A,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.template!.name, 'قالب محدث');
  assert.equal(updated.template!.steps[0].id, 'tpl_step_2');
});

// 4. نسخ قالب مدمج إلى قالب مخصص
test('04. Clones built-in system template into an editable custom template', () => {
  const cloned = clonePlaybookTemplateToCustom({
    sourceTemplate: BUILTIN_PLAYBOOK_TEMPLATES[1],
    userId: USER_A,
  });
  assert.equal(cloned.ok, true);
  assert.equal(cloned.template!.isSystemTemplate, false);
  assert.equal(cloned.template!.steps.length, 5);
  assert.notEqual(cloned.template!.id, BUILTIN_PLAYBOOK_TEMPLATES[1].id);
  assert.notEqual(cloned.template!.steps[0].id, BUILTIN_PLAYBOOK_TEMPLATES[1].steps[0].id);

  const available = getAllAvailablePlaybookTemplates([cloned.template!], USER_A);
  assert.equal(available.length, 5);
});

// 5. حذف قالب مخصص لا يحذف خططه السابقة
test('05. Deleting a custom template does not affect or break previously started PlaybookRuns', () => {
  let customTemplates = [
    createCustomPlaybookTemplate({
      id: 'custom_tpl_delete_test',
      userId: USER_A,
      name: 'قالب مؤقت',
      steps: makeSteps(2),
    }).template!,
  ];

  const startRes = startPlaybookRun({
    userId: USER_A,
    template: customTemplates[0],
    client: makeClient(),
    startDateKey: '2026-04-01',
  });
  assert.equal(startRes.ok, true);
  const run = startRes.run!;

  // Remove custom template from store
  customTemplates = [];
  assert.equal(findPlaybookTemplateById('custom_tpl_delete_test', customTemplates), undefined);
  assert.equal(run.steps.length, 2);
  assert.equal(run.templateName, 'قالب مؤقت');
});

// 6. منع القالب الفارغ والحد الأقصى للخطوات
test('06. Rejects empty template, empty name, and > MAX_PLAYBOOK_STEPS', () => {
  const emptySteps = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'قالب بلا خطوات',
    steps: [],
  });
  assert.equal(emptySteps.ok, false);

  const emptyName = createCustomPlaybookTemplate({
    userId: USER_A,
    name: '   ',
    steps: makeSteps(1),
  });
  assert.equal(emptyName.ok, false);

  const tooMany = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'قالب طويل جدًا',
    steps: makeSteps(MAX_PLAYBOOK_STEPS + 1),
  });
  assert.equal(tooMany.ok, false);
});

// 7. منع معرفات الخطوات المكررة
test('07. Rejects duplicate step IDs inside a template', () => {
  const dupSteps = makeSteps(2);
  dupSteps[1].id = dupSteps[0].id;
  const res = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'قالب مكرر المعرفات',
    steps: dupSteps,
  });
  assert.equal(res.ok, false);
  assert.ok(res.errorAr?.includes('مكررة'));
});

// 8. بدء خطة لعميل والتحقق من التكرار الاختياري
test('08. Starts a PlaybookRun for a client cleanly without creating tasks, and warns on duplicate active run', () => {
  const client = makeClient();
  const tpl = BUILTIN_PLAYBOOK_TEMPLATES[0];
  const res1 = startPlaybookRun({
    id: 'run_1',
    userId: USER_A,
    template: tpl,
    client,
    startDateKey: '2026-05-01',
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.run!.status, 'active');
  assert.equal(res1.run!.steps[0].dueDate, '2026-05-01');
  assert.equal(res1.run!.steps[1].dueDate, undefined);

  // Duplicate active run requires explicit confirmation
  const resDup = startPlaybookRun({
    userId: USER_A,
    template: tpl,
    client,
    existingRuns: [res1.run!],
  });
  assert.equal(resDup.ok, false);
  assert.equal(resDup.requiresDuplicateConfirmation, true);

  // Explicit confirmation succeeds
  const resConfirmed = startPlaybookRun({
    userId: USER_A,
    template: tpl,
    client,
    existingRuns: [res1.run!],
    confirmDuplicate: true,
    startDateKey: '2026-05-02',
  });
  assert.equal(resConfirmed.ok, true);
});

// 9 & 10. ربط خطة بفرصة صحيحة ورفض فرصة تخص عميلاً آخر
test('09 & 10. Links matching opportunity and rejects opportunity belonging to another client', () => {
  const client = makeClient({ id: 'cli_1' });
  const matchingOpp = makeOpportunity({ id: 'opp_1', clientId: 'cli_1' });
  const otherClientOpp = makeOpportunity({ id: 'opp_2', clientId: 'cli_2' });

  const okRes = startPlaybookRun({
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[1],
    client,
    opportunity: matchingOpp,
    startDateKey: '2026-05-10',
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.run!.opportunityId, 'opp_1');

  const mismatchRes = startPlaybookRun({
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[1],
    client,
    opportunity: otherClientOpp,
    startDateKey: '2026-05-10',
  });
  assert.equal(mismatchRes.ok, false);
  assert.equal(mismatchRes.code, 'OPPORTUNITY_CLIENT_MISMATCH');
});

// 11 & 12. استقلال نسخة خطوات الخطة وعدم تأثر الخطة النشطة بتعديل قالبها
test('11 & 12. PlaybookRun snapshots steps independently and stays unaffected by subsequent template edits', () => {
  const customTpl = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'خطة مخصصة',
    steps: makeSteps(2),
  }).template!;

  const run = startPlaybookRun({
    userId: USER_A,
    template: customTpl,
    client: makeClient(),
    startDateKey: '2026-05-10',
  }).run!;

  const modifiedTpl = updateCustomPlaybookTemplate({
    existingTemplate: customTpl,
    name: 'اسم جديد للقالب',
    steps: [
      {
        id: 'new_step_id',
        title: 'خطوة مختلفة كليًا',
        stepType: 'manual',
        order: 1,
        duePolicy: { type: 'from_start', offsetDays: 5 },
      },
    ],
    currentUserId: USER_A,
  }).template!;

  assert.equal(modifiedTpl.steps.length, 1);
  assert.equal(run.templateName, 'خطة مخصصة');
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0].title, 'خطوة رقم 1');
});

// 13 & 14 & 15 & 16. انتقال حالات الخطوات والخطة وإيقاف/استئناف/إلغاء
test('13–16. Step & run transitions: start, complete, skip, reopen, pause, resume, cancel without deleting linked records', () => {
  const tpl = BUILTIN_PLAYBOOK_TEMPLATES[0];
  let run: PlaybookRun = startPlaybookRun({
    id: 'run_lifecycle',
    userId: USER_A,
    template: tpl,
    client: makeClient(),
    startDateKey: '2026-06-01',
  }).run!;

  run = startPlaybookStep({ run, stepId: run.steps[0].id, currentUserId: USER_A }).run!;
  assert.equal(run.steps[0].status, 'in_progress');

  run = completePlaybookStep({
    run,
    stepId: run.steps[0].id,
    completedAtIso: '2026-06-01T10:00:00.000Z',
    currentUserId: USER_A,
  }).run!;
  assert.equal(run.steps[0].status, 'completed');
  assert.equal(run.steps[1].dueDate, '2026-06-03');

  run = skipPlaybookStep({ run, stepId: run.steps[1].id, currentUserId: USER_A }).run!;
  assert.equal(run.steps[1].status, 'skipped');

  // Reopen works on active run
  run = reopenPlaybookStep({ run, stepId: run.steps[1].id, currentUserId: USER_A }).run!;
  assert.equal(run.steps[1].status, 'pending');

  // Pause preserves existing dueDates and blocks step progression
  run = pausePlaybookRun({ run, currentUserId: USER_A }).run!;
  assert.equal(run.status, 'paused');
  assert.equal(run.steps[1].dueDate, '2026-06-03');
  const blockedStep = startPlaybookStep({ run, stepId: run.steps[1].id, currentUserId: USER_A });
  assert.equal(blockedStep.ok, false);

  // Resume preserves old dates without silent rescheduling
  run = resumePlaybookRun({ run, currentUserId: USER_A }).run!;
  assert.equal(run.status, 'active');
  assert.equal(run.steps[1].dueDate, '2026-06-03');

  // Cancel requires confirmation and keeps run/steps for history
  const cancelDenied = cancelPlaybookRun({ run, confirmed: false, currentUserId: USER_A });
  assert.equal(cancelDenied.ok, false);

  const cancelled = cancelPlaybookRun({
    run,
    confirmed: true,
    cancelReason: 'تأجل المشروع لدى العميل',
    currentUserId: USER_A,
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.run!.status, 'cancelled');
  assert.equal(cancelled.run!.steps.length, 5);
});

// 17–21. حساب المواعيد النسبية، عدم الاختلاق، المناطق الزمنية، والسنوات الكبيسة
test('17–21. Relative due dates handle from_start, after_previous_completion, no fabrication, timezones, and leap years', () => {
  // Preview never fabricates dependent step dates
  const preview = previewTemplateStepDueDates({
    steps: BUILTIN_PLAYBOOK_TEMPLATES[0].steps,
    startDateKey: '2026-06-10',
  });
  assert.equal(preview[0].dueDate, '2026-06-10');
  assert.equal(preview[1].dueDate, undefined);
  assert.equal(preview[1].labelAr, STEP_DEPENDENCY_PLACEHOLDER_AR);

  // Leap year boundary: 2024-02-28 + 1 day = 2024-02-29; + 2 days = 2024-03-01
  const leapSteps: PlaybookTemplateStep[] = [
    {
      id: 's1',
      title: 'أولى',
      stepType: 'task',
      order: 1,
      duePolicy: { type: 'from_start', offsetDays: 1 },
    },
    {
      id: 's2',
      title: 'ثانية',
      stepType: 'task',
      order: 2,
      duePolicy: { type: 'from_start', offsetDays: 2 },
    },
    {
      id: 's3',
      title: 'ثالثة',
      stepType: 'task',
      order: 3,
      duePolicy: { type: 'after_previous_completion', offsetDays: 3 },
    },
  ];
  const leapTpl = createCustomPlaybookTemplate({
    userId: USER_A,
    name: 'اختبار كبيسة',
    steps: leapSteps,
  }).template!;

  const leapRun = startPlaybookRun({
    userId: USER_A,
    template: leapTpl,
    client: makeClient(),
    startDateKey: '2024-02-28',
  }).run!;
  assert.equal(leapRun.steps[0].dueDate, '2024-02-29');
  assert.equal(leapRun.steps[1].dueDate, '2024-03-01');
  assert.equal(leapRun.steps[2].dueDate, undefined);

  // Non-leap year: 2025-02-28 + 1 day = 2025-03-01
  const nonLeapRun = startPlaybookRun({
    userId: USER_A,
    template: leapTpl,
    client: makeClient(),
    startDateKey: '2025-02-28',
  }).run!;
  assert.equal(nonLeapRun.steps[0].dueDate, '2025-03-01');

  // Timezone boundary near UTC midnight: 2026-03-01T22:30:00.000Z is 2026-03-02 in Asia/Riyadh (UTC+3),
  // vs 2026-03-01 in America/New_York (UTC-5)
  const completedRiyadh = completePlaybookStep({
    run: leapRun,
    stepId: 's2',
    completedAtIso: '2026-03-01T22:30:00.000Z',
    timeZone: 'Asia/Riyadh',
  }).run!;
  assert.equal(completedRiyadh.steps[2].dueDate, '2026-03-05');

  const dueNewYork = computeStepDueDateForRun({
    step: completedRiyadh.steps[2],
    stepIndex: 2,
    allSteps: completedRiyadh.steps,
    runStartDateKey: '2024-02-28',
    timeZone: 'America/New_York',
  });
  assert.equal(dueNewYork, '2026-03-04');
});

// Reschedule suggestion instead of overwriting an already-linked task's dueDate
test('18b. Emits reschedule suggestion instead of silently overwriting linked task dueDate', () => {
  let run = startPlaybookRun({
    id: 'run_resched',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[1],
    client: makeClient(),
    startDateKey: '2026-07-01',
  }).run!;

  const preLinkedTask: ActionItem = {
    id: 'task_existing_2',
    userId: USER_A,
    clientId: 'cli_1',
    playbookRunId: run.id,
    playbookStepId: run.steps[1].id,
    title: run.steps[1].title,
    dueDate: '2026-07-15',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-07-01T08:00:00.000Z',
  };

  run = linkExistingTaskToPlaybookStep({
    run,
    stepId: run.steps[1].id,
    task: preLinkedTask,
    allRuns: [run],
    currentUserId: USER_A,
  }).run!;

  const completeRes = completePlaybookStep({
    run,
    stepId: run.steps[0].id,
    tasks: [preLinkedTask],
    completedAtIso: '2026-07-01T12:00:00.000Z',
    timeZone: 'UTC',
  });
  assert.equal(completeRes.ok, true);
  assert.equal(completeRes.rescheduleSuggestions.length, 1);
  assert.equal(completeRes.rescheduleSuggestions[0].suggestedDueDate, '2026-07-02');
  assert.equal(completeRes.rescheduleSuggestions[0].currentTaskDueDate, '2026-07-15');
  assert.equal(preLinkedTask.dueDate, '2026-07-15');
});

// 22–26. تحويل خطوة إلى مهمة + منع التكرار + التزامن + عدم الكتابة فوق مهمة معدلة
test('22–26. Atomic step-to-task creation: single task on double submit, concurrent race, retry after lost response, preserves user edits, blocks offline', async () => {
  const run = startPlaybookRun({
    id: 'run_atomic_1',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[1],
    client: makeClient(),
    opportunity: makeOpportunity(),
    startDateKey: '2026-08-01',
  }).run!;

  const stepId = run.steps[0].id;
  const adapter = createInMemoryPlaybookAtomicAdapter({ runs: [run], tasks: [] });

  // Offline blocked cleanly
  const offlineRes = await executeAtomicStepTaskConversion(
    { userId: USER_A, run, stepId, isOnline: false },
    adapter
  );
  assert.equal(offlineRes.ok, false);
  assert.equal(offlineRes.code, 'OFFLINE_BLOCKED');
  assert.ok(offlineRes.draftTask);
  assert.equal(adapter.getTasks().length, 0);

  // Concurrent race (two tabs / double-click simultaneously)
  const [raceA, raceB] = await Promise.all([
    executeAtomicStepTaskConversion({ userId: USER_A, run, stepId, isOnline: true }, adapter),
    executeAtomicStepTaskConversion({ userId: USER_A, run, stepId, isOnline: true }, adapter),
  ]);

  assert.equal(raceA.ok, true);
  assert.equal(raceB.ok, true);
  assert.equal(adapter.getTasks().length, 1);
  assert.equal(raceA.task!.id, buildPlaybookStepTaskId(run.id, stepId));
  assert.equal(raceB.task!.id, raceA.task!.id);
  assert.equal(raceB.alreadyExisted, true);
  assert.equal(raceA.task!.playbookRunId, run.id);
  assert.equal(raceA.task!.playbookStepId, stepId);
  assert.equal(raceA.task!.opportunityId, 'opp_1');

  // Verify sanitizeTaskForFirestoreSave preserves playbook refs
  const sanitized = sanitizeTaskForFirestoreSave(raceA.task!);
  assert.equal(sanitized.playbookRunId, run.id);
  assert.equal(sanitized.playbookStepId, stepId);

  // Simulate user editing the created task and then client retrying conversion after a lost response
  const userEditedTask: ActionItem = {
    ...adapter.getTasks()[0],
    title: 'عنوان عدّله المستخدم يدويًا',
    priority: 'urgent',
    dueDate: '2026-08-20',
  };
  const retryAdapter = createInMemoryPlaybookAtomicAdapter({
    runs: [run], // Stale client snapshot before linkedTaskId was saved back
    tasks: [userEditedTask],
  });

  const retryRes = await executeAtomicStepTaskConversion(
    {
      userId: USER_A,
      run,
      stepId,
      isOnline: true,
      titleOverride: 'عنوان قديم من الإعادة',
      priorityOverride: 'low',
    },
    retryAdapter
  );
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.alreadyExisted, true);
  assert.equal(retryAdapter.getTasks().length, 1);
  assert.equal(retryAdapter.getTasks()[0].title, 'عنوان عدّله المستخدم يدويًا');
  assert.equal(retryAdapter.getTasks()[0].priority, 'urgent');
  assert.equal(retryAdapter.getTasks()[0].dueDate, '2026-08-20');
});

// 27–29. تكامل التواصل: عميل صحيح، رفض عميل آخر، وعدم اعتبار no_answer اتصالاً ناجحاً
test('27–29. Links matching communication, rejects cross-client communication, and never auto-completes on no_answer', () => {
  const run = startPlaybookRun({
    id: 'run_comm',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client: makeClient({ id: 'cli_1' }),
    startDateKey: '2026-08-05',
  }).run!;

  const noAnswerComm: CommunicationInteraction = {
    id: 'comm_no_ans',
    userId: USER_A,
    clientId: 'cli_1',
    channel: 'phone_call',
    direction: 'outbound',
    occurredAt: '2026-08-05T11:00:00.000Z',
    subject: 'محاولة اتصال أولى',
    outcome: 'no_answer',
    createdAt: '2026-08-05T11:00:00.000Z',
    updatedAt: '2026-08-05T11:00:00.000Z',
  };

  const linkRes = linkCommunicationToPlaybookStep({
    run,
    stepId: run.steps[0].id,
    interaction: noAnswerComm,
    currentUserId: USER_A,
  });
  assert.equal(linkRes.ok, true);
  assert.equal(linkRes.isSuccessfulContact, false);
  assert.equal(linkRes.run!.steps[0].linkedInteractionId, 'comm_no_ans');
  assert.equal(linkRes.run!.steps[0].status, 'in_progress');
  assert.notEqual(linkRes.run!.steps[0].status, 'completed');

  const foreignComm: CommunicationInteraction = {
    ...noAnswerComm,
    id: 'comm_other',
    clientId: 'cli_999',
  };
  const rejectRes = linkCommunicationToPlaybookStep({
    run,
    stepId: run.steps[0].id,
    interaction: foreignComm,
    currentUserId: USER_A,
  });
  assert.equal(rejectRes.ok, false);
});

// 30 & 31. احتساب التقدم الحقيقي وعدم احتساب skipped كـ completed
test('30 & 31. Honest progress metrics exclude skipped steps from completed count', () => {
  let run = startPlaybookRun({
    id: 'run_prog',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client: makeClient(),
    startDateKey: '2026-08-10',
  }).run!;

  run = completePlaybookStep({ run, stepId: run.steps[0].id }).run!;
  run = skipPlaybookStep({ run, stepId: run.steps[1].id }).run!;
  run = skipPlaybookStep({ run, stepId: run.steps[2].id }).run!;

  const prog = computePlaybookRunProgress(run);
  assert.equal(prog.totalStepsCount, 5);
  assert.equal(prog.completedStepsCount, 1);
  assert.equal(prog.skippedStepsCount, 2);
  assert.equal(prog.actionableRemainingCount, 2);
  assert.equal(prog.completionPercent, 20);
  assert.equal(prog.isReadyToFinish, false);

  const pointers = getPlaybookRunStepPointers(run);
  assert.equal(pointers.currentStep?.id, run.steps[3].id);

  // Explicit finish confirmation required
  const finishNoConfirm = completePlaybookRun({ run, confirmed: false });
  assert.equal(finishNoConfirm.ok, false);
  const finishConfirm = completePlaybookRun({ run, confirmed: true });
  assert.equal(finishConfirm.ok, true);
  assert.equal(finishConfirm.run!.status, 'completed');
});

// 38 & 39 & Manual Step Date Edit & Multi-device revision conflict
test('38 & 39. Enforces user isolation, supports legacy clients without optional fields, and detects multi-device revision conflicts', () => {
  const legacyClient: Client = {
    id: 'legacy_cli',
    name: 'عميل قديم بدون حقول اختيارية',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const run = startPlaybookRun({
    id: 'run_legacy',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[3],
    client: legacyClient,
    startDateKey: '2026-08-15',
  }).run!;
  assert.equal(run.steps.length, 5);

  const foreignUserCheck = startPlaybookStep({
    run,
    stepId: run.steps[0].id,
    currentUserId: USER_B,
  });
  assert.equal(foreignUserCheck.ok, false);

  const dueUpdate = updatePlaybookStepDueDate({
    run,
    stepId: run.steps[1].id,
    dueDate: '2026-08-22',
    currentUserId: USER_A,
  });
  assert.equal(dueUpdate.ok, true);
  assert.equal(dueUpdate.run!.steps[1].dueDate, '2026-08-22');

  const remoteAhead: PlaybookRun = {
    ...dueUpdate.run!,
    revision: 5,
    status: 'paused',
    pausedAt: '2026-08-16T10:00:00.000Z',
  };
  const conflict = checkPlaybookRunRevisionConflict({
    localRun: run,
    remoteRun: remoteAhead,
    expectedBaseRevision: 1,
  });
  assert.ok(conflict);
  assert.equal(conflict!.entityType, 'playbookRun');
});

// =========================================================================
// Task 013-C: Cross-Module Integration Tests
// =========================================================================

// 32. التكامل مع التذكيرات: ظهور الخطوات المستحقة/المتأخرة ومنع التكرار مع المهام وتأجيل/إلغاء صالح
test('32. Follow-up reminders: emits overdue/due_today/due_soon for active runs, deduplicates against open linked tasks, preserves step dueDate on snooze, and invalidates cleanly', () => {
  const client = makeClient();
  const baseTemplate = {
    ...BUILTIN_PLAYBOOK_TEMPLATES[0],
    steps: [
      {
        id: 'step_over',
        title: 'مكالمة متأخرة',
        stepType: 'communication' as const,
        order: 1,
        duePolicy: { type: 'from_start' as const, offsetDays: 0 },
      },
      {
        id: 'step_today',
        title: 'إرسال عرض مبدئي اليوم',
        stepType: 'task' as const,
        order: 2,
        duePolicy: { type: 'from_start' as const, offsetDays: 2 },
      },
      {
        id: 'step_soon',
        title: 'تأكيد استلام العرض',
        stepType: 'communication' as const,
        order: 3,
        duePolicy: { type: 'from_start' as const, offsetDays: 4 },
      },
      {
        id: 'step_dep',
        title: 'خطوة معتمدة لم يُحدد تاريخها',
        stepType: 'manual' as const,
        order: 4,
        duePolicy: { type: 'after_previous_completion' as const, offsetDays: 2 },
      },
    ],
  };

  const activeRun = startPlaybookRun({
    id: 'run_rem_active',
    userId: USER_A,
    template: baseTemplate,
    client,
    startDateKey: '2026-09-01',
  }).run!;

  const pausedRun = pausePlaybookRun({
    run: startPlaybookRun({
      id: 'run_rem_paused',
      userId: USER_A,
      template: baseTemplate,
      client,
      startDateKey: '2026-09-01',
    }).run!,
    nowIso: '2026-09-02T10:00:00.000Z',
  }).run!;

  const refDate = new Date('2026-09-03T10:00:00.000Z'); // step_over=09-01 (overdue), step_today=09-03, step_soon=09-05 (+2 days)

  const initialRes = evaluateReminders({
    clients: [client],
    meetings: [],
    tasks: [],
    playbookRuns: [activeRun, pausedRun],
    persistedStates: [],
    preferences: { ...DEFAULT_FOLLOW_UP_PREFERENCES, upcomingTaskWindowDays: 3 },
    referenceDate: refDate,
    timeZone: 'UTC',
  });

  const pbRems = initialRes.active.filter((r) => r.sourceType === 'playbook_step');
  assert.equal(pbRems.length, 3);
  assert.ok(pbRems.every((r) => r.playbookRunId === 'run_rem_active'));
  assert.equal(
    pbRems.find((r) => r.playbookStepId === 'step_over')?.reason,
    'playbook_step_overdue'
  );
  assert.equal(
    pbRems.find((r) => r.playbookStepId === 'step_today')?.reason,
    'playbook_step_due_today'
  );
  assert.equal(
    pbRems.find((r) => r.playbookStepId === 'step_soon')?.reason,
    'playbook_step_due_soon'
  );

  // When step_today has an OPEN linked task, the playbook_step reminder must be suppressed to avoid duplicates
  const openLinkedTask: ActionItem = {
    id: buildPlaybookStepTaskId(activeRun.id, 'step_today'),
    userId: USER_A,
    clientId: client.id,
    playbookRunId: activeRun.id,
    playbookStepId: 'step_today',
    title: 'إرسال عرض مبدئي اليوم',
    dueDate: '2026-09-03',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-09-01T08:00:00.000Z',
  };
  const dedupRes = evaluateReminders({
    clients: [client],
    meetings: [],
    tasks: [openLinkedTask],
    playbookRuns: [activeRun],
    persistedStates: [],
    preferences: { ...DEFAULT_FOLLOW_UP_PREFERENCES, upcomingTaskWindowDays: 3 },
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  const pbDedupRems = dedupRes.active.filter((r) => r.sourceType === 'playbook_step');
  assert.equal(pbDedupRems.some((r) => r.playbookStepId === 'step_today'), false);
  assert.equal(pbDedupRems.length, 2);

  // If the linked task is CANCELLED, the step reminder resurfaces automatically
  const cancelledTask: ActionItem = { ...openLinkedTask, status: 'cancelled' };
  const resurfaceRes = evaluateReminders({
    clients: [client],
    meetings: [],
    tasks: [cancelledTask],
    playbookRuns: [activeRun],
    persistedStates: [],
    preferences: { ...DEFAULT_FOLLOW_UP_PREFERENCES, upcomingTaskWindowDays: 3 },
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  assert.equal(
    resurfaceRes.active.some(
      (r) => r.sourceType === 'playbook_step' && r.playbookStepId === 'step_today'
    ),
    true
  );

  // Snooze state hides reminder while keeping step.dueDate unchanged, and completing step invalidates reminder
  const overReminder = pbRems.find((r) => r.playbookStepId === 'step_over')!;
  const persistedSnooze = {
    id: overReminder.id,
    userId: USER_A,
    sourceType: 'playbook_step' as const,
    sourceId: buildPlaybookStepReminderSourceId(activeRun.id, 'step_over'),
    reason: 'playbook_step_overdue' as const,
    clientId: client.id,
    status: 'snoozed' as const,
    sourceFingerprint: computePlaybookStepFingerprint(activeRun, activeRun.steps[0]),
    snoozedUntil: '2026-09-04T09:00:00.000Z',
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  };
  const snoozedRes = evaluateReminders({
    clients: [client],
    meetings: [],
    tasks: [],
    playbookRuns: [activeRun],
    persistedStates: [persistedSnooze],
    preferences: { ...DEFAULT_FOLLOW_UP_PREFERENCES, upcomingTaskWindowDays: 3 },
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  assert.equal(snoozedRes.snoozed.some((r) => r.id === overReminder.id), true);
  assert.equal(activeRun.steps[0].dueDate, '2026-09-01');

  const completedStepRun = completePlaybookStep({
    run: activeRun,
    stepId: 'step_over',
    completedAtIso: '2026-09-03T11:00:00.000Z',
    timeZone: 'UTC',
  }).run!;
  const invalidatedRes = evaluateReminders({
    clients: [client],
    meetings: [],
    tasks: [],
    playbookRuns: [completedStepRun],
    persistedStates: [persistedSnooze],
    preferences: { ...DEFAULT_FOLLOW_UP_PREFERENCES, upcomingTaskWindowDays: 3 },
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  const invItem = invalidatedRes.invalidated.find((r) => r.id === overReminder.id);
  assert.ok(invItem);
  assert.ok(invItem!.invalidationReasonArabic?.includes('أُنجزت'));
});

// 33. التكامل مع التقويم ومخطط الأسبوع: ظهور الخطوات بدون اختلاق ساعات أو تعارضات + خصم المهام المرتبطة
test('33. Calendar integration: emits date-only playbook_step events, respects showPlaybooks/filterScope, deduplicates non-cancelled linked tasks, updates weekly counts without creating time conflicts', () => {
  const client = makeClient();
  const tpl = {
    ...BUILTIN_PLAYBOOK_TEMPLATES[0],
    steps: [
      {
        id: 'cal_s1',
        title: 'مكالمة متابعة أسبوعية',
        stepType: 'communication' as const,
        order: 1,
        duePolicy: { type: 'from_start' as const, offsetDays: 0 },
      },
      {
        id: 'cal_s2',
        title: 'خطوة محولة لمهمة مفتوحة',
        stepType: 'task' as const,
        order: 2,
        duePolicy: { type: 'from_start' as const, offsetDays: 1 },
      },
    ],
  };
  const run = startPlaybookRun({
    id: 'run_cal_1',
    userId: USER_A,
    template: tpl,
    client,
    startDateKey: '2026-09-07',
  }).run!;

  const linkedTask: ActionItem = {
    id: buildPlaybookStepTaskId(run.id, 'cal_s2'),
    userId: USER_A,
    clientId: client.id,
    playbookRunId: run.id,
    playbookStepId: 'cal_s2',
    title: 'خطوة محولة لمهمة مفتوحة',
    dueDate: '2026-09-08',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-09-07T08:00:00.000Z',
  };

  const refDate = new Date('2026-09-08T10:00:00.000Z');
  const eventsAll = buildCalendarEvents({
    clients: [client],
    meetings: [],
    tasks: [linkedTask],
    playbookRuns: [run],
    currentUserId: USER_A,
    referenceDate: refDate,
    timeZone: 'UTC',
    settings: DEFAULT_CALENDAR_SETTINGS,
    filterScope: 'all',
  });

  const pbEvents = eventsAll.filter((e) => e.activityType === 'playbook_step');
  assert.equal(pbEvents.length, 1);
  assert.equal(pbEvents[0].playbookStepId, 'cal_s1');
  assert.equal(pbEvents[0].isTimed, false);
  assert.equal(pbEvents[0].isOverdue, true);
  assert.equal(pbEvents[0].playbookRunRef?.id, run.id);

  // Follow-ups filter keeps playbook_step; meetings filter excludes it; showPlaybooks=false hides it
  const followUpScopeEvents = buildCalendarEvents({
    clients: [client],
    meetings: [],
    tasks: [linkedTask],
    playbookRuns: [run],
    currentUserId: USER_A,
    referenceDate: refDate,
    timeZone: 'UTC',
    filterScope: 'follow_ups',
  });
  assert.equal(followUpScopeEvents.some((e) => e.activityType === 'playbook_step'), true);

  const hiddenEvents = buildCalendarEvents({
    clients: [client],
    meetings: [],
    tasks: [linkedTask],
    playbookRuns: [run],
    currentUserId: USER_A,
    referenceDate: refDate,
    timeZone: 'UTC',
    settings: { showPlaybooks: false },
    filterScope: 'all',
  });
  assert.equal(hiddenEvents.some((e) => e.activityType === 'playbook_step'), false);

  // Date-only playbook steps never create timed calendar conflicts
  assert.equal(detectCalendarConflicts(eventsAll).length, 0);

  // Day cell followUps count and weekly summary include playbook_step
  const weekDays = buildWeekDaysRange({
    anchorDateKey: '2026-09-07',
    weekStartDay: 6,
    events: eventsAll,
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  const sep7Cell = weekDays.find((d) => d.dateKey === '2026-09-07');
  assert.equal(sep7Cell?.counts.followUps, 1);

  const weeklyPlan = buildWeeklyPlanData({
    anchorDateKey: '2026-09-07',
    weekStartDay: 6,
    events: eventsAll,
    allTasks: [linkedTask],
    currentUserId: USER_A,
    referenceDate: refDate,
    timeZone: 'UTC',
  });
  assert.equal(weeklyPlan.summary.followUpsCount, 1);
  assert.equal(weeklyPlan.summary.overdueCommitmentsCount, 1);
});

// 34. التكامل مع البحث الشامل: فهرسة الخطط بالاسم والخطوات والعميل وعزل المستخدم
test('34. Universal search indexes owned playbook runs by Arabic normalized name/step/client and isolates foreign users', () => {
  const client = makeClient({ tags: ['استراتيجي'] });
  const opp = makeOpportunity();
  const runOwned = pausePlaybookRun({
    run: startPlaybookRun({
      id: 'run_search_1',
      userId: USER_A,
      template: BUILTIN_PLAYBOOK_TEMPLATES[1],
      client,
      opportunity: opp,
      startDateKey: '2026-09-10',
    }).run!,
    nowIso: '2026-09-11T09:00:00.000Z',
  }).run!;

  const runForeign = startPlaybookRun({
    id: 'run_search_foreign',
    userId: USER_B,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client: makeClient({ id: 'cli_b', userId: USER_B, name: 'عميل مستخدم آخر' }),
    startDateKey: '2026-09-10',
  }).run!;

  const index = buildSearchIndex({
    currentUserId: USER_A,
    clients: [client],
    meetings: [],
    tasks: [],
    notes: [],
    opportunities: [opp],
    interactions: [],
    playbookRuns: [runOwned, runForeign],
  });

  const playbookEntries = index.filter((e) => e.recordType === 'playbook');
  assert.equal(playbookEntries.length, 1);
  assert.equal(playbookEntries[0].playbookRunRef?.id, 'run_search_1');

  const queryRes = executeUniversalSearch({
    index,
    query: 'تطوير منصة المبيعات',
    filters: { ...DEFAULT_SEARCH_FILTERS, recordType: 'playbook', status: 'paused' },
    collectionsLoaded: { playbookRuns: true },
  });
  assert.equal(queryRes.items.length, 1);
  assert.equal(queryRes.items[0].playbookRunRef?.id, 'run_search_1');
  assert.equal(queryRes.items[0].recordType, 'playbook');
});

// 35–37. التصدير والاستيراد الآمن: استبعاد القوالب المدمجة، رفض انتحال sys_*، إعادة ربط userId، وفك الفرصة المفقودة
test('35–37. Data portability exports custom templates & owned runs cleanly, blocks system template spoofing, rebinds foreign userId, and unlinks missing optional opportunityId', async () => {
  const client = makeClient();
  const opp = makeOpportunity();
  const customTemplate = createCustomPlaybookTemplate({
    id: 'pb_tpl_custom_export',
    userId: USER_A,
    name: 'خطة استشارات متخصصة',
    category: 'custom',
    steps: makeSteps(2),
    nowIso: '2026-09-01T10:00:00.000Z',
  }).template!;

  const foreignTemplate = createCustomPlaybookTemplate({
    id: 'pb_tpl_foreign',
    userId: USER_B,
    name: 'قالب مستخدم آخر',
    category: 'custom',
    steps: makeSteps(2),
    nowIso: '2026-09-01T10:00:00.000Z',
  }).template!;

  const ownedRun = startPlaybookRun({
    id: 'run_port_1',
    userId: USER_A,
    template: customTemplate,
    client,
    opportunity: opp,
    startDateKey: '2026-09-12',
  }).run!;

  const foreignRun = startPlaybookRun({
    id: 'run_port_foreign',
    userId: USER_B,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client: makeClient({ id: 'cli_f', userId: USER_B }),
    startDateKey: '2026-09-12',
  }).run!;

  // Export includes custom template & owned run, excludes builtin & foreign docs
  const exported = buildUserDataExportBundle({
    currentUserId: USER_A,
    clients: [client],
    meetings: [],
    tasks: [],
    notes: [],
    opportunities: [opp],
    opportunityStageEvents: [],
    interactions: [],
    playbookTemplates: [customTemplate, foreignTemplate, BUILTIN_PLAYBOOK_TEMPLATES[0]],
    playbookRuns: [ownedRun, foreignRun],
    collectionsLoaded: {
      clients: true,
      meetings: true,
      tasks: true,
      notes: true,
      opportunities: true,
      opportunityStageEvents: true,
      interactions: true,
      playbookTemplates: true,
      playbookRuns: true,
    },
  });

  assert.equal(exported.counts.playbookTemplates, 1);
  assert.equal(exported.counts.playbookRuns, 1);
  assert.equal(exported.data.playbookTemplates?.[0].id, 'pb_tpl_custom_export');
  assert.equal(exported.data.playbookRuns?.[0].id, 'run_port_1');

  // Craft tampered import file containing:
  // 1) valid custom template belonging to USER_B (must be rebound to USER_A)
  // 2) spoofed system template claiming isSystemTemplate: true (must be rejected)
  // 3) run referencing missing optional opportunityId (must unlink opportunityId & increment brokenRelationshipsCount)
  // 4) run referencing non-existent clientId (must be rejected)
  const importPayload = {
    ...exported,
    data: {
      ...exported.data,
      playbookTemplates: [
        { ...customTemplate, id: 'pb_tpl_imported_ok', userId: USER_B },
        { ...customTemplate, id: 'sys_pb_spoof', isSystemTemplate: true },
      ],
      playbookRuns: [
        { ...ownedRun, id: 'run_imp_unlinked_opp', userId: USER_B, opportunityId: 'opp_missing_999' },
        { ...ownedRun, id: 'run_imp_missing_client', clientId: 'cli_missing_999' },
      ],
    },
  };

  const preview = validateAndPreviewImport({
    fileContent: JSON.stringify(importPayload),
    fileName: 'murafiq-playbooks.json',
    fileSizeBytes: 8192,
    existingData: {
      currentUserId: USER_A,
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
      interactions: [],
      playbookTemplates: [],
      playbookRuns: [],
    },
  });

  assert.equal(preview.canProceed, true);
  assert.equal(preview.countsByCollection.playbookTemplates?.validToImport, 1);
  assert.equal(preview.countsByCollection.playbookTemplates?.rejected, 1);
  assert.equal(preview.countsByCollection.playbookRuns?.validToImport, 1);
  assert.equal(preview.countsByCollection.playbookRuns?.rejected, 1);
  assert.equal(preview.sanitizedBatch.playbookTemplates?.[0].userId, USER_A);
  assert.equal(preview.sanitizedBatch.playbookRuns?.[0].userId, USER_A);
  assert.equal(preview.sanitizedBatch.playbookRuns?.[0].opportunityId, undefined);
  assert.ok(preview.brokenRelationshipsCount >= 1);

  const savedTemplates: string[] = [];
  const savedRuns: string[] = [];
  const execReport = await executeSafeImportPlan({
    preview,
    confirmed: true,
    isOnline: true,
    handlers: {
      saveClient: async () => {},
      saveOpportunity: async () => {},
      saveMeeting: async () => {},
      saveTask: async () => {},
      saveNote: async () => {},
      saveOpportunityStageEvent: async () => {},
      saveInteraction: async () => {},
      savePlaybookTemplate: async (tpl) => {
        savedTemplates.push(tpl.id);
      },
      savePlaybookRun: async (r) => {
        savedRuns.push(r.id);
      },
    },
  });

  assert.equal(execReport.status, 'completed');
  assert.deepEqual(savedTemplates, ['pb_tpl_imported_ok']);
  assert.deepEqual(savedRuns, ['run_imp_unlinked_opp']);
});

