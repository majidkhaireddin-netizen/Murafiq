import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AllowedAttachmentMimeType } from '../types/index.ts';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  PRESIGNED_UPLOAD_TTL_SECONDS,
  verifyMagicBytes,
} from '../utils/attachmentPolicy.ts';

export interface B2ServerConfig {
  bucketName: string;
  region: string;
  endpoint: string;
  keyId: string;
  applicationKey: string;
}

export interface PresignedUploadOutput {
  uploadUrl: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface PresignedDownloadOutput {
  downloadUrl: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface VerifiedB2Object {
  verified: boolean;
  sizeBytes: number;
  contentType?: string;
  etag?: string;
  reasonArabic?: string;
}

export interface B2StorageService {
  isConfigured(): boolean;
  createPresignedUploadUrl(params: {
    key: string;
    contentType: AllowedAttachmentMimeType;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<PresignedUploadOutput>;
  createPresignedDownloadUrl(params: {
    key: string;
    fileName: string;
    contentType: AllowedAttachmentMimeType;
    disposition?: 'inline' | 'attachment';
    expiresInSeconds?: number;
  }): Promise<PresignedDownloadOutput>;
  verifyUploadedObject(params: {
    key: string;
    expectedContentType: AllowedAttachmentMimeType;
    expectedSizeBytes: number;
  }): Promise<VerifiedB2Object>;
  deleteObject(key: string): Promise<void>;
}

export function readB2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): B2ServerConfig | null {
  const keyId = env.B2_APPLICATION_KEY_ID?.trim() || '';
  const applicationKey = env.B2_APPLICATION_KEY?.trim() || '';
  if (!keyId || !applicationKey) {
    return null;
  }

  const bucketName = env.B2_BUCKET_NAME?.trim() || 'Murafiq';
  const region = env.B2_REGION?.trim() || 'us-east-005';
  const endpoint = env.B2_S3_ENDPOINT?.trim() || 'https://s3.us-east-005.backblazeb2.com';

  return {
    bucketName,
    region,
    endpoint,
    keyId,
    applicationKey,
  };
}

function encodeRfc5987Value(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function readStreamFirstBytes(body: unknown, maxBytes: number = 16): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const typedBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer>;
  };

  if (typeof typedBody.transformToByteArray === 'function') {
    const arr = await typedBody.transformToByteArray();
    return arr.slice(0, maxBytes);
  }

  if (typeof typedBody[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of typedBody as AsyncIterable<Uint8Array | Buffer>) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      chunks.push(bytes);
      total += bytes.length;
      if (total >= maxBytes) break;
    }
    const merged = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, merged.length - offset);
      merged.set(c.subarray(0, take), offset);
      offset += take;
      if (offset >= merged.length) break;
    }
    return merged;
  }

  return new Uint8Array(0);
}

