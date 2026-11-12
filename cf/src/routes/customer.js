// Client accounts: create one, sign in (password or Google), reset a forgotten
// password, and everything the client portal shows.

import { audit, getSettings } from "../lib/db.js";
import { verifyGoogleIdToken } from "../lib/google.js";
import { sendCustomerMail } from "../lib/notify.js";
import {
  CUSTOMER_COOKIE, clearCookie, clearFailures, createSession, destroySession, destroySubjectSessions,
  hashPassword, issueToken, lockoutState, noteFailure, passwordProblem, readSession, setCookie, sha256, touchSession, useToken, verifyPassword,
} from "../lib/security.js";
import { bool, email as cleanEmail, fail, json, newId, phoneDigits, readJson, str, todayIn, validPhone } from "../lib/util.js";

export async function currentCustomer(request, env) {
  const session = await readSession(env.DB, request, CUSTOMER_COOKIE);
  if (!session || session.subject_type !== "customer") return null;
  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(session.subject_id).first();
  if (!customer) return null;
  await touchSession(env.DB, session.id);
  return { ...customer, sessionId: session.id };
}

const publicMe = (c) => ({
  name: c.name, email: c.email || "", phone: c.phone || "", picture: c.picture || "",
  hasPassword: Boolean(c.password_hash), google: Boolean(c.google_sub), marketing: Boolean(c.marketing_opt_in),
});

const loginKey = async (request, who) => `c:${(await sha256(`${who}|${request.headers.get("cf-connecting-ip") || ""}`)).slice(0, 32)}`;

