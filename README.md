# Reflexity RAM

Production ecommerce storefront for tested server, desktop, and laptop memory.

- Storefront: https://reflexityram.com
- API: https://reflexity-ram.onrender.com
- Repository: https://github.com/mohammedyusuf123/reflexity-ram

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
catalog API and enrich raw `/shop/:slug` HTML with product-specific title,
description, canonical, and social metadata. The XML must not be replaced by
checked-in product snapshots: stock, price, and availability need to follow
MongoDB automatically.

## Local setup

Requirements: Node.js 22 and npm.

```bash
git clone https://github.com/mohammedyusuf123/reflexity-ram.git
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

### Local wholesale stock concepts

The isolated wholesale design lab contains three responsive inventory and
quote-flow variations. It is development-only and is not included in production
builds. See [docs/wholesale-local-design-lab.md](./docs/wholesale-local-design-lab.md)
for the exact same-origin preview command, product placement recommendation,
data boundary, and verification evidence.

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
- Cloudflare Pages project `reflexity-ram2` builds `frontend/` and discovers
  the file-routed XML and product-metadata Pages Functions.

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
