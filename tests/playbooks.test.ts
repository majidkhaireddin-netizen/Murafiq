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
  PlaybookOfflineSyncQueue,
  applyAtomicStepToTaskInTransactionState,
  applyPlaybookRunCasSaveInTransactionState,
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
  createInMemoryPlaybookCasAndAtomicBackend,
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
import { resolveConflictRecord } from '../src/utils/conflictLogic.ts';
import { computeDetailedSyncSummary, CollectionKey, CollectionSyncStatus } from '../src/utils/syncLogic.ts';
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

// =========================================================================
// Task 013-Fix-01: Cross-Device Playbook Revision Integrity & Atomic Task Safety
// =========================================================================

function buildAllLoadedSyncStatuses(
  overrides: Partial<Record<CollectionKey, Partial<CollectionSyncStatus>>> = {}
): Record<CollectionKey, CollectionSyncStatus> {
  const base: CollectionSyncStatus = {
    loaded: true,
    hasPendingWrites: false,
    fromCache: false,
    hasError: false,
    pendingDocIds: [],
    pendingDeletesCount: 0,
  };
  const keys: CollectionKey[] = [
    'clients',
    'meetings',
    'tasks',
    'notes',
    'opportunities',
    'opportunityStageEvents',
    'interactions',
    'reminders',
    'preferences',
    'playbookTemplates',
    'playbookRuns',
  ];
  const map = {} as Record<CollectionKey, CollectionSyncStatus>;
  for (const k of keys) {
    map[k] = { ...base, ...(overrides[k] || {}) };
  }
  return map;
}

// 40 (F.1). تعديلان متزامنان من جهازين على خطوتين مختلفتين لنفس الخطة من نفس revision=1
test('40. Task 013-Fix-01 (F.1): Rejects stale CAS save when two devices edit different steps from revision=1, prevents Lost Update, and merges both steps cleanly', async () => {
  const client = makeClient();
  const initialRun = startPlaybookRun({
    id: 'run_cas_diff_steps',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-01',
    nowIso: '2026-10-01T08:00:00.000Z',
  }).run!;
  assert.equal(initialRun.revision, 1);

  const backend = createInMemoryPlaybookCasAndAtomicBackend({ runs: [initialRun] });

  // Device A & Device B both start from revision=1
  const deviceARead = { ...initialRun, steps: initialRun.steps.map((s) => ({ ...s })) };
  const deviceBRead = { ...initialRun, steps: initialRun.steps.map((s) => ({ ...s })) };

  // Device A completes Step 1 and saves against baseRevision=1 -> succeeds as revision=2
  const devAMut = completePlaybookStep({
    run: deviceARead,
    stepId: deviceARead.steps[0].id,
    completedAtIso: '2026-10-01T09:00:00.000Z',
  }).run!;
  const saveA = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: devAMut,
    expectedBaseRevision: 1,
    nowIso: '2026-10-01T09:00:00.000Z',
  });
  assert.equal(saveA.ok, true);
  assert.equal(saveA.code, 'UPDATED');
  assert.equal(saveA.savedRun!.revision, 2);

  // Device B completes Step 2 based on revision=1 -> MUST fail with CONFLICT (never overwrite Step 1!)
  const devBMut = completePlaybookStep({
    run: deviceBRead,
    stepId: deviceBRead.steps[1].id,
    completedAtIso: '2026-10-01T09:05:00.000Z',
  }).run!;
  const saveB = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: devBMut,
    expectedBaseRevision: 1,
    nowIso: '2026-10-01T09:05:00.000Z',
  });

  assert.equal(saveB.ok, false);
  assert.equal(saveB.code, 'CONFLICT');
  assert.ok(saveB.serverRun);
  assert.ok(saveB.localDraft);
  assert.ok(saveB.conflict);
  assert.equal(saveB.conflict!.detectionSource, 'revision_cas');

  // Server still holds Device A's revision=2 untouched
  const serverAfterReject = backend.getRuns().find((r) => r.id === initialRun.id)!;
  assert.equal(serverAfterReject.revision, 2);
  assert.equal(serverAfterReject.steps[0].status, 'completed');
  assert.equal(serverAfterReject.steps[1].status, 'pending');

  // Device B's draft was NOT marked synced
  const conflictSyncSummary = computeDetailedSyncSummary({
    statuses: buildAllLoadedSyncStatuses({
      playbookRuns: { hasPendingWrites: true, pendingDocIds: [initialRun.id] },
    }),
    hasActiveConflict: true,
    conflictCount: 1,
    isOnline: true,
  });
  assert.equal(conflictSyncSummary.syncState, 'conflict');

  // Smart merge preserves BOTH Step 1 (Device A) and Step 2 (Device B) and advances cleanly to revision=3
  const merged = resolveConflictRecord<PlaybookRun>(saveB.conflict!, 'merge');
  assert.equal(merged.steps[0].status, 'completed');
  assert.equal(merged.steps[1].status, 'completed');
  assert.equal(merged.revision, 3);

  const commitMerged = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: merged,
    expectedBaseRevision: saveB.serverRun!.revision,
    nowIso: '2026-10-01T09:10:00.000Z',
  });
  assert.equal(commitMerged.ok, true);
  assert.equal(commitMerged.savedRun!.revision, 3);
  assert.equal(commitMerged.savedRun!.steps[0].status, 'completed');
  assert.equal(commitMerged.savedRun!.steps[1].status, 'completed');
});

