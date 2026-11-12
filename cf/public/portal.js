/* The client portal: appointments, orders, offers, loyalty and account details. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");
const today = () => new Date().toISOString().slice(0, 10);
let CUR = "KSh";
const money = (c) => `${CUR} ${(Math.round(c || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const tag = (s) => `<span class="tag s-${esc(s)}">${esc(String(s).replace("_", " "))}</span>`;

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-TLA-App": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}
let toastT;
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); };
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avatar = (p) => (p?.picture ? `<img class="avatar lg" src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar lg">${esc(initials(p?.name))}</span>`);

async function load() {
  const main = $("#main");
  let d;
  try { d = await api("me"); } catch (e) { main.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; return; }

  if (!d.me) {
    main.innerHTML = `<div class="panel" style="max-width:520px;margin:40px auto">
      <h1>Your account</h1>
      <p>Sign in on the main page to see your appointments, orders and offers.</p>
      <div><a class="btn" href="/">Go to the shop and sign in</a></div>
    </div>`;
    return;
  }

  const { me, bookings = [], orders = [], offers = [], loyalty = {}, next } = d;
  const upcoming = bookings.filter((b) => b.date >= today() && ["pending", "confirmed"].includes(b.status));
  const past = bookings.filter((b) => !upcoming.includes(b));

  main.innerHTML = `
    <div class="spread" style="margin-bottom:22px">
      <div class="acct-head">${avatar(me)}<div style="min-width:0"><h1 style="font-size:clamp(1.6rem,4vw,2.2rem)">${esc(me.name)}</h1>
        <p class="hint">${esc(me.email || "")}${me.phone ? ` · ${esc(me.phone)}` : ""}</p></div></div>
      <button class="btn ghost sm" data-act="signout">Sign out</button>
    </div>

    ${next ? `<div class="notice" style="margin-bottom:18px">
      <strong>Your next session: ${esc(next.service)}</strong>
      <span>${fmtDate(next.date)} at ${esc(next.time)} · ${tag(next.status)}</span>
      <span class="hint">Reference ${esc(next.id)}. Call us if you need to move it.</span></div>` : ""}

    <div class="grid-2" style="margin-bottom:18px">
      <div class="panel">
        <h2 style="font-size:1.3rem">Loyalty</h2>
        <p class="hint">Every ${loyalty.need} finished sessions earns a reward. You have had ${loyalty.visits}.</p>
        <div class="loyalty">${Array.from({ length: loyalty.need || 6 }, (_, i) => `<i class="${i < (loyalty.visits % (loyalty.need || 6)) ? "on" : ""}"></i>`).join("")}</div>
        <p class="hint">${loyalty.earned ? `You have earned ${loyalty.earned} reward${loyalty.earned > 1 ? "s" : ""}. Ask at the salon.` : `${loyalty.toGo} more to your first reward.`}</p>
      </div>
      <div class="panel">
        <h2 style="font-size:1.3rem">Offers for you</h2>
        ${offers.length ? offers.map((o) => `<div class="li"><div></div><div><div class="who">${esc(o.title)}</div>
          <div class="what">${esc(o.detail || "")}${o.code ? ` · code ${esc(o.code)}` : ""}${o.ends_on ? ` · ends ${fmtDate(o.ends_on)}` : ""}</div></div>
          <span class="tag">${o.discount_pct}% off</span></div>`).join("") : `<p class="empty">No offers right now. We will put them here.</p>`}
      </div>
    </div>

    <div class="panel" style="margin-bottom:18px">
      <div class="panel-head"><h2 style="font-size:1.3rem">Your appointments</h2><a class="btn gold sm" href="/#book">Book again</a></div>
      ${upcoming.length ? `<h3 style="font-size:1rem">Coming up</h3><div class="list">${upcoming.map(row).join("")}</div>` : ""}
      ${past.length ? `<h3 style="font-size:1rem">Past visits</h3><div class="list">${past.map(row).join("")}</div>`
        : !upcoming.length ? `<p class="empty">No appointments yet. Book your first session and it will show here.</p>` : ""}
    </div>

    <div class="panel" style="margin-bottom:18px">
      <h2 style="font-size:1.3rem">Your orders</h2>
      <div class="list">${orders.length ? orders.map((o) => `<div class="li">
        <div class="when">${money(o.total_cents)}<small>${fmtDate(o.date)}</small></div>
        <div><div class="who">${(o.items || []).map((i) => `${i.qty}× ${esc(i.name)}`).join(", ") || "Order"}</div>
          <div class="what">${esc(o.id)} · ${o.fulfilment === "delivery" ? "Delivery" : "Pick up at salon"}</div></div>
        ${tag(o.status)}</div>`).join("") : `<p class="empty">No orders yet.</p>`}</div>
    </div>

    <form class="panel" id="meForm" novalidate>
      <h2 style="font-size:1.3rem">Your details</h2>
      <div class="row2">
        <div class="field"><label for="pName">Name</label><input id="pName" value="${esc(me.name)}" autocomplete="name"></div>
        <div class="field"><label for="pPhone">Phone</label><input id="pPhone" value="${esc(me.phone || "")}" type="tel" inputmode="tel" autocomplete="tel"></div>
      </div>
      <label class="hint"><input type="checkbox" id="pMarketing" ${me.marketing ? "checked" : ""}> Send me offers and loc care tips</label>
      <h3 style="font-size:1rem">Change your password</h3>
      <div class="row2">
        ${me.hasPassword ? `<div class="field"><label for="pCur">Current password</label><input id="pCur" type="password" autocomplete="current-password"></div>` : ""}
        <div class="field"><label for="pNew">New password</label><input id="pNew" type="password" autocomplete="new-password">
          <span class="hint">At least 10 characters, with letters and numbers. Leave empty to keep the one you have.</span></div>
      </div>
      <p class="err" id="pErr" hidden></p>
      <div><button class="btn" type="submit">Save my details</button></div>
    </form>`;
  CUR = d.currency || CUR;
}

const row = (b) => `<div class="li">
  <div class="when">${esc(b.time)}<small>${fmtDate(b.date)}</small></div>
  <div><div class="who">${esc(b.service)}</div><div class="what">${esc(b.id)} · ${money(b.price_cents)}${b.notes ? ` · ${esc(b.notes)}` : ""}</div></div>
  ${tag(b.status)}</div>`;

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  if (t.dataset.act === "signout") {
    try { await api("account/logout", { method: "POST" }); location.href = "/"; } catch (err) { toast(err.message); }
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "meForm") return;
  e.preventDefault();
  const err = $("#pErr");
  err.hidden = true;
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "Saving…";
  try {
    await api("me", { method: "PUT", body: {
      name: $("#pName").value.trim(), phone: $("#pPhone").value.trim(),
      marketing: $("#pMarketing").checked, password: $("#pNew").value, currentPassword: $("#pCur")?.value || "",
    } });
    toast("Saved.");
    $("#pNew").value = "";
    if ($("#pCur")) $("#pCur").value = "";
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  btn.disabled = false;
  btn.textContent = old;
});

load();
})();
