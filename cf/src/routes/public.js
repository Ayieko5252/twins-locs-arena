// What anyone on the website can reach: the menu, the shop, booking a chair,
// placing an order, and the anonymous visit counter.

import { audit, ensureSeeded, getSettings } from "../lib/db.js";
import { moveStock } from "../lib/books.js";
import { currentCustomer } from "./customer.js";
import { notifyBooking, notifyOrder } from "../lib/notify.js";
import {
  addDays, bad, bookingId, fail, HttpError, int, isDate, json, newId, orderId, readJson, str, todayIn, validPhone, email as cleanEmail, phoneDigits,
} from "../lib/util.js";

const publicProduct = (p) => ({
  id: p.id, family: p.family, cat: p.cat, kind: p.kind, name: p.name, size: p.size,
  options: JSON.parse(p.options || "[]"), price: p.price_cents, stock: p.stock, descr: p.descr,
  img: p.img_key ? `/file/${p.img_key}` : "",
});

const publicService = (s) => ({ id: s.id, cat: s.cat, name: s.name, price: s.price_cents, dur: s.dur, care: s.care, descr: s.descr });

export async function loadCatalog(env) {
  const [services, products, settings] = await Promise.all([
    env.DB.prepare("SELECT * FROM services WHERE active = 1 ORDER BY sort, name").all(),
    env.DB.prepare("SELECT * FROM products WHERE active = 1 ORDER BY cat, name").all(),
    getSettings(env.DB),
  ]);
  return {
    services: (services.results || []).map(publicService),
    products: (products.results || []).map(publicProduct),
    settings: {
      name: settings.name, tagline: settings.tagline, currency: settings.currency, depositPct: settings.depositPct,
      deliveryFee: settings.deliveryFee, freeOver: settings.freeOver, chairs: settings.chairs,
      open: settings.open, close: settings.close, phone: settings.phone, phone2: settings.phone2,
      whatsapp: settings.whatsapp, address: settings.address, hours: settings.hours,
      supportEmail: settings.supportEmail, bookingsEmail: settings.bookingsEmail, salesEmail: settings.salesEmail,
      googleClientId: settings.googleClientId, timezone: settings.timezone,
    },
  };
}

// How many chairs are already taken, for the days the booking sheet shows.
async function takenMap(env, fromDate) {
  const rows = await env.DB
    .prepare("SELECT date, time, COUNT(*) AS n FROM bookings WHERE date >= ?1 AND status <> 'cancelled' GROUP BY date, time")
    .bind(fromDate).all();
  const taken = {};
  for (const r of rows.results || []) taken[`${r.date} ${r.time}`] = r.n;
  return taken;
}

export async function publicRoutes(parts, request, env, ctx) {
  const [head, second] = parts;
  const method = request.method;

  if (head === "health") {
    await ensureSeeded(env.DB);
    return json({ ok: true, host: new URL(request.url).host });
  }

  if (head === "catalog" && method === "GET") {
    await ensureSeeded(env.DB);
    const settings = await getSettings(env.DB);
    const today = todayIn(settings.timezone);
    const [catalog, taken, offers] = await Promise.all([
      loadCatalog(env),
      takenMap(env, today),
      env.DB.prepare(`SELECT id, title, detail, discount_pct, code FROM offers
                      WHERE active = 1 AND (starts_on IS NULL OR starts_on <= ?1) AND (ends_on IS NULL OR ends_on >= ?1)
                      ORDER BY created_at DESC LIMIT 6`).bind(today).all(),
    ]);
    return json({ ...catalog, taken, today, offers: offers.results || [] });
  }

  if (head === "visit" && method === "POST") return recordVisit(request, env);
  if (head === "bookings" && method === "POST") return createBooking(request, env, ctx);
  if (head === "orders" && method === "POST") return createOrder(request, env, ctx);

  if (head === "contact" && method === "POST") {
    const body = await readJson(request);
    if (body.website) return json({ ok: true });
    const name = str(body.name, 80), phone = phoneDigits(body.phone), message = str(body.message, 1000);
    if (!name || !validPhone(phone) || !message) return fail(400, "Add your name, phone number and a message.");
    await env.DB.prepare(`INSERT INTO tasks (id, department, title, detail, priority, created_by)
                          VALUES (?1, 'admin', ?2, ?3, 'normal', 'website')`)
      .bind(newId("task"), `Website message from ${name}`, `${message}\n\nPhone: ${phone}${body.email ? `\nEmail: ${cleanEmail(body.email)}` : ""}`).run();
    return json({ ok: true });
  }

  return null;
}

