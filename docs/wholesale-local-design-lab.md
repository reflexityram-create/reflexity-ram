# Reflexity Wholesale Stock — Local Preview

Status: `VERIFIED / LOCAL-ONLY` on 2026-08-25. This branch is an isolated
design and interaction preview. It has not changed or deployed the production
storefront, retail catalog, checkout, API, or database.

## Final product direction

Wholesale remains the existing top-level `/wholesale` destination, using the
same white, black, and Reflexity yellow visual system as the storefront.

- `/shop` remains the regular retail catalog and checkout path.
- `/wholesale` is the buyer-facing home for manually published special stock
  and direct volume requests.
- `/liquidators` remains the inbound path for people selling stock to
  Reflexity.

The earlier dark-green, retail-fed three-concept prototype is superseded. The
final preview is one page with no concept switcher and no regular-shop products.

## Local preview

Run:

```bash
cd /home/life/reflexity-ram-wholesale-lab
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

Open `http://localhost:5173/wholesale-lab`.

The route is development-only. It is loaded only when `import.meta.env.DEV` is
true and is absent from the production bundle.

## Inventory and contact model

The only current wholesale inventory source is
`frontend/src/data/wholesaleLots.js`. It is an intentionally empty, manually
maintained list. A wholesale lot appears only when it has:

- an explicit opaque lot ID;
- `status: "published"`;
- `visibility: "local-demo"` or `"public"`; and
- a verified available quantity at or above its MOQ.

No retail Product API, `useStock`, cart, checkout, Stripe identifier, supplier
identity, cost, or private note enters this page. The empty state is therefore
truthful: until Reflexity manually adds a verified special lot, the page shows
zero live lots and invites the buyer to send a requirement.

Every contact action opens a reviewable Gmail draft addressed to
`reflexityram@gmail.com`. The general form asks for SKU/part number,
specification, quantity, condition, destination, deadline, and company. A
future listed-lot action includes its exact lot ID, MPN, and a quantity bounded
by that lot's MOQ, increment, and available stock. The page never submits an
order or sends a message automatically.

## Future production boundary

When manual posting moves beyond a source-controlled demo, implement a separate
`WholesaleLot` model/API and restricted admin CRUD surface. Do not reuse the
retail `Product` collection: it also drives the regular shop, public catalog,
feed, sitemap, and Stripe-related behavior. The wholesale visibility boundary
must remain fail-closed so a draft or private lot cannot enter either sales
channel accidentally.

## Verification evidence

`VERIFIED / TEST` on 2026-08-25:

- 26 frontend tests pass, including eight wholesale-specific tests for manual
  visibility, empty initial state, MOQ/increment/availability normalization,
  exact email composition, development-only routing, retail-API separation,
  and Reflexity yellow design tokens.
- No new runtime or design dependency was added.
- `npm run verify` passes the frontend suite, 15 runnable backend tests (the
  disposable Atlas integration is intentionally skipped), the production
  build, and secret scanning. Frontend and backend high-severity audits report
  zero vulnerabilities.
- The production bundle contains no local wholesale route, copy, styles, or
  data source.
- Canonical Chrome alias `reflexity` (Profile 6,
  `reflexityram@gmail.com`) renders the light white/yellow page with zero retail
  product links, three correctly addressed contact drafts, no fresh browser
  errors, and no horizontal overflow at desktop or 390 x 844.
