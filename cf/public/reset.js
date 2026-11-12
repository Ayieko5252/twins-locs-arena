/* Finishes a client password reset from the emailed link. */
(() => {
const $ = (s) => document.querySelector(s);
const token = new URLSearchParams(location.search).get("token") || "";
const err = $("#err");
if (!token) { err.textContent = "That link is incomplete. Ask for a new reset email from the shop page."; err.hidden = false; }

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  if ($("#pass").value !== $("#pass2").value) { err.textContent = "The two passwords do not match."; err.hidden = false; return; }
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetch("/api/account/reset", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-TLA-App": "1" },
      body: JSON.stringify({ token, password: $("#pass").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That did not work.");
    location.href = "/portal";
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Save new password";
  }
});
})();
