// Review of 2026-10-14. The server sleeps when idle and can take longer to answer than the browser waits (15 s), so pages
// must tell "could not load" apart from "there is nothing": the product page said "isn't in our catalog", the cart pages said
// "Your cart is empty", and the Shop's "Refresh" button was a link to the page already open (it did nothing).
// The real-browser proof (a server that fails, then answers) is in the owner's project notes, not in this repository.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadFailure } from '../src/lib/loadFailure.js';
import { clearUrlToken, readUrlToken } from '../src/lib/urlToken.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('only a 404 is "not found"; a timeout, a 5xx or no connection is a failure to load, and a cancel is nothing', () => {
  assert.equal(loadFailure({ response: { status: 404 } }), 'not-found');
  assert.equal(loadFailure({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }), 'failed');
  assert.equal(loadFailure({ response: { status: 502 } }), 'failed');
  assert.equal(loadFailure({ response: { status: 500 } }), 'failed');
  assert.equal(loadFailure({ code: 'ERR_NETWORK' }), 'failed');
  assert.equal(loadFailure(undefined), 'failed');
  assert.equal(loadFailure({ code: 'ERR_CANCELED' }), 'cancelled');
  assert.equal(loadFailure({ name: 'CanceledError' }), 'cancelled');
  assert.equal(loadFailure({ name: 'AbortError' }), 'cancelled');
});

test('the product page offers a retry for a failed load and keeps "not in our catalog" for a real 404', async () => {
  const source = await read('../src/pages/Product.jsx');
  assert.match(source, /const outcome = loadFailure\(error\);/);
  assert.match(source, /if \(outcome === 'not-found'\) setNotFound\(true\);\s*else setLoadFailed\(true\);/);
  assert.match(source, /\}, \[slug, attempt\]\);/, 'Try again reads the product again');
  assert.match(source, /title="Could not load this product"[\s\S]{0,300}onCta=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/);
  assert.doesNotMatch(source, /error\?\.code !== 'ERR_CANCELED'\) setNotFound\(true\)/, 'every failure used to read as "not found"');
});

test('one add at a time: a double tap on Add to cart or Buy now sends one request', async () => {
  const source = await read('../src/pages/Product.jsx');
  assert.match(source, /if \(soldOut \|\| addingRef\.current\) return null;\s*addingRef\.current = true;/);
  assert.equal((source.match(/disabled=\{soldOut \|\| adding\}/g) || []).length, 3, 'Add to cart, Buy now and the phone bar Add');
  assert.doesNotMatch(source, /disabled=\{soldOut\}/);
  for (const handler of ['addToCart', 'buyNow']) {
    assert.match(source, new RegExp(`const ${handler} = async \\(\\) => \\{\\s*const result = await addOnce\\(\\);`), handler);
  }
});

