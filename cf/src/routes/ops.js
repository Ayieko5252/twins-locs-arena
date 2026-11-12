// The Operations Hub API. Every route checks a capability first, and every
// record is stripped of fields the signed-in person may not see.

import { audit, getSettings, saveSettings } from "../lib/db.js";
import { cashBook, moveStock, postExpense, postJournal, postOrderSale, postServiceSale, postStockPurchase, profitAndLoss, salesLedger, stockValuation, trialBalance } from "../lib/books.js";
import { DEPARTMENTS, can, requireCap, strip, stripAll } from "../lib/perms.js";
import { channels, notifyTest } from "../lib/notify.js";
import { requireStaff } from "./staff.js";
import {
  addDays, bad, fail, fileTypeAllowed, HttpError, int, isDate, json, money, newId, oneOf, phoneDigits, priceFromCost, putDataUrl,
  readJson, str, todayIn, marginAfterVat, email as cleanEmail,
} from "../lib/util.js";

const BOOKING_STATUS = ["pending", "confirmed", "done", "cancelled", "no_show"];
const ORDER_STATUS = ["new", "packed", "dispatched", "completed", "cancelled"];
const P_CATS = ["Cleanse", "Moisturise", "Hold", "Accessories"];
const S_CATS = ["Start", "Maintain", "Repair", "Style"];
const KINDS = ["bottle", "jar", "beads", "bonnet", "hook", "box"];

