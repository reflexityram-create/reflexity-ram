# RAM listing playbook

Use this playbook for all eBay and Reflexity RAM catalog/listing work. It is a
route and verification guide, not a source of product facts: resolve the exact
MPN, condition, capacity, quantity and live prices before changing a listing.

## Fast, isolated navigation

Run the helper from this repository. It opens its own agent workspace and one
task-owned tab; it never claims a user tab or a tab belonging to another job.

```bash
ram-browser ebay active
ram-browser ebay drafts
ram-browser ebay create
ram-browser ebay item 800789256171
ram-browser ebay revise 800789256171
ram-browser reflexity admin-products
ram-browser reflexity create
ram-browser reflexity product 6acd9f590fc6347f1eec8efd
```

Use `ram-browser --dry-run ...` first when checking a route. The helper binds
eBay to exact Chrome alias `yusuf` and the storefront admin to exact alias
`reflexity`; it uses `seat-for --or-copy`, so a busy profile receives an
isolated scratch copy instead of another agent's browser. It checks that exact
lane before every browser batch, reuses its unique task-owned starter tab and prints its
`when_done` command. Run that exact command after the readback; it releases the
lane and closes the owned workspace. Do not take a global lease, use raw CDP,
or reuse a browser handle after navigation.

The URLs are intentionally limited to verified routes:

- eBay active and drafts are Seller Hub pages. Create goes directly to
  `/sl/prelist/suggest?sr=shstart` (Start your listing). The generic `/sl/sell`
  redirects to a selling overview and costs an extra click; do not use it.
- `ebay revise <12-digit-item-id>` uses the verified item-ID revision URL. It
  must resolve its current draft in eBay; do not retain or substitute draft IDs.
- Reflexity retail product management is `/admin/products`. The Create button
  opens its modal via `?new=1`. `reflexity product <24-hex-id>` uses the source-
  verified `?edit=` route. There is no invented per-product admin path.

Before making a state-changing eBay action, read the visible seller identity and
confirm it is `reflexityram*com`. Before a storefront action, confirm the
authenticated Reflexity administrator. A loaded page or a successful click is
not proof; read the saved state back from the target and then from the public
item/product page.

## Build or revise a listing

1. Start with the live store product and physical label. Match MPN, maker,
   capacity, DDR generation, speed, ECC, RDIMM versus LRDIMM, rank when known,
   condition, units per purchase and actual available quantity. Do not carry
   64 GB/LRDIMM details into a different module.
2. Reuse the matching existing eBay draft when one exists. For a new eBay
   listing, retain the exact item ID and use it for later revisions. Keep stock
   consistent with the storefront after every sale/channel allocation.
3. Use one clean, corporate, white-background, shadowless product photo with a
   readable original label. Preserve the actual module and label facts; do not
   invent a different label, test result, accessory, warranty or stock claim.
   The October 13 instruction for Samsung32 removed the old second photo, so
   do not re-add it without a new user request.
4. Keep the first paragraph buyer-oriented and compact: exact part, condition,
   compatibility help and dispatch/return terms that are actually offered.
   Use a short specifications block, then precise purchase/quantity wording.
   Avoid filler, repeated headers and unverified claims.
