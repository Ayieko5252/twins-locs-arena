-- Twins Locs Arena operations database (Cloudflare D1 / SQLite).
-- Money is stored in cents as integers so totals never drift.
-- Run with: npm run db:init   (local)   /   npm run db:init:remote

PRAGMA foreign_keys = ON;

------------------------------------------------------------------ settings
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,                       -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------------ people
-- Staff. One row per employee; department + role decide what they can see.
CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',     -- e.g. Senior Loctician
  department    TEXT NOT NULL,                -- management | admin | accounts | employee
  role          TEXT NOT NULL,                -- owner | head | staff
  status        TEXT NOT NULL DEFAULT 'active', -- active | suspended
  password_hash TEXT,                          -- PBKDF2; NULL until first password set
  must_change   INTEGER NOT NULL DEFAULT 1,
  totp_secret   TEXT,                          -- base32, set when 2-step is on
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  terms_accepted_at TEXT,
  hired_on      TEXT,
  pay_rate_cents INTEGER NOT NULL DEFAULT 0,   -- hidden from everyone but management/accounts
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department, status);

-- Customers. Either a password, a Google account, or both.
CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  picture       TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in INTEGER NOT NULL DEFAULT 1,
  notes         TEXT NOT NULL DEFAULT '',      -- staff notes about their locs
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

------------------------------------------------------------------ sessions & security
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,              -- sha256 of the cookie token
  subject_type TEXT NOT NULL,                 -- staff | customer
  subject_id   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  idle_seconds INTEGER NOT NULL,
  ua_hash      TEXT NOT NULL DEFAULT '',
  two_factor_ok INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS auth_tokens (                 -- password reset / invite / verify
  id         TEXT PRIMARY KEY,                -- sha256 of the emailed token
  kind       TEXT NOT NULL,                   -- reset | invite | verify
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,              -- hashed identifier + ip
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

------------------------------------------------------------------ catalogue
CREATE TABLE IF NOT EXISTS services (
  id        TEXT PRIMARY KEY,
  cat       TEXT NOT NULL,
  name      TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  dur       TEXT NOT NULL DEFAULT '',
  care      TEXT NOT NULL DEFAULT '',
  descr     TEXT NOT NULL DEFAULT '',
  img_key   TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  family      TEXT NOT NULL DEFAULT '',       -- one shop card per family
  cat         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'jar',    -- placeholder drawing
  name        TEXT NOT NULL,
  size        TEXT NOT NULL DEFAULT '',
  options     TEXT NOT NULL DEFAULT '[]',     -- JSON ["Brand: X","Size: 250ml"]
  cost_cents  INTEGER NOT NULL DEFAULT 0,     -- never leaves the server for shop/employee
  markup_pct  INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  reorder_at  INTEGER NOT NULL DEFAULT 5,
  descr       TEXT NOT NULL DEFAULT '',
  img_key     TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_family ON products(family);

------------------------------------------------------------------ bookings & orders
CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,               -- TLA-Bxxxxx
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  service_id  TEXT,
  service     TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  date        TEXT NOT NULL,                  -- YYYY-MM-DD
  time        TEXT NOT NULL,                  -- HH:00
  status      TEXT NOT NULL DEFAULT 'pending',-- pending|confirmed|done|cancelled|no_show
  notes       TEXT NOT NULL DEFAULT '',
  assigned_to TEXT REFERENCES employees(id) ON DELETE SET NULL,
  reminded_at TEXT,
  notified    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, time);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,             -- TLA-Oxxxxx
  customer_id   TEXT REFERENCES customers(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  delivery_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents   INTEGER NOT NULL DEFAULT 0,
  cost_cents    INTEGER NOT NULL DEFAULT 0,   -- cost of goods, for profit reports
  fulfilment    TEXT NOT NULL DEFAULT 'pickup',
  address       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',  -- new|packed|dispatched|completed|cancelled
  paid          INTEGER NOT NULL DEFAULT 0,
  payment_ref   TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL,
  notified      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref) WHERE payment_ref <> '';
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT,
  name        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  cost_cents  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

------------------------------------------------------------------ inventory
CREATE TABLE IF NOT EXISTS stock_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('in','out','sale','return','adjust')),
  qty         INTEGER NOT NULL,               -- signed: +in/+return, -out/-sale
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL DEFAULT 0,
  ref         TEXT NOT NULL DEFAULT '',       -- order id, supplier invoice, count sheet
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_moves(product_id, created_at DESC);

