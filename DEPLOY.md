# Reflexity deployment guide

The public Reflexity website is a quote-based wholesale/B2B hardware catalog.
Normal releases do not change domains, DNS, billing, provider credentials, or
authentication configuration.

## Production topology

```text
reflexityram.com
  Cloudflare Pages project: reflexity-ram
  Root directory: frontend
  Build command: npm ci && npm run build
  Output directory: dist
  Pages Functions: crawlable B2B metadata, redirects, sitemap, retired-feed proxy

https://reflexity-ram.onrender.com
  Render service root: backend
  Build command: npm ci
  Start command: node src/server.js
  Health check: /api/health

MongoDB Atlas + Resend + Cloudinary
  Credentials exist only in provider/deployment environment settings
```

Both deployments track the repository's `main` branch. Cloudflare's GitHub App
must remain limited to `reflexityram-create/reflexity-ram`.

## Pre-deploy verification

From the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm test
npm run build:frontend
npm run scan:secrets
npm audit --prefix frontend
npm audit --prefix backend
git diff --check
```

The real Atlas transaction test remains opt-in and requires a dedicated
disposable database.

## Render backend

Configure the Web Service with root directory `backend`, build command `npm ci`,
start command `node src/server.js`, and health check `/api/health`.

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV=production` | yes | Production errors |
| `MONGODB_URI` | yes | MongoDB Atlas |
| `JWT_SECRET` | yes | Existing admin/session infrastructure |
| `JWT_EXPIRES_IN=7d` | yes | Existing session lifetime |
| `ALLOWED_ORIGINS` | yes | Allowed browser origins |
| `FRONTEND_URL=https://reflexityram.com` | yes | Existing application links |
| `RESEND_API_KEY` | yes | Quote-enquiry delivery |
| `FROM_EMAIL` | yes | Verified Resend sender |
| `LEADS_TO_EMAIL` | no | Internal lead recipient; defaults to Reflexity mailbox |
| `CLOUDINARY_CLOUD_NAME` | yes | Existing product image delivery |
| `CLOUDINARY_API_KEY` | yes | Existing product image management |
| `CLOUDINARY_API_SECRET` | yes | Existing product image management |
| `STRIPE_SECRET_KEY` | existing only | Retained historical/admin payment infrastructure |
| `STRIPE_WEBHOOK_SECRET` | existing only | Retained historical webhook validation |
| `STRIPE_CURRENCY` | existing only | Retained historical pricing configuration |
| `GOOGLE_CLIENT_ID` | existing only | Existing Google sign-in |
| `GOOGLE_CLIENT_SECRET` | existing only | Existing Google sign-in |
| `GOOGLE_CALLBACK_URL` | existing only | Existing Google OAuth callback |

Do not add a lead database, attachment handling, or automatic lead response as
part of deployment. `POST /api/leads` has an additional 8 requests/hour/IP
limit and sends internal mail only after Resend accepts it. Do not retain
`ADMIN_PASSWORD` or `SEED_SECRET` in production after bootstrap.

Use the narrowest MongoDB Atlas network access compatible with Render. If
dynamic egress requires a temporary broad rule, pair it with a least-privilege
database user, a unique rotated password, and monitoring.

Stripe remains for historical/admin operations only. Keep the existing
`/api/stripe/webhook` endpoint subscribed to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, and
`charge.refunded`; retain its signing secret. Do not create public checkout
sessions as a release probe: the public creation endpoint intentionally returns
`410 Gone`.

## Cloudflare Pages

Configure the `reflexity-ram` project with production branch `main`, root
directory `frontend`, build command `npm ci && npm run build`, output `dist`,
and `VITE_API_URL=https://reflexity-ram.onrender.com/api`.

The public Pages Functions are:

```text
frontend/functions/[[path]].js
frontend/functions/inventory/[slug].js
frontend/functions/shop/[slug].js
frontend/functions/wholesale/[lotId].js
frontend/functions/feed.xml.js
frontend/functions/feed.csv.js
frontend/functions/sitemap.xml.js
```

