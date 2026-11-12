// Database helpers: settings, seeding, audit trail.

import { CHART_OF_ACCOUNTS, DEFAULT_AGENTS, DEFAULT_PRODUCTS, DEFAULT_SERVICES, DEFAULT_SETTINGS, DOCUMENT_TEMPLATES } from "./seed.js";
import { newId } from "./util.js";

export async function getSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows.results || []) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export async function saveSettings(db, patch) {
  const stmts = Object.entries(patch).map(([k, v]) =>
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`).bind(k, JSON.stringify(v)),
  );
  if (stmts.length) await db.batch(stmts);
  return getSettings(db);
}

export async function audit(db, { actor, action, target = "", detail = "" }) {
  await db
    .prepare("INSERT INTO audit_log (actor_type, actor_id, actor_name, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(actor?.type || "system", actor?.id || "", actor?.name || "", action, String(target).slice(0, 120), String(detail).slice(0, 500))
    .run();
}

/* Fills an empty database. Safe to run again: it only inserts what is missing. */
export async function ensureSeeded(db) {
  const seeded = await db.prepare("SELECT value FROM settings WHERE key = 'seeded'").first();
  if (seeded) return false;

  const stmts = [];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)").bind(key, JSON.stringify(value)));
  }
  for (const [i, s] of DEFAULT_SERVICES.entries()) {
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO services (id, cat, name, price_cents, dur, care, descr, sort)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(s.id, s.cat, s.name, s.price, s.dur, s.care, s.descr, i),
    );
  }
  for (const p of DEFAULT_PRODUCTS) {
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO products (id, family, cat, kind, name, size, cost_cents, markup_pct, price_cents, stock, descr)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(p.id, p.family, p.cat, p.kind, p.name, p.size, p.cost, p.markup, p.price, p.stock, p.descr),
    );
    if (p.stock > 0) {
      stmts.push(
        db.prepare(`INSERT INTO stock_moves (product_id, kind, qty, unit_cost_cents, balance_after, ref, note, created_by)
                    VALUES (?1, 'in', ?2, ?3, ?2, 'opening', 'Opening stock count', 'system')`).bind(p.id, p.stock, p.cost),
      );
    }
  }
  for (const [code, name, type] of CHART_OF_ACCOUNTS) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?1, ?2, ?3)").bind(code, name, type));
  }
  for (const a of DEFAULT_AGENTS) {
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO agents (id, name, title, department, brief, skills, starters, sort)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(a.id, a.name, a.title, a.department, a.brief, JSON.stringify(a.skills), JSON.stringify(a.starters), a.sort),
    );
  }
  for (const [dept, title, body] of DOCUMENT_TEMPLATES) {
    stmts.push(
      db.prepare(`INSERT INTO documents (id, department, title, kind, body, uploaded_by) VALUES (?1, ?2, ?3, 'note', ?4, 'system')`)
        .bind(newId("doc"), dept, title, `${body}\n\n(Blank template - replace this with your own wording.)`),
    );
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded', '\"yes\"')"));
  await db.batch(stmts);
  await audit(db, { actor: { type: "system", name: "setup" }, action: "database.seeded", detail: "Starting menu, shop shelf, accounts and AI team created" });
  return true;
}

/* The owner account is claimed once, with a code only the owner has. */
export async function ownerExists(db) {
  const row = await db.prepare("SELECT id FROM employees WHERE role = 'owner' LIMIT 1").first();
  return Boolean(row);
}
