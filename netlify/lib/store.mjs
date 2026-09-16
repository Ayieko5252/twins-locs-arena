// Shared database helpers (Netlify Blobs).
// Production uses the "tla" store; previews use "tla-preview" so tests never touch real data.
// Deploys never clear a store: data stays until the admin changes or deletes it.

import { getStore } from "@netlify/blobs";
import { DEFAULT_PRODUCTS, DEFAULT_SERVICES, DEFAULT_SETTINGS } from "./defaults.mjs";

// The live domain always uses the real data, whatever kind of deploy serves it.
// Preview links (<deploy-id>--site.netlify.app) and local dev use a separate test store.
export function storeName(context, req) {
  let host = "";
  try { host = req ? new URL(req.url).hostname : ""; } catch {}
  if (host) return /(^|\.)[0-9a-z]{6,}--/.test(host) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) ? "tla-preview" : "tla";
  return (context?.deploy?.context ?? "production") === "production" ? "tla" : "tla-preview";
}
export const storeFor = (context, req) => getStore({ name: storeName(context, req), consistency: "strong" });

export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function localToday(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function getSettings(store) {
  return { ...DEFAULT_SETTINGS, ...((await store.get("catalog/settings", { type: "json" })) || {}) };
}

// Seeds the starting menu only when a list has never been saved.
export async function getCatalog(store) {
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

export async function getAll(store, prefix, keep = () => true, limit = Infinity) {
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map((b) => b.key).filter(keep).slice(-limit);
  const out = [];
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" })));
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

export async function snapshot(store) {
  const [catalog, bookings, orders, customers, visitors] = await Promise.all([
    getCatalog(store),
    getAll(store, "bookings/"),
    getAll(store, "orders/"),
    getAll(store, "customers/"),
    getAll(store, "visitors/"),
  ]);
  return { app: "twins-locs-arena", version: 1, exportedAt: new Date().toISOString(), catalog, bookings, orders, customers, visitors };
}
