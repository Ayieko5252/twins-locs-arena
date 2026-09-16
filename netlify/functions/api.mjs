// Twins Locs Arena API
//   Public:    GET /api/catalog, GET /api/img/:id, POST /api/bookings, POST /api/orders, POST /api/visit
//   Customer:  POST /api/auth/google, POST /api/auth/logout, GET|PUT /api/me
//   Staff:     /api/admin/* (needs the admin sign-in cookie)

import { DEFAULT_PRODUCTS, DEFAULT_SERVICES, DEFAULT_SETTINGS } from "../lib/defaults.mjs";
import { isAdmin, userFromRequest, makeUserCookie, clearUserCookie } from "../lib/session.mjs";
import { channels, notifyBooking, notifyOrder, notifyTest } from "../lib/notify.mjs";
import { verifyGoogleIdToken } from "../lib/google.mjs";
import { storeFor, storeName, getCatalog, getSettings, getAll, snapshot, localToday, addDays } from "../lib/store.mjs";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const fail = (status, error) => json({ error }, status);
const httpError = (status, message) => Object.assign(new Error(message), { status });

const B_STATUS = ["pending", "confirmed", "done", "cancelled"];
const O_STATUS = ["new", "packed", "dispatched", "completed", "cancelled"];
const P_CATS = ["Cleanse", "Moisturise", "Hold", "Accessories"];
const S_CATS = ["Start", "Maintain", "Repair", "Style"];
const KINDS = ["bottle", "jar", "beads", "bonnet", "hook", "box"];
// Sample records from the first prototype; never imported as real data.
const SAMPLE_IDS = new Set(["TLA-B1031", "TLA-B1034", "TLA-B1035", "TLA-B1037", "TLA-B1039", "TLA-B1042", "TLA-B1043", "TLA-B1044", "TLA-B1045", "TLA-B1046", "TLA-O2201", "TLA-O2204", "TLA-O2207", "TLA-O2209", "TLA-O2210"]);

/* ---------- helpers ---------- */
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x % 10).join("");

async function readJSON(req) {
  if (Number(req.headers.get("content-length") || 0) > 6_000_000) throw httpError(413, "That upload is too large. Use a photo under 2 MB.");
  try {
    return await req.json();
  } catch {
    throw httpError(400, "The request couldn't be read. Refresh the page and try again.");
  }
}

function later(context, promise) {
  const p = promise.catch((e) => console.error(e));
  if (typeof context?.waitUntil === "function") context.waitUntil(p);
  else return p;
}

const publicMe = (c) => c && { name: c.name, email: c.email, picture: c.picture, phone: c.phone || "" };

async function attachToCustomer(store, sub, field, key, phone) {
  if (!sub) return;
  const ck = `customers/${sub}`;
  const c = await store.get(ck, { type: "json" });
  if (!c) return;
  c[field] = [...new Set([...(c[field] || []), key])].slice(-200);
  if (phone && !c.phone) c.phone = phone;
  c.lastSeen = new Date().toISOString();
  await store.setJSON(ck, c);
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

  const sub = await userFromRequest(req);
  const id = `TLA-B${rand(5)}`;
  const booking = {
    id, key: `bookings/${date}/${id}`, name, phone, notes, serviceId: s.id, service: s.name, price: s.price, dur: s.dur,
    date, time, status: "pending", createdAt: new Date().toISOString(), notified: { whatsapp: "sending", email: "sending" },
    ...(sub ? { customerId: sub } : {}),
  };
  await store.setJSON(booking.key, booking);
  await attachToCustomer(store, sub, "bookingKeys", booking.key, phone);

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

  const sub = await userFromRequest(req);
  const date = localToday(settings.timezone);
  const id = `TLA-O${rand(5)}`;
  const order = {
    id, key: `orders/${date}/${id}`, name, phone, items: lines, subtotal, delivery, total: subtotal + delivery, fulfilment,
    address: fulfilment === "delivery" ? address : "", date, status: "new", createdAt: new Date().toISOString(),
    notified: { whatsapp: "sending", email: "sending" },
    ...(sub ? { customerId: sub } : {}),
  };
  await store.setJSON(order.key, order);
  await attachToCustomer(store, sub, "orderKeys", order.key, phone);

  const origin = new URL(req.url).origin;
  await later(context, (async () => {
    const notified = await notifyOrder(order, settings, origin);
    const current = await store.get(order.key, { type: "json" });
    if (current) await store.setJSON(order.key, { ...current, notified });
  })());

  return json({ order, products }, 201);
}

