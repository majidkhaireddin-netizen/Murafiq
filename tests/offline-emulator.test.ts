import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  initializeTestEnvironment,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  getFirestore,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  doc,
  collection,
  setDoc,
  getDocFromServer,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';
import {
  sanitizeFirestorePayload,
  savePlaybookRunAtomic,
  createTaskFromPlaybookStepAtomic,
} from '../src/services/firebase';
import {
  BUILTIN_PLAYBOOK_TEMPLATES,
  PlaybookOfflineSyncQueue,
  buildPlaybookStepTaskId,
  completePlaybookStep,
  startPlaybookRun,
} from '../src/utils/playbookEngine';
import { resolveConflictRecord } from '../src/utils/conflictLogic';
import { OperationCoordinator } from '../src/utils/sessionState';
import { Client, ActionItem, PlaybookRun } from '../src/types';
import appletConfig from '../firebase-applet-config.json';

const PROJECT_ID = 'demo-murafiq-offline-test';
const NAMED_DB_ID = appletConfig.firestoreDatabaseId;
const USER_A_UID = 'user_alice_offline_1';
const USER_B_UID = 'user_bob_offline_2';

let testEnv: RulesTestEnvironment;
let emulatorHost: string;
let emulatorPort: number;

function createConnectedDb(context: any): Firestore {
  const app = (context as any).getApp();
  const db = getFirestore(app, NAMED_DB_ID);
  connectFirestoreEmulator(db, emulatorHost, emulatorPort, {
    mockUserToken: (context as any).authToken,
  });
  return db;
}

function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number = 8000,
  label: string = 'condition'
): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
      }
    }, 30);
  });
}

