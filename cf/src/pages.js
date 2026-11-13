// Staff pages live inside the Worker, not in the public folder, so they can
// only ever be served to someone who is signed in. Each page gets a fresh
// one-time nonce, which is what lets the site run without 'unsafe-inline'.

import opsHtml from "./pages/ops.html";
import staffLoginHtml from "./pages/staff-login.html";
import staffResetHtml from "./pages/staff-reset.html";
import { randomId, securityHeaders } from "./lib/security.js";
import { currentStaff } from "./routes/staff.js";
import { getSettings } from "./lib/db.js";

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
    if (!staff) return redirect("/staff");
    return page(opsHtml);
  }

  if (path === "/staff") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (staff) return redirect("/ops");
    return page(staffLoginHtml);
  }

  if (path === "/staff-reset") return page(staffResetHtml);

  // The client portal and password reset are ordinary customer pages; the data
  // behind them still needs a signed-in session, which the API checks.
  if (path === "/portal" || path === "/reset" || path === "/app") {
    const settings = await getSettings(env.DB).catch(() => ({}));
    const file = path === "/portal" ? "/portal.html" : path === "/app" ? "/app.html" : "/reset.html";
    const asset = await env.ASSETS.fetch(new Request(new URL(file, request.url), request));
    if (asset.status === 404) return null;
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(securityHeaders({ page: true, googleSignIn: Boolean(settings.googleClientId) }))) res.headers.set(k, v);
    return res;
  }

  return null;
}