// 41 (F.2). تعديلان متزامنان من جهازين على نفس الخطوة
test('41. Task 013-Fix-01 (F.2): Concurrent edits to the same step preserve both versions in conflict modal & resolve cleanly with keep_local / keep_remote / merge', async () => {
  const client = makeClient();
  const initialRun = startPlaybookRun({
    id: 'run_cas_same_step',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-02',
  }).run!;
  const backend = createInMemoryPlaybookCasAndAtomicBackend({ runs: [initialRun] });
  const targetStepId = initialRun.steps[0].id;

  const devA = completePlaybookStep({
    run: initialRun,
    stepId: targetStepId,
    note: 'ملاحظة الجهاز أ: العميل وافق مبدئيًا',
    completedAtIso: '2026-10-02T10:00:00.000Z',
  }).run!;
  await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: devA,
    expectedBaseRevision: 1,
    nowIso: '2026-10-02T10:00:00.000Z',
  });

  const devB = completePlaybookStep({
    run: initialRun,
    stepId: targetStepId,
    note: 'ملاحظة الجهاز ب: طلب إرسال الفاتورة',
    completedAtIso: '2026-10-02T10:05:00.000Z',
  }).run!;
  const saveB = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: devB,
    expectedBaseRevision: 1,
    nowIso: '2026-10-02T10:05:00.000Z',
  });

  assert.equal(saveB.ok, false);
  assert.equal(saveB.code, 'CONFLICT');
  assert.equal(saveB.localDraft!.steps[0].note, 'ملاحظة الجهاز ب: طلب إرسال الفاتورة');
  assert.equal(saveB.serverRun!.steps[0].note, 'ملاحظة الجهاز أ: العميل وافق مبدئيًا');

  const mergedSameStep = resolveConflictRecord<PlaybookRun>(saveB.conflict!, 'merge');
  assert.ok(mergedSameStep.steps[0].note!.includes('الجهاز أ'));
  assert.ok(mergedSameStep.steps[0].note!.includes('الجهاز ب'));
  assert.equal(mergedSameStep.revision, 3);

  const keepRemote = resolveConflictRecord<PlaybookRun>(saveB.conflict!, 'keep_remote');
  assert.equal(keepRemote.steps[0].note, 'ملاحظة الجهاز أ: العميل وافق مبدئيًا');
  assert.equal(keepRemote.revision, 2);

  const keepLocal = resolveConflictRecord<PlaybookRun>(saveB.conflict!, 'keep_local');
  assert.equal(keepLocal.steps[0].note, 'ملاحظة الجهاز ب: طلب إرسال الفاتورة');
  assert.equal(keepLocal.revision, 3);
});