test('Murafiq Real Firestore Emulator Offline-to-Online Integration Suite', async (t) => {
  before(async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    const envHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
    const [h, p] = envHost.split(':');
    emulatorHost = h || '127.0.0.1';
    emulatorPort = parseInt(p || '8088', 10);

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: emulatorHost,
        port: emulatorPort,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    const res = await fetch(
      `http://${emulatorHost}:${emulatorPort}/emulator/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(
        NAMED_DB_ID
      )}/documents`,
      { method: 'DELETE' }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to clear named database ${NAMED_DB_ID}: ${await res.text()}`);
    }
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  await t.test(
    '1. Online -> Offline -> Online: creates & edits client and adds task offline without blocking, reflects pending metadata, and syncs on reconnect',
    async () => {
      const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
      const db = createConnectedDb(aliceCtx);

      const clientCol = collection(db, `users/${USER_A_UID}/clients`);
      const taskCol = collection(db, `users/${USER_A_UID}/tasks`);

      let latestClients: Client[] = [];
      let clientsMeta = { hasPendingWrites: false, fromCache: true, pendingIds: [] as string[] };
      let latestTasks: ActionItem[] = [];
      let tasksMeta = { hasPendingWrites: false, fromCache: true, pendingIds: [] as string[] };

      const unsubClients = onSnapshot(clientCol, { includeMetadataChanges: true }, (snap) => {
        latestClients = snap.docs.map((d) => d.data() as Client);
        clientsMeta = {
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          pendingIds: snap.docs.filter((d) => d.metadata.hasPendingWrites).map((d) => d.id),
        };
      });

      const unsubTasks = onSnapshot(taskCol, { includeMetadataChanges: true }, (snap) => {
        latestTasks = snap.docs.map((d) => d.data() as ActionItem);
        tasksMeta = {
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          pendingIds: snap.docs.filter((d) => d.metadata.hasPendingWrites).map((d) => d.id),
        };
      });

      try {
        // Wait for initial online empty server snapshot
        await waitForCondition(() => !clientsMeta.fromCache && !tasksMeta.fromCache, 5000, 'initial server snapshot');

        // Transition ONLINE -> OFFLINE
        await disableNetwork(db);

        // Create client offline (do NOT await server ack while offline!)
        const clientId = 'client_off_1';
        const clientCreatePromise = setDoc(
          doc(db, `users/${USER_A_UID}/clients/${clientId}`),
          sanitizeFirestorePayload({
            id: clientId,
            userId: USER_A_UID,
            name: 'شركة المدار (مبدئي)',
            company: 'المدار',
            createdAt: '2026-11-13T10:00:00.000Z',
            updatedAt: '2026-11-13T10:00:00.000Z',
          })
        );

        await waitForCondition(
          () => latestClients.length === 1 && clientsMeta.hasPendingWrites === true,
          5000,
          'offline client creation in local cache'
        );
        assert.deepEqual(clientsMeta.pendingIds, [clientId]);

        // Edit the same client while still offline
        const clientEditPromise = setDoc(
          doc(db, `users/${USER_A_UID}/clients/${clientId}`),
          sanitizeFirestorePayload({
            id: clientId,
            userId: USER_A_UID,
            name: 'شركة المدار (معدل أوفلاين)',
            company: 'المدار المتقدمة',
            createdAt: '2026-11-13T10:00:00.000Z',
            updatedAt: '2026-11-13T10:01:00.000Z',
          })
        );

        await waitForCondition(
          () => latestClients[0]?.name === 'شركة المدار (معدل أوفلاين)',
          5000,
          'offline client edit in local cache'
        );

        // Add a task offline
        const taskId = 'task_off_1';
        const taskCreatePromise = setDoc(
          doc(db, `users/${USER_A_UID}/tasks/${taskId}`),
          sanitizeFirestorePayload({
            id: taskId,
            userId: USER_A_UID,
            clientId,
            title: 'متابعة عرض السعر بعد العودة',
            priority: 'high',
            status: 'pending',
            createdAt: '2026-11-13T10:02:00.000Z',
          })
        );

        await waitForCondition(
          () => latestTasks.length === 1 && tasksMeta.hasPendingWrites === true,
          5000,
          'offline task creation in local cache'
        );
        assert.deepEqual(tasksMeta.pendingIds, [taskId]);

        // Transition OFFLINE -> ONLINE (Reconnect)
        await enableNetwork(db);

        // Server ack promises must now resolve
        await Promise.all([clientCreatePromise, clientEditPromise, taskCreatePromise]);

        // Snapshots must transition cleanly from pending/cache to server-confirmed
        await waitForCondition(
          () =>
            !clientsMeta.hasPendingWrites &&
            !clientsMeta.fromCache &&
            !tasksMeta.hasPendingWrites &&
            !tasksMeta.fromCache,
          8000,
          'cloud acknowledgment after reconnect'
        );

        // Verify persisted on server via getDocFromServer
        const serverClientSnap = await getDocFromServer(doc(db, `users/${USER_A_UID}/clients/${clientId}`));
        assert.equal(serverClientSnap.exists(), true);
        assert.equal(serverClientSnap.data()?.name, 'شركة المدار (معدل أوفلاين)');

        const serverTaskSnap = await getDocFromServer(doc(db, `users/${USER_A_UID}/tasks/${taskId}`));
        assert.equal(serverTaskSnap.exists(), true);
        assert.equal(serverTaskSnap.data()?.title, 'متابعة عرض السعر بعد العودة');
      } finally {
        unsubClients();
        unsubTasks();
      }
    }
  );

  await t.test(
    '2. Rejected write after reconnect + overlapping valid write: valid write persists while rule-rejected write reconciles cleanly',
    async () => {
      const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
      const db = createConnectedDb(aliceCtx);

      let localClients: Client[] = [];
      const setLocalClients = (updater: (prev: Client[]) => Client[]) => {
        localClients = updater(localClients);
      };
      const coord = new OperationCoordinator<Client>();

      const clientCol = collection(db, `users/${USER_A_UID}/clients`);
      let metaState = { hasPendingWrites: false, fromCache: true };
      const unsub = onSnapshot(clientCol, { includeMetadataChanges: true }, (snap) => {
        metaState = {
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        };
      });

      try {
        await waitForCondition(() => !metaState.fromCache, 5000, 'initial empty server snapshot');

        // Go offline
        await disableNetwork(db);

        // Operation A: forged userId (violates firestore.rules!), queued offline
        const badClient: Client = {
          id: 'bad_client_1',
          userId: 'forged_other_user',
          name: 'عميل مرفوض أمنياً',
          createdAt: '2026-11-13T10:00:00.000Z',
          updatedAt: '2026-11-13T10:00:00.000Z',
        };

        let rejectedCategory = '';
        const handleBad = coord.runScopedMutation({
          entityId: badClient.id,
          entityType: 'client',
          previousEntity: undefined,
          setState: setLocalClients,
          applyOptimistic: (prev) => [badClient, ...prev],
          dispatchWrite: () => ({
            serverPromise: setDoc(doc(db, `users/${USER_A_UID}/clients/${badClient.id}`), badClient),
          }),
          onServerRejected: ({ classification }) => {
            rejectedCategory = classification.category;
          },
        });

        // Operation B (overlapping): valid client queued offline
        const goodClient: Client = {
          id: 'good_client_2',
          userId: USER_A_UID,
          name: 'عميل سليم متزامن',
          createdAt: '2026-11-13T10:00:00.000Z',
          updatedAt: '2026-11-13T10:00:00.000Z',
        };

        let goodConfirmed = false;
        const handleGood = coord.runScopedMutation({
          entityId: goodClient.id,
          entityType: 'client',
          previousEntity: undefined,
          setState: setLocalClients,
          applyOptimistic: (prev) => [goodClient, ...prev],
          dispatchWrite: () => ({
            serverPromise: setDoc(doc(db, `users/${USER_A_UID}/clients/${goodClient.id}`), goodClient),
          }),
          onServerConfirmed: () => {
            goodConfirmed = true;
          },
        });

        // Both appear immediately offline without hanging UI
        assert.equal(localClients.length, 2);

        // Reconnect!
        await enableNetwork(db);

        await Promise.all([handleBad.serverPromise, handleGood.serverPromise]);

        // Bad op rejected with permission-denied & reconciled out; Good op confirmed & stays intact!
        assert.equal(rejectedCategory, 'permission-denied');
        assert.equal(goodConfirmed, true);
        assert.deepEqual(
          localClients.map((c) => c.id),
          ['good_client_2'],
          'Valid client must remain intact when overlapping invalid op fails on reconnect'
        );

        const serverGood = await getDocFromServer(doc(db, `users/${USER_A_UID}/clients/${goodClient.id}`));
        assert.equal(serverGood.exists(), true);
        const serverBad = await getDocFromServer(doc(db, `users/${USER_A_UID}/clients/${badClient.id}`));
        assert.equal(serverBad.exists(), false);
      } finally {
        unsub();
      }
    }
  );

  await t.test('3. Cross-user isolation remains enforced after offline write + reconnect', async () => {
    const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
    const aliceDb = createConnectedDb(aliceCtx);

    await disableNetwork(aliceDb);
    const writePromise = setDoc(doc(aliceDb, `users/${USER_A_UID}/clients/alice_iso_1`), {
      id: 'alice_iso_1',
      userId: USER_A_UID,
      name: 'بيانات أليس الخاصة',
      createdAt: '2026-11-13T10:00:00.000Z',
      updatedAt: '2026-11-13T10:00:00.000Z',
    });
    await enableNetwork(aliceDb);
    await writePromise;

    const bobCtx = testEnv.authenticatedContext(USER_B_UID);
    const bobDb = createConnectedDb(bobCtx);
    await assertFails(getDocFromServer(doc(bobDb, `users/${USER_A_UID}/clients/alice_iso_1`)));
  });

  await t.test(
    '4. Two-device concurrent PlaybookRun edits via real Firestore Emulator CAS transaction prevent Lost Update and merge cleanly',
    async () => {
      const aliceCtxA = testEnv.authenticatedContext(USER_A_UID);
      const aliceCtxB = testEnv.authenticatedContext(USER_A_UID);
      const dbDeviceA = createConnectedDb(aliceCtxA);
      const dbDeviceB = createConnectedDb(aliceCtxB);

      const client: Client = {
        id: 'cli_emu_1',
        userId: USER_A_UID,
        name: 'شركة الرواد',
        createdAt: '2026-11-15T08:00:00.000Z',
        updatedAt: '2026-11-15T08:00:00.000Z',
      };
      const baseRun = startPlaybookRun({
        id: 'run_emu_cas_1',
        userId: USER_A_UID,
        template: BUILTIN_PLAYBOOK_TEMPLATES[0],
        client,
        startDateKey: '2026-11-15',
        nowIso: '2026-11-15T08:00:00.000Z',
      }).run!;

      const createRes = await savePlaybookRunAtomic(baseRun, {
        expectedBaseRevision: 0,
        dbOverride: dbDeviceA,
        userIdOverride: USER_A_UID,
      });
      assert.equal(createRes.ok, true);
      assert.equal(createRes.savedRun!.revision, 1);

      // Device A completes step 1 -> commits revision=2
      const devAMut = completePlaybookStep({
        run: baseRun,
        stepId: baseRun.steps[0].id,
        completedAtIso: '2026-11-15T09:00:00.000Z',
      }).run!;
      const saveARes = await savePlaybookRunAtomic(devAMut, {
        expectedBaseRevision: 1,
        dbOverride: dbDeviceA,
        userIdOverride: USER_A_UID,
      });
      assert.equal(saveARes.ok, true);
      assert.equal(saveARes.savedRun!.revision, 2);

      // Device B completes step 2 from stale revision=1 -> CAS rejects cleanly!
      const devBMut = completePlaybookStep({
        run: baseRun,
        stepId: baseRun.steps[1].id,
        completedAtIso: '2026-11-15T09:05:00.000Z',
      }).run!;
      const saveBRes = await savePlaybookRunAtomic(devBMut, {
        expectedBaseRevision: 1,
        dbOverride: dbDeviceB,
        userIdOverride: USER_A_UID,
      });
      assert.equal(saveBRes.ok, false);
      assert.equal(saveBRes.code, 'CONFLICT');
      assert.ok(saveBRes.conflict);

      // Verify server still has revision=2 with step 1 completed
      const serverSnapAfterB = await getDocFromServer(
        doc(dbDeviceA, `users/${USER_A_UID}/playbookRuns/${baseRun.id}`)
      );
      const serverDataAfterB = serverSnapAfterB.data() as PlaybookRun;
      assert.equal(serverDataAfterB.revision, 2);
      assert.equal(serverDataAfterB.steps[0].status, 'completed');
      assert.equal(serverDataAfterB.steps[1].status, 'pending');

      // Smart merge resolves conflict and commits revision=3
      const merged = resolveConflictRecord<PlaybookRun>(saveBRes.conflict!, 'merge');
      const saveMerged = await savePlaybookRunAtomic(merged, {
        expectedBaseRevision: saveBRes.serverRun!.revision,
        dbOverride: dbDeviceB,
        userIdOverride: USER_A_UID,
      });
      assert.equal(saveMerged.ok, true);
      assert.equal(saveMerged.savedRun!.revision, 3);

      const finalServerSnap = await getDocFromServer(
        doc(dbDeviceA, `users/${USER_A_UID}/playbookRuns/${baseRun.id}`)
      );
      const finalData = finalServerSnap.data() as PlaybookRun;
      assert.equal(finalData.revision, 3);
      assert.equal(finalData.steps[0].status, 'completed');
      assert.equal(finalData.steps[1].status, 'completed');
    }
  );

  await t.test(
    '5. Offline PlaybookRun edits queued against baseRevision=1 detect server conflict upon reconnect without silent overwrite',
    async () => {
      const dbA = createConnectedDb(testEnv.authenticatedContext(USER_A_UID));
      const dbB = createConnectedDb(testEnv.authenticatedContext(USER_A_UID));

      const client: Client = {
        id: 'cli_emu_2',
        userId: USER_A_UID,
        name: 'مؤسسة الأفق',
        createdAt: '2026-11-15T08:00:00.000Z',
        updatedAt: '2026-11-15T08:00:00.000Z',
      };
      const baseRun = startPlaybookRun({
        id: 'run_emu_off_1',
        userId: USER_A_UID,
        template: BUILTIN_PLAYBOOK_TEMPLATES[0],
        client,
        startDateKey: '2026-11-15',
      }).run!;

      await savePlaybookRunAtomic(baseRun, {
        expectedBaseRevision: 0,
        dbOverride: dbA,
        userIdOverride: USER_A_UID,
      });

      // Device B goes offline and queues draft
      await disableNetwork(dbB);
      const queueB = new PlaybookOfflineSyncQueue();
      const draftB = completePlaybookStep({
        run: baseRun,
        stepId: baseRun.steps[0].id,
        note: 'ملاحظة أوفلاين من الجهاز ب',
      }).run!;
      queueB.enqueueDraft({ run: draftB, baseRevision: 1 });

      // Device A advances server to revision=2 online
      const editA = completePlaybookStep({
        run: baseRun,
        stepId: baseRun.steps[1].id,
        note: 'إنجاز أونلاين من الجهاز أ',
      }).run!;
      const resA = await savePlaybookRunAtomic(editA, {
        expectedBaseRevision: 1,
        dbOverride: dbA,
        userIdOverride: USER_A_UID,
      });
      assert.equal(resA.ok, true);
      assert.equal(resA.savedRun!.revision, 2);

      // Device B reconnects and flushes via CAS
      await enableNetwork(dbB);
      const flushRes = await queueB.flushPending((inData) =>
        savePlaybookRunAtomic(inData.nextRun, {
          expectedBaseRevision: inData.expectedBaseRevision,
          dbOverride: dbB,
          userIdOverride: USER_A_UID,
        })
      );

      assert.equal(flushRes.length, 1);
      assert.equal(flushRes[0].outcome.ok, false);
      assert.equal(flushRes[0].outcome.code, 'CONFLICT');
      assert.equal(
        (flushRes[0].outcome.localDraft as PlaybookRun).steps[0].note,
        'ملاحظة أوفلاين من الجهاز ب'
      );

      const serverAfterFlush = (
        await getDocFromServer(doc(dbA, `users/${USER_A_UID}/playbookRuns/${baseRun.id}`))
      ).data() as PlaybookRun;
      assert.equal(serverAfterFlush.revision, 2);
      assert.equal(serverAfterFlush.steps[1].note, 'إنجاز أونلاين من الجهاز أ');
    }
  );

  await t.test(
    '6. Emulator createTaskFromPlaybookStepAtomic enforces STEP_CLOSED, INCOMPATIBLE_EXISTING_TASK, and idempotent retry preservation',
    async () => {
      const db = createConnectedDb(testEnv.authenticatedContext(USER_A_UID));
      const client: Client = {
        id: 'cli_emu_3',
        userId: USER_A_UID,
        name: 'عميل الذرية',
        createdAt: '2026-11-15T08:00:00.000Z',
        updatedAt: '2026-11-15T08:00:00.000Z',
      };
      let run = startPlaybookRun({
        id: 'run_emu_atomic_1',
        userId: USER_A_UID,
        template: BUILTIN_PLAYBOOK_TEMPLATES[0],
        client,
        startDateKey: '2026-11-15',
      }).run!;
      run = completePlaybookStep({
        run,
        stepId: run.steps[1].id,
        completedAtIso: '2026-11-15T09:00:00.000Z',
      }).run!;
      // Normalize revision=1 for clean initial create
      run = { ...run, revision: 1 };

      await savePlaybookRunAtomic(run, {
        expectedBaseRevision: 0,
        dbOverride: db,
        userIdOverride: USER_A_UID,
      });

      // Closed step must be rejected with STEP_CLOSED
      const closedRes = await createTaskFromPlaybookStepAtomic(
        {
          userId: USER_A_UID,
          runId: run.id,
          stepId: run.steps[1].id,
          deterministicTaskId: buildPlaybookStepTaskId(run.id, run.steps[1].id),
          expectedRunRevision: 1,
          title: 'ممنوع لخطوة مكتملة',
          priority: 'medium',
          nowIso: '2026-11-15T09:05:00.000Z',
        },
        { dbOverride: db, userIdOverride: USER_A_UID }
      );
      assert.equal(closedRes.ok, false);
      assert.equal(closedRes.code, 'STEP_CLOSED');

      // Seed incompatible task on step 2 deterministic ID -> must fail INCOMPATIBLE_EXISTING_TASK
      const incompatTaskId = buildPlaybookStepTaskId(run.id, run.steps[2].id);
      await setDoc(doc(db, `users/${USER_A_UID}/tasks/${incompatTaskId}`), {
        id: incompatTaskId,
        userId: USER_A_UID,
        clientId: 'different_client_id',
        playbookRunId: run.id,
        playbookStepId: run.steps[2].id,
        title: 'مهمة لعميل مختلف',
        priority: 'medium',
        status: 'pending',
        createdAt: '2026-11-15T09:00:00.000Z',
      });

      const incompatRes = await createTaskFromPlaybookStepAtomic(
        {
          userId: USER_A_UID,
          runId: run.id,
          stepId: run.steps[2].id,
          deterministicTaskId: incompatTaskId,
          expectedRunRevision: 1,
          title: 'محاولة ربط خاطئة',
          priority: 'medium',
          nowIso: '2026-11-15T09:10:00.000Z',
        },
        { dbOverride: db, userIdOverride: USER_A_UID }
      );
      assert.equal(incompatRes.ok, false);
      assert.equal(incompatRes.code, 'INCOMPATIBLE_EXISTING_TASK');

      // Valid atomic creation on step 0 followed by idempotent retry preserves edits
      const detId0 = buildPlaybookStepTaskId(run.id, run.steps[0].id);
      const createTaskRes = await createTaskFromPlaybookStepAtomic(
        {
          userId: USER_A_UID,
          runId: run.id,
          stepId: run.steps[0].id,
          deterministicTaskId: detId0,
          expectedRunRevision: 1,
          title: 'مهمة خطوة 1',
          priority: 'high',
          nowIso: '2026-11-15T09:15:00.000Z',
        },
        { dbOverride: db, userIdOverride: USER_A_UID }
      );
      assert.equal(createTaskRes.ok, true);
      assert.equal(createTaskRes.alreadyExisted, false);
      assert.equal(createTaskRes.run!.revision, 2);

      // Simulate user editing task on server, then retry createTaskFromPlaybookStepAtomic
      await setDoc(
        doc(db, `users/${USER_A_UID}/tasks/${detId0}`),
        { ...createTaskRes.task!, title: 'عنوان معدّل يدويًا' },
        { merge: true }
      );
      const retryRes = await createTaskFromPlaybookStepAtomic(
        {
          userId: USER_A_UID,
          runId: run.id,
          stepId: run.steps[0].id,
          deterministicTaskId: detId0,
          expectedRunRevision: 2,
          title: 'عنوان قديم',
          priority: 'low',
          nowIso: '2026-11-15T09:20:00.000Z',
        },
        { dbOverride: db, userIdOverride: USER_A_UID }
      );
      assert.equal(retryRes.ok, true);
      assert.equal(retryRes.alreadyExisted, true);
      assert.equal(retryRes.task!.title, 'عنوان معدّل يدويًا');
    }
  );
});

