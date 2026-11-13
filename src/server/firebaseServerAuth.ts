import * as fs from 'fs';
import * as path from 'path';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  AttachmentDeleteStatus,
  MeetingAttachment,
  MeetingAttachmentGuardRecord,
  UploadIntentRecord,
} from '../types/index.ts';
import {
  isUploadIntentEligibleForExpirationCleanup,
  isValidResourceId,
  UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
  UPLOAD_COMMIT_LEASE_MS,
} from '../utils/attachmentPolicy.ts';

export const MEETING_GUARD_DOC_ID = '_meetingGuard';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseServerConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  if (!raw?.projectId || !raw?.firestoreDatabaseId || raw.firestoreDatabaseId === '(default)') {
    throw new Error(
      'INVALID_FIREBASE_CONFIG: إعدادات قاعدة البيانات المسماة في firebase-applet-config.json غير صالحة.'
    );
  }
  cachedConfig = {
    projectId: raw.projectId,
    firestoreDatabaseId: raw.firestoreDatabaseId,
  };
  return cachedConfig;
}

function parseServiceAccountFromEnv(): Record<string, any> | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.client_email === 'string' &&
      typeof parsed.private_key === 'string'
    ) {
      return parsed;
    }
  } catch {
    throw new Error(
      'FIREBASE_ADMIN_NOT_CONFIGURED: صيغة متغير FIREBASE_SERVICE_ACCOUNT_JSON غير صالحة.'
    );
  }
  throw new Error(
    'FIREBASE_ADMIN_NOT_CONFIGURED: متغير FIREBASE_SERVICE_ACCOUNT_JSON يفتقر إلى بيانات حساب الخدمة المطلوبة.'
  );
}

export type AdminCredentialSource =
  | 'service_account_json'
  | 'adc_file'
  | 'emulator'
  | 'cloud_run_adc'
  | 'none';

export interface FirebaseAdminReadinessStatus {
  configured: boolean;
  hasExplicitCredentials: boolean;
  supportsManagedIdentityAdc: boolean;
  credentialSource: AdminCredentialSource;
  projectId: string;
  firestoreDatabaseId: string;
}

export function getFirebaseAdminReadinessStatus(
  env: NodeJS.ProcessEnv = process.env
): FirebaseAdminReadinessStatus {
  const { projectId, firestoreDatabaseId } = getFirebaseServerConfig();
  const hasServiceAccountJson = Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
  const hasAdcFile = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  const hasEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST?.trim());
  const hasCloudRunIdentity = Boolean(
    env.K_SERVICE?.trim() || env.CLOUD_RUN_JOB?.trim() || env.GCE_METADATA_HOST?.trim()
  );

  let credentialSource: AdminCredentialSource = 'none';
  if (hasServiceAccountJson) credentialSource = 'service_account_json';
  else if (hasAdcFile) credentialSource = 'adc_file';
  else if (hasEmulator) credentialSource = 'emulator';
  else if (hasCloudRunIdentity) credentialSource = 'cloud_run_adc';

  const hasExplicitCredentials = hasServiceAccountJson || hasAdcFile || hasEmulator;
  return {
    configured: hasExplicitCredentials,
    hasExplicitCredentials,
    supportsManagedIdentityAdc: hasCloudRunIdentity,
    credentialSource,
    projectId,
    firestoreDatabaseId,
  };
}

export function isFirebaseAdminConfigured(): boolean {
  return getFirebaseAdminReadinessStatus().configured;
}

function getOrInitAdminApp(): App {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }
  const { projectId } = getFirebaseServerConfig();
  const sa = parseServiceAccountFromEnv();
  if (sa) {
    return initializeApp({
      credential: cert(sa),
      projectId,
    });
  }
  return initializeApp({ projectId });
}

function getNamedAdminFirestore() {
  const { firestoreDatabaseId } = getFirebaseServerConfig();
  if (!firestoreDatabaseId || firestoreDatabaseId === '(default)') {
    throw new Error('INVALID_FIRESTORE_DATABASE: يمنع استخدام قاعدة البيانات الافتراضية.');
  }
  const app = getOrInitAdminApp();
  return getFirestore(app, firestoreDatabaseId);
}

/**
 * Lightweight, non-destructive permission probe against the named Firestore database.
 * Never logs or returns credentials, service account emails, or raw exception stacks.
 */
