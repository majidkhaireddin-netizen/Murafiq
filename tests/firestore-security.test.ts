import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { sanitizeFirestorePayload } from '../src/services/firebase';

import appletConfig from '../firebase-applet-config.json';

const PROJECT_ID = 'demo-murafiq-security-test';
const NAMED_DB_ID = appletConfig.firestoreDatabaseId;
const USER_A_UID = 'user_alice_123';
const USER_B_UID = 'user_bob_456';

let testEnv: RulesTestEnvironment;
let emulatorHost: string;
let emulatorPort: number;

function getDbInstance(context: any, databaseId: string = NAMED_DB_ID) {
  const app = (context as any).getApp();
  const db = getFirestore(app, databaseId);
  connectFirestoreEmulator(db, emulatorHost, emulatorPort, { mockUserToken: (context as any).authToken });
  return db;
}

test('Firestore Security Rules Integration Suite (@firebase/rules-unit-testing)', async (t) => {
  assert.equal(PROJECT_ID, 'demo-murafiq-security-test', 'Tests must be isolated to demo project');

  before(async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    const envHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
    const [h, p] = envHost.split(':');
    emulatorHost = h || '127.0.0.1';
    emulatorPort = parseInt(p || '8088', 10);

    // Initialize test environment with rules
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
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  const dbTargets = ['(default)'];

  for (const dbId of dbTargets) {
    await t.test(`Database Target [${dbId}]: Security & Data Isolation Assertions`, async (st) => {
      // 1. Unauthenticated access denied
      await st.test(`1. Unauthenticated users cannot read or write protected records on ${dbId}`, async () => {
        const unauthCtx = testEnv.unauthenticatedContext();
        const unauthDb = getDbInstance(unauthCtx, dbId);

        const clientRef = doc(unauthDb, `users/${USER_A_UID}/clients/c1`);
        await assertFails(getDoc(clientRef));
        await assertFails(
          setDoc(clientRef, {
            id: 'c1',
            userId: USER_A_UID,
            name: 'Unauth Client',
            createdAt: new Date().toISOString(),
          })
        );

        const legacyClientRef = doc(unauthDb, 'clients/c1');
        await assertFails(getDoc(legacyClientRef));
      });

      // 2. Authenticated User A CRUD
      await st.test(`2. User A can CRUD their own valid records on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        // Clients
        const clientRef = doc(aliceDb, `users/${USER_A_UID}/clients/client_1`);
        await assertSucceeds(
          setDoc(
            clientRef,
            sanitizeFirestorePayload({
              id: 'client_1',
              userId: USER_A_UID,
              name: 'شركة الأفق للاستشارات',
              company: 'الأفق',
              phone: '+966500000000',
              createdAt: '2026-11-12T00:00:00.000Z',
              updatedAt: '2026-11-12T00:00:00.000Z',
            })
          )
        );
        await assertSucceeds(getDoc(clientRef));
        await assertSucceeds(updateDoc(clientRef, { name: 'شركة الأفق المحدثة' }));
        await assertSucceeds(deleteDoc(clientRef));

        // Meetings
        const meetingRef = doc(aliceDb, `users/${USER_A_UID}/meetings/meet_1`);
        await assertSucceeds(
          setDoc(
            meetingRef,
            sanitizeFirestorePayload({
              id: 'meet_1',
              userId: USER_A_UID,
              clientId: 'client_1',
              title: 'جلسة مراجعة العقد السنوي',
              dateTime: '2026-11-15T10:00:00.000Z',
              type: 'in_person',
              status: 'confirmed',
              notes: 'مناقشة بنود الدفع والجدول الزمني.',
              duration: 0,
              isFollowUpScheduled: false,
              createdAt: '2026-11-12T00:00:00.000Z',
            })
          )
        );
        await assertSucceeds(getDoc(meetingRef));
        await assertSucceeds(deleteDoc(meetingRef));

        // Notes
        const noteRef = doc(aliceDb, `users/${USER_A_UID}/notes/note_1`);
        await assertSucceeds(
          setDoc(
            noteRef,
            sanitizeFirestorePayload({
              id: 'note_1',
              userId: USER_A_UID,
              title: 'ملاحظة سرية عن المفاوضات',
              content: 'العميل يفضل التوقيع قبل نهاية الربع الحالي.',
              isPinned: false,
              createdAt: '2026-11-12T00:00:00.000Z',
            })
          )
        );
        await assertSucceeds(getDoc(noteRef));
        await assertSucceeds(deleteDoc(noteRef));
      });

      // 3. Optional Fields Serialization (Task with and without meetingId & dueDate)
      await st.test(`3. Serialization of optional fields (Task creation) on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        // Task WITHOUT meetingId and WITHOUT dueDate
        const rawWithoutOpts = {
          id: 'task_no_opts',
          clientId: 'client_1',
          meetingId: undefined,
          title: 'مهمة بدون اجتماع ولا تاريخ استحقاق',
          description: undefined,
          dueDate: undefined,
          priority: 'high',
          status: 'pending',
          createdAt: '2026-11-12T00:00:00.000Z',
        };

        const taskRef1 = doc(aliceDb, `users/${USER_A_UID}/tasks/task_no_opts`);
        const cleanPayload1 = sanitizeFirestorePayload({ ...rawWithoutOpts, userId: USER_A_UID });

        assert.equal('meetingId' in cleanPayload1, false);
        assert.equal('dueDate' in cleanPayload1, false);

        await assertSucceeds(setDoc(taskRef1, cleanPayload1));
        const snap1 = await getDoc(taskRef1);
        assert.equal(snap1.exists(), true);

        // Task WITH meetingId and WITH dueDate
        const rawWithOpts = {
          id: 'task_with_opts',
          clientId: 'client_1',
          meetingId: 'meet_1',
          title: 'مهمة مرتبطة باجتماع وتاريخ محدد',
          description: 'تفاصيل التسليم النهائي للمشروع',
          dueDate: '2026-11-20',
          priority: 'urgent',
          status: 'pending',
          createdAt: '2026-11-12T00:00:00.000Z',
        };

        const taskRef2 = doc(aliceDb, `users/${USER_A_UID}/tasks/task_with_opts`);
        const cleanPayload2 = sanitizeFirestorePayload({ ...rawWithOpts, userId: USER_A_UID });

        assert.equal(cleanPayload2.meetingId, 'meet_1');
        assert.equal(cleanPayload2.dueDate, '2026-11-20');

        await assertSucceeds(setDoc(taskRef2, cleanPayload2));
        const snap2 = await getDoc(taskRef2);
        assert.equal(snap2.exists(), true);
      });

      // 4. User Isolation (User B cannot access User A's records)
      await st.test(`4. User B cannot access User A's records on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);
        const aliceClientRef = doc(aliceDb, `users/${USER_A_UID}/clients/secret_c1`);
        await setDoc(aliceClientRef, {
          id: 'secret_c1',
          userId: USER_A_UID,
          name: 'عميل أليس السري',
          createdAt: '2026-11-12T00:00:00.000Z',
        });

        const bobCtx = testEnv.authenticatedContext(USER_B_UID);
        const bobDb = getDbInstance(bobCtx, dbId);
        const targetRef = doc(bobDb, `users/${USER_A_UID}/clients/secret_c1`);

        await assertFails(getDoc(targetRef));
        await assertFails(getDocs(collection(bobDb, `users/${USER_A_UID}/clients`)));
        await assertFails(updateDoc(targetRef, { name: 'اختراق بوب' }));
        await assertFails(deleteDoc(targetRef));
      });

      // 5. Invalid records & IDs rejected
      await st.test(`5. Invalid IDs and malformed records rejected on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        const mismatchedRef = doc(aliceDb, `users/${USER_A_UID}/clients/doc_id_1`);
        await assertFails(
          setDoc(mismatchedRef, {
            id: 'different_id_2',
            userId: USER_A_UID,
            name: 'عميل غير مطابق',
            createdAt: '2026-11-12T00:00:00.000Z',
          })
        );

        const missingNameRef = doc(aliceDb, `users/${USER_A_UID}/clients/c_missing`);
        await assertFails(
          setDoc(missingNameRef, {
            id: 'c_missing',
            userId: USER_A_UID,
            createdAt: '2026-11-12T00:00:00.000Z',
          })
        );
      });

      // 6. Forged userId rejected
      await st.test(`6. Forged userId values rejected on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        const forgedClientRef = doc(aliceDb, `users/${USER_A_UID}/clients/c_forged`);
        await assertFails(
          setDoc(forgedClientRef, {
            id: 'c_forged',
            userId: 'some_other_user_uid',
            name: 'عميل بهوية مزورة',
            createdAt: '2026-11-12T00:00:00.000Z',
          })
        );
      });

      // 7. Legacy collections denied
      await st.test(`7. Legacy root collections denied on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        await assertFails(getDoc(doc(aliceDb, 'clients/legacy_1')));
        await assertFails(getDoc(doc(aliceDb, 'meetings/legacy_1')));
        await assertFails(getDoc(doc(aliceDb, 'tasks/legacy_1')));
        await assertFails(getDoc(doc(aliceDb, 'notes/legacy_1')));
      });

      // 8. Empty collections return empty
      await st.test(`8. Empty collections return empty lists on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);

        const clientsSnap = await assertSucceeds(getDocs(collection(aliceDb, `users/${USER_A_UID}/clients`)));
        assert.equal(clientsSnap.empty, true);
      });

      // 8b. Meeting Attachments Subcollection Security Rules
      await st.test(`8b. Meeting attachments subcollection isolation & validation on ${dbId}`, async () => {
        const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
        const aliceDb = getDbInstance(aliceCtx, dbId);
        const bobCtx = testEnv.authenticatedContext(USER_B_UID);
        const bobDb = getDbInstance(bobCtx, dbId);

        // Master Gate: attachment creation fails if parent meeting does not exist
        const orphanAttRef = doc(aliceDb, `users/${USER_A_UID}/meetings/missing_meet/attachments/att_1`);
        await assertFails(
          setDoc(orphanAttRef, {
            id: 'att_1',
            userId: USER_A_UID,
            meetingId: 'missing_meet',
            fileName: 'notes.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 2048,
            storageKey: `users/${USER_A_UID}/meetings/missing_meet/attachments/att_1`,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            createdAt: '2026-11-13T10:00:00.000Z',
          })
        );

        // Create parent meeting first
        await assertSucceeds(
          setDoc(doc(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1`), {
            id: 'meet_att_1',
            userId: USER_A_UID,
            clientId: 'client_1',
            title: 'لقاء مرفقات Backblaze',
            dateTime: '2026-11-15T10:00:00.000Z',
            type: 'in_person',
            status: 'confirmed',
            notes: 'توثيق المرفقات',
            createdAt: '2026-11-13T10:00:00.000Z',
          })
        );

        // Valid attachment metadata succeeds
        const validAttRef = doc(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_valid_1`);
        await assertSucceeds(
          setDoc(validAttRef, {
            id: 'att_valid_1',
            userId: USER_A_UID,
            meetingId: 'meet_att_1',
            fileName: 'contract.pdf',
            contentType: 'application/pdf',
            sizeBytes: 4096,
            storageKey: `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_valid_1`,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            createdAt: '2026-11-13T10:05:00.000Z',
          })
        );
        await assertSucceeds(getDoc(validAttRef));
        await assertSucceeds(getDocs(collection(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments`)));

        // Immutable update denied
        await assertFails(updateDoc(validAttRef, { fileName: 'tampered.pdf' }));

        // Cross-user Bob denied
        await assertFails(getDoc(doc(bobDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_valid_1`)));
        await assertFails(
          deleteDoc(doc(bobDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_valid_1`))
        );

        // Disallowed MIME / size > 10MB / forged storageKey denied
        await assertFails(
          setDoc(doc(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_bad_mime`), {
            id: 'att_bad_mime',
            userId: USER_A_UID,
            meetingId: 'meet_att_1',
            fileName: 'evil.html',
            contentType: 'text/html',
            sizeBytes: 1024,
            storageKey: `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_bad_mime`,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            createdAt: '2026-11-13T10:05:00.000Z',
          })
        );

        await assertFails(
          setDoc(doc(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_too_big`), {
            id: 'att_too_big',
            userId: USER_A_UID,
            meetingId: 'meet_att_1',
            fileName: 'big.pdf',
            contentType: 'application/pdf',
            sizeBytes: 10485761,
            storageKey: `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_too_big`,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            createdAt: '2026-11-13T10:05:00.000Z',
          })
        );

        await assertFails(
          setDoc(doc(aliceDb, `users/${USER_A_UID}/meetings/meet_att_1/attachments/att_bad_key`), {
            id: 'att_bad_key',
            userId: USER_A_UID,
            meetingId: 'meet_att_1',
            fileName: 'ok.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 1024,
            storageKey: `users/${USER_B_UID}/meetings/meet_att_1/attachments/att_bad_key`,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            createdAt: '2026-11-13T10:05:00.000Z',
          })
        );

        // Owner delete succeeds
        await assertSucceeds(deleteDoc(validAttRef));
      });
    });
  }

  // 9. Explicit Physical Database Isolation Assertion between default and named databases
  await t.test('Explicit physical database-isolation between default and named databases', async () => {
    const aliceCtx = testEnv.authenticatedContext(USER_A_UID);
    const defaultDb = getFirestore((aliceCtx as any).getApp(), '(default)');
    connectFirestoreEmulator(defaultDb, emulatorHost, emulatorPort, { mockUserToken: (aliceCtx as any).authToken });

    const namedDb = getFirestore((aliceCtx as any).getApp(), NAMED_DB_ID);
    connectFirestoreEmulator(namedDb, emulatorHost, emulatorPort, { mockUserToken: (aliceCtx as any).authToken });

    const docPath = `users/${USER_A_UID}/clients/isolation_distinct_test`;

    await setDoc(doc(defaultDb, docPath), {
      id: 'isolation_distinct_test',
      userId: USER_A_UID,
      name: 'Data in Default DB',
      createdAt: '2026-11-12T00:00:00.000Z',
    });

    await setDoc(doc(namedDb, docPath), {
      id: 'isolation_distinct_test',
      userId: USER_A_UID,
      name: 'Data in Named DB',
      createdAt: '2026-11-12T00:00:00.000Z',
    });

    const defaultSnap = await getDoc(doc(defaultDb, docPath));
    const namedSnap = await getDoc(doc(namedDb, docPath));

    assert.equal(defaultSnap.data()?.name, 'Data in Default DB');
    assert.equal(namedSnap.data()?.name, 'Data in Named DB');
    assert.notEqual(defaultSnap.data()?.name, namedSnap.data()?.name);
  });

  // 10. Named Database Configuration Assertion
  await t.test('Named database ID is correctly configured in firebase-applet-config.json', () => {
    assert.equal(appletConfig.firestoreDatabaseId, 'ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475');
  });
});
