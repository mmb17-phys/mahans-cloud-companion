import type { Env } from "../env";
import { MegaProvider } from "./mega";
import { R2Provider } from "./r2";
import { S3CompatibleProvider } from "./s3";
import { StorageError, type StorageProvider } from "./types";

export interface ConnectionRow {
  id: string;
  kind: "s3" | "mega";
  name: string;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  secret_ref: string | null;
}

export const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{1,40}$/;

export function primaryProvider(env: Env): R2Provider {
  return new R2Provider({
    bucket: env.FILES,
    bucketName: env.R2_BUCKET_NAME,
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
}

export function providerFromRow(env: Env, row: ConnectionRow): StorageProvider {
  if (row.kind === "mega") return new MegaProvider(row.id);
  if (!row.endpoint || !row.bucket || !row.region) throw new StorageError("invalid_input", "Incomplete S3 connection");
  const vars = env as unknown as Record<string, string | undefined>;
  const ref = row.secret_ref && SECRET_REF_RE.test(row.secret_ref) ? row.secret_ref : null;
  const ak = ref ? vars[`${ref}_ACCESS_KEY_ID`] : undefined;
  const sk = ref ? vars[`${ref}_SECRET_ACCESS_KEY`] : undefined;
  return new S3CompatibleProvider({
    id: row.id,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    credentials: ak && sk ? { accessKeyId: ak, secretAccessKey: sk, region: row.region } : null,
  });
}

export async function resolveProvider(env: Env, ownerId: string, connectionId: string): Promise<StorageProvider> {
  if (connectionId === "r2-primary") return primaryProvider(env);
  const row = await env.DB.prepare("SELECT id, kind, name, endpoint, region, bucket, secret_ref FROM storage_connections WHERE id = ? AND owner_id = ?")
    .bind(connectionId, ownerId)
    .first<ConnectionRow>();
  if (!row) throw new StorageError("not_found", "Connection not found");
  return providerFromRow(env, row);
}
