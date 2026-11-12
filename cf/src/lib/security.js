// Passwords, sessions, two-step codes and the headers every response carries.
// Nothing here ever stores or returns a password.

const enc = new TextEncoder();
const PBKDF2_ROUNDS = 100000; // the most Cloudflare Workers' WebCrypto allows
export const STAFF_IDLE_SECONDS = 45 * 60;
export const STAFF_MAX_SECONDS = 12 * 60 * 60;
export const CUSTOMER_IDLE_SECONDS = 30 * 24 * 60 * 60;
export const CUSTOMER_MAX_SECONDS = 90 * 24 * 60 * 60;
export const STAFF_COOKIE = "__Host-tla_staff";
export const CUSTOMER_COOKIE = "__Host-tla_user";

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomId = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/* ---------------------------------------------------------------- passwords */
export async function hashPassword(password, rounds = PBKDF2_ROUNDS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, key, 256);
  return `pbkdf2$${rounds}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, rounds, salt, want] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(salt), iterations: Number(rounds), hash: "SHA-256" }, key, 256);
    return timingSafeEqual(b64(bits), want);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= x.charCodeAt(i % x.length) ^ y.charCodeAt(i % y.length);
  return diff === 0;
}

// Rejects the passwords that get accounts broken into.
export function passwordProblem(password, { email = "", name = "" } = {}) {
  const p = String(password || "");
  if (p.length < 10) return "Use at least 10 characters.";
  if (p.length > 200) return "That password is too long.";
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Use both letters and numbers.";
  const weak = ["password", "12345678", "qwerty", "letmein", "welcome", "admin123", "twinslocs", "cleankawi"];
  const low = p.toLowerCase();
  if (weak.some((w) => low.includes(w))) return "That password is too easy to guess.";
  const local = String(email).split("@")[0].toLowerCase();
  if (local.length > 3 && low.includes(local)) return "Don’t put your email address in your password.";
  if (name && String(name).toLowerCase().split(/\s+/).some((w) => w.length > 3 && low.includes(w))) return "Don’t put your name in your password.";
  return "";
}

/* ---------------------------------------------------------------- cookies */
export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export const setCookie = (name, value, seconds, { sameSite = "Lax" } = {}) =>
  `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=${sameSite}`;
export const clearCookie = (name) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/* ---------------------------------------------------------------- sessions */
export async function createSession(db, { subjectType, subjectId, request, twoFactorOk = 0 }) {
  const token = randomId(32);
  const idle = subjectType === "staff" ? STAFF_IDLE_SECONDS : CUSTOMER_IDLE_SECONDS;
  const max = subjectType === "staff" ? STAFF_MAX_SECONDS : CUSTOMER_MAX_SECONDS;
  const uaHash = (await sha256(request.headers.get("user-agent") || "")).slice(0, 24);
  await db
    .prepare(`INSERT INTO sessions (id, subject_type, subject_id, expires_at, idle_seconds, ua_hash, two_factor_ok)
              VALUES (?1, ?2, ?3, datetime('now', ?4), ?5, ?6, ?7)`)
    .bind(await sha256(token), subjectType, subjectId, `+${max} seconds`, idle, uaHash, twoFactorOk ? 1 : 0)
    .run();
  return { token, maxAge: max };
}

export async function readSession(db, request, cookieName) {
  const token = readCookie(request, cookieName);
  if (!token) return null;
  const id = await sha256(token);
  const row = await db
    .prepare(`SELECT * FROM sessions WHERE id = ?1
                AND expires_at > datetime('now')
                AND datetime(last_seen_at, '+' || idle_seconds || ' seconds') > datetime('now')`)
    .bind(id)
    .first();
  if (!row) return null;
  const uaHash = (await sha256(request.headers.get("user-agent") || "")).slice(0, 24);
  if (row.ua_hash && !timingSafeEqual(row.ua_hash, uaHash)) return null; // cookie moved to another browser
  return { ...row, token };
}

export const touchSession = (db, id) => db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?1").bind(id).run();
export const destroySession = (db, id) => db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
export const destroySubjectSessions = (db, type, id) =>
  db.prepare("DELETE FROM sessions WHERE subject_type = ?1 AND subject_id = ?2").bind(type, id).run();
export const cleanupSessions = (db) =>
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')
                OR datetime(last_seen_at, '+' || idle_seconds || ' seconds') <= datetime('now')`).run();