// 42–45 (F.3, F.4, F.5, F.6). تعديل Offline + تقدم الخادم + مزامنة عند عودة الاتصال + حفظ المسودة + حل التضارب
test('42–45. Task 013-Fix-01 (F.3–F.6): Offline queue preserves initial baseRevision across multiple offline edits, exposes pending/local state, rejects stale flush safely upon reconnect, preserves draft, and commits approved resolution', async () => {
  const client = makeClient();
  const baseRun = startPlaybookRun({
    id: 'run_offline_cas',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-05',
  }).run!;

  const backend = createInMemoryPlaybookCasAndAtomicBackend({ runs: [baseRun] });

  // Device A online advances server revision from 1 -> 2
  const onlineEdit = pausePlaybookRun({
    run: baseRun,
    nowIso: '2026-10-05T11:00:00.000Z',
  }).run!;
  const commitA = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: onlineEdit,
    expectedBaseRevision: 1,
    nowIso: '2026-10-05T11:00:00.000Z',
  });
  assert.equal(commitA.ok, true);
  assert.equal(commitA.savedRun!.revision, 2);

  // Device B is offline with revision=1 and edits multiple steps consecutively offline
  const queueB = new PlaybookOfflineSyncQueue();
  const offEdit1 = startPlaybookStep({
    run: baseRun,
    stepId: baseRun.steps[0].id,
    nowIso: '2026-10-05T11:02:00.000Z',
  }).run!;
  queueB.enqueueDraft({ run: offEdit1, baseRevision: 1, nowIso: '2026-10-05T11:02:00.000Z' });

  const offEdit2 = completePlaybookStep({
    run: offEdit1,
    stepId: baseRun.steps[0].id,
    note: 'تم الإنجاز أوفلاين من الجوال',
    completedAtIso: '2026-10-05T11:05:00.000Z',
  }).run!;
  // Note: offEdit2.revision locally reached 3, so passing baseRevision=2 would happen if naive — queue MUST preserve original baseRevision=1!
  queueB.enqueueDraft({ run: offEdit2, baseRevision: 2, nowIso: '2026-10-05T11:05:00.000Z' });

  assert.equal(queueB.hasPending(baseRun.id), true);
  assert.equal(queueB.getEntry(baseRun.id)?.baseRevision, 1);

  // Offline sync indicator MUST report pending / offline (NEVER 'synced')
  const offlineSyncSummary = computeDetailedSyncSummary({
    statuses: buildAllLoadedSyncStatuses({
      playbookRuns: { hasPendingWrites: true, fromCache: true, pendingDocIds: queueB.getPendingRunIds() },
    }),
    hasActiveConflict: false,
    conflictCount: 0,
    isOnline: false,
  });
  assert.notEqual(offlineSyncSummary.syncState, 'synced');
  assert.ok(offlineSyncSummary.pendingOperationsCount >= 1);

  // Overlaying cached snapshot preserves offline draft visibly
  const overlaid = queueB.overlayPendingDrafts([onlineEdit]);
  assert.equal(overlaid[0].steps[0].status, 'completed');
  assert.equal(overlaid[0].steps[0].note, 'تم الإنجاز أوفلاين من الجوال');

  // Reconnect triggers flushPending -> CAS detects baseRevision=1 vs server revision=2 -> CONFLICT!
  const flushResults = await queueB.flushPending((input) =>
    backend.savePlaybookRunCas({
      userId: USER_A,
      nextRun: input.nextRun,
      expectedBaseRevision: input.expectedBaseRevision,
      nowIso: input.nowIso,
    })
  );

  assert.equal(flushResults.length, 1);
  assert.equal(flushResults[0].outcome.ok, false);
  assert.equal(flushResults[0].outcome.code, 'CONFLICT');

  const conflict = flushResults[0].outcome.conflict!;
  assert.ok(conflict);
  // Draft preserved cleanly inside conflict item for manual decision
  assert.equal((conflict.localVersion as PlaybookRun).steps[0].note, 'تم الإنجاز أوفلاين من الجوال');
  assert.equal((conflict.remoteVersion as PlaybookRun).status, 'paused');
  // Server was NOT overwritten silently
  assert.equal(backend.getRuns()[0].status, 'paused');
  assert.equal(backend.getRuns()[0].revision, 2);

  // User approves 'keep_local' -> saves cleanly with expectedBaseRevision=2 -> server commits revision=3
  const userApproved = resolveConflictRecord<PlaybookRun>(conflict, 'keep_local');
  const finalSave = await backend.savePlaybookRunCas({
    userId: USER_A,
    nextRun: userApproved,
    expectedBaseRevision: (conflict.remoteVersion as PlaybookRun).revision,
    nowIso: '2026-10-05T11:20:00.000Z',
  });
  assert.equal(finalSave.ok, true);
  assert.equal(finalSave.savedRun!.revision, 3);
  assert.equal(finalSave.savedRun!.steps[0].note, 'تم الإنجاز أوفلاين من الجوال');
});