export async function verifyNamedDatabaseAdminAccess(): Promise<{
  accessVerified: boolean;
  reasonCode: 'OK' | 'ADMIN_UNAVAILABLE' | 'PERMISSION_DENIED';
}> {
  try {
    const db = getNamedAdminFirestore();
    await db.collection('_health_probe_nonexistent').limit(1).get();
    return { accessVerified: true, reasonCode: 'OK' };
  } catch (err: any) {
    if (isAdminCredentialFailure(err)) {
      const msg = String(err?.message || '');
      const isPerm = msg.includes('PERMISSION_DENIED') || err?.code === 7;
      return {
        accessVerified: false,
        reasonCode: isPerm ? 'PERMISSION_DENIED' : 'ADMIN_UNAVAILABLE',
      };
    }
    return { accessVerified: false, reasonCode: 'ADMIN_UNAVAILABLE' };
  }
}

function isAdminCredentialFailure(err: any): boolean {
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  return (
    msg.includes('Could not load the default credentials') ||
    msg.includes('credential') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('identitytoolkit') ||
    err?.code === 7 ||
    err?.code === 16 ||
    code === 'auth/internal-error' ||
    code === 'app/invalid-credential'
  );
}

function rethrowIfAdminUnavailable(err: any): never {
  if (isAdminCredentialFailure(err)) {
    throw new Error(
      'FIREBASE_ADMIN_NOT_CONFIGURED: يتطلب تنفيذ عمليات المرفقات الموثوقة على الخادم توفير مفتاح حساب خدمة Firebase Admin (FIREBASE_SERVICE_ACCOUNT_JSON أو GOOGLE_APPLICATION_CREDENTIALS) بصلاحية الوصول إلى قاعدة البيانات المسماة.'
    );
  }
  throw err;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  idToken: string;
}

export interface DecodedTokenShape {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

export async function verifyFirebaseTokenWithFallback(params: {
  idToken: string;
  preferRevocationCheck: boolean;
  verifyIdTokenFn: (token: string, checkRevoked: boolean) => Promise<DecodedTokenShape>;
}): Promise<DecodedTokenShape> {
  const { idToken, preferRevocationCheck, verifyIdTokenFn } = params;

  if (!preferRevocationCheck) {
    return verifyIdTokenFn(idToken, false);
  }

  try {
    return await verifyIdTokenFn(idToken, true);
  } catch (err: any) {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');

    // Never fall back if the token itself is invalid, expired, revoked, or user disabled
    const isTokenProblem =
      code === 'auth/id-token-expired' ||
      code === 'auth/id-token-revoked' ||
      code === 'auth/argument-error' ||
      code === 'auth/user-disabled' ||
      code === 'auth/user-not-found';

    const isHostOrAdminApiIssue =
      !isTokenProblem &&
      (code === 'auth/internal-error' ||
        code === 'auth/insufficient-permission' ||
        code === 'app/invalid-credential' ||
        msg.includes('identitytoolkit') ||
        msg.includes('credential') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('insufficient'));

    if (!isHostOrAdminApiIssue) {
      throw err;
    }

    // Fall back to cryptographic RS256 public-certificate verification (signature, aud, iss, exp, uid)
    return verifyIdTokenFn(idToken, false);
  }
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
  const hasExplicitServiceAccount = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  );
  const decoded = await verifyFirebaseTokenWithFallback({
    idToken,
    preferRevocationCheck: hasExplicitServiceAccount,
    verifyIdTokenFn: (token, checkRevoked) => getAuth(app).verifyIdToken(token, checkRevoked),
  });

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
  record?: MeetingAttachment;
  fileName?: string;
  contentType?: string;
  storageKey?: string;
  deleteStatus?: AttachmentDeleteStatus;
}

function parseFirestoreRestStringField(
  fields: Record<string, any> | undefined,
  key: string
): string | undefined {
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
      deleteStatus: parseFirestoreRestStringField(fields, 'deleteStatus'),
    },
  };
}

