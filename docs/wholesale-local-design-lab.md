# Reflexity Wholesale Stock — Local Design Lab

Status: `VERIFIED / LOCAL-ONLY` on 2026-08-25. This branch is a design and
interaction prototype. It has not changed or deployed the production
storefront, catalog, checkout, or database.

## Product placement decision

Wholesale stock belongs under the existing top-level `/wholesale` destination.
That route already communicates buying from Reflexity in volume, while:

- `/shop` remains the retail catalog and checkout path;
- `/liquidators` remains the inbound path for people selling stock to
  Reflexity; and
- `/wholesale` becomes the buyer-facing wholesale hub, with current stock
  directly below a compact introduction.

The recommended public composition is the **Inventory board** as the default,
the **Stock gallery** as a visual/card view, and the **Quote workbench** as the
multi-SKU interaction. They are three views of one wholesale destination, not
three new top-level navigation items.

## Local concepts

Open `http://localhost:5173/wholesale-lab` after starting the frontend. The
concept switcher provides:

1. **Inventory board** (`?concept=board`) — dense part-number and specification
   comparison for buyers who arrive with an exact requirement.
2. **Stock gallery** (`?concept=market`) — image-led cards for buyers who want
   to browse the available modules.
3. **Quote workbench** (`?concept=workbench`) — local multi-SKU selection,
   quantity controls, and one prefilled Gmail draft for review.

The workbench does not send a message or create an order. It only builds a
reviewable draft after the buyer selects stock.

## Exact run command

The public production API intentionally rejects localhost browser origins. The
lab therefore uses Vite's same-origin development proxy:

```bash
cd /home/life/reflexity-ram-wholesale-lab
VITE_API_URL=/api \
VITE_API_PROXY_TARGET=https://reflexity-ram.onrender.com \
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

No provider secret or local backend is needed for this read-only preview.

## Data and production boundary

- The preview reads only the existing public `/api/products?limit=100`
  response through `useStock`.
- It shows exact current catalog fields: brand, MPN, SKU, capacity,
  generation, speed, form factor, condition, warranty, image, and visible
  stock quantity.
- It deliberately does not present retail catalog prices as wholesale prices,
  promise volume discounts, or claim MOQ/tier terms that do not exist yet.
- It has no product mutation, cart, checkout, wholesale-record, or message-send
  path.
- The route is loaded only when `import.meta.env.DEV` is true. A production
  build contains neither the route nor the lab component/CSS.

The current `Product` model feeds the public retail API, feed, sitemap, and
Stripe-related catalog behavior. Before real wholesale-only lots are entered,
production needs a separate `WholesaleLot` model/API (or an equivalently
fail-closed sales-channel boundary) with explicit fields such as lot identity,
available quantity, minimum/increment rules, quote status, and visibility.
Wholesale-only stock must not silently enter the retail `Product` flow.

## Verification evidence

`VERIFIED / TEST`:

- 25 frontend tests pass, including stock filtering, filter-independent quote
  selections, quantity ceilings, outage-safe stock copy, multi-SKU quote
  composition, the development-only route, and absence of catalog-write/cart
  paths.
- The Vite production build succeeds, and a content scan confirms the
  wholesale lab is absent from `frontend/dist`.
- Chrome Profile 6 (`reflexity`, `reflexityram@gmail.com`) loaded all five
  current public listings and 45 visible units through the local proxy.
- Desktop and 390 × 844 responsive checks passed without horizontal overflow
  or broken product images.
- Mobile table headings remain in the accessibility tree, repeated quantity
  controls name their exact MPN/SKU, and catalog failures withhold totals rather
  than claiming genuine zero stock.
- Board filters/search, concept switching, quote selection, quantity changes,
  and the generated Gmail draft URL were exercised without submitting data.
- No new runtime or design dependency was added.

## Design basis

The spec-first board and quote-list interaction follow established B2B patterns:
complex electronics benefit from table comparison, while business buyers need
quantity rules and quick-order/quote workflows. Useful references are Shopify's
[B2B quantity and volume-pricing model](https://help.shopify.com/en/manual/b2b/catalogs/quantity-pricing),
[B2B quick-order customization](https://help.shopify.com/en/manual/b2b/store-customization),
and Baymard's research on [product lists](https://baymard.com/research/ecommerce-product-lists)
and [B2B product tables](https://baymard.com/ecommerce-design-examples/product-table).
