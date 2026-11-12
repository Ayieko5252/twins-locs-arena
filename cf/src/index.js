// Twins Locs Arena - Cloudflare Worker.
// Public shop and booking, client portal, staff Operations Hub, and the nightly job.

import { ensureSeeded, getSettings } from "./lib/db.js";
import { fail, json, serveFile } from "./lib/util.js";
import { sameOrigin, securityHeaders, cleanupSessions } from "./lib/security.js";
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

    try {
      if (!env.DB) return new Response("The database isn’t connected yet.", { status: 503 });

      // Files (product photos, receipts, department documents) come from R2.
      if (path.startsWith("/file/")) return serveFile(env.FILES, decodeURIComponent(path.slice(6)));

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
      const asset = await env.ASSETS.fetch(request);
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

// Used by the first request after a fresh deploy and by the setup page.
export async function bootstrap(env) {
  await ensureSeeded(env.DB);
  await cleanupSessions(env.DB);
  return json({ ok: true });
}
