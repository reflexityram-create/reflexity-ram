# Reflexity Wholesale Inventory

Updated: 2026-08-25

## Product boundary

Wholesale is a separate quote-only inventory plane for manually posted special
stock. It does not use the retail `Product` model and cannot enter the cart,
checkout, Stripe, orders, Merchant feed, or retail product sitemap.

The buyer-facing route is `/wholesale`. It lists only complete records that are
simultaneously `published`, `public`, not archived, and `quoteOnly: true`. When
there is no live stock, the page shows an honest empty state beside the existing
exact-SKU sourcing form.

## Admin workflow

Both owner entry points open the same protected editor:

1. **Admin → Products → Wholesale lots** shows the complete technical workspace
   with draft, published, and archived records. The Retail Products page also
   exposes **Manage all** and **Add wholesale listing** shortcuts.
2. An authenticated administrator viewing `/wholesale` sees **Manage** and
   **Add listing** beside the public stock count.

The shared editor is addressed by `/admin/wholesale?new=1` for a new draft and
`/admin/wholesale?edit=<id>` for an existing lot. Browser Back closes it. The
dialog traps keyboard focus, restores focus on close, and becomes full-width on
small screens.

New work always starts as a private draft. The administrator can save an
incomplete draft, but publishing requires:

- title, brand, MPN/SKU, generation, form factor, capacity, speed, condition,
  testing status, warranty, and ship-from location;
- one image uploaded to the isolated `reflexity-ram/wholesale/` Cloudinary
  folder;
- at least one available unit;
- a positive minimum order and order increment; and
- available quantity greater than or equal to the minimum order.

Unpublish returns a live lot to a private draft. Archive is a reversible soft
transition; restore returns the record to a draft. Every edit and transition
uses the current record version, so a stale browser receives `409` and reloads
instead of overwriting newer work.

## API and storage

MongoDB model: `backend/src/models/WholesaleLot.js`

Public API:

- `GET /api/wholesale` — safe public projection only, maximum 100 live lots,
  `Cache-Control: no-store`.

Admin API (explicit Bearer token, active user, and admin role required):

- `GET /api/admin/wholesale?page=<n>&limit=<1..100>&status=<status>`
- `GET /api/admin/wholesale/:id`
- `POST /api/admin/wholesale`
- `PATCH /api/admin/wholesale/:id`
- `POST /api/admin/wholesale/:id/publish`
- `POST /api/admin/wholesale/:id/unpublish`
- `DELETE /api/admin/wholesale/:id` to archive
- `POST /api/admin/wholesale/:id/restore`

The admin workspace follows pagination until it has loaded every record, then
searches and filters the complete set locally.

Wholesale uploads use `POST /api/upload/wholesale` and
`DELETE /api/upload/wholesale/:publicId`. Retail and wholesale media folders
cannot delete across each other. The API refuses to delete a wholesale image
while any wholesale lot still references it. The editor cleans up unattached
uploads on remove, replace, cancel, Escape, Back, or unmount; it detaches an old
saved image before attempting media deletion.

## Zero-listing and deployment rules

There is no wholesale seed hook, sample record, startup writer, or retail-data
fallback. A deployment must begin and end with zero wholesale records unless an
administrator deliberately saves a listing.

Production uses Render for the backend and Cloudflare Pages for the frontend.
Deploy backend support first, then verify `GET /api/wholesale` returns
`{"lots":[]}` and the admin surface is protected. Only then deploy the frontend.
Do not press Save, Publish, Upload, Archive, or Restore during deployment smoke
tests.

After each phase, recheck the unchanged retail baseline: health is production
with Stripe enabled, five active retail products, five CAD feed items, and 24
sitemap URLs. The production bundle must contain no local demo lot identifiers,
browser-store key, or development-only Stock Studio route.

The older browser-local Stock Studio remains a development-only visual fixture.
It is excluded from production builds and is never an authoritative source for
the real `/wholesale` route.
