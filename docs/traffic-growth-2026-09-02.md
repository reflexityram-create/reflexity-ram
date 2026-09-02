# Traffic and conversion remediation — 2026-09-02

## Verified baseline

- GA4 property `546945877`, 28 days: 205 users, 268 sessions, 772 views, and zero key-event traffic. Of the 268 sessions, 216 were direct and 49 were organic (41 Google, 8 Bing). An automated August 10 burst materially inflated the totals.
- Search Console, 2026-08-04 through 2026-08-31: 315 impressions, 8 clicks, 2.5% CTR, and average position 44.5. Sixteen URLs were indexed and nine were excluded. The three leading guides produced 316 impressions but zero clicks.
- Production mobile Lighthouse: Performance 61, Accessibility 89, Best Practices 100, SEO 100; FCP 3.1 s, LCP 5.1 s, TBT 570 ms, 931 KiB transfer.
- Raw public route HTML was an empty SPA root. Product edge rendering changed metadata but did not add product body content or Product JSON-LD.

## Implemented remediation

- Added GA4 ecommerce and lead events: `view_item`, `add_to_cart`, `begin_checkout`, `checkout_redirect`, verified `purchase`, `generate_lead`, and support `contact`.
- Added exact-host and internal-traffic suppression before GA loads. Admin, authentication, account, lab, and tagged QA/release visits are excluded.
- Extended the verified payment-status response with currency, value, tax, shipping, and item data; purchase emission is session-deduplicated.
- Added crawlable initial body content, unique metadata, canonical URLs, and internal links for every static sitemap route.
- Added live product body content and Product JSON-LD to the existing bounded product edge function.
- Rewrote high-impression guide titles and added intent-specific catalog and compatibility CTAs.
- Lazy-loaded every non-home route, deferred non-critical scripts and web fonts, requested responsive Cloudinary assets, and lazy-loaded catalog imagery.
- Corrected audited light-theme contrast, product heading order, and the cart link's accessible name.
- Updated the vulnerable transitive `qs` dependency to a non-advisory version.

## Local verification before release

- Frontend: 63/63 tests passed.
- Backend: 76/76 runnable tests passed; 2 disposable-Atlas tests intentionally skipped.
- Dependency audits: zero frontend and zero backend vulnerabilities.
- Production build passed. The homepage entry chunk changed from 518.38 kB (152.11 kB gzip) to 320.16 kB (102.37 kB gzip).
- Mobile Lighthouse against the production build locally: Performance 98, Accessibility 100, Best Practices 96, SEO 100; FCP 1.8 s, LCP 2.1 s, TBT 20 ms, CLS 0, 263 KiB transfer. The one local Best Practices failure was an expected API console error because the static preview had no local backend proxy; production verification remains required.

## Post-release proof required

- Read back the exact deployed commit from Render and Cloudflare, then verify health, raw public HTML, product JSON-LD, route hydration, headers, images, and mobile Lighthouse on `https://reflexityram.com`.
- Confirm `purchase` and `generate_lead` are GA4 key events. `purchase` already exists. The service account can read but cannot create key events, so `generate_lead` requires the authorized Analytics admin surface.
- Start Search Console validation for both Discovered - currently not indexed and Crawled - currently not indexed after the crawlable HTML is live.
