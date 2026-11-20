import { fromBase64Url, toBase64Url, toHex, utf8 } from "./encoding";

// Cloudflare Workers caps PBKDF2 at 100,000 iterations; argon2/bcrypt are not native.
export const PBKDF2_ITERATIONS = 100_000;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}
export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const d = typeof data === "string" ? utf8(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", d));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = utf8(a);
  const y = utf8(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const salt = fromBase64Url(parts[2] ?? "");
  const expected = parts[3] ?? "";
  const actual = toBase64Url(await pbkdf2(password, salt, iterations));
  return timingSafeEqual(actual, expected);
}

export async function hmacSha256(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? utf8(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, utf8(data)));
}

/** Short-lived signed token binding a user to a resource (used for media streaming URLs). */
export async function signResourceToken(secret: string, userId: string, resource: string, expiresAt: number): Promise<string> {
  return toBase64Url(await hmacSha256(secret, `${userId}:${resource}:${expiresAt}`));
}
export async function verifyResourceToken(
  secret: string,
  userId: string,
  resource: string,
  expiresAt: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = await signResourceToken(secret, userId, resource, expiresAt);
  return timingSafeEqual(expected, sig);
}
