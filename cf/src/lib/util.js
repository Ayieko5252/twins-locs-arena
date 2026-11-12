// Small shared helpers: replies, input cleaning, money, dates, files.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export const fail = (status, error) => json({ error }, status);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (message) => new HttpError(400, message);

export async function readJson(request, maxBytes = 1_000_000) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "That is too big to send in one go.");
  try {
    return await request.json();
  } catch {
    throw bad("The request couldn’t be read. Refresh the page and try again.");
  }
}

/* ---------------------------------------------------------------- cleaning input */
export const str = (v, max = 200) => String(v ?? "").trim().slice(0, max).trim();
export const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
export const bool = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
export const email = (v) => {
  const e = str(v, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : "";
};
export const phoneDigits = (v) => str(v, 30).replace(/[^\d+]/g, "");
export const validPhone = (v) => phoneDigits(v).replace(/\D/g, "").length >= 7;
export const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
export const isDate = (d) => {
  // A plain regex would accept 30 February, so check the date comes back unchanged.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
};

/* ---------------------------------------------------------------- money */
// Prices are entered in whole shillings and stored in cents.
export const toCents = (amount) => Math.round(Number(amount || 0) * 100);
export const fromCents = (cents) => Math.round(Number(cents || 0)) / 100;
export const money = (cents, currency = "KSh") => `${currency} ${fromCents(cents).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Selling price from cost and markup. Kept on the server so the shop can never be told a wrong price.
export const priceFromCost = (costCents, markupPct) => Math.round(int(costCents) * (1 + int(markupPct, 0, 1000) / 100));

// What is actually left after VAT on a VAT-inclusive price - the trap that catches small shops.
export function marginAfterVat(costCents, priceCents, vatPct = 16) {
  const net = Math.round(priceCents / (1 + vatPct / 100));
  const profit = net - costCents;
  return { netCents: net, profitCents: profit, marginPct: net ? Math.round((profit / net) * 1000) / 10 : 0 };
}

/* ---------------------------------------------------------------- dates */
export const todayIn = (tz = "Africa/Nairobi") => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/* ---------------------------------------------------------------- ids */
const digits = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x % 10).join("");
export const bookingId = () => `TLA-B${digits(5)}`;
export const orderId = () => `TLA-O${digits(5)}`;
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${digits(3)}`;

/* ---------------------------------------------------------------- files (R2) */
const SAFE_TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
export const fileExt = (mime) => SAFE_TYPES[mime] || "";
export const fileTypeAllowed = (mime) => Boolean(SAFE_TYPES[mime]);

// Saves a data: URL (what the browser sends after shrinking a photo) into R2.
export async function putDataUrl(bucket, key, dataUrl, maxBytes = 3_000_000) {
  const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw bad("That file couldn’t be read. Use a JPG, PNG or PDF.");
  const [, mime, b64] = m;
  if (!fileTypeAllowed(mime)) throw bad("That kind of file isn’t allowed. Use a JPG, PNG or PDF.");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.byteLength > maxBytes) throw new HttpError(413, `That file is too big. Keep it under ${Math.round(maxBytes / 1e6)} MB.`);
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
  return { key, mime, size: bytes.byteLength };
}

export async function serveFile(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  if (!headers.has("cache-control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

/* ---------------------------------------------------------------- misc */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
