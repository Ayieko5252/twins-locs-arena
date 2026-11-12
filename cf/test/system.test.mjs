// What must keep working: passwords, who may see what, money maths,
// double-entry bookkeeping and the stock ledger.

import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword, passwordProblem, newTotpSecret, totpCode, verifyTotp, timingSafeEqual } from "../src/lib/security.js";
import { capabilitiesFor, can, strip, sectionsFor } from "../src/lib/perms.js";
import { toCents, fromCents, priceFromCost, marginAfterVat, email, phoneDigits, validPhone, isDate, addDays, oneOf, int, str } from "../src/lib/util.js";
import { postJournal, moveStock, profitAndLoss } from "../src/lib/books.js";
import { fakeDb, ran } from "./fake-db.mjs";

/* ---------------------------------------------------------------- passwords */
test("a password can be checked but never read back", async () => {
  const stored = await hashPassword("TestPass2026x", 10000);
  assert.ok(stored.startsWith("pbkdf2$10000$"), "stores the method and rounds");
  assert.ok(!stored.includes("TestPass2026x"), "the password itself is not in there");
  assert.equal(await verifyPassword("TestPass2026x", stored), true);
  assert.equal(await verifyPassword("TestPass2026y", stored), false);
  assert.equal(await verifyPassword("", stored), false);
  assert.equal(await verifyPassword("x", null), false);
});

test("two people with the same password get different stored values", async () => {
  const a = await hashPassword("TestPass2026x", 10000);
  const b = await hashPassword("TestPass2026x", 10000);
  assert.notEqual(a, b, "a fresh salt each time");
});

test("weak passwords are refused with a reason", () => {
  assert.match(passwordProblem("short1"), /at least 10/i);
  assert.match(passwordProblem("abcdefghijkl"), /letters and numbers/i);
  assert.match(passwordProblem("password1234"), /easy to guess/i);
  assert.match(passwordProblem("aminaRosewater9", { name: "Amina Wanjiru" }), /your name/i);
  assert.match(passwordProblem("ownerRosewater9", { email: "owner@twinslocsarena.com" }), /email address/i);
  assert.equal(passwordProblem("Rosewater88Spritz"), "", "a good one passes");
});

