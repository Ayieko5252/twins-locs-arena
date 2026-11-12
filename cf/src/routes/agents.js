// The AI team. Each agent has a job brief, and before it answers it is given
// the salon's own live numbers - never made-up figures.

import { audit, getSettings } from "../lib/db.js";
import { profitAndLoss, stockValuation } from "../lib/books.js";
import { can, requireCap } from "../lib/perms.js";
import { requireStaff } from "./staff.js";
import { addDays, fail, json, money, readJson, str, todayIn } from "../lib/util.js";

const MODEL = "claude-sonnet-5";

export async function agentRoutes(parts, request, env, ctx) {
  if (parts[0] !== "agents") return null;
  const [, second, third] = parts;
  const method = request.method;
  const staff = await requireStaff(request, env);
  requireCap(staff, "agents.use");

  if (method === "GET" && !second) {
    const rows = await env.DB.prepare("SELECT * FROM agents WHERE active = 1 ORDER BY sort").all();
    const recent = await env.DB
      .prepare(`SELECT r.*, a.name AS agent_name FROM agent_runs r JOIN agents a ON a.id = r.agent_id
                WHERE r.asked_by = ?1 ORDER BY r.created_at DESC LIMIT 20`).bind(staff.id).all();
    return json({
      agents: (rows.results || []).map((a) => ({
        id: a.id, name: a.name, title: a.title, department: a.department, brief: a.brief,
        skills: JSON.parse(a.skills || "[]"), starters: JSON.parse(a.starters || "[]"),
      })),
      connected: Boolean(env.ANTHROPIC_API_KEY),
      canEdit: can(staff, "agents.edit"),
      history: recent.results || [],
      setup: env.ANTHROPIC_API_KEY ? null : {
        why: "The AI team is built and ready, but it needs an API key before it can answer.",
        steps: [
          "Go to console.anthropic.com and sign in.",
          "Open API keys and create a key for this site.",
          "On your computer, in the project folder, run: npx wrangler secret put ANTHROPIC_API_KEY",
          "Paste the key when it asks. Nobody else ever sees it.",
          "Come back here and refresh - the team turns on.",
        ],
      },
    });
  }

  if (method === "PUT" && second) {
    requireCap(staff, "agents.edit");
    const body = await readJson(request);
    const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?1").bind(str(second, 40)).first();
    if (!agent) return fail(404, "That agent doesn’t exist.");
    await env.DB.prepare("UPDATE agents SET brief = ?2, name = ?3, title = ?4, active = ?5 WHERE id = ?1")
      .bind(agent.id, str(body.brief, 4000) || agent.brief, str(body.name, 60) || agent.name, str(body.title, 80) || agent.title, body.active === false ? 0 : 1).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "agent.updated", target: agent.id });
    return json({ ok: true });
  }

  if (method === "POST" && second === "ask") {
    const body = await readJson(request);
    const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?1 AND active = 1").bind(str(body.agentId, 40)).first();
    if (!agent) return fail(404, "That agent doesn’t exist.");
    const question = str(body.question, 2000);
    if (!question) return fail(400, "Type a question first.");

    if (!env.ANTHROPIC_API_KEY) {
      return fail(503, "The AI team isn’t connected yet. Management needs to add the Anthropic API key - the steps are on this page.");
    }

    const context = await liveContext(env, agent, staff);
    const system = `${agent.brief}

You are answering a staff member of Twins Locs Arena inside the staff Operations Hub.
Speak plainly, in short paragraphs, and give numbers in ${context.currency}.
Here are the salon's real figures right now. Use them; never invent numbers:
${context.text}

If you are not sure about something, say so and name what you would need to check.`;

    let answer = "", ok = 1;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: env.AI_MODEL || MODEL,
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: question }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.error("Agent call failed", res.status, detail);
        ok = 0;
        answer = res.status === 401 ? "The AI key was refused. Management should check it in the Cloudflare secrets."
          : res.status === 429 ? "The AI is busy or the monthly limit is reached. Try again shortly."
          : "The AI didn’t answer that time. Try again in a moment.";
      } else {
        const data = await res.json();
        answer = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim() || "No answer came back.";
      }
    } catch (e) {
      console.error("Agent error", e);
      ok = 0;
      answer = "The AI didn’t answer in time. Try again in a moment.";
    }

    await env.DB.prepare("INSERT INTO agent_runs (agent_id, asked_by, question, answer, ok) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(agent.id, staff.id, question, answer, ok).run();
    return json({ answer, ok: Boolean(ok), agent: { id: agent.id, name: agent.name } }, ok ? 200 : 502);
  }

  if (method === "GET" && second === "history" && third) {
    const rows = await env.DB.prepare("SELECT * FROM agent_runs WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT 30").bind(str(third, 40)).all();
    return json({ runs: rows.results || [] });
  }

  return null;
}