/* ---------------------------------------------------------------- visits */
async function recordVisit(request, env) {
  const body = await readJson(request, 10000);
  const vid = str(body.vid, 40);
  if (!/^[a-z0-9]{16,40}$/.test(vid)) return json({ ok: false }, 400);
  const ua = request.headers.get("user-agent") || "";
  if (!ua || /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python/i.test(ua)) return json({ ok: true, skipped: true });

  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  const device = pick(body.device, ["Phone", "Tablet", "Computer"], "Computer");
  const os = pick(body.os, ["Android", "iPhone", "iPad", "Windows", "Mac", "Linux", "ChromeOS", "Other"], "Other");
  const source = str(body.source, 60) || "Direct";
  const customer = await currentCustomer(request, env);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO visitors (vid, first_seen, last_seen, visits, device, os, source, last_path, customer_id)
                    VALUES (?1, datetime('now'), datetime('now'), 1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(vid) DO UPDATE SET last_seen = datetime('now'), visits = visits + 1,
                      device = ?2, os = ?3, last_path = ?5, customer_id = COALESCE(?6, customer_id)`)
      .bind(vid, device, os, source, str(body.path, 80), customer?.id || null),
    env.DB.prepare("INSERT OR IGNORE INTO daily_visits (date, vid) VALUES (?1, ?2)").bind(today, vid),
  ]);
  return json({ ok: true });
}

/* ---------------------------------------------------------------- booking */
async function createBooking(request, env, ctx) {
  const body = await readJson(request);
  if (body.website) return json({ booking: { id: "TLA-B00000" } }, 201); // bot trap

  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const name = str(body.name, 80);
  const phone = phoneDigits(body.phone);
  const notes = str(body.notes, 500);
  const date = str(body.date, 10);
  const time = str(body.time, 5);
  const hour = Number(time.slice(0, 2));

  if (!name) return fail(400, "Add your name to request this booking.");
  if (!validPhone(phone)) return fail(400, "Add a phone number we can call to confirm.");
  const service = await env.DB.prepare("SELECT * FROM services WHERE id = ?1 AND active = 1").bind(str(body.serviceId, 40)).first();
  if (!service) return fail(400, "That service isn’t on the menu any more. Refresh the page and pick again.");
  if (!isDate(date) || date < today || date > addDays(today, 90)) return fail(400, "Pick a day within the next 3 months.");
  if (!/^\d{2}:00$/.test(time) || hour < settings.open || hour >= settings.close) return fail(400, "Pick one of the times shown.");

  const taken = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE date = ?1 AND time = ?2 AND status <> 'cancelled'")
    .bind(date, time).first();
  if ((taken?.n || 0) >= settings.chairs) return fail(409, "That time was just taken. Pick another time.");

  const customer = await currentCustomer(request, env);
  const id = bookingId();
  const deposit = Math.round((service.price_cents * settings.depositPct) / 100);
  await env.DB
    .prepare(`INSERT INTO bookings (id, customer_id, name, phone, email, service_id, service, price_cents, deposit_cents, date, time, status, notes)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12)`)
    .bind(id, customer?.id || null, name, phone, cleanEmail(body.email) || customer?.email || "", service.id, service.name,
      service.price_cents, deposit, date, time, notes)
    .run();

  const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?1").bind(id).first();
  await audit(env.DB, { actor: { type: customer ? "customer" : "public", id: customer?.id || "", name }, action: "booking.created", target: id, detail: `${service.name} on ${date} ${time}` });
  ctx?.waitUntil?.(notifyBooking(env, booking, settings, new URL(request.url).origin));
  return json({ booking: shapeBooking(booking) }, 201);
}

const shapeBooking = (b) => ({
  id: b.id, name: b.name, phone: b.phone, service: b.service, serviceId: b.service_id,
  price: b.price_cents, deposit: b.deposit_cents, date: b.date, time: b.time, status: b.status, notes: b.notes,
});

/* ---------------------------------------------------------------- shop order */
async function createOrder(request, env, ctx) {
  const body = await readJson(request);
  const settings = await getSettings(env.DB);
  if (body.website) {
    const catalog = await loadCatalog(env);
    return json({ order: { id: "TLA-O00000" }, products: catalog.products }, 201);
  }

  const name = str(body.name, 80);
  const phone = phoneDigits(body.phone);
  const address = str(body.address, 200);
  const fulfilment = body.fulfilment === "delivery" ? "delivery" : "pickup";
  if (!name) return fail(400, "Add your name to place your order.");
  if (!validPhone(phone)) return fail(400, "Add a phone number we can reach you on.");
  if (fulfilment === "delivery" && !address) return fail(400, "Add a delivery address, or choose pick up at the salon.");

  const wanted = new Map();
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 30) : []) {
    const qty = int(item?.qty, 0, 50);
    if (qty) wanted.set(str(item.id, 40), (wanted.get(str(item.id, 40)) || 0) + qty);
  }
  if (!wanted.size) return fail(400, "Your bag is empty.");

  const lines = [];
  let subtotal = 0, cost = 0;
  for (const [pid, qty] of wanted) {
    const p = await env.DB.prepare("SELECT * FROM products WHERE id = ?1 AND active = 1").bind(pid).first();
    if (!p) return fail(409, "Something in your bag is no longer sold. Remove it and try again.");
    if (p.stock < qty) {
      return fail(409, p.stock ? `${p.name}: only ${p.stock} left. Lower the quantity and try again.` : `${p.name} just sold out. Remove it and try again.`);
    }
    lines.push({ product: p, qty });
    subtotal += p.price_cents * qty;   // price always comes from the database, never the browser
    cost += p.cost_cents * qty;
  }

  const delivery = fulfilment === "delivery" && subtotal < settings.freeOver ? int(settings.deliveryFee) : 0;
  const total = subtotal + delivery;
  const customer = await currentCustomer(request, env);
  const id = orderId();
  const date = todayIn(settings.timezone);

  await env.DB
    .prepare(`INSERT INTO orders (id, customer_id, name, phone, email, subtotal_cents, delivery_cents, total_cents, cost_cents, fulfilment, address, status, date)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'new', ?12)`)
    .bind(id, customer?.id || null, name, phone, cleanEmail(body.email) || customer?.email || "",
      subtotal, delivery, total, cost, fulfilment, fulfilment === "delivery" ? address : "", date)
    .run();

  for (const { product, qty } of lines) {
    await env.DB.prepare("INSERT INTO order_items (order_id, product_id, name, qty, price_cents, cost_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, product.id, product.name, qty, product.price_cents, product.cost_cents).run();
    await moveStock(env.DB, { productId: product.id, kind: "sale", qty, ref: id, note: `Order ${id}`, createdBy: "shop" });
  }

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
  await audit(env.DB, { actor: { type: customer ? "customer" : "public", id: customer?.id || "", name }, action: "order.created", target: id, detail: `${lines.length} items, ${total / 100}` });
  ctx?.waitUntil?.(notifyOrder(env, { ...order, items: lines.map((l) => ({ name: l.product.name, qty: l.qty })) }, settings, new URL(request.url).origin));

  const catalog = await loadCatalog(env);
  return json({
    order: {
      id, name, phone, total: order.total_cents, subtotal: order.subtotal_cents, delivery: order.delivery_cents,
      fulfilment, address: order.address, date,
      items: lines.map((l) => ({ name: l.product.name, qty: l.qty, price: l.product.price_cents })),
    },
    products: catalog.products,
  }, 201);
}
