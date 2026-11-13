import * as fs from 'fs';
import * as path from 'path';
import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { isValidResourceId } from '../utils/attachmentPolicy.ts';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseServerConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  cachedConfig = {
    projectId: raw.projectId,
    firestoreDatabaseId: raw.firestoreDatabaseId,
  };
  return cachedConfig;
}

function getOrInitAdminApp(): App {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }
  const { projectId } = getFirebaseServerConfig();
  return initializeApp({ projectId });
}

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  idToken: string;
}

/**
 * Verifies the Firebase ID Token via firebase-admin Auth and extracts uid strictly from verified token claims.
 */
export async function verifyFirebaseBearerToken(
  authorizationHeader: string | undefined
): Promise<VerifiedFirebaseUser> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new Error('UNAUTHENTICATED: مفقود رمز مصادقة Firebase في ترويسة Authorization.');
  }
  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken || idToken.length > 8192) {
    throw new Error('UNAUTHENTICATED: تنسيق رمز المصادقة غير صالح.');
  }

  const app = getOrInitAdminApp();
  const decoded = await getAuth(app).verifyIdToken(idToken, true);
  if (!decoded.uid || !isValidResourceId(decoded.uid)) {
    throw new Error('UNAUTHENTICATED: لم يتم العثور على معرّف مستخدم صالح في الرمز الموثق.');
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified,
    idToken,
  };
}

export interface MeetingAttachmentRecordCheck {
  exists: boolean;
  fileName?: string;
  contentType?: string;
  storageKey?: string;
}

function parseFirestoreRestStringField(fields: Record<string, any> | undefined, key: string): string | undefined {
  const val = fields?.[key];
  if (val && typeof val.stringValue === 'string') {
    return val.stringValue;
  }
  return undefined;
}

async function fetchDocumentViaVerifiedUserRest(params: {
  relativeDocPath: string;
  idToken: string;
}): Promise<{ exists: boolean; data?: Record<string, any> }> {
  const { projectId, firestoreDatabaseId } = getFirebaseServerConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/${params.relativeDocPath}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
    },
  });

  if (res.status === 404) {
    return { exists: false };
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('FORBIDDEN: رفضت قواعد Firestore الوصول إلى هذا المستند.');
  }
  if (!res.ok) {
    throw new Error(`FIRESTORE_ERROR: تعذر التحقق من ملكية السجل (${res.status}).`);
  }

  const json = (await res.json()) as { fields?: Record<string, any> };
  const fields = json.fields;
  return {
    exists: true,
    data: {
      id: parseFirestoreRestStringField(fields, 'id'),
      userId: parseFirestoreRestStringField(fields, 'userId'),
      fileName: parseFirestoreRestStringField(fields, 'fileName'),
      contentType: parseFirestoreRestStringField(fields, 'contentType'),
      storageKey: parseFirestoreRestStringField(fields, 'storageKey'),
    },
  };
}

/**
 * Verifies that `users/{uid}/meetings/{meetingId}` exists and belongs to the verified `uid`
 * inside the project's named Firestore database (`ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`).
 * Uses Admin SDK when Application Default Credentials are available, otherwise queries the exact named DB
 * via Firestore REST authenticated with the user's verified Firebase ID Token.
 */
export async function verifyMeetingOwnershipInNamedDb(params: {
  uid: string;
  meetingId: string;
  idToken: string;
}): Promise<boolean> {
  const { uid, meetingId, idToken } = params;
  if (!isValidResourceId(uid) || !isValidResourceId(meetingId)) {
    return false;
  }

  const { firestoreDatabaseId } = getFirebaseServerConfig();
  const relativeDocPath = `users/${uid}/meetings/${meetingId}`;

  try {
    const app = getOrInitAdminApp();
    const adminDb = getFirestore(app, firestoreDatabaseId);
    const snap = await adminDb.doc(relativeDocPath).get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data?.userId && data.userId !== uid) return false;
    return true;
  } catch (adminErr: any) {
    // Fall back to user-authenticated REST query against the named database ONLY when Admin ADC is absent
    const msg = String(adminErr?.message || '');
    const isCredentialIssue =
      msg.includes('Could not load the default credentials') ||
      msg.includes('credential') ||
      msg.includes('UNAUTHENTICATED') ||
      adminErr?.code === 16;

    if (!isCredentialIssue) {
      throw adminErr;
    }

    const restRes = await fetchDocumentViaVerifiedUserRest({ relativeDocPath, idToken });
    if (!restRes.exists) return false;
    if (restRes.data?.userId && restRes.data.userId !== uid) return false;
    return true;
  }
}

export async function verifyAttachmentOwnershipInNamedDb(params: {
  uid: string;
  meetingId: string;
  attachmentId: string;
  idToken: string;
}): Promise<MeetingAttachmentRecordCheck> {
  const { uid, meetingId, attachmentId, idToken } = params;
  if (!isValidResourceId(uid) || !isValidResourceId(meetingId) || !isValidResourceId(attachmentId)) {
    return { exists: false };
  }

  const { firestoreDatabaseId } = getFirebaseServerConfig();
  const relativeDocPath = `users/${uid}/meetings/${meetingId}/attachments/${attachmentId}`;

  try {
    const app = getOrInitAdminApp();
    const adminDb = getFirestore(app, firestoreDatabaseId);
    const snap = await adminDb.doc(relativeDocPath).get();
    if (!snap.exists) return { exists: false };
    const data = snap.data();
    if (data?.userId && data.userId !== uid) return { exists: false };
    return {
      exists: true,
      fileName: typeof data?.fileName === 'string' ? data.fileName : undefined,
      contentType: typeof data?.contentType === 'string' ? data.contentType : undefined,
      storageKey: typeof data?.storageKey === 'string' ? data.storageKey : undefined,
    };
  } catch (adminErr: any) {
    const msg = String(adminErr?.message || '');
    const isCredentialIssue =
      msg.includes('Could not load the default credentials') ||
      msg.includes('credential') ||
      msg.includes('UNAUTHENTICATED') ||
      adminErr?.code === 16;

    if (!isCredentialIssue) {
      throw adminErr;
    }

    const restRes = await fetchDocumentViaVerifiedUserRest({ relativeDocPath, idToken });
    if (!restRes.exists) return { exists: false };
    if (restRes.data?.userId && restRes.data.userId !== uid) return { exists: false };
    return {
      exists: true,
      fileName: restRes.data?.fileName,
      contentType: restRes.data?.contentType,
      storageKey: restRes.data?.storageKey,
    };
  }
}