/* Counts one visit per browser session. No IP address or full browser string is stored. */
async function recordVisit(req, store) {
  const body = await readJSON(req);
  const vid = str(body.vid, 40);
  if (!/^[a-z0-9]{16,40}$/.test(vid)) return json({ ok: false }, 400);
  const ua = req.headers.get("user-agent") || "";
  if (!ua || /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python/i.test(ua)) return json({ ok: true, skipped: true });

  const settings = await getSettings(store);
  const now = new Date().toISOString();
  const date = localToday(settings.timezone);
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  const key = `visitors/${vid}`;
  const cur = await store.get(key, { type: "json" });
  const sub = await userFromRequest(req);

  const v = {
    vid,
    firstSeen: cur?.firstSeen || now,
    lastSeen: now,
    visits: (cur?.visits || 0) + 1,
    device: pick(body.device, ["Phone", "Tablet", "Computer"], cur?.device || "Computer"),
    os: pick(body.os, ["Android", "iPhone", "iPad", "Windows", "Mac", "Linux", "ChromeOS", "Other"], cur?.os || "Other"),
    source: cur?.source || str(body.source, 60) || "Direct",
    lastPath: str(body.path, 80),
    ...(sub || cur?.customerId ? { customerId: sub || cur.customerId } : {}),
  };
  await Promise.all([store.setJSON(key, v), store.setJSON(`daily/${date}/${vid}`, { at: now })]);

  if (sub) {
    const c = await store.get(`customers/${sub}`, { type: "json" });
    if (c) await store.setJSON(`customers/${sub}`, { ...c, lastSeen: now, visits: (c.visits || 0) + 1, vids: [...new Set([...(c.vids || []), vid])].slice(-10) });
  }
  return json({ ok: true });
}

/* ---------- customers (Sign in with Google) ---------- */
async function customerRoute(parts, method, req, store) {
  if (parts[0] === "auth" && parts[1] === "google" && method === "POST") {
    const body = await readJSON(req);
    const settings = await getSettings(store);
    if (!settings.googleClientId) return fail(400, "Google sign-in isn't set up yet.");
    const g = await verifyGoogleIdToken(body.credential, settings.googleClientId);
    const vid = /^[a-z0-9]{16,40}$/.test(body.vid || "") ? body.vid : "";
    const key = `customers/${g.sub}`;
    const now = new Date().toISOString();
    const cur = await store.get(key, { type: "json" });
    const customer = {
      sub: g.sub, firstSeen: cur?.firstSeen || now, lastSeen: now, visits: cur?.visits || 0,
      signIns: (cur?.signIns || 0) + 1, bookingKeys: cur?.bookingKeys || [], orderKeys: cur?.orderKeys || [], phone: cur?.phone || "",
      email: str(g.email, 120), name: str(g.name || g.email, 80),
      picture: /^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(g.picture || "") ? g.picture : "",
      vids: [...new Set([...(cur?.vids || []), ...(vid ? [vid] : [])])].slice(-10),
    };
    await store.setJSON(key, customer);
    if (vid) {
      const v = await store.get(`visitors/${vid}`, { type: "json" });
      if (v) await store.setJSON(`visitors/${vid}`, { ...v, customerId: g.sub });
    }
    return json({ me: publicMe(customer) }, 200, { "Set-Cookie": await makeUserCookie(g.sub) });
  }

  if (parts[0] === "auth" && parts[1] === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearUserCookie() });
  }

  if (parts[0] === "me") {
    const sub = await userFromRequest(req);
    const c = sub ? await store.get(`customers/${sub}`, { type: "json" }) : null;
    if (!c) return json({ me: null }, 200, sub ? { "Set-Cookie": clearUserCookie() } : {});
    if (method === "PUT") {
      const body = await readJSON(req);
      const phone = str(body.phone, 30);
      if (phone && phone.replace(/\D/g, "").length < 7) return fail(400, "That phone number looks too short.");
      c.phone = phone;
      await store.setJSON(`customers/${sub}`, c);
      return json({ me: publicMe(c) });
    }
    const [bookings, orders] = await Promise.all([
      Promise.all((c.bookingKeys || []).map((k) => store.get(k, { type: "json" }))),
      Promise.all((c.orderKeys || []).map((k) => store.get(k, { type: "json" }))),
    ]);
    const strip = (r) => r && { id: r.id, date: r.date, time: r.time, service: r.service, price: r.price, status: r.status, items: r.items, total: r.total, fulfilment: r.fulfilment, createdAt: r.createdAt };
    return json({ me: publicMe(c), bookings: bookings.filter(Boolean).map(strip), orders: orders.filter(Boolean).map(strip) });
  }
  return null;
}

