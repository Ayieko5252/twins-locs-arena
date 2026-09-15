// Sends new booking and order alerts to the salon.
//   WhatsApp: CallMeBot  (CALLMEBOT_PHONE, CALLMEBOT_APIKEY)
//   Email:    Resend     (RESEND_API_KEY, NOTIFY_EMAIL, optional NOTIFY_FROM)
// A channel with missing settings is skipped and reported as "off".

import { env } from "./session.mjs";

export const channels = () => ({
  whatsapp: Boolean(env("CALLMEBOT_PHONE") && env("CALLMEBOT_APIKEY")),
  email: Boolean(env("RESEND_API_KEY") && env("NOTIFY_EMAIL")),
});

const money = (s, n) => `${s.currency} ${Number(n || 0).toLocaleString("en-US")}`;
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendWhatsApp(text) {
  if (!channels().whatsapp) return "off";
  try {
    const u = new URL("https://api.callmebot.com/whatsapp.php");
    u.searchParams.set("phone", env("CALLMEBOT_PHONE").replace(/[^\d+]/g, ""));
    u.searchParams.set("text", text);
    u.searchParams.set("apikey", env("CALLMEBOT_APIKEY"));
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    if (r.ok && /queued|sent/i.test(body)) return "sent";
    console.error("WhatsApp alert failed", r.status, body.replace(/<[^>]+>/g, " ").slice(0, 300));
    return "failed";
  } catch (e) {
    console.error("WhatsApp alert failed", e);
    return "failed";
  }
}

async function sendEmail({ subject, text, rows, heading, link }) {
  if (!channels().email) return "off";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#E9CB98;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#F5E4C3;border-radius:14px;padding:24px;color:#2E170D">
    <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7D5A40">Twins Locs Arena</p>
    <h1 style="margin:6px 0 16px;font-family:Georgia,serif;font-weight:normal;font-size:24px">${esc(heading)}</h1>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${rows
      .map(([k, v]) => `<tr><td style="padding:7px 0;color:#7D5A40;width:38%;vertical-align:top;border-bottom:1px solid #E1C79B">${esc(k)}</td><td style="padding:7px 0;border-bottom:1px solid #E1C79B">${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
      .join("")}</table>
    <p style="margin:20px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#2E170D;color:#E9CB98;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Open admin</a></p>
  </div></div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env("NOTIFY_FROM") || "Twins Locs Arena <onboarding@resend.dev>",
        to: env("NOTIFY_EMAIL").split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return "sent";
    console.error("Email alert failed", r.status, (await r.text()).slice(0, 300));
    return "failed";
  } catch (e) {
    console.error("Email alert failed", e);
    return "failed";
  }
}

async function send({ subject, heading, rows, link }) {
  const text = [`*${heading}*`, ...rows.map(([k, v]) => `${k}: ${v}`), "", `Open admin: ${link}`].join("\n");
  const [whatsapp, email] = await Promise.all([sendWhatsApp(text), sendEmail({ subject, text: text.replace(/\*/g, ""), rows, heading, link })]);
  return { whatsapp, email };
}

export function notifyBooking(b, s, origin) {
  const deposit = Math.round((b.price * s.depositPct) / 100);
  return send({
    subject: `New booking: ${b.service}, ${fmtDate(b.date)} ${b.time} (${b.name})`,
    heading: `New booking ${b.id}`,
    link: `${origin}/admin`,
    rows: [
      ["Service", `${b.service} · ${money(s, b.price)}`],
      ["When", `${fmtDate(b.date)} at ${b.time}`],
      ["Client", b.name],
      ["Phone", b.phone],
      ["Deposit to take", `${money(s, deposit)} (${s.depositPct}%)`],
      ["About their locs", b.notes || "No notes"],
    ],
  });
}

export function notifyOrder(o, s, origin) {
  return send({
    subject: `New order ${o.id}: ${money(s, o.total)} (${o.name})`,
    heading: `New order ${o.id}`,
    link: `${origin}/admin`,
    rows: [
      ["Items", o.items.map((i) => `${i.qty}× ${i.name}`).join("\n")],
      ["Total", `${money(s, o.total)}${o.delivery ? ` (incl. ${money(s, o.delivery)} delivery)` : ""}`],
      ["Customer", o.name],
      ["Phone", o.phone],
      ["Fulfilment", o.fulfilment === "delivery" ? `Delivery to ${o.address}` : "Pick up at salon"],
    ],
  });
}

export function notifyTest(s, origin) {
  return send({
    subject: "Test alert from your booking site",
    heading: "Alerts are working",
    link: `${origin}/admin`,
    rows: [["What this is", `A test from ${s.name} admin. New bookings and orders will arrive like this.`]],
  });
}
