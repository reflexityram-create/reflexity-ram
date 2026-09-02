# Reflexity RAM deployment guide

This guide describes the current production architecture. Never paste live
credentials into this repository, commit them, or include them in screenshots.

## Production topology

```text
reflexityram.com
  Cloudflare Pages project: reflexity-ram
  Root directory: frontend
  Build command: npm ci && npm run build
  Output directory: dist
  Pages Functions: live XML plus crawlable public-route and /shop/:slug HTML

https://reflexity-ram.onrender.com
  Render service root: backend
  Build command: npm ci
  Start command: node src/server.js
  Health check: /api/health

MongoDB Atlas + Stripe + Resend + Cloudinary
  Credentials exist only in provider/deployment environment settings
```

Both deployments track the repository's `main` branch.

Cloudflare's GitHub App must have access to exactly
`reflexityram-create/reflexity-ram`. Keep automatic preview and production
deployments enabled. Do not broaden the installation to every repository just
to clear a dashboard warning.

## 1. Pre-deploy verification

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

An ordinary run intentionally skips the real Atlas transaction test unless its
dedicated safety variables and disposable database are supplied.

## 2. Render backend

Create or update a Web Service with:

- Root directory: `backend`
- Runtime: Node
- Build command: `npm ci`
- Start command: `node src/server.js`
- Health check path: `/api/health`

Set these environment variables in Render, never in Git:

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV=production` | yes | Production error handling |
| `MONGODB_URI` | yes | MongoDB Atlas connection |
| `JWT_SECRET` | yes | JWT signing secret |
| `JWT_EXPIRES_IN=7d` | yes | Session lifetime |
| `ALLOWED_ORIGINS` | yes | Comma-separated Cloudflare origins |
| `FRONTEND_URL=https://reflexityram.com` | yes | Email and checkout return links |
| `RESEND_API_KEY` | yes | Transactional email |
| `FROM_EMAIL` | yes | Verified Resend sender |
| `CLOUDINARY_CLOUD_NAME` | yes | Product image environment |
| `CLOUDINARY_API_KEY` | yes | Product image management |
| `CLOUDINARY_API_SECRET` | yes | Product image management |
| `STRIPE_SECRET_KEY` | yes | Hosted Checkout |
| `STRIPE_WEBHOOK_SECRET` | yes | Webhook signature verification |
| `STRIPE_CURRENCY=cad` | yes | Product, shipping, and feed currency |
| `GOOGLE_CLIENT_ID` | optional | Google sign-in |
| `GOOGLE_CLIENT_SECRET` | optional | Google sign-in |
| `GOOGLE_CALLBACK_URL` | optional | Google OAuth callback |

Do not keep `ADMIN_PASSWORD` or `SEED_SECRET` in production after bootstrap.

Use the narrowest MongoDB Atlas network access compatible with the service.
If a hosting platform's dynamic egress forces a broad temporary rule, pair it
with a least-privilege database user, a unique rotated password, and monitoring.

### Render verification

```bash
curl -fsS https://reflexity-ram.onrender.com/api/health
curl -fsS 'https://reflexity-ram.onrender.com/api/products?page=1&limit=100'
curl -fsS https://reflexity-ram.onrender.com/feed.xml
curl -fsS https://reflexity-ram.onrender.com/sitemap.xml
```

The health response must report `status=ok`, `env=production`, and Stripe
enabled. Confirm catalog counts without printing customer, credential, or order
data.

### Wholesale backend-first release gate

Wholesale administration depends on API routes that older backend deployments
do not have. Release a wholesale change in two phases even though Render and
Cloudflare both track `main`:

1. Push a backend-only commit and wait for the exact Render deployment to become
   live. The simultaneous Pages build is safe because it contains the prior
   frontend.
2. Require `GET /api/wholesale` to return HTTP 200 with `{"lots":[]}` and
   `Cache-Control: no-store`. Require unauthenticated and cookie-only requests to
   `/api/admin/wholesale` to return `401`, and unauthenticated wholesale uploads
   to return `401` before file handling.
3. Recheck the retail product, feed, sitemap, health, and Stripe baselines.
4. Only then push the frontend/docs commit and wait for the exact Cloudflare
   Pages deployment.

Do not save, publish, upload, archive, or restore a wholesale lot during a
deployment smoke test. The authenticated admin workspace and public API must
both remain empty until the owner deliberately adds real stock.

## 3. Stripe

Create a production webhook endpoint:

```text
https://reflexity-ram.onrender.com/api/stripe/webhook
```