test("comparisons do not leak length", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

/* ---------------------------------------------------------------- two-step codes */
test("two-step codes work and old codes stop working", async () => {
  const secret = newTotpSecret();
  const now = Date.now();
  const code = await totpCode(secret, Math.floor(now / 1000 / 30));
  assert.match(code, /^\d{6}$/);
  assert.equal(await verifyTotp(secret, code, now), true);
  assert.equal(await verifyTotp(secret, code, now + 5 * 60 * 1000), false, "five minutes later it is refused");
  assert.equal(await verifyTotp(secret, "000000", now), false);
  assert.equal(await verifyTotp(secret, "", now), false);
});

/* ---------------------------------------------------------------- permissions */
const staffOf = (department, role = "staff") => ({ department, role, status: "active" });

test("each department sees only its own work", () => {
  const employee = staffOf("employee");
  assert.equal(can(employee, "bookings.view"), true);
  assert.equal(can(employee, "accounts.view"), false, "a loctician cannot open the books");
  assert.equal(can(employee, "staff.pay"), false, "and cannot see pay rates");
  assert.equal(can(employee, "inventory.cost"), false, "nor what stock cost us");

  const accounts = staffOf("accounts");
  assert.equal(can(accounts, "accounts.post"), true);
  assert.equal(can(accounts, "reports.profit"), true);
  assert.equal(can(accounts, "staff.edit"), false, "accounts does not hire people");

  const admin = staffOf("admin");
  assert.equal(can(admin, "bookings.edit"), true);
  assert.equal(can(admin, "reports.profit"), false, "admin does not see profit");

  const owner = staffOf("management", "owner");
  for (const cap of ["accounts.post", "staff.pay", "settings.edit", "security.view", "reports.profit"]) {
    assert.equal(can(owner, cap), true, `the owner can ${cap}`);
  }
});

test("a suspended account can do nothing", () => {
  const gone = { department: "management", role: "owner", status: "suspended" };
  assert.equal(capabilitiesFor(gone).size, 0);
  assert.equal(can(gone, "bookings.view"), false);
});

test("a department head gets a little more than a team member", () => {
  assert.equal(can(staffOf("accounts", "head"), "approvals.decide"), true);
  assert.equal(can(staffOf("accounts", "staff"), "approvals.decide"), true, "accounts may decide approvals");
  assert.equal(can(staffOf("employee", "head"), "bookings.assign"), true);
  assert.equal(can(staffOf("employee", "staff"), "bookings.assign"), false);
});

test("hidden fields are removed before a record is sent out", () => {
  const product = { id: "p1", name: "Spritz", price_cents: 85000, cost_cents: 50000, markup_pct: 70 };
  const forEmployee = strip("product", product, staffOf("employee"));
  assert.equal(forEmployee.price_cents, 85000);
  assert.equal(forEmployee.cost_cents, undefined, "cost never reaches the salon floor");
  assert.equal(forEmployee.markup_pct, undefined);

  const forAccounts = strip("product", product, staffOf("accounts"));
  assert.equal(forAccounts.cost_cents, 50000, "accounts needs the cost");

  const person = { id: "e1", name: "Amina", pay_rate_cents: 5000000, password_hash: "pbkdf2$...", totp_secret: "ABC" };
  const seenByAdmin = strip("employee", person, staffOf("admin"));
  assert.equal(seenByAdmin.pay_rate_cents, undefined, "admin cannot see pay");
  assert.equal(seenByAdmin.password_hash, undefined, "nobody ever sees a password hash");
  assert.equal(seenByAdmin.totp_secret, undefined);
  assert.equal(strip("employee", person, staffOf("management", "owner")).password_hash, undefined, "not even the owner");
});

test("the hub menu matches what the person may do", () => {
  const keys = (s) => sectionsFor(s).map((x) => x.key);
  assert.ok(!keys(staffOf("employee")).includes("accounts"));
  assert.ok(!keys(staffOf("employee")).includes("settings"));
  assert.ok(keys(staffOf("accounts")).includes("accounts"));
  assert.ok(keys(staffOf("management", "owner")).includes("security"));
});

/* ---------------------------------------------------------------- money */
test("money is kept in whole cents", () => {
  assert.equal(toCents(1500), 150000);
  assert.equal(toCents(19.99), 1999);
  assert.equal(fromCents(150000), 1500);
  assert.equal(toCents(0.1) + toCents(0.2), toCents(0.3), "no drifting decimals");
});

test("the shop price comes from cost and markup", () => {
  assert.equal(priceFromCost(50000, 70), 85000);
  assert.equal(priceFromCost(50000, 0), 50000);
  assert.equal(priceFromCost(0, 70), 0);
});

test("the VAT trap is visible: a 15% markup leaves almost nothing", () => {
  const cost = 100000;
  const thin = marginAfterVat(cost, priceFromCost(cost, 15), 16);
  assert.ok(thin.marginPct < 3, `15% markup leaves ${thin.marginPct}% after VAT`);
  const healthy = marginAfterVat(cost, priceFromCost(cost, 60), 16);
  assert.ok(healthy.marginPct > 25, `60% markup leaves ${healthy.marginPct}%`);
});

test("input cleaning refuses rubbish", () => {
  assert.equal(email("Owner@Twinslocsarena.COM"), "owner@twinslocsarena.com");
  assert.equal(email("not-an-email"), "");
  assert.equal(phoneDigits("+254 113 394402"), "+254113394402");
  assert.equal(validPhone("12"), false);
  assert.equal(validPhone("0712 345 678"), true);
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate("2026-03-01"), true);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(oneOf("pending", ["pending", "done"], "done"), "pending");
  assert.equal(oneOf("hacked", ["pending", "done"], "done"), "done");
  assert.equal(int("12abc", 0, 100), 0);
  assert.equal(int(250, 0, 100), 100, "clamped to the top");
  assert.equal(str("  trim me  ", 5), "trim");
});

