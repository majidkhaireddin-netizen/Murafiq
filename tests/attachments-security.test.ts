import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAttachmentsRouter } from '../src/server/attachmentsRouter.ts';
import type { B2StorageService } from '../src/server/b2Storage.ts';
import {
  getFirebaseServerConfig,
  verifyFirebaseTokenWithFallback,
  type AttachmentMetadataStore,
} from '../src/server/firebaseServerAuth.ts';
import {
  buildAttachmentStorageKey,
  isPresignedUrlExpired,
  MAX_ATTACHMENT_SIZE_BYTES,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  PRESIGNED_UPLOAD_TTL_SECONDS,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../src/utils/attachmentPolicy.ts';
import {
  clearAttachmentDownloadCache,
  getDownloadCacheSnapshotForTesting,
} from '../src/utils/attachmentDownloadCache.ts';
import {
  AttachmentClientError,
  deleteMeetingAttachmentWithDeps,
  getFreshPresignedDownloadUrlWithDeps,
  uploadMeetingAttachmentWithDeps,
} from '../src/services/attachments.ts';
import type { MeetingAttachment, UploadIntentRecord } from '../src/types/index.ts';

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
  uploadedObjects?: Map<
    string,
    { sizeBytes: number; contentType: string; headerBytes: Uint8Array; etag: string }
  >;
}) {
  const b2Objects =
    options?.uploadedObjects ||
    new Map<string, { sizeBytes: number; contentType: string; headerBytes: Uint8Array; etag: string }>();

  const meetingsOwned = new Map<string, { uid: string }>([[MEETING_A, { uid: USER_A }]]);
  const attachmentsOwned = new Map<string, MeetingAttachment>();
  const uploadIntents = new Map<string, UploadIntentRecord>();

  let failDelete = options?.failB2Delete ?? false;
  let failFinalize = options?.failFinalizeDeletion ?? false;
  let slowCommitMs = options?.slowCommitMs ?? 0;
  let adminConfigured = options?.adminConfigured ?? true;

  const ensureAdminConfigured = () => {
    if (!adminConfigured) {
      throw new Error(
        'FIREBASE_ADMIN_NOT_CONFIGURED: يتطلب توفير مفتاح حساب خدمة Firebase Admin.'
      );
    }
  };

  const mockStorage: B2StorageService = {
    getBucketName: () => 'Murafiq',
    isConfigured: () => options?.b2Configured ?? true,
    createPresignedUploadUrl: async ({ key }) => ({
      uploadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?X-Amz-Expires=${PRESIGNED_UPLOAD_TTL_SECONDS}`,
      expiresAt: new Date(Date.now() + PRESIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
    }),
    createPresignedDownloadUrl: async ({ key, disposition }) => ({
      downloadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?disposition=${disposition}&X-Amz-Expires=${PRESIGNED_DOWNLOAD_TTL_SECONDS}&nonce=${Math.random()}`,
      expiresAt: new Date(Date.now() + PRESIGNED_DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
    }),
    verifyUploadedObject: async ({ key, expectedContentType, expectedSizeBytes }) => {
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
      uploadIntents.set(`${intent.userId}:${intent.meetingId}:${intent.attachmentId}`, { ...intent });
    },
    getUploadIntent: async ({ uid, meetingId, attachmentId }) => {
      ensureAdminConfigured();
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
      if (intent.status === 'abandoned' || intent.status === 'deleted' || intent.status === 'committed') {
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
      return { outcome: 'committed', record: { ...record } };
    },
    markUploadIntentAbandonedIfPending: async ({ uid, meetingId, attachmentId, nowIso }) => {
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
        return { outcome: 'already_abandoned' };
      }
      uploadIntents.set(key, {
        ...intent,
        status: 'abandoned',
        updatedAt: nowIso,
      });
      return { outcome: 'abandoned' };
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
    },
  };

  const router = createAttachmentsRouter({
    storageService: mockStorage,
    metadataStore,
    verifyBearerToken: async (authHeader) => {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('UNAUTHENTICATED: Missing Bearer token');
      }
      const token = authHeader.slice('Bearer '.length).trim();
      if (token === 'token-alice') return { uid: USER_A, email: 'alice@example.com', idToken: token };
      if (token === 'token-bob') return { uid: USER_B, email: 'bob@example.com', idToken: token };
      throw new Error('UNAUTHENTICATED: Invalid token');
    },
    verifyMeetingOwnership: async ({ uid, meetingId }) => {
      const meeting = meetingsOwned.get(meetingId);
      return Boolean(meeting && meeting.uid === uid);
    },
    verifyAttachmentOwnership: async ({ uid, meetingId, attachmentId }) => {
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
  });

  const app = express();
  app.use(express.json());
  app.use('/api/attachments', router);

  return {
    app,
    b2Objects,
    attachmentsOwned,
    uploadIntents,
    setFailDelete: (v: boolean) => {
      failDelete = v;
    },
    setFailFinalize: (v: boolean) => {
      failFinalize = v;
    },
    setSlowCommitMs: (ms: number) => {
      slowCommitMs = ms;
    },
    setAdminConfigured: (v: boolean) => {
      adminConfigured = v;
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
      const concurrentCleanupPromise = fetch(`${baseUrl}/api/attachments/cleanup-uncommitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-alice' },
        body: JSON.stringify({ meetingId: MEETING_A, attachmentId: d2.attachmentId }),
      });

      const [compRes, cleanRes] = await Promise.all([completePromise, concurrentCleanupPromise]);
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
});
