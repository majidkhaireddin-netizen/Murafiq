import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createAttachmentsRouter,
  sweepExpiredUploadIntents,
} from '../src/server/attachmentsRouter.ts';
import { createMeetingsRouter } from '../src/server/meetingsRouter.ts';
import type { B2StorageService } from '../src/server/b2Storage.ts';
import {
  createFirebaseAttachmentMetadataStore,
  getFirebaseAdminReadinessStatus,
  getFirebaseServerConfig,
  MEETING_GUARD_DOC_ID,
  verifyFirebaseTokenWithFallback,
  type AttachmentMetadataStore,
} from '../src/server/firebaseServerAuth.ts';
import {
  buildAttachmentStorageKey,
  isPresignedUrlExpired,
  isUploadIntentEligibleForExpirationCleanup,
  MAX_ATTACHMENT_SIZE_BYTES,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  PRESIGNED_UPLOAD_TTL_SECONDS,
  UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
  UPLOAD_COMMIT_LEASE_MS,
  UPLOAD_INTENT_GRACE_MS,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../src/utils/attachmentPolicy.ts';
import {
  clearAttachmentDownloadCache,
  getDownloadCacheSnapshotForTesting,
} from '../src/utils/attachmentDownloadCache.ts';
import {
  AttachmentClientError,
  cleanupExpiredMeetingAttachmentsWithDeps,
  deleteMeetingAttachmentWithDeps,
  getFreshPresignedDownloadUrlWithDeps,
  uploadMeetingAttachmentWithDeps,
} from '../src/services/attachments.ts';
import { deleteMeetingWithDeps } from '../src/services/firebase.ts';
import { classifyWriteError } from '../src/utils/sessionState.ts';
import type {
  MeetingAttachment,
  MeetingAttachmentGuardRecord,
  UploadIntentRecord,
} from '../src/types/index.ts';

const USER_A = 'user_alice_001';
const USER_B = 'user_bob_002';
const MEETING_A = 'meet_alice_100';

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const HTML_DISGUISED = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
const EXE_DISGUISED = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ header

function createMockTestServer(options?: {
  b2Configured?: boolean;
  adminConfigured?: boolean;
  failB2Delete?: boolean;
  failFinalizeDeletion?: boolean;
  slowCommitMs?: number;
  slowVerifyMs?: number;
  failVerifyOnce?: boolean;
  initialTimeMs?: number;
  enableScheduledSweepEndpoint?: boolean;
  scheduledSweepSecret?: string;
  uploadedObjects?: Map<
    string,
    { sizeBytes: number; contentType: string; headerBytes: Uint8Array; etag: string }
  >;
}) {
  const b2Objects =
    options?.uploadedObjects ||
    new Map<string, { sizeBytes: number; contentType: string; headerBytes: Uint8Array; etag: string }>();

  const meetingsOwned = new Map<string, { uid: string; title: string }>([
    [MEETING_A, { uid: USER_A, title: 'لقاء المراجعة السنوية' }],
  ]);
  const attachmentsOwned = new Map<string, MeetingAttachment>();
  const uploadIntents = new Map<string, UploadIntentRecord>();
  const guards = new Map<string, MeetingAttachmentGuardRecord>();

  let failDelete = options?.failB2Delete ?? false;
  let failFinalize = options?.failFinalizeDeletion ?? false;
  let slowCommitMs = options?.slowCommitMs ?? 0;
  let slowVerifyMs = options?.slowVerifyMs ?? 0;
  let failVerifyOnce = options?.failVerifyOnce ?? false;
  let adminConfigured = options?.adminConfigured ?? true;
  let clockMs = options?.initialTimeMs ?? Date.now();
  let beforeCreateIntentHook: (() => Promise<void>) | null = null;
  let beforeDeleteMeetingHook: (() => Promise<void>) | null = null;

  const ensureAdminConfigured = () => {
    if (!adminConfigured) {
      throw new Error(
        'FIREBASE_ADMIN_NOT_CONFIGURED: يتطلب توفير مفتاح حساب خدمة Firebase Admin.'
      );
    }
  };

  const guardKey = (uid: string, meetingId: string) => `${uid}:${meetingId}`;

  const updateGuard = (params: {
    uid: string;
    meetingId: string;
    addPendingId?: string;
    removePendingId?: string;
    addActiveId?: string;
    removeActiveId?: string;
    nowIso: string;
  }) => {
    const k = guardKey(params.uid, params.meetingId);
    const prev = guards.get(k);
    const active = new Set<string>(prev?.activeAttachmentIds || []);
    const pending = new Set<string>(prev?.pendingIntentIds || []);
    if (params.addPendingId) pending.add(params.addPendingId);
    if (params.removePendingId) pending.delete(params.removePendingId);
    if (params.addActiveId) active.add(params.addActiveId);
    if (params.removeActiveId) active.delete(params.removeActiveId);
    const activeAttachmentIds = Array.from(active);
    const pendingIntentIds = Array.from(pending);
    guards.set(k, {
      guardVersion: 1,
      meetingId: params.meetingId,
      userId: params.uid,
      activeAttachmentIds,
      pendingIntentIds,
      locked: activeAttachmentIds.length > 0 || pendingIntentIds.length > 0,
      updatedAt: params.nowIso,
    });
  };

  const mockStorage: B2StorageService = {
    getBucketName: () => 'Murafiq',
    isConfigured: () => options?.b2Configured ?? true,
    createPresignedUploadUrl: async ({ key }) => ({
      uploadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?X-Amz-Expires=${PRESIGNED_UPLOAD_TTL_SECONDS}`,
      expiresAt: new Date(clockMs + PRESIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
    }),
    createPresignedDownloadUrl: async ({ key, disposition }) => ({
      downloadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?disposition=${disposition}&X-Amz-Expires=${PRESIGNED_DOWNLOAD_TTL_SECONDS}&nonce=${Math.random()}`,
      expiresAt: new Date(clockMs + PRESIGNED_DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
    }),
    verifyUploadedObject: async ({ key, expectedContentType, expectedSizeBytes }) => {
      if (slowVerifyMs > 0) {
        await new Promise((r) => setTimeout(r, slowVerifyMs));
      }
      if (failVerifyOnce) {
        failVerifyOnce = false;
        throw new Error('Simulated transient B2 verification timeout');
      }
      const obj = b2Objects.get(key);
      if (!obj) {
        return { verified: false, sizeBytes: 0, reasonArabic: 'لم يتم العثور على الملف المرفوع في Backblaze B2.' };
      }
      if (obj.sizeBytes <= 0 || obj.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES || obj.sizeBytes !== expectedSizeBytes) {
        b2Objects.delete(key);
        return { verified: false, sizeBytes: obj.sizeBytes, reasonArabic: 'حجم الملف غير مطابق أو يتجاوز الحد الأقصى.' };
      }
      if (!verifyMagicBytes(obj.headerBytes, expectedContentType)) {
        b2Objects.delete(key);
        return {
          verified: false,
          sizeBytes: obj.sizeBytes,
          reasonArabic: 'المحتوى الثنائي للملف لا يطابق صيغته المعلنة.',
        };
      }
      return { verified: true, sizeBytes: obj.sizeBytes, contentType: obj.contentType, etag: obj.etag };
    },
    uploadObject: async ({ key, contentType, body }) => {
      b2Objects.set(key, {
        sizeBytes: body.byteLength,
        contentType,
        headerBytes: body.subarray(0, 16),
        etag: 'etag-relay',
      });
      return { etag: 'etag-relay' };
    },
    downloadObject: async (key) => {
      const obj = b2Objects.get(key);
      if (!obj) {
        throw new Error('Object not found');
      }
      return {
        bytes: obj.headerBytes,
        contentType: obj.contentType,
        contentLength: obj.headerBytes.byteLength,
      };
    },
    deleteObject: async (key) => {
      if (failDelete) {
        throw new Error('Simulated B2 delete failure');
      }
      b2Objects.delete(key);
    },
  };

  const metadataStore: AttachmentMetadataStore = {
    createUploadIntent: async (intent) => {
      ensureAdminConfigured();
      if (beforeCreateIntentHook) {
        await beforeCreateIntentHook();
      }
      const meeting = meetingsOwned.get(intent.meetingId);
      if (!meeting) {
        return { outcome: 'meeting_not_found' };
      }
      if (meeting.uid !== intent.userId) {
        return { outcome: 'forbidden' };
      }
      uploadIntents.set(`${intent.userId}:${intent.meetingId}:${intent.attachmentId}`, { ...intent });
      updateGuard({
        uid: intent.userId,
        meetingId: intent.meetingId,
        addPendingId: intent.attachmentId,
        nowIso: intent.updatedAt,
      });
      return { outcome: 'created' };
    },
    getUploadIntent: async ({ uid, meetingId, attachmentId }) => {
      ensureAdminConfigured();
      if (attachmentId === MEETING_GUARD_DOC_ID) return null;
      const item = uploadIntents.get(`${uid}:${meetingId}:${attachmentId}`);
      return item ? { ...item } : null;
    },
    getAttachmentRecord: async ({ uid, meetingId, attachmentId }) => {
      ensureAdminConfigured();
      const att = attachmentsOwned.get(`${uid}:${meetingId}:${attachmentId}`);
      if (!att) return { exists: false };
      return {
        exists: true,
        record: { ...att },
        fileName: att.fileName,
        contentType: att.contentType,
        storageKey: att.storageKey,
        deleteStatus: att.deleteStatus,
      };
    },
    claimIntentForCommit: async ({
      uid,
      meetingId,
      attachmentId,
      nowMs: tMs,
      nowIso,
      leaseDurationMs = UPLOAD_COMMIT_LEASE_MS,
      expectedFileName,
      expectedContentType,
      expectedSizeBytes,
    }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const existing = attachmentsOwned.get(key);
      if (existing) {
        return { outcome: 'already_committed', record: { ...existing } };
      }
      const intent = uploadIntents.get(key);
      if (!intent) return { outcome: 'intent_not_found' };
      if (intent.userId !== uid || intent.meetingId !== meetingId) {
        return { outcome: 'intent_mismatch' };
      }
      if (
        (expectedFileName !== undefined && intent.fileName !== expectedFileName) ||
        (expectedContentType !== undefined && intent.contentType !== expectedContentType) ||
        (expectedSizeBytes !== undefined && intent.sizeBytes !== expectedSizeBytes)
      ) {
        return { outcome: 'intent_mismatch' };
      }
      if (
        intent.status === 'abandoned' ||
        intent.status === 'deleted' ||
        intent.status === 'cleaning' ||
        intent.status === 'committed'
      ) {
        return { outcome: 'intent_abandoned' };
      }
      if (intent.status === 'committing' && intent.committingLeaseExpiresAt) {
        const leaseMs = new Date(intent.committingLeaseExpiresAt).getTime();
        if (Number.isFinite(leaseMs) && tMs < leaseMs) {
          return { outcome: 'commit_in_progress', intent: { ...intent } };
        }
      }
      const leaseIso = new Date(tMs + leaseDurationMs).toISOString();
      const claimed: UploadIntentRecord = {
        ...intent,
        status: 'committing',
        committingLeaseExpiresAt: leaseIso,
        updatedAt: nowIso,
      };
      uploadIntents.set(key, claimed);
      return { outcome: 'claimed', intent: { ...claimed } };
    },
    releaseIntentCommitLease: async ({ uid, meetingId, attachmentId, nowIso }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const intent = uploadIntents.get(key);
      if (intent && intent.status === 'committing') {
        uploadIntents.set(key, { ...intent, status: 'pending', updatedAt: nowIso });
      }
    },
    commitAttachmentFromIntent: async ({ uid, meetingId, attachmentId, attachment, nowIso }) => {
      ensureAdminConfigured();
      if (slowCommitMs > 0) {
        await new Promise((r) => setTimeout(r, slowCommitMs));
      }
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const existing = attachmentsOwned.get(key);
      if (existing) {
        return { outcome: 'already_committed', record: { ...existing } };
      }
      const intent = uploadIntents.get(key);
      if (!intent) return { outcome: 'intent_not_found' };
      if (intent.userId !== uid || intent.meetingId !== meetingId) {
        return { outcome: 'intent_mismatch' };
      }
      if (
        intent.status === 'abandoned' ||
        intent.status === 'deleted' ||
        intent.status === 'cleaning' ||
        intent.status === 'committed'
      ) {
        return { outcome: 'intent_abandoned' };
      }
      const record: MeetingAttachment = {
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
      };
      attachmentsOwned.set(key, record);
      uploadIntents.set(key, {
        ...intent,
        status: 'committed',
        committedAt: nowIso,
        updatedAt: nowIso,
      });
      updateGuard({
        uid,
        meetingId,
        removePendingId: attachmentId,
        addActiveId: attachmentId,
        nowIso,
      });
      return { outcome: 'committed', record: { ...record } };
    },
    markUploadIntentAbandonedIfPending: async ({
      uid,
      meetingId,
      attachmentId,
      nowIso,
      releaseGuard = false,
      cleanupReason = 'client_abandoned',
    }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const existing = attachmentsOwned.get(key);
      if (existing) {
        return { outcome: 'already_committed', record: { ...existing } };
      }
      const intent = uploadIntents.get(key);
      if (!intent) return { outcome: 'not_found' };
      if (intent.status === 'committed' || intent.status === 'deleted') {
        return { outcome: 'already_committed' };
      }
      if (intent.status === 'abandoned') {
        if (releaseGuard) {
          updateGuard({ uid, meetingId, removePendingId: attachmentId, nowIso });
        }
        return { outcome: 'already_abandoned' };
      }
      uploadIntents.set(key, {
        ...intent,
        status: 'abandoned',
        cleanupReason,
        updatedAt: nowIso,
      });
      if (releaseGuard) {
        updateGuard({ uid, meetingId, removePendingId: attachmentId, nowIso });
      }
      return { outcome: 'abandoned' };
    },
    releaseIntentFromGuard: async ({ uid, meetingId, attachmentId, nowIso }) => {
      ensureAdminConfigured();
      updateGuard({ uid, meetingId, removePendingId: attachmentId, nowIso });
    },
    updateAttachmentDeleteStatus: async ({
      uid,
      meetingId,
      attachmentId,
      deleteStatus,
      deleteErrorArabic,
      updatedAt,
    }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const att = attachmentsOwned.get(key);
      if (!att) throw new Error('Attachment not found');
      attachmentsOwned.set(key, {
        ...att,
        deleteStatus,
        deleteErrorArabic,
        updatedAt,
      });
    },
    finalizeAttachmentDeletion: async ({ uid, meetingId, attachmentId, nowIso }) => {
      ensureAdminConfigured();
      if (failFinalize) {
        throw new Error('Simulated Firestore deletion failure');
      }
      const key = `${uid}:${meetingId}:${attachmentId}`;
      attachmentsOwned.delete(key);
      const intent = uploadIntents.get(key);
      if (intent) {
        uploadIntents.set(key, { ...intent, status: 'deleted', updatedAt: nowIso });
      } else {
        uploadIntents.set(key, {
          attachmentId,
          userId: uid,
          meetingId,
          fileName: 'deleted',
          contentType: 'application/pdf',
          sizeBytes: 1,
          storageKey: buildAttachmentStorageKey({ uid, meetingId, attachmentId }),
          status: 'deleted',
          expiresAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      updateGuard({
        uid,
        meetingId,
        removeActiveId: attachmentId,
        removePendingId: attachmentId,
        nowIso,
      });
    },
    listPendingUploadIntentsForMeeting: async ({ uid, meetingId }) => {
      ensureAdminConfigured();
      const prefix = `${uid}:${meetingId}:`;
      const items: UploadIntentRecord[] = [];
      for (const [k, v] of uploadIntents.entries()) {
        if (k.startsWith(prefix) && (v.status === 'pending' || v.status === 'committing')) {
          items.push({ ...v });
        }
      }
      return items;
    },
    listPendingUploadIntentsGlobal: async ({ limit }) => {
      ensureAdminConfigured();
      const items: UploadIntentRecord[] = [];
      for (const v of uploadIntents.values()) {
        if (v.status === 'pending' || v.status === 'committing') {
          items.push({ ...v });
          if (items.length >= limit) break;
        }
      }
      return items;
    },
    claimIntentForExpirationCleanup: async ({
      uid,
      meetingId,
      attachmentId,
      nowMs: tMs,
      nowIso,
      safetyBufferMs = UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
    }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      if (attachmentsOwned.has(key)) {
        return { outcome: 'already_committed' };
      }
      const intent = uploadIntents.get(key);
      if (!intent) return { outcome: 'not_found' };
      if (intent.status !== 'pending' && intent.status !== 'committing') {
        return { outcome: 'not_eligible', intent: { ...intent } };
      }
      const eligible = isUploadIntentEligibleForExpirationCleanup({
        status: intent.status,
        expiresAt: intent.expiresAt,
        committingLeaseExpiresAt: intent.committingLeaseExpiresAt,
        nowMs: tMs,
        safetyBufferMs,
      });
      if (!eligible) {
        return { outcome: 'not_expired', intent: { ...intent } };
      }
      const next: UploadIntentRecord = {
        ...intent,
        status: 'cleaning',
        cleaningStartedAt: nowIso,
        updatedAt: nowIso,
      };
      uploadIntents.set(key, next);
      return { outcome: 'claimed', intent: { ...next } };
    },
    finalizeExpiredIntentCleanup: async ({ uid, meetingId, attachmentId, nowIso }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const intent = uploadIntents.get(key);
      if (intent) {
        uploadIntents.set(key, {
          ...intent,
          status: 'abandoned',
          cleanupReason: 'expired_uncommitted',
          cleanedAt: nowIso,
          updatedAt: nowIso,
        });
      }
      updateGuard({ uid, meetingId, removePendingId: attachmentId, nowIso });
    },
    releaseExpiredIntentCleaningOnFailure: async ({ uid, meetingId, attachmentId, nowIso }) => {
      ensureAdminConfigured();
      const key = `${uid}:${meetingId}:${attachmentId}`;
      const intent = uploadIntents.get(key);
      if (intent && intent.status === 'cleaning') {
        uploadIntents.set(key, { ...intent, status: 'pending', updatedAt: nowIso });
      }
    },
    checkMeetingDeletionEligibility: async ({ uid, meetingId }) => {
      ensureAdminConfigured();
      const prefix = `${uid}:${meetingId}:`;
      let attachmentsCount = 0;
      for (const k of attachmentsOwned.keys()) {
        if (k.startsWith(prefix)) attachmentsCount++;
      }
      let pendingIntentsCount = 0;
      for (const [k, v] of uploadIntents.entries()) {
        if (
          k.startsWith(prefix) &&
          (v.status === 'pending' || v.status === 'committing' || v.status === 'cleaning')
        ) {
          pendingIntentsCount++;
        }
      }
      const g = guards.get(guardKey(uid, meetingId));
      const effAtt = Math.max(attachmentsCount, g?.activeAttachmentIds.length || 0);
      const effPend = Math.max(pendingIntentsCount, g?.pendingIntentIds.length || 0);
      if (effAtt > 0) {
        return {
          canDelete: false,
          reason: 'HAS_ATTACHMENTS',
          attachmentsCount: effAtt,
          pendingIntentsCount: effPend,
        };
      }
      if (effPend > 0 || g?.locked) {
        return {
          canDelete: false,
          reason: 'HAS_PENDING_INTENTS',
          attachmentsCount: effAtt,
          pendingIntentsCount: Math.max(effPend, 1),
        };
      }
      return { canDelete: true, attachmentsCount: 0, pendingIntentsCount: 0 };
    },
    deleteMeetingIfNoAttachments: async ({ uid, meetingId }) => {
      ensureAdminConfigured();
      if (beforeDeleteMeetingHook) {
        await beforeDeleteMeetingHook();
      }
      const prefix = `${uid}:${meetingId}:`;
      for (const k of attachmentsOwned.keys()) {
        if (k.startsWith(prefix)) return { outcome: 'blocked_attachments' };
      }
      const g = guards.get(guardKey(uid, meetingId));
      if ((g?.activeAttachmentIds.length || 0) > 0) {
        return { outcome: 'blocked_attachments' };
      }
      for (const [k, v] of uploadIntents.entries()) {
        if (
          k.startsWith(prefix) &&
          (v.status === 'pending' || v.status === 'committing' || v.status === 'cleaning')
        ) {
          return { outcome: 'blocked_pending_intents' };
        }
      }
      if ((g?.pendingIntentIds.length || 0) > 0 || g?.locked) {
        return { outcome: 'blocked_pending_intents' };
      }
      if (!meetingsOwned.has(meetingId)) {
        return { outcome: 'not_found' };
      }
      meetingsOwned.delete(meetingId);
      guards.delete(guardKey(uid, meetingId));
      return { outcome: 'deleted' };
    },
  };

  const verifyBearerToken = async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('UNAUTHENTICATED: Missing Bearer token');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (token === 'token-alice') return { uid: USER_A, email: 'alice@example.com', idToken: token };
    if (token === 'token-bob') return { uid: USER_B, email: 'bob@example.com', idToken: token };
    throw new Error('UNAUTHENTICATED: Invalid token');
  };

  const verifyMeetingOwnership = async ({ uid, meetingId }: { uid: string; meetingId: string }) => {
    const meeting = meetingsOwned.get(meetingId);
    return Boolean(meeting && meeting.uid === uid);
  };

  const verifyAttachmentOwnership = async ({
    uid,
    meetingId,
    attachmentId,
  }: {
    uid: string;
    meetingId: string;
    attachmentId: string;
  }) => {
    const att = attachmentsOwned.get(`${uid}:${meetingId}:${attachmentId}`);
    if (!att) return { exists: false };
    return {
      exists: true,
      record: { ...att },
      fileName: att.fileName,
      contentType: att.contentType,
      storageKey: att.storageKey,
      deleteStatus: att.deleteStatus,
    };
  };

  const router = createAttachmentsRouter({
    storageService: mockStorage,
    metadataStore,
    verifyBearerToken,
    verifyMeetingOwnership,
    verifyAttachmentOwnership,
    now: () => clockMs,
    enableScheduledSweepEndpoint: options?.enableScheduledSweepEndpoint,
    scheduledSweepSecret: options?.scheduledSweepSecret,
  });

  // Second router instance sharing the EXACT SAME metadataStore & storage (simulates Cloud Run multi-instance)
  const secondaryRouter = createAttachmentsRouter({
    storageService: mockStorage,
    metadataStore,
    verifyBearerToken,
    verifyMeetingOwnership,
    verifyAttachmentOwnership,
    now: () => clockMs,
    enableScheduledSweepEndpoint: options?.enableScheduledSweepEndpoint,
    scheduledSweepSecret: options?.scheduledSweepSecret,
  });

  const meetingsRouter = createMeetingsRouter({
    verifyBearerToken,
    verifyMeetingOwnership,
    metadataStore,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/attachments', router);
  app.use('/api/instance2/attachments', secondaryRouter);
  app.use('/api/meetings', meetingsRouter);

  return {
    app,
    b2Objects,
    meetingsOwned,
    attachmentsOwned,
    uploadIntents,
    guards,
    metadataStore,
    mockStorage,
    setFailDelete: (v: boolean) => {
      failDelete = v;
    },
    setFailFinalize: (v: boolean) => {
      failFinalize = v;
    },
    setSlowCommitMs: (ms: number) => {
      slowCommitMs = ms;
    },
    setSlowVerifyMs: (ms: number) => {
      slowVerifyMs = ms;
    },
    setFailVerifyOnce: (v: boolean) => {
      failVerifyOnce = v;
    },
    setAdminConfigured: (v: boolean) => {
      adminConfigured = v;
    },
    advanceTimeMs: (delta: number) => {
      clockMs += delta;
    },
    getTimeMs: () => clockMs,
    setBeforeCreateIntentHook: (fn: (() => Promise<void>) | null) => {
      beforeCreateIntentHook = fn;
    },
    setBeforeDeleteMeetingHook: (fn: (() => Promise<void>) | null) => {
      beforeDeleteMeetingHook = fn;
    },
  };
}

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('Task 004-A & Fix-01 Security, Integrity & Reliability Suite (Backblaze B2 Attachments)', async (t) => {
  await t.test('1. Unauthenticated upload, download, delete, and cleanup requests are rejected (401)', async () => {
    const { app } = createMockTestServer();
    await withServer(app, async (baseUrl) => {
      const endpoints = [
        '/api/attachments/presign-upload',
        '/api/attachments/complete-upload',
        '/api/attachments/presign-download',
        '/api/attachments/delete',
        '/api/attachments/cleanup-uncommitted',
      ];
      for (const ep of endpoints) {
        const res = await fetch(`${baseUrl}${ep}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId: MEETING_A, attachmentId: 'att-1' }),
        });
        assert.equal(res.status, 401, `Endpoint ${ep} must reject unauthenticated requests with 401`);
      }
    });
  });

  await t.test('2. Cross-account access (User B accessing User A meeting/attachment) is rejected (403/404)', async () => {
    const { app, b2Objects, attachmentsOwned } = createMockTestServer();
    const attId = 'att-alice-secret';
    const key = buildAttachmentStorageKey({
      uid: USER_A,
      meetingId: MEETING_A,
      attachmentId: attId,
    });
    b2Objects.set(key, {
      sizeBytes: 1024,
      contentType: 'image/jpeg',
      headerBytes: JPEG_HEADER,
      etag: 'etag-1',
    });
    attachmentsOwned.set(`${USER_A}:${MEETING_A}:${attId}`, {
      id: attId,
      userId: USER_A,
      meetingId: MEETING_A,
      fileName: 'contract.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      storageKey: key,
      storageProvider: 'backblaze_b2',
      uploadStatus: 'completed',
      deleteStatus: 'active',
      createdAt: new Date().toISOString(),
    });

    await withServer(app, async (baseUrl) => {
      const uploadRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bob',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'hijack.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      });
      assert.equal(uploadRes.status, 403);

      const downloadRes = await fetch(`${baseUrl}/api/attachments/presign-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bob',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: attId,
        }),
      });
      assert.equal(downloadRes.status, 403);

      const deleteRes = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bob',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: attId,
        }),
      });
      assert.equal(deleteRes.status, 403);
      assert.equal(b2Objects.has(key), true, 'User B delete attempt must not delete User A B2 object');
    });
  });

  await t.test('3. Client-supplied storageKey / uid / userId / status spoofing attempts are rejected (403)', async () => {
    const { app } = createMockTestServer();
    await withServer(app, async (baseUrl) => {
      const spoofedUidRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          uid: USER_B,
          meetingId: MEETING_A,
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
        }),
      });
      assert.equal(spoofedUidRes.status, 403);

      const spoofedKeyRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          storageKey: `users/${USER_B}/meetings/other/attachments/evil`,
          meetingId: MEETING_A,
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
        }),
      });
      assert.equal(spoofedKeyRes.status, 403);

      const spoofedStatusRes = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: 'att_fake',
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          uploadStatus: 'completed',
        }),
      });
      assert.equal(spoofedStatusRes.status, 403);
    });
  });

  await t.test('4. Disallowed file types (.exe, .html, .js, .svg) and disguised magic-bytes files are rejected', async () => {
    const dangerousCases = [
      { fileName: 'malware.exe', contentType: 'application/x-msdownload', sizeBytes: 500 },
      { fileName: 'phish.html', contentType: 'text/html', sizeBytes: 500 },
      { fileName: 'payload.js', contentType: 'application/javascript', sizeBytes: 500 },
      { fileName: 'xss.svg', contentType: 'image/svg+xml', sizeBytes: 500 },
      { fileName: 'fake.jpg', contentType: 'text/html', sizeBytes: 500 },
      { fileName: 'shell.jpg.exe', contentType: 'image/jpeg', sizeBytes: 500 },
      { fileName: '../../etc/passwd.pdf', contentType: 'application/pdf', sizeBytes: 500 },
    ];

    for (const c of dangerousCases) {
      const result = validateAttachmentFileRequest(c);
      assert.equal(result.valid, false, `Expected ${c.fileName} (${c.contentType}) to fail`);
    }

    assert.equal(verifyMagicBytes(JPEG_HEADER, 'image/jpeg'), true);
    assert.equal(verifyMagicBytes(PNG_HEADER, 'image/png'), true);
    assert.equal(verifyMagicBytes(WEBP_HEADER, 'image/webp'), true);
    assert.equal(verifyMagicBytes(PDF_HEADER, 'application/pdf'), true);
    assert.equal(verifyMagicBytes(HTML_DISGUISED, 'image/jpeg'), false);
    assert.equal(verifyMagicBytes(EXE_DISGUISED, 'application/pdf'), false);

    const { app, b2Objects, attachmentsOwned } = createMockTestServer();
    await withServer(app, async (baseUrl) => {
      const presignRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'sneaky.jpg',
          contentType: 'image/jpeg',
          sizeBytes: HTML_DISGUISED.length,
        }),
      });
      assert.equal(presignRes.status, 200);
      const presignData = (await presignRes.json()) as any;
      assert.equal(presignData.storageKey.startsWith(`users/${USER_A}/meetings/${MEETING_A}/attachments/`), true);

      b2Objects.set(presignData.storageKey, {
        sizeBytes: HTML_DISGUISED.length,
        contentType: 'image/jpeg',
        headerBytes: HTML_DISGUISED,
        etag: 'etag-fake',
      });

      const completeRes = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: presignData.attachmentId,
          fileName: 'sneaky.jpg',
          contentType: 'image/jpeg',
          sizeBytes: HTML_DISGUISED.length,
        }),
      });
      assert.equal(completeRes.status, 422);
      assert.equal(b2Objects.has(presignData.storageKey), false, 'Invalid B2 file must be deleted immediately');
      assert.equal(attachmentsOwned.size, 0, 'Disguised file must never be committed to Firestore');
    });
  });

  await t.test('5. Files exceeding 10 MB are rejected on both policy validator and API', async () => {
    const oversized = validateAttachmentFileRequest({
      fileName: 'huge.pdf',
      contentType: 'application/pdf',
      sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
    });
    assert.equal(oversized.valid, false);
    assert.equal(oversized.errorCode, 'FILE_TOO_LARGE');

    const { app } = createMockTestServer();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'huge.pdf',
          contentType: 'application/pdf',
          sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1024,
        }),
      });
      assert.equal(res.status, 400);
    });
  });

  await t.test('6. Presigned URLs are strictly short-lived and expiration detection triggers refresh', () => {
    assert.ok(PRESIGNED_UPLOAD_TTL_SECONDS <= 300, 'Upload TTL must be short-lived');
    assert.ok(PRESIGNED_DOWNLOAD_TTL_SECONDS <= 300, 'Download TTL must be short-lived');

    const pastIso = new Date(Date.now() - 10_000).toISOString();
    const nearExpiryIso = new Date(Date.now() + 2_000).toISOString();
    const validIso = new Date(Date.now() + 120_000).toISOString();

    assert.equal(isPresignedUrlExpired(pastIso), true);
    assert.equal(isPresignedUrlExpired(nearExpiryIso, Date.now(), 5000), true);
    assert.equal(isPresignedUrlExpired(validIso, Date.now(), 5000), false);
  });

  await t.test('7. Zero Backblaze secret identifiers or S3 SDK credentials exist in client frontend code', () => {
    const forbiddenClientTokens = [
      'B2_APPLICATION_KEY',
      'B2_APPLICATION_KEY_ID',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      '@aws-sdk/client-s3',
      '@aws-sdk/s3-request-presigner',
    ];
    const clientDirs = ['src/components', 'src/services', 'src/utils', 'src/data'];

    const scanDir = (relDir: string) => {
      const fullDir = path.resolve(process.cwd(), relDir);
      if (!fs.existsSync(fullDir)) return;
      for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
        const entryPath = path.join(fullDir, entry.name);
        if (entry.isDirectory()) {
          scanDir(path.relative(process.cwd(), entryPath));
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(entryPath, 'utf8');
          for (const token of forbiddenClientTokens) {
            assert.equal(
              content.includes(token),
              false,
              `Client file ${entryPath} must NOT reference ${token}`
            );
          }
        }
      }
    };

    clientDirs.forEach(scanDir);
  });

  await t.test('8. Offline blocking, upload abort cleanup, and recoverable B2 delete failure safety', async () => {
    const fakeFile = {
      name: 'notes.jpg',
      type: 'image/jpeg',
      size: 1024,
    } as File;

    // 8a. Offline upload blocked before hitting network
    await assert.rejects(
      () =>
        uploadMeetingAttachmentWithDeps(
          { meetingId: MEETING_A, file: fakeFile },
          {
            isOnline: () => false,
            getIdToken: async () => 'token-alice',
            fetchApi: fetch,
            readHeaderBytes: async () => JPEG_HEADER,
            putFileToPresignedUrl: async () => ({}),
          }
        ),
      (err: any) => err.code === 'OFFLINE_BLOCKED'
    );

    // 8b. Direct PUT abort/failure before complete-upload cleans up uncommitted B2 file & marks intent abandoned
    const cleanupCalls: Array<{ meetingId: string; attachmentId: string }> = [];
    const { app, b2Objects, attachmentsOwned } = createMockTestServer();

    await withServer(app, async (baseUrl) => {
      await assert.rejects(
        () =>
          uploadMeetingAttachmentWithDeps(
            { meetingId: MEETING_A, file: fakeFile },
            {
              isOnline: () => true,
              getIdToken: async () => 'token-alice',
              fetchApi: (input, init) => {
                const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
                if (typeof input === 'string' && input.endsWith('/cleanup-uncommitted') && init?.body) {
                  cleanupCalls.push(JSON.parse(String(init.body)));
                }
                return fetch(url, init);
              },
              readHeaderBytes: async () => JPEG_HEADER,
              putFileToPresignedUrl: async ({ uploadUrl }) => {
                const pathname = new URL(uploadUrl).pathname;
                const storageKey = pathname.replace(/^\/Murafiq\//, '');
                b2Objects.set(storageKey, {
                  sizeBytes: fakeFile.size,
                  contentType: 'image/jpeg',
                  headerBytes: JPEG_HEADER,
                  etag: 'etag-partial',
                });
                throw new AttachmentClientError('B2_UPLOAD_FAILED', 'Simulated upload failure');
              },
            }
          ),
        (err: any) => err.code === 'B2_UPLOAD_FAILED'
      );

      assert.equal(cleanupCalls.length, 1, 'Cleanup endpoint must be called after failed PUT before commit');
      assert.equal(b2Objects.size, 0, 'Uncommitted B2 object must be deleted after PUT failure');
      assert.equal(attachmentsOwned.size, 0, 'Uncommitted attachment must not appear in Firestore');
    });

    // 8c. B2 delete failure keeps Firestore metadata in recoverable delete_failed state; retry succeeds cleanly
    const {
      app: deleteFailApp,
      setFailDelete,
      attachmentsOwned: delOwned,
      b2Objects: objs2,
    } = createMockTestServer();
    const attId = 'att-del-test';
    const key = buildAttachmentStorageKey({
      uid: USER_A,
      meetingId: MEETING_A,
      attachmentId: attId,
    });
    objs2.set(key, {
      sizeBytes: 512,
      contentType: 'application/pdf',
      headerBytes: PDF_HEADER,
      etag: 'etag-pdf',
    });
    delOwned.set(`${USER_A}:${MEETING_A}:${attId}`, {
      id: attId,
      userId: USER_A,
      meetingId: MEETING_A,
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
      storageKey: key,
      storageProvider: 'backblaze_b2',
      uploadStatus: 'completed',
      deleteStatus: 'active',
      createdAt: new Date().toISOString(),
    });
    setFailDelete(true);

    await withServer(deleteFailApp, async (baseUrl) => {
      await assert.rejects(
        () =>
          deleteMeetingAttachmentWithDeps(
            { meetingId: MEETING_A, attachmentId: attId },
            {
              isOnline: () => true,
              getUid: () => USER_A,
              getIdToken: async () => 'token-alice',
              fetchApi: (input, init) => {
                const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
                return fetch(url, init);
              },
            }
          ),
        (err: any) => err.code === 'B2_DELETE_FAILED'
      );

      const saved = delOwned.get(`${USER_A}:${MEETING_A}:${attId}`);
      assert.ok(saved, 'Firestore attachment record must remain when B2 delete fails');
      assert.equal(saved.deleteStatus, 'delete_failed');

      // Recover and retry delete
      setFailDelete(false);
      await deleteMeetingAttachmentWithDeps(
        { meetingId: MEETING_A, attachmentId: attId },
        {
          isOnline: () => true,
          getUid: () => USER_A,
          getIdToken: async () => 'token-alice',
          fetchApi: (input, init) => {
            const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
            return fetch(url, init);
          },
        }
      );
      assert.equal(delOwned.has(`${USER_A}:${MEETING_A}:${attId}`), false);
      assert.equal(objs2.has(key), false);
    });
  });

  await t.test('9. Host ADC auth/internal-error falls back safely without masking genuine expired/revoked tokens', async () => {
    const decodedFallback = await verifyFirebaseTokenWithFallback({
      idToken: 'valid-jwt',
      preferRevocationCheck: true,
      verifyIdTokenFn: async (_token, checkRevoked) => {
        if (checkRevoked) {
          const err: any = new Error('identitytoolkit.googleapis.com disabled on project 537419615721');
          err.code = 'auth/internal-error';
          throw err;
        }
        return { uid: USER_A, email: 'alice@example.com', email_verified: true };
      },
    });
    assert.equal(decodedFallback.uid, USER_A);

    let calledWithRevokedFlag: boolean | null = null;
    const decodedDirect = await verifyFirebaseTokenWithFallback({
      idToken: 'valid-jwt',
      preferRevocationCheck: false,
      verifyIdTokenFn: async (_token, checkRevoked) => {
        calledWithRevokedFlag = checkRevoked;
        return { uid: USER_A, email_verified: true };
      },
    });
    assert.equal(calledWithRevokedFlag, false);
    assert.equal(decodedDirect.uid, USER_A);

    for (const tokenCode of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error']) {
      let fallbackCalled = false;
      await assert.rejects(
        () =>
          verifyFirebaseTokenWithFallback({
            idToken: 'bad-jwt',
            preferRevocationCheck: true,
            verifyIdTokenFn: async (_token, checkRevoked) => {
              if (!checkRevoked) fallbackCalled = true;
              const err: any = new Error(`Token error: ${tokenCode}`);
              err.code = tokenCode;
              throw err;
            },
          }),
        (err: any) => err.code === tokenCode
      );
      assert.equal(fallbackCalled, false, `${tokenCode} must fail immediately without fallback`);
    }

    const outageRouter = createAttachmentsRouter({
      verifyBearerToken: async () => {
        const err: any = new Error('Temporary verifier outage');
        err.code = 'auth/internal-error';
        throw err;
      },
    });
    const outageApp = express();
    outageApp.use(express.json());
    outageApp.use('/api/attachments', outageRouter);

    await withServer(outageApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer any-token',
        },
        body: JSON.stringify({ meetingId: MEETING_A }),
      });
      assert.equal(res.status, 500);
      const data = (await res.json()) as any;
      assert.equal(data.error, 'AUTH_VERIFICATION_UNAVAILABLE');
    });
  });

  await t.test('10. Same-origin relay upload and download fallbacks enforce auth, intent, magic bytes, and security headers', async () => {
    const { app, b2Objects, attachmentsOwned } = createMockTestServer();

    await withServer(app, async (baseUrl) => {
      // 10a. Unauthenticated relay upload & download rejected (401)
      const unauthRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': 'att_unauth',
          'x-file-name': 'photo.jpg',
        },
        body: JPEG_HEADER,
      });
      assert.equal(unauthRelayUp.status, 401);

      const unauthRelayDown = await fetch(`${baseUrl}/api/attachments/relay-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: 'att_unauth' }),
      });
      assert.equal(unauthRelayDown.status, 401);

      // 10b. Cross-user Bob relay upload rejected (403)
      const bobRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-bob',
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': 'att_bob',
          'x-file-name': 'photo.jpg',
        },
        body: JPEG_HEADER,
      });
      assert.equal(bobRelayUp.status, 403);

      // 10c. Spoofing x-storage-key rejected (403)
      const spoofRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-alice',
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': 'att_spoof',
          'x-file-name': 'photo.jpg',
          'x-storage-key': `users/${USER_B}/meetings/${MEETING_A}/attachments/evil`,
        },
        body: JPEG_HEADER,
      });
      assert.equal(spoofRelayUp.status, 403);

      // 10d. Relay upload without pending UploadIntent rejected (404), and disguised HTML with intent rejected (422)
      const noIntentRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-alice',
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': 'att_missing_intent',
          'x-file-name': 'photo.jpg',
        },
        body: JPEG_HEADER,
      });
      assert.equal(noIntentRelayUp.status, 404);

      const presignSneaky = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'sneaky.jpg',
          contentType: 'image/jpeg',
          sizeBytes: HTML_DISGUISED.byteLength,
        }),
      });
      const sneakyIntent = (await presignSneaky.json()) as any;
      const disguisedRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-alice',
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': sneakyIntent.attachmentId,
          'x-file-name': 'sneaky.jpg',
        },
        body: HTML_DISGUISED,
      });
      assert.equal(disguisedRelayUp.status, 422);
      assert.equal(b2Objects.size, 0);

      // 10e. Automatic client fallback from CORS NETWORK_ERROR on presigned PUT to same-origin /relay-upload
      let relayUsed = false;
      const fakeJpegFile = {
        name: 'ملاحظات_اللقاء.jpg',
        type: 'image/jpeg',
        size: JPEG_HEADER.byteLength,
      } as File;

      const uploaded = await uploadMeetingAttachmentWithDeps(
        { meetingId: MEETING_A, file: fakeJpegFile },
        {
          isOnline: () => true,
          getIdToken: async () => 'token-alice',
          fetchApi: (input, init) => {
            const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
            return fetch(url, init);
          },
          readHeaderBytes: async () => JPEG_HEADER,
          putFileToPresignedUrl: async () => {
            throw new AttachmentClientError('NETWORK_ERROR', 'Simulated CORS failure');
          },
          putFileViaRelay: async ({ meetingId, attachmentId, fileName, contentType, idToken }) => {
            relayUsed = true;
            const relayRes = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${idToken}`,
                'Content-Type': contentType,
                'x-meeting-id': meetingId,
                'x-attachment-id': attachmentId,
                'x-file-name': encodeURIComponent(fileName),
              },
              body: JPEG_HEADER,
            });
            assert.equal(relayRes.status, 200);
            return (await relayRes.json()) as { etag?: string };
          },
        }
      );

      assert.equal(relayUsed, true, 'Client must fall back automatically to same-origin relay when CORS blocks direct PUT');
      assert.equal(attachmentsOwned.has(`${USER_A}:${MEETING_A}:${uploaded.id}`), true);
      assert.equal(uploaded.storageProvider, 'backblaze_b2');
      assert.equal(uploaded.uploadStatus, 'completed');
      assert.equal(uploaded.deleteStatus, 'active');

      // 10f. Authenticated /relay-download serves attachment with strict security headers and blocks User B
      const bobRelayDown = await fetch(`${baseUrl}/api/attachments/relay-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bob',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: uploaded.id,
          disposition: 'inline',
        }),
      });
      assert.equal(bobRelayDown.status, 403);

      const aliceRelayDown = await fetch(`${baseUrl}/api/attachments/relay-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: uploaded.id,
          disposition: 'inline',
        }),
      });
      assert.equal(aliceRelayDown.status, 200);
      assert.equal(aliceRelayDown.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(aliceRelayDown.headers.get('cache-control')?.includes('no-store'));
      assert.equal(aliceRelayDown.headers.get('content-type'), 'image/jpeg');
      const returnedBytes = new Uint8Array(await aliceRelayDown.arrayBuffer());
      assert.deepEqual(returnedBytes, JPEG_HEADER);
    });
  });

  await t.test('11. Server-authoritative complete-upload commit & idempotent retry prevent duplicates or orphan intents', async () => {
    const { app, b2Objects, attachmentsOwned, uploadIntents } = createMockTestServer();

    await withServer(app, async (baseUrl) => {
      // Calling complete-upload without a server UploadIntent must fail (404)
      const noIntentRes = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: 'att_untracked_01',
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(noIntentRes.status, 404);

      // Issue intent, upload valid PDF, commit twice -> idempotent, zero duplicate attachments
      const presignRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'agreement.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(presignRes.status, 200);
      const presign = (await presignRes.json()) as any;
      assert.equal(uploadIntents.get(`${USER_A}:${MEETING_A}:${presign.attachmentId}`)?.status, 'pending');

      b2Objects.set(presign.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'etag-pdf-1',
      });

      const commitBody = JSON.stringify({
        meetingId: MEETING_A,
        attachmentId: presign.attachmentId,
        fileName: 'agreement.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF_HEADER.byteLength,
      });

      const c1 = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: commitBody,
      });
      assert.equal(c1.status, 200);
      const rec1 = (await c1.json()) as MeetingAttachment;

      const c2 = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: commitBody,
      });
      assert.equal(c2.status, 200);
      const rec2 = (await c2.json()) as MeetingAttachment;

      assert.equal(rec1.id, rec2.id);
      assert.equal(rec1.createdAt, rec2.createdAt);
      assert.equal(attachmentsOwned.size, 1);
      assert.equal(uploadIntents.get(`${USER_A}:${MEETING_A}:${presign.attachmentId}`)?.status, 'committed');
    });
  });

  await t.test('12. cleanup-uncommitted deletes uncommitted B2 objects, refuses committed files (409), and survives concurrent/late races', async () => {
    const { app, b2Objects, attachmentsOwned, uploadIntents, setSlowCommitMs } = createMockTestServer();

    await withServer(app, async (baseUrl) => {
      // 12a. Uncommitted cleanup removes B2 object & blocks late complete-upload
      const p1 = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'temp.jpg',
          contentType: 'image/jpeg',
          sizeBytes: JPEG_HEADER.byteLength,
        }),
      });
      const d1 = (await p1.json()) as any;
      b2Objects.set(d1.storageKey, {
        sizeBytes: JPEG_HEADER.byteLength,
        contentType: 'image/jpeg',
        headerBytes: JPEG_HEADER,
        etag: 'e1',
      });

      const clean1 = await fetch(`${baseUrl}/api/attachments/cleanup-uncommitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: d1.attachmentId }),
      });
      assert.equal(clean1.status, 200);
      assert.equal(b2Objects.has(d1.storageKey), false);
      assert.equal(uploadIntents.get(`${USER_A}:${MEETING_A}:${d1.attachmentId}`)?.status, 'abandoned');

      const lateCommit = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: d1.attachmentId,
          fileName: 'temp.jpg',
          contentType: 'image/jpeg',
          sizeBytes: JPEG_HEADER.byteLength,
        }),
      });
      assert.equal(lateCommit.status, 409);

      // 12b. Concurrent complete-upload + late/overlapping cleanup-uncommitted NEVER deletes committed file
      const p2 = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'final.jpg',
          contentType: 'image/jpeg',
          sizeBytes: JPEG_HEADER.byteLength,
        }),
      });
      const d2 = (await p2.json()) as any;
      b2Objects.set(d2.storageKey, {
        sizeBytes: JPEG_HEADER.byteLength,
        contentType: 'image/jpeg',
        headerBytes: JPEG_HEADER,
        etag: 'e2',
      });

      setSlowCommitMs(40);
      const completePromise = fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: d2.attachmentId,
          fileName: 'final.jpg',
          contentType: 'image/jpeg',
          sizeBytes: JPEG_HEADER.byteLength,
        }),
      });
      await new Promise((r) => setTimeout(r, 10));
      const cleanRes = await fetch(`${baseUrl}/api/attachments/cleanup-uncommitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: d2.attachmentId }),
      });
      const compRes = await completePromise;
      setSlowCommitMs(0);

      assert.equal(compRes.status, 200);
      assert.equal(cleanRes.status, 409);
      const cleanJson = (await cleanRes.json()) as any;
      assert.equal(cleanJson.error, 'ATTACHMENT_ALREADY_COMMITTED');
      assert.equal(b2Objects.has(d2.storageKey), true, 'Committed B2 object MUST NOT be deleted by cleanup');
      assert.equal(attachmentsOwned.has(`${USER_A}:${MEETING_A}:${d2.attachmentId}`), true);
    });
  });

  await t.test('13. Lost complete-upload response triggers safe idempotent retry and NEVER deletes via cleanup-uncommitted', async () => {
    const { app, b2Objects, attachmentsOwned } = createMockTestServer();
    const fakeJpeg = {
      name: 'receipt.jpg',
      type: 'image/jpeg',
      size: JPEG_HEADER.byteLength,
    } as File;

    let completeCallCount = 0;
    let cleanupCalled = false;

    await withServer(app, async (baseUrl) => {
      const result = await uploadMeetingAttachmentWithDeps(
        { meetingId: MEETING_A, file: fakeJpeg },
        {
          isOnline: () => true,
          getIdToken: async () => 'token-alice',
          readHeaderBytes: async () => JPEG_HEADER,
          putFileToPresignedUrl: async ({ uploadUrl }) => {
            const storageKey = new URL(uploadUrl).pathname.replace(/^\/Murafiq\//, '');
            b2Objects.set(storageKey, {
              sizeBytes: JPEG_HEADER.byteLength,
              contentType: 'image/jpeg',
              headerBytes: JPEG_HEADER,
              etag: 'etag-lost-ack',
            });
            return { etag: 'etag-lost-ack' };
          },
          fetchApi: async (input, init) => {
            const urlStr = typeof input === 'string' ? input : String(input);
            if (urlStr.endsWith('/cleanup-uncommitted')) {
              cleanupCalled = true;
            }
            const realRes = await fetch(`${baseUrl}${urlStr}`, init);
            if (urlStr.endsWith('/complete-upload')) {
              completeCallCount++;
              if (completeCallCount === 1) {
                // Simulate network/proxy drop AFTER server committed in Firestore!
                throw new TypeError('Failed to fetch after commit');
              }
            }
            return realRes;
          },
        }
      );

      assert.equal(completeCallCount, 2, 'Client must retry complete-upload idempotently');
      assert.equal(cleanupCalled, false, 'Client MUST NEVER call cleanup-uncommitted when commit outcome is uncertain');
      assert.equal(attachmentsOwned.size, 1);
      assert.equal(b2Objects.has(result.storageKey), true);
    });
  });

  await t.test('14. Recoverable deletion handles Firestore failure after B2 delete & idempotent duplicate delete', async () => {
    const { app, b2Objects, attachmentsOwned, setFailFinalize } = createMockTestServer();
    const attId = 'att-rec-del';
    const key = buildAttachmentStorageKey({
      uid: USER_A,
      meetingId: MEETING_A,
      attachmentId: attId,
    });
    b2Objects.set(key, {
      sizeBytes: 512,
      contentType: 'application/pdf',
      headerBytes: PDF_HEADER,
      etag: 'etag-rec',
    });
    attachmentsOwned.set(`${USER_A}:${MEETING_A}:${attId}`, {
      id: attId,
      userId: USER_A,
      meetingId: MEETING_A,
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
      storageKey: key,
      storageProvider: 'backblaze_b2',
      uploadStatus: 'completed',
      deleteStatus: 'active',
      createdAt: new Date().toISOString(),
    });
    setFailFinalize(true);

    await withServer(app, async (baseUrl) => {
      // Pass 1: B2 succeeds, Firestore finalization fails -> transitional state b2_deleted (502)
      const res1 = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: attId }),
      });
      assert.equal(res1.status, 502);
      const body1 = (await res1.json()) as any;
      assert.equal(body1.error, 'FIRESTORE_DELETE_INCOMPLETE');
      assert.equal(body1.deleteStatus, 'b2_deleted');
      assert.equal(b2Objects.has(key), false, 'B2 object was deleted in pass 1');
      assert.equal(attachmentsOwned.get(`${USER_A}:${MEETING_A}:${attId}`)?.deleteStatus, 'b2_deleted');

      // Downloading a b2_deleted attachment returns 410 Gone cleanly
      const dlWhileDeleting = await fetch(`${baseUrl}/api/attachments/presign-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: attId }),
      });
      assert.equal(dlWhileDeleting.status, 410);

      // Pass 2: Firestore recovers -> retry completes cleanup cleanly even though B2 object is already gone
      setFailFinalize(false);
      const res2 = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: attId }),
      });
      assert.equal(res2.status, 200);
      assert.equal(attachmentsOwned.has(`${USER_A}:${MEETING_A}:${attId}`), false);

      // Pass 3: Duplicate delete request returns idempotent 200 alreadyDeleted=true
      const res3 = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: attId }),
      });
      assert.equal(res3.status, 200);
      const body3 = (await res3.json()) as any;
      assert.equal(body3.alreadyDeleted, true);
    });
  });

  await t.test('15. Download URL memory cache isolates by uid, clears on logout/account switch, and expires cleanly', async () => {
    clearAttachmentDownloadCache();
    let currentUid: string | null = USER_A;
    let currentTime = 1_700_000_000_000;
    let backendFetchCount = 0;

    const fakeFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      backendFetchCount++;
      return new Response(
        JSON.stringify({
          downloadUrl: `https://b2.example/${currentUid}/item-${backendFetchCount}`,
          expiresAt: new Date(currentTime + 180_000).toISOString(),
          expiresInSeconds: 180,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const deps = {
      isOnline: () => true,
      getUid: () => {
        if (!currentUid) throw new Error('Not logged in');
        return currentUid;
      },
      getIdToken: async () => `token-${currentUid}`,
      fetchApi: fakeFetch as typeof fetch,
      nowMs: () => currentTime,
    };

    // First call for Alice hits backend and caches under Alice's UID
    const a1 = await getFreshPresignedDownloadUrlWithDeps(
      { meetingId: MEETING_A, attachmentId: 'att-cache-1', disposition: 'inline' },
      deps
    );
    assert.equal(backendFetchCount, 1);
    assert.match(a1.downloadUrl, new RegExp(USER_A));

    // Second call for Alice within TTL uses cache
    const a2 = await getFreshPresignedDownloadUrlWithDeps(
      { meetingId: MEETING_A, attachmentId: 'att-cache-1', disposition: 'inline' },
      deps
    );
    assert.equal(backendFetchCount, 1);
    assert.equal(a2.downloadUrl, a1.downloadUrl);

    // Account switch Alice -> Bob MUST NOT return Alice's cached URL
    currentUid = USER_B;
    const b1 = await getFreshPresignedDownloadUrlWithDeps(
      { meetingId: MEETING_A, attachmentId: 'att-cache-1', disposition: 'inline' },
      deps
    );
    assert.equal(backendFetchCount, 2);
    assert.match(b1.downloadUrl, new RegExp(USER_B));
    assert.notEqual(b1.downloadUrl, a1.downloadUrl);

    // Advancing time past expiry triggers fresh presign fetch
    currentTime += 175_000;
    const b2 = await getFreshPresignedDownloadUrlWithDeps(
      { meetingId: MEETING_A, attachmentId: 'att-cache-1', disposition: 'inline' },
      deps
    );
    assert.equal(backendFetchCount, 3);
    assert.notEqual(b2.downloadUrl, b1.downloadUrl);

    // Logout clears cache completely
    clearAttachmentDownloadCache();
    const snapshot = getDownloadCacheSnapshotForTesting();
    assert.equal(snapshot.size, 0);
    assert.equal(snapshot.activeUid, null);
  });

  await t.test('16. Named Firestore DB enforcement & clear 503 errors when B2 or Firebase Admin config is missing', async () => {
    const serverCfg = getFirebaseServerConfig();
    assert.equal(
      serverCfg.firestoreDatabaseId,
      'ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475'
    );
    assert.notEqual(serverCfg.firestoreDatabaseId, '(default)');

    const clientFirebaseSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/firebase.ts'),
      'utf8'
    );
    assert.equal(clientFirebaseSource.includes('firebaseConfig.firestoreDatabaseId'), true);

    const serverFirebaseSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/server/firebaseServerAuth.ts'),
      'utf8'
    );
    assert.equal(serverFirebaseSource.includes("firestoreDatabaseId === '(default)'"), true);

    // Missing B2 config -> 503 STORAGE_NOT_CONFIGURED without leaking env values
    const { app: noB2App } = createMockTestServer({ b2Configured: false });
    await withServer(noB2App, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
      });
      assert.equal(res.status, 503);
      const data = (await res.json()) as any;
      assert.equal(data.error, 'STORAGE_NOT_CONFIGURED');
    });

    // Missing Firebase Admin config -> 503 FIREBASE_ADMIN_NOT_CONFIGURED
    const { app: noAdminApp } = createMockTestServer({ adminConfigured: false });
    await withServer(noAdminApp, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
      });
      assert.equal(res.status, 503);
      const data = (await res.json()) as any;
      assert.equal(data.error, 'FIREBASE_ADMIN_NOT_CONFIGURED');
    });
  });

  await t.test('17. Meeting deletion guard prevents deleting meetings with committed attachments or pending uploads while preserving Offline-First', async () => {
    const { app, b2Objects, meetingsOwned, guards } = createMockTestServer();
    meetingsOwned.set('meet_clean_01', { uid: USER_A, title: 'لقاء خالٍ من المرفقات' });
    meetingsOwned.set('meet_pending_01', { uid: USER_A, title: 'لقاء برفع غير مكتمل' });

    await withServer(app, async (baseUrl) => {
      // 17a. Unauthenticated or cross-user meeting delete rejected
      const unauthDel = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: 'meet_clean_01' }),
      });
      assert.equal(unauthDel.status, 401);

      const bobDel = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-bob' },
        body: JSON.stringify({ meetingId: MEETING_A }),
      });
      assert.equal(bobDel.status, 403);
      assert.equal(meetingsOwned.has(MEETING_A), true);

      // 17b. Meeting with pending UploadIntent CANNOT be deleted (409 MEETING_HAS_PENDING_ATTACHMENTS)
      const pPending = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_pending_01',
          fileName: 'incomplete.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(pPending.status, 200);
      const dPending = (await pPending.json()) as any;
      b2Objects.set(dPending.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'e-pend',
      });
      assert.equal(guards.get(`${USER_A}:meet_pending_01`)?.locked, true);

      const blockedPendingRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_pending_01' }),
      });
      assert.equal(blockedPendingRes.status, 409);
      const blockedPendingJson = (await blockedPendingRes.json()) as any;
      assert.equal(blockedPendingJson.error, 'MEETING_HAS_PENDING_ATTACHMENTS');
      assert.equal(meetingsOwned.has('meet_pending_01'), true);
      assert.equal(b2Objects.has(dPending.storageKey), true);

      // 17c. Meeting with committed attachment CANNOT be deleted (409 MEETING_HAS_ATTACHMENTS) and B2 file remains untouched
      const pAtt = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'contract.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      const dAtt = (await pAtt.json()) as any;
      b2Objects.set(dAtt.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'e-att',
      });
      const compRes = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: dAtt.attachmentId,
          fileName: 'contract.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(compRes.status, 200);
      assert.equal(guards.get(`${USER_A}:${MEETING_A}`)?.locked, true);

      const blockedAttRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A }),
      });
      assert.equal(blockedAttRes.status, 409);
      const blockedAttJson = (await blockedAttRes.json()) as any;
      assert.equal(blockedAttJson.error, 'MEETING_HAS_ATTACHMENTS');
      assert.match(blockedAttJson.messageArabic, /حذف المرفقات أولاً/);
      assert.equal(meetingsOwned.has(MEETING_A), true);
      assert.equal(b2Objects.has(dAtt.storageKey), true);

      // 17d. After deleting attachments via approved endpoint, guard unlocks and meeting delete succeeds
      const delAttRes = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: dAtt.attachmentId }),
      });
      assert.equal(delAttRes.status, 200);
      assert.equal(guards.get(`${USER_A}:${MEETING_A}`)?.locked, false);

      const allowAfterCleanupRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A }),
      });
      assert.equal(allowAfterCleanupRes.status, 200);
      assert.equal(meetingsOwned.has(MEETING_A), false);

      // 17e. Deleting attachment-free meeting succeeds cleanly (200)
      const cleanDelRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_clean_01' }),
      });
      assert.equal(cleanDelRes.status, 200);
      assert.equal(meetingsOwned.has('meet_clean_01'), false);
    });

    // 17f. Client deleteMeetingWithDeps preserves Offline-First for attachment-free meetings & blocks known attachments
    let directDeletedCount = 0;
    const offlineCleanHandle = deleteMeetingWithDeps('meet_offline_ok', { knownAttachmentsCount: 0 }, {
      getUid: () => USER_A,
      isOnline: () => false,
      getIdToken: async () => null,
      hasAnyAttachmentsInFirestore: async () => false,
      callServerDelete: async () => ({ status: 200, body: { deleted: true } }),
      deleteMeetingDocDirect: async () => {
        directDeletedCount++;
      },
    });
    assert.equal(offlineCleanHandle.localAccepted, true);
    await offlineCleanHandle.serverPromise;
    assert.equal(directDeletedCount, 1);

    const offlineKnownAttHandle = deleteMeetingWithDeps('meet_offline_blocked', { knownAttachmentsCount: 2 }, {
      getUid: () => USER_A,
      isOnline: () => false,
      getIdToken: async () => null,
      hasAnyAttachmentsInFirestore: async () => false,
      callServerDelete: async () => ({ status: 200, body: { deleted: true } }),
      deleteMeetingDocDirect: async () => {
        throw new Error('Must never delete meeting with known attachments');
      },
    });
    await assert.rejects(() => offlineKnownAttHandle.serverPromise, (err: any) => err.code === 'MEETING_HAS_ATTACHMENTS');

    const classifiedAtt = classifyWriteError(
      Object.assign(new Error('MEETING_HAS_ATTACHMENTS'), { code: 'MEETING_HAS_ATTACHMENTS' }),
      'meeting',
      true
    );
    assert.match(classifiedAtt.messageArabic, /حذف المرفقات أولاً/);

    const classifiedPerm = classifyWriteError({ code: 'permission-denied' }, 'meeting', true);
    assert.match(classifiedPerm.messageArabic, /مرفقات معتمدة|عمليات رفع غير مكتملة/);
  });

  await t.test('18. UploadIntent expiration cleanup, browser disconnect recovery, multi-instance race safety, and disabled-by-default cron trigger', async () => {
    const baseMs = 1_731_500_000_000;
    const expiresIso = new Date(baseMs + UPLOAD_INTENT_GRACE_MS).toISOString();

    // 18a. Pure eligibility window & safety buffer boundary checks
    assert.equal(
      isUploadIntentEligibleForExpirationCleanup({
        status: 'pending',
        expiresAt: expiresIso,
        nowMs: baseMs + UPLOAD_INTENT_GRACE_MS - 1000,
      }),
      false,
      'Before expiresAt must NEVER be eligible'
    );
    assert.equal(
      isUploadIntentEligibleForExpirationCleanup({
        status: 'pending',
        expiresAt: expiresIso,
        nowMs: baseMs + UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS - 1000,
      }),
      false,
      'Inside post-expiry safety buffer must NEVER be eligible'
    );
    assert.equal(
      isUploadIntentEligibleForExpirationCleanup({
        status: 'pending',
        expiresAt: expiresIso,
        nowMs: baseMs + UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
      }),
      true,
      'Past expiresAt + safetyBuffer must be eligible'
    );
    assert.equal(
      isUploadIntentEligibleForExpirationCleanup({
        status: 'committing',
        expiresAt: expiresIso,
        committingLeaseExpiresAt: new Date(
          baseMs + UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS + 30_000
        ).toISOString(),
        nowMs: baseMs + UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS,
      }),
      false,
      'Active committing lease MUST NEVER be cleaned'
    );
    assert.equal(
      isUploadIntentEligibleForExpirationCleanup({
        status: 'committed',
        expiresAt: expiresIso,
        nowMs: baseMs + UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS + 60_000,
      }),
      false,
      'Committed attachment MUST NEVER be cleaned'
    );

    // 18b. Browser disconnects before complete-upload -> stays pending during grace+buffer, then cleans safely & unlocks meeting deletion
    const ctx = createMockTestServer({
      initialTimeMs: baseMs,
      enableScheduledSweepEndpoint: false,
    });

    await withServer(ctx.app, async (baseUrl) => {
      const p = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'abandoned_scan.jpg',
          contentType: 'image/jpeg',
          sizeBytes: JPEG_HEADER.byteLength,
        }),
      });
      const presigned = (await p.json()) as any;
      // Simulate browser finished PUT to B2 then closed tab before calling complete-upload
      ctx.b2Objects.set(presigned.storageKey, {
        sizeBytes: JPEG_HEADER.byteLength,
        contentType: 'image/jpeg',
        headerBytes: JPEG_HEADER,
        etag: 'e-disconnect',
      });

      // Scheduled sweep endpoint MUST be disabled by default
      const disabledCronRes = await fetch(`${baseUrl}/api/attachments/sweep-expired-scheduled`, {
        method: 'POST',
      });
      assert.equal(disabledCronRes.status, 403);
      assert.equal(((await disabledCronRes.json()) as any).error, 'SCHEDULED_SWEEP_DISABLED');

      // Advance past expiresAt but still inside safety buffer -> cleanup MUST skip
      ctx.advanceTimeMs(UPLOAD_INTENT_GRACE_MS + 10_000);
      const earlySweep = await cleanupExpiredMeetingAttachmentsWithDeps(
        { meetingId: MEETING_A },
        {
          isOnline: () => true,
          getIdToken: async () => 'token-alice',
          fetchApi: (input, init) => fetch(typeof input === 'string' ? `${baseUrl}${input}` : input, init),
        }
      );
      assert.equal(earlySweep.cleaned, 0);
      assert.equal(earlySweep.skipped, 1);
      assert.equal(ctx.b2Objects.has(presigned.storageKey), true);

      // Advance past grace + safety buffer -> cleanup removes orphan B2 object, unlocks guard, allows meeting deletion
      ctx.advanceTimeMs(UPLOAD_CLEANUP_SAFETY_BUFFER_MS);
      const lateSweep = await cleanupExpiredMeetingAttachmentsWithDeps(
        { meetingId: MEETING_A },
        {
          isOnline: () => true,
          getIdToken: async () => 'token-alice',
          fetchApi: (input, init) => fetch(typeof input === 'string' ? `${baseUrl}${input}` : input, init),
        }
      );
      assert.equal(lateSweep.cleaned, 1);
      assert.equal(ctx.b2Objects.has(presigned.storageKey), false);
      assert.equal(
        ctx.uploadIntents.get(`${USER_A}:${MEETING_A}:${presigned.attachmentId}`)?.status,
        'abandoned'
      );
      assert.equal(ctx.guards.get(`${USER_A}:${MEETING_A}`)?.locked, false);
    });

    // 18c. Multi-instance concurrency race: Instance 1 runs complete-upload while Instance 2 runs expiration sweep -> committed file NEVER deleted
    const raceCtx = createMockTestServer({
      initialTimeMs: baseMs,
      enableScheduledSweepEndpoint: true,
      scheduledSweepSecret: 'super-secret-cron-token-murafiq-2026',
    });

    await withServer(raceCtx.app, async (baseUrl) => {
      const p = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'slow_commit.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      const d = (await p.json()) as any;
      raceCtx.b2Objects.set(d.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'e-race',
      });

      // Advance clock past expiry+buffer right BEFORE slow complete-upload finishes on Instance 1,
      // simulating a client completing upload right around expiry while Instance 2 sweeps globally!
      raceCtx.advanceTimeMs(UPLOAD_INTENT_GRACE_MS + UPLOAD_CLEANUP_SAFETY_BUFFER_MS + 1000);
      raceCtx.setSlowVerifyMs(50);

      const instance1CompletePromise = fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: d.attachmentId,
          fileName: 'slow_commit.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });

      await new Promise((r) => setTimeout(r, 15));

      // Instance 2 triggers global scheduled sweep concurrently while Instance 1 holds committing lease
      const wrongSecretRes = await fetch(`${baseUrl}/api/attachments/sweep-expired-scheduled`, {
        method: 'POST',
        headers: { 'x-murafiq-cleanup-secret': 'wrong-secret' },
      });
      assert.equal(wrongSecretRes.status, 403);

      const instance2SweepRes = await fetch(
        `${baseUrl}/api/instance2/attachments/sweep-expired-scheduled`,
        {
          method: 'POST',
          headers: { 'x-murafiq-cleanup-secret': 'super-secret-cron-token-murafiq-2026' },
        }
      );
      assert.equal(instance2SweepRes.status, 200);
      const sweepBody = (await instance2SweepRes.json()) as any;
      assert.equal(sweepBody.cleaned, 0, 'Sweeper MUST skip intent locked by Instance 1 committing lease');
      assert.equal(sweepBody.skipped, 1);

      const instance1Res = await instance1CompletePromise;
      raceCtx.setSlowVerifyMs(0);
      assert.equal(instance1Res.status, 200);
      assert.equal(raceCtx.b2Objects.has(d.storageKey), true);
      assert.equal(
        raceCtx.attachmentsOwned.has(`${USER_A}:${MEETING_A}:${d.attachmentId}`),
        true
      );
    });

    // 18d. Transient B2 verification failure releases committing lease so immediate retry succeeds cleanly
    const retryCtx = createMockTestServer({ failVerifyOnce: true });
    await withServer(retryCtx.app, async (baseUrl) => {
      const p = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          fileName: 'retry.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      const d = (await p.json()) as any;
      retryCtx.b2Objects.set(d.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'e-retry',
      });

      const firstAttempt = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: d.attachmentId,
          fileName: 'retry.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(firstAttempt.status, 500);
      assert.equal(
        retryCtx.uploadIntents.get(`${USER_A}:${MEETING_A}:${d.attachmentId}`)?.status,
        'pending',
        'Lease must release back to pending after unexpected transient verify exception'
      );

      const secondAttempt = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: MEETING_A,
          attachmentId: d.attachmentId,
          fileName: 'retry.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(secondAttempt.status, 200);
      assert.equal(retryCtx.attachmentsOwned.has(`${USER_A}:${MEETING_A}:${d.attachmentId}`), true);
    });
  });

  await t.test('19. Firebase Admin credential readiness distinguishes ADC/Cloud Run Identity from explicit JSON key without exposing secrets', () => {
    const noneState = getFirebaseAdminReadinessStatus({} as NodeJS.ProcessEnv);
    assert.equal(noneState.configured, false);
    assert.equal(noneState.credentialSource, 'none');
    assert.equal(noneState.supportsManagedIdentityAdc, false);
    assert.equal(noneState.firestoreDatabaseId, 'ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475');

    const cloudRunAdcState = getFirebaseAdminReadinessStatus({
      K_SERVICE: 'murafiq-prod-service',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(cloudRunAdcState.supportsManagedIdentityAdc, true);
    assert.equal(cloudRunAdcState.credentialSource, 'cloud_run_adc');
    assert.equal(cloudRunAdcState.configured, false);

    const saState = getFirebaseAdminReadinessStatus({
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"client_email":"x@y.iam","private_key":"secret"}',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(saState.configured, true);
    assert.equal(saState.credentialSource, 'service_account_json');
    assert.equal(JSON.stringify(saState).includes('private_key'), false);
    assert.equal(JSON.stringify(saState).includes('x@y.iam'), false);
  });

  await t.test('20. Concurrent meeting deletion vs upload intent creation NEVER produces orphan UploadIntent', async () => {
    // Minimal optimistic-concurrency Firestore simulator to exercise the REAL
    // createFirebaseAttachmentMetadataStore().createUploadIntent & deleteMeetingIfNoAttachments transactions
    function createFakeTransactionalFirestore(initialDocs: Record<string, any>) {
      const store = new Map<string, any>();
      const versions = new Map<string, number>();
      for (const [k, v] of Object.entries(initialDocs)) {
        store.set(k, structuredClone(v));
        versions.set(k, 1);
      }

      const makeDocRef = (docPath: string) => ({
        __type: 'doc' as const,
        path: docPath,
        id: docPath.split('/').pop()!,
      });

      const makeQuery = (colPath: string, limitN?: number) => ({
        __type: 'col' as const,
        colPath,
        limitN,
        limit: (n: number) => makeQuery(colPath, n),
      });

      let onTxAttemptReadDone: ((attemptLabel: string) => Promise<void>) | null = null;
      let txCounter = 0;

      const db = {
        doc: (p: string) => makeDocRef(p),
        collection: (p: string) => makeQuery(p),
        setAfterReadHook: (fn: ((attemptLabel: string) => Promise<void>) | null) => {
          onTxAttemptReadDone = fn;
        },
        docsMap: store,
        runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
          const id = `tx_${++txCounter}`;
          for (let attempt = 0; attempt < 8; attempt++) {
            const readDocVersions = new Map<string, number>();
            const readPrefixVersions = new Map<string, Map<string, number>>();
            const pendingWrites: Array<{ type: 'set' | 'delete'; path: string; data?: any }> = [];

            const tx = {
              get: async (target: any) => {
                if (target.__type === 'doc') {
                  const v = versions.get(target.path) || 0;
                  if (!readDocVersions.has(target.path)) {
                    readDocVersions.set(target.path, v);
                  }
                  const data = store.get(target.path);
                  return {
                    exists: data !== undefined,
                    data: () => (data !== undefined ? structuredClone(data) : undefined),
                  };
                }
                const prefix = `${target.colPath}/`;
                const snapMap = new Map<string, number>();
                const docs: any[] = [];
                for (const [k, val] of store.entries()) {
                  if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
                    snapMap.set(k, versions.get(k) || 0);
                    if (!target.limitN || docs.length < target.limitN) {
                      docs.push({ id: k.slice(prefix.length), data: () => structuredClone(val) });
                    }
                  }
                }
                readPrefixVersions.set(prefix, snapMap);
                return {
                  empty: docs.length === 0,
                  size: docs.length,
                  forEach: (cb: (d: any) => void) => docs.forEach(cb),
                };
              },
              set: (ref: any, data: any) => {
                pendingWrites.push({ type: 'set', path: ref.path, data: structuredClone(data) });
              },
              update: (ref: any, patch: any) => {
                const cur = store.get(ref.path) || {};
                pendingWrites.push({
                  type: 'set',
                  path: ref.path,
                  data: { ...structuredClone(cur), ...structuredClone(patch) },
                });
              },
              delete: (ref: any) => {
                pendingWrites.push({ type: 'delete', path: ref.path });
              },
            };

            const result = await fn(tx);
            if (onTxAttemptReadDone && attempt === 0) {
              await onTxAttemptReadDone(id);
            }

            // Optimistic concurrency conflict check (matches Firestore serializability)
            let conflict = false;
            for (const [p, expectedV] of readDocVersions.entries()) {
              if ((versions.get(p) || 0) !== expectedV) {
                conflict = true;
                break;
              }
            }
            if (!conflict) {
              for (const [prefix, snapMap] of readPrefixVersions.entries()) {
                for (const [k, v] of versions.entries()) {
                  if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
                    if (snapMap.get(k) !== v) {
                      conflict = true;
                      break;
                    }
                  }
                }
                if (conflict) break;
                for (const [k, oldV] of snapMap.entries()) {
                  if ((versions.get(k) || 0) !== oldV) {
                    conflict = true;
                    break;
                  }
                }
                if (conflict) break;
              }
            }

            if (conflict) {
              continue; // Firestore transaction retries on contention
            }

            for (const w of pendingWrites) {
              const nextV = (versions.get(w.path) || 0) + 1;
              versions.set(w.path, nextV);
              if (w.type === 'delete') {
                store.delete(w.path);
              } else {
                store.set(w.path, w.data);
              }
            }
            return result;
          }
          throw new Error('Transaction contention limit exceeded');
        },
      };
      return db;
    }

    const meetingPath = `users/${USER_A}/meetings/${MEETING_A}`;
    const intentPath = `users/${USER_A}/meetings/${MEETING_A}/uploadIntents/att_race_1`;
    const guardPath = `users/${USER_A}/meetings/${MEETING_A}/uploadIntents/${MEETING_GUARD_DOC_ID}`;

    const sampleIntent = (attachmentId: string, meetingId = MEETING_A): UploadIntentRecord => ({
      attachmentId,
      userId: USER_A,
      meetingId,
      fileName: 'race.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF_HEADER.byteLength,
      storageKey: buildAttachmentStorageKey({ uid: USER_A, meetingId, attachmentId }),
      bucket: 'Murafiq',
      status: 'pending',
      expiresAt: new Date(Date.now() + UPLOAD_INTENT_GRACE_MS).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 20a. Production store: delete meeting first, then createUploadIntent -> rejected & zero orphan
    {
      const fakeDb = createFakeTransactionalFirestore({
        [meetingPath]: { id: MEETING_A, userId: USER_A, title: 'Clean Meeting' },
      });
      const realStore = createFirebaseAttachmentMetadataStore({ getDb: () => fakeDb as any });

      const delRes = await realStore.deleteMeetingIfNoAttachments({ uid: USER_A, meetingId: MEETING_A });
      assert.equal(delRes.outcome, 'deleted');
      assert.equal(fakeDb.docsMap.has(meetingPath), false);

      const createRes = await realStore.createUploadIntent(sampleIntent('att_race_1'));
      assert.equal(createRes.outcome, 'meeting_not_found');
      assert.equal(fakeDb.docsMap.has(intentPath), false, 'Must NOT create orphan UploadIntent');
      assert.equal(fakeDb.docsMap.has(guardPath), false, 'Must NOT recreate _meetingGuard on deleted meeting');
    }

    // 20b. Production store: createUploadIntent first, then deleteMeetingIfNoAttachments -> rejected
    {
      const fakeDb = createFakeTransactionalFirestore({
        [meetingPath]: { id: MEETING_A, userId: USER_A, title: 'Upload First Meeting' },
      });
      const realStore = createFirebaseAttachmentMetadataStore({ getDb: () => fakeDb as any });

      const createRes = await realStore.createUploadIntent(sampleIntent('att_race_1'));
      assert.equal(createRes.outcome, 'created');
      assert.equal(fakeDb.docsMap.get(guardPath)?.locked, true);

      const delRes = await realStore.deleteMeetingIfNoAttachments({ uid: USER_A, meetingId: MEETING_A });
      assert.equal(delRes.outcome, 'blocked_pending_intents');
      assert.equal(fakeDb.docsMap.has(meetingPath), true);
    }

    // 20c. Production store multi-instance contention: overlapping tx retries (delete wins -> create aborts cleanly; upload wins -> delete aborts cleanly)
    {
      // Ordering 1: createUploadIntent (tx_1) reads meeting & pauses, deleteMeeting (tx_2) commits delete, create retries & aborts
      const fakeDb1 = createFakeTransactionalFirestore({
        [meetingPath]: { id: MEETING_A, userId: USER_A, title: 'Contended Meeting 1' },
      });
      const realStore1 = createFirebaseAttachmentMetadataStore({ getDb: () => fakeDb1 as any });
      let releaseTx1!: () => void;
      const tx1Waiting = new Promise<void>((r) => {
        releaseTx1 = r;
      });
      let tx1Entered!: () => void;
      const tx1EnteredPromise = new Promise<void>((r) => {
        tx1Entered = r;
      });
      fakeDb1.setAfterReadHook(async (id) => {
        if (id === 'tx_1') {
          tx1Entered();
          await tx1Waiting;
        }
      });

      const createP = realStore1.createUploadIntent(sampleIntent('att_race_1'));
      await tx1EnteredPromise;
      const deleteP = realStore1.deleteMeetingIfNoAttachments({ uid: USER_A, meetingId: MEETING_A });
      const delOutcome = await deleteP;
      releaseTx1();
      const createOutcome = await createP;

      assert.equal(delOutcome.outcome, 'deleted');
      assert.equal(createOutcome.outcome, 'meeting_not_found');
      assert.equal(fakeDb1.docsMap.size, 0, 'Zero orphan UploadIntent or guard documents may remain');
    }

    {
      // Ordering 2: deleteMeeting (tx_1) reads empty state & pauses, createUploadIntent (tx_2) commits intent+guard, delete retries & is blocked
      const fakeDb2 = createFakeTransactionalFirestore({
        [meetingPath]: { id: MEETING_A, userId: USER_A, title: 'Contended Meeting 2' },
      });
      const realStore2 = createFirebaseAttachmentMetadataStore({ getDb: () => fakeDb2 as any });
      let releaseTx1!: () => void;
      const tx1Waiting = new Promise<void>((r) => {
        releaseTx1 = r;
      });
      let tx1Entered!: () => void;
      const tx1EnteredPromise = new Promise<void>((r) => {
        tx1Entered = r;
      });
      fakeDb2.setAfterReadHook(async (id) => {
        if (id === 'tx_1') {
          tx1Entered();
          await tx1Waiting;
        }
      });

      const deleteP = realStore2.deleteMeetingIfNoAttachments({ uid: USER_A, meetingId: MEETING_A });
      await tx1EnteredPromise;
      const createP = realStore2.createUploadIntent(sampleIntent('att_race_1'));
      const createOutcome = await createP;
      releaseTx1();
      const delOutcome = await deleteP;

      assert.equal(createOutcome.outcome, 'created');
      assert.equal(delOutcome.outcome, 'blocked_pending_intents');
      assert.equal(fakeDb2.docsMap.has(meetingPath), true);
      assert.equal(fakeDb2.docsMap.has(intentPath), true);
      assert.equal(fakeDb2.docsMap.get(guardPath)?.locked, true);
    }

    // 20d & 20e & 20f. End-to-end HTTP multi-instance tests across presign-upload, complete-upload, cleanup, and /api/meetings/delete
    const ctx = createMockTestServer();
    ctx.meetingsOwned.set('meet_del_first', { uid: USER_A, title: 'حذف أولاً' });
    ctx.meetingsOwned.set('meet_http_race_del_wins', { uid: USER_A, title: 'سباق تزامن 1' });
    ctx.meetingsOwned.set('meet_http_race_upload_wins', { uid: USER_A, title: 'سباق تزامن 2' });

    await withServer(ctx.app, async (baseUrl) => {
      // Delete attachment-free meeting first, then attempt upload -> rejected with Arabic error, no orphan
      const delEmptyRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_del_first' }),
      });
      assert.equal(delEmptyRes.status, 200);
      assert.equal(ctx.meetingsOwned.has('meet_del_first'), false);

      const uploadAfterDelRes = await fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_del_first',
          fileName: 'late.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(uploadAfterDelRes.status >= 400, true);
      const uploadAfterDelBody = (await uploadAfterDelRes.json()) as any;
      assert.match(uploadAfterDelBody.messageArabic, /اللقاء غير موجود|تم حذفه/);
      assert.equal(ctx.guards.has(`${USER_A}:meet_del_first`), false);

      // HTTP Race 1: Instance 1 passes verifyMeetingOwner, pauses before createUploadIntent; Instance 2 deletes meeting first -> 404 MEETING_NOT_FOUND
      let allowCreateTx!: () => void;
      const waitCreateTx = new Promise<void>((r) => {
        allowCreateTx = r;
      });
      let createPaused!: () => void;
      const waitCreatePaused = new Promise<void>((r) => {
        createPaused = r;
      });
      ctx.setBeforeCreateIntentHook(async () => {
        createPaused();
        await waitCreateTx;
      });

      const presignRacePromise = fetch(`${baseUrl}/api/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_http_race_del_wins',
          fileName: 'race1.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      await waitCreatePaused;
      ctx.setBeforeCreateIntentHook(null);

      const concurrentDelRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_http_race_del_wins' }),
      });
      assert.equal(concurrentDelRes.status, 200);
      allowCreateTx();

      const presignRaceRes = await presignRacePromise;
      assert.equal(presignRaceRes.status, 404);
      const presignRaceBody = (await presignRaceRes.json()) as any;
      assert.equal(presignRaceBody.error, 'MEETING_NOT_FOUND');
      assert.match(presignRaceBody.messageArabic, /اللقاء غير موجود أو تم حذفه/);
      assert.equal(ctx.guards.has(`${USER_A}:meet_http_race_del_wins`), false);
      for (const k of ctx.uploadIntents.keys()) {
        assert.equal(k.includes('meet_http_race_del_wins'), false, 'Zero orphan UploadIntents');
      }

      // HTTP Race 2: Instance 1 pauses right before deleteMeetingIfNoAttachments; Instance 2 creates UploadIntent -> Instance 1 blocked (409)
      let allowDeleteTx!: () => void;
      const waitDeleteTx = new Promise<void>((r) => {
        allowDeleteTx = r;
      });
      let deletePaused!: () => void;
      const waitDeletePaused = new Promise<void>((r) => {
        deletePaused = r;
      });
      ctx.setBeforeDeleteMeetingHook(async () => {
        deletePaused();
        await waitDeleteTx;
      });

      const delRacePromise = fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_http_race_upload_wins' }),
      });
      await waitDeletePaused;
      ctx.setBeforeDeleteMeetingHook(null);

      const presignWinRes = await fetch(`${baseUrl}/api/instance2/attachments/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_http_race_upload_wins',
          fileName: 'race2.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(presignWinRes.status, 200);
      const presignWinBody = (await presignWinRes.json()) as any;

      allowDeleteTx();
      const delRaceRes = await delRacePromise;
      assert.equal(delRaceRes.status, 409);
      const delRaceBody = (await delRaceRes.json()) as any;
      assert.equal(delRaceBody.error, 'MEETING_HAS_PENDING_ATTACHMENTS');
      assert.equal(ctx.meetingsOwned.has('meet_http_race_upload_wins'), true);

      // Complete upload, delete attachment, then delete meeting cleanly (verifies complete lifecycle)
      ctx.b2Objects.set(presignWinBody.storageKey, {
        sizeBytes: PDF_HEADER.byteLength,
        contentType: 'application/pdf',
        headerBytes: PDF_HEADER,
        etag: 'e-race2',
      });
      const completeWinRes = await fetch(`${baseUrl}/api/attachments/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_http_race_upload_wins',
          attachmentId: presignWinBody.attachmentId,
          fileName: 'race2.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF_HEADER.byteLength,
        }),
      });
      assert.equal(completeWinRes.status, 200);

      const delAttWinRes = await fetch(`${baseUrl}/api/attachments/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({
          meetingId: 'meet_http_race_upload_wins',
          attachmentId: presignWinBody.attachmentId,
        }),
      });
      assert.equal(delAttWinRes.status, 200);

      const delMeetingAfterCleanupRes = await fetch(`${baseUrl}/api/meetings/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: 'meet_http_race_upload_wins' }),
      });
      assert.equal(delMeetingAfterCleanupRes.status, 200);
      assert.equal(ctx.meetingsOwned.has('meet_http_race_upload_wins'), false);
    });
  });
});
