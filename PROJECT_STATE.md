# Project State

## 2026-08-28 — Flexible wholesale quantity requests live

- VERIFIED (GITHUB/CI/DEPLOY): Pull request `#17` passed the required verify
  and deployment-configuration jobs and merged to `main` as
  `44bbd2d27486f5f991d472abcd9ebf46d0233bee`. Cloudflare Pages production
  deployment `3db44a8c-3f3a-4349-97e6-55d70b43c345` is active for that exact
  commit, and the canonical apex serves its `index-JlhhrUVF.js` bundle.
- VERIFIED (PRODUCTION/RUNTIME): Exact public lot
  `6a909f48078d6576e90d2117` / `M393A4K40CB2-CTD7Q` still reads back as
  published with 152 available units and `$265.00 CAD`. Its live detail page no
  longer presents or enforces a customer-facing MOQ/order step. It accepts any
  whole-unit request from 1 through listed availability, labels the action with
  the chosen quantity, and asks Reflexity to confirm what quantity it can
  accommodate.
- VERIFIED (BROWSER/EMAIL CONTRACT): A controlled live request for 37 units
  rendered `Request 37 units`; the generated Gmail draft URL contained the
  exact lot ID, MPN, `Requested quantity: 37`, and `Please confirm what quantity
  you can accommodate.` The action opens a reviewable draft and does not create
  an order, reserve inventory, invoke checkout, or contact Stripe.
- VERIFIED (TEST/BUILD/SECURITY): The release gate passed 58 frontend tests and
  75 runnable backend tests with two disposable-Atlas integrations intentionally
  skipped. The production build, secret scan, `git diff --check`, and
  root/frontend/backend dependency audits passed with zero vulnerabilities.
  Stripe, retail checkout, carts, orders, backend payment code, and payment
  provider resources were untouched.

## 2026-08-27 — Wholesale redesign, CAD unit price, and catalog-filter repair live

- VERIFIED (GITHUB/CI/DEPLOY): Backend-first pull request `#13` merged as
  `1b7c7d8a5731a233d09b3ad3d096c37d16889d8b`; all required checks passed and
  exact Render deployment `dep-da8b0l2jnfac73dijs40` reached `live`. Storefront
  pull request `#14` then merged as
  `9e7dc5a72f0bbfca0f46e5be86dfddd4a3cf45b1`; GitHub verification, deployment
  configuration, and Cloudflare Pages checks passed. Exact production Pages
  deployment `a7b5db44-4fd0-465d-8bcc-c34d6768471b` became active for that code
  commit and served the acceptance checks below.
- VERIFIED (PRODUCTION DATA/API): Exact published lot
  `6a909f48078d6576e90d2117`, MPN `M393A4K40CB2-CTD7Q`, was conditionally
  matched at version 1 and updated once to `unitPriceCad: 265`, producing version
  2. The live public wholesale API reads back that exact ID, MPN, published
  status, 152 available units, and price 265. Retail products, checkout, orders,
  Stripe code, Stripe configuration, and payment-provider resources were not
  changed.
- VERIFIED (PRODUCTION RUNTIME/VISUAL): `/wholesale` now renders the posted lot
  with the regular `ProductCard` glass-card structure, 5:4 image, catalog pills,
  stock badge, `$265.00 CAD`, and a details link. The dedicated public route
  `/wholesale/6a909f48078d6576e90d2117` renders the same image, price, quantity,
  quote action, trust cards, specifications, and complete lot notes. Fresh
  1440x1200 and 390x844 headless-Chrome captures verified desktop and mobile
  rendering after allowing the Cloudinary image to complete.
- VERIFIED (PRODUCTION RUNTIME/FILTERS): Regular RAM filters now preserve
  consecutive query updates instead of rebuilding each change from a stale URL.
  A controlled live Chromium probe clicked ECC, 64GB, and LRDIMM back-to-back
  from `line=Server`; all three inputs remained checked, the final URL retained
  `line=Server&ecc=true&cap=64&form=LRDIMM`, visible chips showed Server,
  LRDIMM, 64GB, and ECC only, and exactly two matching cards rendered. Direct
  live checks also returned three results for ECC + 16GB + RDIMM and zero plus
  the intended empty state for ECC + 64GB + RDIMM.
