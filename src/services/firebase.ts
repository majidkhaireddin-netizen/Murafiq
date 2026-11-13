import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  CacheInitError,
  CacheMode,
  CacheRuntimeState,
  Client,
  Meeting,
  ActionItem,
  Note,
} from '../types';
import {
  deriveCacheRuntimeState,
  formatOptOutExecutionResult,
  formatPersistenceInitErrorArabic,
  OptOutExecutionResult,
} from '../utils/offlineStoragePolicy';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

const PERSISTENCE_STORAGE_KEY = 'murafiq_persist_offline';
let memoryLocalStorage: Record<string, string> = {};

/**
 * Check whether persistent offline storage (IndexedDB) is requested by the user.
 * Default: false (memory-only cache for shared/untrusted devices).
 */
export function isPersistentStorageEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(PERSISTENCE_STORAGE_KEY) === 'true';
    }
  } catch {}
  return memoryLocalStorage[PERSISTENCE_STORAGE_KEY] === 'true';
}

/**
 * Update the persistent offline storage preference flag (takes effect on Firestore initialization / reload).
 */
export function setPersistentStorageEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PERSISTENCE_STORAGE_KEY, enabled ? 'true' : 'false');
      return;
    }
  } catch {}
  memoryLocalStorage[PERSISTENCE_STORAGE_KEY] = enabled ? 'true' : 'false';
}

let activeCacheMode: CacheMode = 'memory';
let cacheInitError: CacheInitError | null = null;

/**
 * Initializes Firestore with either persistentLocalCache or memoryLocalCache BEFORE use.
 * Never claims persistence is active if initialization fails and falls back to memory.
 */
export function initFirestoreInstanceWithPolicy(params: {
  preferPersistent: boolean;
  initPersistent: () => Firestore;
  initMemory: () => Firestore;
  getExisting: () => Firestore;
}): {
  db: Firestore;
  activeMode: CacheMode;
  initError: CacheInitError | null;
} {
  const { preferPersistent, initPersistent, initMemory, getExisting } = params;

  if (preferPersistent) {
    try {
      const instance = initPersistent();
      return { db: instance, activeMode: 'persistent', initError: null };
    } catch (err) {
      const formattedError = formatPersistenceInitErrorArabic(err);
      let fallbackDb: Firestore;
      try {
        fallbackDb = initMemory();
      } catch {
        fallbackDb = getExisting();
      }
      return {
        db: fallbackDb,
        activeMode: 'memory',
        initError: formattedError,
      };
    }
  }

  try {
    const instance = initMemory();
    return { db: instance, activeMode: 'memory', initError: null };
  } catch (err) {
    return {
      db: getExisting(),
      activeMode: 'memory',
      initError: formatPersistenceInitErrorArabic(err),
    };
  }
}

const initResult = initFirestoreInstanceWithPolicy({
  preferPersistent: isPersistentStorageEnabled(),
  initPersistent: () =>
    initializeFirestore(
      app,
      { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      firebaseConfig.firestoreDatabaseId
    ),
  initMemory: () =>
    initializeFirestore(
      app,
      { localCache: memoryLocalCache() },
      firebaseConfig.firestoreDatabaseId
    ),
  getExisting: () => getFirestore(app, firebaseConfig.firestoreDatabaseId),
});

activeCacheMode = initResult.activeMode;
cacheInitError = initResult.initError;

export const db: Firestore = initResult.db;

// Initialize Auth (Firebase Auth uses browser session persistence independently of Firestore document cache)
export const auth = getAuth(app);

// Strictly opt-in local emulator wiring for automated browser testing only
const isEmulatorEnv =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.VITE_USE_FIREBASE_EMULATOR === 'true';

if (isEmulatorEnv && typeof window !== 'undefined') {
  const fsHost = ((import.meta as any).env?.VITE_FIRESTORE_EMULATOR_HOST as string) || '127.0.0.1:8088';
  const [host, portStr] = fsHost.split(':');
  const authUrl = ((import.meta as any).env?.VITE_AUTH_EMULATOR_URL as string) || 'http://127.0.0.1:9099';
  try {
    connectFirestoreEmulator(db, host || '127.0.0.1', parseInt(portStr || '8088', 10));
  } catch {}
  try {
    connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  } catch {}
}

/**
 * Exposes actual active Firestore cache runtime state vs requested preference.
 */
export function getCacheRuntimeState(): CacheRuntimeState {
  const requestedMode: CacheMode = isPersistentStorageEnabled() ? 'persistent' : 'memory';
  return deriveCacheRuntimeState({
    activeMode: activeCacheMode,
    requestedMode,
    initError: cacheInitError,
  });
}

/**
 * Requests enabling persistent IndexedDB caching (requires application reload to initialize).
 */
export function requestPersistentStorageEnable(): CacheRuntimeState {
  setPersistentStorageEnabled(true);
  return getCacheRuntimeState();
}

/**
 * Safely opts out of persistent IndexedDB storage:
 * 1. Clears the opt-in preference flag so future boots default to memoryLocalCache().
 * 2. Terminates the active Firestore instance and calls clearIndexedDbPersistence(db).
 * 3. Reports honestly if another open tab (failed-precondition) prevented full IndexedDB cleanup.
 */
export async function optOutPersistentStorageAndClearCache(): Promise<OptOutExecutionResult> {
  setPersistentStorageEnabled(false);

  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return formatOptOutExecutionResult({ clearedIndexedDb: true });
  } catch (err) {
    return formatOptOutExecutionResult({ clearedIndexedDb: false, error: err });
  }
}

