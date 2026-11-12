import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  getDocFromServer,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  DocumentData,
  SnapshotMetadata,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Client, Meeting, ActionItem, Note } from '../types';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

let memoryLocalStorage: Record<string, string> = {};

/**
 * Check whether persistent offline storage (IndexedDB) is enabled by the user.
 * Default: false (memory-only cache for shared/untrusted devices).
 */
export function isPersistentStorageEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('murafiq_persist_offline') === 'true';
    }
  } catch {}
  return memoryLocalStorage['murafiq_persist_offline'] === 'true';
}

/**
 * Enable or disable persistent offline storage.
 */
export function setPersistentStorageEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('murafiq_persist_offline', enabled ? 'true' : 'false');
      return;
    }
  } catch {}
  memoryLocalStorage['murafiq_persist_offline'] = enabled ? 'true' : 'false';
}

// Initialize Firestore with memory or persistent cache
let dbInstance: any;
try {
  const localCache = isPersistentStorageEnabled()
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache();
  dbInstance = initializeFirestore(app, { localCache }, firebaseConfig.firestoreDatabaseId);
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;

// Initialize Auth
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function formatFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function logFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errInfo = formatFirestoreError(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = logFirestoreError(error, operationType, path);
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Ensures caller is authenticated and returns the current user's UID.
 * Caller cannot supply an arbitrary UID to bypass authentication identity.
 */
export function getAuthenticatedUid(): string {
  const user = auth.currentUser;
  if (!user || !user.uid) {
    throw new Error('Authentication required: No authenticated user session found.');
  }
  return user.uid;
}

/**
 * Returns user-scoped collection path.
 * Enforces /users/{uid}/{subcollection} structure.
 */
export function getUserCollectionPath(subcollection: 'clients' | 'meetings' | 'tasks' | 'notes'): string {
  const uid = getAuthenticatedUid();
  return `users/${uid}/${subcollection}`;
}

/**
 * Sign in with Google using browser popup
 */
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await signInWithPopup(auth, provider);
    // Optionally ensure user profile document exists
    if (result.user) {
      const userRef = doc(db, 'users', result.user.uid);
      await setDoc(
        userRef,
        {
          uid: result.user.uid,
          email: result.user.email || '',
          displayName: result.user.displayName || '',
          photoURL: result.user.photoURL || '',
          lastLoginAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch((err) => {
        // Non-fatal if user document creation fails offline
        console.warn('Could not write user profile doc:', err);
      });
    }
    return result.user;
  } catch (error: any) {
    let friendlyMessage = 'فشل تسجيل الدخول بواسطة Google. يُرجى المحاولة مرة أخرى.';
    if (error?.code === 'auth/popup-closed-by-user') {
      friendlyMessage = 'تم إغلاق نافذة تسجيل الدخول من قِبل المستخدم قبل إتمام العملية.';
    } else if (error?.code === 'auth/popup-blocked') {
      friendlyMessage = 'حظر المتصفح النافذة المنبثقة. يُرجى السماح بالنوافذ المنبثقة لموقع التطبيق والمحاولة مجدداً.';
    } else if (error?.code === 'auth/unauthorized-domain') {
      friendlyMessage = 'نطاق التطبيق غير مصرح به في إعدادات Firebase Authentication. يُرجى إضافة نطاق التطبيق إلى Authorized Domains في Firebase Console.';
    } else if (error?.code === 'auth/network-request-failed') {
      friendlyMessage = 'تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بشبكة الإنترنت.';
    } else if (error?.message) {
      friendlyMessage = `خطأ في المصادقة: ${error.message}`;
    }
    const enrichedError = new Error(friendlyMessage);
    (enrichedError as any).code = error?.code;
    throw enrichedError;
  }
}

/**
 * Sign out current authenticated user
 */
export async function logOut(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribe to authentication state changes
 */
export function subscribeAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Check connection status (non-blocking)
 */
export async function testConnection(): Promise<boolean> {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export interface SyncMetadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

// User-Scoped Subscriptions
export function subscribeClients(
  onData: (clients: Client[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const colRef = collection(db, 'users', uid, 'clients');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Client[] = [];
      snapshot.forEach((d) => items.push(d.data() as Client));
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, `users/${uid}/clients`);
      if (onError) onError(error as Error);
    }
  );
}

export function subscribeMeetings(
  onData: (meetings: Meeting[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const colRef = collection(db, 'users', uid, 'meetings');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Meeting[] = [];
      snapshot.forEach((d) => items.push(d.data() as Meeting));
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, `users/${uid}/meetings`);
      if (onError) onError(error as Error);
    }
  );
}

export function subscribeTasks(
  onData: (tasks: ActionItem[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const colRef = collection(db, 'users', uid, 'tasks');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: ActionItem[] = [];
      snapshot.forEach((d) => items.push(d.data() as ActionItem));
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, `users/${uid}/tasks`);
      if (onError) onError(error as Error);
    }
  );
}

export function subscribeNotes(
  onData: (notes: Note[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const colRef = collection(db, 'users', uid, 'notes');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Note[] = [];
      snapshot.forEach((d) => items.push(d.data() as Note));
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, `users/${uid}/notes`);
      if (onError) onError(error as Error);
    }
  );
}

/**
 * Recursively removes keys with `undefined` values from payloads before sending to Firestore,
 * while preserving valid falsy values (false, 0, "") and required properties.
 */
export function sanitizeFirestorePayload<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      if (Array.isArray(val)) {
        result[key] = val.map((item) =>
          typeof item === 'object' && item !== null && !(item instanceof Date)
            ? sanitizeFirestorePayload(item)
            : item
        );
      } else if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
        result[key] = sanitizeFirestorePayload(val);
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

// User-Scoped Protected Mutations
export async function saveClient(client: Client): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${client.id}`;
  try {
    const rawPayload: Client = {
      ...client,
      userId: uid,
      createdAt: client.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const payload = sanitizeFirestorePayload(rawPayload);
    await setDoc(doc(db, 'users', uid, 'clients', client.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteClient(clientId: string): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${clientId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'clients', clientId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveMeeting(meeting: Meeting): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meeting.id}`;
  try {
    const rawPayload: Meeting = {
      ...meeting,
      userId: uid,
      createdAt: meeting.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const payload = sanitizeFirestorePayload(rawPayload);
    await setDoc(doc(db, 'users', uid, 'meetings', meeting.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meetingId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'meetings', meetingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveTask(task: ActionItem): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/tasks/${task.id}`;
  try {
    const rawPayload: ActionItem = {
      ...task,
      userId: uid,
      createdAt: task.createdAt || new Date().toISOString(),
    };
    const payload = sanitizeFirestorePayload(rawPayload);
    await setDoc(doc(db, 'users', uid, 'tasks', task.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveNote(note: Note): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${note.id}`;
  try {
    const rawPayload: Note = {
      ...note,
      userId: uid,
      createdAt: note.createdAt || new Date().toISOString(),
    };
    const payload = sanitizeFirestorePayload(rawPayload);
    await setDoc(doc(db, 'users', uid, 'notes', note.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteNote(noteId: string): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