- VERIFIED (TEST/BUILD/SECURITY): The release gate passes 56 frontend tests and
  75 runnable backend tests; the two disposable-Atlas integrations remain
  intentionally skipped. The Vite production build, secret scan,
  `git diff --check`, and root/frontend/backend dependency audits all pass with
  zero vulnerabilities. Focused tests cover combined filtering, ECC boolean
  semantics, consecutive selections, repeated-filter removal, wholesale CAD
  validation/projection, and the card-to-detail route.
- VERIFIED (ANALYTICS/STATIC/PRODUCTION): GA4 bootstrap now loads only when the
  exact hostname is `reflexityram.com`, preventing localhost and provider preview
  traffic from adding new production-property events. The canonical live host
  retains GA4; production and preview builds use the same source-controlled
  guard.

## 2026-08-26 — Comprehensive non-payment hardening and recovered deployment

- VERIFIED (SOURCE/TEST/REVIEW): Pull requests `#6` through `#11` hardened the
  storefront, authenticated administration, guest order proof, carts, wholesale
  inventory, rate limiting, request bounds, browser security policy, startup
  indexes, explicit CORS denial, and separation of platform liveness probes from
  customer abuse controls. The current release head is
  `73e2aa870dbeba34a563c97e48d935213a470bd4`. The full gate passes 51 frontend
  tests and 74 runnable backend tests; the two explicitly disposable Atlas
  integrations remain opt-in and skipped by default. The production frontend
  build, secret scan, `git diff --check`, and root/frontend/backend dependency
  audits pass with zero vulnerabilities. Independent release, cart-migration,
  startup-index, and health-check reviews found no blocker.
- VERIFIED (MAILBOX/RENDER ROOT CAUSE): The exact canonical Chrome alias
  `reflexity` resolved Profile 6 and `reflexityram@gmail.com`. Its unread Render
  alert at 2026-08-26 01:15 America/Toronto reported
  `HTTP health check failed with status code 429`; this was newer than and
  distinct from the two earlier
  failed-deployment messages. Static ordering showed `/health` and
  `/api/health` behind the shared Mongo-backed `200 requests / 15 minutes`
  customer limiter, so repeated platform probes could exhaust that IP bucket.
  Both health routes now remain behind Helmet and exact-origin CORS but terminate
  before the global limiter. Ordinary API routes remain behind the limiter.
- VERIFIED (RENDER/ROOT CAUSE): Failed deployment
  `dep-da76jm3l550s73ahl970` reached MongoDB startup but found legacy non-unique
  sparse `carts.user_1` and `carts.sessionId_1` indexes where current ownership
  requires uniqueness. The in-place migration prepared the existing indexes,
  normalized explicit null ownership, verified no duplicate owner group, and
  converted both indexes without dropping the collection. A disposable Atlas
  fixture reproduced the populated legacy state, upgrade, second-run
  idempotence, and post-upgrade duplicate rejection.
- VERIFIED (RENDER/SECOND FAILURE): Deployment
  `dep-da76rmu7bikc73fhstig` successfully completed the cart migration, then
  exposed a separate legacy `Order.stripePaymentIntentId` option mismatch during
  general Mongoose index enforcement. Startup now ensures every non-payment
  index while deliberately omitting both payment-provider index declarations
  from that unrelated enforcement pass. No payment-provider index was dropped,
  converted, recreated, or modified.
- VERIFIED (ATLAS READBACK/PRESERVATION): Production still has all three carts;
  no duplicate owner group or dual-owned cart existed, and zero cart document
  was deleted. Explicit null owner fields are gone and both owner indexes are
  unique and sparse. Read-only post-release inspection confirmed the two
  payment-provider index options are unchanged:
  `stripePaymentIntentId_1` remains non-unique/non-sparse and
  `stripeCheckoutSessionId_1` remains unique/sparse.
