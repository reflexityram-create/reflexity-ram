# Reflexity RAM

Production ecommerce storefront for tested server, desktop, and laptop memory.

- Storefront: https://reflexityram.com
- API: https://reflexity-ram.onrender.com
- Repository: https://github.com/reflexityram-create/reflexity-ram

## Architecture

| Layer | Current implementation |
|---|---|
| Frontend | React 19, Vite 7, React Router, Zustand, Tailwind CSS |
| API | Node.js, Express 5, Mongoose 9 |
| Database | MongoDB Atlas |
| Payments | Stripe hosted Checkout, Stripe Tax, signed webhooks |
| Email | Resend |
| Images | Cloudinary |
| Hosting | Cloudflare Pages frontend, Render backend |

Cloudflare Pages Functions serve `/feed.xml` and `/sitemap.xml` from the live
catalog API. They also provide crawlable initial HTML, canonical metadata, and
internal links for every public sitemap route; `/shop/:slug` adds live product
metadata and Product structured data from the catalog API. The XML must not be
replaced by checked-in product snapshots: stock, price, and availability need
to follow MongoDB automatically.

GA4 loads only on the canonical production host and excludes administrator,
authentication, lab, and explicitly tagged QA/release traffic. Public funnel
events include product views, add-to-cart, checkout starts, verified purchases,
and wholesale/liquidation leads. Purchase values come only from the backend's
verified paid-order response.

## Local setup

Requirements: Node.js 22 and npm.

```bash
git clone https://github.com/reflexityram-create/reflexity-ram.git
cd reflexity-ram
npm run install:all
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill the local `.env` files with development credentials, then run:

```bash
npm run dev
```

The frontend runs on port 5173 and the API on port 5000 by default.

### Wholesale stock

Wholesale stock is a separate, quote-only inventory system. It does not enter
the retail catalog, cart, checkout, Stripe products, Merchant feed, or retail
product sitemap.

An authenticated administrator can reach the same listing editor in two ways:

- open **Admin → Products → Wholesale lots** to search every draft, published,
  and archived lot, then select **Add wholesale listing**; or
- open the public `/wholesale` page while signed in as an admin and select
  **Add listing** beside the live stock count.

New listings start as private drafts. Publishing requires a complete tested
memory specification, an isolated wholesale image, positive available stock,
and valid internal quantity controls. Those stored controls protect listing
integrity; the customer page does not advertise or enforce a fixed MOQ because
workable wholesale quantities can fluctuate. Archive is reversible and never
hard-deletes the record. No wholesale records are seeded automatically. See
[docs/wholesale-inventory.md](./docs/wholesale-inventory.md) for the data model,
admin workflow, and deployment boundary.

Buyer requests remain email-first. The lot detail page lets a buyer request any
whole-unit quantity up to listed availability and opens a reviewable Gmail draft
addressed to Reflexity with the exact lot, MPN, and requested quantity. Reflexity
confirms what can be accommodated, then the owner may manually forward only the
relevant request information to the cofounder/team member handling the quote.
There is no automated associate handoff, customer intake database, inventory
reservation, payment, or checkout in this workflow.

## Verification

```bash
npm test
npm run build:frontend
npm run scan:secrets
npm audit --prefix frontend
npm audit --prefix backend
```

The first three checks are also available as `npm run verify`.

The real Atlas rollback test is deliberately opt-in and requires a dedicated,
disposable test database:

```bash
npm --prefix backend run test:atlas
```

See the safety guards in `backend/test/atlas-stock-transaction.integration.test.js`
before supplying its environment variables.

## Admin bootstrap

There are no default admin credentials. Set `ADMIN_EMAIL` and a unique
`ADMIN_PASSWORD` of at least 12 characters in `backend/.env`, then run:

```bash
npm run seed
```

Do not enable the HTTP seed route in production unless it is needed for a
single controlled operation. It is disabled whenever `SEED_SECRET` is unset.

## Deployment

Production deploys from `main`:

- Render builds and starts `backend/`.
- Cloudflare Pages project `reflexity-ram` builds `frontend/` and discovers
  the file-routed XML and crawlable-metadata Pages Functions.

The Cloudflare GitHub App is intentionally limited to the canonical
`reflexityram-create/reflexity-ram` repository. Pages tracks `main` with
automatic production and preview deployments enabled. A provider warning is
not a deployment receipt: require a fresh build to clone the expected commit,
finish successfully, and appear on the canonical domain.

See [DEPLOY.md](./DEPLOY.md) for the exact configuration and post-deploy checks.
Current operational evidence and known limitations live in
[PROJECT_STATE.md](./PROJECT_STATE.md).

## Security

- Never commit runtime `.env` files or provider credentials.
- Run `npm run scan:secrets` before every push.
- Rotate any credential that is printed, committed, or otherwise exposed.
- Product deletion is a reversible soft deactivation so order and review
  references remain intact.
- Admin API routes enforce both authentication and the admin role server-side.

Historical audit documents are retained for incident context, but they are not
current deployment instructions.