/* The live numbers each agent is given before it answers. */
async function liveContext(env, agent, staff) {
  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const from = addDays(today, -30);
  const lines = [`Today: ${today}. Salon: ${settings.name}, ${settings.chairs} chairs, open ${settings.open}:00-${settings.close}:00.`];

  const [bookings, upcoming] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS done, COALESCE(SUM(price_cents),0) AS total FROM bookings WHERE status='done' AND date BETWEEN ?1 AND ?2`).bind(from, today).first(),
    env.DB.prepare(`SELECT date, time, service FROM bookings WHERE date >= ?1 AND status IN ('pending','confirmed') ORDER BY date, time LIMIT 12`).bind(today).all(),
  ]);
  lines.push(`Last 30 days: ${bookings?.done || 0} finished sessions worth ${money(bookings?.total || 0, settings.currency)}.`);
  const slots = (upcoming.results || []).map((b) => `${b.date} ${b.time} ${b.service}`).join("; ");
  lines.push(`Next booked chairs: ${slots || "none booked yet"}.`);

  if (["senior_sales", "chief_cosmetics", "senior_marketer", "senior_accountant"].includes(agent.id)) {
    const stock = await stockValuation(env.DB);
    const showCost = can(staff, "inventory.cost");
    lines.push(`Shop stock: ${stock.items.map((i) => `${i.name} (${i.stock} left, ${money(i.price_cents, settings.currency)}${showCost ? `, costs us ${money(i.cost_cents, settings.currency)}` : ""})`).join("; ")}.`);
    lines.push(`${stock.lowCount} items are at or below their reorder level.`);
  }

  if (["senior_accountant", "chief_software"].includes(agent.id) && can(staff, "reports.profit")) {
    const pl = await profitAndLoss(env.DB, { from, to: today });
    lines.push(`Profit and loss ${from} to ${today}: income ${money(pl.totalIncome, settings.currency)}, costs ${money(pl.totalExpenses, settings.currency)}, profit ${money(pl.profit, settings.currency)}.`);
    lines.push(`VAT is ${settings.vatPct}% and prices are ${settings.vatInclusive ? "VAT-inclusive" : "VAT-exclusive"}. Default markup is ${settings.defaultMarkupPct}%.`);
  }

  if (agent.id === "senior_marketer") {
    const offers = await env.DB.prepare("SELECT title, discount_pct FROM offers WHERE active = 1 LIMIT 10").all();
    lines.push(`Live offers: ${(offers.results || []).map((o) => `${o.title} (${o.discount_pct}%)`).join("; ") || "none"}. Discounts above ${settings.discountCapPct}% need approval.`);
  }

  const services = await env.DB.prepare("SELECT name, price_cents, dur FROM services WHERE active = 1").all();
  lines.push(`Loc menu: ${(services.results || []).map((s) => `${s.name} from ${money(s.price_cents, settings.currency)} (${s.dur})`).join("; ")}.`);
  lines.push(`Asking staff member: ${staff.name}, ${staff.title || staff.role} in ${staff.department}.`);

  return { text: lines.join("\n"), currency: settings.currency };
}
