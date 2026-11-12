// Alerts to the salon (WhatsApp + email) and emails to clients and staff.
// A channel with no settings is skipped and reported as "off" - never an error.

import { esc, money } from "./util.js";

export const channels = (env) => ({
  whatsapp: Boolean(env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY),
  email: Boolean(env.RESEND_API_KEY && (env.NOTIFY_EMAIL || env.SUPPORT_EMAIL)),
});

const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function sendWhatsApp(env, text) {
  if (!channels(env).whatsapp) return "off";
  try {
    const u = new URL("https://api.callmebot.com/whatsapp.php");
    u.searchParams.set("phone", String(env.CALLMEBOT_PHONE).replace(/[^\d+]/g, ""));
    u.searchParams.set("text", text);
    u.searchParams.set("apikey", env.CALLMEBOT_APIKEY);
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    if (r.ok && /queued|sent/i.test(body)) return "sent";
    console.error("WhatsApp alert failed", r.status, body.replace(/<[^>]+>/g, " ").slice(0, 200));
    return "failed";
  } catch (e) {
    console.error("WhatsApp alert failed", e);
    return "failed";
  }
}

const shell = (heading, bodyHtml, action) => `<div style="font-family:Arial,Helvetica,sans-serif;background:#E9CB98;padding:24px">
  <div style="max-width:540px;margin:0 auto;background:#F5E4C3;border-radius:14px;padding:26px;color:#2E170D">
    <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7D5A40">Twins Locs Arena</p>
    <h1 style="margin:6px 0 16px;font-family:Georgia,serif;font-weight:normal;font-size:24px">${esc(heading)}</h1>
    ${bodyHtml}
    ${action ? `<p style="margin:22px 0 0"><a href="${esc(action.url)}" style="display:inline-block;background:#2E170D;color:#E9CB98;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold">${esc(action.label)}</a></p>
    <p style="margin:14px 0 0;font-size:12px;color:#7D5A40;word-break:break-all">If the button doesn’t work, paste this into your browser:<br>${esc(action.url)}</p>` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#7D5A40">Twins Locs Arena · +254 113 394402 · +254 741 569288</p>
  </div></div>`;

const rowsHtml = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows
  .map(([k, v]) => `<tr><td style="padding:7px 0;color:#7D5A40;width:38%;vertical-align:top;border-bottom:1px solid #E1C79B">${esc(k)}</td><td style="padding:7px 0;border-bottom:1px solid #E1C79B">${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
  .join("")}</table>`;

async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) return "off";
  const recipients = (Array.isArray(to) ? to : String(to).split(",")).map((s) => String(s).trim()).filter(Boolean);
  if (!recipients.length) return "off";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.NOTIFY_FROM || "Twins Locs Arena <onboarding@resend.dev>", to: recipients, subject, html, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return "sent";
    console.error("Email failed", r.status, (await r.text()).slice(0, 200));
    return "failed";
  } catch (e) {
    console.error("Email failed", e);
    return "failed";
  }
}

/* ---------------------------------------------------------------- salon alerts */
async function alert(env, { subject, heading, rows, link }) {
  const text = [`*${heading}*`, ...rows.map(([k, v]) => `${k}: ${v}`), "", `Open the hub: ${link}`].join("\n");
  const [whatsapp, email] = await Promise.all([
    sendWhatsApp(env, text),
    sendEmail(env, {
      to: env.NOTIFY_EMAIL || env.SUPPORT_EMAIL,
      subject,
      text: text.replace(/\*/g, ""),
      html: shell(heading, rowsHtml(rows), { label: "Open the hub", url: link }),
    }),
  ]);
  return { whatsapp, email };
}

export async function notifyBooking(env, b, settings, origin) {
  const results = await alert(env, {
    subject: `New booking: ${b.service}, ${fmtDate(b.date)} ${b.time} (${b.name})`,
    heading: `New booking ${b.id}`,
    link: `${origin}/ops`,
    rows: [
      ["Service", `${b.service} · ${money(b.price_cents, settings.currency)}`],
      ["When", `${fmtDate(b.date)} at ${b.time}`],
      ["Client", b.name],
      ["Phone", b.phone],
      ["Deposit to take", `${money(b.deposit_cents, settings.currency)} (${settings.depositPct}%)`],
      ["About their locs", b.notes || "No notes"],
    ],
  });
  await env.DB.prepare("UPDATE bookings SET notified = ?2 WHERE id = ?1").bind(b.id, JSON.stringify(results)).run();
  if (b.email) {
    await sendCustomerMail(env, {
      to: b.email,
      subject: `Your booking ${b.id} at Twins Locs Arena`,
      heading: `See you ${fmtDate(b.date)} at ${b.time}`,
      lines: ["Thanks for booking with us. We’ll call to confirm your chair and share how to pay the deposit."],
      rows: [["Reference", b.id], ["Service", b.service], ["When", `${fmtDate(b.date)} at ${b.time}`], ["Deposit", money(b.deposit_cents, settings.currency)]],
      action: { label: "See your bookings", url: `${origin}/portal` },
    });
  }
  return results;
}

export async function notifyOrder(env, o, settings, origin) {
  const results = await alert(env, {
    subject: `New order ${o.id}: ${money(o.total_cents, settings.currency)} (${o.name})`,
    heading: `New order ${o.id}`,
    link: `${origin}/ops`,
    rows: [
      ["Items", (o.items || []).map((i) => `${i.qty}× ${i.name}`).join("\n")],
      ["Total", money(o.total_cents, settings.currency)],
      ["Customer", o.name],
      ["Phone", o.phone],
      ["Fulfilment", o.fulfilment === "delivery" ? `Delivery to ${o.address}` : "Pick up at salon"],
    ],
  });
  await env.DB.prepare("UPDATE orders SET notified = ?2 WHERE id = ?1").bind(o.id, JSON.stringify(results)).run();
  return results;
}

export async function notifyTest(env, settings, origin) {
  return alert(env, {
    subject: "Test alert from your booking site",
    heading: "Alerts are working",
    link: `${origin}/ops`,
    rows: [["What this is", `A test from ${settings.name}. New bookings and orders will arrive like this.`]],
  });
}

/* ---------------------------------------------------------------- people mail */
export async function sendCustomerMail(env, { to, subject, heading, lines = [], rows = [], action }) {
  const body = `${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}${rows.length ? rowsHtml(rows) : ""}`;
  return sendEmail(env, {
    to,
    subject,
    text: [heading, "", ...lines, ...rows.map(([k, v]) => `${k}: ${v}`), action ? `\n${action.label}: ${action.url}` : ""].join("\n"),
    html: shell(heading, body, action),
  });
}

export const sendStaffMail = sendCustomerMail;

/* ---------------------------------------------------------------- reminders */
export async function sendReminder(env, booking, settings, origin) {
  const to = [booking.email, env.NOTIFY_EMAIL].filter(Boolean);
  const whenText = `${fmtDate(booking.date)} at ${booking.time}`;
  if (booking.email) {
    await sendCustomerMail(env, {
      to: booking.email,
      subject: `Reminder: your ${booking.service} tomorrow`,
      heading: `Tomorrow at ${booking.time}`,
      lines: [`This is a reminder for your ${booking.service} on ${whenText}.`, "If you can’t make it, call us so we can give the chair to someone else."],
      rows: [["Reference", booking.id], ["Phone", settings.phone]],
      action: { label: "See your booking", url: `${origin}/portal` },
    });
  }
  await sendWhatsApp(env, `*Tomorrow* ${booking.time} · ${booking.service} · ${booking.name} (${booking.phone})`);
  return to.length;
}
