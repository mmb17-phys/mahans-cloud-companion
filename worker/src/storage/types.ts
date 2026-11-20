export type ProviderKind = "r2" | "s3" | "mega";

export interface StorageCapabilities {
  list: boolean;
  upload: boolean;
  download: boolean;
  delete: boolean;
  rename: boolean;
  createFolder: boolean;
  metadata: boolean;
  usage: boolean;
  presignedUpload: boolean;
  presignedDownload: boolean;
  rangeStreaming: boolean;
}

export const NO_CAPABILITIES: StorageCapabilities = {
  list: false, upload: false, download: false, delete: false, rename: false, createFolder: false,
  metadata: false, usage: false, presignedUpload: false, presignedDownload: false, rangeStreaming: false,
};

export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: string;
  etag?: string;
  isFolder?: boolean;
}

export interface PresignedRequest {
  url: string;
  method: "GET" | "PUT";
  headers: Record<string, string>;
  expiresAt: number;
}

export interface DownloadResult {
  body: ReadableStream;
  size: number;
  contentType: string;
  range?: { offset: number; length: number };
}

export interface StorageUsage {
  bytes: number;
  objects: number;
  /** "provider" = counted by listing the provider, "unavailable" = provider cannot report */
  source: "provider" | "unavailable";
  truncated?: boolean;
}

export type StorageErrorCode = "unsupported" | "not_configured" | "not_found" | "auth_failed" | "invalid_input" | "provider_error";

export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string,
    public providerStatus?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface StorageProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: StorageCapabilities;
  listFiles(prefix?: string, cursor?: string, limit?: number): Promise<{ items: StorageObject[]; cursor?: string }>;
  uploadFile(key: string, body: ReadableStream | ArrayBuffer | string, contentType: string): Promise<StorageObject>;
  createUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedRequest>;
  downloadFile(key: string, range?: { offset: number; length: number }): Promise<DownloadResult>;
  createDownloadUrl(key: string, expiresInSeconds: number, filename?: string): Promise<PresignedRequest>;
  deleteFile(key: string): Promise<void>;
  renameFile(fromKey: string, toKey: string): Promise<void>;
  createFolder(prefix: string): Promise<void>;
  getFileMetadata(key: string): Promise<StorageObject | null>;
  getStorageUsage(): Promise<StorageUsage>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** Reject keys that could escape a prefix or confuse providers. */
export function assertSafeKey(key: string): void {
  // eslint-disable-next-line no-control-regex
  if (!key || key.length > 1024 || key.startsWith("/") || key.split("/").some((s) => s === ".." || s === ".") || /[\u0000-\u001f]/.test(key)) {
    throw new StorageError("invalid_input", "Unsafe object key");
  }
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
