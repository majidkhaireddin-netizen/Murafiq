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
  getDocs,
  limit,
  query,
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
  MeetingAttachment,
  ReminderStateRecord,
  FollowUpPreferences,
  Opportunity,
  OpportunityStageEvent,
} from '../types';
import {
  DEFAULT_FOLLOW_UP_PREFERENCES,
  FOLLOW_UP_PREFERENCES_DOC_ID,
  normalizeFollowUpPreferences,
} from '../utils/followUpEngine';
import {
  deriveCacheRuntimeState,
  formatOptOutExecutionResult,
  formatPersistenceInitErrorArabic,
  OptOutExecutionResult,
} from '../utils/offlineStoragePolicy';
import {
  clearAttachmentDownloadCache,
  syncAttachmentCacheUser,
} from '../utils/attachmentDownloadCache';
import {
  MEETING_HAS_ATTACHMENTS_MESSAGE_AR,
  MEETING_HAS_PENDING_ATTACHMENTS_MESSAGE_AR,
} from '../utils/attachmentPolicy';
import { sanitizeMeetingForSave } from '../utils/meetingMinutes';
import { sanitizeClientForSave } from '../utils/client360';
import { sanitizeOpportunityForSave } from '../utils/opportunities';

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
 * Tracks in-flight Firestore write/delete promises dispatched in the current session
 * so opt-out guards never clear IndexedDB while unconfirmed local mutations are active.
 */
let inFlightLocalWritesCount = 0;

export function getInFlightLocalWritesCount(): number {
  return inFlightLocalWritesCount;
}

function trackInFlightWrite(promise: Promise<void>): Promise<void> {
  inFlightLocalWritesCount += 1;
  return promise.finally(() => {
    inFlightLocalWritesCount = Math.max(0, inFlightLocalWritesCount - 1);
  });
}

// Multi-tab presence detection via BroadcastChannel (never blocks if unsupported)
const TAB_PRESENCE_CHANNEL = 'murafiq_tab_presence';
const TAB_INSTANCE_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    const presenceChannel = new BroadcastChannel(TAB_PRESENCE_CHANNEL);
    presenceChannel.addEventListener('message', (event) => {
      if (event.data?.type === 'PING' && event.data?.senderId !== TAB_INSTANCE_ID) {
        presenceChannel.postMessage({ type: 'PONG', senderId: TAB_INSTANCE_ID });
      }
    });
  } catch {
    // Ignore restricted environment BroadcastChannel errors
  }
}

export async function detectOtherOpenTabs(timeoutMs: number = 100): Promise<boolean> {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    const finish = (detected: boolean) => {
      if (settled) return;
      settled = true;
      try {
        channel?.close();
      } catch {
        // Ignore close error
      }
      resolve(detected);
    };

    try {
      channel = new BroadcastChannel(TAB_PRESENCE_CHANNEL);
      channel.addEventListener('message', (event) => {
        if (event.data?.type === 'PONG' && event.data?.senderId !== TAB_INSTANCE_ID) {
          finish(true);
        }
      });
      channel.postMessage({ type: 'PING', senderId: TAB_INSTANCE_ID });
      setTimeout(() => finish(false), timeoutMs);
    } catch {
      finish(false);
    }
  });
}

/**
 * Pure, dependency-injected opt-out executor that strictly enforces zero pending edits
 * and multi-tab checks BEFORE modifying preference flags, terminating, or clearing IndexedDB.
 */
export async function executeSafeOptOutWithDeps(deps: {
  pendingOperationsCount?: number;
  hasPendingWrites?: boolean;
  inFlightWritesCount: number;
  detectOtherTabs: () => Promise<boolean>;
  disablePreference: () => void;
  terminateDb: () => Promise<void>;
  clearIndexedDb: () => Promise<void>;
}): Promise<OptOutExecutionResult> {
  const effectivePendingCount = Math.max(deps.pendingOperationsCount ?? 0, deps.inFlightWritesCount);

  if (deps.hasPendingWrites || effectivePendingCount > 0) {
    return {
      preferenceDisabled: false,
      clearedIndexedDb: false,
      requiresReload: false,
      blockedByPendingWrites: true,
      messageArabic: `تم إيقاف عملية التعطيل ومسح IndexedDB لأن هناك ${effectivePendingCount || 1} تعديلات محلية لم تُؤكد سحابياً بعد. أتمم المزامنة أولاً لتجنب فقدان البيانات.`,
    };
  }

  const otherTabsDetected = await deps.detectOtherTabs();
  if (otherTabsDetected) {
    return {
      preferenceDisabled: false,
      clearedIndexedDb: false,
      requiresReload: false,
      blockedByOtherTabs: true,
      errorCode: 'failed-precondition',
      messageArabic:
        'تم رصد تبويب آخر مفتوح لتطبيق مُرافق في هذا المتصفح. أغلق جميع التبويبات الأخرى أولاً حتى يتمكن التطبيق من مسح قاعدة IndexedDB بأمان دون تعارض.',
    };
  }

  deps.disablePreference();

  try {
    await deps.terminateDb();
    await deps.clearIndexedDb();
    return formatOptOutExecutionResult({ clearedIndexedDb: true });
  } catch (err) {
    return formatOptOutExecutionResult({ clearedIndexedDb: false, error: err });
  }
}

