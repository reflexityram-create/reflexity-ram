# Owner phone app: alerts and sign-in

The owner's Android phone runs a small app (`android-admin/`) that is always signed in to the admin panel and shows a
notification for every order, payment, refund and quote request. This file describes the server side.

## Pieces

| What | Where |
| --- | --- |
| Alert rows (`admin_events`, TTL 14 days) | `backend/src/models/AdminEvent.js`, written by `utils/adminEvents.js#recordAdminEvent` |
| Paired phones (`admin_devices`) and one-time pairing codes (`device_pairings`, TTL) | `models/AdminDevice.js`, `models/DevicePairing.js` |
| The phone's API | `routes/device.js`, mounted at `/api/device` **before** the site-wide rate limiter (`server.js`) |
| Pairing/removal UI and API | Admin > Security > "Phone app", `routes/adminDevices.js` at `/api/admin/devices` |
| Device-token check | `middleware/deviceAuth.js` |

## How a phone is paired and stays signed in

1. An admin presses **Pair a phone** (Security page): `POST /api/admin/devices/pairing` returns a code like `K7QM-2XVD`. It is stored hashed,
   works once and expires in 10 minutes.
2. The app sends it to `POST /api/device/pair` and receives a **device token** (`rfxd_` + 32 random bytes). The server keeps only its SHA-256.
3. `POST /api/device/session` (Bearer device token) returns a 24 hour admin JWT that carries `dev: <device id>`. The app puts it in the web view's
   `localStorage.rfx_token`, so the admin site loads already signed in. The app asks for a new one whenever it is opened and every few hours.
4. **Removing** a phone (Security page, or `DELETE /api/admin/devices/:id`) sets `revokedAt`: its device token stops working and
   `middleware/auth.js` rejects the sessions it minted on their next request. Changing the admin password, or demoting/deactivating the
   admin, bumps `authVersion` and ends every paired phone too.

## Alerts

`GET /api/device/events?after=<id>&wait=25` is a long poll. Without `after` it returns only a cursor ("from now"), so a new phone is not flooded.
With `after` it returns newer events oldest-first; if there are none it holds the request open up to 30 s and answers the moment
`recordAdminEvent` writes one (`eventWaiter`). Alert text carries order numbers, amounts and item names only, never a customer's
name, email, phone or address (it is shown on a lock screen).

Events written today: `order.paid`, `order.refunded`, `order.partial_refund`, `order.shipped`, `order.delivered`, `order.oversold`,
`lead.new`, `review.new`, `test`. Payment-method events are listed in `docs/payments.md`.

Add one anywhere with:

```js
await recordAdminEvent({ type: 'order.paid', title: 'New order, paid', body: describeOrder(order), priority: 'high', order });
```

It never throws and skips the write when MongoDB is not connected.

## Operations

- Render's free plan sleeps when idle. A phone that is on polls every ~30 s, which also keeps the API awake (no cold start for shoppers).
- Limits: 600 requests / 15 min per IP on `/api/device`, 10 pairing attempts / 15 min per IP, at most 5 paired phones and 5 open codes per admin.
- Tests: `backend/test/phone-app-api.test.js`, `frontend/test/phone-app.test.js`.
