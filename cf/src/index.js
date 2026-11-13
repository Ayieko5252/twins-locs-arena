// Twins Locs Arena - Cloudflare Worker.
// Public shop and booking, client portal, staff Operations Hub, and the nightly job.

import { ensureSeeded, getSettings } from "./lib/db.js";
import { fail, json, serveFile } from "./lib/util.js";
import { sameOrigin, securityHeaders, cleanupSessions } from "./lib/security.js";
import { can } from "./lib/perms.js";
import { currentStaff } from "./routes/staff.js";
import { publicRoutes } from "./routes/public.js";
import { customerRoutes } from "./routes/customer.js";
import { staffRoutes } from "./routes/staff.js";
import { opsRoutes } from "./routes/ops.js";
import { agentRoutes } from "./routes/agents.js";
import { nightly } from "./routes/cron.js";
import { servePage } from "./pages.js";

const API_PREFIX = "/api/";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // One address for the salon: the bare domain sends people to www.
    if (url.hostname === "twinslocsarena.com") {
      url.hostname = "www.twinslocsarena.com";
      return Response.redirect(url.toString(), 301);
    }

    try {
      if (!env.DB) return new Response("The database isn’t connected yet.", { status: 503 });

      // Files come from R2. Only shop photos are public: everything else needs a
      // signed-in staff member, and the nightly backups are never served here.
      if (path.startsWith("/file/")) return serveStoredFile(decodeURIComponent(path.slice(6)), request, env);

      if (path.startsWith(API_PREFIX)) {
        if (!sameOrigin(request)) return fail(403, "That request didn’t come from this site.");
        const parts = path.slice(API_PREFIX.length).split("/").filter(Boolean);
        const res =
          (await publicRoutes(parts, request, env, ctx)) ||
          (await customerRoutes(parts, request, env, ctx)) ||
          (await staffRoutes(parts, request, env, ctx)) ||
          (await opsRoutes(parts, request, env, ctx)) ||
          (await agentRoutes(parts, request, env, ctx)) ||
          fail(404, "Not found");
        for (const [k, v] of Object.entries(securityHeaders())) res.headers.set(k, v);
        return res;
      }

      // Staff pages live in the Worker, never as public files.
      const page = await servePage(path, request, env);
      if (page) return page;

      // Everything else is the public website.
      const settings = await getSettings(env.DB).catch(() => ({}));
      const assetUrl = new URL(request.url);
      if (path === "/") assetUrl.pathname = "/index.html";
      const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
      let res = new Response(asset.body, asset);
      const isHtml = (res.headers.get("content-type") || "").includes("text/html");
      for (const [k, v] of Object.entries(securityHeaders({ page: isHtml, googleSignIn: Boolean(settings.googleClientId) }))) res.headers.set(k, v);
      // Google Search Console proves you own the site by looking for this tag.
      if (isHtml && settings.googleSiteVerification) {
        res = new HTMLRewriter()
          .on("head", {
            element(el) {
              el.append(`<meta name="google-site-verification" content="${String(settings.googleSiteVerification).replace(/[^\w-]/g, "")}">`, { html: true });
            },
          })
          .transform(res);
      }
      return res;
    } catch (err) {
      if (err?.status) return fail(err.status, err.message);
      console.error("Unhandled", err?.stack || err);
      return fail(500, "Something went wrong on our side. Try again in a moment.");
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  },
};

/* Who may read which files.
   products/  shop photos, public
   docs/      department documents, staff with documents.view
   receipts/  expense receipts, staff with expenses.view
   anything else (backups/) is never reachable over the web. */
async function serveStoredFile(key, request, env) {
  if (!key || key.includes("..")) return fail(404, "Not found");
  if (key.startsWith("products/")) return serveFile(env.FILES, key);

  // A client photo is only public once the client agreed and staff published it.
  if (key.startsWith("gallery/")) {
    const row = await env.DB.prepare("SELECT published, consent FROM gallery WHERE img_key = ?1").bind(key).first();
    if (row?.published && row?.consent) return serveFile(env.FILES, key);
    const viewer = await currentStaff(request, env);
    if (!viewer || !can(viewer, "gallery.view")) return fail(404, "Not found");
    return serveFile(env.FILES, key);
  }

  const needed = key.startsWith("docs/") ? "documents.view" : key.startsWith("receipts/") ? "expenses.view" : null;
  if (!needed) return fail(404, "Not found");

  const staff = await currentStaff(request, env);
  if (!staff) return fail(401, "Sign in to open this file.");
  if (!can(staff, needed)) return fail(403, "Your account does not have access to that file.");
  return serveFile(env.FILES, key);
}

// Used by the first request after a fresh deploy and by the setup page.
export async function bootstrap(env) {
  await ensureSeeded(env.DB);
  await cleanupSessions(env.DB);
  return json({ ok: true });
}