`/inventory/:slug` and `/wholesale/:lotId` supply canonical B2B metadata and Product JSON-LD without
`Offer`, price, or purchase availability. Legacy `/shop`, `/shop/:slug`,
`/categories`, `/liquidators`, `/support`, and `/business-info` paths receive permanent edge
redirects. `/feed.xml` and `/feed.csv` are intentionally `410 Gone` because
consumer Merchant/RSS/CSV feeds are retired. The sitemap uses `/inventory` and
`/inventory/:slug` rather than `/shop` paths.

For a local Pages probe after a production build:

```bash
cd frontend
npx wrangler pages dev ./dist --port 8788
curl -i http://127.0.0.1:8788/inventory/<current-product-slug>
curl -i http://127.0.0.1:8788/wholesale/<published-lot-id>
curl -i http://127.0.0.1:8788/feed.xml
```

If Pages loses repository access, first verify the Cloudflare GitHub App is
restricted to `reflexityram-create/reflexity-ram`; reconnect that exact source
only if an actual clone/build/deploy fails. Do not broaden the app installation
or replace the source merely to clear a stale dashboard warning.

## Post-deploy verification

```bash
curl -fsSI https://reflexityram.com/
curl -sSI https://reflexityram.com/inventory
curl -sSI https://reflexityram.com/shop
curl -sSI https://reflexityram.com/liquidators
curl -sSI https://reflexityram.com/support
curl -sSI https://reflexityram.com/business-info
curl -sS -D - https://reflexityram.com/feed.xml
curl -fsS https://reflexityram.com/sitemap.xml
curl -fsS https://reflexity-ram.onrender.com/api/health
```

Require the following read-backs:

1. The homepage, inventory, wholesale, sell-to-us, contact, about, guides, and
   legal routes return the expected crawlable content.
2. Legacy routes return `308` to their B2B replacements, preserving query
   strings.
3. `/feed.xml` returns `410` with `Cache-Control: no-store`; do not treat that
   status as an incident.
4. The sitemap contains `/inventory` and active `/inventory/:slug` URLs, and
   contains no `/shop` URL.
5. An inventory detail response includes `X-Reflexity-SEO: product-edge`, an
   `/inventory/:slug` canonical, and Product JSON-LD with no Offer, price, or
   purchase availability fields.
6. A controlled, non-production lead test is accepted only after Resend accepts
   it; do not send a real enquiry merely to smoke-test production.
7. Health reports `status=ok`, and a disallowed CORS origin receives no access
   permission.

## Two-phase release gate

Release a backend contract change before the frontend that depends on it:

1. Push the backend-only commit and wait for the exact Render deployment to be
   live. Verify `/api/health`, `/api/wholesale`, a known public
   `/api/wholesale/:lotId`, unauthenticated admin-route rejection, lead-limit
   headers, and the intentional `410` cart/checkout responses.
2. Push the frontend and Pages-function commit only after that readback. Verify
   the production bundle, B2B redirects, sitemap lot URLs, inventory and
   wholesale metadata, and quote submissions with a non-production recipient.

## Retained operational infrastructure

Public consumer commerce is retired, but existing Stripe webhooks, historical
orders, administrative order tooling, product administration, and Google OAuth
remain operational infrastructure. Do not delete Stripe products, prices,
webhooks, customer/order records, Google OAuth credentials, or administrative
access during this conversion. `/api/cart` and
`/api/stripe/create-checkout-session` are intentionally retired at the public
API boundary; Stripe webhook and historical order processing are not.

## Rollback

- Cloudflare Pages: select the last known-good deployment.
- Render: redeploy the last known-good Git commit.
- Database: do not restore or delete product, order, cart, Stripe, or other
  historical records without exact scope and backups.

`reflexity-ram2` remains a no-custom-domain Cloudflare rollback resource; do
not use it for normal production releases. Source recovery must keep the exact
GitHub owner, repository, production branch, and automatic deployments above.

After rollback, repeat the health, redirect, retired-feed, sitemap, inventory,
and lead-path checks.