/**
 * Verifies that `users/{uid}/meetings/{meetingId}` exists and belongs to the verified `uid`
 * inside the project's named Firestore database (`ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`).
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

  const relativeDocPath = `users/${uid}/meetings/${meetingId}`;

  try {
    const adminDb = getNamedAdminFirestore();
    const snap = await adminDb.doc(relativeDocPath).get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data?.userId && data.userId !== uid) return false;
    return true;
  } catch (adminErr: any) {
    if (!isAdminCredentialFailure(adminErr)) {
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
  if (
    !isValidResourceId(uid) ||
    !isValidResourceId(meetingId) ||
    !isValidResourceId(attachmentId)
  ) {
    return { exists: false };
  }

  const relativeDocPath = `users/${uid}/meetings/${meetingId}/attachments/${attachmentId}`;

  try {
    const adminDb = getNamedAdminFirestore();
    const snap = await adminDb.doc(relativeDocPath).get();
    if (!snap.exists) return { exists: false };
    const data = snap.data() as MeetingAttachment | undefined;
    if (data?.userId && data.userId !== uid) return { exists: false };
    return {
      exists: true,
      record: data,
      fileName: typeof data?.fileName === 'string' ? data.fileName : undefined,
      contentType: typeof data?.contentType === 'string' ? data.contentType : undefined,
      storageKey: typeof data?.storageKey === 'string' ? data.storageKey : undefined,
      deleteStatus: data?.deleteStatus,
    };
  } catch (adminErr: any) {
    if (!isAdminCredentialFailure(adminErr)) {
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
      deleteStatus: restRes.data?.deleteStatus as AttachmentDeleteStatus | undefined,
    };
  }
}

export interface ClaimIntentForCommitResult {
  outcome:
    | 'claimed'
    | 'already_committed'
    | 'intent_not_found'
    | 'intent_abandoned'
    | 'intent_mismatch'
    | 'commit_in_progress';
  intent?: UploadIntentRecord;
  record?: MeetingAttachment;
}

export interface CommitAttachmentResult {
  outcome: 'committed' | 'already_committed' | 'intent_not_found' | 'intent_abandoned' | 'intent_mismatch';
  record?: MeetingAttachment;
}

export interface MarkAbandonedResult {
  outcome: 'abandoned' | 'already_committed' | 'not_found' | 'already_abandoned';
  record?: MeetingAttachment;
}

export interface ClaimExpirationCleanupResult {
  outcome: 'claimed' | 'already_committed' | 'not_eligible' | 'not_expired' | 'not_found';
  intent?: UploadIntentRecord;
}

export interface MeetingDeletionEligibility {
  canDelete: boolean;
  reason?: 'HAS_ATTACHMENTS' | 'HAS_PENDING_INTENTS';
  attachmentsCount: number;
  pendingIntentsCount: number;
}

export interface DeleteMeetingOutcome {
  outcome: 'deleted' | 'not_found' | 'blocked_attachments' | 'blocked_pending_intents';
}

/**
 * Trusted Server-Side Attachment Metadata & Upload Intent Store.
 * Backed by Firebase Admin SDK targeting ONLY the named Firestore database.
 */
export interface AttachmentMetadataStore {
  createUploadIntent(intent: UploadIntentRecord): Promise<void>;
  getUploadIntent(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
  }): Promise<UploadIntentRecord | null>;
  getAttachmentRecord(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
  }): Promise<MeetingAttachmentRecordCheck>;
  claimIntentForCommit(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowMs: number;
    nowIso: string;
    leaseDurationMs?: number;
    expectedFileName?: string;
    expectedContentType?: string;
    expectedSizeBytes?: number;
  }): Promise<ClaimIntentForCommitResult>;
  releaseIntentCommitLease?(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
  }): Promise<void>;
  commitAttachmentFromIntent(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    attachment: MeetingAttachment;
    nowIso: string;
  }): Promise<CommitAttachmentResult>;
  markUploadIntentAbandonedIfPending(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
    releaseGuard?: boolean;
    cleanupReason?: UploadIntentRecord['cleanupReason'];
  }): Promise<MarkAbandonedResult>;
  releaseIntentFromGuard(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
  }): Promise<void>;
  updateAttachmentDeleteStatus(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    deleteStatus: AttachmentDeleteStatus;
    deleteErrorArabic?: string;
    updatedAt: string;
  }): Promise<void>;
  finalizeAttachmentDeletion(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
  }): Promise<void>;
  listPendingUploadIntentsForMeeting(params: {
    uid: string;
    meetingId: string;
  }): Promise<UploadIntentRecord[]>;
  listPendingUploadIntentsGlobal(params: { limit: number }): Promise<UploadIntentRecord[]>;
  claimIntentForExpirationCleanup(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowMs: number;
    nowIso: string;
    safetyBufferMs?: number;
  }): Promise<ClaimExpirationCleanupResult>;
  finalizeExpiredIntentCleanup(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
  }): Promise<void>;
  releaseExpiredIntentCleaningOnFailure(params: {
    uid: string;
    meetingId: string;
    attachmentId: string;
    nowIso: string;
  }): Promise<void>;
  checkMeetingDeletionEligibility(params: {
    uid: string;
    meetingId: string;
  }): Promise<MeetingDeletionEligibility>;
  deleteMeetingIfNoAttachments(params: {
    uid: string;
    meetingId: string;
  }): Promise<DeleteMeetingOutcome>;
}

