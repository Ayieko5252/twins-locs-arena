# Twins Locs Arena: the owner's guide

Everything in this file is something only you, the owner, can do. Each job is a
numbered list. Nothing here needs a programmer.

The system has four parts:

| Part | Who it is for | Web address |
| --- | --- | --- |
| The shop and booking page | Customers | `/` |
| Client portal | Customers who sign in | `/portal` |
| Staff Operations Hub | Your staff | `/ops` (sign in at `/staff`) |
| The database and files | Nobody opens it directly | Cloudflare D1 and R2 |

---

## 1. The staff accounts that already exist

Thirteen accounts are created with one shared starter password, the one you
chose when the accounts were set up. Everyone signs in at `/staff` with their
**username** (no email needed).

The starter password is deliberately **not** written in these files, because the
code is in a public repository. Keep it somewhere private and change it at first
sign-in.

| Username | Person | Department | Can do |
| --- | --- | --- | --- |
| `owner` | Salon Owner | Management | Everything |
| `manager` | General Manager | Management | Everything except changing the owner |
| `chiefdev` | Chief Software Engineer | Management | Reviews the system |
| `dev` | Senior Software Engineer | Management | Builds changes |
| `ui` | Senior UI Engineer | Management | Looks after how pages look |
| `admin` | Administrator | Administration | Bookings, clients, staff, offers, files |
| `frontdesk` | Front Desk | Administration | Bookings and clients |
| `marketer` | Senior Marketer | Administration | Offers and campaigns |
| `accountant` | Senior Accountant | Accounts | All money, approvals, reports |
| `bookkeeper` | Bookkeeper | Accounts | Entries, expenses, reports |
| `cosmetics` | Chief Cosmetics Expert | Employee | Clients, stock, tasks |
| `sales` | Senior Cosmetic Salesperson | Employee | Clients, stock, shop orders |
| `loctician` | Senior Loctician | Employee | Their own day and clients |

**Do this first:**

1. Open `/staff` and sign in as `owner` with the starter password.
2. The hub asks you to choose your own password. Choose one only you know.
3. Give each member of staff their username and the starter password in person.
4. Watch the **Employees** page. Anyone still showing "starter password" has not
   changed it yet, so remind them.
5. When someone leaves, open **Employees**, click **Edit**, set them to
   **Suspended**. Their work history stays; they can no longer sign in.

Two-step verification is **off** and optional. Anyone who wants it can switch it
on for their own account under **Security**.

---

## 2. Your addresses

The salon is live at these addresses, and it stays up day and night:

| What | Address |
| --- | --- |
| The shop and booking page | https://www.twinslocsarena.com |
| Client portal | https://www.twinslocsarena.com/portal |
| Staff sign in | https://www.twinslocsarena.com/staff |
| Operations Hub | https://www.twinslocsarena.com/ops |

`twinslocsarena.com` without the `www` sends people to the same place.

The domain is registered until 12 November 2027 and renews itself. The contact
on it is Kevin Aiyeko, ayiekokelvin21@gmail.com, +254 790850917.

**One thing to finish:** Cloudflare emails ayiekokelvin21@gmail.com a link to
confirm the registrant contact change. Open that email and click the link. If
nobody clicks it within 15 days, the domain can be suspended.

## 3. Email addresses on your own domain (Zoho Mail, free)

Three addresses are already used by the site: `support@`, `bookings@` and
`sales@twinslocsarena.com`. They start working once you set up mail.

1. Go to **zoho.com/mail** and choose the **Forever Free Plan** (5 users).
2. Sign up with the domain `twinslocsarena.com`.
3. Zoho shows a **TXT record** to prove you own the domain. In Cloudflare open
   your domain, go to **DNS**, click **Add record**, choose **TXT**, and paste
   what Zoho gave you. Set Proxy status to **DNS only**.
4. Back in Zoho, click **Verify**.
5. Create the mailboxes: `support`, `bookings`, `sales`, plus one for yourself.
6. Zoho then gives you **MX records**. Add all of them in Cloudflare DNS exactly
   as shown, again **DNS only**:
   - `twinslocsarena.com` MX `mx.zoho.com` priority 10
   - `twinslocsarena.com` MX `mx2.zoho.com` priority 20
   - `twinslocsarena.com` MX `mx3.zoho.com` priority 50
7. Add the SPF and DKIM records Zoho lists. These stop your mail going to spam.
8. Send yourself a test email from Zoho to check it arrives.

