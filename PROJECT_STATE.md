# Project State

## 2026-08-25 — Local wholesale admin-to-customer demo

- VERIFIED (ARCHITECTURE/STATIC): Wholesale buyer stock belongs at the existing
  top-level `/wholesale` route. `/shop` remains the regular retail catalog and
  checkout path; `/liquidators` remains inbound sell-to-Reflexity intake.
- VERIFIED (LOCAL/IMPLEMENTATION): Branch `codex/wholesale-stock-lab` now has
  two connected development-only routes using the storefront's white, black,
  and yellow tokens: `/wholesale-admin-lab` is the owner-facing Wholesale Stock
  Studio and `/wholesale-lab` is the customer-facing published-lot preview.
- VERIFIED (LOCAL/DATA): The versioned browser-local store seeds two published
  synthetic lots and one private draft. Admin can create, edit, save draft,
  publish, unpublish, remove, and restore examples. Its allowlist forces
  `isDemo`, `local-demo`, and quote-only fields while stripping retail price,
  `stockQuantity`, Stripe IDs, and unknown fields. Corrupt schema/JSON fails
  closed with no customer-visible lots; failed writes do not replace prior
  serialized state. Restoring seeded examples retains custom demo lots.
- VERIFIED (BOUNDARY/STATIC): Customer cards require demo identity, published
  status, local-only visibility, complete publish validation, and quantity at
  or above MOQ. The two local
  pages have no `useStock`, Product/admin API, retail price, cart, checkout,
  Stripe, order, or automatic email path. Every synthetic MPN uses `DEMO-*` and
  customer cards display `LOCAL DEMO`.
- VERIFIED (CONTACT/TEST): The requested `Buying in volume?` and `Don't see what
  you need?` sections open reviewable Gmail drafts to
  `reflexityram@gmail.com`. Listed-lot drafts carry exact lot ID, MPN, and
  MOQ-bounded quantity. All 35 frontend tests pass.
- VERIFIED (BROWSER): Canonical Chrome alias `reflexity` (Profile 6,
  `reflexityram@gmail.com`) observed the admin summary at one draft, two
  published lots, and 72 units. Unpublishing one lot changed the customer
  preview from two cards to one. After restoring examples, a complete new lot
  was posted through the form and the customer preview changed from two cards
  to three with no alert or horizontal overflow. The seed was restored after
  the test.
- VERIFIED (BUILD/SECURITY): `npm run verify` passes 35 frontend tests, 15
  runnable backend tests with the disposable Atlas integration intentionally
  skipped, the Vite production build, and secret scanning. Frontend and backend
  high-severity audits report zero vulnerabilities. A built-artifact scan finds
  no admin/customer demo route, component, style, synthetic MPN, or browser-store
  key in `frontend/dist`. Both routes return HTTP 200 locally, browser logs have
  no warning/error entries, and the admin/customer layouts have zero horizontal
  overflow at 390 x 844 and 1920 x 1112.
- CONTRADICTED / SUPERSEDED (EARLIER LOCAL PROTOTYPE): The dark-green preview
  that displayed five live retail catalog listings as a disclosed reference is
  not the accepted product direction. Its public-API proxy, gallery, inventory
  board, quote workbench, and concept switcher have been removed from this
  branch's working result.
- VERIFIED (BOUNDARY): A future editable implementation requires a separate
  `WholesaleLot` model/API and restricted admin CRUD surface. The current
  `Product` model enters the regular retail API, feed, sitemap, and
  Stripe-related catalog behavior and must not become the wholesale data source.
  Detailed handoff: `docs/wholesale-local-design-lab.md`.

## 2026-08-13 — Live status refresh and legacy Cloudinary closure

Human-readable full update: [`docs/security/2026-08-13-cloudinary-and-website-status.md`](docs/security/2026-08-13-cloudinary-and-website-status.md)