function intentDocPath(uid: string, meetingId: string, attachmentId: string): string {
  return `users/${uid}/meetings/${meetingId}/uploadIntents/${attachmentId}`;
}

function guardDocPath(uid: string, meetingId: string): string {
  return `users/${uid}/meetings/${meetingId}/uploadIntents/${MEETING_GUARD_DOC_ID}`;
}

function attachmentDocPath(uid: string, meetingId: string, attachmentId: string): string {
  return `users/${uid}/meetings/${meetingId}/attachments/${attachmentId}`;
}

function meetingDocPath(uid: string, meetingId: string): string {
  return `users/${uid}/meetings/${meetingId}`;
}

function stripUndefinedFields<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function buildUpdatedGuardRecord(params: {
  existing: MeetingAttachmentGuardRecord | undefined;
  uid: string;
  meetingId: string;
  addPendingId?: string;
  removePendingId?: string;
  addActiveId?: string;
  removeActiveId?: string;
  nowIso: string;
}): MeetingAttachmentGuardRecord {
  const activeSet = new Set<string>(params.existing?.activeAttachmentIds || []);
  const pendingSet = new Set<string>(params.existing?.pendingIntentIds || []);

  if (params.addPendingId) pendingSet.add(params.addPendingId);
  if (params.removePendingId) pendingSet.delete(params.removePendingId);
  if (params.addActiveId) activeSet.add(params.addActiveId);
  if (params.removeActiveId) activeSet.delete(params.removeActiveId);

  const activeAttachmentIds = Array.from(activeSet);
  const pendingIntentIds = Array.from(pendingSet);
  return {
    guardVersion: 1,
    meetingId: params.meetingId,
    userId: params.uid,
    activeAttachmentIds,
    pendingIntentIds,
    locked: activeAttachmentIds.length > 0 || pendingIntentIds.length > 0,
    updatedAt: params.nowIso,
  };
}

