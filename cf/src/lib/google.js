// Checks a "Sign in with Google" token against Google's public keys.

import { HttpError } from "./util.js";

let certs = { keys: null, until: 0 };

async function googleKeys() {
  if (certs.keys && Date.now() < certs.until) return certs.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(503, "Google sign-in is unavailable right now. Try again in a minute.");
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") || "")?.[1]) || 3600;
  certs = { keys: (await r.json()).keys, until: Date.now() + maxAge * 1000 };
  return certs.keys;
}

const rejected = () => new HttpError(401, "Google sign-in couldn’t be confirmed. Try again.");
const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw rejected();
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    throw rejected();
  }
  if (header.alg !== "RS256") throw rejected();

  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) {
    certs.until = 0; // keys rotate; try once more with fresh ones
    jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw rejected();

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Date.now() / 1000;
  if (!ok) throw rejected();
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw rejected();
  if (payload.aud !== clientId) throw rejected();
  if (!payload.exp || payload.exp < now - 60) throw rejected();
  if (!payload.sub || !payload.email || payload.email_verified === false) throw rejected();
  return payload;
}