- VERIFIED (PRODUCTION/DEPLOY): Render deployment
  `dep-da77kl0u01pc73bpvmog` and Cloudflare Pages production deployment
  `f9341666-205b-458f-933b-5ae524de1e8c` serve exact commit `73e2aa87...`.
  Render tracks `reflexityram-create/reflexity-ram` branch `main`, automatic
  deploys are enabled, root is `backend`, build is `npm ci`, start is
  `node src/server.js`, and health is `/api/health`. GitHub protects `main` with
  strict required `verify` and `Deployment configuration gate` checks plus
  admin enforcement; force pushes and branch deletion are disabled.
- VERIFIED (PROVIDER CONFIG/NON-PAYMENT): Proven-unused Render variables
  `SEED_SECRET`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`, `JWT_REFRESH_SECRET`, and
  `SESSION_SECRET` were removed and a fresh deployment proved the reduced
  environment. Both Stripe variable names remain present and their values were
  neither revealed nor changed. Cloudflare Pages builds with
  `npm ci && npm run build` from `frontend` to `dist`; Full (strict), minimum
  TLS 1.2, Always Use HTTPS, DMARC, and bounded CAA records are live.
- VERIFIED (LIVE HTTP): `GET /health`, `GET /api/health`,
  `GET /api/health?probe=render`, and `HEAD /api/health` return HTTP 200 with no
  rate-limit headers; an ordinary `/api/products` response still advertises the
  200-request customer policy. A trusted Reflexity Origin receives its exact
  credentialed CORS grant on health, while an untrusted Origin receives HTTP 403
  with the fixed body `Request origin not allowed`. The apex, `/shop`,
  `/wholesale`, feed, and sitemap return HTTP 200. Malformed catalog filters
  return 400, unauthenticated admin reads return 401, public product output omits
  management/provider fields, and `/api/wholesale` returns exactly zero lots as
  requested. HSTS, enforced CSP without inline scripts, `no-referrer`,
  `nosniff`, frame denial, and camera/microphone/geolocation denial are present
  on the live storefront.
- VERIFIED (BROWSER/EXACT PROFILE): Canonical alias `reflexity` resolved Profile
  6 and Google account `reflexityram@gmail.com` with `AUTOMATION_VERIFIED`; the
  exact extension instance rendered the signed-in admin principal. Products
  exposes both **Manage all** and **Add wholesale listing** controls. The
  wholesale admin shows zero drafts, live lots, units, and archives plus
  **Add wholesale listing**; the customer page places posted inventory before
  direct sourcing and shows no seeded lot. Desktop/admin and 390 x 844 customer
  checks had no horizontal overflow, alert, console warning, or console error.
- VERIFIED (MAILBOX/POST-DEPLOY): After refreshing that same inbox, the newest
  notification was the 01:31 Cloudflare Pages success for pull request `#11`;
  the 01:15 Render 429 remained the newest Render alert and no later Render
  failure was present. Render's provider API independently reports the exact
  replacement deployment `live`; the inspected post-deploy logs show the
  service started and contain no 429 or 5xx. Their only error was the deliberate
  untrusted Origin probe, which returned the expected 403.
- VERIFIED (STRIPE NO-TOUCH BOUNDARY): No Stripe provider resource, credential,
  product, price, webhook, source route, checkout file, payment flow, or payment
  database index was changed during this release. Startup filtering exists only
  to prevent unrelated index enforcement from rewriting those legacy indexes.
- PENDING (DNSSEC): Cloudflare currently reports DNSSEC `pending` with algorithm
  13/SHA-256. DNSKEY records are published, but a public resolver still returns
  zero parent DS records. Do not describe DNSSEC as active until Cloudflare
  reports `active` and the parent DS resolves.

## 2026-08-25 — Production wholesale inventory administration

- VERIFIED (ARCHITECTURE/STATIC/TEST): Wholesale uses its own `WholesaleLot`
  model plus a durable `WholesaleMediaAsset` ownership registry, public
  projection, authenticated admin API, and isolated Cloudinary folder. It has
  no call edge into the retail `Product` model, cart, checkout, Stripe, orders,
  feed, sitemap generation, or seed scripts.
- VERIFIED (ADMIN/STATIC): Products contains visibly separate Retail Products
  and Wholesale Lots workspaces. The Retail Products workspace provides both
  **Manage all** and direct **Add wholesale listing** controls. An authenticated
  administrator on `/wholesale` receives the second direct Add entry. Both use
  the one editor at `/admin/wholesale?new=1`; the technical workspace loads all
  paginated draft, published, and archived records before local filtering.
