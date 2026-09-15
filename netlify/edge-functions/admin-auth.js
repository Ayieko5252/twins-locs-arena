// Guards /admin on Netlify's servers. Credentials live in Netlify environment
// variables (ADMIN_USER, ADMIN_PASS, ADMIN_SECRET), never in this repo.

const COOKIE = "tla_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const enc = new TextEncoder();

const env = (k) => Netlify.env.get(k) || "";

async function hmac(message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env("ADMIN_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Compare via HMAC digests so timing doesn't reveal how much of a guess matched.
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([hmac("cmp:" + a), hmac("cmp:" + b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${exp}.${await hmac(`session:${exp}:${env("ADMIN_USER")}`)}`;
}

async function validToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`session:${exp}:${env("ADMIN_USER")}`));
}

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin" };

function loginPage(error = "", username = "") {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const beads = [2, 7];
  const strand = Array.from({ length: 9 }, (_, i) => {
    const cy = i * 16 + 9, cx = 10 + (i % 2 ? 1.4 : -1.4);
    return `<ellipse class="seg" cx="${cx}" cy="${cy}" rx="6.6" ry="9.6"/>` + (beads.includes(i) ? `<rect class="bead" x="2.5" y="${cy - 4.5}" width="15" height="9" rx="2.5"/>` : "");
  }).join("");
  const svg = `<svg viewBox="0 0 20 148" width="20" height="148" aria-hidden="true">${strand}</svg>`;
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Staff sign in · Twins Locs Arena</title>
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Figtree:wght@400;600;700&display=swap">
<style>
:root{--bg:#E9CB98;--card:#F5E4C3;--field:#FBF1DC;--ink:#2E170D;--ink2:#5B3824;--muted:#7D5A40;--line:rgba(46,23,13,.34);--loc:#7A4424;--gold:#D39A17;--bad:#A2392A;--badbg:rgba(162,57,42,.12);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#1B100A;--card:#2B1A10;--field:#352216;--ink:#F1DAB0;--ink2:#D9BA8C;--muted:#AC8967;--line:rgba(241,218,176,.3);--loc:#A9683C;--gold:#E5B03A;--bad:#EC8A76;--badbg:rgba(236,138,118,.14);color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--ink);font:16px/1.5 Figtree,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{display:flex;align-items:center;gap:18px;width:100%;max-width:470px}
.seg{fill:var(--loc);stroke:var(--ink);stroke-opacity:.28}.bead{fill:var(--gold)}
.wrap>svg:last-child{transform:scaleX(-1) translateY(14px)}
@media (max-width:480px){.wrap>svg{display:none}}
form{flex:1;background:var(--card);border-radius:18px;padding:28px 24px;display:grid;gap:14px;box-shadow:0 18px 40px -22px rgba(46,23,13,.55)}
.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{font:400 1.9rem/1.05 "Young Serif",Georgia,serif;margin:2px 0 4px}
label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:var(--ink2);letter-spacing:.04em}
input{font:inherit;font-size:16px;color:var(--ink);background:var(--field);border:1.5px solid var(--line);border-radius:8px;padding:.7em .8em;width:100%}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:.8em 1.2em;background:var(--ink);color:var(--bg);cursor:pointer;margin-top:4px}
.err{background:var(--badbg);color:var(--bad);font-weight:600;font-size:.9rem;border-radius:8px;padding:.6em .8em;margin:0}
.back{font-size:.88rem;color:var(--muted);text-align:center}
.back a{color:var(--ink)}
</style></head><body>
<div class="wrap">${svg}
<form method="post" action="/admin/login">
  <span class="eyebrow">Twins Locs Arena · Staff</span>
  <h1>Sign in to admin</h1>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
  <label>Username<input name="username" autocomplete="username" value="${esc(username)}" required autofocus></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p class="back"><a href="/">Back to the store</a></p>
</form>${svg}</div>
</body></html>`, { status: error ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8", ...noStore } });
}

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (!env("ADMIN_USER") || !env("ADMIN_PASS") || !env("ADMIN_SECRET")) {
    return new Response("Admin sign-in isn't set up yet. Add ADMIN_USER, ADMIN_PASS and ADMIN_SECRET in Netlify environment variables, then redeploy.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", ...noStore } });
  }

  if (path === "/admin/logout") {
    return new Response(null, { status: 303, headers: { Location: "/admin/login", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`, ...noStore } });
  }

  if (path === "/admin/login") {
    if (request.method === "POST") {
      const form = await request.formData();
      const user = String(form.get("username") || "").trim();
      const pass = String(form.get("password") || "");
      const [okUser, okPass] = await Promise.all([safeEqual(user, env("ADMIN_USER")), safeEqual(pass, env("ADMIN_PASS"))]);
      if (okUser && okPass) {
        return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": `${COOKIE}=${await makeToken()}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`, ...noStore } });
      }
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return loginPage("That username and password don't match. Check capital letters and try again.", user);
    }
    const cookie = context.cookies.get(COOKIE);
    if (await validToken(cookie)) return Response.redirect(new URL("/admin", url), 303);
    return loginPage();
  }

  if (!(await validToken(context.cookies.get(COOKIE)))) {
    return Response.redirect(new URL("/admin/login", url), 303);
  }

  const res = await context.next();
  const out = new Response(res.body, res);
  Object.entries(noStore).forEach(([k, v]) => out.headers.set(k, v));
  return out;
};

export const config = { path: ["/admin", "/admin/*"] };
