# Visit log (visitor IP addresses and more)

The owners can see who visits: **IP address, approximate place, network (ISP or company), device and browser, the pages, and where they came from**,
for reflexityram.com and the StarForge sites, in one log. It is our own (first-party), not Google Analytics.

```
browser (this React app)            Cloudflare Worker `site-visits` (visits.reflexityram.com)        Render API                      browser (admin)
trackVisit() ── text/plain beacon ──▶ adds IP + Cloudflare's place/network + user agent ─▶ D1 table  ◀── GET /api/admin/visits ◀── /admin/visitors
```

- **Collector and storage:** the `site-visits` Worker with a D1 database (Cloudflare account "Reflexity RAM"). Source and README: `/home/life/Workspace/Tools/site-visits`
  (not in this repo). It accepts beacons only from the listed site origins, applies a per-IP rate limit, honours Do Not Track and Global Privacy Control
  on the server too, and deletes rows after 180 days (daily cron).
- **This repo, the browser side:** `frontend/src/lib/analytics.js` `trackVisit()`, called from `AnalyticsTracker` in `App.jsx` after a tick. It uses the
  same gate as GA4 (`shouldTrackLocation`: production host only; not the owner once they have visited `/admin`; not `?analytics=off`; not a QA session; not
  an admin / account / review path) plus Do Not Track and Global Privacy Control, and it does **not** wait for gtag.js, so an ad blocker that stops GA does not
  stop it. The payload is flat and small: safe path (order links become `/order/success`), the product-free page title, the referrer's origin (first report
  of a page load only), `utm_*` tags, language, screen size, time zone and a random id of the tab session (sessionStorage; no cookie, no device id).
  `public/_headers` and `functions-shared/securityHeaders.js` allow `connect-src https://visits.reflexityram.com`.
- **This repo, the server side:** `backend/src/routes/adminVisits.js`, mounted at `/api/admin/visits` (list) and `/api/admin/visits/summary`. Admin sessions
  only (the same guard as the orders list, so the owner's phone app can read it). It forwards a short allow-list of filters (`hours site ip path bots limit`)
  to the collector with the Bearer token held in Render's environment: **`VISITS_API_TOKEN`** (secret; the same value is the Worker's `DASHBOARD_TOKEN` and the
  laptop keyring entry `service=site-visits account=dashboard`) and optionally `VISITS_API_URL` (default `https://visits.reflexityram.com`). Without the token the
  route answers 503 and the page says the log is not connected.
- **Admin page:** `/admin/visitors` (More tab on the phone, sidebar on a desktop): totals, people grouped by IP address (place, network, device, where they came
  from, their pages), top pages / countries / cities / networks / referrers / campaigns, site and period filters, "include bots".
- **Privacy page:** `frontend/src/pages/policies/Privacy.jsx` says what is logged, for how long (180 days), that there is no cookie, and how to opt out
  (`?analytics=off` once, or Do Not Track / Global Privacy Control). Keep it true if the log changes (`frontend/test/visit-log.test.js` checks the words).
- **Off switch:** delete `VISITS_API_TOKEN` on Render (the admin page stops reading it), or remove the `trackVisit(safePath)` line in `AnalyticsTracker` (the
  browser stops reporting), or `wrangler delete site-visits` in the Cloudflare account. The data itself is gone after 180 days; to erase earlier:
  `wrangler d1 execute site-visits --remote --command "DELETE FROM visits"` (optionally `WHERE ip = '...'` to answer a deletion request).
- **Read it from the laptop:** `site-visits recent`, `site-visits summary`, `site-visits ip 1.2.3.4`.

What it cannot see: names, emails, orders, anything typed into a form. An IP address is not a person: shared networks, phones and VPNs mix people, and the place
is Cloudflare's guess from the IP.