- VERIFIED (CLOUDINARY SUPPORT/CONSOLE/API, 2026-08-13): Ownership verification was supplied on ticket `#383488`, linked to duplicate ticket `#383469`. Cloudinary Support confirmed at 08:46 America/Toronto that it rotated the exposed key. The historical credential returned HTTP 200 immediately before rotation and HTTP 401 with a Cloudinary authentication error afterward. The API Keys console now shows one active replacement created on 2026-08-13 whose public key identifier differs from the historical key. A 09:10 reply supplied the verification results and asked Support to close or merge both tickets. No code, key, secret, or reusable credential is stored here.
- VERIFIED (PRODUCTION/RUNTIME): The Render health endpoint reports `status=ok`, `env=production`, and Stripe enabled. The apex storefront, feed, and sitemap return HTTP 200. `www.reflexityram.com` redirects to the apex while preserving the requested path and query.
- VERIFIED (MERCHANT CENTER/RUNTIME): Merchant Center account `5832020811` still reports two approved products, zero limited, zero not approved, and zero under review. The overview shows seven clicks in the last 28 days and only growth/tip recommendations, not a policy issue.
- VERIFIED (DATA MIGRATION/DEPLOY/RUNTIME): Commit `f0d31a3` added an idempotent startup migration for the two exact legacy product-image URLs and removed the frontend legacy-host rewrite. Render applied the migration: the public product API, live Merchant feed, and both raw product-page social-image metadata now use only `fike`; both exact images return HTTP 200, and those live outputs contain zero `dfquny0nk` references.
- VERIFIED (TEST/CI/DEPLOY): The migration added two backend and two frontend regression tests. `npm run verify` passed 17 frontend tests, 13 backend tests with the opt-in Atlas integration intentionally skipped, the production build, and secret scanning. All three dependency audits reported zero vulnerabilities. Pull request `#1`, main CI run `31670637356`, and the Cloudflare Pages deployment for `f0d31a3` completed successfully.
- UNKNOWN (STRIPE PRODUCT DISPLAY): The migration invokes the existing non-fatal Stripe Product detail synchronizer for each changed product, but the Stripe connector was not authenticated for an independent dashboard read-back. Public checkout health remained enabled; this gap concerns only proof of Stripe's separately stored Product image field.
- STALE (DESKTOP BROWSER ACCESS): The supported desktop Chrome binding remained unavailable because the ChatGPT browser extension is absent. This no longer blocks the incident: the authorized Pixel 8a Gmail and Cloudinary console sessions supplied the provider reply, key-state evidence, and supported rotation workflow.
- VERIFIED (SUPPORT EMAIL/DEVICE, 2026-08-13): The authorized Pixel 8a mailbox received Cloudinary's ownership-verification instructions and the subsequent rotation confirmation. The provider's support-verification code and API-key confirmation codes were handled transiently and are not present in project files or this report. The first console attempt selected the earlier support code and returned `Wrong code`. The correct 08:39 API-key code was retried only after Support had already rotated the key at 08:46, and a subsequent stale-console request claimed to send another email without delivering one. `UNKNOWN`: those post-rotation failures cannot distinguish code expiry from superseded key state. Support's completed rotation made further self-service creation unnecessary.
- PARTIALLY VERIFIED (LEGACY ASSET INVENTORY): The working tree, broader local workspace, and reachable repository history recover only the two exact public legacy image URLs already migrated by `f0d31a3`. Earlier authenticated console evidence showed additional Media Library assets, but their identifiers are not present in the local records. A complete legacy-environment inventory therefore still requires restored supported browser/admin access or Cloudinary Support assistance.
- VERIFIED (POST-ROTATION RUNTIME, 2026-08-13): The Render health endpoint, storefront, product API, and live feed returned HTTP 200 after rotation. The product API contained two products and two `fike` image URLs, both HTTP 200; API/feed output contained zero `dfquny0nk` references. Both exact known legacy public image URLs also remained HTTP 200, confirming that credential rotation did not disable public delivery.
- VERIFIED (ACCESS INVENTORY): The connected Gmail integration is authenticated but does not contain the Cloudinary support mailbox. The Stripe integration remains unauthenticated. The desktop browser binding remains unavailable, but neither gap blocks the now-verified Cloudinary closure or live storefront.

## 2026-08-12 — Provider hardening, CI, and rendered production QA

