# Reflexity Wholesale Stock — Local Admin and Customer Demo

Status: `VERIFIED / LOCAL-ONLY` on 2026-08-25. This isolated branch changes the
local demo and the official `/wholesale` page source, but it has not been
deployed. The live production storefront, retail catalog, checkout, API,
authentication, and database remain unchanged.

## Product placement

Wholesale remains the existing top-level `/wholesale` destination, using the
same white, black, and Reflexity yellow visual system as the storefront.

- `/shop` remains the regular retail catalog and checkout path.
- `/wholesale` is the eventual buyer-facing home for manually published
  special stock and direct volume requests.
- `/liquidators` remains the inbound path for people selling stock to
  Reflexity.

The earlier dark-green, retail-fed prototype is superseded. Retail Product
records never enter the wholesale demo.

## Local routes

Run:

```bash
cd /home/life/reflexity-ram-wholesale-lab
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

Then open:

- `http://localhost:5173/wholesale-admin-lab` — owner-facing Wholesale Stock
  Studio.
- `http://localhost:5173/wholesale` — primary combined customer page with
  published demo stock and exact-SKU sourcing.
- `http://localhost:5173/wholesale-lab` — development-only alias to the same
  customer view.

The admin route, alias, and browser-local customer adapter are loaded only when
`import.meta.env.DEV` is true and are absent from the production bundle.

The shared customer page combines both buyer jobs without making them compete:

- posted stock is the dominant left column and first mobile section;
- a single `Need a specific SKU?` card forms the secondary right rail;
- listed lots each have a specific quote action;
- the sourcing rail has the only general `Get bulk pricing` action; and
- a quiet `/liquidators` link handles people selling stock to Reflexity.

There is no retail-shop cross-link, duplicated wholesale pitch, or second
bottom contact block.

## Admin-to-customer workflow

The Stock Studio can:

- create a special lot;
- save or edit it as a private draft;
- publish it to the customer preview;
- unpublish it back to draft;
- remove the exact local lot; and
- restore the three synthetic examples without removing custom demo lots.

The starting demo contains two published example lots and one draft. Every
example uses a synthetic `DEMO-*` MPN and a visible `LOCAL DEMO` label; none is
a claim about real Reflexity inventory.

The connected customer page renders only records that are:

- explicitly marked `isDemo: true`;
- `status: "published"`;
- `visibility: "local-demo"`; and
- at or above their minimum order quantity.

Publishing or unpublishing in the Studio changes the customer card count on
the next navigation or in another local tab. Drafts never appear to customers.

## Shared market shell and official data boundary

`Wholesale.jsx` owns the reusable buyer-facing presentation. In development,
`WholesaleLab.jsx` is a thin adapter that supplies strictly filtered
browser-local demo lots to that shell, which is why the normal local Wholesale
navigation shows both posted examples and sourcing.

In a production build, `/wholesale` renders the same premium shell using only
public, published records from `WHOLESALE_LOTS`. It does not read local demo
lots or import the demo store. With no authoritative records configured, the
inventory column renders an honest empty state beside the sourcing rail.

## Local persistence boundary

This demo uses the versioned browser-local key
`reflexity.wholesale-lots.local.v1`. The store:

- accepts only an allowlisted lot shape;
- forces demo identity, local-only visibility, and quote-only behavior;
- strips retail prices, `stockQuantity`, Stripe IDs, and unknown fields;
- validates the complete listing and quantity/MOQ relationship before
  publishing;
- repeats complete publish validation before any saved record can appear in
  the customer preview;
- restores seeded example IDs without replacing owner-created local lots;
- fails closed with zero customer-visible lots when saved JSON or its schema
  cannot be read; and
- retains the previous state when a browser write fails.

No Product API, `useStock`, cart, checkout, Stripe, backend mutation, or email
send occurs. Each listed-lot action opens a reviewable Gmail draft to
`reflexityram@gmail.com` with that exact lot ID, MPN, and MOQ-bounded quantity;
the general sourcing action opens a separate structured requirements draft.

Browser storage is appropriate only because this is an explicitly local demo.
It is not authentication and is not an authoritative inventory system.

## Production boundary

A real release requires a separate `WholesaleLot` model/API, authenticated
owner CRUD, explicit publish transitions, audit history, and production-backed
storage. Do not reuse the retail `Product` collection: it also drives the
regular shop, public catalog, feed, sitemap, and Stripe-related behavior.

## Verification evidence

`VERIFIED / TEST` on 2026-08-25:

- 36 frontend tests pass, including local seeding, corrupt-state fail-closed
  behavior, allowlist enforcement, publish validation, round-trip persistence,
  tampered-record filtering, non-destructive example restoration, exact
  removal, write-failure preservation, route separation, customer filtering,
  quote composition, inventory-first composition, official/local separation,
  and white/yellow token checks.
- The canonical `reflexity` Chrome profile exercised a published lot becoming a
  draft (`2 -> 1` customer cards), restored the examples, then created and
  published a new lot (`2 -> 3` customer cards) without any alert or overflow.
- The three example lots were restored after the interaction test so the demo
  opens in its intended starting state.
- `npm run verify` passes 36 frontend tests, 15 runnable backend tests (the
  disposable Atlas integration is intentionally skipped), the Vite production
  build, and secret scanning. Frontend and backend high-severity audits report
  zero vulnerabilities.
- The production bundle contains no local demo route, adapter, synthetic MPN,
  demo-store hook, or browser-store key, while retaining the shared official
  market shell.
- Admin and customer layouts have zero horizontal overflow at desktop and
  390 x 844, and the checked browser log contains no warning/error entries.
- The combined `/wholesale` page rendered inventory first and sourcing second:
  two stock columns plus a sticky 352px sourcing rail at 1920 x 1112, and one
  350px stock column followed by a 350px sourcing card at 390 x 844.
