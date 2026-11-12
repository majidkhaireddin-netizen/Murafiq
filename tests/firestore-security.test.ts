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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { sanitizeFirestorePayload } from '../src/services/firebase';

const PROJECT_ID = 'demo-murafiq-security-test';
const NAMED_DB_ID = 'ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475';
const USER_A_UID = 'user_alice_123';
const USER_B_UID = 'user_bob_456';

let testEnv: RulesTestEnvironment;

test('Firestore Security Rules Integration Suite (@firebase/rules-unit-testing)', async (t) => {
  before(async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
    const [host, portStr] = emulatorHost.split(':');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: host || '127.0.0.1',
        port: parseInt(portStr || '8085', 10),
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

  // 1. Unauthenticated users cannot read or write protected records
  await t.test('1. Unauthenticated users cannot read or write protected records', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();

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

  // 2. User A can CRUD their own valid records across all 4 collections
  await t.test('2. User A can create, read, update, and delete their own valid records', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

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
          duration: 0, // Falsy duration preserved
          isFollowUpScheduled: false, // Falsy boolean preserved
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
          isPinned: false, // Falsy boolean preserved
          createdAt: '2026-11-12T00:00:00.000Z',
        })
      )
    );
    await assertSucceeds(getDoc(noteRef));
    await assertSucceeds(deleteDoc(noteRef));
  });

  // 3. Serialization & Optional Fields Validation (Requirement C)
  await t.test('3. Serialization of optional fields (Task creation with and without meetingId and dueDate)', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    // Task 1: Created WITHOUT optional meetingId and WITHOUT dueDate (values undefined in raw object)
    const rawTaskWithoutOptionals = {
      id: 'task_no_opts',
      clientId: 'client_1',
      meetingId: undefined,
      title: 'مهمة مستقلة بدون اجتماع ولا تاريخ استحقاق',
      description: undefined,
      dueDate: undefined,
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-12T00:00:00.000Z',
    };

    const taskRef1 = doc(aliceDb, `users/${USER_A_UID}/tasks/task_no_opts`);
    const cleanPayload1 = sanitizeFirestorePayload({ ...rawTaskWithoutOptionals, userId: USER_A_UID });

    // Verify undefined keys were completely stripped from payload
    assert.equal('meetingId' in cleanPayload1, false);
    assert.equal('dueDate' in cleanPayload1, false);
    assert.equal('description' in cleanPayload1, false);

    // Verify Firestore setDoc succeeds without undefined error and passes Security Rules
    await assertSucceeds(setDoc(taskRef1, cleanPayload1));
    const snap1 = await getDoc(taskRef1);
    assert.equal(snap1.exists(), true);

    // Task 2: Created WITH optional meetingId and WITH dueDate
    const rawTaskWithOptionals = {
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
    const cleanPayload2 = sanitizeFirestorePayload({ ...rawTaskWithOptionals, userId: USER_A_UID });

    assert.equal(cleanPayload2.meetingId, 'meet_1');
    assert.equal(cleanPayload2.dueDate, '2026-11-20');

    await assertSucceeds(setDoc(taskRef2, cleanPayload2));
    const snap2 = await getDoc(taskRef2);
    assert.equal(snap2.exists(), true);
  });

  // 4. User B cannot read, list, create, update, or delete User A's records
  await t.test("4. User B cannot read, list, create, update, or delete User A's records", async () => {
    // Seed record as User A
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();
    const aliceClientRef = doc(aliceDb, `users/${USER_A_UID}/clients/secret_c1`);
    await setDoc(aliceClientRef, {
      id: 'secret_c1',
      userId: USER_A_UID,
      name: 'عميل أليس السري',
      createdAt: '2026-11-12T00:00:00.000Z',
    });

    // Attempt access as User B
    const bobDb = testEnv.authenticatedContext(USER_B_UID).firestore();
    const targetRef = doc(bobDb, `users/${USER_A_UID}/clients/secret_c1`);

    await assertFails(getDoc(targetRef));
    await assertFails(getDocs(collection(bobDb, `users/${USER_A_UID}/clients`)));
    await assertFails(updateDoc(targetRef, { name: 'اختراق بوب' }));
    await assertFails(deleteDoc(targetRef));

    // Bob cannot insert into Alice's tree
    const forgedRef = doc(bobDb, `users/${USER_A_UID}/clients/bob_injected`);
    await assertFails(
      setDoc(forgedRef, {
        id: 'bob_injected',
        userId: USER_A_UID,
        name: 'عميل مزور',
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
  });

  // 5. Invalid document IDs and malformed records are rejected
  await t.test('5. Invalid document IDs and malformed records are rejected', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    // Mismatched ID (doc id != data.id)
    const mismatchedRef = doc(aliceDb, `users/${USER_A_UID}/clients/doc_id_1`);
    await assertFails(
      setDoc(mismatchedRef, {
        id: 'different_id_2',
        userId: USER_A_UID,
        name: 'عميل غير مطابق',
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );

    // Missing required field (name)
    const missingNameRef = doc(aliceDb, `users/${USER_A_UID}/clients/c_missing`);
    await assertFails(
      setDoc(missingNameRef, {
        id: 'c_missing',
        userId: USER_A_UID,
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );

    // Unrecognized field injection
    const extraFieldRef = doc(aliceDb, `users/${USER_A_UID}/clients/c_extra`);
    await assertFails(
      setDoc(extraFieldRef, {
        id: 'c_extra',
        userId: USER_A_UID,
        name: 'عميل بحقول غير مصرحة',
        isAdmin: true, // Not permitted by schema
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
  });

  // 6. Documents with forged userId values are rejected
  await t.test('6. Documents with forged userId values are rejected', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    const forgedClientRef = doc(aliceDb, `users/${USER_A_UID}/clients/c_forged`);
    await assertFails(
      setDoc(forgedClientRef, {
        id: 'c_forged',
        userId: 'some_other_user_uid', // Forged userId
        name: 'عميل بهوية مزورة',
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
  });

  // 7. Legacy root collections remain completely inaccessible
  await t.test('7. Legacy root collections remain inaccessible', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    await assertFails(getDoc(doc(aliceDb, 'clients/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'meetings/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'tasks/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'notes/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'test/connection')));
  });

  // 8. Empty collections handled without sample-data insertion
  await t.test('8. Empty collections return empty lists without sample-data insertion', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    const clientsSnap = await assertSucceeds(getDocs(collection(aliceDb, `users/${USER_A_UID}/clients`)));
    assert.equal(clientsSnap.empty, true);
    assert.equal(clientsSnap.size, 0);
  });
});