- VERIFIED (CLOUDFLARE/RUNTIME): `www.reflexityram.com` is an active Cloudflare Pages custom domain with SSL enabled. The active Single Redirect `Canonicalize www to apex` matches `http*://www.reflexityram.com/*`, returns 301 to `https://reflexityram.com/${2}`, and preserves the query string. Public HTTPS and HTTP-to-final probes retained `/shop?sort=price&page=2` and finished at the apex with HTTP 200.
- VERIFIED (MERCHANT CENTER/RUNTIME): Account `5832020811` currently reports two approved products, zero limited products, zero disapproved products, and zero products under review. Its Notifications page contains only growth suggestions and tips, not a policy or account issue.
- VERIFIED (GITHUB/CI): `.github/workflows/ci.yml` now runs on pushes to `main` and pull requests with read-only repository permission, Node 22 dependency caching, `npm run verify`, and high-severity dependency audits. Official `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0` are pinned to exact commits and both declare the Node 24 action runtime. Run `31663521378` completed successfully with zero annotations after the earlier v4 Node 20 deprecation annotation was corrected.
- VERIFIED (SECURITY/STATIC/TEST): The storefront CSP is enforced instead of report-only. Browser report-only observation identified only Cloudflare Web Analytics at `static.cloudflareinsights.com`; that exact script origin was added before enforcement. Static and product-edge policies are locked together by a regression test. That verification run passed 15 frontend tests, 11 runnable backend tests, the production build, and secret scanning; the disposable-Atlas integration remained intentionally skipped. All three dependency audits reported zero vulnerabilities.
- VERIFIED (DEPLOY/RUNTIME/BROWSER): Cloudflare Pages deployment `171e3f75-8a53-4b66-9ec0-cb4b7ae4a088` serves commit `71c8dd6`. HSTS and the enforced CSP are live on both static and product-edge responses. Fresh Chromium observations hydrated the homepage, two-card shop, Samsung product, empty cart, empty checkout, and sign-in modal with zero CSP violations, JavaScript errors, unhandled rejections, console errors, or broken images. Product metadata, `$585.00` price, Add to cart control, Google sign-in target, Cloudflare beacon, and four product-page API calls were present.
- VERIFIED (LOCAL AUTH HYGIENE): A stale ignored repository-root `.env` containing only an obsolete Cloudflare token and stale Cloudflare exports in `.bashrc` were removed. An OAuth session whose credential material appeared in diagnostic output was revoked immediately; a fresh account-limited Wrangler OAuth session now succeeds and its credential file is mode `0600`.
- STALE (LEGACY PROVIDER): The historical Cloudinary environment `dfquny0nk` was located under a separate authorized Google identity. Its sole Root key was active and could not be disabled while it was the only key. Cloudinary Support subsequently rotated it on 2026-08-13; the current verified state is recorded above.
- VERIFIED (CLOUDINARY/CONSOLE/DOCS): Cloudinary documents programmatic access-key lifecycle management as an Enterprise Provisioning API feature whose credentials appear under Account Management Keys. This account exposes no Account Management Keys entry, shows an upgrade path, and disables the Active switch for its sole product environment. There is therefore no supported non-code self-service API or environment-disable path available on the current account.
- STALE (RUNTIME): At this point, the two storefront images served from `dfquny0nk` also returned HTTP 200 from `fike`, while the public product API still recorded the legacy URLs. Commit `f0d31a3` subsequently migrated the two active product records. The legacy Media Library still contains additional assets, so deleting or disabling the whole environment without a complete asset inventory remains unsafe.
- STALE (EXTERNAL SUPPORT, 2026-08-13): Cloudinary Support ticket `#383469` was submitted from the authenticated `John Smith` support account after a direct Cloudinary/Google support-portal sign-in. Ticket `#383488` later supplied ownership verification, and Support rotated the key. The current verified state is recorded above.

## 2026-08-12 — Merchant clearance and live XML delivery correction