export async function opsRoutes(parts, request, env, ctx) {
  if (parts[0] !== "ops") return null;
  const [, area, sub] = parts;
  const method = request.method;
  const staff = await requireStaff(request, env);
  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const actor = { type: "staff", id: staff.id, name: staff.name };
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? await readJson(request, 5_000_000) : {};
  const log = (action, target, detail) => audit(env.DB, { actor, action, target, detail });

  switch (area) {
    /* ------------------------------------------------------------ today */
    case "dashboard": {
      const [todays, pending, openOrders, low, tasks, approvals] = await Promise.all([
        env.DB.prepare(`SELECT b.*, e.name AS assignee_name FROM bookings b LEFT JOIN employees e ON e.id = b.assigned_to
                        WHERE b.date = ?1 AND b.status <> 'cancelled' ORDER BY b.time`).bind(today).all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','packed')").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock <= reorder_at").first(),
        env.DB.prepare(`SELECT * FROM tasks WHERE status <> 'done' AND (assignee = ?1 OR department = ?2) ORDER BY due_on LIMIT 8`)
          .bind(staff.id, staff.department).all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").first(),
      ]);
      const week = await env.DB
        .prepare(`SELECT (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status <> 'cancelled' AND date BETWEEN ?1 AND ?2) AS shop,
                         (SELECT COALESCE(SUM(price_cents),0) FROM bookings WHERE status = 'done' AND date BETWEEN ?1 AND ?2) AS salon`)
        .bind(addDays(today, -6), today).first();
      const mine = staff.department === "employee"
        ? (await env.DB.prepare("SELECT * FROM bookings WHERE assigned_to = ?1 AND date >= ?2 ORDER BY date, time LIMIT 10").bind(staff.id, today).all()).results
        : [];
      return json({
        today,
        todays: todays.results || [],
        mine,
        counts: { pending: pending?.n || 0, openOrders: openOrders?.n || 0, low: low?.n || 0, approvals: approvals?.n || 0 },
        revenue: { week: (week?.shop || 0) + (week?.salon || 0), shop: week?.shop || 0, salon: week?.salon || 0, visible: can(staff, "reports.view") },
        tasks: tasks.results || [],
        chairHoursFree: Math.max(0, settings.chairs * (settings.close - settings.open) - (todays.results || []).length),
      });
    }

    /* ------------------------------------------------------------ bookings */
    case "bookings": {
      requireCap(staff, "bookings.view");
      if (method === "GET") {
        const url = new URL(request.url);
        const filter = url.searchParams.get("filter") || "upcoming";
        const known = ["pending", "confirmed", "done", "cancelled", "no_show"];
        let where = "1=1", binds = [];
        if (filter === "upcoming") { where = "b.date >= ?1 AND b.status NOT IN ('cancelled','done')"; binds = [today]; }
        else if (known.includes(filter)) { where = "b.status = ?1"; binds = [filter]; }
        const rows = await env.DB
          .prepare(`SELECT b.*, e.name AS assignee_name FROM bookings b LEFT JOIN employees e ON e.id = b.assigned_to
                    WHERE ${where} ORDER BY b.date ${filter === "upcoming" ? "ASC" : "DESC"}, b.time LIMIT 400`)
          .bind(...binds).all();
        return json({ bookings: rows.results || [] });
      }
      if (method === "PATCH") {
        requireCap(staff, "bookings.edit");
        const id = str(body.id, 40);
        const current = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?1").bind(id).first();
        if (!current) return fail(404, "That booking is gone. Refresh to see the latest.");
        const status = oneOf(str(body.status, 12), BOOKING_STATUS, current.status);
        const assigned = body.assignedTo !== undefined ? (str(body.assignedTo, 40) || null) : current.assigned_to;
        if (assigned && assigned !== current.assigned_to) requireCap(staff, "bookings.assign");
        await env.DB.prepare(`UPDATE bookings SET status = ?2, assigned_to = ?3, notes = ?4, updated_at = datetime('now') WHERE id = ?1`)
          .bind(id, status, assigned, body.notes !== undefined ? str(body.notes, 500) : current.notes).run();
        // A finished session becomes income the moment it is marked done.
        if (status === "done" && current.status !== "done") {
          await postServiceSale(env.DB, { ...current, status }, { method: str(body.method, 10) || "mpesa", createdBy: staff.id, vatPct: settings.vatPct, vatInclusive: settings.vatInclusive });
        }
        await log("booking.updated", id, status);
        const fresh = await env.DB.prepare(`SELECT b.*, e.name AS assignee_name FROM bookings b LEFT JOIN employees e ON e.id = b.assigned_to WHERE b.id = ?1`).bind(id).first();
        return json({ booking: fresh });
      }
      if (method === "POST") {
        requireCap(staff, "bookings.edit");
        const service = await env.DB.prepare("SELECT * FROM services WHERE id = ?1").bind(str(body.serviceId, 40)).first();
        if (!service) return fail(400, "Pick a service from the menu.");
        if (!isDate(str(body.date, 10))) return fail(400, "Pick a date.");
        const id = `TLA-B${Math.floor(10000 + Math.random() * 89999)}`;
        await env.DB.prepare(`INSERT INTO bookings (id, name, phone, email, service_id, service, price_cents, deposit_cents, date, time, status, notes, assigned_to)
                              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'confirmed', ?11, ?12)`)
          .bind(id, str(body.name, 80), phoneDigits(body.phone), cleanEmail(body.email), service.id, service.name, service.price_cents,
            Math.round((service.price_cents * settings.depositPct) / 100), str(body.date, 10), str(body.time, 5) || "09:00",
            str(body.notes, 500), str(body.assignedTo, 40) || null).run();
        await log("booking.created_by_staff", id);
        return json({ ok: true, id }, 201);
      }
      if (method === "DELETE") {
        requireCap(staff, "bookings.edit");
        await env.DB.prepare("DELETE FROM bookings WHERE id = ?1").bind(str(body.id, 40)).run();
        await log("booking.deleted", str(body.id, 40));
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ clients */
    case "clients": {
      requireCap(staff, "clients.view");
      if (method === "GET") {
        const q = `%${str(new URL(request.url).searchParams.get("q") || "", 40)}%`;
        const rows = await env.DB
          .prepare(`SELECT c.*,
                      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id OR (c.phone <> '' AND b.phone = c.phone)) AS bookings,
                      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id OR (c.phone <> '' AND o.phone = c.phone)) AS orders,
                      (SELECT MAX(date) FROM bookings b WHERE b.customer_id = c.id OR (c.phone <> '' AND b.phone = c.phone)) AS last_visit
                    FROM customers c
                    WHERE ?1 = '%%' OR c.name LIKE ?1 OR c.phone LIKE ?1 OR c.email LIKE ?1
                    ORDER BY COALESCE(c.last_seen_at, c.created_at) DESC LIMIT 200`)
          .bind(q).all();
        return json({ clients: stripAll("customer", rows.results, staff) });
      }
      if (method === "PUT") {
        requireCap(staff, "clients.edit");
        await env.DB.prepare("UPDATE customers SET name = ?2, phone = ?3, notes = ?4 WHERE id = ?1")
          .bind(str(body.id, 40), str(body.name, 80), phoneDigits(body.phone), str(body.notes, 1000)).run();
        await log("client.updated", str(body.id, 40));
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ shop orders */
    case "orders": {
      requireCap(staff, "orders.view");
      if (method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 300").all();
        const orders = await Promise.all((rows.results || []).map(async (o) => ({
          ...strip("order", o, staff),
          items: ((await env.DB.prepare("SELECT name, qty, price_cents FROM order_items WHERE order_id = ?1").bind(o.id).all()).results) || [],
        })));
        return json({ orders });
      }
      if (method === "PATCH") {
        requireCap(staff, "orders.edit");
        const id = str(body.id, 40);
        const current = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
        if (!current) return fail(404, "That order is gone. Refresh to see the latest.");
        if (current.paid && body.status && body.status !== current.status && !can(staff, "accounts.post")) {
          return fail(403, "This order is already paid, so only Accounts can change it.");
        }
        const status = oneOf(str(body.status, 12), ORDER_STATUS, current.status);
        // Cancelling puts the stock back; un-cancelling takes it out again.
        if ((current.status === "cancelled") !== (status === "cancelled")) {
          const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?1").bind(id).all();
          for (const it of items.results || []) {
            if (!it.product_id) continue;
            await moveStock(env.DB, {
              productId: it.product_id, kind: status === "cancelled" ? "return" : "sale", qty: it.qty,
              ref: id, note: status === "cancelled" ? "Order cancelled" : "Order reinstated", createdBy: staff.id,
            }).catch(() => {});
          }
        }
        await env.DB.prepare("UPDATE orders SET status = ?2, updated_at = datetime('now') WHERE id = ?1").bind(id, status).run();
        await log("order.updated", id, status);
        return json({ ok: true, status });
      }
      if (sub === "pay" && method === "POST") {
        requireCap(staff, "accounts.post");
        const id = str(body.id, 40);
        const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
        if (!order) return fail(404, "That order is gone.");
        if (order.paid) return fail(409, "This order is already marked paid.");
        const ref = str(body.ref, 40);
        if (ref) {
          const dup = await env.DB.prepare("SELECT id FROM payments WHERE ref = ?1").bind(ref).first();
          if (dup) return fail(409, `Payment reference ${ref} was already recorded. Check before entering it again.`);
        }
        const payMethod = oneOf(str(body.method, 10), ["cash", "mpesa", "bank", "card"], "mpesa");
        await env.DB.prepare(`INSERT INTO payments (id, kind, ref, source_id, amount_cents, method, received_at, recorded_by)
                              VALUES (?1, 'order', ?2, ?3, ?4, ?5, datetime('now'), ?6)`)
          .bind(newId("pay"), ref, id, order.total_cents, payMethod, staff.id).run();
        await env.DB.prepare("UPDATE orders SET paid = 1, payment_ref = ?2, status = CASE WHEN status = 'new' THEN 'packed' ELSE status END WHERE id = ?1").bind(id, ref).run();
        await postOrderSale(env.DB, order, { method: payMethod, createdBy: staff.id, vatPct: settings.vatPct, vatInclusive: settings.vatInclusive });
        await log("order.paid", id, `${money(order.total_cents, settings.currency)} by ${payMethod}`);
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ inventory */
    case "inventory": {
      requireCap(staff, "inventory.view");
      if (method === "GET") {
        const valuation = await stockValuation(env.DB);
        const moves = await env.DB
          .prepare(`SELECT m.*, p.name AS product_name FROM stock_moves m JOIN products p ON p.id = m.product_id
                    ORDER BY m.created_at DESC LIMIT 100`).all();
        return json({
          items: can(staff, "inventory.cost") ? valuation.items : valuation.items.map(({ cost_cents, value_cents, ...rest }) => rest),
          totals: can(staff, "inventory.cost") ? { cost: valuation.totalCost, retail: valuation.totalRetail, low: valuation.lowCount } : { low: valuation.lowCount },
          moves: moves.results || [],
        });
      }
      if (method === "POST") {
        requireCap(staff, "inventory.move");
        const kind = oneOf(str(body.kind, 10), ["in", "out", "sale", "return", "adjust"], "in");
        const qty = int(body.qty, -10000, 10000);
        const unitCost = body.unitCost !== undefined && can(staff, "inventory.cost") ? int(body.unitCost) * 100 : null;
        const result = await moveStock(env.DB, {
          productId: str(body.productId, 40), kind, qty, unitCostCents: unitCost,
          ref: str(body.ref, 40), note: str(body.note, 200), createdBy: staff.id,
        });
        if (kind === "in" && unitCost) {
          await postStockPurchase(env.DB, { productId: result.productId, qty: Math.abs(qty), unitCostCents: unitCost, method: oneOf(str(body.method, 10), ["cash", "mpesa", "bank"], "cash"), date: today, createdBy: staff.id, ref: str(body.ref, 40) });
        }
        await log("stock.move", result.name, `${kind} ${qty} → ${result.balance}`);
        return json({ ok: true, ...result });
      }
      break;
    }

    /* ------------------------------------------------------------ services & products */
    case "catalog": {
      requireCap(staff, "catalog.view");
      if (method === "GET") {
        const [services, products] = await Promise.all([
          env.DB.prepare("SELECT * FROM services ORDER BY sort, name").all(),
          env.DB.prepare("SELECT * FROM products ORDER BY cat, name").all(),
        ]);
        return json({
          services: services.results || [],
          products: stripAll("product", products.results, staff).map((p) => ({ ...p, img: p.img_key ? `/file/${p.img_key}` : "" })),
          categories: { product: P_CATS, service: S_CATS, kinds: KINDS },
          vat: { pct: settings.vatPct, inclusive: Boolean(settings.vatInclusive) },
        });
      }
      if (sub === "service" && (method === "POST" || method === "PUT")) {
        requireCap(staff, "catalog.edit");
        const id = str(body.id, 40) || `s_${Date.now().toString(36)}`;
        const price = int(body.price) * 100;
        const existing = await env.DB.prepare("SELECT price_cents FROM services WHERE id = ?1").bind(id).first();
        if (existing && existing.price_cents !== price) requireCap(staff, "price.edit");
        if (!str(body.name, 80)) return fail(400, "A service needs a name.");
        await env.DB.prepare(`INSERT INTO services (id, cat, name, price_cents, dur, care, descr, active, sort)
                              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                              ON CONFLICT(id) DO UPDATE SET cat=?2, name=?3, price_cents=?4, dur=?5, care=?6, descr=?7, active=?8`)
          .bind(id, oneOf(str(body.cat, 20), S_CATS, "Style"), str(body.name, 80), price, str(body.dur, 30),
            str(body.care, 60), str(body.descr, 300), body.active === false ? 0 : 1, int(body.sort)).run();
        await log(existing ? "service.updated" : "service.created", str(body.name, 80));
        return json({ ok: true, id });
      }
      if (sub === "product" && (method === "POST" || method === "PUT")) {
        requireCap(staff, "catalog.edit");
        const id = str(body.id, 40) || `p_${Date.now().toString(36)}`;
        const existing = await env.DB.prepare("SELECT * FROM products WHERE id = ?1").bind(id).first();
        if (!str(body.name, 80)) return fail(400, "A product needs a name.");
        const cost = can(staff, "inventory.cost") ? int(body.cost) * 100 : existing?.cost_cents || 0;
        const markup = can(staff, "inventory.cost") ? int(body.markup, 0, 1000) : existing?.markup_pct || settings.defaultMarkupPct;
        // The shop price is worked out here, never taken from the browser.
        const price = body.price !== undefined && can(staff, "price.edit") ? int(body.price) * 100 : priceFromCost(cost, markup);
        if (existing && existing.price_cents !== price) requireCap(staff, "price.edit");
        let imgKey = existing?.img_key || "";
        if (body.imgData) {
          const saved = await putDataUrl(env.FILES, `products/${id}-${Date.now().toString(36)}`, body.imgData, 3_000_000);
          imgKey = saved.key;
        } else if (body.removeImg && imgKey) {
          await env.FILES.delete(imgKey).catch(() => {});
          imgKey = "";
        }
        await env.DB.prepare(`INSERT INTO products (id, family, cat, kind, name, size, options, cost_cents, markup_pct, price_cents, stock, reorder_at, descr, img_key, active)
                              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                              ON CONFLICT(id) DO UPDATE SET family=?2, cat=?3, kind=?4, name=?5, size=?6, options=?7,
                                cost_cents=?8, markup_pct=?9, price_cents=?10, reorder_at=?12, descr=?13, img_key=?14, active=?15`)
          .bind(id, str(body.family, 40), oneOf(str(body.cat, 20), P_CATS, "Accessories"), oneOf(str(body.kind, 10), KINDS, "jar"),
            str(body.name, 80), str(body.size, 40), JSON.stringify((body.options || []).slice(0, 8).map((o) => str(o, 40))),
            cost, markup, price, existing ? existing.stock : int(body.stock), int(body.reorderAt, 0, 1000) || 5,
            str(body.descr, 240), imgKey, body.active === false ? 0 : 1).run();
        if (!existing && int(body.stock) > 0) {
          await moveStock(env.DB, { productId: id, kind: "in", qty: int(body.stock), unitCostCents: cost, ref: "opening", note: "Opening stock", createdBy: staff.id });
        }
        await log(existing ? "product.updated" : "product.created", str(body.name, 80), `price ${price / 100}`);
        const margin = marginAfterVat(cost, price, settings.vatInclusive ? settings.vatPct : 0);
        return json({ ok: true, id, price, margin });
      }
      if (method === "DELETE") {
        requireCap(staff, "catalog.edit");
        const table = sub === "service" ? "services" : "products";
        await env.DB.prepare(`UPDATE ${table} SET active = 0 WHERE id = ?1`).bind(str(body.id, 40)).run();
        await log(`${sub}.hidden`, str(body.id, 40));
        return json({ ok: true, message: "Hidden from the shop. Past records keep it." });
      }
      break;
    }

    /* ------------------------------------------------------------ bookkeeping */
    case "accounts": {
      requireCap(staff, "accounts.view");
      if (method === "GET") {
        const url = new URL(request.url);
        const from = str(url.searchParams.get("from") || addDays(today, -30), 10);
        const to = str(url.searchParams.get("to") || today, 10);
        const [accounts, entries, tb] = await Promise.all([
          env.DB.prepare("SELECT * FROM accounts ORDER BY code").all(),
          env.DB.prepare(`SELECT j.*, (SELECT SUM(debit_cents) FROM journal_lines WHERE journal_id = j.id) AS total
                          FROM journal j WHERE j.date BETWEEN ?1 AND ?2 ORDER BY j.date DESC, j.id DESC LIMIT 200`).bind(from, to).all(),
          trialBalance(env.DB, { from, to }),
        ]);
        const lines = await Promise.all((entries.results || []).map(async (e) => ({
          ...e,
          lines: ((await env.DB.prepare(`SELECT l.*, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.code = l.account_code WHERE journal_id = ?1`).bind(e.id).all()).results) || [],
        })));
        return json({ from, to, accounts: accounts.results || [], entries: lines, trialBalance: tb });
      }
      if (method === "POST") {
        requireCap(staff, "accounts.post");
        const entry = await postJournal(env.DB, {
          date: isDate(str(body.date, 10)) ? str(body.date, 10) : today,
          memo: str(body.memo, 200), ref: str(body.ref, 40), source: "manual", createdBy: staff.id,
          lines: (body.lines || []).map((l) => ({ account: str(l.account, 10), debit: int(l.debit) * 100, credit: int(l.credit) * 100, memo: str(l.memo, 200) })),
        });
        await log("journal.posted", `#${entry.id}`, money(entry.total, settings.currency));
        return json({ ok: true, entry }, 201);
      }
      break;
    }

    /* ------------------------------------------------------------ expenses */
    case "expenses": {
      if (method === "GET") {
        requireCap(staff, "expenses.view");
        const rows = await env.DB.prepare("SELECT * FROM expenses ORDER BY date DESC, created_at DESC LIMIT 200").all();
        return json({ expenses: rows.results || [], canApprove: can(staff, "expenses.approve"), cap: settings.approvalOverCents });
      }
      if (method === "POST") {
        requireCap(staff, "expenses.create");
        const amount = int(body.amount) * 100;
        if (amount <= 0) return fail(400, "Enter how much was spent.");
        const id = newId("exp");
        let receiptKey = "";
        if (body.receiptData) {
          const saved = await putDataUrl(env.FILES, `receipts/${id}`, body.receiptData, 3_000_000);
          receiptKey = saved.key;
        }
        const needsApproval = amount >= settings.approvalOverCents || !can(staff, "expenses.approve");
        await env.DB.prepare(`INSERT INTO expenses (id, date, category, payee, amount_cents, method, ref, note, status, receipt_key, created_by)
                              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
          .bind(id, isDate(str(body.date, 10)) ? str(body.date, 10) : today, str(body.category, 40) || "Other costs",
            str(body.payee, 80), amount, oneOf(str(body.method, 10), ["cash", "mpesa", "bank", "card"], "cash"),
            str(body.ref, 40), str(body.note, 300), needsApproval ? "pending" : "approved", receiptKey, staff.id).run();
        if (needsApproval) {
          await env.DB.prepare(`INSERT INTO approvals (id, kind, summary, payload, amount_cents, requested_by)
                                VALUES (?1, 'expense', ?2, ?3, ?4, ?5)`)
            .bind(newId("apr"), `${str(body.category, 40)} · ${money(amount, settings.currency)}`, JSON.stringify({ expenseId: id }), amount, staff.id).run();
        }
        await log("expense.created", id, money(amount, settings.currency));
        return json({ ok: true, id, needsApproval }, 201);
      }
      if (sub === "decide" && method === "POST") {
        requireCap(staff, "expenses.approve");
        const id = str(body.id, 40);
        const expense = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?1").bind(id).first();
        if (!expense) return fail(404, "That expense is gone.");
        const decision = oneOf(str(body.decision, 10), ["approved", "rejected", "paid"], "approved");
        await env.DB.prepare("UPDATE expenses SET status = ?2, decided_by = ?3, decided_at = datetime('now') WHERE id = ?1").bind(id, decision, staff.id).run();
        await env.DB.prepare("UPDATE approvals SET status = ?2, decided_by = ?3, decided_at = datetime('now') WHERE kind='expense' AND payload LIKE ?1")
          .bind(`%${id}%`, decision === "rejected" ? "rejected" : "approved", staff.id).run();
        if (decision === "paid") await postExpense(env.DB, { ...expense, account_code: str(body.account, 10) || "5900" }, { createdBy: staff.id });
        await log("expense.decided", id, decision);
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ approvals */
    case "approvals": {
      requireCap(staff, "approvals.view");
      if (method === "GET") {
        const rows = await env.DB
          .prepare(`SELECT a.*, e.name AS requested_by_name FROM approvals a LEFT JOIN employees e ON e.id = a.requested_by
                    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 100`).all();
        return json({ approvals: rows.results || [], canDecide: can(staff, "approvals.decide") });
      }
      if (method === "POST") {
        requireCap(staff, "approvals.decide");
        const decision = oneOf(str(body.decision, 10), ["approved", "rejected"], "approved");
        await env.DB.prepare("UPDATE approvals SET status = ?2, decided_by = ?3, decided_at = datetime('now'), note = ?4 WHERE id = ?1")
          .bind(str(body.id, 40), decision, staff.id, str(body.note, 300)).run();
        await log("approval.decided", str(body.id, 40), decision);
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ reports */
    case "reports": {
      requireCap(staff, "reports.view");
      const url = new URL(request.url);
      const from = str(url.searchParams.get("from") || addDays(today, -30), 10);
      const to = str(url.searchParams.get("to") || today, 10);
      const [pl, cash, ledger, stock, days] = await Promise.all([
        can(staff, "reports.profit") ? profitAndLoss(env.DB, { from, to }) : null,
        can(staff, "accounts.view") ? cashBook(env.DB, { from, to }) : null,
        salesLedger(env.DB, { from, to }),
        stockValuation(env.DB),
        env.DB.prepare(`SELECT d.date,
                          (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE date = d.date AND status <> 'cancelled') AS shop,
                          (SELECT COALESCE(SUM(price_cents),0) FROM bookings WHERE date = d.date AND status = 'done') AS salon
                        FROM (SELECT DISTINCT date FROM bookings WHERE date BETWEEN ?1 AND ?2
                              UNION SELECT DISTINCT date FROM orders WHERE date BETWEEN ?1 AND ?2) d ORDER BY d.date`).bind(from, to).all(),
      ]);
      const topServices = await env.DB
        .prepare(`SELECT service, COUNT(*) AS n, SUM(price_cents) AS total FROM bookings
                  WHERE status = 'done' AND date BETWEEN ?1 AND ?2 GROUP BY service ORDER BY total DESC LIMIT 8`).bind(from, to).all();
      const topProducts = await env.DB
        .prepare(`SELECT oi.name, SUM(oi.qty) AS units, SUM(oi.qty * oi.price_cents) AS total
                  FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE o.status <> 'cancelled' AND o.date BETWEEN ?1 AND ?2 GROUP BY oi.name ORDER BY total DESC LIMIT 8`).bind(from, to).all();
      return json({
        from, to, profitAndLoss: pl, cashBook: cash, salesLedger: ledger,
        stock: can(staff, "inventory.cost") ? stock : { lowCount: stock.lowCount, items: stock.items.map(({ cost_cents, value_cents, ...r }) => r) },
        daily: days.results || [], topServices: topServices.results || [], topProducts: topProducts.results || [],
      });
    }

    /* ------------------------------------------------------------ tasks */
    case "tasks": {
      requireCap(staff, "tasks.view");
      if (method === "GET") {
        const rows = await env.DB
          .prepare(`SELECT t.*, e.name AS assignee_name FROM tasks t LEFT JOIN employees e ON e.id = t.assignee
                    WHERE t.department = ?1 OR t.assignee = ?2 OR ?3 = 1 ORDER BY t.status, t.due_on LIMIT 200`)
          .bind(staff.department, staff.id, can(staff, "dashboard.all") ? 1 : 0).all();
        return json({ tasks: rows.results || [] });
      }
      if (method === "POST") {
        const id = newId("task");
        await env.DB.prepare(`INSERT INTO tasks (id, department, title, detail, assignee, due_on, priority, created_by)
                              VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
          .bind(id, oneOf(str(body.department, 20), Object.keys(DEPARTMENTS), staff.department), str(body.title, 120),
            str(body.detail, 1000), str(body.assignee, 40) || null, str(body.dueOn, 10) || null,
            oneOf(str(body.priority, 10), ["low", "normal", "high"], "normal"), staff.id).run();
        await log("task.created", str(body.title, 120));
        return json({ ok: true, id }, 201);
      }
      if (method === "PATCH") {
        const status = oneOf(str(body.status, 10), ["open", "doing", "done"], "open");
        await env.DB.prepare("UPDATE tasks SET status = ?2, done_at = CASE WHEN ?2 = 'done' THEN datetime('now') END WHERE id = ?1")
          .bind(str(body.id, 40), status).run();
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ offers */
    case "offers": {
      requireCap(staff, "offers.view");
      if (method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM offers ORDER BY created_at DESC LIMIT 100").all();
        return json({ offers: rows.results || [], discountCap: settings.discountCapPct });
      }
      if (method === "POST" || method === "PUT") {
        requireCap(staff, "offers.edit");
        const discount = int(body.discountPct, 0, 100);
        if (discount > settings.discountCapPct && !can(staff, "discount.approve")) {
          return fail(403, `Discounts above ${settings.discountCapPct}% need management approval.`);
        }
        const id = str(body.id, 40) || newId("off");
        await env.DB.prepare(`INSERT INTO offers (id, title, detail, discount_pct, code, audience, starts_on, ends_on, active, created_by)
                              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                              ON CONFLICT(id) DO UPDATE SET title=?2, detail=?3, discount_pct=?4, code=?5, audience=?6, starts_on=?7, ends_on=?8, active=?9`)
          .bind(id, str(body.title, 120), str(body.detail, 500), discount, str(body.code, 20).toUpperCase(),
            oneOf(str(body.audience, 12), ["all", "returning", "new"], "all"), str(body.startsOn, 10) || null,
            str(body.endsOn, 10) || null, body.active === false ? 0 : 1, staff.id).run();
        await log("offer.saved", str(body.title, 120), `${discount}%`);
        return json({ ok: true, id });
      }
      break;
    }

    /* ------------------------------------------------------------ documents */
    case "documents": {
      requireCap(staff, "documents.view");
      if (method === "GET") {
        const rows = await env.DB
          .prepare(`SELECT * FROM documents WHERE (owner_only = 0 OR ?1 = 1) AND (department = ?2 OR department = 'company' OR ?3 = 1)
                    ORDER BY department, title`)
          .bind(can(staff, "documents.owner") ? 1 : 0, staff.department, can(staff, "dashboard.all") ? 1 : 0).all();
        return json({ documents: (rows.results || []).map((d) => ({ ...d, url: d.file_key ? `/file/${d.file_key}` : d.url })) });
      }
      if (method === "POST") {
        requireCap(staff, "documents.edit");
        const id = newId("doc");
        let fileKey = "", mime = "", size = 0;
        if (body.fileData) {
          const saved = await putDataUrl(env.FILES, `docs/${id}`, body.fileData, 3_000_000);
          fileKey = saved.key; mime = saved.mime; size = saved.size;
        }
        await env.DB.prepare(`INSERT INTO documents (id, department, title, kind, body, url, file_key, mime, size_bytes, owner_only, uploaded_by)
                              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
          .bind(id, oneOf(str(body.department, 20), [...Object.keys(DEPARTMENTS), "company"], staff.department),
            str(body.title, 120), fileKey ? "file" : body.url ? "link" : "note", str(body.body, 20000),
            /^https:\/\//.test(str(body.url, 400)) ? str(body.url, 400) : "", fileKey, mime, size,
            can(staff, "documents.owner") ? (body.ownerOnly ? 1 : 0) : 0, staff.id).run();
        await log("document.added", str(body.title, 120));
        return json({ ok: true, id }, 201);
      }
      if (method === "PUT") {
        requireCap(staff, "documents.edit");
        await env.DB.prepare("UPDATE documents SET title = ?2, body = ?3 WHERE id = ?1")
          .bind(str(body.id, 40), str(body.title, 120), str(body.body, 20000)).run();
        return json({ ok: true });
      }
      if (method === "DELETE") {
        requireCap(staff, "documents.edit");
        const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ?1").bind(str(body.id, 40)).first();
        if (doc?.file_key) await env.FILES.delete(doc.file_key).catch(() => {});
        await env.DB.prepare("DELETE FROM documents WHERE id = ?1").bind(str(body.id, 40)).run();
        await log("document.deleted", doc?.title || str(body.id, 40));
        return json({ ok: true });
      }
      break;
    }

    /* ------------------------------------------------------------ visitors */
    case "visitors": {
      requireCap(staff, "visitors.view");
      const since14 = addDays(today, -13), since30 = addDays(today, -29);
      const [perDay, visitors, customers, totals] = await Promise.all([
        env.DB.prepare("SELECT date, COUNT(*) AS n FROM daily_visits WHERE date >= ?1 GROUP BY date ORDER BY date").bind(since14).all(),
        env.DB.prepare(`SELECT v.*, c.name AS customer_name FROM visitors v LEFT JOIN customers c ON c.id = v.customer_id
                        WHERE date(v.last_seen) >= ?1 ORDER BY v.last_seen DESC LIMIT 300`).bind(since30).all(),
        env.DB.prepare(`SELECT c.id, c.name, c.email, c.phone, c.picture, c.created_at, c.last_seen_at,
                          (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS bookings,
                          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders
                        FROM customers c ORDER BY COALESCE(c.last_seen_at, c.created_at) DESC LIMIT 300`).all(),
        env.DB.prepare(`SELECT (SELECT COUNT(*) FROM daily_visits WHERE date = ?1) AS today,
                               (SELECT COUNT(DISTINCT vid) FROM daily_visits WHERE date >= ?2) AS week,
                               (SELECT COUNT(DISTINCT vid) FROM daily_visits WHERE date >= ?3) AS month,
                               (SELECT COUNT(*) FROM customers) AS customers,
                               (SELECT COUNT(*) FROM visitors WHERE visits > 1) AS repeat_visitors`)
          .bind(today, addDays(today, -6), since30).first(),
      ]);
      const map = Object.fromEntries((perDay.results || []).map((r) => [r.date, r.n]));
      return json({
        today, totals,
        days: Array.from({ length: 14 }, (_, i) => { const d = addDays(since14, i); return { date: d, visitors: map[d] || 0 }; }),
        visitors: visitors.results || [],
        customers: customers.results || [],
      });
    }

    /* ------------------------------------------------------------ settings & security */
    case "settings": {
      if (method === "GET") {
        requireCap(staff, "settings.edit");
        return json({ settings, channels: channels(env), departments: DEPARTMENTS, canEdit: true });
      }
      if (method === "PUT") {
        requireCap(staff, "settings.edit");
        const allowed = ["name", "tagline", "currency", "timezone", "depositPct", "deliveryFee", "freeOver", "chairs", "open", "close",
          "vatPct", "vatInclusive", "defaultMarkupPct", "discountCapPct", "approvalOverCents", "whatsapp", "phone", "phone2",
          "supportEmail", "salesEmail", "bookingsEmail", "address", "hours", "googleClientId", "googleSiteVerification", "loyaltyVisitsForReward"];
        const patch = {};
        for (const key of allowed) {
          if (body[key] === undefined) continue;
          if (["depositPct", "deliveryFee", "freeOver", "chairs", "open", "close", "vatPct", "defaultMarkupPct", "discountCapPct", "approvalOverCents", "loyaltyVisitsForReward"].includes(key)) patch[key] = int(body[key]);
          else if (key === "vatInclusive") patch[key] = body[key] ? 1 : 0;
          else if (key === "googleClientId") {
            const gid = str(body[key], 200);
            patch[key] = /^[\w.-]+\.apps\.googleusercontent\.com$/.test(gid) || gid === "" ? gid : settings.googleClientId;
          } else patch[key] = str(body[key], 200);
        }
        if (patch.close !== undefined && patch.open !== undefined && patch.close <= patch.open) return fail(400, "Closing hour must be later than the first booking hour.");
        const updated = await saveSettings(env.DB, patch);
        await log("settings.updated", Object.keys(patch).join(", "));
        return json({ settings: updated });
      }
      if (sub === "test-alert" && method === "POST") {
        requireCap(staff, "settings.edit");
        const ch = channels(env);
        if (!ch.whatsapp && !ch.email) return fail(400, "No alerts are set up yet. Add the WhatsApp or email keys, then try again.");
        return json({ results: await notifyTest(env, settings, new URL(request.url).origin) });
      }
      break;
    }

    case "security": {
      requireCap(staff, "security.view");
      const [log1, sessions, locks, staffList] = await Promise.all([
        env.DB.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT 200").all(),
        env.DB.prepare(`SELECT s.subject_type, s.subject_id, s.created_at, s.last_seen_at, s.expires_at, e.name AS staff_name, c.name AS customer_name
                        FROM sessions s LEFT JOIN employees e ON e.id = s.subject_id LEFT JOIN customers c ON c.id = s.subject_id
                        ORDER BY s.last_seen_at DESC LIMIT 50`).all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE locked_until > datetime('now')").first(),
        env.DB.prepare("SELECT id, name, email, department, role, totp_enabled, must_change, status, last_login_at FROM employees ORDER BY name").all(),
      ]);
      return json({
        audit: log1.results || [],
        sessions: sessions.results || [],
        lockedAccounts: locks?.n || 0,
        staff: staffList.results || [],
        checks: securityChecklist(env, settings, staffList.results || []),
      });
    }

    case "backup": {
      requireCap(staff, "backup.download");
      const tables = ["settings", "employees", "customers", "services", "products", "bookings", "orders", "order_items",
        "stock_moves", "accounts", "journal", "journal_lines", "expenses", "payments", "approvals", "tasks", "offers", "documents", "visitors"];
      const dump = {};
      for (const t of tables) {
        const rows = await env.DB.prepare(`SELECT * FROM ${t}`).all();
        dump[t] = (rows.results || []).map((r) => {
          const copy = { ...r };
          delete copy.password_hash;   // a backup must never carry passwords
          delete copy.totp_secret;
          return copy;
        });
      }
      await log("backup.downloaded", `${tables.length} tables`);
      return new Response(JSON.stringify({ app: "twins-locs-arena", version: 2, exportedAt: new Date().toISOString(), tables: dump }, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="twins-locs-arena-backup-${today}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  return fail(404, "Not found");
}

function securityChecklist(env, settings, staffList) {
  const owners = staffList.filter((s) => s.role === "owner");
  const withTwoStep = staffList.filter((s) => s.totp_enabled).length;
  return [
    // Two-step is off until someone chooses it in their own portal, so this is advice, not a failure.
    { key: "2fa", label: "Two-step verification (optional)", ok: true, optional: true,
      note: withTwoStep ? `${withTwoStep} of ${staffList.length} accounts use it.` : "Nobody uses it yet. It is off by default.",
      fix: "Anyone can switch it on for their own account: Security → Turn on two-step verification." },
    { key: "temp_passwords", label: "No one still using a temporary password", ok: !staffList.some((s) => s.must_change && s.status === "active"), fix: "Ask them to sign in and set their own password." },
    { key: "alerts", label: "Booking alerts connected", ok: channels(env).whatsapp || channels(env).email, fix: "Add the WhatsApp or email keys in the Cloudflare dashboard." },
    { key: "session_secret", label: "Server signing key set", ok: Boolean(env.SESSION_SECRET), fix: "Run: wrangler secret put SESSION_SECRET" },
    { key: "support_contacts", label: "Support phone and email shown to clients", ok: Boolean(settings.phone && settings.supportEmail), fix: "Fill them in on the Settings page." },
    { key: "suspended", label: "Former staff suspended, not left active", ok: true, fix: "Suspend anyone who has left from the Employees page." },
  ];
}
