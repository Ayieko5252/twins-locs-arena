# Chief software engineer: release review

Reviewed: the Twins Locs Arena platform (Cloudflare Worker, D1 database, R2 files)
before it went live on www.twinslocsarena.com.

**Verdict: shipped, after six faults were fixed.** Three were security holes, three
were faults that only appeared on the real site. All six are fixed and checked
against the running system, not just in theory.

---

## Security findings

### 1. Anyone could download the whole database (high)

`/file/<name>` handed back any object in storage with no sign-in. The nightly
backup lives there, and it holds every client name, phone number, booking and
staff record.

*Fixed:* only shop photos are public. Department documents and expense receipts
need a signed-in staff member holding the matching permission. Backups are not
reachable over the web at all; the owner downloads one through the hub, which
checks permission first.

*Checked live:* `/file/backups/...` returns 404 even for the owner.

### 2. An administrator could take over the salon (high)

Anyone with permission to edit staff could move their own account into
Management, or create a Management account and then reset its password. The
department walls were enforced on reading data but not on changing who belongs
to which department.

*Fixed:* only Management may create a Management account, change one, or reset
its password, and a department head cannot change their own rank.

*Checked live:* as `admin`, both attempts return "Only management can...".

### 3. The settings page answered any signed-in staff member (medium)

Business settings, including the Google sign-in client ID, were readable by
every account even though the menu item was hidden.

*Fixed:* the endpoint now requires the settings permission.

*Checked live:* `loctician` gets 403, `owner` gets 200.

---

## Faults found by testing the deployed site

### 4. Nobody could sign in (high)

Cloudflare Workers refuse PBKDF2 above 100,000 rounds. The code used 210,000, so
the check threw an error, which the code treated as a wrong password. Every
account failed with "that email and password don't match", which looks like a
typo rather than a bug.

*Fixed:* rounds set to the limit, and a test pins the value so it cannot drift
back.

### 5. Pages arrived with no security headers (medium)

Cloudflare served the static files before the Worker ran, so the content
security policy, HSTS and the rest were never attached to a page.

*Fixed:* the Worker now answers first.

*Checked live:* all five headers present on the home page.

### 6. The client portal and reset pages were broken (medium)

Cloudflare's asset server rewrote `/portal.html` to `/portal`, which fought the
Worker's own routing and produced a redirect instead of a page.

*Fixed:* path rewriting turned off; the Worker does the routing.

---

## What was checked and found sound

- **SQL**: every query uses bound parameters. The few places that build a query
  string use a fixed list of table or column names, never user input.
- **Passwords**: stored as salted PBKDF2, never logged, never returned by any
  endpoint, and stripped from backups. A weak-password check refuses the
  obvious ones.
- **Sessions**: random 256-bit tokens, stored hashed, HttpOnly and Secure, with
  an idle limit of 45 minutes and a hard limit of 12 hours for staff. Changing a
  password signs out every other device.
- **Lockouts**: five wrong tries locks an account for 15 minutes, doubling up to
  two hours. Checked live.
- **Cross-site requests**: refused unless they come from the site itself.
- **Scripts**: the content security policy allows only scripts carrying a
  one-time nonce, so injected markup cannot run.
- **Uploads**: limited to images, PDFs and documents, size-capped, and served
  with a policy that stops anything running.
- **Money**: amounts are integers in cents; an entry that does not balance is
  refused; a repeated payment reference is refused; stock cannot go negative.
- **Privacy**: no ID numbers, passport numbers or card numbers anywhere; visit
  counting stores no IP addresses and honours "do not track".

## Known limits, accepted for now

- **Two staff selling the last item at the same instant** could oversell by one.
  D1 has no transaction across a read and a write here. The stock ledger shows
  the mistake, and a monthly count corrects it.
- **Payments are recorded by hand.** Nothing talks to M-Pesa yet, so the books
  are only as accurate as what staff enter.
- **The shared starter password** is the weakest point until everyone changes
  it. The Employees page flags anyone who has not.