/**
 * Safely opts out of persistent IndexedDB storage:
 * 1. Enforces pending-write guard inside the execution function itself (never clears with pending edits).
 * 2. Checks for other open tabs before terminating Firestore or clearing IndexedDB.
 * 3. Only when safe: clears the opt-in preference flag, calls terminate(db), and clears IndexedDB.
 * 4. Reports honestly if failed-precondition prevented IndexedDB cleanup.
 */
export async function optOutPersistentStorageAndClearCache(options?: {
  pendingOperationsCount?: number;
  hasPendingWrites?: boolean;
}): Promise<OptOutExecutionResult> {
  return executeSafeOptOutWithDeps({
    pendingOperationsCount: options?.pendingOperationsCount,
    hasPendingWrites: options?.hasPendingWrites,
    inFlightWritesCount: inFlightLocalWritesCount,
    detectOtherTabs: () => detectOtherOpenTabs(100),
    disablePreference: () => setPersistentStorageEnabled(false),
    terminateDb: () => terminate(db),
    clearIndexedDb: () => clearIndexedDbPersistence(db),
  });
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
  code?: string;
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
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof (error as any).code === 'string'
      ? (error as any).code
      : undefined;

  return {
    error: error instanceof Error ? error.message : String(error),
    code,
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
  const wrapped = new Error(JSON.stringify(errInfo));
  if (errInfo.code) {
    (wrapped as any).code = errInfo.code;
  }
  throw wrapped;
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
 * Returns a Firebase ID Token for authenticating backend API requests.
 */
export async function getCurrentUserIdToken(forceRefresh: boolean = false): Promise<string> {
  const user = auth.currentUser;
  if (!user || !user.uid) {
    throw new Error('يجب تسجيل الدخول بحساب Google أولاً لتنفيذ هذه العملية.');
  }
  return user.getIdToken(forceRefresh);
}

/**
 * Returns user-scoped collection path.
 */
export function getUserCollectionPath(
  subcollection:
    | 'clients'
    | 'meetings'
    | 'tasks'
    | 'notes'
    | 'reminders'
    | 'preferences'
    | 'opportunities'
    | 'opportunityStageEvents'
): string {
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
 * Sign out current authenticated user and wipe cached presigned attachment links.
 */
export async function logOut(): Promise<void> {
  clearAttachmentDownloadCache();
  await signOut(auth);
}

/**
 * Subscribe to authentication state changes while clearing presigned attachment links
 * whenever the signed-in UID changes or session ends.
 */
export function subscribeAuthState(callback: (user: User | null) => void) {
  let previousUid: string | null | undefined = undefined;
  return onAuthStateChanged(auth, (user) => {
    const nextUid = user?.uid ?? null;
    if (previousUid !== undefined && previousUid !== nextUid) {
      clearAttachmentDownloadCache();
    }
    syncAttachmentCacheUser(nextUid);
    previousUid = nextUid;
    callback(user);
  });
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
  const rawPayload: Client = sanitizeClientForSave({
    ...client,
    userId: uid,
    createdAt: client.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'clients', client.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteClient(clientId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${clientId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'clients', clientId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function saveMeeting(meeting: Meeting): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meeting.id}`;
  const rawPayload: Meeting = sanitizeMeetingForSave({
    ...meeting,
    userId: uid,
    createdAt: meeting.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'meetings', meeting.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export interface DeleteMeetingClientDeps {
  getUid: () => string;
  isOnline: () => boolean;
  getIdToken: () => Promise<string | null>;
  hasAnyAttachmentsInFirestore: (uid: string, meetingId: string) => Promise<boolean>;
  callServerDelete: (meetingId: string, idToken: string) => Promise<{ status: number; body: any }>;
  deleteMeetingDocDirect: (uid: string, meetingId: string) => Promise<void>;
  trackWrite?: (promise: Promise<void>) => Promise<void>;
}

function createCodedMeetingError(code: string, messageArabic: string): Error {
  const err = new Error(messageArabic);
  (err as any).code = code;
  return err;
}

export function deleteMeetingWithDeps(
  meetingId: string,
  options: { knownAttachmentsCount?: number } | undefined,
  deps: DeleteMeetingClientDeps
): QueuedWriteHandle {
  const uid = deps.getUid();
  const path = `users/${uid}/meetings/${meetingId}`;
  const track = deps.trackWrite ?? ((p: Promise<void>) => p);

  const runDelete = async (): Promise<void> => {
    if ((options?.knownAttachmentsCount ?? 0) > 0) {
      throw createCodedMeetingError('MEETING_HAS_ATTACHMENTS', MEETING_HAS_ATTACHMENTS_MESSAGE_AR);
    }

    // Preserve Offline-First deletion ONLY for meetings without known attachments.
    // Upon reconnect, firestore.rules (!hasMeetingAttachmentLock) enforces the guard on the server.
    if (!deps.isOnline()) {
      await deps.deleteMeetingDocDirect(uid, meetingId);
      return;
    }

    const hasAttachments = await deps.hasAnyAttachmentsInFirestore(uid, meetingId);
    if (hasAttachments) {
      throw createCodedMeetingError('MEETING_HAS_ATTACHMENTS', MEETING_HAS_ATTACHMENTS_MESSAGE_AR);
    }

    const idToken = await deps.getIdToken();
    if (idToken) {
      const res = await deps.callServerDelete(meetingId, idToken);
      if (res.status >= 200 && res.status < 300) {
        return;
      }

      const errCode = String(res.body?.error || '');
      if (res.status === 409) {
        const msg =
          errCode === 'MEETING_HAS_PENDING_ATTACHMENTS'
            ? res.body?.messageArabic || MEETING_HAS_PENDING_ATTACHMENTS_MESSAGE_AR
            : res.body?.messageArabic || MEETING_HAS_ATTACHMENTS_MESSAGE_AR;
        throw createCodedMeetingError(errCode || 'MEETING_HAS_ATTACHMENTS', msg);
      }

      if (res.status === 401 || res.status === 403) {
        throw createCodedMeetingError(
          errCode || 'permission-denied',
          res.body?.messageArabic || 'غير مصرح بحذف هذا اللقاء.'
        );
      }

      const isAdminFallbackEligible =
        (res.status === 503 && errCode === 'FIREBASE_ADMIN_NOT_CONFIGURED') ||
        (res.status === 404 && errCode === 'API_ROUTE_NOT_FOUND');

      if (!isAdminFallbackEligible) {
        throw createCodedMeetingError(
          errCode || `HTTP_${res.status}`,
          res.body?.messageArabic || 'تعذر التحقق من مرفقات اللقاء على الخادم لحذفه.'
        );
      }
    }

    await deps.deleteMeetingDocDirect(uid, meetingId);
  };

  return {
    localAccepted: true,
    path,
    serverPromise: track(runDelete()),
  };
}

export function deleteMeeting(
  meetingId: string,
  options?: { knownAttachmentsCount?: number }
): QueuedWriteHandle {
  return deleteMeetingWithDeps(meetingId, options, {
    getUid: getAuthenticatedUid,
    isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    hasAnyAttachmentsInFirestore: async (uid, mId) => {
      const attCol = collection(db, 'users', uid, 'meetings', mId, 'attachments');
      const snap = await getDocs(query(attCol, limit(1)));
      return !snap.empty;
    },
    callServerDelete: async (mId, idToken) => {
      const res = await fetch('/api/meetings/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ meetingId: mId }),
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    },
    deleteMeetingDocDirect: async (uid, mId) => {
      const path = `users/${uid}/meetings/${mId}`;
      await deleteDoc(doc(db, 'users', uid, 'meetings', mId)).catch((error) =>
        handleFirestoreError(error, OperationType.DELETE, path)
      );
    },
    trackWrite: trackInFlightWrite,
  });
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
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'tasks', task.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteTask(taskId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/tasks/${taskId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'tasks', taskId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function saveNote(note: Note): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${note.id}`;
  const cleanClientId = note.clientId?.trim() ? note.clientId.trim() : undefined;
  const rawPayload: Note = {
    ...note,
    userId: uid,
    clientId: cleanClientId,
    createdAt: note.createdAt || new Date().toISOString(),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'notes', note.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteNote(noteId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/notes/${noteId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'notes', noteId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

// =========================================================================
// Meeting Attachments Metadata (Backblaze B2 metadata only — no secrets/URLs)
// =========================================================================

export function subscribeMeetingAttachments(
  meetingId: string,
  onData: (attachments: MeetingAttachment[]) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/meetings/${meetingId}/attachments`;
  const colRef = collection(db, 'users', uid, 'meetings', meetingId, 'attachments');

  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: MeetingAttachment[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as MeetingAttachment);
      });
      items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onData(items);
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error as Error);
    }
  );
}

// =========================================================================
// Task 006: User-Isolated Reminders State & Follow-Up Preferences
// =========================================================================

export function subscribeReminders(
  onData: (reminders: ReminderStateRecord[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/reminders`;
  const colRef = collection(db, 'users', uid, 'reminders');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: ReminderStateRecord[] = [];
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as ReminderStateRecord);
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
      logFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error as Error);
    }
  );
}

export function saveReminderState(record: ReminderStateRecord): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/reminders/${record.id}`;
  const nowIso = new Date().toISOString();
  const rawPayload: ReminderStateRecord = {
    ...record,
    userId: uid,
    createdAt: record.createdAt || nowIso,
    updatedAt: record.updatedAt || nowIso,
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'reminders', record.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteReminderState(reminderId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/reminders/${reminderId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'reminders', reminderId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function subscribeFollowUpPreferences(
  onData: (prefs: FollowUpPreferences, metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/preferences`;
  const colRef = collection(db, 'users', uid, 'preferences');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      let found: Partial<FollowUpPreferences> | null = null;
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        if (d.id === FOLLOW_UP_PREFERENCES_DOC_ID || !found) {
          found = d.data() as Partial<FollowUpPreferences>;
        }
        if (d.metadata.hasPendingWrites) {
          pendingDocIds.push(d.id);
        }
      });
      const normalized = normalizeFollowUpPreferences(
        found || { ...DEFAULT_FOLLOW_UP_PREFERENCES, userId: uid }
      );
      onData(normalized, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        pendingDocIds,
      });
    },
    (error) => {
      logFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error as Error);
    }
  );
}

