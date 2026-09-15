// Checks the staff session cookie set by netlify/edge-functions/admin-auth.js.
// Must stay in step with the token format there.

const enc = new TextEncoder();
export const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? "";

async function hmac(message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env("ADMIN_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Buffer.from(sig).toString("base64url");
}

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([hmac("cmp:" + a), hmac("cmp:" + b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function readCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

/* customer sessions (Sign in with Google) */
export const USER_COOKIE = "tla_user";
export const USER_SESSION_DAYS = 30;

export async function makeUserCookie(sub) {
  const exp = Math.floor(Date.now() / 1000) + USER_SESSION_DAYS * 86400;
  const token = `${Buffer.from(sub).toString("base64url")}.${exp}.${await hmac(`user:${sub}:${exp}`)}`;
  return `${USER_COOKIE}=${token}; Path=/; Max-Age=${USER_SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearUserCookie = () => `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function userFromRequest(req) {
  if (!env("ADMIN_SECRET")) return null;
  const [s64, exp, sig] = readCookie(req, USER_COOKIE).split(".");
  if (!s64 || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const sub = Buffer.from(s64, "base64url").toString();
  return (await safeEqual(sig, await hmac(`user:${sub}:${exp}`))) ? sub : null;
}

export async function isAdmin(req) {
  if (!env("ADMIN_SECRET") || !env("ADMIN_USER")) return false;
  const token = readCookie(req, "tla_admin");
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`session:${exp}:${env("ADMIN_USER")}`));
}
