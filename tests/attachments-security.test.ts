import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAttachmentsRouter } from '../src/server/attachmentsRouter.ts';
import type { B2StorageService } from '../src/server/b2Storage.ts';
import { verifyFirebaseTokenWithFallback } from '../src/server/firebaseServerAuth.ts';
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
  AttachmentClientError,
  deleteMeetingAttachmentWithDeps,
  uploadMeetingAttachmentWithDeps,
} from '../src/services/attachments.ts';
import type { MeetingAttachment } from '../src/types/index.ts';

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
  failB2Delete?: boolean;
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
  let failDelete = options?.failB2Delete ?? false;

  const mockStorage: B2StorageService = {
    isConfigured: () => options?.b2Configured ?? true,
    createPresignedUploadUrl: async ({ key }) => ({
      uploadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?X-Amz-Expires=${PRESIGNED_UPLOAD_TTL_SECONDS}`,
      expiresAt: new Date(Date.now() + PRESIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
    }),
    createPresignedDownloadUrl: async ({ key, disposition }) => ({
      downloadUrl: `https://s3.us-east-005.backblazeb2.com/Murafiq/${key}?disposition=${disposition}&X-Amz-Expires=${PRESIGNED_DOWNLOAD_TTL_SECONDS}`,
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

  const router = createAttachmentsRouter({
    storageService: mockStorage,
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
        storageKey: att.storageKey,
        fileName: att.fileName,
        contentType: att.contentType,
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
    setFailDelete: (v: boolean) => {
      failDelete = v;
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

test('Task 004-A Security & Reliability Suite (Backblaze B2 Attachments)', async (t) => {
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

  await t.test('3. Client-supplied storageKey / uid / userId spoofing attempts are rejected (403)', async () => {
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

    // Valid MIME + extension checks
    assert.equal(verifyMagicBytes(JPEG_HEADER, 'image/jpeg'), true);
    assert.equal(verifyMagicBytes(PNG_HEADER, 'image/png'), true);
    assert.equal(verifyMagicBytes(WEBP_HEADER, 'image/webp'), true);
    assert.equal(verifyMagicBytes(PDF_HEADER, 'application/pdf'), true);

    // Disguised files fail magic-byte verification
    assert.equal(verifyMagicBytes(HTML_DISGUISED, 'image/jpeg'), false);
    assert.equal(verifyMagicBytes(EXE_DISGUISED, 'application/pdf'), false);

    // Server complete-upload rejects & deletes disguised file from B2 if uploaded directly via signed URL
    const { app, b2Objects } = createMockTestServer();
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

      // Attacker uploads HTML bytes instead of real JPEG
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

  await t.test('8. Offline blocking, upload failure rollback, and B2 delete failure safety', async () => {
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
            saveMetadata: async () => {},
          }
        ),
      (err: any) => err.code === 'OFFLINE_BLOCKED'
    );

    // 8b. Firestore save failure triggers B2 cleanup-uncommitted so no orphan remains
    const cleanupCalls: Array<{ meetingId: string; attachmentId: string }> = [];
    const { app, b2Objects } = createMockTestServer();

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
                  etag: 'etag-ok',
                });
                return { etag: 'etag-ok' };
              },
              saveMetadata: async () => {
                throw new Error('Simulated Firestore write failure');
              },
            }
          ),
        (err: any) => err.code === 'FIRESTORE_METADATA_SAVE_FAILED'
      );

      assert.equal(cleanupCalls.length, 1, 'Cleanup endpoint must be called after Firestore save failure');
      assert.equal(b2Objects.size, 0, 'Orphaned B2 object must be deleted when Firestore save fails');
    });

    // 8c. B2 delete failure keeps Firestore metadata intact so no orphaned hidden file remains untracked
    const { app: deleteFailApp, setFailDelete, attachmentsOwned, b2Objects: objs2 } =
      createMockTestServer();
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
    attachmentsOwned.set(`${USER_A}:${MEETING_A}:${attId}`, {
      id: attId,
      userId: USER_A,
      meetingId: MEETING_A,
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
      storageKey: key,
      storageProvider: 'backblaze_b2',
      uploadStatus: 'completed',
      createdAt: new Date().toISOString(),
    });
    setFailDelete(true);

    let metadataDeleted = false;
    await withServer(deleteFailApp, async (baseUrl) => {
      await assert.rejects(() =>
        deleteMeetingAttachmentWithDeps(
          { meetingId: MEETING_A, attachmentId: attId },
          {
            isOnline: () => true,
            getIdToken: async () => 'token-alice',
            fetchApi: (input, init) => {
              const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
              return fetch(url, init);
            },
            deleteMetadata: async () => {
              metadataDeleted = true;
            },
          }
        )
      );
      assert.equal(
        metadataDeleted,
        false,
        'Firestore metadata must NOT be deleted if Backblaze B2 delete fails'
      );
    });
  });

  await t.test('9. Host ADC auth/internal-error falls back safely without masking genuine expired/revoked tokens', async () => {
    // 9a. Cross-project IdentityToolkit auth/internal-error falls back to checkRevoked=false signature verification
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

    // 9b. When preferRevocationCheck is false (no explicit Firebase SA key), uses checkRevoked=false directly
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

    // 9c. Expired/revoked/malformed tokens MUST NOT fall back
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

    // 9d. Unexpected internal verifier error returns 500 AUTH_VERIFICATION_UNAVAILABLE instead of misleading 401
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

  await t.test('10. Same-origin relay upload and download fallbacks enforce auth, ownership, size, magic bytes, and security headers', async () => {
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

      // 10d. Disguised HTML payload sent to /relay-upload as image/jpeg rejected (422) & never stored in B2
      const disguisedRelayUp = await fetch(`${baseUrl}/api/attachments/relay-upload`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-alice',
          'Content-Type': 'image/jpeg',
          'x-meeting-id': MEETING_A,
          'x-attachment-id': 'att_html_spoof',
          'x-file-name': 'sneaky.jpg',
        },
        body: HTML_DISGUISED,
      });
      assert.equal(disguisedRelayUp.status, 422);
      assert.equal(b2Objects.size, 0);

      // 10e. Automatic client fallback from CORS NETWORK_ERROR on presigned PUT to same-origin /relay-upload
      const savedRecords: MeetingAttachment[] = [];
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
          saveMetadata: async (record) => {
            savedRecords.push(record);
            attachmentsOwned.set(`${USER_A}:${MEETING_A}:${record.id}`, record);
          },
        }
      );

      assert.equal(relayUsed, true, 'Client must fall back automatically to same-origin relay when CORS blocks direct PUT');
      assert.equal(savedRecords.length, 1);
      assert.equal(uploaded.storageProvider, 'backblaze_b2');
      assert.equal(uploaded.uploadStatus, 'completed');

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
});
