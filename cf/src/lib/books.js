// Bookkeeping and stock. Every money movement becomes a balanced journal entry,
// and every stock movement becomes a line in the stock ledger.

import { HttpError, todayIn } from "./util.js";

/* ---------------------------------------------------------------- journal */
// lines: [{ account, debit?, credit?, memo? }] in cents. Debits must equal credits.
export async function postJournal(db, { date, memo, ref = "", source = "manual", createdBy = "", lines }) {
  const clean = (lines || [])
    .map((l) => ({ account: String(l.account), debit: Math.round(l.debit || 0), credit: Math.round(l.credit || 0), memo: String(l.memo || "").slice(0, 200) }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  if (clean.length < 2) throw new HttpError(400, "An entry needs at least two lines.");
  if (clean.some((l) => l.debit > 0 && l.credit > 0)) throw new HttpError(400, "A line can be a debit or a credit, not both.");
  const debits = clean.reduce((a, l) => a + l.debit, 0);
  const credits = clean.reduce((a, l) => a + l.credit, 0);
  if (debits !== credits) throw new HttpError(400, `This entry doesn’t balance: debits ${debits / 100} vs credits ${credits / 100}.`);

  const known = await db.prepare("SELECT code FROM accounts").all();
  const codes = new Set((known.results || []).map((r) => r.code));
  const missing = clean.find((l) => !codes.has(l.account));
  if (missing) throw new HttpError(400, `There is no account with code ${missing.account}.`);

  const res = await db
    .prepare("INSERT INTO journal (date, memo, ref, source, created_by) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(date, String(memo).slice(0, 200), ref, source, createdBy)
    .run();
  const journalId = res.meta.last_row_id;
  await db.batch(
    clean.map((l) =>
      db.prepare("INSERT INTO journal_lines (journal_id, account_code, debit_cents, credit_cents, memo) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(journalId, l.account, l.debit, l.credit, l.memo),
    ),
  );
  return { id: journalId, lines: clean, total: debits };
}

const ACC = {
  cash: "1000", mpesa: "1010", bank: "1020", card: "1020",
  receivable: "1100", stock: "1200", deposits: "2100", vat: "2200",
  serviceIncome: "4000", productIncome: "4100", discounts: "4900", cogs: "5000",
};

export const payMethodAccount = (method) => ACC[method] || ACC.cash;

/* A shop order that has been paid: money in, income out, stock and cost moved. */
export async function postOrderSale(db, order, { method = "mpesa", createdBy = "", vatPct = 16, vatInclusive = true } = {}) {
  const gross = order.total_cents;
  const vat = vatInclusive && vatPct > 0 ? Math.round(gross - gross / (1 + vatPct / 100)) : 0;
  const net = gross - vat;
  const lines = [
    { account: payMethodAccount(method), debit: gross, memo: `Order ${order.id}` },
    { account: ACC.productIncome, credit: net, memo: `Order ${order.id}` },
  ];
  if (vat > 0) lines.push({ account: ACC.vat, credit: vat, memo: "VAT on sale" });
  if (order.cost_cents > 0) {
    lines.push({ account: ACC.cogs, debit: order.cost_cents, memo: "Cost of products sold" });
    lines.push({ account: ACC.stock, credit: order.cost_cents, memo: "Stock out" });
  }
  return postJournal(db, { date: order.date, memo: `Shop order ${order.id}`, ref: order.id, source: "order", createdBy, lines });
}

/* A finished salon session. */
export async function postServiceSale(db, booking, { method = "mpesa", createdBy = "", vatPct = 16, vatInclusive = true } = {}) {
  const gross = booking.price_cents;
  const vat = vatInclusive && vatPct > 0 ? Math.round(gross - gross / (1 + vatPct / 100)) : 0;
  const lines = [
    { account: payMethodAccount(method), debit: gross, memo: `Session ${booking.id}` },
    { account: ACC.serviceIncome, credit: gross - vat, memo: `${booking.service} · ${booking.name}` },
  ];
  if (vat > 0) lines.push({ account: ACC.vat, credit: vat, memo: "VAT on service" });
  return postJournal(db, { date: booking.date, memo: `Session ${booking.id} · ${booking.service}`, ref: booking.id, source: "booking", createdBy, lines });
}

export async function postExpense(db, expense, { createdBy = "" } = {}) {
  return postJournal(db, {
    date: expense.date,
    memo: `${expense.category}${expense.payee ? ` · ${expense.payee}` : ""}`,
    ref: expense.ref || expense.id,
    source: "expense",
    createdBy,
    lines: [
      { account: expense.account_code || "5900", debit: expense.amount_cents, memo: expense.note || expense.category },
      { account: payMethodAccount(expense.method), credit: expense.amount_cents, memo: `Paid by ${expense.method}` },
    ],
  });
}

/* ---------------------------------------------------------------- stock */
const SIGN = { in: 1, return: 1, out: -1, sale: -1, adjust: 1 };

// Moves stock and writes the ledger line. `qty` is always positive except for an
// adjustment, which may be negative (a count that came up short).
export async function moveStock(db, { productId, kind, qty, unitCostCents = null, ref = "", note = "", createdBy = "" }) {
  if (!SIGN[kind]) throw new HttpError(400, "Stock moves can only be In, Out, Sale, Return or Adjust.");
  const product = await db.prepare("SELECT id, name, stock, cost_cents FROM products WHERE id = ?1").bind(productId).first();
  if (!product) throw new HttpError(404, "That product is not in the shop any more.");
  const amount = kind === "adjust" ? Math.round(qty) : Math.abs(Math.round(qty)) * SIGN[kind];
  if (!amount) throw new HttpError(400, "Enter how many units moved.");
  const balance = product.stock + amount;
  if (balance < 0) throw new HttpError(409, `${product.name}: only ${product.stock} left, so ${Math.abs(amount)} cannot go out.`);

  await db.batch([
    db.prepare("UPDATE products SET stock = ?2 WHERE id = ?1").bind(productId, balance),
    db.prepare(`INSERT INTO stock_moves (product_id, kind, qty, unit_cost_cents, balance_after, ref, note, created_by)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(productId, kind, amount, unitCostCents ?? product.cost_cents, balance, ref, note, createdBy),
  ]);
  return { productId, name: product.name, moved: amount, balance };
}

// Buying stock in is also a bookkeeping entry: stock goes up, money goes down.
export async function postStockPurchase(db, { productId, qty, unitCostCents, method = "cash", date, createdBy = "", ref = "" }) {
  const total = Math.abs(qty) * unitCostCents;
  if (total <= 0) return null;
  return postJournal(db, {
    date: date || todayIn(),
    memo: "Stock purchase",
    ref,
    source: "manual",
    createdBy,
    lines: [
      { account: ACC.stock, debit: total, memo: `${qty} units in` },
      { account: payMethodAccount(method), credit: total, memo: `Paid by ${method}` },
    ],
  });
}

/* ---------------------------------------------------------------- reports */
export async function trialBalance(db, { from, to }) {
  const rows = await db
    .prepare(`SELECT a.code, a.name, a.type,
                     COALESCE(SUM(l.debit_cents), 0)  AS debit,
                     COALESCE(SUM(l.credit_cents), 0) AS credit
              FROM accounts a
              LEFT JOIN journal_lines l ON l.account_code = a.code
              LEFT JOIN journal j ON j.id = l.journal_id AND j.date BETWEEN ?1 AND ?2
              WHERE j.id IS NOT NULL OR l.id IS NULL
              GROUP BY a.code ORDER BY a.code`)
    .bind(from, to)
    .all();
  return (rows.results || []).map((r) => ({ ...r, balance: r.debit - r.credit }));
}

export async function profitAndLoss(db, { from, to }) {
  const rows = await db
    .prepare(`SELECT a.code, a.name, a.type,
                     COALESCE(SUM(l.credit_cents), 0) - COALESCE(SUM(l.debit_cents), 0) AS net
              FROM journal_lines l
              JOIN journal j ON j.id = l.journal_id
              JOIN accounts a ON a.code = l.account_code
              WHERE j.date BETWEEN ?1 AND ?2 AND a.type IN ('income','expense')
              GROUP BY a.code ORDER BY a.code`)
    .bind(from, to)
    .all();
  const income = [], expenses = [];
  for (const r of rows.results || []) {
    if (r.type === "income") income.push({ ...r, amount: r.net });
    else expenses.push({ ...r, amount: -r.net });
  }
  const totalIncome = income.reduce((a, r) => a + r.amount, 0);
  const totalExpenses = expenses.reduce((a, r) => a + r.amount, 0);
  return { from, to, income, expenses, totalIncome, totalExpenses, profit: totalIncome - totalExpenses };
}

export async function cashBook(db, { from, to }) {
  const rows = await db
    .prepare(`SELECT j.date, j.memo, j.ref, a.code, a.name,
                     l.debit_cents AS inflow, l.credit_cents AS outflow
              FROM journal_lines l
              JOIN journal j ON j.id = l.journal_id
              JOIN accounts a ON a.code = l.account_code
              WHERE a.code IN ('1000','1010','1020') AND j.date BETWEEN ?1 AND ?2
              ORDER BY j.date, j.id`)
    .bind(from, to)
    .all();
  let balance = 0;
  const entries = (rows.results || []).map((r) => {
    balance += r.inflow - r.outflow;
    return { ...r, balance };
  });
  return { from, to, entries, closing: balance };
}

export async function stockValuation(db) {
  const rows = await db
    .prepare("SELECT id, name, size, stock, cost_cents, price_cents, reorder_at FROM products WHERE active = 1 ORDER BY name")
    .all();
  const items = (rows.results || []).map((r) => ({ ...r, value_cents: r.stock * r.cost_cents, retail_cents: r.stock * r.price_cents }));
  return {
    items,
    totalCost: items.reduce((a, r) => a + r.value_cents, 0),
    totalRetail: items.reduce((a, r) => a + r.retail_cents, 0),
    lowCount: items.filter((r) => r.stock <= r.reorder_at).length,
  };
}

export async function salesLedger(db, { from, to }) {
  const orders = await db
    .prepare(`SELECT date, COUNT(*) AS count, SUM(total_cents) AS total, SUM(cost_cents) AS cost
              FROM orders WHERE status <> 'cancelled' AND date BETWEEN ?1 AND ?2 GROUP BY date ORDER BY date`)
    .bind(from, to).all();
  const sessions = await db
    .prepare(`SELECT date, COUNT(*) AS count, SUM(price_cents) AS total
              FROM bookings WHERE status = 'done' AND date BETWEEN ?1 AND ?2 GROUP BY date ORDER BY date`)
    .bind(from, to).all();
  return { orders: orders.results || [], sessions: sessions.results || [] };
}