// 46 (F.7). تزامن تعديل الخطة مع تحويل خطوة إلى مهمة ذرية (Racing CAS edit + Atomic Task Creation)
test('46. Task 013-Fix-01 (F.7): Races between plan revision edits and atomic step-to-task conversion are serialized cleanly without duplicates or lost edits', async () => {
  const client = makeClient();
  const initialRun = startPlaybookRun({
    id: 'run_race_atomic',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-06',
  }).run!;

  const backend = createInMemoryPlaybookCasAndAtomicBackend({ runs: [initialRun] });

  // Concurrent call 1 advances run revision 1 -> 2 (updating step 1)
  const runRevisionUpdate = startPlaybookStep({
    run: initialRun,
    stepId: initialRun.steps[0].id,
    nowIso: '2026-10-06T09:00:00.000Z',
  }).run!;

  const [casRes, atomicRes] = await Promise.all([
    backend.savePlaybookRunCas({
      userId: USER_A,
      nextRun: runRevisionUpdate,
      expectedBaseRevision: 1,
      nowIso: '2026-10-06T09:00:00.000Z',
    }),
    executeAtomicStepTaskConversion(
      {
        userId: USER_A,
        run: initialRun, // stale expectedRunRevision=1!
        stepId: initialRun.steps[1].id,
        isOnline: true,
        nowIso: '2026-10-06T09:00:01.000Z',
      },
      backend
    ),
  ]);

  assert.equal(casRes.ok, true);
  assert.equal(casRes.savedRun!.revision, 2);
  // Stale atomic conversion sees server revision=2 > expectedRunRevision=1 -> rejects safely without duplicate task or overwriting Step 1!
  assert.equal(atomicRes.ok, false);
  assert.equal(atomicRes.code, 'REVISION_CONFLICT');
  assert.equal(backend.getTasks().length, 0);
  assert.equal(backend.getRuns()[0].steps[0].status, 'in_progress');
});