test('the Shop\'s button after a failed load reads the catalog again instead of linking to the page already open', async () => {
  const shop = await read('../src/pages/Shop.jsx');
  assert.match(shop, /\}, \[attempt\]\);/);
  assert.match(shop, /ctaLabel="Try again"\s*onCta=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/);
  assert.doesNotMatch(shop, /ctaLabel="Refresh"/);
  const empty = await read('../src/components/EmptyState.jsx');
  assert.match(empty, /\{ctaLabel && onCta && \(\s*<button type="button" onClick=\{onCta\}/);
  assert.match(empty, /\{ctaLabel && ctaTo && !onCta && \(/);
});

test('the cart, checkout and e-Transfer pages show "could not load" with a retry, and a spinner until the first read', async () => {
  for (const page of ['Cart', 'Checkout', 'CheckoutEtransfer']) {
    const source = await read(`../src/pages/${page}.jsx`);
    assert.match(source, /import CartLoadError from '@\/components\/CartLoadError';/, page);
    assert.match(source, /items\.length === 0 && loadFailed/, page);
    assert.match(source, /<CartLoadError onRetry=\{fetchCart\} \/>/, page);
    assert.match(source, /!loaded/, `${page}: spinner until the cart has been read once`);
  }
  const card = await read('../src/components/CartLoadError.jsx');
  assert.match(card, /We could not load your cart/);
  assert.match(card, /role="alert"/);
});

test('a returning buyer\'s header shows the cart count on any page (the cart is read once at start)', async () => {
  const app = await read('../src/App.jsx');
  assert.match(app, /localStorage\.getItem\(CART_SESSION_KEY\) \|\| localStorage\.getItem\(AUTH_TOKEN_KEY\)/);
  assert.match(app, /if \(returning\) useCartStore\.getState\(\)\.fetchCart\(\);/);
  const api = await read('../src/lib/api.js');
  assert.match(api, /export const CART_SESSION_KEY = 'rfx_session_id';/);
  assert.match(api, /localStorage\.getItem\(CART_SESSION_KEY\)/);
});

const fakeLocation = (url) => {
  const parsed = new URL(url);
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
};

test('the reset/verify token is read from the fragment (new links) or the query (links already sent)', () => {
  assert.equal(readUrlToken(fakeLocation('https://reflexityram.com/reset-password#token=abc123')), 'abc123');
  assert.equal(readUrlToken(fakeLocation('https://reflexityram.com/reset-password?token=def456')), 'def456');
  assert.equal(readUrlToken(fakeLocation('https://reflexityram.com/verify-email#token=new1?x')), 'new1?x');
  assert.equal(readUrlToken(fakeLocation('https://reflexityram.com/reset-password')), null);
  assert.equal(readUrlToken(fakeLocation('https://reflexityram.com/reset-password?token=')), null);
});

test('after reading, the token is taken out of the address bar and the history entry, keeping the router\'s state', () => {
  const calls = [];
  const history = { state: { usr: null, key: 'k1', idx: 3 }, replaceState: (...args) => calls.push(args) };
  clearUrlToken(fakeLocation('https://reflexityram.com/reset-password?token=def456'), history);
  assert.deepEqual(calls, [[{ usr: null, key: 'k1', idx: 3 }, '', '/reset-password']]);
  calls.length = 0;
  clearUrlToken(fakeLocation('https://reflexityram.com/reset-password'), history);
  assert.deepEqual(calls, [], 'nothing to clear, no history change');
});

test('both token pages use the helper, and the reset form can be used by keyboard, screen reader and password manager', async () => {
  for (const page of ['ResetPassword', 'VerifyEmail']) {
    const source = await read(`../src/pages/${page}.jsx`);
    assert.match(source, /const \[token\] = useState\(\(\) => readUrlToken\(\)\);/, page);
    assert.match(source, /useEffect\(\(\) => \{ clearUrlToken\(\); \}, \[\]\);/, page);
    assert.doesNotMatch(source, /searchParams\.get\('token'\)/, page);
    assert.match(source, /<h1 /, `${page} has a page heading`);
  }
  const reset = await read('../src/pages/ResetPassword.jsx');
  assert.doesNotMatch(reset, /tabIndex=\{-1\}/, 'the show-password button is reachable by keyboard');
  assert.match(reset, /aria-label=\{showPw \? 'Hide password' : 'Show password'\}/);
  assert.equal((reset.match(/autoComplete="new-password"/g) || []).length, 2);
});

test('the icon-only buttons on the buying path say what they do', async () => {
  const cart = await read('../src/pages/Cart.jsx');
  assert.match(cart, /aria-label=\{`Remove \$\{item\.name\} from cart`\}/);
  const product = await read('../src/pages/Product.jsx');
  assert.match(product, /aria-label=\{`Enlarge the photo of \$\{p\.name\}`\}/);
  assert.match(product, /aria-label=\{`Show photo \$\{i \+ 1\} of \$\{imageUrls\.length\}`\}/);
});
