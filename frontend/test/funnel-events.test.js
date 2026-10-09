import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('product cards measure visible impressions once and preserve list context on selection', async () => {
  const card = await source('components/ProductCard.jsx');
  assert.match(card, /IntersectionObserver/);
  assert.match(card, /impressionTracked\.current/);
  assert.match(card, /trackEvent\("view_item_list"/);
  assert.match(card, /trackEvent\("select_item"/);
  assert.match(card, /item_list_id: itemListId/);
});

test('cart funnel events are tied to loaded state and successful mutations', async () => {
  const cart = await source('pages/Cart.jsx');
  assert.match(cart, /trackEvent\('view_cart'/);
  assert.match(cart, /trackEvent\('remove_from_cart'/);
  assert.match(cart, /trackEvent\('cart_quantity_change'/);
  assert.match(cart, /!useCartStore\.getState\(\)\.items\.some/);
  assert.match(cart, /Number\(updated\.qty\) === Number\(qty\)/);
  assert.doesNotMatch(cart, /trackEvent\('begin_checkout'/);
});

test('checkout begins on entry and reports a bounded error reason', async () => {
  const checkout = await source('pages/Checkout.jsx');
  assert.match(checkout, /trackEvent\('begin_checkout'/);
  assert.match(checkout, /beginCheckoutTracked\.current/);
  assert.match(checkout, /trackEvent\('checkout_redirect'/);
  assert.match(checkout, /trackEvent\('checkout_error'/);
  assert.match(checkout, /const reason = err\?\.response\?\.status >= 500/);
  assert.match(checkout, /'server_error'/);
  assert.match(checkout, /'request_rejected'/);
  assert.match(checkout, /'network_error'/);
});

test('checkout return records complete, pending, error and missing-session outcomes', async () => {
  const returned = await source('pages/CheckoutReturn.jsx');
  for (const outcome of ['missing_session', 'complete', 'pending', 'error']) {
    assert.match(returned, new RegExp(`outcome: ['"]${outcome}['"]`));
  }
  assert.match(returned, /trackPurchaseOnce\(data\)/);
  const payloads = [...returned.matchAll(/trackEvent\('checkout_return',\s*\{([\s\S]*?)\}\)/g)].map((match) => match[1]);
  assert.equal(payloads.length, 4);
  for (const payload of payloads) {
    assert.doesNotMatch(payload, /email|address/i);
  }
});
