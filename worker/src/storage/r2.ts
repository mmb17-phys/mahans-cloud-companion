import type { R2Bucket } from "../env";
import { S3CompatibleProvider } from "./s3";
import {
  assertSafeKey, StorageError,
  type DownloadResult, type PresignedRequest, type StorageCapabilities, type StorageObject, type StorageProvider, type StorageUsage,
} from "./types";

export interface R2Config {
  bucket: R2Bucket | undefined;
  bucketName: string;
  accountId?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

/**
 * Primary provider: native R2 binding for server-side operations, plus the R2 S3 API
 * (server-held credentials) for short-lived presigned upload/download URLs so large
 * payloads go browser ↔ R2 directly, never through the Worker.
 */
export class R2Provider implements StorageProvider {
  readonly id = "r2-primary";
  readonly kind = "r2" as const;
  readonly capabilities: StorageCapabilities;
  private readonly presigner: S3CompatibleProvider | null;

  constructor(private readonly cfg: R2Config) {
    const canPresign = Boolean(cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey);
    this.presigner = canPresign
      ? new S3CompatibleProvider({
          id: "r2-presign",
          endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
          region: "auto",
          bucket: cfg.bucketName,
          credentials: { accessKeyId: cfg.accessKeyId as string, secretAccessKey: cfg.secretAccessKey as string, region: "auto" },
        })
      : null;
    const bound = Boolean(cfg.bucket);
    this.capabilities = {
      list: bound, upload: bound, download: bound, delete: bound, rename: bound, createFolder: bound,
      metadata: bound, usage: bound, presignedUpload: canPresign, presignedDownload: canPresign, rangeStreaming: bound,
    };
  }

  private b(): R2Bucket {
    if (!this.cfg.bucket) throw new StorageError("not_configured", "R2 binding FILES is not configured");
    return this.cfg.bucket;
  }
  private p(): S3CompatibleProvider {
    if (!this.presigner) throw new StorageError("not_configured", "R2 S3 API credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are not set");
    return this.presigner;
  }

  async listFiles(prefix = "", cursor?: string, limit = 200) {
    const r = await this.b().list({ prefix, limit: Math.min(1000, limit), delimiter: "/", ...(cursor ? { cursor } : {}) });
    const items: StorageObject[] = r.objects.map((o) => ({
      key: o.key, size: o.size, etag: o.etag, lastModified: o.uploaded.toISOString(),
      ...(o.httpMetadata?.contentType ? { contentType: o.httpMetadata.contentType } : {}),
    }));
    for (const p of r.delimitedPrefixes ?? []) items.push({ key: p, size: 0, isFolder: true });
    return r.truncated && r.cursor ? { items, cursor: r.cursor } : { items };
  }

  async uploadFile(key: string, body: ReadableStream | ArrayBuffer | string, contentType: string) {
    assertSafeKey(key);
    const o = await this.b().put(key, body, { httpMetadata: { contentType } });
    return { key: o.key, size: o.size, contentType, etag: o.etag };
  }

  createUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedRequest> {
    return this.p().createUploadUrl(key, contentType, expiresInSeconds);
  }

  async downloadFile(key: string, range?: { offset: number; length: number }): Promise<DownloadResult> {
    assertSafeKey(key);
    const o = await this.b().get(key, range ? { range } : undefined);
    if (!o) throw new StorageError("not_found", "Object not found");
    return { body: o.body, size: o.size, contentType: o.httpMetadata?.contentType ?? "application/octet-stream", ...(range ? { range } : {}) };
  }

  createDownloadUrl(key: string, expiresInSeconds: number, filename?: string) {
    return this.p().createDownloadUrl(key, expiresInSeconds, filename);
  }

  async deleteFile(key: string) {
    assertSafeKey(key);
    await this.b().delete(key);
  }

  async renameFile(fromKey: string, toKey: string) {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    const src = await this.b().get(fromKey);
    if (!src) throw new StorageError("not_found", "Object not found");
    await this.b().put(toKey, src.body, src.httpMetadata?.contentType ? { httpMetadata: { contentType: src.httpMetadata.contentType } } : undefined);
    await this.b().delete(fromKey);
  }

  async createFolder(prefix: string) {
    const key = prefix.endsWith("/") ? prefix : `${prefix}/`;
    assertSafeKey(key);
    await this.b().put(key, "", { httpMetadata: { contentType: "application/x-directory" } });
  }

  async getFileMetadata(key: string) {
    assertSafeKey(key);
    const o = await this.b().head(key);
    if (!o) return null;
    return {
      key: o.key, size: o.size, etag: o.etag, lastModified: o.uploaded.toISOString(),
      ...(o.httpMetadata?.contentType ? { contentType: o.httpMetadata.contentType } : {}),
    };
  }

  async getStorageUsage(): Promise<StorageUsage> {
    let bytes = 0, objects = 0, pages = 0;
    let cursor: string | undefined;
    do {
      const r = await this.b().list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const o of r.objects) { bytes += o.size; objects++; }
      cursor = r.truncated ? r.cursor : undefined;
      pages++;
    } while (cursor && pages < 20);
    return { bytes, objects, source: "provider", truncated: Boolean(cursor) };
  }

  async testConnection() {
    try {
      await this.b().list({ limit: 1 });
      return {
        ok: true,
        message: this.presigner ? "R2 binding reachable; presigned transfers enabled" : "R2 binding reachable; presigned transfers disabled (S3 API credentials missing)",
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Unknown error" };
    }
  }
}
