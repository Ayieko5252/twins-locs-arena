// Staff accounts: first owner setup, sign-in with an optional two-step code,
// forgotten passwords, and the employee records management keeps.

import { audit, getSettings, ownerExists } from "../lib/db.js";
import { sendStaffMail } from "../lib/notify.js";
import { DEPARTMENTS, ROLES, can, capabilitiesFor, requireCap, sectionsFor, strip } from "../lib/perms.js";
import {
  STAFF_COOKIE, clearCookie, clearFailures, createSession, destroySession, destroySubjectSessions, hashPassword, issueToken,
  lockoutState, newTotpSecret, noteFailure, passwordProblem, readSession, setCookie, sha256, timingSafeEqual, totpUri,
  touchSession, useToken, verifyPassword, verifyTotp,
} from "../lib/security.js";
import { email as cleanEmail, fail, json, newId, oneOf, phoneDigits, readJson, str, int, bool } from "../lib/util.js";

export async function currentStaff(request, env, { requireTwoFactor = true } = {}) {
  const session = await readSession(env.DB, request, STAFF_COOKIE);
  if (!session || session.subject_type !== "staff") return null;
  const staff = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(session.subject_id).first();
  if (!staff || staff.status !== "active") return null;
  if (requireTwoFactor && staff.totp_enabled && !session.two_factor_ok) return null;
  await touchSession(env.DB, session.id);
  return { ...staff, sessionId: session.id, caps: [...capabilitiesFor(staff)] };
}

export async function requireStaff(request, env) {
  const staff = await currentStaff(request, env);
  if (!staff) {
    const err = new Error("Your staff session ended. Sign in again.");
    err.status = 401;
    throw err;
  }
  return staff;
}

const publicStaff = (s) => ({
  id: s.id, name: s.name, email: s.email, phone: s.phone, title: s.title,
  department: s.department, departmentName: DEPARTMENTS[s.department]?.name || s.department,
  role: s.role, roleName: ROLES[s.role] || s.role, mustChange: Boolean(s.must_change),
  twoFactor: Boolean(s.totp_enabled), termsAccepted: Boolean(s.terms_accepted_at),
  caps: [...capabilitiesFor(s)], sections: sectionsFor(s),
});

const loginKey = async (request, who) => `s:${(await sha256(`${who}|${request.headers.get("cf-connecting-ip") || ""}`)).slice(0, 32)}`;

// Staff may type just their username ("owner") or the whole address.
async function staffEmail(env, input) {
  const raw = str(input, 160).trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("@")) return cleanEmail(raw);
  if (!/^[a-z0-9._-]{2,40}$/.test(raw)) return "";
  const settings = await getSettings(env.DB);
  return cleanEmail(`${raw}@${settings.staffDomain || "twinslocsarena.com"}`);
}

