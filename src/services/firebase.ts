import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  getDocFromServer,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  getDocs,
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

// Subscriptions
export function subscribeClients(
  onData: (clients: Client[]) => void,
  onError?: (err: Error) => void
) {
  const colRef = collection(db, 'clients');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: Client[] = [];
      snapshot.forEach((d) => items.push(d.data() as Client));
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'clients');
    }
  );
}

export function subscribeMeetings(
  onData: (meetings: Meeting[]) => void,
  onError?: (err: Error) => void
) {
  const colRef = collection(db, 'meetings');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: Meeting[] = [];
      snapshot.forEach((d) => items.push(d.data() as Meeting));
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'meetings');
    }
  );
}

export function subscribeTasks(
  onData: (tasks: ActionItem[]) => void,
  onError?: (err: Error) => void
) {
  const colRef = collection(db, 'tasks');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: ActionItem[] = [];
      snapshot.forEach((d) => items.push(d.data() as ActionItem));
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    }
  );
}

export function subscribeNotes(
  onData: (notes: Note[]) => void,
  onError?: (err: Error) => void
) {
  const colRef = collection(db, 'notes');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: Note[] = [];
      snapshot.forEach((d) => items.push(d.data() as Note));
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'notes');
    }
  );
}

// Mutations
export async function saveClient(client: Client): Promise<void> {
  const path = `clients/${client.id}`;
  try {
    await setDoc(doc(db, 'clients', client.id), client);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteClient(clientId: string): Promise<void> {
  const path = `clients/${clientId}`;
  try {
    await deleteDoc(doc(db, 'clients', clientId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveMeeting(meeting: Meeting): Promise<void> {
  const path = `meetings/${meeting.id}`;
  try {
    await setDoc(doc(db, 'meetings', meeting.id), meeting);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    await deleteDoc(doc(db, 'meetings', meetingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveTask(task: ActionItem): Promise<void> {
  const path = `tasks/${task.id}`;
  try {
    await setDoc(doc(db, 'tasks', task.id), task);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const path = `tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveNote(note: Note): Promise<void> {
  const path = `notes/${note.id}`;
  try {
    await setDoc(doc(db, 'notes', note.id), note);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteNote(noteId: string): Promise<void> {
  const path = `notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'notes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Seed initial sample data to Firestore in a batch write
 */
export async function seedInitialData(
  clients: Client[],
  meetings: Meeting[],
  tasks: ActionItem[],
  notes: Note[]
): Promise<void> {
  const batch = writeBatch(db);

  clients.forEach((c) => {
    batch.set(doc(db, 'clients', c.id), c);
  });
  meetings.forEach((m) => {
    batch.set(doc(db, 'meetings', m.id), m);
  });
  tasks.forEach((t) => {
    batch.set(doc(db, 'tasks', t.id), t);
  });
  notes.forEach((n) => {
    batch.set(doc(db, 'notes', n.id), n);
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'batch_seed');
  }
}