/* ---------------------------------------------------------------- lockouts */
export async function lockoutState(db, key) {
  const row = await db.prepare("SELECT fails, locked_until FROM login_attempts WHERE key = ?1").bind(key).first();
  if (!row) return { locked: false, fails: 0 };
  const locked = row.locked_until ? Date.parse(`${row.locked_until}Z`) > Date.now() : false;
  return { locked, fails: row.fails, until: row.locked_until };
}

export async function noteFailure(db, key) {
  const { fails } = await lockoutState(db, key);
  const next = fails + 1;
  // 5 misses → 15 min, then doubling up to 2 hours.
  const lockMinutes = next < 5 ? 0 : Math.min(120, 15 * 2 ** (next - 5));
  await db
    .prepare(`INSERT INTO login_attempts (key, fails, locked_until, updated_at)
              VALUES (?1, ?2, CASE WHEN ?3 > 0 THEN datetime('now', '+' || ?3 || ' minutes') END, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET fails = ?2,
                locked_until = CASE WHEN ?3 > 0 THEN datetime('now', '+' || ?3 || ' minutes') ELSE locked_until END,
                updated_at = datetime('now')`)
    .bind(key, next, lockMinutes)
    .run();
  return { fails: next, lockMinutes };
}

export const clearFailures = (db, key) => db.prepare("DELETE FROM login_attempts WHERE key = ?1").bind(key).run();

/* ---------------------------------------------------------------- one-time tokens */
export async function issueToken(db, { kind, subjectType, subjectId, minutes = 60 }) {
  const token = randomId(32);
  await db.prepare("DELETE FROM auth_tokens WHERE kind = ?1 AND subject_type = ?2 AND subject_id = ?3 AND used_at IS NULL")
    .bind(kind, subjectType, subjectId).run();
  await db
    .prepare(`INSERT INTO auth_tokens (id, kind, subject_type, subject_id, expires_at)
              VALUES (?1, ?2, ?3, ?4, datetime('now', ?5))`)
    .bind(await sha256(token), kind, subjectType, subjectId, `+${minutes} minutes`)
    .run();
  return token;
}

export async function useToken(db, kind, token) {
  if (!token) return null;
  const id = await sha256(token);
  const row = await db
    .prepare("SELECT * FROM auth_tokens WHERE id = ?1 AND kind = ?2 AND used_at IS NULL AND expires_at > datetime('now')")
    .bind(id, kind)
    .first();
  if (!row) return null;
  await db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?1").bind(id).run();
  return row;
}

/* ---------------------------------------------------------------- two-step codes (TOTP) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(length = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret) {
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

export async function totpCode(secret, counter) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const data = new ArrayBuffer(8);
  const view = new DataView(data);
  view.setUint32(4, counter);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1000000).padStart(6, "0");
}

// Accepts the code before and after, so a slow clock still works.
export async function verifyTotp(secret, code, now = Date.now()) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6 || !secret) return false;
  const step = Math.floor(now / 1000 / 30);
  for (const c of [step - 1, step, step + 1]) if (timingSafeEqual(await totpCode(secret, c), clean)) return true;
  return false;
}

export const totpUri = (secret, email, issuer = "Twins Locs Arena") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`;

/* ---------------------------------------------------------------- request guards */
// Blocks forms posted from other websites (CSRF).
export function sameOrigin(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("x-tla-app") === "1"; // same-origin fetch from our pages
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function securityHeaders({ page = false, googleSignIn = false, nonce = "" } = {}) {
  // Scripts are the real danger, so they are locked to a one-time nonce and never
  // to 'unsafe-inline'. Styles keep 'unsafe-inline' because style="..." attributes
  // cannot carry a nonce; a stylesheet cannot run code, so the risk is cosmetic.
  const scriptSrc = nonce ? `'nonce-${nonce}'` : "'self'";
  const styleSrc = "'unsafe-inline'";
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' ${scriptSrc}${googleSignIn ? " https://accounts.google.com/gsi/client" : ""}`,
    `connect-src 'self'${googleSignIn ? " https://accounts.google.com/gsi/" : ""}`,
    `style-src 'self' ${styleSrc} https://fonts.googleapis.com${googleSignIn ? " https://accounts.google.com/gsi/style" : ""}`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    googleSignIn ? "frame-src https://accounts.google.com/gsi/" : "frame-src 'none'",
  ].join("; ");
  const headers = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": googleSignIn ? "same-origin-allow-popups" : "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
  if (page) headers["Cache-Control"] = "no-store";
  return headers;
}