export async function goOfflineFirestore(): Promise<void> {
  await disableNetwork(db);
}

export async function goOnlineFirestore(): Promise<void> {
  await enableNetwork(db);
}

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

export function formatFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
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

export function logFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo = formatFirestoreError(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = logFirestoreError(error, operationType, path);
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Ensures caller is authenticated and returns the current user's UID.
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
    if (result.user) {
      const userRef = doc(db, 'users', result.user.uid);
      // Do not block sign-in completion on network ack if offline/slow
      void setDoc(
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
        console.warn('Could not write user profile doc:', err);
      });
    }
    return result.user;
  } catch (error: any) {
    let friendlyMessage = 'فشل تسجيل الدخول بواسطة Google. يُرجى المحاولة مرة أخرى.';
    if (error?.code === 'auth/popup-closed-by-user') {
      friendlyMessage = 'تم إغلاق نافذة تسجيل الدخول من قِبل المستخدم قبل إتمام العملية.';
    } else if (error?.code === 'auth/popup-blocked') {
      friendlyMessage =
        'حظر المتصفح النافذة المنبثقة. يُرجى السماح بالنوافذ المنبثقة لموقع التطبيق والمحاولة مجدداً.';
    } else if (error?.code === 'auth/unauthorized-domain') {
      friendlyMessage =
        'نطاق التطبيق غير مصرح به في إعدادات Firebase Authentication. يُرجى إضافة نطاق التطبيق إلى Authorized Domains في Firebase Console.';
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
  pendingDocIds: string[];
}

export interface QueuedWriteHandle {
  localAccepted: true;
  path: string;
  serverPromise: Promise<void>;
}

// User-Scoped Subscriptions with Per-Document Pending Write Metadata
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
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as Client);
        if (d.metadata.hasPendingWrites) {
          pendingDocIds.push(d.id);
        }
      });
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        pendingDocIds,
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
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as Meeting);
        if (d.metadata.hasPendingWrites) {
          pendingDocIds.push(d.id);
        }
      });
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        pendingDocIds,
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
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as ActionItem);
        if (d.metadata.hasPendingWrites) {
          pendingDocIds.push(d.id);
        }
      });
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        pendingDocIds,
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
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as Note);
        if (d.metadata.hasPendingWrites) {
          pendingDocIds.push(d.id);
        }
      });
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        pendingDocIds,
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

// User-Scoped Non-Blocking Local-First Mutations (separates local acceptance from server ack)
export function saveClient(client: Client): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${client.id}`;
  const rawPayload: Client = {
    ...client,
    userId: uid,
    createdAt: client.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = setDoc(doc(db, 'users', uid, 'clients', client.id), payload).catch((error) =>
    handleFirestoreError(error, OperationType.WRITE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteClient(clientId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${clientId}`;
  const serverPromise = deleteDoc(doc(db, 'users', uid, 'clients', clientId)).catch((error) =>
    handleFirestoreError(error, OperationType.DELETE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function saveMeeting(meeting: Meeting): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meeting.id}`;
  const rawPayload: Meeting = {
    ...meeting,
    userId: uid,
    createdAt: meeting.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = setDoc(doc(db, 'users', uid, 'meetings', meeting.id), payload).catch((error) =>
    handleFirestoreError(error, OperationType.WRITE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteMeeting(meetingId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meetingId}`;
  const serverPromise = deleteDoc(doc(db, 'users', uid, 'meetings', meetingId)).catch((error) =>
    handleFirestoreError(error, OperationType.DELETE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function saveTask(task: ActionItem): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/tasks/${task.id}`;
  const rawPayload: ActionItem = {
    ...task,
    userId: uid,
    createdAt: task.createdAt || new Date().toISOString(),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = setDoc(doc(db, 'users', uid, 'tasks', task.id), payload).catch((error) =>
    handleFirestoreError(error, OperationType.WRITE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteTask(taskId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/tasks/${taskId}`;
  const serverPromise = deleteDoc(doc(db, 'users', uid, 'tasks', taskId)).catch((error) =>
    handleFirestoreError(error, OperationType.DELETE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function saveNote(note: Note): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${note.id}`;
  const rawPayload: Note = {
    ...note,
    userId: uid,
    createdAt: note.createdAt || new Date().toISOString(),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = setDoc(doc(db, 'users', uid, 'notes', note.id), payload).catch((error) =>
    handleFirestoreError(error, OperationType.WRITE, path)
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteNote(noteId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${noteId}`;
  const serverPromise = deleteDoc(doc(db, 'users', uid, 'notes', noteId)).catch((error) =>
    handleFirestoreError(error, OperationType.DELETE, path)
  );
  return { localAccepted: true, path, serverPromise };
}
