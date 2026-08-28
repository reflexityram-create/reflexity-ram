# Reflexity Wholesale Inventory

Updated: 2026-08-28

## Product boundary

Wholesale is a separate quote-only inventory plane for manually posted special
stock. It does not use the retail `Product` model and cannot enter the cart,
checkout, Stripe, orders, Merchant feed, or retail product sitemap.

The buyer-facing route is `/wholesale`. It lists only complete records that are
simultaneously `published`, `public`, not archived, and `quoteOnly: true`. When
there is no live stock, the page shows an honest empty state beside the existing
exact-SKU sourcing form.

## Buyer request and team handoff

The live lot detail page displays an optional CAD unit price when one is listed,
but remains a request-for-quote surface. A buyer may request any whole-unit
quantity from 1 through the currently listed available stock. The page does not
display or enforce a fixed customer MOQ or order increment; it says Reflexity
will confirm what quantity can be accommodated because workable quantities can
fluctuate.

The action opens a reviewable Gmail compose URL addressed to
`reflexityram@gmail.com`. Its subject identifies the MPN, and its body includes
the lot ID, MPN, exact requested quantity, and an explicit request for Reflexity
to confirm what it can accommodate. Opening the draft does not send an email,
reserve inventory, create an order, or call checkout or Stripe.

Current operating decision: buyer communication remains email-first and manual.
The owner reviews each request received by Reflexity and may forward only the
relevant information to the cofounder/team member helping handle that quote.
There is no public associate phone number, automatic forwarding, lead form, CRM
record, or separate consent workflow in the current product. Do not add those
surfaces unless the operating decision changes and the exact data destination
and customer disclosure are defined.

## Admin workflow

Both owner entry points open the same protected editor:

1. **Admin → Products → Wholesale lots** shows the complete technical workspace
   with draft, published, and archived records. The Retail Products page also
   exposes **Manage all** and **Add wholesale listing** shortcuts.
2. An authenticated administrator viewing `/wholesale` sees **Manage** and
   **Add listing** beside the public stock count.

The shared editor is addressed by `/admin/wholesale?new=1` for a new draft and
`/admin/wholesale?edit=<id>` for an existing lot. Browser Back closes it. The
dialog is portalled outside the signed-in application root so that the complete
background shell can become inert and `aria-hidden`. It traps keyboard focus,
keeps status and error announcements inside the live dialog, restores focus on
Cancel, Escape, and Browser Back, and becomes full-width on small screens.

New work always starts as a private draft. The administrator can save an
incomplete draft, but publishing requires:

- title, brand, MPN/SKU, generation, form factor, capacity, speed, condition,
  testing status, warranty, and ship-from location;
- one image uploaded to the isolated `reflexity-ram/wholesale/` Cloudinary
  folder;
- at least one available unit;
- a positive minimum order and order increment; and
- available quantity greater than or equal to the minimum order.

`minimumOrderQuantity` and `orderIncrement` remain internal publication/data
integrity controls. They are not presented as a fixed customer promise and do
not round the quantity placed in the buyer's quote-request email.

Unpublish returns a live lot to a private draft. Archive is a reversible soft
transition; restore returns the record to a draft. Every edit and transition
uses the current record version, so a stale browser receives `409` and reloads
instead of overwriting newer work.

## API and storage

MongoDB model: `backend/src/models/WholesaleLot.js`

Durable media ownership model: `backend/src/models/WholesaleMediaAsset.js`

Each lot image public ID has at most one lot owner, and each registry public ID
is unique. Both indexes are initialized before the API starts accepting traffic.
Registry records move through `available`, `claiming`, `attached`, `deleting`,
and `deleted` states with bounded leases so concurrent save/delete operations
cannot both win.

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

The Authorization header is authoritative whenever supplied. A malformed or
rejected bearer never falls back to a valid browser cookie. The frontend clears
expired or malformed persisted auth from both storage and in-memory state and
propagates logout to other open tabs.

Wholesale uploads use `POST /api/upload/wholesale` and
`DELETE /api/upload/wholesale/:publicId`. Retail and wholesale media folders
cannot delete across each other. Uploads use cryptographic UUID public IDs and
Cloudinary overwrite is disabled. The API refuses to delete an attached image,
and publication requires the exact registry asset, exact URL, and exact owning
lot. A published lot must be unpublished before its image can change.

Ambiguous Mongo or Cloudinary results preserve their ownership/deletion lease
instead of assuming failure and deleting a possibly committed asset. Cloudinary
deletion retries idempotently. A write that resumes after its claim expired or
was deleted remains private and cannot publish. The editor cleans unattached
uploads on remove, replace, cancel, Escape, Back, or unmount; it detaches an old
saved image before attempting media deletion.

## Zero-listing and deployment rules

There is no wholesale seed hook, sample record, startup writer, or retail-data
fallback. A deployment must begin and end with zero wholesale lots and zero
wholesale media registry records unless an administrator deliberately uploads
or saves a listing.

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

## Post-release acceptance

For a customer-facing quantity change, verify the exact production lot rather
than only the deployment receipt:

1. The displayed CAD price and available stock still match the public API.
2. The picker accepts 1 and the listed maximum, and does not show a customer MOQ.
3. An intermediate quantity changes both the visible request button and the
   `Requested quantity` line in the Gmail draft URL.
4. The draft asks Reflexity to confirm what quantity it can accommodate.
5. No cart, checkout, order, inventory reservation, or Stripe path is invoked.
