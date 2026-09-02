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
