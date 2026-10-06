import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// Owner (2026-10-05): "add tiers, faster, safer shipping": Standard stays the default, a postal code reveals Canada
// Post's faster services at their live price, and a signature can be added.
test('checkout keeps the flat rate as the default and reveals faster Canada Post services for a postal code', async () => {
  const [checkout, api] = await Promise.all([read('../src/pages/Checkout.jsx'), read('../src/lib/api.js')]);
  assert.match(api, /canadaQuote: \(postalCode\) => api\.post\('\/shipping\/canada-quote', \{ postalCode \}\)/);
  assert.match(checkout, /const \[speed, setSpeed\] = useState\('STANDARD'\)/);
  assert.match(checkout, /data-testid="checkout-delivery-speed"/);
  assert.match(checkout, /testId="checkout-speed-standard"/);
  assert.match(checkout, /testId=\{`checkout-speed-\$\{o\.serviceCode\}`\}/);
  assert.match(checkout, /data-testid="checkout-postal-code"/);
  assert.match(checkout, /data-testid="checkout-signature"/);
  // only a complete, valid postal code asks Canada Post; anything else puts the flat rate back
  assert.match(checkout, /if \(!isPostalCode\(postal\)\) \{[\s\S]*?setSpeed\('STANDARD'\);[\s\S]*?setSignature\(false\);/);
  assert.match(checkout, /shippingApi\.canadaQuote\(code\)/);
  // a quote that fails never blocks checkout: the flat rate is still there
  assert.match(checkout, /Standard delivery still works/);
});

test('checkout sends nothing extra for the flat rate, and the postal code with the choice otherwise', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /\(speed !== 'STANDARD' \|\| signature\)\s*\? \{ country: 'CA', postalCode: fast\.postalCode, \.\.\.\(speed !== 'STANDARD' \? \{ serviceCode: speed \} : \{\}\), signature \}\s*: undefined/);
  // the amount shown is the amount the server will charge: the quoted price (or the flat rate) plus the signature
  assert.match(checkout, /\(fastChoice \? fastChoice\.price : Number\(shipping \|\| 0\)\) \+ signatureExtra/);
  // the page and the buyer's cart agree on the sentence for the default
  assert.match(checkout, /Canada Post, tracked: \$14 for 1–2 sticks, \$25 for 3 or more/);
});

test('the order page says which delivery the buyer paid for', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /data-testid="order-shipping-method">\{order\.shippingMethod\}/);
});

test("GA4 hears which delivery the buyer chose (shipping_tier), so the owner can see whether anyone wants the faster ones", async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /trackEvent\('add_shipping_info', \{[\s\S]*?shipping_tier: tier,/);
  assert.match(checkout, /`\$\{fastChoice \? fastChoice\.name : 'Standard'\}\$\{signature \? ' \+ signature' : ''\}`/);
});
