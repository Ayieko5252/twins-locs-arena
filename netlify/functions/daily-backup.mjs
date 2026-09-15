// Runs once a day on Netlify: saves a full copy of the data under backups/<date>,
// keeps the last 30 copies, and trims visit counts older than 120 days.

import { storeFor, snapshot, localToday, addDays } from "../lib/store.mjs";

export default async (req, context) => {
  const store = storeFor(context);
  const snap = await snapshot(store);
  const today = localToday(snap.catalog.settings.timezone);
  await store.setJSON(`backups/${today}`, snap);

  const [{ blobs: backups }, { blobs: daily }] = await Promise.all([store.list({ prefix: "backups/" }), store.list({ prefix: "daily/" })]);
  const keepFrom = addDays(today, -30), visitsFrom = addDays(today, -120);
  const old = [
    ...backups.filter((b) => b.key.slice(8) < keepFrom).map((b) => b.key),
    ...daily.filter((b) => b.key.split("/")[1] < visitsFrom).map((b) => b.key),
  ];
  for (let i = 0; i < old.length; i += 50) await Promise.all(old.slice(i, i + 50).map((k) => store.delete(k)));

  console.log(`Backup ${today}: ${snap.bookings.length} bookings, ${snap.orders.length} orders, ${snap.customers.length} customers; removed ${old.length} old entries`);
};

export const config = { schedule: "@daily" };
