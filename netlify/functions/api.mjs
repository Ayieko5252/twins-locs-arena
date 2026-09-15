// Twins Locs Arena API
//   Public:  GET /api/catalog, GET /api/img/:id, POST /api/bookings, POST /api/orders
//   Staff:   /api/admin/* (needs the sign-in cookie)
// Data lives in Netlify Blobs. Production uses the "tla" store; previews use "tla-preview".

import { getStore } from "@netlify/blobs";
import { DEFAULT_PRODUCTS, DEFAULT_SERVICES, DEFAULT_SETTINGS } from "../lib/defaults.mjs";
import { isAdmin } from "../lib/session.mjs";
import { channels, notifyBooking, notifyOrder, notifyTest } from "../lib/notify.mjs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);

const B_STATUS = ["pending", "confirmed", "done", "cancelled"];
const O_STATUS = ["new", "packed", "dispatched", "completed", "cancelled"];
const P_CATS = ["Cleanse", "Moisturise", "Hold", "Accessories"];
const S_CATS = ["Start", "Maintain", "Repair", "Style"];
const KINDS = ["bottle", "jar", "beads", "bonnet", "hook", "box"];

/* ---------- helpers ---------- */
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x % 10).join("");

function localToday(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function readJSON(req) {
  if (Number(req.headers.get("content-length") || 0) > 4_000_000) throw Object.assign(new Error("That upload is too large. Use a photo under 2 MB."), { status: 413 });
  try {
    return await req.json();
  } catch {
    throw Object.assign(new Error("The request couldn't be read. Refresh the page and try again."), { status: 400 });
  }
}

const storeFor = (context) => getStore({ name: (context?.deploy?.context ?? "production") === "production" ? "tla" : "tla-preview", consistency: "strong" });

async function getCatalog(store) {
  let [services, products, settings] = await Promise.all([
    store.get("catalog/services", { type: "json" }),
    store.get("catalog/products", { type: "json" }),
    store.get("catalog/settings", { type: "json" }),
  ]);
  const writes = [];
  if (!services) writes.push(store.setJSON("catalog/services", (services = DEFAULT_SERVICES)));
  if (!products) writes.push(store.setJSON("catalog/products", (products = DEFAULT_PRODUCTS)));
  if (!settings) writes.push(store.setJSON("catalog/settings", (settings = DEFAULT_SETTINGS)));
  await Promise.all(writes);
  return { services, products, settings: { ...DEFAULT_SETTINGS, ...settings } };
}

async function getAll(store, prefix, keep = () => true) {
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map((b) => b.key).filter(keep);
  const out = [];
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" })));
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

function later(context, promise) {
  const p = promise.catch((e) => console.error(e));
  if (typeof context?.waitUntil === "function") context.waitUntil(p);
  else return p;
}

/* ---------- public ---------- */
async function catalog(store) {
  const c = await getCatalog(store);
  const today = localToday(c.settings.timezone);
  const upcoming = await getAll(store, "bookings/", (k) => k.split("/")[1] >= today);
  const taken = {};
  for (const b of upcoming) if (b.status !== "cancelled") taken[`${b.date} ${b.time}`] = (taken[`${b.date} ${b.time}`] || 0) + 1;
  return json({ ...c, taken, today });
}

async function serveImage(store, id) {
  const hit = await store.getWithMetadata(`img/${id.replace(/[^\w-]/g, "")}`, { type: "arrayBuffer" });
  if (!hit) return new Response("Not found", { status: 404 });
  return new Response(hit.data, { headers: { "Content-Type": hit.metadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
}

async function createBooking(req, store, context) {
  const body = await readJSON(req);
  const { services, settings } = await getCatalog(store);
  if (body.website) return json({ booking: { id: "TLA-B00000" } }, 201); // bot trap

  const name = str(body.name, 80), phone = str(body.phone, 30), notes = str(body.notes, 500);
  const s = services.find((x) => x.id === body.serviceId);
  const date = str(body.date, 10), time = str(body.time, 5);
  const today = localToday(settings.timezone);
  const hour = Number(time.slice(0, 2));

  if (!name) return fail(400, "Add your name to request this booking.");
  if (phone.replace(/\D/g, "").length < 7) return fail(400, "Add a phone number we can call to confirm.");
  if (!s) return fail(400, "That service isn't on the menu any more. Refresh the page and pick again.");
  if (!isDate(date) || date < today || date > addDays(today, 90)) return fail(400, "Pick a day within the next 3 months.");
  if (!/^\d{2}:00$/.test(time) || hour < settings.open || hour >= settings.close) return fail(400, "Pick one of the times shown.");

  const sameDay = await getAll(store, `bookings/${date}/`);
  if (sameDay.filter((b) => b.time === time && b.status !== "cancelled").length >= settings.chairs) {
    return fail(409, "That time was just taken. Pick another time.");
  }

  const id = `TLA-B${rand(5)}`;
  const booking = {
    id, key: `bookings/${date}/${id}`, name, phone, notes, serviceId: s.id, service: s.name, price: s.price, dur: s.dur,
    date, time, status: "pending", createdAt: new Date().toISOString(), notified: { whatsapp: "sending", email: "sending" },
  };
  await store.setJSON(booking.key, booking);

  const origin = new URL(req.url).origin;
  await later(context, (async () => {
    const notified = await notifyBooking(booking, settings, origin);
    const current = await store.get(booking.key, { type: "json" });
    if (current) await store.setJSON(booking.key, { ...current, notified });
  })());

  return json({ booking }, 201);
}

async function createOrder(req, store, context) {
  const body = await readJSON(req);
  const { products, settings } = await getCatalog(store);
  if (body.website) return json({ order: { id: "TLA-O00000" }, products }, 201);

  const name = str(body.name, 80), phone = str(body.phone, 30), address = str(body.address, 200);
  const fulfilment = body.fulfilment === "delivery" ? "delivery" : "pickup";
  if (!name) return fail(400, "Add your name to place your order.");
  if (phone.replace(/\D/g, "").length < 7) return fail(400, "Add a phone number we can reach you on.");
  if (fulfilment === "delivery" && !address) return fail(400, "Add a delivery address, or choose pick up at the salon.");

  const wanted = new Map();
  for (const it of Array.isArray(body.items) ? body.items.slice(0, 30) : []) {
    const qty = int(it?.qty, 0, 50);
    if (qty) wanted.set(String(it.id), (wanted.get(String(it.id)) || 0) + qty);
  }
  if (!wanted.size) return fail(400, "Your bag is empty.");

  const lines = [];
  for (const [pid, qty] of wanted) {
    const p = products.find((x) => x.id === pid);
    if (!p) return fail(409, "Something in your bag is no longer sold. Remove it and try again.");
    if (p.stock < qty) return fail(409, p.stock ? `${p.name}: only ${p.stock} left. Lower the quantity and try again.` : `${p.name} just sold out. Remove it and try again.`);
    lines.push({ productId: p.id, name: p.name, qty, price: p.price });
  }
  const subtotal = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const delivery = fulfilment === "delivery" && subtotal < settings.freeOver ? Number(settings.deliveryFee) : 0;

  for (const l of lines) products.find((x) => x.id === l.productId).stock -= l.qty;
  await store.setJSON("catalog/products", products);

  const date = localToday(settings.timezone);
  const id = `TLA-O${rand(5)}`;
  const order = {
    id, key: `orders/${date}/${id}`, name, phone, items: lines, subtotal, delivery, total: subtotal + delivery, fulfilment,
    address: fulfilment === "delivery" ? address : "", date, status: "new", createdAt: new Date().toISOString(),
    notified: { whatsapp: "sending", email: "sending" },
  };
  await store.setJSON(order.key, order);

  const origin = new URL(req.url).origin;
  await later(context, (async () => {
    const notified = await notifyOrder(order, settings, origin);
    const current = await store.get(order.key, { type: "json" });
    if (current) await store.setJSON(order.key, { ...current, notified });
  })());

  return json({ order, products }, 201);
}

/* ---------- staff ---------- */
function cleanProduct(p, existing) {
  return {
    id: existing?.id || `p${Date.now()}`,
    cat: P_CATS.includes(p.cat) ? p.cat : existing?.cat || "Accessories",
    kind: KINDS.includes(p.kind) ? p.kind : existing?.kind || "jar",
    name: str(p.name, 80),
    size: str(p.size, 40),
    price: int(p.price, 0, 10_000_000),
    stock: int(p.stock, 0, 100_000),
    desc: str(p.desc, 240),
    img: existing?.img || "",
  };
}

function cleanService(s, existing) {
  return {
    id: existing?.id || `s${Date.now()}`,
    cat: S_CATS.includes(s.cat) ? s.cat : existing?.cat || "Style",
    name: str(s.name, 80),
    price: int(s.price, 0, 10_000_000),
    dur: str(s.dur, 30),
    care: str(s.care, 60),
    desc: str(s.desc, 300),
  };
}

function cleanSettings(d, prev) {
  let timezone = str(d.timezone, 60) || prev.timezone;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = prev.timezone; }
  const open = int(d.open, 0, 23), close = int(d.close, 1, 24);
  return {
    ...prev,
    name: str(d.name, 80) || prev.name,
    tagline: str(d.tagline, 120),
    phone: str(d.phone, 40),
    whatsapp: str(d.whatsapp, 20).replace(/[^\d]/g, ""),
    address: str(d.address, 160),
    hours: str(d.hours, 120),
    currency: str(d.currency, 5) || prev.currency,
    open, close: close > open ? close : prev.close,
    chairs: int(d.chairs, 1, 20),
    depositPct: int(d.depositPct, 0, 100),
    deliveryFee: int(d.deliveryFee, 0, 1_000_000),
    freeOver: int(d.freeOver, 0, 100_000_000),
    timezone,
  };
}

async function saveImage(store, id, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw Object.assign(new Error("That photo couldn't be saved. Use a JPG or PNG."), { status: 400 });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 2_000_000) throw Object.assign(new Error("That photo is too large. Use one under 2 MB."), { status: 413 });
  await store.set(`img/${id}`, bytes, { metadata: { contentType: m[1] } });
  return `/api/img/${id}?v=${Date.now()}`;
}

async function admin(parts, method, req, store) {
  const [area] = parts;
  const origin = new URL(req.url).origin;

  if (area === "data" && method === "GET") {
    const c = await getCatalog(store);
    const since = addDays(localToday(c.settings.timezone), -180);
    const [bookings, orders] = await Promise.all([
      getAll(store, "bookings/", (k) => k.split("/")[1] >= since),
      getAll(store, "orders/", (k) => k.split("/")[1] >= since),
    ]);
    return json({ ...c, bookings, orders, channels: channels(), today: localToday(c.settings.timezone) });
  }

  if (area === "bookings" || area === "orders") {
    const body = await readJSON(req);
    const key = str(body.key, 120);
    if (!key.startsWith(`${area}/`)) return fail(400, "Unknown record.");
    const rec = await store.get(key, { type: "json" });
    if (!rec) return fail(404, "That record was already removed. Refresh to see the latest.");

    if (method === "DELETE") {
      await store.delete(key);
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const allowed = area === "bookings" ? B_STATUS : O_STATUS;
      if (!allowed.includes(body.status)) return fail(400, "Unknown status.");
      let products;
      if (area === "orders" && (rec.status === "cancelled") !== (body.status === "cancelled")) {
        // Cancelling returns items to stock; un-cancelling takes them out again.
        ({ products } = await getCatalog(store));
        const sign = body.status === "cancelled" ? 1 : -1;
        for (const l of rec.items) {
          const p = products.find((x) => x.id === l.productId);
          if (p) p.stock = Math.max(0, p.stock + sign * l.qty);
        }
        await store.setJSON("catalog/products", products);
      }
      const updated = { ...rec, status: body.status, updatedAt: new Date().toISOString() };
      await store.setJSON(key, updated);
      return json({ record: updated, products });
    }
  }

  if (area === "products" || area === "services") {
    const body = await readJSON(req);
    const c = await getCatalog(store);
    const list = c[area];
    if (method === "DELETE") {
      const next = list.filter((x) => x.id !== body.id);
      await store.setJSON(`catalog/${area}`, next);
      if (area === "products") await store.delete(`img/${String(body.id).replace(/[^\w-]/g, "")}`);
      return json({ [area]: next });
    }
    if (method === "PUT") {
      const incoming = body.item || {};
      const existing = incoming.id ? list.find((x) => x.id === incoming.id) : null;
      const item = area === "products" ? cleanProduct(incoming, existing) : cleanService(incoming, existing);
      if (!item.name) return fail(400, "Add a name to save.");
      if (area === "products") {
        if (body.imgData) item.img = await saveImage(store, item.id, body.imgData);
        else if (body.removeImg) { item.img = ""; await store.delete(`img/${item.id}`); }
      }
      const next = existing ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
      await store.setJSON(`catalog/${area}`, next);
      return json({ [area]: next, item });
    }
  }

  if (area === "settings" && method === "PUT") {
    const body = await readJSON(req);
    const c = await getCatalog(store);
    const settings = cleanSettings(body.settings || {}, c.settings);
    await store.setJSON("catalog/settings", settings);
    return json({ settings });
  }

  if (area === "test-alert" && method === "POST") {
    const c = await getCatalog(store);
    const ch = channels();
    if (!ch.whatsapp && !ch.email) return fail(400, "No alerts are set up yet. Add the WhatsApp or email settings in Netlify, redeploy, then try again.");
    return json({ results: await notifyTest(c.settings, origin) });
  }

  return fail(404, "Not found");
}

/* ---------- router ---------- */
export default async (req, context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const store = storeFor(context);

  try {
    if (parts[0] === "health") return json({ ok: true, context: context?.deploy?.context ?? null, store: (context?.deploy?.context ?? "production") === "production" ? "tla" : "tla-preview" });
    if (parts[0] === "catalog" && method === "GET") return await catalog(store);
    if (parts[0] === "img" && parts[1] && method === "GET") return await serveImage(store, parts[1]);
    if (parts[0] === "bookings" && method === "POST") return await createBooking(req, store, context);
    if (parts[0] === "orders" && method === "POST") return await createOrder(req, store, context);
    if (parts[0] === "admin") {
      if (!(await isAdmin(req))) return fail(401, "Your staff session ended. Sign in again.");
      return await admin(parts.slice(1), method, req, store);
    }
    return fail(404, "Not found");
  } catch (e) {
    if (e.status) return fail(e.status, e.message);
    console.error(e);
    return fail(500, "Something went wrong on our side. Try again in a moment.");
  }
};

export const config = { path: "/api/*" };