export async function customerRoutes(parts, request, env, ctx) {
  const [head, second] = parts;
  const method = request.method;
  if (head !== "account" && head !== "me") return null;

  /* ------------------------------------------------------------ create an account */
  if (head === "account" && second === "signup" && method === "POST") {
    const body = await readJson(request);
    if (body.website) return json({ ok: true });
    const email = cleanEmail(body.email);
    const name = str(body.name, 80);
    const phone = phoneDigits(body.phone);
    const password = String(body.password || "");
    if (!name) return fail(400, "Add your name.");
    if (!email) return fail(400, "Add an email address we can reach you on.");
    if (phone && !validPhone(phone)) return fail(400, "That phone number looks too short.");
    const problem = passwordProblem(password, { email, name });
    if (problem) return fail(400, problem);

    const existing = await env.DB.prepare("SELECT id, password_hash FROM customers WHERE email = ?1").bind(email).first();
    if (existing?.password_hash) return fail(409, "There is already an account with that email. Sign in, or use ‘Forgot password’.");

    const hash = await hashPassword(password);
    let id = existing?.id;
    if (existing) {
      // They booked before, or used Google first: attach the password to that record.
      await env.DB.prepare("UPDATE customers SET password_hash = ?2, name = COALESCE(NULLIF(name,''), ?3), phone = COALESCE(NULLIF(phone,''), ?4) WHERE id = ?1")
        .bind(id, hash, name, phone).run();
    } else {
      id = newId("cus");
      await env.DB.prepare("INSERT INTO customers (id, email, name, phone, password_hash, marketing_opt_in) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(id, email, name, phone, hash, bool(body.marketing ?? 1)).run();
    }
    await linkPastVisits(env, id, phone, email);
    const { token, maxAge } = await createSession(env.DB, { subjectType: "customer", subjectId: id, request });
    await audit(env.DB, { actor: { type: "customer", id, name }, action: "customer.signup", target: id });
    const me = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(id).first();
    return json({ me: publicMe(me) }, 201, { "Set-Cookie": setCookie(CUSTOMER_COOKIE, token, maxAge) });
  }

  /* ------------------------------------------------------------ sign in */
  if (head === "account" && second === "login" && method === "POST") {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const key = await loginKey(request, email || "unknown");
    const lock = await lockoutState(env.DB, key);
    if (lock.locked) return fail(429, "Too many tries. Wait a few minutes and try again.");

    const customer = email ? await env.DB.prepare("SELECT * FROM customers WHERE email = ?1").bind(email).first() : null;
    const ok = customer && (await verifyPassword(String(body.password || ""), customer.password_hash));
    if (!ok) {
      await noteFailure(env.DB, key);
      return fail(401, "That email and password don’t match.");
    }
    await clearFailures(env.DB, key);
    const { token, maxAge } = await createSession(env.DB, { subjectType: "customer", subjectId: customer.id, request });
    await env.DB.prepare("UPDATE customers SET last_seen_at = datetime('now') WHERE id = ?1").bind(customer.id).run();
    return json({ me: publicMe(customer) }, 200, { "Set-Cookie": setCookie(CUSTOMER_COOKIE, token, maxAge) });
  }

  /* ------------------------------------------------------------ Google sign-in */
  if (head === "account" && second === "google" && method === "POST") {
    const body = await readJson(request);
    const settings = await getSettings(env.DB);
    const clientId = settings.googleClientId || env.GOOGLE_CLIENT_ID || "";
    if (!clientId) return fail(400, "Google sign-in isn’t set up yet.");
    const g = await verifyGoogleIdToken(body.credential, clientId);
    const email = cleanEmail(g.email);
    let customer = await env.DB.prepare("SELECT * FROM customers WHERE google_sub = ?1 OR (email = ?2 AND email <> '')").bind(g.sub, email).first();
    if (customer) {
      await env.DB.prepare(`UPDATE customers SET google_sub = ?2, name = COALESCE(NULLIF(name,''), ?3), picture = ?4,
                            email = COALESCE(NULLIF(email,''), ?5), email_verified = 1, last_seen_at = datetime('now') WHERE id = ?1`)
        .bind(customer.id, g.sub, str(g.name, 80), safePicture(g.picture), email).run();
    } else {
      const id = newId("cus");
      await env.DB.prepare(`INSERT INTO customers (id, email, name, google_sub, picture, email_verified, last_seen_at)
                            VALUES (?1, ?2, ?3, ?4, ?5, 1, datetime('now'))`)
        .bind(id, email, str(g.name || email, 80), g.sub, safePicture(g.picture)).run();
      customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(id).first();
      await linkPastVisits(env, id, "", email);
    }
    const fresh = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(customer.id).first();
    const { token, maxAge } = await createSession(env.DB, { subjectType: "customer", subjectId: fresh.id, request });
    return json({ me: publicMe(fresh) }, 200, { "Set-Cookie": setCookie(CUSTOMER_COOKIE, token, maxAge) });
  }

  /* ------------------------------------------------------------ forgotten password */
  if (head === "account" && second === "forgot" && method === "POST") {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const customer = email ? await env.DB.prepare("SELECT * FROM customers WHERE email = ?1").bind(email).first() : null;
    if (customer) {
      const token = await issueToken(env.DB, { kind: "reset", subjectType: "customer", subjectId: customer.id, minutes: 60 });
      const link = `${new URL(request.url).origin}/reset?token=${token}`;
      ctx?.waitUntil?.(sendCustomerMail(env, {
        to: email,
        subject: "Reset your Twins Locs Arena password",
        heading: "Set a new password",
        lines: [
          "You asked to reset the password for your Twins Locs Arena account.",
          "The link below works once and expires in one hour. If you didn’t ask for this, ignore this email - nothing changes.",
        ],
        action: { label: "Choose a new password", url: link },
      }));
      await audit(env.DB, { actor: { type: "customer", id: customer.id, name: customer.name }, action: "customer.reset_requested" });
    }
    // The same answer either way, so nobody can use this to discover who has an account.
    return json({ ok: true, message: "If that email has an account, a reset link is on its way. Check your inbox and spam folder." });
  }

  if (head === "account" && second === "reset" && method === "POST") {
    const body = await readJson(request);
    const row = await useToken(env.DB, "reset", str(body.token, 80));
    if (!row || row.subject_type !== "customer") return fail(400, "That reset link has expired. Ask for a new one.");
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(row.subject_id).first();
    if (!customer) return fail(400, "That account no longer exists.");
    const problem = passwordProblem(String(body.password || ""), { email: customer.email, name: customer.name });
    if (problem) return fail(400, problem);
    await env.DB.prepare("UPDATE customers SET password_hash = ?2 WHERE id = ?1").bind(customer.id, await hashPassword(String(body.password))).run();
    await destroySubjectSessions(env.DB, "customer", customer.id); // sign out everywhere else
    await audit(env.DB, { actor: { type: "customer", id: customer.id, name: customer.name }, action: "customer.password_reset" });
    const { token, maxAge } = await createSession(env.DB, { subjectType: "customer", subjectId: customer.id, request });
    return json({ ok: true, me: publicMe(customer) }, 200, { "Set-Cookie": setCookie(CUSTOMER_COOKIE, token, maxAge) });
  }

  if (head === "account" && second === "logout" && method === "POST") {
    const me = await currentCustomer(request, env);
    if (me) await destroySession(env.DB, me.sessionId);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(CUSTOMER_COOKIE) });
  }

  /* ------------------------------------------------------------ the portal */
  if (head === "me") {
    const me = await currentCustomer(request, env);
    if (!me) return json({ me: null });

    if (method === "PUT") {
      const body = await readJson(request);
      const phone = phoneDigits(body.phone);
      if (phone && !validPhone(phone)) return fail(400, "That phone number looks too short.");
      const password = String(body.password || "");
      let hash = me.password_hash;
      if (password) {
        if (me.password_hash && !(await verifyPassword(String(body.currentPassword || ""), me.password_hash))) {
          return fail(401, "Your current password doesn’t match.");
        }
        const problem = passwordProblem(password, { email: me.email, name: me.name });
        if (problem) return fail(400, problem);
        hash = await hashPassword(password);
      }
      await env.DB.prepare("UPDATE customers SET name = ?2, phone = ?3, marketing_opt_in = ?4, password_hash = ?5 WHERE id = ?1")
        .bind(me.id, str(body.name, 80) || me.name, phone, bool(body.marketing), hash).run();
      const fresh = await env.DB.prepare("SELECT * FROM customers WHERE id = ?1").bind(me.id).first();
      return json({ me: publicMe(fresh) });
    }

    if (method === "GET") {
      const settings = await getSettings(env.DB);
      const today = todayIn(settings.timezone);
      const [bookings, orders, offers] = await Promise.all([
        env.DB.prepare(`SELECT id, service, price_cents, deposit_cents, date, time, status, notes FROM bookings
                        WHERE customer_id = ?1 OR (phone <> '' AND phone = ?2) ORDER BY date DESC, time DESC LIMIT 50`)
          .bind(me.id, me.phone || "~none~").all(),
        env.DB.prepare(`SELECT id, total_cents, status, fulfilment, date, created_at FROM orders
                        WHERE customer_id = ?1 OR (phone <> '' AND phone = ?2) ORDER BY created_at DESC LIMIT 50`)
          .bind(me.id, me.phone || "~none~").all(),
        env.DB.prepare(`SELECT id, title, detail, discount_pct, code, ends_on FROM offers
                        WHERE active = 1 AND (starts_on IS NULL OR starts_on <= ?1) AND (ends_on IS NULL OR ends_on >= ?1)
                          AND audience IN ('all', ?2) ORDER BY created_at DESC LIMIT 10`)
          .bind(today, "returning").all(),
      ]);
      const bookingRows = bookings.results || [];
      const items = await Promise.all((orders.results || []).map(async (o) => ({
        ...o,
        items: ((await env.DB.prepare("SELECT name, qty, price_cents FROM order_items WHERE order_id = ?1").bind(o.id).all()).results) || [],
      })));
      const done = bookingRows.filter((b) => b.status === "done").length;
      const need = int0(settings.loyaltyVisitsForReward, 6);
      return json({
        me: publicMe(me),
        bookings: bookingRows,
        orders: items,
        offers: offers.results || [],
        loyalty: { visits: done, need, toGo: Math.max(0, need - (done % need)), earned: Math.floor(done / need) },
        next: bookingRows.find((b) => b.date >= today && ["pending", "confirmed"].includes(b.status)) || null,
      });
    }
  }

  return null;
}

const int0 = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const safePicture = (url) => (/^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(url || "") ? url : "");

// A client who booked by phone before making an account gets that history attached.
async function linkPastVisits(env, customerId, phone, email) {
  if (!phone && !email) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE bookings SET customer_id = ?1 WHERE customer_id IS NULL AND ((?2 <> '' AND phone = ?2) OR (?3 <> '' AND email = ?3))")
      .bind(customerId, phone || "", email || ""),
    env.DB.prepare("UPDATE orders SET customer_id = ?1 WHERE customer_id IS NULL AND ((?2 <> '' AND phone = ?2) OR (?3 <> '' AND email = ?3))")
      .bind(customerId, phone || "", email || ""),
  ]);
}