export function createFirebaseAttachmentMetadataStore(): AttachmentMetadataStore {
  return {
    async createUploadIntent(intent: UploadIntentRecord): Promise<void> {
      try {
        const db = getNamedAdminFirestore();
        const intentRef = db.doc(intentDocPath(intent.userId, intent.meetingId, intent.attachmentId));
        const guardRef = db.doc(guardDocPath(intent.userId, intent.meetingId));

        await db.runTransaction(async (tx) => {
          const guardSnap = await tx.get(guardRef);
          const nextGuard = buildUpdatedGuardRecord({
            existing: guardSnap.exists ? (guardSnap.data() as MeetingAttachmentGuardRecord) : undefined,
            uid: intent.userId,
            meetingId: intent.meetingId,
            addPendingId: intent.attachmentId,
            nowIso: intent.updatedAt,
          });
          tx.set(intentRef, stripUndefinedFields(intent));
          tx.set(guardRef, nextGuard);
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async getUploadIntent({ uid, meetingId, attachmentId }): Promise<UploadIntentRecord | null> {
      try {
        if (attachmentId === MEETING_GUARD_DOC_ID) return null;
        const db = getNamedAdminFirestore();
        const snap = await db.doc(intentDocPath(uid, meetingId, attachmentId)).get();
        if (!snap.exists) return null;
        return snap.data() as UploadIntentRecord;
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async getAttachmentRecord({ uid, meetingId, attachmentId }): Promise<MeetingAttachmentRecordCheck> {
      try {
        const db = getNamedAdminFirestore();
        const snap = await db.doc(attachmentDocPath(uid, meetingId, attachmentId)).get();
        if (!snap.exists) return { exists: false };
        const data = snap.data() as MeetingAttachment | undefined;
        if (data?.userId && data.userId !== uid) return { exists: false };
        return {
          exists: true,
          record: data,
          fileName: data?.fileName,
          contentType: data?.contentType,
          storageKey: data?.storageKey,
          deleteStatus: data?.deleteStatus,
        };
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async claimIntentForCommit(params): Promise<ClaimIntentForCommitResult> {
      const {
        uid,
        meetingId,
        attachmentId,
        nowMs,
        nowIso,
        leaseDurationMs = UPLOAD_COMMIT_LEASE_MS,
        expectedFileName,
        expectedContentType,
        expectedSizeBytes,
      } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));

        return await db.runTransaction(async (tx) => {
          const [attSnap, intentSnap] = await Promise.all([tx.get(attRef), tx.get(intentRef)]);

          if (attSnap.exists) {
            return {
              outcome: 'already_committed' as const,
              record: attSnap.data() as MeetingAttachment,
            };
          }

          if (!intentSnap.exists) {
            return { outcome: 'intent_not_found' as const };
          }

          const intent = intentSnap.data() as UploadIntentRecord;
          if (intent.userId !== uid || intent.meetingId !== meetingId) {
            return { outcome: 'intent_mismatch' as const };
          }
          if (
            (expectedFileName !== undefined && intent.fileName !== expectedFileName) ||
            (expectedContentType !== undefined && intent.contentType !== expectedContentType) ||
            (expectedSizeBytes !== undefined && intent.sizeBytes !== expectedSizeBytes)
          ) {
            return { outcome: 'intent_mismatch' as const };
          }

          if (
            intent.status === 'abandoned' ||
            intent.status === 'deleted' ||
            intent.status === 'cleaning'
          ) {
            return { outcome: 'intent_abandoned' as const };
          }

          if (intent.status === 'committed') {
            return { outcome: 'intent_abandoned' as const };
          }

          if (intent.status === 'committing' && intent.committingLeaseExpiresAt) {
            const leaseMs = new Date(intent.committingLeaseExpiresAt).getTime();
            if (Number.isFinite(leaseMs) && nowMs < leaseMs) {
              return { outcome: 'commit_in_progress' as const, intent };
            }
          }

          const leaseIso = new Date(nowMs + leaseDurationMs).toISOString();
          const claimedIntent: UploadIntentRecord = {
            ...intent,
            status: 'committing',
            committingLeaseExpiresAt: leaseIso,
            updatedAt: nowIso,
          };

          tx.update(intentRef, {
            status: 'committing',
            committingLeaseExpiresAt: leaseIso,
            updatedAt: nowIso,
          });

          return {
            outcome: 'claimed' as const,
            intent: claimedIntent,
          };
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async releaseIntentCommitLease(params): Promise<void> {
      const { uid, meetingId, attachmentId, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(intentRef);
          if (!snap.exists) return;
          const intent = snap.data() as UploadIntentRecord;
          if (intent.status === 'committing') {
            tx.update(intentRef, {
              status: 'pending',
              updatedAt: nowIso,
            });
          }
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async commitAttachmentFromIntent(params): Promise<CommitAttachmentResult> {
      const { uid, meetingId, attachmentId, attachment, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        const guardRef = db.doc(guardDocPath(uid, meetingId));

        return await db.runTransaction(async (tx) => {
          const [attSnap, intentSnap, guardSnap] = await Promise.all([
            tx.get(attRef),
            tx.get(intentRef),
            tx.get(guardRef),
          ]);

          // Idempotent commit retry: if attachment already exists, return the existing authoritative record
          if (attSnap.exists) {
            return {
              outcome: 'already_committed' as const,
              record: attSnap.data() as MeetingAttachment,
            };
          }

          if (!intentSnap.exists) {
            return { outcome: 'intent_not_found' as const };
          }

          const intent = intentSnap.data() as UploadIntentRecord;
          if (intent.userId !== uid || intent.meetingId !== meetingId) {
            return { outcome: 'intent_mismatch' as const };
          }

          if (
            intent.status === 'abandoned' ||
            intent.status === 'deleted' ||
            intent.status === 'cleaning'
          ) {
            return { outcome: 'intent_abandoned' as const };
          }

          if (intent.status === 'committed') {
            return { outcome: 'intent_abandoned' as const };
          }

          const authoritativeRecord = stripUndefinedFields({
            ...attachment,
            id: attachmentId,
            userId: uid,
            meetingId,
            fileName: intent.fileName,
            contentType: intent.contentType,
            storageKey: intent.storageKey,
            storageProvider: 'backblaze_b2',
            uploadStatus: 'completed',
            deleteStatus: 'active',
          }) as MeetingAttachment;

          const nextGuard = buildUpdatedGuardRecord({
            existing: guardSnap.exists ? (guardSnap.data() as MeetingAttachmentGuardRecord) : undefined,
            uid,
            meetingId,
            removePendingId: attachmentId,
            addActiveId: attachmentId,
            nowIso,
          });

          tx.set(attRef, authoritativeRecord);
          tx.update(intentRef, {
            status: 'committed',
            committedAt: nowIso,
            updatedAt: nowIso,
          });
          tx.set(guardRef, nextGuard);

          return {
            outcome: 'committed' as const,
            record: authoritativeRecord,
          };
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async markUploadIntentAbandonedIfPending(params): Promise<MarkAbandonedResult> {
      const {
        uid,
        meetingId,
        attachmentId,
        nowIso,
        releaseGuard = false,
        cleanupReason = 'client_abandoned',
      } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        const guardRef = db.doc(guardDocPath(uid, meetingId));

        return await db.runTransaction(async (tx) => {
          const [attSnap, intentSnap, guardSnap] = await Promise.all([
            tx.get(attRef),
            tx.get(intentRef),
            tx.get(guardRef),
          ]);

          if (attSnap.exists) {
            return {
              outcome: 'already_committed' as const,
              record: attSnap.data() as MeetingAttachment,
            };
          }

          if (!intentSnap.exists) {
            return { outcome: 'not_found' as const };
          }

          const intent = intentSnap.data() as UploadIntentRecord;
          if (intent.status === 'committed' || intent.status === 'deleted') {
            return { outcome: 'already_committed' as const };
          }

          if (intent.status === 'abandoned') {
            if (releaseGuard && guardSnap.exists) {
              const nextGuard = buildUpdatedGuardRecord({
                existing: guardSnap.data() as MeetingAttachmentGuardRecord,
                uid,
                meetingId,
                removePendingId: attachmentId,
                nowIso,
              });
              tx.set(guardRef, nextGuard);
            }
            return { outcome: 'already_abandoned' as const };
          }

          tx.update(intentRef, {
            status: 'abandoned',
            cleanupReason,
            updatedAt: nowIso,
          });

          if (releaseGuard) {
            const nextGuard = buildUpdatedGuardRecord({
              existing: guardSnap.exists ? (guardSnap.data() as MeetingAttachmentGuardRecord) : undefined,
              uid,
              meetingId,
              removePendingId: attachmentId,
              nowIso,
            });
            tx.set(guardRef, nextGuard);
          }

          return { outcome: 'abandoned' as const };
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async releaseIntentFromGuard(params): Promise<void> {
      const { uid, meetingId, attachmentId, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const guardRef = db.doc(guardDocPath(uid, meetingId));
        await db.runTransaction(async (tx) => {
          const guardSnap = await tx.get(guardRef);
          if (!guardSnap.exists) return;
          const nextGuard = buildUpdatedGuardRecord({
            existing: guardSnap.data() as MeetingAttachmentGuardRecord,
            uid,
            meetingId,
            removePendingId: attachmentId,
            nowIso,
          });
          tx.set(guardRef, nextGuard);
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async updateAttachmentDeleteStatus(params): Promise<void> {
      const { uid, meetingId, attachmentId, deleteStatus, deleteErrorArabic, updatedAt } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const patch: Record<string, any> = {
          deleteStatus,
          updatedAt,
        };
        if (deleteErrorArabic !== undefined) {
          patch.deleteErrorArabic = deleteErrorArabic;
        }
        await attRef.update(patch);
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async finalizeAttachmentDeletion(params): Promise<void> {
      const { uid, meetingId, attachmentId, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        const guardRef = db.doc(guardDocPath(uid, meetingId));

        await db.runTransaction(async (tx) => {
          const [intentSnap, guardSnap] = await Promise.all([
            tx.get(intentRef),
            tx.get(guardRef),
          ]);
          tx.delete(attRef);
          if (intentSnap.exists) {
            tx.update(intentRef, {
              status: 'deleted',
              updatedAt: nowIso,
            });
          } else {
            tx.set(intentRef, {
              attachmentId,
              userId: uid,
              meetingId,
              fileName: 'deleted',
              contentType: 'application/pdf',
              sizeBytes: 1,
              storageKey: `users/${uid}/meetings/${meetingId}/attachments/${attachmentId}`,
              status: 'deleted',
              expiresAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
          const nextGuard = buildUpdatedGuardRecord({
            existing: guardSnap.exists ? (guardSnap.data() as MeetingAttachmentGuardRecord) : undefined,
            uid,
            meetingId,
            removeActiveId: attachmentId,
            removePendingId: attachmentId,
            nowIso,
          });
          tx.set(guardRef, nextGuard);
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async listPendingUploadIntentsForMeeting({ uid, meetingId }): Promise<UploadIntentRecord[]> {
      try {
        const db = getNamedAdminFirestore();
        const colRef = db.collection(`users/${uid}/meetings/${meetingId}/uploadIntents`);
        const snap = await colRef.where('status', 'in', ['pending', 'committing']).get();
        const results: UploadIntentRecord[] = [];
        snap.forEach((d) => {
          if (d.id === MEETING_GUARD_DOC_ID) return;
          results.push(d.data() as UploadIntentRecord);
        });
        return results;
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async listPendingUploadIntentsGlobal({ limit }): Promise<UploadIntentRecord[]> {
      try {
        const db = getNamedAdminFirestore();
        const snap = await db
          .collectionGroup('uploadIntents')
          .where('status', 'in', ['pending', 'committing'])
          .limit(limit)
          .get();
        const results: UploadIntentRecord[] = [];
        snap.forEach((d) => {
          if (d.id === MEETING_GUARD_DOC_ID) return;
          results.push(d.data() as UploadIntentRecord);
        });
        return results;
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async claimIntentForExpirationCleanup(params): Promise<ClaimExpirationCleanupResult> {
      const {
        uid,
        meetingId,
        attachmentId,
        nowMs,
        nowIso,
        safetyBufferMs = UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
      } = params;
      try {
        const db = getNamedAdminFirestore();
        const attRef = db.doc(attachmentDocPath(uid, meetingId, attachmentId));
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));

        return await db.runTransaction(async (tx) => {
          const [attSnap, intentSnap] = await Promise.all([tx.get(attRef), tx.get(intentRef)]);

          if (attSnap.exists) {
            return { outcome: 'already_committed' as const };
          }
          if (!intentSnap.exists) {
            return { outcome: 'not_found' as const };
          }

          const intent = intentSnap.data() as UploadIntentRecord;
          if (intent.status !== 'pending' && intent.status !== 'committing') {
            return { outcome: 'not_eligible' as const, intent };
          }

          const eligible = isUploadIntentEligibleForExpirationCleanup({
            status: intent.status,
            expiresAt: intent.expiresAt,
            committingLeaseExpiresAt: intent.committingLeaseExpiresAt,
            nowMs,
            safetyBufferMs,
          });

          if (!eligible) {
            return { outcome: 'not_expired' as const, intent };
          }

          tx.update(intentRef, {
            status: 'cleaning',
            cleaningStartedAt: nowIso,
            updatedAt: nowIso,
          });

          return {
            outcome: 'claimed' as const,
            intent: {
              ...intent,
              status: 'cleaning',
              cleaningStartedAt: nowIso,
              updatedAt: nowIso,
            },
          };
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async finalizeExpiredIntentCleanup(params): Promise<void> {
      const { uid, meetingId, attachmentId, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        const guardRef = db.doc(guardDocPath(uid, meetingId));

        await db.runTransaction(async (tx) => {
          const [intentSnap, guardSnap] = await Promise.all([
            tx.get(intentRef),
            tx.get(guardRef),
          ]);
          if (intentSnap.exists) {
            tx.update(intentRef, {
              status: 'abandoned',
              cleanupReason: 'expired_uncommitted',
              cleanedAt: nowIso,
              updatedAt: nowIso,
            });
          }
          const nextGuard = buildUpdatedGuardRecord({
            existing: guardSnap.exists ? (guardSnap.data() as MeetingAttachmentGuardRecord) : undefined,
            uid,
            meetingId,
            removePendingId: attachmentId,
            nowIso,
          });
          tx.set(guardRef, nextGuard);
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async releaseExpiredIntentCleaningOnFailure(params): Promise<void> {
      const { uid, meetingId, attachmentId, nowIso } = params;
      try {
        const db = getNamedAdminFirestore();
        const intentRef = db.doc(intentDocPath(uid, meetingId, attachmentId));
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(intentRef);
          if (!snap.exists) return;
          const intent = snap.data() as UploadIntentRecord;
          if (intent.status === 'cleaning') {
            tx.update(intentRef, {
              status: 'pending',
              updatedAt: nowIso,
            });
          }
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async checkMeetingDeletionEligibility({ uid, meetingId }): Promise<MeetingDeletionEligibility> {
      try {
        const db = getNamedAdminFirestore();
        const attCol = db.collection(`users/${uid}/meetings/${meetingId}/attachments`);
        const intentsCol = db.collection(`users/${uid}/meetings/${meetingId}/uploadIntents`);
        const guardRef = db.doc(guardDocPath(uid, meetingId));

        const [attSnap, intentsSnap, guardSnap] = await Promise.all([
          attCol.limit(10).get(),
          intentsCol.limit(25).get(),
          guardRef.get(),
        ]);

        const attachmentsCount = attSnap.size;
        let pendingIntentsCount = 0;

        intentsSnap.forEach((d) => {
          if (d.id === MEETING_GUARD_DOC_ID) return;
          const data = d.data() as UploadIntentRecord;
          if (
            data.status === 'pending' ||
            data.status === 'committing' ||
            data.status === 'cleaning'
          ) {
            pendingIntentsCount += 1;
          }
        });

        const guard = guardSnap.exists
          ? (guardSnap.data() as MeetingAttachmentGuardRecord)
          : undefined;
        const guardActiveCount = guard?.activeAttachmentIds?.length || 0;
        const guardPendingCount = guard?.pendingIntentIds?.length || 0;

        const effectiveAttachments = Math.max(attachmentsCount, guardActiveCount);
        const effectivePending = Math.max(pendingIntentsCount, guardPendingCount);

        if (effectiveAttachments > 0) {
          return {
            canDelete: false,
            reason: 'HAS_ATTACHMENTS',
            attachmentsCount: effectiveAttachments,
            pendingIntentsCount: effectivePending,
          };
        }

        if (effectivePending > 0 || guard?.locked === true) {
          return {
            canDelete: false,
            reason: 'HAS_PENDING_INTENTS',
            attachmentsCount: effectiveAttachments,
            pendingIntentsCount: Math.max(effectivePending, 1),
          };
        }

        return {
          canDelete: true,
          attachmentsCount: 0,
          pendingIntentsCount: 0,
        };
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },

    async deleteMeetingIfNoAttachments({ uid, meetingId }): Promise<DeleteMeetingOutcome> {
      try {
        const db = getNamedAdminFirestore();
        const meetingRef = db.doc(meetingDocPath(uid, meetingId));
        const guardRef = db.doc(guardDocPath(uid, meetingId));
        const attCol = db.collection(`users/${uid}/meetings/${meetingId}/attachments`);
        const intentsCol = db.collection(`users/${uid}/meetings/${meetingId}/uploadIntents`);

        return await db.runTransaction(async (tx) => {
          const [meetingSnap, guardSnap, attSnap, intentsSnap] = await Promise.all([
            tx.get(meetingRef),
            tx.get(guardRef),
            tx.get(attCol.limit(1)),
            tx.get(intentsCol.limit(25)),
          ]);

          if (!attSnap.empty) {
            return { outcome: 'blocked_attachments' as const };
          }

          let hasPending = false;
          intentsSnap.forEach((d) => {
            if (d.id === MEETING_GUARD_DOC_ID) return;
            const data = d.data() as UploadIntentRecord;
            if (
              data.status === 'pending' ||
              data.status === 'committing' ||
              data.status === 'cleaning'
            ) {
              hasPending = true;
            }
          });

          const guard = guardSnap.exists
            ? (guardSnap.data() as MeetingAttachmentGuardRecord)
            : undefined;
          if ((guard?.activeAttachmentIds?.length || 0) > 0) {
            return { outcome: 'blocked_attachments' as const };
          }
          if (hasPending || (guard?.pendingIntentIds?.length || 0) > 0 || guard?.locked === true) {
            return { outcome: 'blocked_pending_intents' as const };
          }

          if (!meetingSnap.exists) {
            return { outcome: 'not_found' as const };
          }

          tx.delete(meetingRef);
          if (guardSnap.exists) {
            tx.delete(guardRef);
          }

          return { outcome: 'deleted' as const };
        });
      } catch (err) {
        rethrowIfAdminUnavailable(err);
      }
    },
  };
}
