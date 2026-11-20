// AWS Signature Version 4 (query presigning + header signing) on WebCrypto.
// Used server-side only; credentials never leave the Worker.
import { toHex, utf8 } from "./encoding";
import { hmacSha256, sha256Hex } from "./crypto";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join("/");
}
function amzDates(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}
async function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmacSha256(utf8(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}
function canonicalQuery(params: [string, string][]): string {
  return params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export async function presignUrl(opts: {
  method: "GET" | "PUT" | "HEAD";
  url: string;
  credentials: SigV4Credentials;
  expiresInSeconds: number;
  date?: Date;
  extraQuery?: Record<string, string>;
}): Promise<string> {
  const { credentials: c } = opts;
  const service = c.service ?? "s3";
  if (opts.expiresInSeconds < 1 || opts.expiresInSeconds > 604800) throw new Error("Invalid expiry");
  const u = new URL(opts.url);
  const { amzDate, dateStamp } = amzDates(opts.date ?? new Date());
  const scope = `${dateStamp}/${c.region}/${service}/aws4_request`;
  const params: [string, string][] = [...u.searchParams.entries()];
  for (const [k, v] of Object.entries(opts.extraQuery ?? {})) params.push([k, v]);
  params.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${c.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(opts.expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  );
  const query = canonicalQuery(params);
  const path = canonicalPath(u.pathname);
  const canonicalRequest = [opts.method, path, query, `host:${u.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const key = await signingKey(c.secretAccessKey, dateStamp, c.region, service);
  const signature = toHex(await hmacSha256(key, stringToSign));
  return `${u.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** Signs a request with Authorization header (UNSIGNED-PAYLOAD body hash). */
export async function signRequest(opts: {
  method: string;
  url: string;
  credentials: SigV4Credentials;
  headers?: Record<string, string>;
  date?: Date;
}): Promise<Record<string, string>> {
  const c = opts.credentials;
  const service = c.service ?? "s3";
  const u = new URL(opts.url);
  const { amzDate, dateStamp } = amzDates(opts.date ?? new Date());
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: u.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const scope = `${dateStamp}/${c.region}/${service}/aws4_request`;
  const canonicalRequest = [
    opts.method,
    canonicalPath(u.pathname),
    canonicalQuery([...u.searchParams.entries()]),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const key = await signingKey(c.secretAccessKey, dateStamp, c.region, service);
  const signature = toHex(await hmacSha256(key, stringToSign));
  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
