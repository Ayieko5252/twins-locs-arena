// One sign-in for the whole business.
//
// There is a single door. What you type in the first box decides which room you
// land in: a staff username such as "owner" or "loctician" opens the Operations
// Hub, and a client's email address opens their own portal. Nobody has to know
// which kind of account they hold, and there is no separate staff page to find.
//
// Staff are checked first, so a name that exists on both sides always reaches
// the staff account, which is the stricter one.

import { audit, getSettings } from "../lib/db.js";
import { sendCustomerMail, sendStaffMail } from "../lib/notify.js";
import { publicStaff, staffEmail } from "./staff.js";
import { publicMe } from "./customer.js";
import {
  CUSTOMER_COOKIE, STAFF_COOKIE, clearFailures, createSession, issueToken,
  lockoutState, noteFailure, setCookie, sha256, verifyPassword, verifyTotp,
} from "../lib/security.js";
import { email as cleanEmail, fail, json, readJson, str } from "../lib/util.js";

// One lock per person per address, whichever side of the house they belong to.
const attemptKey = async (request, who) =>
  `u:${(await sha256(`${who}|${request.headers.get("cf-connecting-ip") || ""}`)).slice(0, 32)}`;

// Only an email address can belong to a client. A bare username cannot.
const clientEmail = (input) => {
  const raw = str(input, 160).trim().toLowerCase();
  return raw.includes("@") ? cleanEmail(raw) : "";
};

export async function signinRoutes(parts, request, env, ctx) {
  if (parts[0] !== "signin") return null;
  const [, action] = parts;
  if (request.method !== "POST") return null;

  /* ---------------------------------------------------------------- sign in */
  if (!action) {
    const body = await readJson(request);
    const typed = str(body.who ?? body.email, 160).trim();
    const password = String(body.password || "");
    const key = await attemptKey(request, typed.toLowerCase() || "unknown");

    const lock = await lockoutState(env.DB, key);
    if (lock.locked) return fail(429, "Too many tries. Wait a few minutes and try again.");

    /* --- staff first --------------------------------------------------- */
    const staffAddress = await staffEmail(env, typed);
    const staff = staffAddress
      ? await env.DB.prepare("SELECT * FROM employees WHERE email = ?1").bind(staffAddress).first()
      : null;

    if (staff && staff.status === "active" && (await verifyPassword(password, staff.password_hash))) {
      if (staff.totp_enabled) {
        const code = str(body.code, 10);
        if (!code) return json({ twoFactorRequired: true, kind: "staff" });
        if (!(await verifyTotp(staff.totp_secret, code))) {
          await noteFailure(env.DB, key);
          return fail(401, "That six-digit code isn’t right. Check your authenticator app.");
        }
      }
      await clearFailures(env.DB, key);
      const { token, maxAge } = await createSession(env.DB, { subjectType: "staff", subjectId: staff.id, request, twoFactorOk: 1 });
      await env.DB.prepare("UPDATE employees SET last_login_at = datetime('now') WHERE id = ?1").bind(staff.id).run();
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.login" });
      return json({ kind: "staff", go: "/ops", me: publicStaff(staff) }, 200, {
        "Set-Cookie": setCookie(STAFF_COOKIE, token, maxAge, { sameSite: "Strict" }),
      });
    }

    /* --- then the client side ------------------------------------------ */
    const address = clientEmail(typed);
    const customer = address
      ? await env.DB.prepare("SELECT * FROM customers WHERE email = ?1").bind(address).first()
      : null;

    if (customer && customer.password_hash && (await verifyPassword(password, customer.password_hash))) {
      await clearFailures(env.DB, key);
      const { token, maxAge } = await createSession(env.DB, { subjectType: "customer", subjectId: customer.id, request });
      await env.DB.prepare("UPDATE customers SET last_seen_at = datetime('now') WHERE id = ?1").bind(customer.id).run();
      return json({ kind: "client", go: "/portal", me: publicMe(customer) }, 200, {
        "Set-Cookie": setCookie(CUSTOMER_COOKIE, token, maxAge),
      });
    }

    /* --- neither --------------------------------------------------------- */
    const { fails } = await noteFailure(env.DB, key);
    if (staff) {
      await audit(env.DB, {
        actor: { type: "staff", name: staffAddress },
        action: "staff.login_failed",
        detail: `attempt ${fails}`,
      });
    }
    return fail(401, "That username or email and password don’t match.");
  }

  /* ------------------------------------------------------- forgotten password */
  if (action === "forgot") {
    const body = await readJson(request);
    const typed = str(body.who ?? body.email, 160).trim();
    const origin = new URL(request.url).origin;

    const staffAddress = await staffEmail(env, typed);
    const staff = staffAddress
      ? await env.DB.prepare("SELECT * FROM employees WHERE email = ?1 AND status = 'active'").bind(staffAddress).first()
      : null;

    if (staff) {
      const token = await issueToken(env.DB, { kind: "reset", subjectType: "staff", subjectId: staff.id, minutes: 30 });
      ctx?.waitUntil?.(sendStaffMail(env, {
        to: staff.email,
        subject: "Reset your Twins Locs Arena password",
        heading: "Set a new password",
        lines: [
          "Someone asked to reset the password on your staff account.",
          "This link works once and expires in 30 minutes. If this wasn’t you, tell management: your account may be targeted.",
        ],
        action: { label: "Choose a new password", url: `${origin}/staff-reset?token=${token}` },
      }));
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.reset_requested" });
      return json({ ok: true, message: "If that account exists, a reset link is on its way." });
    }

    const address = clientEmail(typed);
    const customer = address
      ? await env.DB.prepare("SELECT * FROM customers WHERE email = ?1").bind(address).first()
      : null;

    if (customer) {
      const token = await issueToken(env.DB, { kind: "reset", subjectType: "customer", subjectId: customer.id, minutes: 60 });
      const settings = await getSettings(env.DB).catch(() => ({}));
      ctx?.waitUntil?.(sendCustomerMail(env, {
        to: customer.email,
        subject: `Reset your ${settings.name || "Twins Locs Arena"} password`,
        heading: "Set a new password",
        lines: [
          "Someone asked to reset the password on your account.",
          "This link works once and expires in an hour. If this wasn’t you, you can ignore this message.",
        ],
        action: { label: "Choose a new password", url: `${origin}/reset?token=${token}` },
      }));
    }

    // The same answer either way, so nobody can use this to discover who holds an account.
    return json({ ok: true, message: "If that account exists, a reset link is on its way." });
  }

  return null;
}
