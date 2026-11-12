// The nightly job: tomorrow's reminders, a full backup, and tidying up.

import { getSettings } from "../lib/db.js";
import { sendReminder } from "../lib/notify.js";
import { cleanupSessions } from "../lib/security.js";
import { addDays, todayIn } from "../lib/util.js";

export async function nightly(env) {
  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const tomorrow = addDays(today, 1);
  const origin = env.SITE_ORIGIN || "https://www.twinslocsarena.com";

  // 1. Remind everyone booked for tomorrow (once).
  const due = await env.DB
    .prepare("SELECT * FROM bookings WHERE date = ?1 AND status IN ('pending','confirmed') AND reminded_at IS NULL")
    .bind(tomorrow).all();
  let reminded = 0;
  for (const booking of due.results || []) {
    await sendReminder(env, booking, settings, origin).catch((e) => console.error("Reminder failed", e));
    await env.DB.prepare("UPDATE bookings SET reminded_at = datetime('now') WHERE id = ?1").bind(booking.id).run();
    reminded++;
  }

  // 2. Keep a copy of everything, and keep the last 30.
  const tables = ["settings", "employees", "customers", "services", "products", "bookings", "orders", "order_items",
    "stock_moves", "accounts", "journal", "journal_lines", "expenses", "payments", "approvals", "tasks", "offers", "documents", "visitors"];
  const dump = {};
  for (const t of tables) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t}`).all();
    dump[t] = (rows.results || []).map(({ password_hash, totp_secret, ...row }) => row);
  }
  await env.FILES.put(`backups/${today}.json`, JSON.stringify({ app: "twins-locs-arena", exportedAt: new Date().toISOString(), tables: dump }), {
    httpMetadata: { contentType: "application/json" },
  });
  const old = await env.FILES.list({ prefix: "backups/" });
  const keep = new Set(old.objects.map((o) => o.key).sort().slice(-30));
  for (const obj of old.objects) if (!keep.has(obj.key)) await env.FILES.delete(obj.key).catch(() => {});

  // 3. Tidy old sessions, used tokens and stale visit rows.
  await cleanupSessions(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_tokens WHERE expires_at <= datetime('now', '-7 days')"),
    env.DB.prepare("DELETE FROM login_attempts WHERE updated_at <= datetime('now', '-7 days')"),
    env.DB.prepare("DELETE FROM daily_visits WHERE date < ?1").bind(addDays(today, -120)),
    env.DB.prepare("DELETE FROM audit_log WHERE at <= datetime('now', '-365 days')"),
  ]);

  await env.DB.prepare("INSERT INTO audit_log (actor_type, actor_name, action, detail) VALUES ('system','nightly job','cron.ran', ?1)")
    .bind(`${reminded} reminders, backup saved for ${today}`).run();
  console.log(`Nightly: ${reminded} reminders, backup ${today}`);
}
