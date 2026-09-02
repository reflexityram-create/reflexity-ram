# Buyer acquisition priorities — 2026-09-02

## Current evidence

- GA4's audited 28-day baseline was 205 users and 268 sessions, but an automation
  burst materially inflated those totals. Organic search contributed 49 sessions.
- Search Console reported 315 impressions, 8 clicks, 2.5% CTR, and average
  position 44.5. Search indexing validation is already running.
- The live catalog has five active retail SKUs. All are server RAM, all have one
  product image, and all have zero verified reviews.
- GA4 now measures `view_item`, `add_to_cart`, `begin_checkout`, verified
  `purchase`, `generate_lead`, and `contact`. There is not yet enough clean
  post-instrumentation traffic to identify a checkout conversion defect.

## Priority order

1. **Broaden sellable inventory or narrow the promise.** The homepage offers
   laptop and desktop lanes while the live catalog contains only server RAM.
   Add real in-stock laptop/desktop SKUs with exact MPNs, or temporarily focus
   acquisition copy on the server inventory that can actually be purchased.
2. **Confirm Google Merchant Center free-listing approval.** The live feed has
   all five products, CAD prices, availability, MPNs, conditions, shipping, and
   images. Provider approval/disapproval status must be read back before paying
   for traffic.
3. **Add proof, not generic copy.** Give each product clear front/back label
   photos plus packaging and testing evidence. Keep verified-purchase reviews
   authentic; invite delivered customers to review instead of seeding reviews.
4. **Distribute exact-MPN inventory where buyers already search.** Cross-list
   current stock on eBay and relevant Canadian/server-hardware marketplaces,
   keeping quantity and price synchronized. Use exact part numbers in every
   title and link buyers to the matching product detail page when the channel
   permits it.
5. **Benchmark landed price before changing it.** Compare the exact MPN,
   condition, warranty, Canadian shipping, and tax—not a nearby capacity or
   generic compatible module. Make price changes only with cost and margin data.
6. **Delay paid ads until the funnel has a clean baseline.** Collect at least
   two to four weeks of post-fix data. Diagnose the first weak transition among
   product view → add to cart → checkout → purchase, then run one bounded search
   campaign against exact-MPN/high-intent queries. Do not pay to amplify an
   unmeasured funnel.

## Weekly decision view

Track human-only sessions and these rates by landing page and source:

- search impression → click;
- product view → add to cart;
- add to cart → begin checkout;
- begin checkout → verified purchase;
- support/wholesale visit → `contact` or `generate_lead`.

Keep QA markers and automation traffic excluded. A channel earns more effort
only when it produces qualified product views, leads, or verified purchases—not
when it merely increases sessions.