// 47 (F.8). إعادة المحاولة بعد فقدان الاستجابة تحافظ على تعديلات المستخدم في المهمة الموجودة
test('47. Task 013-Fix-01 (F.8): Retry after lost server response recovers existing task without overwriting user edits and repairs step link if needed', async () => {
  const client = makeClient();
  const run = startPlaybookRun({
    id: 'run_retry_atomic',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-07',
  }).run!;

  const stepId = run.steps[0].id;
  const detTaskId = buildPlaybookStepTaskId(run.id, stepId);

  // Task was created on server and user already edited its title & priority, while step link needs repair or retry
  const userEditedTask: ActionItem = {
    id: detTaskId,
    userId: USER_A,
    clientId: client.id,
    playbookRunId: run.id,
    playbookStepId: stepId,
    title: 'عنوان معدّل من المستخدم - لا تستبدله',
    priority: 'urgent',
    dueDate: '2026-10-12',
    status: 'in_progress',
    createdAt: '2026-10-07T08:00:00.000Z',
  };

  const backend = createInMemoryPlaybookCasAndAtomicBackend({
    runs: [run],
    tasks: [userEditedTask],
  });

  const retryRes = await executeAtomicStepTaskConversion(
    {
      userId: USER_A,
      run,
      stepId,
      isOnline: true,
      titleOverride: 'عنوان افتراضي قديم',
      priorityOverride: 'low',
    },
    backend
  );

  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.alreadyExisted, true);
  assert.equal(retryRes.task!.id, detTaskId);
  assert.equal(retryRes.task!.title, 'عنوان معدّل من المستخدم - لا تستبدله');
  assert.equal(retryRes.task!.priority, 'urgent');
  assert.equal(backend.getTasks().length, 1);
  assert.equal(backend.getRuns()[0].steps[0].linkedTaskId, detTaskId);
});

// 48 (F.9). منع إنشاء مهمة جديدة لخطوة completed أو skipped (مع بقاء استرداد المهمة المرتبطة مسبقًا متاحًا)
test('48. Task 013-Fix-01 (F.9): Blocks creating new task for completed or skipped steps (STEP_CLOSED) while permitting safe recovery of an already-linked task', async () => {
  const client = makeClient();
  let run = startPlaybookRun({
    id: 'run_closed_step_guard',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-08',
  }).run!;

  run = completePlaybookStep({
    run,
    stepId: run.steps[0].id,
    completedAtIso: '2026-10-08T10:00:00.000Z',
  }).run!;
  run = skipPlaybookStep({
    run,
    stepId: run.steps[1].id,
    nowIso: '2026-10-08T10:05:00.000Z',
  }).run!;

  const backend = createInMemoryPlaybookCasAndAtomicBackend({ runs: [run] });

  // Client validation guard blocks completed step
  const completedRes = await executeAtomicStepTaskConversion(
    { userId: USER_A, run, stepId: run.steps[0].id, isOnline: true },
    backend
  );
  assert.equal(completedRes.ok, false);
  assert.equal(completedRes.code, 'STEP_CLOSED');

  // Client validation guard blocks skipped step
  const skippedRes = await executeAtomicStepTaskConversion(
    { userId: USER_A, run, stepId: run.steps[1].id, isOnline: true },
    backend
  );
  assert.equal(skippedRes.ok, false);
  assert.equal(skippedRes.code, 'STEP_CLOSED');
  assert.equal(backend.getTasks().length, 0);

  // Server transaction state ALSO blocks even if client sends stale unclosed run snapshot
  const txCompleted = applyAtomicStepToTaskInTransactionState({
    input: {
      userId: USER_A,
      runId: run.id,
      stepId: run.steps[0].id,
      deterministicTaskId: buildPlaybookStepTaskId(run.id, run.steps[0].id),
      title: 'مهمة ممنوعة لخطوة مكتملة',
      priority: 'medium',
      nowIso: '2026-10-08T10:10:00.000Z',
    },
    serverRun: run,
    serverTaskByDeterministicId: undefined,
    serverLinkedTask: undefined,
  });
  assert.equal(txCompleted.ok, false);
  assert.equal(txCompleted.code, 'STEP_CLOSED');

  // However, if a step ALREADY has linkedTaskId before being completed, idempotent recovery still succeeds safely
  const linkedTaskId = buildPlaybookStepTaskId(run.id, run.steps[2].id);
  const existingTask: ActionItem = {
    id: linkedTaskId,
    userId: USER_A,
    clientId: client.id,
    playbookRunId: run.id,
    playbookStepId: run.steps[2].id,
    title: 'مهمة منشأة مسبقًا قبل إكمال الخطوة',
    priority: 'medium',
    status: 'completed',
    createdAt: '2026-10-08T09:00:00.000Z',
  };
  const completedLinkedRun: PlaybookRun = {
    ...run,
    steps: run.steps.map((s, i) =>
      i === 2 ? { ...s, status: 'completed', linkedTaskId, completedAt: '2026-10-08T10:30:00.000Z' } : s
    ),
  };
  const recoverTx = applyAtomicStepToTaskInTransactionState({
    input: {
      userId: USER_A,
      runId: completedLinkedRun.id,
      stepId: completedLinkedRun.steps[2].id,
      deterministicTaskId: linkedTaskId,
      title: 'استرداد',
      priority: 'medium',
      nowIso: '2026-10-08T10:35:00.000Z',
    },
    serverRun: completedLinkedRun,
    serverTaskByDeterministicId: existingTask,
    serverLinkedTask: existingTask,
  });
  assert.equal(recoverTx.ok, true);
  assert.equal(recoverTx.alreadyExisted, true);
  assert.equal(recoverTx.task!.id, linkedTaskId);
});

