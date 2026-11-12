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

// Initialize Firestore with custom databaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

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

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
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
 * Validate Connection to Firestore on boot
 */
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is running in offline mode.');
    } else {
      console.warn('Firestore initial connection check:', error);
    }
    return false;
  }
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
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/clients`);
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
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/meetings`);
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
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/tasks`);
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
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/notes`);
    }
  );
}

// User-Scoped Protected Mutations
export async function saveClient(client: Client): Promise<void> {
  const uid = getAuthenticatedUid();
  const path = `users/${uid}/clients/${client.id}`;
  try {
    const payload: Client = {
      ...client,
      userId: uid,
    };
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
    const payload: Meeting = {
      ...meeting,
      userId: uid,
    };
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
    const payload: ActionItem = {
      ...task,
      userId: uid,
    };
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
    const payload: Note = {
      ...note,
      userId: uid,
    };
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
