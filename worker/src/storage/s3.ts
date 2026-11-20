import { presignUrl, rfc3986, signRequest, type SigV4Credentials } from "../lib/sigv4";
import {
  assertSafeKey, contentDisposition, StorageError,
  type DownloadResult, type PresignedRequest, type StorageCapabilities, type StorageObject, type StorageProvider, type StorageUsage,
} from "./types";

export interface S3Config {
  id: string;
  endpoint: string; // e.g. https://s3.eu-central-1.amazonaws.com or https://<acct>.r2.cloudflarestorage.com
  region: string;
  bucket: string;
  credentials: SigV4Credentials | null; // read from Worker secrets by the caller; never from the client
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const USAGE_LIST_PAGE_CAP = 20; // 20k objects max per usage scan to bound Worker CPU

/** Generic S3-compatible adapter (path-style addressing, SigV4). */
export class S3CompatibleProvider implements StorageProvider {
  readonly kind = "s3" as const;
  readonly id: string;
  readonly capabilities: StorageCapabilities = {
    list: true, upload: true, download: true, delete: true, rename: true, createFolder: true,
    metadata: true, usage: true, presignedUpload: true, presignedDownload: true, rangeStreaming: true,
  };
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: S3Config) {
    this.id = cfg.id;
    const u = new URL(cfg.endpoint);
    if (u.protocol !== "https:") throw new StorageError("invalid_input", "Endpoint must use HTTPS");
    this.fetchImpl = cfg.fetchImpl ?? fetch.bind(globalThis);
  }