5. Latest correction (13 Oct 2026): Seller Hub explicitly hid all5
   listings for **Offering to Buy or Sell Outside of eBay** after direct-order
   savings text and the spaced website address were published. The spaced
   domain is not a working solution. To resolve this violation, retain plain
   **Reflexity RAM** branding, concise product facts and eBay-only shopping
   links; remove external website addresses (including letter-spaced forms),
   website-order prompts and offsite price/savings promotions from listings
   and the bio. Keep the verified direct/eBay price comparison on the Reflexity
   website, matching MPN/condition/unit and separating shipping/tax.
   Published [Links policy](https://www.ebay.ca/help/default/default/links-policy?id=4248)
   and [Profile policy](https://www.ebay.com/help/policies/listing-policies/search-and-browse-manipulation-policy?id=4234)
   explain the restriction. Inspect any photo text too if a violation persists.
   Do not invent an exception or present formatting tricks as policy approval.
6. In eBay's description editor, enable **Show HTML**, focus its textarea,
   use supported browser `computer` click → Ctrl+A → type the HTML → Tab,
   then switch Show HTML off and verify the rendered rich-text iframe.
   **Do not use `form_input` alone for this field:** verified 13 Oct 2026,
   it changed the textarea DOM but eBay submitted the old rich-editor content,
   despite a successful revision confirmation. Save/revise once only after
   the rendered description, title, specifics, photo count, price, quantity
   and shipping match. Then read the public item’s observed `desc_ifr` URL
   and verify its actual HTML/text; a confirmation is not proof of saved copy.
   Do not replay an uncertain revision without checking whether it saved.
7. Verify Seller Hub after each revision: the affected row must no longer
   show a policy violation/hidden status. Public item pages can still load
   while a listing is hidden, so public HTML alone is insufficient. If a
   violation persists, inspect the exact warning before another revision.
   Verify the public eBay item and public Reflexity product separately. Record
   the item/product ID, condition, price, quantity and photo count. Re-open the
   active listing only if that public readback is incomplete or contradictory.

## Pricing when no price is supplied

Treat the following as a pricing decision procedure, not permission to invent a
market value.

1. Gather BOTH the current Canadian sold comparisons and today's active asking
   prices for the same MPN and condition, and write them (price, sale date,
   item ID) into the task artifact. Sold data lags a moving market: when the
   newest sales are more than about three weeks old, or sit far below today's
   asks, the live asks decide the price. Adjust only for a documented capacity,
   speed, registered type, quantity or warranty difference.
2. Check current Reflexity stock and its live price. Check the current eBay
   category, Store status and final-value fee rate before calculating a price.
   Price the listing in CAD with item price, buyer shipping, tax and seller fee
   shown as separate fields. Do not count a marketplace fee as a buyer saving,
   or count tax/shipping twice.
3. Keep the eBay item price above the same live Reflexity item price so the
   direct store is the better value. The difference should be a defensible
   marketplace-cost contribution, not a fixed unexplained percentage. If a
   sold comparison is unavailable, select a conservative **asking price** from
   the best exact-condition active comps and the current stock ladder, state
   the weaker evidence, and proceed when the user delegated the price decision.
   Do not park an authorized listing for routine price confirmation.
4. Recheck the exact two live prices immediately before publication. On the
   storefront, say only what the readback supports (for example, a dated CAD
   item-price comparison). Do not promise tax treatment, delivery, testing,
   compatibility or warranty beyond the live policies/product facts.
5. Owner's rules (13 Oct 2026). Price near the going asks for the exact part
   rather than undercutting them. Turn **Allow offers (Best Offer)** on for
   every eBay listing so buyers can negotiate; leave auto-accept and
   auto-decline blank unless the owner sets them. The website stays C$50 under
   the same item's eBay price. Never carry a price over from a copied draft or
   from the old website price: the Samsung 32GB went live on 12 Oct at C$349
   (website C$299) exactly that way, and on 13 Oct that was C$136 under the
   cheapest comparable ask (asks C$485-678; the part's last sale was 14 Sep at
   C$278). The owner saw the first comparable listings at C$490 and C$485, so
   the item went to C$485 with offers on and the website to C$435.

Changing a price on a live item, as verified on 13 Oct 2026: in the revise
editor click the price field, Ctrl+A, type the number, Tab (read the field
back); click the Allow offers switch (`input[name=bestOfferEnabled]`); press
**Revise it** once and wait for "Your listing has been revised"; the public
page must read `C $485.00 or Best Offer`. Raise the eBay price first, then set
the website price through Admin > Products (it creates the new Stripe Price and
archives the old one) and update the description's price comparison in the same
save. Prove checkout charges the new amount with
`.ai/artifacts/payments-2026-10-13/rollout/checkout_probe.py --slug <slug> --stripe`
(it expires the session it makes). Evidence for this change:
`.ai/artifacts/samsung32-price-2026-10-13/`.

Current historical examples in `.ai/STATE.md` are evidence snapshots, not
future price defaults. Fees, store plans, sold comps, stock and tax status can
change and must be refreshed for each decision.

## Completion record

For every listing task, save the exact public URLs/IDs, before/after price and
quantity, public-description readback and photo-count check in a dated task
artifact. State precisely which listings changed. Do not change Stripe, subscriptions, promotions or account settings as part
of listing copy. A catalog update usually needs no code deployment; when a
requested visible change requires frontend rendering, use the normal reviewed
release with tests and live readback. Do not deploy unrelated code.

## Keep this route fast and current

After listing work, update this playbook when a supported route, selector or
account binding has changed, and update `.ai/STATE.md` / `.ai/HANDOFF.md` with
verified outcomes. Fix a stale helper path in the same pass. Recheck identity
without switching accounts. Do not preserve obsolete draft IDs as shortcuts.

Verified 13 Oct 2026: the listing-copy release renders stored descriptions as
safe plain-text paragraphs beneath the price; check the visible product page, not only the catalog API. Current
compact templates and exact item-price comparison pairs are in
`.ai/artifacts/policy-fix-2026-10-13/copy-plan.json`; they are dated examples,
not future fixed prices.

A corrected bounded example is kept at
`.ai/artifacts/listing-copy-2026-10-13/revise-copy.py`; it uses the supported
bridge and proves rendered editor state plus public description readback.
Rediscover its task tab/session/bridge before reuse; these handles are never
permanent shortcuts.
