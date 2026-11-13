# Putting Twins Locs Arena on Google Play

Everything a programmer can do is done. What is left needs your Google account
and your card, so it has to be you. Follow the numbered steps.

The files you will upload are all in the folder `android/play-assets`.

| File | What it is for |
| --- | --- |
| `twins-locs-arena-upload.aab` | The app itself. This is what you upload to Play. |
| `twins-locs-arena-test.apk` | The same app as a file you can install on your own phone first. |
| `store-icon-512.png` | The app icon shown in the store. |
| `feature-graphic-1024x500.png` | The wide banner at the top of the store page. |
| `01-home.png` ... `06-how.png` | Phone pictures of the app. Play wants at least two. |

---

## 1. Try it on your own phone first (10 minutes, free)

1. Copy `twins-locs-arena-test.apk` to your phone, by cable, WhatsApp to
   yourself, or Google Drive.
2. Open it on the phone. Android will ask whether to allow installing from that
   place. Say yes.
3. The app opens the salon with no browser bar at the top, your own black and
   gold icon on the home screen.
4. If a browser address bar does show at the top, that is normal for this test
   copy. It disappears once the app comes from Play, provided you do step 6
   below.

## 2. Open a Play Console account (one payment of 25 US dollars, for life)

1. Go to `https://play.google.com/console` and sign in with the Google account
   you want to own the app.
2. Choose **Create account > Organisation** if you want the salon's name to show
   as the developer, or **Yourself** if you want your own name.
3. Pay the 25 dollars. Google verifies your identity. This can take a day or two.

## 3. Create the app

1. In Play Console press **Create app**.
2. App name: **Twins Locs Arena**
3. Default language: **English (United Kingdom)**
4. App or game: **App**. Free or paid: **Free**.
5. Tick the two declarations and press **Create app**.

## 4. Fill the store listing

Under **Grow > Store presence > Main store listing**, paste the text below.

**App name**

```
Twins Locs Arena
```

**Short description** (80 characters)

```
Book loc sessions, shop loc care and track your visits. Eldoret, open 24/7.
```

**Full description**

```
Twins Locs Arena is a loc salon in Eldoret, Kenya. The app is the salon in your pocket.

BOOK A CHAIR
See every open slot, day or night, and hold the one you want in a few taps. We work around the clock, so a night visit after work is a normal booking, not a favour. You get a reminder before the day comes.

THE LOC MENU
Starter locs, instant locs, microlocs, retwists, interlocking, loc detox, repairs and reattachment, extensions, barrel twists and loc colour. Every service shows its starting price, how long it takes and how often to come back, so nothing is a surprise.

SHOP LOC CARE
The same residue-free wash, rosewater spritz, locking gel and gold cuffs we use in the chair. Order in the app and pick up at the salon or have it delivered.

YOUR OWN ACCOUNT
Your appointments, your past visits, your orders and the offers meant for you, all in one place. Your loc history stays with you.

OUR WORK
Photographs of real clients, shown only when the client has said we may.

WHERE WE ARE
Eldoret, Uasin Gishu. Call or WhatsApp +254 113 394402 or +254 741 569288.

Enjoy the beauty in locs.
```

**App icon:** upload `store-icon-512.png`
**Feature graphic:** upload `feature-graphic-1024x500.png`
**Phone screenshots:** upload at least two of `01-home.png` to `06-how.png`

**Category:** Beauty.
**Contact details:** `support@twinslocsarena.com`, `+254 113 394402`,
website `https://www.twinslocsarena.com`.
**Privacy policy:** `https://www.twinslocsarena.com/privacy`

## 5. Answer Google's questions

- **App content > Privacy policy:** the link above.
- **Data safety:** say the app collects **Name**, **Email address**, **Phone
  number** and **Photos**, all of them **optional**, used for **App
  functionality** and **Account management**, **not shared** with anyone, sent
  **encrypted**, and the user **can ask for deletion** at
  `support@twinslocsarena.com`.
- **Ads:** no ads.
- **Content rating:** answer the questionnaire honestly; a salon booking app
  comes out as suitable for everyone.
- **Target audience:** 18 and over. Do not tick the children options: an app
  built on a website cannot be sold to under-13s under Play's family rules.
- **Government app:** no. **Financial features:** none.

## 6. The one step that must not be missed

Google re-signs your app with its own key when it goes out from Play. The
website has to recognise that key or the app will show a browser address bar
across the top.

1. In Play Console open **Test and release > Setup > App integrity > App
   signing**.
2. Copy the **SHA-256 certificate fingerprint** shown there.
3. Tell me, or paste it into `cf/public/.well-known/assetlinks.json` as a second
   entry in the `sha256_cert_fingerprints` list, keeping the one already there.
4. Deploy the site again (`npm run deploy` inside the `cf` folder).

Until this is done the app still works, it just looks like a browser.

## 7. Send it out

1. **Test and release > Production > Create new release**.
2. Upload `twins-locs-arena-upload.aab`.
3. Release name: `1.0.0`. Release notes: `The first release of the salon app.`
4. **Next**, then **Start roll-out to production**.
5. Google reviews it. First reviews usually take a few days.

---

## When you change the website

The app is the website, so anything you change on the site is in the app the
next time it opens. You only build and upload a new app file when the app's own
settings change, for example its name, its icon, or the address it opens.

To raise the version for a new upload, change `appVersionName` and
`appVersionCode` in `android/twa-manifest.json`, then rebuild.

## The signing key

`android/twinslocsarena.keystore` and `android/keystore-password.txt` are the
keys to this app. They are deliberately kept out of the code repository. Copy
them somewhere safe, for example a password manager or an external drive. If
they are lost you cannot update the app under the same listing.
