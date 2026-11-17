// Staff pages live inside the Worker, not in the public folder, so they can
// only ever be served to someone who is signed in. Each page gets a fresh
// one-time nonce, which is what lets the site run without 'unsafe-inline'.

import opsHtml from "./pages/ops.html";
import setupHtml from "./pages/setup.html";
import staffResetHtml from "./pages/staff-reset.html";
import { randomId, securityHeaders } from "./lib/security.js";
import { currentStaff } from "./routes/staff.js";
import { getSettings, ownerExists } from "./lib/db.js";

function page(html, { googleSignIn = false } = {}) {
  const nonce = randomId(16);
  return new Response(html.replaceAll("__NONCE__", nonce), {
    headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders({ page: true, googleSignIn, nonce }) },
  });
}

const redirect = (to) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });

export async function servePage(path, request, env) {
  if (path === "/ops" || path.startsWith("/ops/")) {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (!staff) return redirect("/?signin=1");
    return page(opsHtml);
  }

  // There is one sign-in for the whole business, on the front page, and what
  // you type there decides where you land. /staff is kept only so old links
  // and bookmarks still arrive somewhere sensible.
  if (path === "/staff") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (staff) return redirect("/ops");
    return redirect("/?signin=1");
  }

  // The one-time first run, where the owner account is claimed. The page sends
  // itself away again once an owner exists.
  if (path === "/setup") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (staff) return redirect("/ops");
    // Once the salon has an owner this page has no reason to exist.
    if (await ownerExists(env.DB).catch(() => true)) return redirect("/?signin=1");
    return page(setupHtml);
  }

  if (path === "/staff-reset") return page(staffResetHtml);

  // The client portal and password reset are ordinary customer pages; the data
  // behind them still needs a signed-in session, which the API checks.
  if (path === "/portal" || path === "/reset" || path === "/app" || path === "/privacy") {
    const settings = await getSettings(env.DB).catch(() => ({}));
    const file = path === "/portal" ? "/portal.html" : path === "/app" ? "/app.html" : path === "/privacy" ? "/privacy.html" : "/reset.html";
    const asset = await env.ASSETS.fetch(new Request(new URL(file, request.url), request));
    if (asset.status === 404) return null;
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(securityHeaders({ page: true, googleSignIn: Boolean(settings.googleClientId) }))) res.headers.set(k, v);
    return res;
  }

  return null;
}
