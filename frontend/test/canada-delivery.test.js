import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FASTER_SHIPPING_MAX_STICKS, FASTER_SHIPPING_UPCHARGE, SIGNATURE_PRICE } from '../src/lib/currency.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// Owner (2026-10-05): "i dont wanna let canadian buyers choose like 100 dollar shipping ... just make it the same basic
// shipping ... add an option, pay more for faster shipping, so i make more". Standard stays the flat rate; one flat
// Faster option (Xpresspost) and a signature checkbox are the only choices. No postal code, no live prices.
test('checkout offers Standard, one flat Faster option and a signature box, and nothing to look up', async () => {
  const [checkout, api] = await Promise.all([read('../src/pages/Checkout.jsx'), read('../src/lib/api.js')]);
  assert.match(checkout, /testId="checkout-speed-standard"/);
  assert.match(checkout, /testId="checkout-speed-faster"/);
  assert.match(checkout, /data-testid="checkout-signature"/);
  assert.match(checkout, /data-testid="checkout-faster-unavailable"/);
  // no postal code field, no quote request, no Canada Post service list
  assert.doesNotMatch(checkout, /checkout-postal-code|canadaQuote|isPostalCode|lib\/postalCode|Priority/);
  assert.doesNotMatch(api, /canadaQuote|canada-quote/);
  // the Faster price comes from the cart API (the server's number), the signature price is a constant
  assert.match(checkout, /const \{ items, subtotal, shipping, shippingFaster, itemCount, fetchCart, isLoading \} = useCartStore\(\);/);
  assert.match(checkout, /\(useFaster \? shippingFaster : Number\(shipping \|\| 0\)\) \+ \(signature \? SIGNATURE_PRICE : 0\)/);
  assert.match(checkout, /price=\{shippingFaster\}/);
});

test('checkout sends two yes/no choices and no prices, and only when the buyer chose something', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /\(useFaster \|\| signature\)\s*\? \{ country: 'CA', faster: useFaster, signature \}\s*: undefined/);
  // Faster is only offered when the cart API says so (null for a big order), so a stale tick cannot be sent
  assert.match(checkout, /const canFaster = Number\.isFinite\(shippingFaster\);/);
  assert.match(checkout, /const useFaster = faster && canFaster;/);
  // GA4 hears which shipping was chosen
  assert.match(checkout, /trackEvent\('add_shipping_info', \{[\s\S]*?shipping_tier: tier,/);
  assert.match(checkout, /`\$\{useFaster \? 'Faster' : 'Standard'\}\$\{signature \? ' \+ signature' : ''\}`/);
});

test('a big order sees why there is no Faster option, with a way to ask', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /!canFaster && Number\(itemCount\) > FASTER_SHIPPING_MAX_STICKS/);
  assert.match(checkout, /Faster shipping is not offered on orders of more than \{FASTER_SHIPPING_MAX_STICKS\} sticks\./);
  assert.match(checkout, /mailto:reflexityram@gmail\.com\?subject=Faster%20shipping%20for%20a%20large%20order/);
});

test('the cart store keeps the Faster price from every cart response', async () => {
  const store = await read('../src/lib/cartStore.js');
  assert.match(store, /shippingFaster: null,/);
  assert.equal((store.match(/shippingFaster: data\.cart\.shippingFaster \?\? null,/g) || []).length, 4, 'fetch, add, update and remove');
  assert.equal((store.match(/shippingFaster: null, itemCount: 0/g) || []).length, 2, 'both ways of clearing');
});

test('the order page says which delivery the buyer paid for', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /data-testid="order-shipping-method">\{order\.shippingMethod\}/);
});

test('the numbers the page shows match the server\'s (backend/src/config/shipping.js)', async () => {
  const backend = await read('../../backend/src/config/shipping.js');
  const num = (name) => Number(backend.match(new RegExp(`const ${name} = (\\d+);`))[1]);
  assert.equal(FASTER_SHIPPING_UPCHARGE, num('FASTER_SHIPPING_UPCHARGE'));
  assert.equal(FASTER_SHIPPING_MAX_STICKS, num('FASTER_SHIPPING_MAX_STICKS'));
  assert.equal(SIGNATURE_PRICE, num('SIGNATURE_PRICE'));
});

test('the Shipping policy tells buyers about Faster shipping (the saved page and the built-in copy say the same)', async () => {
  const policy = await read('../src/pages/policies/Shipping.jsx');
  assert.match(policy, /If you would like it sooner, choose Faster shipping at checkout \(Canada Post Xpresspost, typically 1–3 business days after dispatch\) for \$12 more on orders of up to 6 sticks; a signature on delivery can be added to any order for \$2\./);
  assert.doesNotMatch(policy, /postal code at checkout|Xpresspost or Priority/);
});

test('the product page tells buyers about Faster shipping before checkout', async () => {
  const product = await read('../src/pages/Product.jsx');
  assert.match(product, /Want it sooner\? Faster shipping is \+\$\{formatStorePriceWithCode\(FASTER_SHIPPING_UPCHARGE, 0\)\} at checkout\./);
});