- VERIFIED (LIFECYCLE/TEST): Records start as private drafts. Publish validation,
  explicit publish/unpublish/archive/restore transitions, soft archive, and
  revision checks preserve exact state. Missing bodies fail with `400`, stale
  writes fail with `409`, and public reads fail closed to complete published
  quote-only lots with a fixed 1,000-candidate defensive scan ceiling.
- VERIFIED (AUTH/STATIC/TEST/RUNTIME): Wholesale uploads and mutations require
  an explicit case-insensitive Bearer token plus an active administrator. A
  supplied malformed or rejected Authorization header is authoritative and
  cannot fall back to a valid cookie. The frontend clears expired or malformed
  bearer state from persisted and in-memory auth, propagates logout between
  tabs, and preserves valid percent characters in Google callback payloads.
- VERIFIED (MEDIA/LIFECYCLE/STATIC/TEST): Media moves through durable
  available/claiming/attached/deleting/deleted ownership states with bounded
  leases. Publication requires the exact registry asset attached to the exact
  lot and URL; published lots must be unpublished before image replacement.
  Ambiguous Mongo or Cloudinary outcomes retain their claim/deletion gate and
  retry idempotently instead of deleting a potentially committed asset.
  Resumed writes after claim expiry remain draft/private. Mongo uniquely indexes
  `WholesaleLot.image.publicId` (partial) and registry `publicId`; both indexes
  are awaited before accepting traffic.
- VERIFIED (UI/BUILD/TEST): The white/yellow editor is portalled outside the
  complete inert and `aria-hidden` application shell, keeps assertive/polite
  feedback inside the live dialog, traps focus, and restores focus after
  Cancel, Escape, or Browser Back. Back during upload cleans any returned
  unattached asset without a false success message. The layout fits a 390 x 844
  viewport without horizontal overflow. All 42 frontend tests and 49 runnable
  backend tests pass; one disposable-Atlas integration is intentionally skipped.
  The production build and secret scan pass, and root/frontend/backend audits
  report zero vulnerabilities.
- VERIFIED (BACKEND DEPLOY/CI/RUNTIME): Backend commit
  `68c74088caf37c8dedc4fcb7e6f64be5b0eb5607` passed GitHub Actions run
  `32919123860` and is the exact live Render deployment
  `dep-da742l67bikc73ffp7v0`. The public endpoint returns HTTP 200,
  `Cache-Control: no-store`, and `{"lots":[]}`. Unauthenticated and cookie-only
  admin reads both return `401` before application authentication.
- VERIFIED (ZERO-DATA/ATLAS READ): No wholesale listing, image, seed record, or
  startup writer was added. A current read-only production count returned zero
  `wholesalelots` (draft, published, and archived) and zero
  `wholesalemediaassets`; the exact unique partial lot-image index and unique
  registry-public-ID index are active.
- VERIFIED (BACKEND DEPLOY/RETAIL REGRESSION): Production remains healthy with
  `env=production` and Stripe enabled. The retail API still has five products
  and all retail image IDs retain the `reflexity-ram/products/` prefix. The live
  feed has five items, 15 CAD markers, and zero USD markers; the sitemap has 24
  URLs and `/wholesale` exactly once.
- VERIFIED (FRONTEND DEPLOY/CI): Auth/modal commit
  `3fcc7163f7d65c64f92bf5927f25c2a455c697f6` passed GitHub Actions run
  `32919296260`. Focus-restoration commit
  `4f02f50cbe97b312abf18f2fae68d0201371fcfd` passed run `32919536922` and is
  Cloudflare Pages production deployment
  `08f981d7-9888-4cf2-bf2a-7e54e97077ed`. The apex serves its exact built asset
  `/assets/index-Dt2Axj6P.js`.