- VERIFIED (USER-PROVIDED GOOGLE EMAIL): Google Merchant Center emailed at 3:37 PM that the requested Misrepresentation review for Reflexity RAM account `5832020811` was complete and the issue no longer appeared in the account. This supersedes the August 10 blocked-status snapshot; current product serving still requires normal Merchant diagnostics/visibility checks.
- CONTRADICTED (RUNTIME/STATIC): The apex `/feed.xml` and `/sitemap.xml` responses were byte-for-byte copies of `frontend/public/feed.xml` and `frontend/public/sitemap.xml`, not the backend's live XML. Cloudflare Pages does not proxy external domains through a `200` `_redirects` rule. The earlier description of the apex sitemap as dynamic was incorrect.
- VERIFIED (STATIC/TEST/LOCAL RUNTIME): Static product XML and the invalid external rewrite rules were removed. File-routed Pages Functions now proxy only `/feed.xml` and `/sitemap.xml` to the live Render catalog, cache successful XML for five minutes, reject non-read methods, fail closed on upstream errors, and mark responses with `X-Reflexity-Source: live-catalog-api`. Wrangler compiled the Functions and served both routes locally.
- VERIFIED (STATIC/TEST): The backend sitemap source now includes `/liquidators`, `/international`, and `/business-info`; a regression test locks the complete indexable static-route set. Cloudflare's native SPA fallback replaces the redundant catch-all rewrite.
- VERIFIED (STATIC/BUILD): Static frontend responses now set one-year HSTS and a staged CSP report-only policy. Deployment/environment examples were repaired after the credential-history scrub, obsolete default-admin instructions were removed, and current Render/Pages/Stripe configuration is documented without secrets.
- VERIFIED (STATIC/TEST/LOCAL RUNTIME): Raw product URLs previously returned only homepage metadata until React loaded. The new `/shop/[slug]` Pages Function injects sanitized product title, description, canonical, Open Graph, and Twitter metadata from the public product API. It has bounded 128 KiB HTML handling, a 2.5-second response budget with `waitUntil` completion for a slow catalog, unchanged-shell fallback on upstream failure, and a 404 plus `noindex` only for an API-confirmed missing product. Four focused edge cases pass; Wrangler served both current products with `X-Reflexity-SEO: product-edge` in 0.27–0.33 seconds and served a synthetic missing slug as 404.
- VERIFIED (DEPLOY/RUNTIME): Commit `c5a235d` was pushed to `origin/main` and both Render and Cloudflare Pages deployed it. Backend health returned HTTP 200 with `env=production` and Stripe enabled. The apex feed carried `X-Reflexity-Source: live-catalog-api`, was byte-identical to the backend feed, and contained both current in-stock USD products. The apex sitemap contained 21 URLs: all 19 indexable static routes plus two current products. Static storefront responses carried HSTS and the staged CSP report-only policy; `POST /feed.xml` returned 405.
- VERIFIED (DEPLOY/RUNTIME): Commit `bca1716` was pushed to `origin/main` and became visible through Cloudflare Pages. Both current product URLs returned HTTP 200, `X-Reflexity-SEO: product-edge`, their exact product title, absolute canonical URL, and absolute Cloudinary social image. A synthetic absent slug returned HTTP 404 with `X-Reflexity-SEO: product-not-found` and `noindex, nofollow`. The apex/backend feed SHA-256 remained identical (`88c5b24665dcb2bb35c5a44585d4e9844baae5cbc490a7c26564231e9739e9b8`), with two feed items and 21 sitemap URLs; backend health remained `status=ok`, `env=production`, Stripe enabled.
- STALE (RENDERED QA): Browser-runtime discovery returned no available browser instances immediately after the product-edge deployment. This limitation was superseded by the later fresh rendered-browser QA recorded above.
- STALE (EXTERNAL AUTH): `www.reflexityram.com` had no DNS record at this point and the available Cloudflare credentials returned code `9109`. This was superseded by the later verified active custom domain, SSL, and path/query-preserving redirect recorded above.

## 2026-08-10 — Render 8 PM failure investigation

- VERIFIED (GMAIL/RENDER): Render sent a deploy-failed notification at 8:06 PM and instance-failure notifications at 8:07–8:09 PM for commit `4116811`.
- VERIFIED (RUNTIME LOG): The failed instances exited because MongoDB rejected authentication. This was an environment credential problem, not a build/compiler failure in commit `4116811`.
- VERIFIED (RUNTIME): A manual deploy of the same commit connected to MongoDB and became live at 8:09 PM after the credential was corrected. Commit `14ed06b` then deployed successfully and became live at 8:14 PM.
- VERIFIED (RUNTIME): Production returned HTTP 200 for backend health, normalized product pagination, product feed, sitemap, storefront home, Server shop, wholesale, support, terms, and privacy. The Server shop rendered both active products. Health reported `env=production` and Stripe enabled. The August 12 audit later proved the apex XML was a static deployment snapshot at this time.
- VERIFIED (TEST/BUILD): Secret scanning passed; all five frontend tests and ten runnable backend tests passed; the Atlas transaction test remained intentionally skipped without a disposable test database; the Vite production build succeeded.
- VERIFIED (STATIC/TEST/RUNTIME): Backend cleanup in commit `6571815` replaces Mongoose 9's deprecated `new: true` update option with `returnDocument: 'after'` and removes duplicate Order/Cart schema-index declarations. Model loading produced no duplicate-index or deprecation warnings locally, and the 9:31 PM Render startup connected to MongoDB and reached live status without those warnings.
- STALE (RUNTIME): At the time of this outage investigation, both active product images used the legacy `dfquny0nk` delivery hostname, but the exact legacy and current `fike` URLs returned HTTP 200. Commit `f0d31a3` subsequently removed this data-hygiene debt; it was not the cause of the Render outage.

