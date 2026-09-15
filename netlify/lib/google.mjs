// Verifies a "Sign in with Google" ID token (RS256 JWT) against Google's public keys.

import { createPublicKey, verify } from "node:crypto";

let certs = { keys: null, until: 0 };

async function googleKeys() {
  if (certs.keys && Date.now() < certs.until) return certs.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error("Google sign-in is unavailable right now. Try again in a minute."), { status: 503 });
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") || "")?.[1]) || 3600;
  certs = { keys: (await r.json()).keys, until: Date.now() + maxAge * 1000 };
  return certs.keys;
}

const rejected = () => Object.assign(new Error("Google sign-in couldn't be confirmed. Try again."), { status: 401 });

export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw rejected();
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url"));
  } catch {
    throw rejected();
  }
  if (header.alg !== "RS256") throw rejected();

  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { certs.until = 0; jwk = (await googleKeys()).find((k) => k.kid === header.kid); } // keys rotated
  if (!jwk) throw rejected();

  const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  const now = Date.now() / 1000;
  if (!ok) throw rejected();
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw rejected();
  if (payload.aud !== clientId) throw rejected();
  if (!payload.exp || payload.exp < now - 60) throw rejected();
  if (!payload.sub || !payload.email || payload.email_verified === false) throw rejected();
  return payload;
}