Subscribe it to the events handled by the code:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`

Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. Checkout uses
Stripe-hosted pages; the frontend does not require a publishable Stripe key.

Changing `STRIPE_CURRENCY` causes product prices to be resynchronized. Confirm
the website, shipping options, feed, and Stripe Prices use the same currency.

## 4. Resend and Cloudinary

- Verify the sending domain in Resend and use that domain in `FROM_EMAIL`.
- Use a dedicated Cloudinary product environment with a least-privilege key.
- After any credential rotation, verify a controlled email and an image
  upload/delete operation without printing the new credential.
- Old image delivery URLs may remain readable after a migration; that does not
  mean their historical API credentials should remain active.

## 5. Cloudflare Pages

Configure project `reflexity-ram`:

- GitHub owner: `reflexityram-create`
- GitHub repository: `reflexity-ram`
- Production branch: `main`
- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Environment: `VITE_API_URL=https://reflexity-ram.onrender.com/api`

Project `reflexity-ram2` is retained without custom domains as a rollback
resource. Do not use it for normal production deployment.

Cloudflare automatically provides SPA fallback because the build does not ship
a top-level `404.html`. Do not add an external-domain `200` rewrite to
`_redirects`; Pages cannot proxy external domains that way.

The file-routed functions are:

```text
frontend/functions/feed.xml.js
frontend/functions/sitemap.xml.js
frontend/functions/shop/[slug].js
frontend/functions/[[path]].js
```

`public/_routes.json` limits the catch-all function to indexable sitemap
routes. Administrator, account, authentication, cart, checkout, and order
routes must remain outside that manifest. After deployment, require
`X-Reflexity-SEO: static-edge` on a static public route and
`X-Reflexity-SEO: product-edge` plus Product JSON-LD on a live product route.

The XML functions fetch the backend's live XML and return
`X-Reflexity-Source: live-catalog-api`. The product function uses the exact
public product API response to inject raw title, description, canonical, and
social metadata for crawlers. It returns `X-Reflexity-SEO: product-edge`, falls
back to the unchanged app shell if the API is slow or unavailable, and emits a
404 with `noindex` only after the API confirms that a slug does not exist.
`frontend/public/_routes.json` limits Function invocation to those three route
patterns, keeping all other storefront assets static.

Local Pages verification:

```bash
cd frontend
npx wrangler pages dev ./dist --port 8788
curl -i http://127.0.0.1:8788/feed.xml
curl -i http://127.0.0.1:8788/sitemap.xml
curl -i http://127.0.0.1:8788/shop/<current-product-slug>
```

If Pages reports that the repository cannot be accessed, first verify the
GitHub App installation includes the exact repository, then disconnect and
reconnect the Pages source to the owner/repository above. Treat the warning as
resolved only after a new commit passes `clone_repo`, build, and deploy. If
those stages succeed but the banner remains, record it as a contradicted UI
warning rather than breaking a working integration by repeatedly reconnecting
it.

## 6. Post-deploy verification

```bash
curl -fsSI https://reflexityram.com/
curl -fsSI https://reflexityram.com/feed.xml
curl -fsSI https://reflexityram.com/sitemap.xml
curl -fsS https://reflexityram.com/robots.txt
curl -fsS -D - https://reflexityram.com/shop/<current-product-slug>
```

Required checks:

1. Apex homepage returns HTTP 200 and the same hashed JS bundle as the exact
   successful production deployment URL.
2. HTTP redirects to HTTPS.
3. Static and product-edge pages include HSTS and the enforced CSP policy.
4. Feed and sitemap include `X-Reflexity-Source: live-catalog-api`.
5. Feed item count, prices, currency, stock state, and image URLs match the API.
6. Sitemap contains all indexable public routes plus every active product.
7. Every current product's raw HTML has `X-Reflexity-SEO: product-edge`, its
   exact title, an absolute canonical URL, and an absolute social image URL.
8. A definitely absent product slug returns 404 with `noindex` metadata.
9. `/admin` APIs return 401 without an authenticated admin token.
10. `/api/wholesale` returns only complete public quote-only lots, and
    `/api/admin/wholesale` rejects requests without an explicit Bearer token.
11. `/admin/products` has Retail and Wholesale workspaces, both wholesale Add
    shortcuts open the same `/admin/wholesale?new=1` editor, and the public
    wholesale page shows no sample inventory.
12. A disallowed CORS origin receives no access-control permission.
13. The Pages deployment source reads back as GitHub owner
    `reflexityram-create`, repository `reflexity-ram`, branch `main`, with
    automatic deployments enabled.

Do not place a live order merely as a deployment smoke test. Use Stripe test
mode and isolated data for end-to-end payment verification.

## 7. Rollback

- Cloudflare Pages: select the last known-good deployment and roll it back.
- Render: redeploy the last known-good Git commit.
- Database: do not restore or delete records until exact scope and backups are
  verified. Product removal is normally soft deactivation.

After rollback, repeat the public health, feed, sitemap, and catalog probes.