## 2026-08-10 — Repository credential incident remediation

Detailed report: [`docs/security/2026-08-10-credential-exposure-incident.md`](docs/security/2026-08-10-credential-exposure-incident.md)

- VERIFIED (GIT): `backend/.env` was removed from every reachable `main` commit, and historical MongoDB credential URIs, Cloudinary secrets, Resend keys, and authentication-secret assignments were replaced with inert markers. A full reachable-history scan reports zero matching credential values.
- VERIFIED (STATIC/TEST): `scripts/scan-secrets.mjs` now rejects tracked runtime `.env` files and detects refresh/session/Google client secret assignments in addition to the existing provider patterns. `npm run scan:secrets` passes on the cleaned tree.
- VERIFIED (GITHUB): The cleaned repository is public again so Render's existing GitHub credential can deploy it. GitHub native secret scanning and push protection are enabled. The connected OAuth token still lacks `workflow` scope, so no Actions workflow was added; native server-side enforcement is active instead.
- VERIFIED (PROVIDER/RUNTIME): Historical Resend keys are revoked and the current production Resend key does not match either historical key. The Atlas database-user password was regenerated; the historical URI now fails authentication, the replacement URI succeeds, and Render persisted it.
- VERIFIED (PROVIDER/RUNTIME): The current Cloudinary product environment is `fike` (renamed from `akbuojoj`). Its Aug 4 root key was not present in Git history, passed a controlled upload/delete test, and is configured in Render. Three unused non-root keys created during remediation are disabled.
- VERIFIED (DEPLOY/RUNTIME): Render deployment `dep-d9t5ttqfngtc73cqepk0` checked out cleaned commit `a88d3b6`, connected to MongoDB, started the server, and became live. `/api/health` returned `status=ok`; `/api/products?page=1&limit=1` returned one product in the paginated response.
- STALE (LEGACY PROVIDER): The exposed credential for historical Cloudinary environment `dfquny0nk` tested active during this incident, but its owning account was not accessible at that point. Access was later recovered and the current key/support state is recorded in the newer entries above.

## 2026-08-10 — Storefront catalog navigation and loading

- VERIFIED (STATIC/BUILD): Shared desktop/mobile navigation order is `Shop RAM`, `Wholesale`, `Liquidation`, `Support`, `Guides`. Frontend tests and the Vite production build pass with this order.
- VERIFIED (RUNTIME): Wholesale email CTA uses an HTTPS Gmail compose URL instead of relying on an operating-system `mailto:` handler. Production opens a new Gmail compose tab addressed to `reflexityram@gmail.com` with subject `Wholesale RAM request`; commit `e9263d6` is live.
- VERIFIED (STATIC): Home and Categories now use `frontend/src/lib/catalog.js` as the source of truth for Desktop, Laptop, and Server URLs (`line=Desktop|Laptop|Server`). Shop still accepts legacy form-factor URLs, including `form=RDIMM&form=LRDIMM` for Server RAM.
- VERIFIED (STATIC): The Shop catalog loader requests every `/api/products` page at the backend-supported 100-item size, forwards cancellation through Axios, and orders same-timestamp records by identifier for stable display.
- VERIFIED (STATIC): `Header.jsx` imports `LayoutDashboard`, which is rendered for authenticated mobile admins.

## 2026-08-10 — Backend catalog, order, and cart correctness

- VERIFIED (TEST): `backend/src/utils/pagination.js` normalizes product `page` and `limit` before computing `skip`, caps public product pages at 100 items, and adds `_id` as a stable secondary sort key. `npm test` covers the capped page boundary.
- VERIFIED (TEST): `backend/src/utils/orderAccess.js` compares an authenticated owner against both raw ObjectIds and populated `order.user._id` values without changing admin or guest-email access rules.
- VERIFIED (TEST): `backend/src/utils/guestCartMerge.js` is now the shared signup/login guest-cart merger. It drops unavailable guest items, refreshes active product cart details from the catalog, and caps every merged/transfer quantity at live stock and 99.
- VERIFIED (STATIC/TEST): Stripe `charge.refunded` handling now distinguishes partial from full refunds without treating partial refunds as terminal. Admin cancellation calls the idempotent stock-restoration helper; refunds leave inventory unchanged pending physical return inspection.
- VERIFIED (TEST): Stripe fulfillment recovery skips cancelled/refunded orders, so a delayed webhook or repeated session-status request cannot re-decrement stock after cancellation restored it.
- VERIFIED (STATIC): Stock decrement/restoration updates the order guard, all affected products, derived stock labels, and per-item decrement quantities in MongoDB transactions. Admin cancellation status/history and restoration share the same transaction, preventing split-brain cancellation state after a crash.
- VERIFIED (STATIC): Admin product deletion is now a reversible soft deactivation that preserves product references in orders, carts, and reviews. The product table can reactivate inactive records, and the editor persists the ECC flag.
- VERIFIED (STATIC): Admin Products now consumes the existing `?stock=in|low|out` quick-action parameter and forwards it to the validated admin API filter.