// 49 (F.10). رفض ربط مهمة موجودة بنفس المعرف الحتمي إذا اختلفت clientId أو playbookRunId أو playbookStepId
test('49. Task 013-Fix-01 (F.10): Rejects linking an existing task with matching deterministic ID when clientId, playbookRunId, or playbookStepId mismatches (INCOMPATIBLE_EXISTING_TASK)', async () => {
  const client = makeClient();
  const run = startPlaybookRun({
    id: 'run_compat_check',
    userId: USER_A,
    template: BUILTIN_PLAYBOOK_TEMPLATES[0],
    client,
    startDateKey: '2026-10-09',
  }).run!;
  const stepId = run.steps[0].id;
  const detTaskId = buildPlaybookStepTaskId(run.id, stepId);

  const wrongClientTask: ActionItem = {
    id: detTaskId,
    userId: USER_A,
    clientId: 'cli_different',
    playbookRunId: run.id,
    playbookStepId: stepId,
    title: 'مهمة تخص عميلًا آخر',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-10-09T08:00:00.000Z',
  };

  const wrongRunTask: ActionItem = {
    id: detTaskId,
    userId: USER_A,
    clientId: client.id,
    playbookRunId: 'other_run_id',
    playbookStepId: stepId,
    title: 'مهمة تخص خطة أخرى',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-10-09T08:00:00.000Z',
  };

  const wrongStepTask: ActionItem = {
    id: detTaskId,
    userId: USER_A,
    clientId: client.id,
    playbookRunId: run.id,
    playbookStepId: 'other_step_id',
    title: 'مهمة تخص خطوة أخرى',
    priority: 'medium',
    status: 'pending',
    createdAt: '2026-10-09T08:00:00.000Z',
  };

  for (const incompatibleTask of [wrongClientTask, wrongRunTask, wrongStepTask]) {
    const backend = createInMemoryPlaybookCasAndAtomicBackend({
      runs: [run],
      tasks: [incompatibleTask],
    });
    const res = await executeAtomicStepTaskConversion(
      { userId: USER_A, run, stepId, isOnline: true },
      backend
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, 'INCOMPATIBLE_EXISTING_TASK');
    // Unrelated task untouched & step not linked to incompatible task
    assert.equal(backend.getTasks()[0].title, incompatibleTask.title);
    assert.equal(backend.getRuns()[0].steps[0].linkedTaskId, undefined);
  }

  // Also test CAS protection against stale creation if doc already exists on server
  const dupCreateCheck = applyPlaybookRunCasSaveInTransactionState({
    input: {
      userId: USER_A,
      nextRun: run,
      expectedBaseRevision: 0,
      nowIso: '2026-10-09T09:00:00.000Z',
    },
    serverRun: { ...run, revision: 2 },
  });
  assert.equal(dupCreateCheck.ok, false);
  assert.equal(dupCreateCheck.code, 'CONFLICT');
});


