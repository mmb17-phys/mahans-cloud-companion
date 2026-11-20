// Minimal, dependency-free typings for the Cloudflare bindings this Worker uses.
// They mirror @cloudflare/workers-types; swap in that package if preferred.
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface R2Range {
  offset: number;
  length?: number;
}
export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}
export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}
export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: { range?: R2Range }): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    delimiter?: string;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string; delimitedPrefixes?: string[] }>;
}

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ORIGIN: string;
  R2_BUCKET_NAME: string;
  SESSION_TTL_HOURS?: string;
  SESSION_SECRET?: string;
  SETUP_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  csrfToken: string;
}