export function saveFollowUpPreferences(prefs: FollowUpPreferences): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const normalized = normalizeFollowUpPreferences({
    ...prefs,
    id: prefs.id || FOLLOW_UP_PREFERENCES_DOC_ID,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });
  const path = `users/${uid}/preferences/${normalized.id}`;
  const payload = sanitizeFirestorePayload(normalized);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'preferences', normalized.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

// =========================================================================
// Task 008: Business Opportunities & Stage Transition Events
// =========================================================================

export function subscribeOpportunities(
  onData: (opportunities: Opportunity[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunities`;
  const colRef = collection(db, 'users', uid, 'opportunities');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Opportunity[] = [];
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as Opportunity);
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
      logFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error as Error);
    }
  );
}

export function saveOpportunity(opportunity: Opportunity): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunities/${opportunity.id}`;
  const now = new Date().toISOString();
  const rawPayload: Opportunity = sanitizeOpportunityForSave({
    ...opportunity,
    userId: uid,
    createdAt: opportunity.createdAt || now,
    updatedAt: opportunity.updatedAt || now,
  });
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'opportunities', rawPayload.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteOpportunity(opportunityId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunities/${opportunityId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'opportunities', opportunityId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function subscribeOpportunityStageEvents(
  onData: (events: OpportunityStageEvent[], metadata: SyncMetadata) => void,
  onError?: (err: Error) => void
) {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunityStageEvents`;
  const colRef = collection(db, 'users', uid, 'opportunityStageEvents');
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: OpportunityStageEvent[] = [];
      const pendingDocIds: string[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as OpportunityStageEvent);
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
      logFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error as Error);
    }
  );
}

export function saveOpportunityStageEvent(event: OpportunityStageEvent): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunityStageEvents/${event.id}`;
  const rawPayload: OpportunityStageEvent = {
    ...event,
    userId: uid,
    occurredAt: (event.occurredAt || new Date().toISOString()).slice(0, 50),
  };
  const payload = sanitizeFirestorePayload(rawPayload);
  const serverPromise = trackInFlightWrite(
    setDoc(doc(db, 'users', uid, 'opportunityStageEvents', event.id), payload).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

export function deleteOpportunityStageEvent(eventId: string): QueuedWriteHandle {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/opportunityStageEvents/${eventId}`;
  const serverPromise = trackInFlightWrite(
    deleteDoc(doc(db, 'users', uid, 'opportunityStageEvents', eventId)).catch((error) =>
      handleFirestoreError(error, OperationType.DELETE, path)
    )
  );
  return { localAccepted: true, path, serverPromise };
}

