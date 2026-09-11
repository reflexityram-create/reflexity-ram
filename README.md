# Reflexity

Tested Server RAM and IT-hardware storefront for individual buyers, businesses,
and wholesale customers. Consumer and laptop RAM records remain in the managed
inventory but are not publicly exposed.

- Storefront: https://reflexityram.com
- API: https://reflexity-ram.onrender.com
- Repository: https://github.com/reflexityram-create/reflexity-ram

## Public experience

The primary public routes are:

- `/shop` and `/shop/:slug` — tested Server RAM catalog and product details
- `/categories` — the public Server RAM category
- `/wholesale` and `/wholesale/:lotId` — small and bulk lot quote requests
- `/liquidators` — IT asset liquidation and ITAD intake
- `/guides`, `/support`, and policy routes — buyer information and support
- `/cart`, `/checkout`, and `/account` — retained storefront account and order flow

The public catalog and product metadata expose only products whose exact
`line` is `Server`. This is a visibility rule, not a deletion or migration:
consumer and laptop inventory remains available to authorized administration.
Wholesale lots remain separate from the retail catalog and continue through the
quote/acquisition lead path.

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

Cloudflare Pages Functions provide crawlable metadata and initial HTML for
public Server RAM, product, and wholesale routes. Product pages retain their
normal price and purchase metadata; `/sitemap.xml` and the catalog feeds follow
the publicly exposed Server-line products and public routes.

Cart, checkout, orders, Google OAuth, ITAD/Liquidation, wholesale leads, and
product-management code remain active application infrastructure. Do not remove
production data or provider resources when narrowing public catalog visibility.

Stripe webhooks, order history, and admin access remain mounted for retained
records and provider reconciliation. The public checkout flow must be verified
against the live API before release; documentation must not describe it as
retired unless the API read-back confirms that state.

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
