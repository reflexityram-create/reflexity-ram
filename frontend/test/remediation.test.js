import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { serializeJsonLd } from '../src/lib/safeJsonLd.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('policy copy and analytics cannot use sensitive light-theme or URL defaults', async () => {
  const [css, html, analytics, app] = await Promise.all([
    read('../src/index.css'), read('../index.html'), read('../public/analytics-bootstrap.js'), read('../src/App.jsx'),
  ]);
  assert.match(css, /--policy-heading: #ffffff/);
  assert.match(css, /--policy-heading: #171717/);
  assert.match(css, /--policy-link: #93b4ff/);
  assert.match(css, /--policy-link: #1557a6/);
  assert.match(css, /\.policy-content a[^\n]*color: var\(--policy-link\)/);
  assert.match(html, /<script defer src="\/analytics-bootstrap\.js"><\/script>/);
  assert.match(html, /<script defer src="\/font-bootstrap\.js"><\/script>/);
  assert.match(html, /rel="preconnect" href="https:\/\/reflexity-ram\.onrender\.com" crossorigin/);
  assert.match(html, /rel="preconnect" href="https:\/\/res\.cloudinary\.com" crossorigin/);
  assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/);
  assert.match(analytics, /window\.location\.hostname === "reflexityram\.com"/);
  assert.match(analytics, /document\.head\.appendChild\(analyticsScript\)/);
  assert.match(analytics, /send_page_view: false/);
  assert.match(app, /const safePath = location\.pathname/);
  assert.match(app, /page_location: `\$\{window\.location\.origin\}\$\{safePath\}`/);
  assert.match(app, /page_path: location\.pathname/);
  assert.doesNotMatch(app, /location\.hash/);
  assert.doesNotMatch(app, /location\.search/);
});

test('public catalog reads avoid credentialed custom headers and product images are prioritized responsively', async () => {
  const [api, card, product, wholesale, wholesaleLot] = await Promise.all([
    read('../src/lib/api.js'),
    read('../src/components/ProductCard.jsx'),
    read('../src/pages/Product.jsx'),
    read('../src/pages/Wholesale.jsx'),
    read('../src/pages/WholesaleLot.jsx'),
  ]);
  assert.match(api, /const publicApi = axios\.create/);
  assert.match(api, /list: \(params, config = \{\}\) => publicApi\.get\('\/products'/);
  assert.match(api, /getBySlug: \(slug, config = \{\}\) => publicApi\.get/);
  assert.doesNotMatch(api.match(/const publicApi = axios\.create\([\s\S]*?\n\}\);/)?.[0] || '', /withCredentials|Content-Type|x-session-id/);
  for (const source of [card, product, wholesale, wholesaleLot]) {
    assert.match(source, /srcSet=\{imageSrcSet/);
    assert.match(source, /fetchPriority=/);
  }
  assert.match(card, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.match(product, /loading="eager"/);
});

test('product and order detail requests are cancelled and identity-guarded', async () => {
  const [product, orders, api] = await Promise.all([
    read('../src/pages/Product.jsx'), read('../src/pages/admin/Orders.jsx'), read('../src/lib/api.js'),
  ]);
  assert.match(product, /new AbortController\(\)/);
  assert.match(product, /if \(!active\) return/);
  assert.match(product, /controller\.abort\(\)/);
  assert.match(product, /querySelectorAll\("script\[data-edge-product\]"\)[\s\S]*?node\.remove\(\)/);
  assert.match(orders, /getOrder\(orderId, \{ signal: controller\.signal \}\)/);
  assert.match(orders, /if \(!active\) return/);
  assert.match(api, /getOrder: \(id, config = \{\}\)/);
  assert.match(orders, /const NEXT_STATUS = Object\.freeze/);
  assert.match(orders, /paymentStatus === 'paid' \? next\.filter\(\(status\) => status !== 'cancelled'\)/);
  assert.match(orders, /status !== 'refunded'/);
});

test('dialogs expose semantics, keyboard dismissal, focus containment, and labels', async () => {
  const [auth, image, orders] = await Promise.all([
    read('../src/components/AuthModal.jsx'), read('../src/components/ImageModal.jsx'), read('../src/pages/admin/Orders.jsx'),
  ]);
  for (const source of [auth, image, orders]) {
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /(?:event|e)\.key === ["']Escape["']/);
    assert.match(source, /querySelectorAll\(/);
  }
  assert.match(auth, /aria-label=\{showPw \? ['"]Hide password/);
  assert.match(image, /aria-label="Product image viewer"/);
  assert.doesNotMatch(image, /aria-labelledby="image-modal-title"/);
  assert.match(image, /imageCount > 1 && e\.key === "ArrowRight"/);
  assert.match(image, /imageCount > 1 && e\.key === "ArrowLeft"/);
  assert.match(image, /data-testid="image-modal-empty"/);
});

test('NotFound marks arbitrary SPA routes noindex and normal SEO cleanup restores robots metadata', async () => {
  const [seo, notFound] = await Promise.all([read('../src/lib/seo.jsx'), read('../src/pages/NotFound.jsx')]);
  assert.match(notFound, /useSEO\(\{ title: "Page not found", noindex: true \}\)/);
  assert.match(seo, /noindex = false/);
  assert.match(seo, /noindex, nofollow/);
  assert.match(seo, /data-reflexity-seo/);
  assert.match(seo, /return \(\) => \{/);
});

test('unknown guide slugs render a noindex guide-not-found state using the restored shop route', async () => {
  const guides = await read('../src/pages/Guides.jsx');
  assert.match(guides, /const unknownGuide = Boolean\(slug && !guide\)/);
  assert.match(guides, /useSEO\(\{ title, description, noindex: unknownGuide \}\)/);
  assert.match(guides, /data-testid="guide-not-found-page"/);
  assert.match(guides, /<Link to="\/shop" className="btn-secondary">View inventory<\/Link>/);
});

test('deactivated and replaced sessions are cleared or revalidated across tabs', async () => {
  const [api, app] = await Promise.all([read('../src/lib/api.js'), read('../src/App.jsx')]);
  assert.match(api, /authError\.includes\('deactivated'\)/);
  assert.match(app, /const nextToken = event\.newValue/);
  assert.match(app, /void current\.initialize\(\)/);
});

test('the storefront publishes a canonical security contact', async () => {
  const [wellKnown, rootCopy] = await Promise.all([
    read('../public/.well-known/security.txt'),
    read('../public/security.txt'),
  ]);
  assert.equal(rootCopy, wellKnown);
  assert.match(wellKnown, /^Contact: mailto:reflexityram@gmail\.com$/m);
  assert.match(wellKnown, /^Canonical: https:\/\/reflexityram\.com\/\.well-known\/security\.txt$/m);
  assert.match(wellKnown, /^Expires: 2027-08-26T00:00:00Z$/m);
});

test('dynamic JSON-LD cannot terminate its data script', () => {
  const serialized = serializeJsonLd({ name: '</script><img src=x>' });
  assert.doesNotMatch(serialized, /</);
  assert.deepEqual(JSON.parse(serialized), { name: '</script><img src=x>' });
});

test('guest order proof is cleaned before API use and survives only in the browser session', async () => {
  const [orderSuccess, api] = await Promise.all([
    read('../src/pages/OrderSuccess.jsx'),
    read('../src/lib/api.js'),
  ]);
  assert.match(orderSuccess, /window\.sessionStorage\.setItem\(storageKey, guestEmail\)/);
  assert.match(orderSuccess, /window\.history\.replaceState\(\{\}, '', window\.location\.pathname\)/);
  assert.match(api, /headers: email \? \{ 'x-order-email': email \} : \{\}/);
  assert.doesNotMatch(api, /params: email \? \{ email \}/);
});

// The summary listed Subtotal, Shipping and Total only, so for a taxed order the
// rows never added up (585 + 14 shown, 676.87 charged).
test('the order page lists the tax, so its summary adds up to the total', async () => {
  const orderSuccess = await read('../src/pages/OrderSuccess.jsx');
  const summary = orderSuccess.slice(orderSuccess.indexOf('>Subtotal<'), orderSuccess.indexOf('<span>Total</span>'));
  assert.match(summary, /order\.tax > 0 && \(/);
  assert.match(summary, />Tax</);
});

// The order page is also the status page the shipping email links to: it used to
// say "Order confirmed!" for a delivered parcel and showed the tracking number
// as plain text.
test('the order page headline follows the order status and tracking opens Canada Post', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /case 'shipped':[\s\S]*?title: 'Your order is on its way'/);
  assert.match(page, /case 'delivered':[\s\S]*?title: 'Your order was delivered'/);
  assert.match(page, /<a href=\{order\.trackingUrl\} target="_blank" rel="noopener noreferrer"/);
});

// Most buyers check out as guests; for them "View all orders" opened a sign-in wall.
test('only signed-in customers get the "View all orders" button', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /isAuthenticated\(\) && \(\s*<Link to="\/account\?tab=orders"/);
});

// Owner's rule (2026-10-05): 1–2 sticks ship for $14, 3 or more for $25.
test('the product page, checkout and shipping policies state the stick-count shipping rule', async () => {
  const [currency, product, checkout, shipping, international] = await Promise.all([
    read('../src/lib/currency.js'),
    read('../src/pages/Product.jsx'),
    read('../src/pages/Checkout.jsx'),
    read('../src/pages/policies/Shipping.jsx'),
    read('../src/pages/policies/International.jsx'),
  ]);
  assert.match(currency, /export const LARGE_ORDER_MIN_STICKS = 3;/);
  assert.match(currency, /export const LARGE_ORDER_SHIPPING_PRICE = 25;/);
  assert.match(product, /hasOwnShippingPrice\(p\) \? '' : ` \(\$\{formatStorePriceWithCode\(LARGE_ORDER_SHIPPING_PRICE, 0\)\} for \$\{LARGE_ORDER_MIN_STICKS\}\+ sticks\)`/);
  assert.match(checkout, /\$14 for 1–2 sticks, \$25 for 3 or more/);
  for (const policy of [shipping, international]) assert.match(policy, /\$14 CAD for 1–2 sticks and \$25 CAD for 3 or more/);
});

// Canada Post tracking sync stores the latest scan on the order; buyers see it under the tracking number.
test('the order page shows the latest Canada Post scan and expected delivery date', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /order\.trackingLatest\?\.description && \(/);
  assert.match(page, /Latest from Canada Post:/);
  assert.match(page, /Canada Post expects to deliver it/);
});

// Every listing records where the module was made (needed for US duties).
test('the admin product form asks where the module was made and the product page shows it', async () => {
  const [admin, product] = await Promise.all([read('../src/pages/admin/Products.jsx'), read('../src/pages/Product.jsx')]);
  assert.match(admin, /data-testid="product-country-of-origin"/);
  assert.match(admin, /\['KR', 'Korea'\]/);
  assert.match(admin, /countryOfOrigin: form\.countryOfOrigin \|\| null/);
  assert.match(product, /\["Made in", p\.countryOfOrigin \?/);
});

// Outside Canada buyers pick their country and a Canada Post service priced live.
test('checkout ships abroad with live Canada Post options and a duties notice', async () => {
  const [checkout, api, picker] = await Promise.all([read('../src/pages/Checkout.jsx'), read('../src/lib/api.js'), read('../src/components/CountryPicker.jsx')]);
  assert.match(checkout, /\[\['CA', 'Canada'\], \['INTL', 'Another country'\]\]/);
  assert.match(picker, /data-testid="checkout-country"/);
  assert.match(checkout, /data-testid="checkout-shipping-options"/);
  assert.match(checkout, /Import taxes and duties are charged by your country on delivery\./);
  assert.match(checkout, /international \? \{ country, serviceCode \} : undefined/);
  assert.match(checkout, /Shipping to the United States or a country not listed\?/);
  assert.match(api, /internationalQuote: \(country\) => api\.post\('\/shipping\/international-quote', \{ country \}\)/);
});

// The native country <select> was unreadable in dark mode; buyers can now type their country.
test('the checkout country picker is searchable, themed and explains the US', async () => {
  const [picker, checkout] = await Promise.all([read('../src/components/CountryPicker.jsx'), read('../src/pages/Checkout.jsx')]);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /background: 'var\(--bg-elev\)'/);
  assert.match(picker, /color: 'var\(--fg\)'/);
  assert.match(picker, /uk: 'GB'/);
  assert.match(picker, /Not on the list\? Canada Post has no tracked service there right now\./);
  assert.doesNotMatch(checkout, /<select className="input" value=\{country\}/);
  assert.match(checkout, /<CountryPicker/);
});

// A factory-sealed module was never opened, so it cannot claim "Individually tested".
test('sealed listings say "Factory sealed, unopened" instead of "Individually tested"', async () => {
  const product = await read('../src/pages/Product.jsx');
  assert.match(product, /if \(\/sealed\/i\.test\(p\.name \|\| ""\)\) return "Factory sealed, unopened";/);
  assert.match(product, /\[conditionBadge\(p\), `\$\{p\.warranty\} warranty`/);
});

// Checkout ships abroad now, so the product page and the International page's search text stop saying "custom orders".
test('the product page and International metadata describe checkout abroad', async () => {
  const [product, metadata, international] = await Promise.all([read('../src/pages/Product.jsx'), read('../functions-shared/staticMetadata.js'), read('../src/pages/policies/International.jsx')]);
  assert.match(product, /Many countries check out here at Canada Post's price, tracked\. US orders by quote\./);
  assert.doesNotMatch(product, /We ship worldwide as custom orders/);
  assert.match(metadata, /Ship Reflexity RAM abroad with Canada Post: tracked, at Canada Post's price at checkout\. US orders by quote\./);
  assert.match(international, /<h2>Checking out from outside Canada<\/h2>/);
});

// While the country list loads, an empty list is not "Not on the list?".
test('the country picker says it is loading instead of "not on the list" while countries load', async () => {
  const [picker, checkout] = await Promise.all([read('../src/components/CountryPicker.jsx'), read('../src/pages/Checkout.jsx')]);
  assert.match(picker, /Loading countries…/);
  assert.match(picker, /matches\.length === 0 && !wantsUnavailable && !loading/);
  assert.match(checkout, /loading=\{countriesLoading\}/);
  assert.match(checkout, /\.finally\(\(\) => setCountriesLoading\(false\)\)/);
});

// Listing cards were too tall and soft: trimmed photos at full opacity, compact text, two per row on phones.
test('product cards are compact, full-opacity and say nothing about shipping only in Canada', async () => {
  const [card, shop, home] = await Promise.all([read('../src/components/ProductCard.jsx'), read('../src/pages/Shop.jsx'), read('../src/pages/Home.jsx')]);
  assert.doesNotMatch(card, /opacity-90/);
  assert.doesNotMatch(card, /Ships in Canada/);
  assert.match(card, /imageUrl\(image, \{ width: 640, trim: true \}\)/);
  assert.match(card, /aspect-\[2\/1\] bg-white/);
  assert.match(card, /line-clamp-3 sm:line-clamp-2/);
  assert.match(shop, /Ships from Toronto, tracked, across Canada and abroad/);
  assert.match(home, /grid grid-cols-2 lg:grid-cols-3/);
});
