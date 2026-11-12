// Who may see and do what. One file decides it for the whole system, and the
// server applies it - the browser is never trusted to hide anything.

export const DEPARTMENTS = {
  management: {
    name: "Management",
    blurb: "Runs the business: sees every department, approves money, sets prices and pay.",
    colour: "#6B3A22",
  },
  admin: {
    name: "Administration",
    blurb: "Front desk: bookings, clients, staff records, offers and company files.",
    colour: "#7A4424",
  },
  accounts: {
    name: "Accounts",
    blurb: "Money: invoices, payments, expenses, cash book, profit and loss.",
    colour: "#3B5886",
  },
  employee: {
    name: "Employee",
    blurb: "Locticians and shop staff: their own day, their clients, stock they use.",
    colour: "#3D7337",
  },
};

export const ROLES = { owner: "Owner", head: "Department head", staff: "Team member" };

// Capability keys used by the server and the hub menu.
export const CAPS = {
  management: [
    "dashboard.all", "bookings.view", "bookings.edit", "bookings.assign",
    "clients.view", "clients.edit", "orders.view", "orders.edit",
    "inventory.view", "inventory.move", "inventory.cost",
    "catalog.view", "catalog.edit", "price.edit",
    "accounts.view", "accounts.post", "expenses.view", "expenses.create", "expenses.approve",
    "reports.view", "reports.profit", "payroll.view",
    "staff.view", "staff.edit", "staff.password", "staff.pay",
    "approvals.view", "approvals.decide", "discount.approve",
    "offers.view", "offers.edit", "tasks.view", "tasks.assign",
    "documents.view", "documents.edit", "documents.owner",
    "agents.use", "agents.edit", "settings.edit", "security.view", "visitors.view", "backup.download",
  ],
  admin: [
    "dashboard.dept", "bookings.view", "bookings.edit", "bookings.assign",
    "clients.view", "clients.edit", "orders.view", "orders.edit",
    "inventory.view", "inventory.move", "catalog.view", "catalog.edit",
    "expenses.view", "expenses.create",
    "staff.view", "staff.edit",
    "approvals.view", "offers.view", "offers.edit",
    "tasks.view", "tasks.assign", "documents.view", "documents.edit",
    "agents.use", "visitors.view", "reports.view",
  ],
  accounts: [
    "dashboard.dept", "bookings.view", "orders.view", "orders.edit",
    "clients.view",
    "inventory.view", "inventory.cost", "inventory.move",
    "catalog.view", "price.edit",
    "accounts.view", "accounts.post", "expenses.view", "expenses.create", "expenses.approve",
    "reports.view", "reports.profit", "payroll.view",
    "approvals.view", "approvals.decide",
    "tasks.view", "documents.view", "documents.edit", "agents.use", "backup.download",
  ],
  employee: [
    "dashboard.me", "bookings.view", "bookings.edit",
    "clients.view",
    "inventory.view", "inventory.move",
    "catalog.view", "orders.view",
    "tasks.view", "documents.view", "agents.use", "expenses.create",
  ],
};

// A department head gets a little more than a team member.
const HEAD_EXTRA = {
  admin: ["staff.password", "approvals.decide"],
  accounts: ["approvals.decide"],
  employee: ["tasks.assign", "bookings.assign"],
  management: [],
};

export function capabilitiesFor(staff) {
  if (!staff || staff.status !== "active") return new Set();
  const base = CAPS[staff.department] || [];
  const extra = staff.role === "owner" ? CAPS.management : staff.role === "head" ? HEAD_EXTRA[staff.department] || [] : [];
  return new Set([...base, ...extra]);
}

export const can = (staff, cap) => capabilitiesFor(staff).has(cap);

export function requireCap(staff, cap) {
  if (!can(staff, cap)) {
    const err = new Error("Your account doesn’t have access to that. Ask management if you need it.");
    err.status = 403;
    throw err;
  }
}

// Fields the server removes before sending a record to someone without the capability.
const HIDDEN = {
  product: [
    ["cost_cents", "inventory.cost"],
    ["markup_pct", "inventory.cost"],
  ],
  order: [["cost_cents", "reports.profit"]],
  employee: [
    ["pay_rate_cents", "staff.pay"],
    ["totp_secret", "never"],
    ["password_hash", "never"],
  ],
  customer: [
    ["password_hash", "never"],
    ["google_sub", "never"],
  ],
};

export function strip(kind, row, staff) {
  if (!row) return row;
  const out = { ...row };
  for (const [field, cap] of HIDDEN[kind] || []) {
    if (cap === "never" || !can(staff, cap)) delete out[field];
  }
  return out;
}

export const stripAll = (kind, rows, staff) => (rows || []).map((r) => strip(kind, r, staff));

// The hub menu: section key, label, which capability opens it.
export const SECTIONS = [
  { key: "today", label: "Today", cap: null, icon: "today" },
  { key: "bookings", label: "Bookings", cap: "bookings.view", icon: "calendar" },
  { key: "clients", label: "Clients", cap: "clients.view", icon: "clients" },
  { key: "orders", label: "Shop orders", cap: "orders.view", icon: "orders" },
  { key: "inventory", label: "Inventory", cap: "inventory.view", icon: "stock" },
  { key: "catalog", label: "Services & products", cap: "catalog.view", icon: "tags" },
  { key: "accounts", label: "Bookkeeping", cap: "accounts.view", icon: "ledger" },
  { key: "expenses", label: "Expenses", cap: "expenses.view", icon: "receipt" },
  { key: "approvals", label: "Approvals", cap: "approvals.view", icon: "check" },
  { key: "reports", label: "Reports", cap: "reports.view", icon: "chart" },
  { key: "staff", label: "Employees", cap: "staff.view", icon: "staff" },
  { key: "tasks", label: "Tasks", cap: "tasks.view", icon: "tasks" },
  { key: "offers", label: "Offers", cap: "offers.view", icon: "offer" },
  { key: "documents", label: "Documents", cap: "documents.view", icon: "folder" },
  { key: "agents", label: "AI team", cap: "agents.use", icon: "agent" },
  { key: "visitors", label: "Visitors", cap: "visitors.view", icon: "visitors" },
  { key: "settings", label: "Settings", cap: "settings.edit", icon: "settings" },
  { key: "security", label: "Security", cap: "security.view", icon: "shield" },
];

export const sectionsFor = (staff) => SECTIONS.filter((s) => !s.cap || can(staff, s.cap));