export function createBackblazeB2StorageService(env: NodeJS.ProcessEnv = process.env): B2StorageService {
  let cachedClient: S3Client | null = null;
  let cachedConfigKey = '';

  const getClientAndConfig = (): { client: S3Client; config: B2ServerConfig } => {
    const config = readB2ConfigFromEnv(env);
    if (!config) {
      throw new Error(
        'B2_NOT_CONFIGURED: مفاتيح Backblaze B2 السرية غير مضبوطة في متغيرات الخادم بعد.'
      );
    }

    const fingerprint = `${config.endpoint}|${config.region}|${config.bucketName}|${config.keyId.length}`;
    if (!cachedClient || cachedConfigKey !== fingerprint) {
      cachedClient = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.keyId,
          secretAccessKey: config.applicationKey,
        },
        // Keep presigned URLs clean for browser PUT uploads against Backblaze B2 S3 API
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      cachedConfigKey = fingerprint;
    }

    return { client: cachedClient, config };
  };

  return {
    isConfigured(): boolean {
      return readB2ConfigFromEnv(env) !== null;
    },

    async createPresignedUploadUrl(params): Promise<PresignedUploadOutput> {
      const { client, config } = getClientAndConfig();
      const ttl = params.expiresInSeconds ?? PRESIGNED_UPLOAD_TTL_SECONDS;
      const command = new PutObjectCommand({
        Bucket: config.bucketName,
        Key: params.key,
        ContentType: params.contentType,
        ContentLength: params.sizeBytes,
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn: ttl });
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      return {
        uploadUrl,
        expiresAt,
        expiresInSeconds: ttl,
      };
    },

    async createPresignedDownloadUrl(params): Promise<PresignedDownloadOutput> {
      const { client, config } = getClientAndConfig();
      const ttl = params.expiresInSeconds ?? PRESIGNED_DOWNLOAD_TTL_SECONDS;
      const disp = params.disposition === 'attachment' ? 'attachment' : 'inline';
      const safeFallbackName = params.fileName.replace(/[^\w.\- ]+/g, '_') || 'attachment';
      const contentDisposition = `${disp}; filename="${safeFallbackName}"; filename*=UTF-8''${encodeRfc5987Value(
        params.fileName
      )}`;

      const command = new GetObjectCommand({
        Bucket: config.bucketName,
        Key: params.key,
        ResponseContentDisposition: contentDisposition,
        ResponseContentType: params.contentType,
      });

      const downloadUrl = await getSignedUrl(client, command, { expiresIn: ttl });
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      return {
        downloadUrl,
        expiresAt,
        expiresInSeconds: ttl,
      };
    },

    async verifyUploadedObject(params): Promise<VerifiedB2Object> {
      const { client, config } = getClientAndConfig();

      let headRes;
      try {
        headRes = await client.send(
          new HeadObjectCommand({
            Bucket: config.bucketName,
            Key: params.key,
          })
        );
      } catch {
        return {
          verified: false,
          sizeBytes: 0,
          reasonArabic: 'لم يتم العثور على الملف المرفوع داخل Backblaze B2 أو لم يكتمل الرفع.',
        };
      }

      const actualSize = Number(headRes.ContentLength ?? 0);
      if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > MAX_ATTACHMENT_SIZE_BYTES) {
        await this.deleteObject(params.key).catch(() => {});
        return {
          verified: false,
          sizeBytes: actualSize,
          reasonArabic: 'حجم الملف الفعلي على الخادم فارغ أو يتجاوز الحد الأقصى (10 ميجابايت).',
        };
      }

      if (actualSize !== params.expectedSizeBytes) {
        await this.deleteObject(params.key).catch(() => {});
        return {
          verified: false,
          sizeBytes: actualSize,
          reasonArabic: 'حجم الملف المرفوع لا يطابق الحجم المسجل في الطلب.',
        };
      }

      // Inspect leading magic bytes of the uploaded object before approving metadata
      const rangeRes = await client.send(
        new GetObjectCommand({
          Bucket: config.bucketName,
          Key: params.key,
          Range: 'bytes=0-15',
        })
      );
      const headerBytes = await readStreamFirstBytes(rangeRes.Body, 16);
      if (!verifyMagicBytes(headerBytes, params.expectedContentType)) {
        await this.deleteObject(params.key).catch(() => {});
        return {
          verified: false,
          sizeBytes: actualSize,
          reasonArabic:
            'محتوى الملف المرفوع لا يطابق الصيغة المسموح بها (فشل فحص البصمة الثنائية). تم حذف الملف لحماية النظام.',
        };
      }

      return {
        verified: true,
        sizeBytes: actualSize,
        contentType: headRes.ContentType || params.expectedContentType,
        etag: headRes.ETag ? headRes.ETag.replace(/"/g, '').slice(0, 128) : undefined,
      };
    },

    async deleteObject(key: string): Promise<void> {
      const { client, config } = getClientAndConfig();
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucketName,
          Key: key,
        })
      );
    },
  };
}