- VERIFIED (PRODUCTION/BROWSER): `ai-chrome verify reflexity` bound Profile 6,
  visible profile `Reflexity`, and Google account `reflexityram@gmail.com` with
  `AUTOMATION_VERIFIED`. The normal Google flow is complete and the deployed
  admin renders the signed-in Reflexity principal (`reflexityram@gmail.com`,
  Mohammed). Live Cancel, Escape, and Browser Back each closed the new-listing
  editor without saving, cleaned URL/inert/ARIA/overflow state, and restored
  focus to **Add wholesale listing**. The mobile editor fit 390 x 844; the public
  page showed zero posted lots plus exact sourcing and signed-in Manage/Add
  controls; `/admin/products` showed five retail rows and both wholesale entry
  points. The browser was returned to its normal desktop viewport.
- Deployment and operating guide: `docs/wholesale-inventory.md`.

## 2026-08-25 — Historical wholesale market and local Stock Studio (superseded)

- VERIFIED (ARCHITECTURE/STATIC): Wholesale buyer stock belongs at the existing
  top-level `/wholesale` route. `/shop` remains the regular retail catalog and
  checkout path; `/liquidators` remains inbound sell-to-Reflexity intake.
- VERIFIED (DEPLOY/CI): `main` commit `b760cfc` deployed through Cloudflare
  Pages project `reflexity-ram` as deployment
  `58e604ea-6955-4e46-be79-3239635b5a16`. GitHub Actions run `32907508057`
  completed the clean install, tests, build, secret scan, and all dependency
  audits successfully. The custom domains are attached to `reflexity-ram`;
  domainless project `reflexity-ram2` remains a rollback resource.
- VERIFIED (PRODUCTION/BROWSER): Canonical Chrome alias `reflexity` (Profile 6,
  `reflexityram@gmail.com`) rendered `https://reflexityram.com/wholesale` with
  the combined market shell, inventory first, sourcing second, exactly zero
  live lots, and the honest `No stock is posted right now.` state. The desktop
  page at 1920 x 1112 and mobile page at 390 x 844 had zero horizontal overflow,
  no demo/admin text or links, and no fresh browser warning or error.
- STALE / SUPERSEDED (FORMER PRODUCTION/BOUNDARY): `WHOLESALE_LOTS` was the frozen
  empty array, so this release publishes no listings. The deployed JS is
  byte-identical to the verified local asset (SHA-256
  `c231bb40d2f84540254811aab8fe2a3b5c195dd9901f36f1862a2540471f0f88`)
  and contains the official empty inventory/sourcing shell but no demo route,
  local store, synthetic MPN, seed ID, or Stock Studio marker. Until an
  authenticated production `WholesaleLot` service exists, real lots must be
  added deliberately to `frontend/src/data/wholesaleLots.js` and redeployed;
  the browser-local Stock Studio is not a live production editor.
- VERIFIED (PRODUCTION/SMOKE): HTTP and `www` requests preserve the wholesale
  path/query while ending on HTTPS 200. Render reports `status=ok`,
  `env=production`, and Stripe enabled. The public API returns five active CAD
  products with images; the live feed has five items, 15 CAD markers, and zero
  USD markers; the sitemap has 24 URLs. HSTS/CSP, live-catalog source headers,
  product-edge metadata, unauthenticated admin 401, disallowed-origin CORS
  denial, and absent-product 404/noindex all remain intact.
- VERIFIED (LOCAL/IMPLEMENTATION): Branch `codex/wholesale-stock-lab` now has a
  shared white, black, and yellow wholesale market shell. On localhost,
  `/wholesale` reads the browser-local demo store through a development-only
  adapter; `/wholesale-lab` is an alias to the same customer view and
  `/wholesale-admin-lab` is the owner-facing Wholesale Stock Studio. Posted
  lots are the dominant left column, while one compact `Need a specific SKU?`
  sourcing card occupies the right rail. Mobile preserves inventory before
  sourcing. There is no repeated bottom contact block.
- VERIFIED (LOCAL/DATA): The versioned browser-local store seeds two published
  synthetic lots and one private draft. Admin can create, edit, save draft,
  publish, unpublish, remove, and restore examples. Its allowlist forces
  `isDemo`, `local-demo`, and quote-only fields while stripping retail price,
  `stockQuantity`, Stripe IDs, and unknown fields. Corrupt schema/JSON fails
  closed with no customer-visible lots; failed writes do not replace prior
  serialized state. Restoring seeded examples retains custom demo lots.