## 2026-08-10 — Production deployment verification

- VERIFIED (RUNTIME): Cloudflare Pages project `reflexity-ram2` serves `reflexityram.com` and is connected to `mohammedyusuf123/reflexity-ram` on production branch `main`. The previous `reflexityram-create/reflexity-ram` connection was inaccessible and was replaced.
- VERIFIED (RUNTIME): Cloudflare deployment `6a645d8b` completed successfully from clean commit `01fc9d2d2be886ea3e8d7e1e19403e6dfe292b9a`. A fresh browser journey through Home -> Shop RAM -> Server RAM reached `/shop?line=Server` and rendered both active LRDIMM products.
- VERIFIED (RUNTIME): Desktop and Laptop category cards reach `/shop?line=Desktop` and `/shop?line=Laptop`; production currently has zero active inventory for both lines and renders the category-specific empty state.
- VERIFIED (RUNTIME): `https://reflexity-ram.onrender.com/api/products?page=bogus&limit=0` returns normalized `page: 1` and `limit: 24`, confirming the updated backend pagination path is deployed. `/api/health` reports `status: ok` and `env: production`.
- VERIFIED (ATLAS/TEST): `backend/test/atlas-stock-transaction.integration.test.js` ran against an isolated Atlas database with a temporary cluster-restricted user. It observed cancellation plus the first product's `5 -> 7`, `low -> in` writes inside the open transaction, injected a failure before the second restore, and verified the order, history, `stockDecremented`, item metadata, both products, and labels fully rolled back outside the transaction. Retrying the same cancellation then committed successfully.
- VERIFIED (CLEANUP): The integration run's exact-marker cleanup left zero Order and Product fixtures. The empty disposable database was dropped only after an administrator-side zero-count check, and the temporary Atlas user was deleted.
- VERIFIED (DEPLOY/RUNTIME): Render deployment `dep-d9t6inuq1p3s73ait860` checked out Atlas-test commit `14ed06ba6a7f0525686fa9e397f4d92e06456961`, connected to MongoDB, and became live. Fresh public probes returned HTTP 200 health with `env: production` and normalized product pagination with `page: 1`, `limit: 24`, and the two active Server products.
- UNKNOWN: This live integration proof calls the stock transaction helper directly. It does not exercise the authenticated admin cancellation HTTP route or orchestrate a truly concurrent Stripe webhook/session-recovery race against that route.

## 2026-08-10 — Atlas verification credential follow-up

- VERIFIED (SECURITY/PROVIDER): The production Atlas URI was displayed during interactive verification and was treated as exposed. Its password was rotated again, the previous password was revoked, and Render now stores the replacement URI.
- VERIFIED (DEPLOY/RUNTIME): Render deployment `dep-d9t6g5egekts73cbjhqg` connected to MongoDB with the rotated credential, started the API, and became live. `/api/health` returned HTTP 200 with `env: production`; the normalized product pagination probe returned the two active products.

## 2026-08-11 — Product review placement

- VERIFIED (STATIC/TEST/BUILD): Product reviews are a fifth product-detail tab beside Specifications, Compatibility, Shipping, and Warranty. The tab shows the approved-review count when nonzero and contains the existing public review list plus verified-purchaser submission form; the former duplicate section below the tabs was removed. Frontend tests and the Vite production build pass.
- VERIFIED (LOCAL RUNTIME): The Reviews tab rendered on the local Samsung 64GB product page through the live catalog API. A browser-only review card labeled `LOCAL DEMO — NOT PUBLISHED` was used to verify the populated layout and was not saved to source or the database.
- VERIFIED (STATIC): On-site product reviews remain separate from Google Customer Reviews. Google survey opt-in is rendered only on order success and does not populate the storefront review database.
