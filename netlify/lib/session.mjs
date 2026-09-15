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

export async function isAdmin(req) {
  if (!env("ADMIN_SECRET") || !env("ADMIN_USER")) return false;
  const token = readCookie(req, "tla_admin");
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`session:${exp}:${env("ADMIN_USER")}`));
}
