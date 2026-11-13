import { isPresignedUrlExpired } from './attachmentPolicy.ts';

export interface CachedDownloadEntry {
  uid: string;
  url: string;
  expiresAt: string;
}

const downloadUrlMemoryCache = new Map<string, CachedDownloadEntry>();
let activeCacheUid: string | null = null;

function buildCacheKey(
  uid: string,
  meetingId: string,
  attachmentId: string,
  disposition: 'inline' | 'attachment'
): string {
  return `${uid}:${meetingId}:${attachmentId}:${disposition}`;
}

export function clearAttachmentDownloadCache(): void {
  downloadUrlMemoryCache.clear();
  activeCacheUid = null;
}

export function syncAttachmentCacheUser(uid: string | null): void {
  if (!uid || activeCacheUid !== uid) {
    downloadUrlMemoryCache.clear();
    activeCacheUid = uid || null;
  }
}

export function getCachedPresignedDownloadUrl(params: {
  uid: string;
  meetingId: string;
  attachmentId: string;
  disposition: 'inline' | 'attachment';
  nowMs?: number;
}): { downloadUrl: string; expiresAt: string } | null {
  const { uid, meetingId, attachmentId, disposition, nowMs = Date.now() } = params;
  if (!uid) {
    clearAttachmentDownloadCache();
    return null;
  }
  if (activeCacheUid !== uid) {
    syncAttachmentCacheUser(uid);
    return null;
  }
  const key = buildCacheKey(uid, meetingId, attachmentId, disposition);
  const entry = downloadUrlMemoryCache.get(key);
  if (!entry || entry.uid !== uid) {
    downloadUrlMemoryCache.delete(key);
    return null;
  }
  if (isPresignedUrlExpired(entry.expiresAt, nowMs, 10_000)) {
    downloadUrlMemoryCache.delete(key);
    return null;
  }
  return {
    downloadUrl: entry.url,
    expiresAt: entry.expiresAt,
  };
}

export function setCachedPresignedDownloadUrl(params: {
  uid: string;
  meetingId: string;
  attachmentId: string;
  disposition: 'inline' | 'attachment';
  url: string;
  expiresAt: string;
}): void {
  const { uid, meetingId, attachmentId, disposition, url, expiresAt } = params;
  if (!uid) return;
  syncAttachmentCacheUser(uid);
  const key = buildCacheKey(uid, meetingId, attachmentId, disposition);
  downloadUrlMemoryCache.set(key, { uid, url, expiresAt });
}

export function invalidateAttachmentDownloadCacheEntry(params: {
  uid?: string | null;
  meetingId: string;
  attachmentId: string;
}): void {
  const targetUid = params.uid ?? activeCacheUid;
  if (!targetUid) return;
  downloadUrlMemoryCache.delete(
    buildCacheKey(targetUid, params.meetingId, params.attachmentId, 'inline')
  );
  downloadUrlMemoryCache.delete(
    buildCacheKey(targetUid, params.meetingId, params.attachmentId, 'attachment')
  );
}

export function getDownloadCacheSnapshotForTesting(): {
  activeUid: string | null;
  size: number;
  keys: string[];
} {
  return {
    activeUid: activeCacheUid,
    size: downloadUrlMemoryCache.size,
    keys: Array.from(downloadUrlMemoryCache.keys()),
  };
}
