/* Twins Locs Arena - the public shop, booking sheet and client account. */
(() => {
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => iso(new Date());
const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "");
const digits = (p) => String(p || "").replace(/[^\d+]/g, "");
const tel = (p) => `<a class="tel" href="tel:${esc(digits(p))}">${esc(p)}</a>`;

const CART_KEY = "tla-cart-v2", CATALOG_KEY = "tla-catalog-v2", SIGNED_KEY = "tla-signed-in";
const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const S = { services: [], products: [], offers: [], gallery: [], taken: {}, settings: { currency: "KSh", chairs: 2, open: 8, close: 18, depositPct: 30 }, me: null };
Object.assign(S, readLS(CATALOG_KEY) || {});
let cart = readLS(CART_KEY) || [];
let ful = "pickup", pickedSlot = null, acctTab = "signin";

const money = (cents) => `${S.settings.currency} ${(Math.round(cents || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method, credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-TLA-App": "1" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("No connection. Check your internet and try again."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Try again.`);
  return data;
}

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }
async function busy(btn, label, fn) {
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

/* ---------------------------------------------------------------- drawings */
function art(kind) {
  const a = {
    bottle: `<rect class="a-cap" x="40" y="10" width="20" height="8" rx="2"/><rect class="a-cap" x="58" y="12" width="14" height="4" rx="2"/><rect class="a-body" x="43" y="18" width="14" height="12"/><rect class="a-body" x="28" y="30" width="44" height="70" rx="10"/><rect class="a-label" x="35" y="52" width="30" height="26" rx="3"/><rect class="a-gold" x="35" y="72" width="30" height="6"/>`,
    jar: `<rect class="a-cap" x="24" y="30" width="52" height="16" rx="4"/><rect class="a-body" x="20" y="46" width="60" height="52" rx="12"/><rect class="a-label" x="28" y="60" width="44" height="24" rx="3"/><rect class="a-gold" x="28" y="60" width="44" height="5"/>`,
    beads: `${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse class="a-body" cx="50" cy="${14 + i * 16}" rx="10" ry="10"/>`).join("")}<rect class="a-gold" x="36" y="34" width="28" height="14" rx="3"/><rect class="a-gold" x="36" y="66" width="28" height="14" rx="3"/>`,
    bonnet: `<path class="a-body" d="M16 74 Q16 26 50 26 Q84 26 84 74 Z"/><rect class="a-cap" x="12" y="72" width="76" height="12" rx="6"/>`,
    hook: `<path class="a-line" d="M34 96 V30 q0 -12 -9 -12"/><path class="a-line" d="M52 96 V34 q0 -10 -8 -10" style="stroke:var(--loc)"/><path class="a-line" d="M70 96 V38 q0 -8 -6 -8"/><rect class="a-gold" x="26" y="78" width="52" height="8" rx="3"/>`,
    box: `<rect class="a-cap" x="14" y="34" width="72" height="14" rx="3"/><rect class="a-body" x="18" y="48" width="64" height="48" rx="4"/><rect class="a-gold" x="46" y="34" width="8" height="62"/><rect class="a-label" x="26" y="58" width="16" height="22" rx="2"/>`,
  };
  return `<svg viewBox="0 0 100 110" aria-hidden="true">${a[kind] || a.jar}</svg>`;
}
const pic = (p) => (p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" width="300" height="240">` : art(p.kind));
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avatar = (p, size = "") => (p?.picture ? `<img class="avatar ${size}" src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar ${size}" aria-hidden="true">${esc(initials(p?.name))}</span>`);
const userIcon = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

/* ---------------------------------------------------------------- catalogue */
function slotsFor(date) {
  const { open, close, chairs } = S.settings, out = [], now = new Date();
  for (let h = +open; h < +close; h++) {
    const t = `${pad(h)}:00`;
    const taken = S.taken[`${date} ${t}`] || 0;
    const past = date === today() && h <= now.getHours();
    out.push({ t, free: taken < chairs && !past && date >= today() });
  }
  return out;
}
function nextOpen() {
  for (let i = 0; i < 21; i++) {
    const d = iso(addDays(new Date(), i));
    const s = slotsFor(d).find((x) => x.free);
    if (s) return { d, t: s.t };
  }
  return null;
}