- VERIFIED (BOUNDARY/STATIC): Local customer cards require demo identity,
  published status, local-only visibility, complete publish validation, and
  quantity at or above MOQ. The development adapter is the only customer-page
  module that imports the demo store. The production `/wholesale` path uses
  only public, published records from the separate `WHOLESALE_LOTS` source and
  does not import browser-local demo state. The local pages have no `useStock`,
  Product/admin API, retail price, cart, checkout, Stripe, order, or automatic
  email path. Every synthetic MPN uses `DEMO-*` and local cards display
  `LOCAL DEMO`.
- VERIFIED (BOUNDARY/FAILED-PATH): The first shared-shell implementation kept
  local-preview branches and labels inside `Wholesale.jsx`; the production
  artifact scan correctly rejected those literals even though demo storage was
  not imported. The final boundary exports a data-agnostic `WholesaleMarket`,
  keeps all local labels and lot adaptation in the development-only
  `WholesaleLab`, and leaves the default wrapper responsible only for filtering
  authoritative public, published `WHOLESALE_LOTS`.
- VERIFIED (CONTACT/TEST): Every posted lot has one `Request this lot` action
  whose accessible label names the exact lot and whose reviewable draft carries
  the lot ID, MPN, and MOQ-bounded quantity. The single general sourcing rail
  asks for exact specification, quantity/condition, and destination/date before
  opening the shared `Get bulk pricing` draft. A quiet sell-stock link routes to
  `/liquidators`; there is no second generic contact CTA. All 36 frontend tests
  pass.
- VERIFIED (LOCAL/BROWSER): Canonical Chrome alias `reflexity` (Profile 6,
  `reflexityram@gmail.com`) observed the admin summary at one draft, two
  published lots, and 72 units. Unpublishing one lot changed the customer
  preview from two cards to one. After restoring examples, a complete new lot
  was posted through the form and the customer preview changed from two cards
  to three with no alert or horizontal overflow. The seed was restored after
  the test. The final combined `/wholesale` check observed two posted cards in
  the first grid child and the sourcing rail second. Desktop rendered two lot
  columns plus a sticky 352px rail at 1920 x 1112; mobile rendered one 350px
  stock column followed by a 350px sourcing card at 390 x 844. Both had zero
  horizontal overflow or alerts, and a fresh desktop navigation logged no
  warning or error.
- VERIFIED (BUILD/SECURITY): `npm run verify` passes 36 frontend tests, 15
  runnable backend tests with the disposable Atlas integration intentionally
  skipped, the Vite production build, and secret scanning. Frontend and backend
  high-severity audits report zero vulnerabilities. A built-artifact scan finds
  no admin/customer demo route, component, synthetic MPN, or browser-store key
  in `frontend/dist`; the production bundle retains the shared official
  wholesale market shell. All local routes return HTTP 200, browser logs have
  no warning/error entries, and the admin/customer layouts have zero horizontal
  overflow at 390 x 844 and 1920 x 1112.
- CONTRADICTED / SUPERSEDED (EARLIER LOCAL PROTOTYPE): The dark-green preview
  that displayed five live retail catalog listings as a disclosed reference is
  not the accepted product direction. Its public-API proxy, gallery, inventory
  board, quote workbench, and concept switcher have been removed from this
  branch's working result.
- VERIFIED (HISTORICAL DESIGN DECISION): The proposed editable implementation
  required a separate `WholesaleLot` model/API and restricted admin CRUD
  surface; the current production implementation above now satisfies it. The
  retail `Product` model enters the regular retail API, feed, sitemap, and
  Stripe-related catalog behavior and must not become the wholesale data source.
  Current handoff: `docs/wholesale-inventory.md`.

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

- STALE (SUPERSEDED RUNTIME): Cloudflare Pages project `reflexity-ram2` served `reflexityram.com` from the former repository owner at this point. The repository later transferred to `reflexityram-create/reflexity-ram`; the custom domains now use project `reflexity-ram`, and `reflexity-ram2` is retained domainless for rollback.
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
