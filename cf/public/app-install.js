/* The install page: offers the real install prompt where the browser allows it. */
(() => {
const $ = (s) => document.querySelector(s);
$("#yr").textContent = new Date().getFullYear();

let toastT;
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4000); };

const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (standalone) $("#installed").hidden = false;

// Android and desktop Chrome hand us the prompt; iPhone never does, which is
// why the written steps are always on the page.
let waiting = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  waiting = e;
  const btn = $("#installBtn");
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    waiting.prompt();
    const { outcome } = await waiting.userChoice;
    waiting = null;
    btn.hidden = true;
    toast(outcome === "accepted" ? "Installing. Look for the loc icon with your apps." : "No problem. You can install any time from this page.");
  }, { once: true });
});

window.addEventListener("appinstalled", () => {
  $("#installBtn").hidden = true;
  $("#installed").hidden = false;
  toast("Installed. Open it from your home screen.");
});

// Point people at the steps that match the phone in their hand.
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
if (isIOS || isAndroid) {
  const target = document.getElementById(isIOS ? "iphone" : "android");
  if (target) {
    target.style.outline = "2px solid var(--gold)";
    target.style.outlineOffset = "4px";
  }
}

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