async function loadCatalog(quiet) {
  try {
    const c = await api("catalog");
    Object.assign(S, { services: c.services, products: c.products, settings: c.settings, taken: c.taken, offers: c.offers || [], gallery: c.gallery || [] });
    writeLS(CATALOG_KEY, { services: c.services, products: c.products, settings: c.settings, offers: c.offers, gallery: c.gallery });
    cart = cart.filter((x) => S.products.some((p) => p.id === x.id));
    renderAll();
  } catch (e) {
    if (!quiet) toast(e.message);
    if (!S.services.length) $("#menu").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function renderAll() {
  const st = S.settings;
  document.title = `${st.name || "Twins Locs Arena"} · Loc salon in Eldoret | Starter locs, retwists, loc care`;
  $("#footName").textContent = `© ${new Date().getFullYear()} ${st.name || "Twins Locs Arena"}`;
  $("#depPctTxt").textContent = `${st.depositPct}%`;
  const n = nextOpen();
  $("#nextSlot").innerHTML = n ? `Next open chair: <strong>${n.d === today() ? "Today" : fmtDate(n.d)}, ${n.t}</strong>` : "Fully booked for the next three weeks";
  $("#shelfNote").innerHTML = `<strong>${S.products.filter((p) => p.stock > 0).length} products</strong> in stock`;

  // offers
  $("#offers").hidden = !S.offers.length;
  $("#offers").innerHTML = S.offers.map((o) => `<span class="offer-chip">${esc(o.title)}${o.discount_pct ? ` · ${o.discount_pct}% off` : ""}${o.code ? ` · code ${esc(o.code)}` : ""}</span>`).join("");

  // loc menu
  const svcCat = S.svcCat || "All";
  const cats = ["All", ...new Set(S.services.map((s) => s.cat))];
  $("#svcFilters").innerHTML = cats.map((c) => `<button class="chip" data-svc-cat="${esc(c)}" aria-pressed="${c === svcCat}">${esc(c)}</button>`).join("");
  $("#menu").innerHTML = S.services.filter((s) => svcCat === "All" || s.cat === svcCat).map((s) => `
    <div class="m-row">
      <div class="m-head">
        ${s.img ? `<img class="m-photo" src="${esc(s.img)}" alt="${esc(s.name)}" loading="lazy" width="54" height="54">` : ""}
        <div>
      <div class="m-top"><span class="m-name">${esc(s.name)}</span><span class="m-lead"></span><span class="m-price num"><small>from</small>${money(s.price)}</span></div>
      <p class="m-desc">${esc(s.descr)}</p>
      <div class="m-foot"><span>${esc(s.dur)}</span>${s.care ? `<span class="dot"></span><span>${esc(s.care)}</span>` : ""}<button class="link-btn" data-action="book" data-id="${esc(s.id)}">Book this</button></div>
        </div>
      </div>
    </div>`).join("") || `<p class="empty">No services in this category yet.</p>`;

  // our work
  const work = $("#work-grid");
  if (work) {
    const section = document.getElementById("work");
    if (section) section.hidden = !S.gallery.length;
    work.innerHTML = S.gallery.map((g) => `<figure class="work">
      <img src="${esc(g.img)}" alt="${esc(g.title)}" loading="lazy">
      <figcaption><strong>${esc(g.title)}</strong>${g.service ? `<span>${esc(g.service)}</span>` : ""}${g.caption ? `<span>${esc(g.caption)}</span>` : ""}</figcaption>
    </figure>`).join("");
  }

  // shop
  const shopCat = S.shopCat || "All";
  const pcats = ["All", ...new Set(S.products.map((p) => p.cat))];
  $("#shopFilters").innerHTML = pcats.map((c) => `<button class="chip" data-shop-cat="${esc(c)}" aria-pressed="${c === shopCat}">${esc(c)}</button>`).join("");
  $("#products").innerHTML = S.products.filter((p) => shopCat === "All" || p.cat === shopCat).map((p) => `
    <article class="p-card">
      <div class="p-art">${pic(p)}${p.stock === 0 ? '<span class="p-badge out">Sold out</span>' : p.stock <= 5 ? `<span class="p-badge">Only ${p.stock} left</span>` : ""}</div>
      <div class="p-body">
        <span class="p-cat">${esc(p.cat)}</span>
        <h3 class="p-name">${esc(p.name)}</h3>
        <span class="p-size">${esc(p.size)}${p.descr ? ` · ${esc(p.descr)}` : ""}</span>
        <div class="p-row"><span class="p-price num">${money(p.price)}</span>
          <button class="btn sm" data-action="add" data-id="${esc(p.id)}" ${p.stock === 0 ? "disabled" : ""}>${p.stock === 0 ? "Sold out" : "Add to bag"}</button></div>
      </div>
    </article>`).join("");

  // visit + contact
  const wa = waLink(`Hi ${st.name}, I have a question about locs.`);
  $("#visitInfo").innerHTML = `<dt>Hours</dt><dd>${esc(st.hours || "")}</dd><dt>Where</dt><dd>${esc(st.address || "")}</dd>
    <dt>Call</dt><dd>${tel(st.phone || "+254 113 394402")}${st.phone2 ? `<br>${tel(st.phone2)}` : ""}</dd>
    ${wa ? `<dt>WhatsApp</dt><dd><a class="tel" href="${esc(wa)}" target="_blank" rel="noopener">Chat with us</a></dd>` : ""}
    <dt>Chairs</dt><dd>${st.chairs} locticians working at once</dd>`;
  $("#emails").innerHTML = [st.supportEmail, st.bookingsEmail, st.salesEmail].filter(Boolean)
    .map((e) => `<a class="tel" href="mailto:${esc(e)}">${esc(e)}</a>`).join("<br>");

  renderCart();
  renderAcct();
}

const waLink = (text) => {
  const n = String(S.settings.whatsapp || "").replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : "";
};

/* ---------------------------------------------------------------- bag */
const cartLines = () => cart.map((c) => ({ ...c, p: S.products.find((p) => p.id === c.id) })).filter((c) => c.p);
function cartTotals(mode) {
  const sub = cartLines().reduce((a, c) => a + c.qty * c.p.price, 0);
  const del = mode === "delivery" && sub > 0 && sub < S.settings.freeOver ? +S.settings.deliveryFee : 0;
  return { sub, del, total: sub + del };
}
function renderCart() {
  const lines = cartLines(), count = lines.reduce((a, c) => a + c.qty, 0);
  $("#bagCount").textContent = count;
  $("#bagCount2").textContent = count || "";
  const body = $("#cartBody");
  if (!lines.length) {
    body.innerHTML = `<p class="empty">Your bag is empty. Loc spritz and gold cuffs are good places to start.</p><a class="btn ghost sm" href="#shop" data-action="close-cart" style="justify-self:start">Browse the shelf</a>`;
    return;
  }
  const t = cartTotals(ful), st = S.settings;
  const keep = (id) => { const el = document.getElementById(id); return el ? esc(el.value) : ""; };
  const vName = keep("cName") || (S.me ? esc(S.me.name) : ""), vPhone = keep("cPhone") || (S.me ? esc(S.me.phone || "") : ""), vAddr = keep("cAddr");
  body.innerHTML = `
    <div style="display:grid;gap:14px">${lines.map((c) => `
      <div class="c-item"><div class="c-thumb">${pic(c.p)}</div>
        <div><div style="font-weight:600;line-height:1.25">${esc(c.p.name)}</div><div class="hint num">${money(c.p.price)} · ${esc(c.p.size)}</div></div>
        <div class="qty"><button type="button" data-action="qty" data-id="${esc(c.id)}" data-d="-1" aria-label="Remove one">−</button><span class="num">${c.qty}</span><button type="button" data-action="qty" data-id="${esc(c.id)}" data-d="1" aria-label="Add one">+</button></div>
      </div>`).join("")}</div>
    <form id="checkout" style="display:grid;gap:12px" novalidate>
      <input class="hp" name="website" id="oWebsite" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${!S.me ? `<p class="sign-hint"><button type="button" class="link-btn" data-action="account">Sign in</button> to fill in your details and keep track of this order.</p>` : ""}
      <div class="field"><span class="lbl">How do you want it?</span>
        <div class="chips"><button type="button" class="chip" data-ful="pickup" aria-pressed="${ful === "pickup"}">Pick up at salon</button><button type="button" class="chip" data-ful="delivery" aria-pressed="${ful === "delivery"}">Delivery</button></div>
        ${ful === "delivery" ? `<span class="hint">Delivery costs ${money(st.deliveryFee)}, and it’s free on orders over ${money(st.freeOver)}.</span>` : ""}</div>
      <div class="row2"><div class="field"><label for="cName">Name</label><input id="cName" autocomplete="name" value="${vName}"></div>
      <div class="field"><label for="cPhone">Phone</label><input id="cPhone" type="tel" inputmode="tel" autocomplete="tel" value="${vPhone}"></div></div>
      ${ful === "delivery" ? `<div class="field"><label for="cAddr">Delivery address</label><input id="cAddr" autocomplete="street-address" value="${vAddr}"></div>` : ""}
      <div class="sum num"><span>Subtotal</span><span>${money(t.sub)}</span><span>Delivery</span><span>${ful === "delivery" ? (t.del ? money(t.del) : "Free") : "-"}</span><span class="total">Total</span><span class="total">${money(t.total)}</span></div>
      <div class="sheet-foot">
        <p class="err" id="cErr" hidden></p>
        <button class="btn gold block" type="submit">Place order · ${money(t.total)}</button>
        <p class="hint">Pay with M-Pesa or cash when you collect or when your order arrives.</p>
      </div>
    </form>`;
}
const saveCart = () => writeLS(CART_KEY, cart);
function openCart() { $("#scrim").hidden = false; $("#cart").hidden = false; }
function closeCart() { $("#scrim").hidden = true; $("#cart").hidden = true; }

/* ---------------------------------------------------------------- booking */
function openBooking(sid) {
  if (!S.services.length) { toast("The loc menu is still loading. Try again in a moment."); return; }
  const sel = $("#bSvc");
  sel.innerHTML = S.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${money(s.price)}</option>`).join("");
  if (sid) sel.value = sid;
  const n = nextOpen();
  $("#bDate").value = n ? n.d : today();
  pickedSlot = n ? n.t : null;
  $("#bErr").hidden = true;
  renderDays(); renderSlots(); renderBookSum(); prefillBooking();
  $("#bookDlg").showModal();
  const cur = $('#bDays [aria-pressed="true"]');
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
}
function renderDays() {
  const sel = $("#bDate").value;
  let h = "";
  for (let i = 0; i < 21; i++) {
    const dt = addDays(new Date(), i), d = iso(dt), free = slotsFor(d).some((x) => x.free);
    h += `<button type="button" class="day" data-day="${d}" aria-pressed="${d === sel}" ${free ? "" : "disabled"} aria-label="${fmtDate(d)}${free ? "" : ", fully booked"}">
      <span>${i === 0 ? "Today" : dt.toLocaleDateString(undefined, { weekday: "short" })}</span><b class="num">${dt.getDate()}</b><span>${free ? dt.toLocaleDateString(undefined, { month: "short" }) : "Full"}</span></button>`;
  }
  $("#bDays").innerHTML = h;
}
function renderSlots() {
  const s = slotsFor($("#bDate").value);
  if (pickedSlot && !s.find((x) => x.t === pickedSlot && x.free)) pickedSlot = null;
  $("#bSlots").innerHTML = s.map((x) => `<button type="button" class="slot" data-slot="${x.t}" aria-pressed="${x.t === pickedSlot}" ${x.free ? "" : "disabled"}>${x.t}</button>`).join("");
  $("#slotHint").textContent = s.some((x) => x.free)
    ? `${fmtDate($("#bDate").value)} · ${S.settings.chairs} chairs, crossed-out times are full.`
    : "No open times on this day. Try another day.";
}
function renderBookSum() {
  const s = S.services.find((x) => x.id === $("#bSvc").value);
  if (!s) return;
  const dep = Math.round((s.price * S.settings.depositPct) / 100);
  $("#bSum").innerHTML = `<span>${esc(s.name)}</span><span>${money(s.price)}</span><span>Time needed</span><span>${esc(s.dur)}</span>
    <span class="total">Deposit (${S.settings.depositPct}%)</span><span class="total">${money(dep)}</span>
    <span class="hint">Pay after session</span><span class="hint">${money(s.price - dep)}</span>`;
}
function prefillBooking() {
  if (S.me) {
    if (!$("#bName").value) $("#bName").value = S.me.name || "";
    if (!$("#bPhone").value) $("#bPhone").value = S.me.phone || "";
  }
  $("#bSignin").innerHTML = S.me ? "" : `<p class="sign-hint"><button type="button" class="link-btn" data-action="account">Sign in or create an account</button> to fill this in and see your bookings later.</p>`;
}

/* ---------------------------------------------------------------- confirmation */
function showDone(kind, r) {
  const st = S.settings;
  let eyebrow, title, rows, lead, waText;
  if (kind === "booking") {
    const dep = Math.round((r.price * st.depositPct) / 100);
    eyebrow = "Booking requested";
    title = `See you ${r.date === today() ? "today" : fmtDate(r.date)} at ${r.time}`;
    rows = [["Service", `${r.service} · ${money(r.price)}`], ["Deposit", `${money(dep)} (${st.depositPct}%)`], ["Name", r.name], ["Phone", r.phone]];
    lead = `We’ll call ${r.phone} to confirm your chair and share how to pay the deposit.`;
    waText = `Hi ${st.name}, I just booked ${r.service} for ${fmtDate(r.date)} at ${r.time}.\nRef: ${r.id}\nName: ${r.name}\nPhone: ${r.phone}`;
  } else {
    eyebrow = "Order placed";
    title = r.fulfilment === "delivery" ? "We’ll pack it for delivery" : "We’ll have it ready at the salon";
    rows = [["Items", r.items.map((i) => `${i.qty}× ${i.name}`).join(", ")], ["Total", money(r.total)],
      [r.fulfilment === "delivery" ? "Deliver to" : "Pick up", r.fulfilment === "delivery" ? r.address : "At the salon"], ["Phone", r.phone]];
    lead = `We’ll call ${r.phone} when it’s ready. Pay with M-Pesa or cash.`;
    waText = `Hi ${st.name}, I just placed order ${r.id}.\n${r.items.map((i) => `${i.qty}× ${i.name}`).join("\n")}\nTotal: ${money(r.total)}\nName: ${r.name}\nPhone: ${r.phone}`;
  }
  const wa = waLink(waText);
  $("#doneBody").innerHTML = `
    <div class="grab" aria-hidden="true"></div>
    <div class="spread"><span class="eyebrow">${eyebrow}</span><button type="button" class="x" data-action="close-dlg" aria-label="Close">×</button></div>
    <h2>${esc(title)}</h2>
    <p class="done-ref">Your reference <span class="mono">${esc(r.id)}</span></p>
    <dl class="done-list">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <p class="hint">${esc(lead)}</p>
    <div class="sheet-foot">
      ${wa ? `<a class="btn wa block" href="${esc(wa)}" target="_blank" rel="noopener">Send details on WhatsApp</a>` : ""}
      ${S.me ? `<a class="btn ghost block" href="/portal">See it in your account</a>` : ""}
      <button type="button" class="btn ${wa || S.me ? "ghost" : ""} block" data-action="close-dlg">Done</button>
    </div>`;
  $("#doneDlg").showModal();
}

/* ---------------------------------------------------------------- account */
function renderAcct() {
  const b = $("#acctBtn");
  if (!b) return;
  b.hidden = false;
  if (S.me) {
    b.classList.add("in");
    b.innerHTML = `${avatar(S.me)}<span>${esc((S.me.name || "Account").split(" ")[0])}</span>`;
    b.setAttribute("aria-label", "Your account");
  } else {
    b.classList.remove("in");
    b.innerHTML = `${userIcon}<span>Sign in</span>`;
    b.setAttribute("aria-label", "Sign in or create an account");
  }
}

async function loadMe(quiet) {
  try {
    const r = await api("me");
    S.me = r.me;
    writeLS(SIGNED_KEY, Boolean(r.me));
  } catch (e) { if (!quiet) toast(e.message); }
  renderAcct();
}

function renderAccount() {
  const body = $("#acctBody");
  if (S.me) {
    body.innerHTML = `
      <div class="grab" aria-hidden="true"></div>
      <div class="spread"><span class="eyebrow">Your account</span><button type="button" class="x" data-action="close-dlg" aria-label="Close">×</button></div>
      <div class="acct-head">${avatar(S.me, "lg")}<div style="min-width:0"><h2>${esc(S.me.name)}</h2><p class="hint">${esc(S.me.email || "")}</p></div></div>
      <div class="sheet-foot">
        <a class="btn block" href="/portal">Open my portal</a>
        <button type="button" class="btn ghost block" data-action="signout">Sign out</button>
      </div>`;
    return;
  }
  const tabs = [["signin", "Sign in"], ["signup", "Create account"], ["forgot", "Forgot password"]];
  body.innerHTML = `
    <div class="grab" aria-hidden="true"></div>
    <div class="spread"><span class="eyebrow">Client account</span><button type="button" class="x" data-action="close-dlg" aria-label="Close">×</button></div>
    <h2>${acctTab === "signup" ? "Create your account" : acctTab === "forgot" ? "Reset your password" : "Welcome back"}</h2>
    <div class="tabs-row" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === acctTab}" data-acct-tab="${k}">${l}</button>`).join("")}</div>
    ${S.settings.googleClientId ? `<div class="gsi-wrap" id="gsiBtn"><span class="hint">Loading Google sign-in…</span></div><p class="hint" style="text-align:center">or use your email</p>` : ""}
    <form id="acctForm" class="stack" novalidate>
      ${acctTab === "signup" ? `<div class="row2">
        <div class="field"><label for="aName">Your name</label><input id="aName" autocomplete="name" required></div>
        <div class="field"><label for="aPhone">Phone</label><input id="aPhone" type="tel" inputmode="tel" autocomplete="tel"></div></div>` : ""}
      <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="username" required></div>
      ${acctTab !== "forgot" ? `<div class="field"><label for="aPass">Password</label><input id="aPass" type="password" autocomplete="${acctTab === "signup" ? "new-password" : "current-password"}" required>
        ${acctTab === "signup" ? `<span class="hint">At least 10 characters, with letters and numbers.</span>` : ""}</div>` : ""}
      <p class="err" id="aErr" hidden></p>
      <button class="btn block" type="submit">${acctTab === "signup" ? "Create account" : acctTab === "forgot" ? "Email me a reset link" : "Sign in"}</button>
      <p class="hint">${acctTab === "signup" ? "We only use your details for your bookings and orders." : "Your bookings, orders and offers live in your portal."}</p>
    </form>`;
  if (S.settings.googleClientId) mountGoogle();
}

let gsiPromise = null, gsiFor = "";
const loadGsi = () => (window.google?.accounts?.id ? Promise.resolve() : (gsiPromise ||= new Promise((res, rej) => {
  const sc = document.createElement("script");
  sc.src = "https://accounts.google.com/gsi/client";
  sc.async = true;
  sc.onload = res;
  sc.onerror = () => { gsiPromise = null; rej(new Error("Google sign-in couldn’t load.")); };
  document.head.appendChild(sc);
})));

async function mountGoogle() {
  const el = $("#gsiBtn");
  if (!el) return;
  try {
    await loadGsi();
    const cid = S.settings.googleClientId;
    if (gsiFor !== cid) {
      google.accounts.id.initialize({ client_id: cid, callback: onGoogle, ux_mode: "popup", auto_select: false, itp_support: true });
      gsiFor = cid;
    }
    el.innerHTML = "";
    google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", shape: "pill", text: "signin_with", width: Math.max(220, Math.min(320, el.clientWidth || 300)) });
  } catch (e) { el.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
}

async function onGoogle(resp) {
  try {
    const r = await api("account/google", { method: "POST", body: { credential: resp.credential } });
    S.me = r.me;
    writeLS(SIGNED_KEY, true);
    renderAcct(); renderAccount(); renderCart(); prefillBooking();
    toast(`Signed in as ${r.me.name}`);
  } catch (e) { toast(e.message); }
}

/* ---------------------------------------------------------------- visits */
function readVid() {
  let vid = "";
  try { vid = localStorage.getItem("tla-vid") || ""; } catch {}
  if (!/^[a-z0-9]{16,40}$/.test(vid)) {
    vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("");
    try { localStorage.setItem("tla-vid", vid); } catch {}
  }
  return vid;
}
function trackVisit() {
  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    if (sessionStorage.getItem("tla-visit")) return;
    sessionStorage.setItem("tla-visit", "1");
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? "Android" : (/iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) ? "iPad"
      : /iPhone|iPod/i.test(ua) ? "iPhone" : /CrOS/.test(ua) ? "ChromeOS" : /Windows/i.test(ua) ? "Windows"
      : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Other";
    const device = (os === "iPad" || (/Android/i.test(ua) && !/Mobile/i.test(ua))) ? "Tablet" : /Mobi|iPhone|Android/i.test(ua) ? "Phone" : "Computer";
    const named = (h) => /(^|\.)google\./.test(h) ? "Google" : /facebook|fb\.(com|me)/.test(h) ? "Facebook" : /instagram/.test(h) ? "Instagram"
      : /(^|\.)(t\.co|twitter\.com|x\.com)$/.test(h) ? "X (Twitter)" : /whatsapp/.test(h) ? "WhatsApp" : /tiktok/.test(h) ? "TikTok" : /bing\./.test(h) ? "Bing" : h;
    let source = new URLSearchParams(location.search).get("utm_source") || "";
    if (!source && document.referrer) {
      try { const h = new URL(document.referrer).hostname.replace(/^www\./, ""); if (h && h !== location.hostname) source = named(h); } catch {}
    }
    fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json", "X-TLA-App": "1" }, keepalive: true,
      body: JSON.stringify({ vid: readVid(), path: location.pathname + location.hash, source, device, os }) }).catch(() => {});
  } catch {}
}

/* ---------------------------------------------------------------- events */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action],[data-svc-cat],[data-shop-cat],[data-slot],[data-day],[data-ful],[data-acct-tab]");
  if (!t) return;
  const { action, id } = t.dataset;
  try {
    if (t.dataset.svcCat) { S.svcCat = t.dataset.svcCat; return renderAll(); }
    if (t.dataset.shopCat) { S.shopCat = t.dataset.shopCat; return renderAll(); }
    if (t.dataset.slot) { pickedSlot = t.dataset.slot; return renderSlots(); }
    if (t.dataset.day) { $("#bDate").value = t.dataset.day; pickedSlot = null; renderDays(); return renderSlots(); }
    if (t.dataset.ful) { ful = t.dataset.ful; return renderCart(); }
    if (t.dataset.acctTab) { acctTab = t.dataset.acctTab; return renderAccount(); }

    switch (action) {
      case "book": if ($("#acctDlg").open) $("#acctDlg").close(); return openBooking(id);
      case "open-cart": return openCart();
      case "close-cart": return closeCart();
      case "close-dlg": return t.closest("dialog").close();
      case "account": {
        if ($("#bookDlg").open) $("#bookDlg").close();
        closeCart();
        renderAccount();
        $("#acctDlg").showModal();
        if (S.me) loadMe(true);
        return;
      }
      case "signout":
        await api("account/logout", { method: "POST" });
        try { google.accounts.id.disableAutoSelect(); } catch {}
        S.me = null; writeLS(SIGNED_KEY, false);
        renderAcct(); renderAccount(); renderCart();
        return toast("Signed out.");
      case "add": {
        const p = S.products.find((x) => x.id === id), c = cart.find((x) => x.id === id);
        if (c) { if (c.qty >= p.stock) return toast(`Only ${p.stock} in stock`); c.qty++; } else cart.push({ id, qty: 1 });
        saveCart(); renderCart();
        return toast(`Added ${p.name} to your bag`);
      }
      case "qty": {
        const c = cart.find((x) => x.id === id), p = S.products.find((x) => x.id === id), d = +t.dataset.d;
        if (d > 0 && c.qty >= p.stock) return toast(`Only ${p.stock} in stock`);
        c.qty += d;
        if (c.qty <= 0) cart = cart.filter((x) => x.id !== id);
        saveCart();
        return renderCart();
      }
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "bSvc") renderBookSum();
});

document.addEventListener("submit", async (e) => {
  const f = e.target;
  e.preventDefault();
  const btn = f.querySelector("[type=submit]");

  if (f.id === "bookForm") {
    const name = $("#bName").value.trim(), phone = $("#bPhone").value.trim(), err = $("#bErr");
    const miss = [!pickedSlot && "a time", !name && "your name", !phone && "a phone number"].filter(Boolean);
    if (miss.length) { err.textContent = `Add ${miss.join(", ")} to request this booking.`; err.hidden = false; return; }
    err.hidden = true;
    try {
      const r = await busy(btn, "Sending…", () => api("bookings", { method: "POST", body: {
        name, phone, serviceId: $("#bSvc").value, date: $("#bDate").value, time: pickedSlot,
        notes: $("#bNotes").value.trim(), email: S.me?.email || "", website: $("#bWebsite").value,
      } }));
      const k = `${r.booking.date} ${r.booking.time}`;
      S.taken[k] = (S.taken[k] || 0) + 1;
      $("#bookDlg").close();
      f.reset();
      renderAll();
      showDone("booking", r.booking);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      if (/taken/i.test(ex.message)) { await loadCatalog(true); renderDays(); renderSlots(); }
    }
    return;
  }

  if (f.id === "checkout") {
    const name = $("#cName").value.trim(), phone = $("#cPhone").value.trim(), addr = $("#cAddr")?.value.trim() || "", err = $("#cErr");
    const miss = [!name && "your name", !phone && "a phone number", ful === "delivery" && !addr && "a delivery address"].filter(Boolean);
    if (miss.length) { err.textContent = `Add ${miss.join(", ")} to place your order.`; err.hidden = false; return; }
    err.hidden = true;
    try {
      const r = await busy(btn, "Placing order…", () => api("orders", { method: "POST", body: {
        name, phone, address: addr, fulfilment: ful, items: cart, email: S.me?.email || "", website: $("#oWebsite").value,
      } }));
      S.products = r.products;
      cart = []; saveCart(); closeCart(); renderAll();
      showDone("order", r.order);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; loadCatalog(true); }
    return;
  }

  if (f.id === "acctForm") {
    const err = $("#aErr");
    err.hidden = true;
    const email = $("#aEmail").value.trim();
    try {
      if (acctTab === "forgot") {
        const r = await busy(btn, "Sending…", () => api("account/forgot", { method: "POST", body: { email } }));
        toast(r.message);
        acctTab = "signin";
        return renderAccount();
      }
      const body = { email, password: $("#aPass").value };
      if (acctTab === "signup") Object.assign(body, { name: $("#aName").value.trim(), phone: $("#aPhone").value.trim() });
      const r = await busy(btn, acctTab === "signup" ? "Creating…" : "Signing in…", () => api(`account/${acctTab === "signup" ? "signup" : "login"}`, { method: "POST", body }));
      S.me = r.me;
      writeLS(SIGNED_KEY, true);
      $("#acctDlg").close();
      renderAcct(); renderCart(); prefillBooking();
      toast(acctTab === "signup" ? `Welcome, ${r.me.name}.` : `Signed in as ${r.me.name}.`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    return;
  }

  if (f.id === "contactForm") {
    const err = $("#mErr");
    err.hidden = true;
    try {
      await busy(btn, "Sending…", () => api("contact", { method: "POST", body: {
        name: $("#mName").value.trim(), phone: $("#mPhone").value.trim(), message: $("#mMsg").value.trim(),
        email: S.me?.email || "", website: $("#cWebsite").value,
      } }));
      f.reset();
      toast("Thank you - we’ll come back to you shortly.");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#cart").hidden) closeCart(); });
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => {
  if (e.target !== d) return;
  const r = d.getBoundingClientRect();
  if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) d.close();
}));

// highlight the section in view on the phone tab bar
if ("IntersectionObserver" in window) {
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const id = ["how", "visit", "contact"].includes(en.target.id) ? null : en.target.id;
      document.querySelectorAll(".tabbar [data-nav]").forEach((a) => a.setAttribute("aria-current", a.dataset.nav === id ? "true" : "false"));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  ["home", "services", "shop", "how", "visit"].forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
}

/* ---------------------------------------------------------------- start */
renderAll();
loadCatalog(true).then(() => { if (location.hash === "#book") openBooking(); });
trackVisit();
if (readLS(SIGNED_KEY)) loadMe(true);

let lastLoad = Date.now();
const refresh = () => {
  if (document.visibilityState !== "visible" || Date.now() - lastLoad < 20000) return;
  if ($("#bookDlg").open || !$("#cart").hidden) return;
  lastLoad = Date.now();
  loadCatalog(true);
};
document.addEventListener("visibilitychange", refresh);
window.addEventListener("focus", refresh);
setInterval(refresh, 120000);

// An installed app must pick up new colours and prices by itself: when a new
// version of the worker takes over, reload the page once.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.update();
    setInterval(() => reg.update(), 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update(); });
  }).catch(() => {});
}
})();