/* ---------------------------------------------------------------- bookkeeping */
test("an entry must balance before it is saved", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => postJournal(db, { date: "2026-03-01", memo: "wrong", lines: [{ account: "1000", debit: 10000 }, { account: "4000", credit: 9000 }] }),
    /does not balance|doesn.t balance/i,
  );
  assert.equal(ran(db, "INSERT INTO journal ").length, 0, "nothing was written");
});

test("an entry needs at least two sides and a real account", async () => {
  const db = fakeDb();
  await assert.rejects(() => postJournal(db, { date: "2026-03-01", memo: "one side", lines: [{ account: "1000", debit: 10000 }] }), /two lines/i);
  await assert.rejects(
    () => postJournal(db, { date: "2026-03-01", memo: "made up", lines: [{ account: "9999", debit: 100 }, { account: "1000", credit: 100 }] }),
    /no account with code 9999/i,
  );
  await assert.rejects(
    () => postJournal(db, { date: "2026-03-01", memo: "both", lines: [{ account: "1000", debit: 100, credit: 100 }, { account: "4000", credit: 100 }] }),
    /debit or a credit/i,
  );
});

test("a balanced entry is written with all its lines", async () => {
  const db = fakeDb();
  const entry = await postJournal(db, {
    date: "2026-03-01", memo: "M-Pesa sale", ref: "SJK1", createdBy: "emp_owner",
    lines: [{ account: "1010", debit: 300000 }, { account: "4100", credit: 258621 }, { account: "2200", credit: 41379 }],
  });
  assert.equal(entry.total, 300000);
  assert.equal(entry.lines.length, 3);
  assert.equal(ran(db, "INSERT INTO journal ").length, 1);
  assert.equal(db.calls.filter((c) => c.kind === "batch").length, 1, "the lines go in one batch");
});

/* ---------------------------------------------------------------- stock */
test("stock cannot go below zero", async () => {
  const db = fakeDb({ rows: { "FROM products WHERE id": { id: "p2", name: "Clarifying Shampoo", stock: 3, cost_cents: 70000 } } });
  await assert.rejects(() => moveStock(db, { productId: "p2", kind: "sale", qty: 5 }), /only 3 left/i);
  assert.equal(db.calls.filter((c) => c.kind === "batch").length, 0, "nothing moved");
});

test("stock in and out both land in the ledger", async () => {
  const db = fakeDb({ rows: { "FROM products WHERE id": { id: "p1", name: "Spritz", stock: 10, cost_cents: 50000 } } });
  const sold = await moveStock(db, { productId: "p1", kind: "sale", qty: 2, ref: "TLA-O123", createdBy: "shop" });
  assert.equal(sold.moved, -2);
  assert.equal(sold.balance, 8);
  const arrived = await moveStock(db, { productId: "p1", kind: "in", qty: 6, ref: "INV-9" });
  assert.equal(arrived.balance, 16);
  const counted = await moveStock(db, { productId: "p1", kind: "adjust", qty: -1, note: "count short" });
  assert.equal(counted.balance, 9, "an adjustment may be negative");
});

test("only the five agreed kinds of stock move are allowed", async () => {
  const db = fakeDb({ rows: { "FROM products WHERE id": { id: "p1", name: "Spritz", stock: 10, cost_cents: 1 } } });
  await assert.rejects(() => moveStock(db, { productId: "p1", kind: "shrinkage", qty: 1 }), /In, Out, Sale, Return or Adjust/i);
  await assert.rejects(() => moveStock(db, { productId: "p1", kind: "sale", qty: 0 }), /how many units/i);
});

test("profit and loss adds income up and costs down", async () => {
  const db = fakeDb({ rows: {
    "a.type IN ('income','expense')": [
      { code: "4000", name: "Service income", type: "income", net: 450000 },
      { code: "4100", name: "Product sales", type: "income", net: 120000 },
      { code: "5000", name: "Cost of products sold", type: "expense", net: -40000 },
      { code: "5300", name: "Rent", type: "expense", net: -200000 },
    ],
  } });
  const pl = await profitAndLoss(db, { from: "2026-03-01", to: "2026-03-31" });
  assert.equal(pl.totalIncome, 570000);
  assert.equal(pl.totalExpenses, 240000);
  assert.equal(pl.profit, 330000);
});