---

## 4. Turn on booking alerts

Bookings always appear in the hub. These two settings also push them to you.

**WhatsApp (free, through CallMeBot):**

1. Search the web for "CallMeBot WhatsApp API" and follow their activation step:
   you send one WhatsApp message to their number and they reply with an API key.
2. On your computer, in the project folder `cf`, run these two commands and paste
   the values when asked:
   ```
   npx wrangler secret put CALLMEBOT_PHONE
   npx wrangler secret put CALLMEBOT_APIKEY
   ```

**Email (free for 3,000 a month, through Resend):**

1. Sign up at **resend.com** and create an API key.
2. Run:
   ```
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put NOTIFY_EMAIL
   ```
   For `NOTIFY_EMAIL` use the address that should receive alerts.
3. In the hub, open **Settings** and press **Send test alert**.

---

## 5. Turn on the AI team

Seven AI staff are built and waiting: Chief Cosmetics Expert, Senior Cosmetic
Salesperson, Senior Marketer, Senior Accountant, Senior UI Engineer, Senior
Software Engineer and Chief Software Engineer. They answer using your real
numbers: today's bookings, stock levels and prices.

1. Go to **console.anthropic.com**, sign in, open **API keys**, create one.
2. Run:
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
3. Open **AI team** in the hub. The agents turn on.

You pay Anthropic per question asked. A typical question costs a few shillings.

---

## 6. Let clients sign in with Google

1. Go to **console.cloud.google.com**, then **APIs & Services** then
   **OAuth consent screen**. Set it up as **External**, app name
   "Twins Locs Arena", with your email.
2. Open **Credentials**, **Create credentials**, **OAuth client ID**,
   **Web application**.
3. Under **Authorized JavaScript origins** add `https://www.twinslocsarena.com`.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. In the hub open **Settings**, paste it into **Google sign-in Client ID**, save.

---

## 7. Get the site into Google (Search Console)

1. Go to **search.google.com/search-console** and add
   `https://www.twinslocsarena.com` as a **URL prefix** property.
2. Choose the **HTML tag** method. Google shows a code.
3. In the hub open **Settings**, paste that code into
   **Google Search Console code**, and save.
4. Back in Google, press **Verify**.
5. Open **Sitemaps** and submit `sitemap.xml`.

The site already carries the information Google looks for: a description, a
salon listing with your phone numbers and opening hours, prices for the main
services, and a page that loads fast on a phone.

---

## 8. Money settings to review every few months

Open **Settings** in the hub.

- **VAT %** is 16 and prices include VAT. **Watch this trap:** with VAT-inclusive
  prices, a 15% markup leaves you about **nothing** (the hub shows it as a
  negative margin). The default markup is 60%, which leaves about 27% after VAT.
  The products page shows "Left after VAT" for every item, and flags thin ones.
- **Deposit %** is 30 of the service price.
- **Opening hours** are set to all day, every day, so clients can book night
  visits. Change `open` and `close` in Settings if you want to stop that.
- **Discount cap %** is 15. Staff cannot create a bigger offer; management can.
- **Approval over** is KSh 10,000. Any expense at or above it waits for approval.

Every month: count the stock, compare it with **Inventory**, and record any
difference as an **Adjust** move with a note. Then read **Reports** for the
month and check the profit looks right.

---

## 9. Backups

- A full backup is saved automatically every night and the last 30 are kept.
- You can download one at any time: **Security**, then **Download backup**.
- Backups never contain passwords.
- Keep a copy somewhere off the computer, for example in Google Drive.

---

## 10. If something goes wrong

| What you see | What to do |
| --- | --- |
| A member of staff is locked out | They wait a few minutes, or you press **New password** on their row in Employees |
| Someone forgot their password | They use **Forgot password** on `/staff` (needs email working, section 3) |
| A client says the shop shows an old price | Ask them to refresh. The shop reloads prices every two minutes by itself |
| An order was paid twice | The system refuses a repeated M-Pesa reference, so check Payments in the books |
| The AI team says it is not connected | The API key is missing: section 5 |
| Alerts stopped arriving | Open Settings, press **Send test alert**, and check which channel failed |

---

## 11. What the system will not do

- It does not take card or M-Pesa payments automatically. Staff record payments
  by hand after the money arrives.
- It does not file your taxes. The books are kept properly, but a licensed tax
  agent should check them.
- It never stores ID numbers, passport numbers or bank card numbers, and you
  should not type them anywhere in it.