------------------------------------------------------------------ bookkeeping
CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense'))
);

CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  memo       TEXT NOT NULL DEFAULT '',
  ref        TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'manual',  -- manual|order|booking|expense|payroll
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(date DESC);

CREATE TABLE IF NOT EXISTS journal_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id   INTEGER NOT NULL REFERENCES journal(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  debit_cents  INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  memo         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lines_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_code);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  payee       TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  method      TEXT NOT NULL DEFAULT 'cash',   -- cash|mpesa|bank|card
  ref         TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',-- pending|approved|rejected|paid
  receipt_key TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  decided_by  TEXT NOT NULL DEFAULT '',
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                   -- booking_deposit|booking_balance|order|other
  ref        TEXT NOT NULL DEFAULT '',        -- M-Pesa code etc
  source_id  TEXT NOT NULL DEFAULT '',        -- booking or order id
  amount_cents INTEGER NOT NULL,
  method     TEXT NOT NULL DEFAULT 'mpesa',
  received_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref) WHERE ref <> '';

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- expense|discount|refund|stock_adjust|price_change
  summary     TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',-- pending|approved|rejected
  requested_by TEXT NOT NULL DEFAULT '',
  decided_by  TEXT NOT NULL DEFAULT '',
  decided_at  TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------------ running the salon
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  assignee   TEXT REFERENCES employees(id) ON DELETE SET NULL,
  due_on     TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal',
  status     TEXT NOT NULL DEFAULT 'open',    -- open|doing|done
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department, status);

CREATE TABLE IF NOT EXISTS shifts (
  id         TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  starts     TEXT NOT NULL,
  ends       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);

CREATE TABLE IF NOT EXISTS offers (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  discount_pct INTEGER NOT NULL DEFAULT 0,
  code       TEXT NOT NULL DEFAULT '',
  audience   TEXT NOT NULL DEFAULT 'all',     -- all|returning|new
  starts_on  TEXT,
  ends_on    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  department TEXT NOT NULL,                   -- management|admin|accounts|employee|company
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'file',    -- file|link|note
  body       TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  file_key   TEXT NOT NULL DEFAULT '',
  mime       TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  owner_only INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_dept ON documents(department);

------------------------------------------------------------------ visitors & agents
CREATE TABLE IF NOT EXISTS visitors (
  vid        TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  visits     INTEGER NOT NULL DEFAULT 1,
  device     TEXT NOT NULL DEFAULT '',
  os         TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'Direct',
  last_path  TEXT NOT NULL DEFAULT '',
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS daily_visits (
  date TEXT NOT NULL,
  vid  TEXT NOT NULL,
  PRIMARY KEY (date, vid)
);

CREATE TABLE IF NOT EXISTS agents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  title      TEXT NOT NULL,
  department TEXT NOT NULL,
  brief      TEXT NOT NULL,                   -- what this agent is told to be
  skills     TEXT NOT NULL DEFAULT '[]',
  starters   TEXT NOT NULL DEFAULT '[]',      -- suggested questions
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  asked_by   TEXT NOT NULL DEFAULT '',
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL DEFAULT '',
  ok         INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id, created_at DESC);

------------------------------------------------------------------ gallery
-- Photos of work done on real clients. A photo only reaches the website when
-- the client has agreed to it, and that agreement is recorded here.
CREATE TABLE IF NOT EXISTS gallery (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  service_id  TEXT,
  service     TEXT NOT NULL DEFAULT '',
  caption     TEXT NOT NULL DEFAULT '',
  img_key     TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',      -- staff reference only, never public
  consent     INTEGER NOT NULL DEFAULT 0,    -- the client agreed we may show it
  consent_note TEXT NOT NULL DEFAULT '',     -- how and when they agreed
  published   INTEGER NOT NULL DEFAULT 0,
  featured    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gallery_public ON gallery(published, consent, sort);
