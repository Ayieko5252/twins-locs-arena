# Twins Locs Arena

*Enjoy the beauty in locs.*

A single-page web app for booking loc services and selling loc care products, with an admin panel.

## What's in it

- **Storefront**: loc menu (starter locs, retwists, interlocking, repairs, styling), session booking with time slots and deposit, product shop with bag and checkout (pickup or delivery).
- **Admin panel**: overview (today's sessions, orders to pack, 7-day revenue, low stock), bookings, orders, products (with photo upload and stock), services, and settings.

## Run locally

Open `index.html` in a browser. There's no build step.

## Before going live

This is a prototype:

- Data is saved in the visitor's browser (`localStorage`), so bookings and orders don't reach the owner yet.
- The admin panel has no login.
- Payments (M-Pesa) aren't connected.

Add a backend (database and auth) and a payment integration before taking real bookings.

## Hosting

Deployed on Netlify as a static site. `netlify.toml` publishes the repo root.
