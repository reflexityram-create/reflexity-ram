# Reflexity

Wholesale and bulk computer-memory and IT-hardware website for buyers and
sellers. The public site is a quote-based B2B catalog, not a direct-to-consumer
ecommerce storefront.

- Storefront: https://reflexityram.com
- API: https://reflexity-ram.onrender.com
- Repository: https://github.com/reflexityram-create/reflexity-ram

## Public experience

The primary public routes are:

- `/inventory` and `/inventory/:slug` — catalog visibility and part-number
  availability enquiries
- `/wholesale` — supply relationships for resellers, refurbishers, MSPs,
  system integrators, and other hardware businesses
- `/sell-to-us` — bulk hardware acquisition enquiries
- `/contact` — buyer, seller, and general quote requests

Legacy `/shop`, `/shop/:slug`, `/categories`, `/liquidators`, `/support`, and
`/business-info` URLs permanently redirect to their B2B replacements. The
retail Merchant/RSS/CSV feeds at `/feed.xml` and `/feed.csv` deliberately
return `410 Gone` with `Cache-Control: no-store`; they must not be restored as
consumer product feeds without an explicit business decision.

`POST /api/leads` accepts a JSON quote enquiry with a stable UUID `requestId`,
`intent` (`buy`, `sell`, or `general`), name, email, and product type. Optional fields cover company,
phone, manufacturer, part number, specification, quantity, condition,
location, and notes. A filled `website` honeypot is accepted without sending
mail. Valid enquiries are sent internally through Resend to `LEADS_TO_EMAIL`
(or `reflexityram@gmail.com`) and are not stored, auto-replied to, or treated
as orders. Delivery uses the request ID as the Resend idempotency key and has a
12-second provider wait bound; lead requests are separately limited to eight
per IP per hour.

## Architecture

| Layer | Current implementation |
|---|---|
| Frontend | React 19, Vite 7, React Router, Zustand, Tailwind CSS |
| API | Node.js, Express 5, Mongoose 9 |
| Database | MongoDB Atlas |
| Email | Resend |
| Images | Cloudinary |
| Hosting | Cloudflare Pages frontend, Render backend |

Cloudflare Pages Functions provide crawlable B2B metadata and initial HTML for
the public routes. `/inventory/:slug` emits Product structured data for the
catalog item, deliberately without `Offer`, price, or purchase-availability
data. `/sitemap.xml` follows the live catalog and B2B routes. The edge feed
proxy preserves the backend's intentional `410` response.

Stripe, cart, checkout, order, Google OAuth, and product-management backend code remain as
historical/admin infrastructure and are not deleted by this conversion. They
are not part of the public wholesale purchase flow. Do not remove production
data or provider resources as part of a frontend positioning change.

Stale public cart requests and checkout-session creation return `410 Gone` with
`Cache-Control: no-store`. Stripe webhooks and historical/admin order paths
remain mounted for retained records and provider reconciliation.

## Local setup

Requirements: Node.js 22 and npm.

```bash
git clone https://github.com/reflexityram-create/reflexity-ram.git
cd reflexity-ram
npm run install:all
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run dev
```

Set local development values only in `.env` files. The frontend runs on port
5173 and the API on port 5000 by default.

## Verification

```bash
npm test
npm run build:frontend
npm run scan:secrets
git diff --check
```

The first three checks are also available through `npm run verify`. The
disposable Atlas transaction test remains opt-in:

```bash
npm --prefix backend run test:atlas
```

## Deployment

Production deployments track `main`: Render builds `backend/`, and Cloudflare
Pages builds `frontend/`. No domain, DNS, billing, provider credential, or
authentication setting should be changed for a normal release. See
[DEPLOY.md](./DEPLOY.md) for environment variables, deployment topology, and
post-deploy checks.

## Security

- Never commit runtime `.env` files or provider credentials.
- Run `npm run scan:secrets` before every push.
- Keep `LEADS_TO_EMAIL`, `RESEND_API_KEY`, and `FROM_EMAIL` in deployment
  settings, not Git.
- Product deletion remains a reversible soft deactivation so historical order
  and review references are retained.
- Admin API routes enforce authentication and the admin role server-side.