/* ---------- staff ---------- */
function cleanProduct(p, existing) {
  return {
    id: existing?.id || str(p.id, 40).replace(/[^\w-]/g, "") || `p${Date.now()}`,
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
    id: existing?.id || str(s.id, 40).replace(/[^\w-]/g, "") || `s${Date.now()}`,
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
  const open = int(d.open ?? prev.open, 0, 23), close = int(d.close ?? prev.close, 1, 24);
  const gid = str(d.googleClientId, 200);
  return {
    ...prev,
    name: str(d.name ?? prev.name, 80) || prev.name,
    tagline: str(d.tagline ?? prev.tagline, 120),
    phone: str(d.phone ?? prev.phone, 40),
    whatsapp: str(d.whatsapp ?? prev.whatsapp, 20).replace(/[^\d]/g, ""),
    address: str(d.address ?? prev.address, 160),
    hours: str(d.hours ?? prev.hours, 120),
    currency: str(d.currency ?? prev.currency, 5) || prev.currency,
    open, close: close > open ? close : prev.close,
    chairs: int(d.chairs ?? prev.chairs, 1, 20),
    depositPct: int(d.depositPct ?? prev.depositPct, 0, 100),
    deliveryFee: int(d.deliveryFee ?? prev.deliveryFee, 0, 1_000_000),
    freeOver: int(d.freeOver ?? prev.freeOver, 0, 100_000_000),
    googleClientId: /^[\w.-]+\.apps\.googleusercontent\.com$/.test(gid) ? gid : gid === "" ? "" : prev.googleClientId,
    timezone,
  };
}

async function saveImage(store, id, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw httpError(400, "That photo couldn't be saved. Use a JPG or PNG.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 2_000_000) throw httpError(413, "That photo is too large. Use one under 2 MB.");
  await store.set(`img/${id}`, bytes, { metadata: { contentType: m[1] } });
  return `/api/img/${id}?v=${Date.now()}`;
}

async function visitorsReport(store) {
  const settings = await getSettings(store);
  const today = localToday(settings.timezone);
  const since14 = addDays(today, -13), since7 = addDays(today, -6), since30 = addDays(today, -29);
  const [{ blobs: dailyKeys }, customers, visitorsAll] = await Promise.all([
    store.list({ prefix: "daily/" }),
    getAll(store, "customers/"),
    getAll(store, "visitors/", () => true, 2000),
  ]);
  const perDay = {}, week = new Set(), month = new Set();
  for (const { key } of dailyKeys) {
    const [, d, vid] = key.split("/");
    if (d >= since14) perDay[d] = (perDay[d] || 0) + 1;
    if (d >= since7) week.add(vid);
    if (d >= since30) month.add(vid);
  }
  const days = Array.from({ length: 14 }, (_, i) => { const d = addDays(since14, i); return { date: d, visitors: perDay[d] || 0 }; });
  const names = Object.fromEntries(customers.map((c) => [c.sub, c.name]));
  const visitors = visitorsAll
    .filter((v) => v.lastSeen && v.lastSeen.slice(0, 10) >= since30)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 300)
    .map((v) => ({ ...v, customerName: v.customerId ? names[v.customerId] || "" : "" }));
  return json({
    today,
    totals: { today: perDay[today] || 0, week: week.size, month: month.size, returning: visitors.filter((v) => v.visits > 1).length, customers: customers.length },
    days,
    visitors,
    customers: customers
      .map(({ vids, ...c }) => ({ ...c, bookings: (c.bookingKeys || []).length, orders: (c.orderKeys || []).length, bookingKeys: undefined, orderKeys: undefined }))
      .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || "")),
  });
}

/* Brings over changes saved in a browser by the first (pre-database) version of the admin.
   Rule: never overwrite something already changed online; add what's missing. */