export async function staffRoutes(parts, request, env, ctx) {
  if (parts[0] !== "staff") return null;
  const [, action, third] = parts;
  const method = request.method;

  /* ------------------------------------------------------------ first-run setup */
  if (action === "setup" && method === "GET") {
    return json({ needed: !(await ownerExists(env.DB)) });
  }

  if (action === "setup" && method === "POST") {
    if (await ownerExists(env.DB)) return fail(409, "The owner account already exists. Use Sign in, or ‘Forgot password’.");
    const body = await readJson(request);
    const code = str(body.code, 100);
    if (!env.OWNER_SETUP_CODE) return fail(503, "Setup isn’t ready: the owner setup code hasn’t been set on the server yet.");
    const key = await loginKey(request, "setup");
    const lock = await lockoutState(env.DB, key);
    if (lock.locked) return fail(429, "Too many tries. Wait a few minutes and try again.");
    if (!timingSafeEqual(code, env.OWNER_SETUP_CODE)) {
      await noteFailure(env.DB, key);
      return fail(401, "That setup code is wrong.");
    }
    const email = cleanEmail(body.email) || cleanEmail(env.OWNER_EMAIL);
    const name = str(body.name, 80) || "Owner";
    if (!email) return fail(400, "Add the owner’s email address.");
    const problem = passwordProblem(String(body.password || ""), { email, name });
    if (problem) return fail(400, problem);

    const id = newId("emp");
    await env.DB.prepare(`INSERT INTO employees (id, email, name, phone, title, department, role, password_hash, must_change, hired_on)
                          VALUES (?1, ?2, ?3, ?4, 'Owner', 'management', 'owner', ?5, 0, date('now'))`)
      .bind(id, email, name, phoneDigits(body.phone), await hashPassword(String(body.password))).run();
    await clearFailures(env.DB, key);
    await audit(env.DB, { actor: { type: "staff", id, name }, action: "owner.created", target: email });
    const { token, maxAge } = await createSession(env.DB, { subjectType: "staff", subjectId: id, request, twoFactorOk: 1 });
    const staff = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(id).first();
    return json({ me: publicStaff(staff) }, 201, { "Set-Cookie": setCookie(STAFF_COOKIE, token, maxAge, { sameSite: "Strict" }) });
  }

  /* ------------------------------------------------------------ sign in */
  if (action === "login" && method === "POST") {
    const body = await readJson(request);
    const email = await staffEmail(env, body.email);
    const key = await loginKey(request, email || "unknown");
    const lock = await lockoutState(env.DB, key);
    if (lock.locked) return fail(429, "This account is locked for a few minutes after too many wrong tries.");

    const staff = email ? await env.DB.prepare("SELECT * FROM employees WHERE email = ?1").bind(email).first() : null;
    const ok = staff && staff.status === "active" && (await verifyPassword(String(body.password || ""), staff.password_hash));
    if (!ok) {
      const { fails } = await noteFailure(env.DB, key);
      await audit(env.DB, { actor: { type: "staff", name: email || "unknown" }, action: "staff.login_failed", detail: `attempt ${fails}` });
      return fail(401, "That email and password don’t match.");
    }
    if (staff.totp_enabled) {
      const code = str(body.code, 10);
      if (!code) return json({ twoFactorRequired: true });
      if (!(await verifyTotp(staff.totp_secret, code))) {
        await noteFailure(env.DB, key);
        return fail(401, "That six-digit code isn’t right. Check your authenticator app.");
      }
    }
    await clearFailures(env.DB, key);
    const { token, maxAge } = await createSession(env.DB, { subjectType: "staff", subjectId: staff.id, request, twoFactorOk: 1 });
    await env.DB.prepare("UPDATE employees SET last_login_at = datetime('now') WHERE id = ?1").bind(staff.id).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.login" });
    return json({ me: publicStaff(staff) }, 200, { "Set-Cookie": setCookie(STAFF_COOKIE, token, maxAge, { sameSite: "Strict" }) });
  }

  if (action === "logout" && method === "POST") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (staff) {
      await destroySession(env.DB, staff.sessionId);
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.logout" });
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(STAFF_COOKIE) });
  }

  if (action === "me" && method === "GET") {
    const staff = await currentStaff(request, env);
    if (!staff) return json({ me: null });
    const settings = await getSettings(env.DB);
    return json({ me: publicStaff(staff), departments: DEPARTMENTS, currency: settings.currency, siteName: settings.name });
  }

  /* ------------------------------------------------------------ own password & terms */
  if (action === "password" && method === "POST") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (!staff) return fail(401, "Sign in again.");
    const body = await readJson(request);
    if (!(await verifyPassword(String(body.currentPassword || ""), staff.password_hash))) return fail(401, "Your current password doesn’t match.");
    const problem = passwordProblem(String(body.password || ""), { email: staff.email, name: staff.name });
    if (problem) return fail(400, problem);
    await env.DB.prepare("UPDATE employees SET password_hash = ?2, must_change = 0 WHERE id = ?1")
      .bind(staff.id, await hashPassword(String(body.password))).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.password_changed" });
    return json({ ok: true });
  }

  if (action === "accept-terms" && method === "POST") {
    const staff = await requireStaff(request, env);
    await env.DB.prepare("UPDATE employees SET terms_accepted_at = datetime('now') WHERE id = ?1").bind(staff.id).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.accepted_terms" });
    return json({ ok: true });
  }

  if (action === "forgot" && method === "POST") {
    const body = await readJson(request);
    const email = await staffEmail(env, body.email);
    const staff = email ? await env.DB.prepare("SELECT * FROM employees WHERE email = ?1 AND status = 'active'").bind(email).first() : null;
    if (staff) {
      const token = await issueToken(env.DB, { kind: "reset", subjectType: "staff", subjectId: staff.id, minutes: 30 });
      const link = `${new URL(request.url).origin}/staff-reset?token=${token}`;
      ctx?.waitUntil?.(sendStaffMail(env, {
        to: staff.email,
        subject: "Reset your Twins Locs Arena staff password",
        heading: "Set a new staff password",
        lines: ["Someone asked to reset the password for your staff account.", "This link works once and expires in 30 minutes. If this wasn’t you, tell management - your account may be targeted."],
        action: { label: "Choose a new password", url: link },
      }));
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.reset_requested" });
    }
    return json({ ok: true, message: "If that staff email exists, a reset link is on its way." });
  }

  if (action === "reset" && method === "POST") {
    const body = await readJson(request);
    const row = await useToken(env.DB, "reset", str(body.token, 80));
    if (!row || row.subject_type !== "staff") return fail(400, "That reset link has expired. Ask for a new one.");
    const staff = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(row.subject_id).first();
    if (!staff || staff.status !== "active") return fail(400, "That account is not active.");
    const problem = passwordProblem(String(body.password || ""), { email: staff.email, name: staff.name });
    if (problem) return fail(400, problem);
    await env.DB.prepare("UPDATE employees SET password_hash = ?2, must_change = 0 WHERE id = ?1")
      .bind(staff.id, await hashPassword(String(body.password))).run();
    await destroySubjectSessions(env.DB, "staff", staff.id);
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.password_reset" });
    return json({ ok: true });
  }

  /* ------------------------------------------------------------ two-step verification */
  if (action === "2fa" && third === "start" && method === "POST") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (!staff) return fail(401, "Sign in again.");
    const secret = newTotpSecret();
    await env.DB.prepare("UPDATE employees SET totp_secret = ?2 WHERE id = ?1").bind(staff.id, secret).run();
    return json({ secret, uri: totpUri(secret, staff.email), steps: [
      "Install Google Authenticator, Microsoft Authenticator or Authy on your phone.",
      "In the app choose ‘Add account’, then ‘Enter a setup key’.",
      "Account name: your email. Key: the code shown here. Type: time-based.",
      "Type the six digits the app shows to finish.",
    ] });
  }

  if (action === "2fa" && third === "enable" && method === "POST") {
    const staff = await currentStaff(request, env, { requireTwoFactor: false });
    if (!staff) return fail(401, "Sign in again.");
    const body = await readJson(request);
    if (!staff.totp_secret) return fail(400, "Start the setup again.");
    if (!(await verifyTotp(staff.totp_secret, str(body.code, 10)))) return fail(400, "That code isn’t right. Check the time on your phone and try the next code.");
    await env.DB.prepare("UPDATE employees SET totp_enabled = 1 WHERE id = ?1").bind(staff.id).run();
    await env.DB.prepare("UPDATE sessions SET two_factor_ok = 1 WHERE id = ?1").bind(staff.sessionId).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.2fa_enabled" });
    return json({ ok: true });
  }

  if (action === "2fa" && third === "disable" && method === "POST") {
    const staff = await currentStaff(request, env);
    if (!staff) return fail(401, "Sign in again.");
    const body = await readJson(request);
    if (!(await verifyPassword(String(body.password || ""), staff.password_hash))) return fail(401, "Your password doesn’t match.");
    await env.DB.prepare("UPDATE employees SET totp_enabled = 0, totp_secret = NULL WHERE id = ?1").bind(staff.id).run();
    await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "staff.2fa_disabled" });
    return json({ ok: true });
  }

  /* ------------------------------------------------------------ employees */
  if (action === "employees") {
    const staff = await requireStaff(request, env);

    if (method === "GET") {
      requireCap(staff, "staff.view");
      const rows = await env.DB.prepare("SELECT * FROM employees ORDER BY department, name").all();
      return json({
        employees: (rows.results || []).map((e) => ({
          ...strip("employee", e, staff),
          departmentName: DEPARTMENTS[e.department]?.name || e.department,
          roleName: ROLES[e.role] || e.role,
          twoFactor: Boolean(e.totp_enabled),
        })),
        departments: DEPARTMENTS, roles: ROLES,
      });
    }

    if (method === "POST") {
      requireCap(staff, "staff.edit");
      const body = await readJson(request);
      const email = cleanEmail(body.email);
      const name = str(body.name, 80);
      if (!name || !email) return fail(400, "A new employee needs a name and an email address.");
      const department = oneOf(str(body.department, 20), Object.keys(DEPARTMENTS), "employee");
      let role = oneOf(str(body.role, 10), Object.keys(ROLES), "staff");
      if (role === "owner" && staff.role !== "owner") return fail(403, "Only the owner can create another owner.");
      if (await env.DB.prepare("SELECT id FROM employees WHERE email = ?1").bind(email).first()) return fail(409, "Someone already has that email address.");

      const id = newId("emp");
      const temporary = `${str(body.name, 6).replace(/\s/g, "") || "Locs"}-${Math.floor(1000 + Math.random() * 9000)}!`;
      await env.DB.prepare(`INSERT INTO employees (id, email, name, phone, title, department, role, password_hash, must_change, hired_on, pay_rate_cents)
                            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, COALESCE(?9, date('now')), ?10)`)
        .bind(id, email, name, phoneDigits(body.phone), str(body.title, 60), department, role, await hashPassword(temporary),
          str(body.hiredOn, 10) || null, can(staff, "staff.pay") ? int(body.payRate) * 100 : 0).run();
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "employee.created", target: email, detail: `${department}/${role}` });
      // Shown once, here, and never stored in readable form.
      return json({ ok: true, id, temporaryPassword: temporary,
        note: "Write this down and give it to them in person. They must change it at first sign-in. It can’t be shown again." }, 201);
    }

    if (method === "PUT") {
      requireCap(staff, "staff.edit");
      const body = await readJson(request);
      const target = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(str(body.id, 40)).first();
      if (!target) return fail(404, "That employee record is gone.");
      if (target.role === "owner" && staff.role !== "owner") return fail(403, "Only the owner can change the owner’s record.");
      const role = oneOf(str(body.role, 10), Object.keys(ROLES), target.role);
      if (role === "owner" && staff.role !== "owner") return fail(403, "Only the owner can make someone an owner.");
      const status = oneOf(str(body.status, 12), ["active", "suspended"], target.status);
      if (target.id === staff.id && status !== "active") return fail(400, "You can’t suspend your own account.");

      await env.DB.prepare(`UPDATE employees SET name = ?2, phone = ?3, title = ?4, department = ?5, role = ?6, status = ?7,
                            pay_rate_cents = ?8, hired_on = COALESCE(?9, hired_on) WHERE id = ?1`)
        .bind(target.id, str(body.name, 80) || target.name, phoneDigits(body.phone), str(body.title, 60),
          oneOf(str(body.department, 20), Object.keys(DEPARTMENTS), target.department), role, status,
          can(staff, "staff.pay") && body.payRate !== undefined ? int(body.payRate) * 100 : target.pay_rate_cents,
          str(body.hiredOn, 10) || null).run();
      if (status === "suspended") await destroySubjectSessions(env.DB, "staff", target.id);
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "employee.updated", target: target.email, detail: status });
      return json({ ok: true });
    }

    if (third === "password" && method === "POST") {
      requireCap(staff, "staff.password");
      const body = await readJson(request);
      const target = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(str(body.id, 40)).first();
      if (!target) return fail(404, "That employee record is gone.");
      if (target.role === "owner" && staff.role !== "owner") return fail(403, "Only the owner can reset the owner’s password.");
      const temporary = `${target.name.split(" ")[0].slice(0, 6) || "Locs"}-${Math.floor(1000 + Math.random() * 9000)}!`;
      await env.DB.prepare("UPDATE employees SET password_hash = ?2, must_change = 1 WHERE id = ?1").bind(target.id, await hashPassword(temporary)).run();
      await destroySubjectSessions(env.DB, "staff", target.id);
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "employee.password_reset", target: target.email });
      return json({ ok: true, temporaryPassword: temporary, note: "Give this to them in person. They must change it at first sign-in." });
    }

    if (method === "DELETE") {
      requireCap(staff, "staff.edit");
      const body = await readJson(request);
      const target = await env.DB.prepare("SELECT * FROM employees WHERE id = ?1").bind(str(body.id, 40)).first();
      if (!target) return fail(404, "That employee record is gone.");
      if (target.role === "owner") return fail(403, "The owner’s record can’t be deleted.");
      if (target.id === staff.id) return fail(400, "You can’t delete your own account.");
      // Keep the person's work history: suspend instead of erasing the record.
      await env.DB.prepare("UPDATE employees SET status = 'suspended', password_hash = NULL, totp_enabled = 0, totp_secret = NULL WHERE id = ?1").bind(target.id).run();
      await destroySubjectSessions(env.DB, "staff", target.id);
      await audit(env.DB, { actor: { type: "staff", id: staff.id, name: staff.name }, action: "employee.suspended", target: target.email });
      return json({ ok: true, message: `${target.name} can no longer sign in. Their past work stays in the records.` });
    }
  }

  return null;
}
