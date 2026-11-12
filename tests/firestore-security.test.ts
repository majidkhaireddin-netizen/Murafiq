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

const PROJECT_ID = 'demo-murafiq-security-test';
const USER_A_UID = 'user_alice_123';
const USER_B_UID = 'user_bob_456';

let testEnv: RulesTestEnvironment;

// Only execute when emulator host is available
const isEmulatorConfigured = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HUB
);

test('Firestore Security Rules Test Suite (@firebase/rules-unit-testing)', async (t) => {
  if (!isEmulatorConfigured) {
    t.skip(
      'Firestore Emulator is not running in this environment (Java not installed). Recorded blocker for offline CI/local execution.'
    );
    return;
  }

  before(async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10),
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
      setDoc(clientRef, {
        id: 'client_1',
        userId: USER_A_UID,
        name: 'شركة الأفق للاستشارات',
        company: 'الأفق',
        phone: '+966500000000',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
      })
    );
    await assertSucceeds(getDoc(clientRef));
    await assertSucceeds(updateDoc(clientRef, { name: 'شركة الأفق المحدثة' }));
    await assertSucceeds(deleteDoc(clientRef));

    // Meetings
    const meetingRef = doc(aliceDb, `users/${USER_A_UID}/meetings/meet_1`);
    await assertSucceeds(
      setDoc(meetingRef, {
        id: 'meet_1',
        userId: USER_A_UID,
        clientId: 'client_1',
        title: 'جلسة مراجعة العقد السنوي',
        dateTime: '2026-11-15T10:00:00.000Z',
        type: 'in_person',
        status: 'confirmed',
        notes: 'مناقشة بنود الدفع والجدول الزمني.',
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
    await assertSucceeds(getDoc(meetingRef));
    await assertSucceeds(deleteDoc(meetingRef));

    // Tasks
    const taskRef = doc(aliceDb, `users/${USER_A_UID}/tasks/task_1`);
    await assertSucceeds(
      setDoc(taskRef, {
        id: 'task_1',
        userId: USER_A_UID,
        clientId: 'client_1',
        title: 'إرسال العرض المالي المعدل',
        priority: 'high',
        status: 'pending',
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
    await assertSucceeds(getDoc(taskRef));
    await assertSucceeds(deleteDoc(taskRef));

    // Notes
    const noteRef = doc(aliceDb, `users/${USER_A_UID}/notes/note_1`);
    await assertSucceeds(
      setDoc(noteRef, {
        id: 'note_1',
        userId: USER_A_UID,
        title: 'ملاحظة سرية عن المفاوضات',
        content: 'العميل يفضل التوقيع قبل نهاية الربع الحالي.',
        isPinned: true,
        createdAt: '2026-11-12T00:00:00.000Z',
      })
    );
    await assertSucceeds(getDoc(noteRef));
    await assertSucceeds(deleteDoc(noteRef));
  });

  // 3. User B cannot read, list, create, update, or delete User A's records
  await t.test("3. User B cannot read, list, create, update, or delete User A's records", async () => {
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

  // 4. Invalid document IDs and malformed records are rejected
  await t.test('4. Invalid document IDs and malformed records are rejected', async () => {
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

  // 5. Documents with forged userId values are rejected
  await t.test('5. Documents with forged userId values are rejected', async () => {
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

  // 6. Legacy root collections remain completely inaccessible
  await t.test('6. Legacy root collections remain inaccessible', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    await assertFails(getDoc(doc(aliceDb, 'clients/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'meetings/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'tasks/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'notes/legacy_1')));
    await assertFails(getDoc(doc(aliceDb, 'test/connection')));
  });

  // 7. Empty collections handled without sample-data insertion
  await t.test('7. Empty collections return empty lists without sample-data insertion', async () => {
    const aliceDb = testEnv.authenticatedContext(USER_A_UID).firestore();

    const clientsSnap = await assertSucceeds(getDocs(collection(aliceDb, `users/${USER_A_UID}/clients`)));
    assert.equal(clientsSnap.empty, true);
    assert.equal(clientsSnap.size, 0);
  });
});
