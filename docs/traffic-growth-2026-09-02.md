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

## Post-release proof

- Pull request `#24` merged as `721f3b892691fd24c1c2902f0387bba6d84429a1`; Cloudflare Pages and Render both read back that exact release successfully. Pull request `#25` then merged the client-schema cleanup and durable release evidence as `ba77753bb7b14706df3ccc4bf3379793bfe4c908`; all three protected checks passed and Cloudflare deployment `4fc674a4-05fa-4df2-a3c7-28b565746d60` succeeded.
- Raw public routes return `X-Reflexity-SEO: static-edge` or `product-edge`, meaningful initial body content, canonical metadata, and one edge Product JSON-LD block where applicable. The hydrated product page retains exactly one current Product schema and delivers the main image through `f_auto,q_auto,w_1200`.
- Production health reports `status=ok`, `env=production`, and Stripe enabled. Production mobile Lighthouse is Performance 98, Accessibility 100, Best Practices 100, SEO 100; FCP and LCP are 1.7 s, TBT is 120 ms, and CLS is 0.
- GA4 readback confirms `purchase` and `generate_lead` are key events counted once per event. Leads have no default monetary value.
- Search Console readback confirms validation started on 2026-09-02 for both four-URL groups: Discovered - currently not indexed and Crawled - currently not indexed.
