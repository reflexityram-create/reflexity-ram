import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// Run the real bootstrap file against a fake page.
async function visit({ hostname, pathname }) {
  const code = await read('../public/merchant-widget-bootstrap.js');
  const appended = [];
  const started = [];
  const window = { location: { hostname, pathname }, merchantwidget: { start: (options) => started.push(options) } };
  const document = {
    head: { appendChild: (element) => appended.push(element) },
    createElement: (tag) => {
      const listeners = {};
      return { tag, addEventListener: (name, fn) => { listeners[name] = fn; }, fire: (name) => listeners[name]?.() };
    },
  };
  vm.runInNewContext(code, { window, document });
  return { appended, started };
}

test("Google's store rating badge loads on the customer site and starts bottom-right once loaded", async () => {
  const { appended, started } = await visit({ hostname: 'reflexityram.com', pathname: '/shop' });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, 'https://www.gstatic.com/shopping/merchant/merchantwidget.js');
  assert.equal(started.length, 0, 'it starts only after Google\'s script has loaded');
  appended[0].fire('load');
  // (the options object is built inside the script's own realm, so compare plain copies)
  assert.deepEqual(JSON.parse(JSON.stringify(started)), [{ position: 'RIGHT_BOTTOM', mobileBottomMargin: 84 }]);
});

test('the badge stays off localhost, preview hosts and private pages', async () => {
  for (const [hostname, pathname] of [
    ['localhost', '/shop'],
    ['abc123.reflexity-ram.pages.dev', '/shop'],
    ['reflexityram.com', '/admin/products'],
    ['reflexityram.com', '/account'],
    ['reflexityram.com', '/review'],
    ['reflexityram.com', '/reset-password'],
  ]) {
    assert.equal((await visit({ hostname, pathname })).appended.length, 0, `${hostname}${pathname}`);
  }
});

// The browser runs classic scripts in ONE shared global scope. Both bootstraps once declared a top-level
// `const privatePath`, so the second threw "Identifier 'privatePath' has already been declared" and the badge
// never loaded on the live site (the per-script tests above each used a fresh scope and missed it).
test('the badge bootstrap and the analytics bootstrap can run on the same page', async () => {
  const [analytics, widget] = await Promise.all([read('../public/analytics-bootstrap.js'), read('../public/merchant-widget-bootstrap.js')]);
  const appended = [];
  const window = { location: { hostname: 'reflexityram.com', pathname: '/shop', search: '' }, merchantwidget: { start() {} } };
  const document = {
    head: { appendChild: (element) => appended.push(element) },
    createElement: (tag) => ({ tag, addEventListener() {} }),
  };
  const page = vm.createContext({ window, document, URLSearchParams, Date });
  new vm.Script(analytics).runInContext(page);
  new vm.Script(widget).runInContext(page);
  assert.deepEqual(
    appended.map((element) => element.src.replace(/\?.*/, '')),
    ['https://www.googletagmanager.com/gtag/js', 'https://www.gstatic.com/shopping/merchant/merchantwidget.js'],
  );
});

test('the badge script is wired in, served as a static file, revalidated, and allowed by the CSP', async () => {
  const [html, headers, routes] = await Promise.all([read('../index.html'), read('../public/_headers'), read('../public/_routes.json')]);
  assert.match(html, /<script defer src="\/merchant-widget-bootstrap\.js"><\/script>/);
  assert.match(headers, /\/merchant-widget-bootstrap\.js\n\s+Cache-Control: public, max-age=0, must-revalidate/);
  assert.ok(JSON.parse(routes).exclude.includes('/merchant-widget-bootstrap.js'));
  // Verified live 2026-10-05: the widget loads from gstatic and frames www.google.com.
  assert.match(headers, /script-src[^;]*https:\/\/www\.gstatic\.com/);
  assert.match(headers, /frame-src[^;]*https:\/\/www\.google\.com/);
});

test('the privacy policy says the badge loads from Google', async () => {
  const privacy = await read('../src/pages/policies/Privacy.jsx');
  assert.match(privacy, /store rating badge/);
  assert.match(privacy, /Google receives the usual request details/);
});

test('the order page gives Google the buyer\'s country and the order\'s own delivery estimate', async () => {
  const optIn = await read('../src/components/GoogleCustomerReviewsOptIn.jsx');
  assert.match(optIn, /delivery_country: order\.shippingAddress\?\.country \|\| "CA"/);
  assert.match(optIn, /estimated_delivery_date: dateOnly\(order\.estimatedDelivery, order\.createdAt\)/);
});