async function importLocal(req, store) {
  const body = await readJSON(req);
  const c = await getCatalog(store);
  const result = { products: { added: 0, updated: 0 }, services: { added: 0, updated: 0 }, settings: 0, bookings: 0, orders: 0 };
  const sameAs = (a, b, clean) => JSON.stringify({ ...clean(a, null), img: "" , id: "" }) === JSON.stringify({ ...clean(b, null), img: "", id: "" });

  for (const [area, defaults, clean] of [["products", DEFAULT_PRODUCTS, cleanProduct], ["services", DEFAULT_SERVICES, cleanService]]) {
    const list = [...c[area]];
    for (const raw of Array.isArray(body[area]) ? body[area].slice(0, 300) : []) {
      if (!raw || !str(raw.name, 80)) continue;
      const def = defaults.find((x) => x.id === raw.id);
      const idx = list.findIndex((x) => x.id === raw.id);
      const hasPhoto = typeof raw.img === "string" && raw.img.startsWith("data:image/");
      if (idx === -1) {
        const item = clean(raw, null);
        item.id = raw.id && !list.some((x) => x.id === raw.id) ? item.id : `${area[0]}${Date.now()}${rand(3)}`;
        if (area === "products" && hasPhoto) item.img = await saveImage(store, item.id, raw.img).catch(() => "");
        list.push(item);
        result[area].added++;
      } else {
        const online = list[idx];
        const onlineUntouched = def && sameAs(online, def, clean) && !online.img;
        const localChanged = !def || !sameAs(raw, def, clean) || hasPhoto;
        if (onlineUntouched && localChanged) {
          const item = { ...clean(raw, online), id: online.id };
          if (area === "products" && hasPhoto) item.img = await saveImage(store, item.id, raw.img).catch(() => online.img);
          list[idx] = item;
          result[area].updated++;
        }
      }
    }
    if (result[area].added || result[area].updated) await store.setJSON(`catalog/${area}`, list);
  }

  if (body.settings && typeof body.settings === "object") {
    const patch = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k === "googleClientId") continue;
      if (body.settings[k] === undefined) continue;
      if (c.settings[k] === DEFAULT_SETTINGS[k] && body.settings[k] !== DEFAULT_SETTINGS[k]) patch[k] = body.settings[k];
    }
    if (Object.keys(patch).length) {
      await store.setJSON("catalog/settings", cleanSettings(patch, c.settings));
      result.settings = Object.keys(patch).length;
    }
  }

  for (const [area, prefix] of [["bookings", "B"], ["orders", "O"]]) {
    for (const r of Array.isArray(body[area]) ? body[area].slice(0, 500) : []) {
      if (!r?.id || SAMPLE_IDS.has(r.id) || !isDate(r.date) || !str(r.name, 80)) continue;
      const id = /^TLA-[BO]\d{3,6}$/.test(r.id) ? r.id : `TLA-${prefix}${rand(5)}`;
      const key = `${area}/${r.date}/${id}`;
      if (await store.get(key, { type: "json" })) continue;
      const base = { id, key, name: str(r.name, 80), phone: str(r.phone, 30), date: r.date, createdAt: new Date().toISOString(), imported: true, notified: { whatsapp: "off", email: "off" } };
      const rec = area === "bookings"
        ? { ...base, serviceId: str(r.serviceId, 40), service: str(r.service, 80), price: int(r.price, 0, 1e7), time: /^\d{2}:00$/.test(r.time) ? r.time : "09:00", notes: str(r.notes, 500), status: B_STATUS.includes(r.status) ? r.status : "pending" }
        : { ...base, items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).map((i) => ({ productId: str(i.productId, 40), name: str(i.name, 80), qty: int(i.qty, 1, 50), price: int(i.price, 0, 1e7) })), subtotal: int(r.subtotal, 0, 1e8), delivery: int(r.delivery, 0, 1e7), total: int(r.total, 0, 1e8), fulfilment: r.fulfilment === "delivery" ? "delivery" : "pickup", address: str(r.address, 200), status: O_STATUS.includes(r.status) ? r.status : "new" };
      await store.setJSON(key, rec);
      result[area]++;
    }
  }

  const fresh = await getCatalog(store);
  return json({ result, ...fresh });
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

  if (area === "visitors" && method === "GET") return visitorsReport(store);

  if (area === "backup" && method === "GET") {
    const snap = await snapshot(store);
    return new Response(JSON.stringify(snap, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="twins-locs-arena-backup-${snap.exportedAt.slice(0, 10)}.json"` },
    });
  }

  if (area === "backups" && method === "GET") {
    const { blobs } = await store.list({ prefix: "backups/" });
    return json({ backups: blobs.map((b) => b.key.slice(8)).sort().reverse() });
  }

  if (area === "import" && method === "POST") return importLocal(req, store);

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
      const item = area === "products" ? cleanProduct({ ...incoming, id: undefined }, existing) : cleanService({ ...incoming, id: undefined }, existing);
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
  const store = storeFor(context, req);

  try {
    if (parts[0] === "health") return json({ ok: true, context: context?.deploy?.context ?? null, store: storeName(context, req) });
    if (parts[0] === "catalog" && method === "GET") return await catalog(store);
    if (parts[0] === "img" && parts[1] && method === "GET") return await serveImage(store, parts[1]);
    if (parts[0] === "bookings" && method === "POST") return await createBooking(req, store, context);
    if (parts[0] === "orders" && method === "POST") return await createOrder(req, store, context);
    if (parts[0] === "visit" && method === "POST") return await recordVisit(req, store);
    if (parts[0] === "auth" || parts[0] === "me") {
      const res = await customerRoute(parts, method, req, store);
      if (res) return res;
    }
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
