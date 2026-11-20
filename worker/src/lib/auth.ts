import type { AuthContext, Env } from "../env";
import { randomToken, sha256Hex, timingSafeEqual } from "./crypto";
import { HttpError, parseCookies, serializeCookie } from "./http";

export const SESSION_COOKIE = "__Host-mahan_session";

export async function createSession(env: Env, req: Request, userId: string) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const ttlMs = Number(env.SESSION_TTL_HOURS ?? "168") * 3_600_000;
  const now = Date.now();
  const id = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(id, userId, csrfToken, now, now + ttlMs, req.headers.get("cf-connecting-ip"), (req.headers.get("user-agent") ?? "").slice(0, 300))
    .run();
  return { cookie: serializeCookie(SESSION_COOKIE, token, { maxAge: ttlMs / 1000 }), csrfToken };
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export async function getSession(env: Env, req: Request): Promise<AuthContext | null> {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT id, user_id, csrf_token, expires_at FROM sessions WHERE id = ?")
    .bind(id)
    .first<{ id: string; user_id: string; csrf_token: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return { userId: row.user_id, sessionId: row.id, csrfToken: row.csrf_token };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origin check + synchronizer CSRF token (bound to the session) for every state change. */
export function assertCsrf(env: Env, req: Request, auth: AuthContext | null) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (origin && origin !== env.APP_ORIGIN) throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
  if (!origin && req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "bad_origin", "Cross-site request rejected");
  if (auth) {
    const header = req.headers.get("x-csrf-token") ?? "";
    if (!timingSafeEqual(header, auth.csrfToken)) throw new HttpError(403, "csrf_failed", "Invalid CSRF token");
  }
}

/** Fixed-window limiter in D1. Pair with Cloudflare WAF rate-limiting rules in production. */
export async function rateLimit(env: Env, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
  }
}

export async function logActivity(env: Env, ownerId: string, action: string, entityType: string, entityId: string | null, summary: string) {
  await env.DB.prepare(
    "INSERT INTO activity_records (id, owner_id, action, entity_type, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), ownerId, action, entityType, entityId, summary.slice(0, 300), Date.now())
    .run();
}