  private creds(): SigV4Credentials {
    if (!this.cfg.credentials) throw new StorageError("not_configured", "Credentials are not configured as Worker secrets");
    return this.cfg.credentials;
  }
  private objectUrl(key?: string): string {
    const base = this.cfg.endpoint.replace(/\/$/, "");
    const path = key ? `/${rfc3986(this.cfg.bucket)}/${key.split("/").map(rfc3986).join("/")}` : `/${rfc3986(this.cfg.bucket)}`;
    return base + path;
  }
  private async send(method: string, url: string, headers: Record<string, string> = {}, body?: BodyInit | null): Promise<Response> {
    const signed = await signRequest({ method, url, credentials: this.creds(), headers, ...(this.cfg.now ? { date: this.cfg.now() } : {}) });
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers: signed, body: body ?? null });
    } catch (e) {
      throw new StorageError("provider_error", `Network error: ${(e as Error).message}`);
    }
    if (res.ok || res.status === 206) return res;
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
    if (res.status === 404) throw new StorageError("not_found", code || "Object not found", 404);
    if (res.status === 401 || res.status === 403) throw new StorageError("auth_failed", code || "Access denied by provider", res.status);
    throw new StorageError("provider_error", `${res.status} ${code}`.trim(), res.status);
  }

  async listFiles(prefix = "", cursor?: string, limit = 200) {
    const u = new URL(this.objectUrl());
    u.searchParams.set("list-type", "2");
    u.searchParams.set("delimiter", "/");
    u.searchParams.set("max-keys", String(Math.min(1000, limit)));
    if (prefix) u.searchParams.set("prefix", prefix);
    if (cursor) u.searchParams.set("continuation-token", cursor);
    const xml = await (await this.send("GET", u.toString())).text();
    return parseListXml(xml);
  }

  async uploadFile(key: string, body: ReadableStream | ArrayBuffer | string, contentType: string): Promise<StorageObject> {
    assertSafeKey(key);
    await this.send("PUT", this.objectUrl(key), { "content-type": contentType }, body as BodyInit);
    return { key, size: typeof body === "string" ? body.length : body instanceof ArrayBuffer ? body.byteLength : 0, contentType };
  }

  async createUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedRequest> {
    assertSafeKey(key);
    const url = await presignUrl({ method: "PUT", url: this.objectUrl(key), credentials: this.creds(), expiresInSeconds, ...(this.cfg.now ? { date: this.cfg.now() } : {}) });
    return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresAt: Date.now() + expiresInSeconds * 1000 };
  }

  async downloadFile(key: string, range?: { offset: number; length: number }): Promise<DownloadResult> {
    assertSafeKey(key);
    const headers: Record<string, string> = range ? { range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : {};
    const res = await this.send("GET", this.objectUrl(key), headers);
    if (!res.body) throw new StorageError("provider_error", "Empty body");
    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? "0");
    return { body: res.body, size: total, contentType: res.headers.get("content-type") ?? "application/octet-stream", ...(range ? { range } : {}) };
  }

  async createDownloadUrl(key: string, expiresInSeconds: number, filename?: string): Promise<PresignedRequest> {
    assertSafeKey(key);
    const url = await presignUrl({
      method: "GET", url: this.objectUrl(key), credentials: this.creds(), expiresInSeconds,
      ...(filename ? { extraQuery: { "response-content-disposition": contentDisposition(filename) } } : {}),
      ...(this.cfg.now ? { date: this.cfg.now() } : {}),
    });
    return { url, method: "GET", headers: {}, expiresAt: Date.now() + expiresInSeconds * 1000 };
  }

  async deleteFile(key: string) {
    assertSafeKey(key);
    await this.send("DELETE", this.objectUrl(key));
  }

  async renameFile(fromKey: string, toKey: string) {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    const source = `/${this.cfg.bucket}/${fromKey}`.split("/").map(rfc3986).join("/");
    await this.send("PUT", this.objectUrl(toKey), { "x-amz-copy-source": source });
    await this.deleteFile(fromKey);
  }

  async createFolder(prefix: string) {
    const key = prefix.endsWith("/") ? prefix : `${prefix}/`;
    assertSafeKey(key);
    await this.send("PUT", this.objectUrl(key), { "content-type": "application/x-directory" }, "");
  }

  async getFileMetadata(key: string): Promise<StorageObject | null> {
    assertSafeKey(key);
    try {
      const res = await this.send("HEAD", this.objectUrl(key));
      return {
        key,
        size: Number(res.headers.get("content-length") ?? "0"),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        ...(res.headers.get("last-modified") ? { lastModified: new Date(res.headers.get("last-modified") as string).toISOString() } : {}),
        ...(res.headers.get("etag") ? { etag: res.headers.get("etag") as string } : {}),
      };
    } catch (e) {
      if (e instanceof StorageError && e.code === "not_found") return null;
      throw e;
    }
  }

  async getStorageUsage(): Promise<StorageUsage> {
    let bytes = 0, objects = 0, cursor: string | undefined, pages = 0;
    do {
      const u = new URL(this.objectUrl());
      u.searchParams.set("list-type", "2");
      if (cursor) u.searchParams.set("continuation-token", cursor);
      const r = parseListXml(await (await this.send("GET", u.toString())).text());
      for (const o of r.items) { bytes += o.size; objects++; }
      cursor = r.cursor;
      pages++;
    } while (cursor && pages < USAGE_LIST_PAGE_CAP);
    return { bytes, objects, source: "provider", truncated: Boolean(cursor) };
  }

  async testConnection() {
    try {
      const u = new URL(this.objectUrl());
      u.searchParams.set("list-type", "2");
      u.searchParams.set("max-keys", "1");
      await this.send("GET", u.toString());
      return { ok: true, message: "Bucket reachable with configured credentials" };
    } catch (e) {
      return { ok: false, message: e instanceof StorageError ? `${e.code}: ${e.message}` : "Unknown error" };
    }
  }
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
export function parseListXml(xml: string): { items: StorageObject[]; cursor?: string } {
  const items: StorageObject[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1] ?? "";
    const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1] ?? "");
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? "0");
    const lm = /<LastModified>([^<]+)<\/LastModified>/.exec(block)?.[1];
    items.push({ key, size, ...(lm ? { lastModified: lm } : {}) });
  }
  for (const m of xml.matchAll(/<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>\s*<\/CommonPrefixes>/g)) {
    items.push({ key: decodeXml(m[1] ?? ""), size: 0, isFolder: true });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  return truncated && next ? { items, cursor: decodeXml(next) } : { items };
}
