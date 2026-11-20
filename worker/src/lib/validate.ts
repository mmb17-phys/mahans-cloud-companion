import { HttpError } from "./http";

const bad = (field: string, msg: string) => new HttpError(400, "validation_error", `${field}: ${msg}`);

export function str(body: Record<string, unknown>, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const v = body[field];
  if (v === undefined || v === null) {
    if (opts.optional) return "";
    throw bad(field, "required");
  }
  if (typeof v !== "string") throw bad(field, "must be a string");
  const s = v.normalize("NFC");
  if (s.length < (opts.min ?? 0)) throw bad(field, `min length ${opts.min}`);
  if (s.length > (opts.max ?? 10_000)) throw bad(field, `max length ${opts.max ?? 10_000}`);
  return s;
}
export function optStr(body: Record<string, unknown>, field: string, max = 10_000): string | undefined {
  if (body[field] === undefined) return undefined;
  return str(body, field, { max });
}
export function nullableId(body: Record<string, unknown>, field: string): string | null | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || !isId(v)) throw bad(field, "invalid id");
  return v;
}
export function int(body: Record<string, unknown>, field: string, min: number, max: number): number {
  const v = body[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(field, `integer ${min}..${max}`);
  return v;
}
export function bool(body: Record<string, unknown>, field: string): boolean | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw bad(field, "must be boolean");
  return v;
}
export function isId(v: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(v) || v === "r2-primary";
}
export function email(body: Record<string, unknown>, field = "email"): string {
  const s = str(body, field, { min: 3, max: 254 }).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(field, "invalid email");
  return s;
}
/** File / folder display names: no path separators or control characters. */
export function safeName(body: Record<string, unknown>, field = "name"): string {
  const s = str(body, field, { min: 1, max: 255 }).trim();
  // eslint-disable-next-line no-control-regex
  if (!s || /[\/\\\u0000-\u001f\u007f]/.test(s) || s === "." || s === "..") throw bad(field, "invalid name");
  return s;
}
export function pagination(url: URL): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page") ?? "1") || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") ?? "30") || 30));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
/** Escape LIKE wildcards; queries use `ESCAPE '\'`. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
