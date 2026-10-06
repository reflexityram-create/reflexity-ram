const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// No test may send a real email.
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } },
};
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_faster_shipping_unit_test';

const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const {
  FASTER_SHIPPING_UPCHARGE,
  FASTER_SHIPPING_MAX_STICKS,
  FASTER_SHIPPING_LABEL,
  SIGNATURE_PRICE,
  resolveCartShippingPrice,
  resolveFasterShippingPrice,
} = require('../src/config/shipping');
const cartRouter = require('../src/routes/cart');
const shippingRouter = require('../src/routes/shipping');
const stripeRouter = require('../src/routes/stripe');

const line = (qty, product = { line: 'Server', price: 135 }) => ({ product, qty });

// Owner (2026-10-05): "just make it the same basic shipping unless they order a crap ton of RAM ... add an option,
// pay more for faster shipping, so I make more". One flat extra, no live prices, nothing to look up.
test('Faster shipping is the cart\'s flat rate plus a flat $12, offered up to 6 sticks', () => {
  assert.equal(FASTER_SHIPPING_UPCHARGE, 12);
  assert.equal(FASTER_SHIPPING_MAX_STICKS, 6);
  assert.equal(SIGNATURE_PRICE, 2);
  assert.equal(resolveFasterShippingPrice([line(1)]), 26);
  assert.equal(resolveFasterShippingPrice([line(2)]), 26);
  assert.equal(resolveFasterShippingPrice([line(3)]), 37);
  assert.equal(resolveFasterShippingPrice([line(1), line(5)]), 37, 'sticks are counted across lines');
  assert.equal(resolveFasterShippingPrice([line(6)]), 37);
});

test('a big order has no Faster shipping (Xpresspost costs $50 or more to the west), and an empty cart has none either', () => {
  assert.equal(resolveFasterShippingPrice([line(7)]), null);
  assert.equal(resolveFasterShippingPrice([line(27), line(10)]), null);
  assert.equal(resolveFasterShippingPrice([]), null);
  assert.equal(resolveFasterShippingPrice(), null);
  // ...while the flat rate itself is unchanged for big orders
  assert.equal(resolveCartShippingPrice([line(27)]), 25);
});

test('a product with its own shipping rate carries it into Faster shipping (rate plus the flat extra)', () => {
  assert.equal(resolveFasterShippingPrice([line(1, { line: 'Server', shippingPrice: 20 })]), 32);
  assert.equal(resolveFasterShippingPrice([line(1), line(1, { line: 'Server', shippingPrice: 30 })]), 42, 'the highest rate, never the sum');
});

// ── the cart API tells the page what Faster shipping would cost ───────────────────────────────
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/cart', cartRouter);
  a.use('/api/shipping', shippingRouter);
  a.use('/api/stripe', stripeRouter);
  return a;
};
const call = async (path, body, method = 'POST') => {
  const server = http.createServer(app());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
const withCart = async (qty, run) => {
  const originals = { cartFindOne: Cart.findOne, productFind: Product.find };
  const doc = { _id: 'p1', slug: 'ddr4-16gb', name: '16GB DDR4', price: 170, stock: 'in', stockQuantity: 50, isActive: true, line: 'Server' };
  Cart.findOne = (filter) => {
    const cart = { _id: 'cart-id', items: [{ slug: 'ddr4-16gb', name: '16GB DDR4', price: 170, qty, product: doc }], save: async () => undefined };
    const result = Promise.resolve(cart);
    result.populate = async () => cart;
    return result;
  };
  Product.find = () => ({ select: () => Promise.resolve([doc]), lean: async () => [doc], then: (resolve, reject) => Promise.resolve([doc]).then(resolve, reject) });
  try { await run(); } finally { Cart.findOne = originals.cartFindOne; Product.find = originals.productFind; }
};

test('GET /api/cart carries the flat rate and the Faster price, and null for a big order', async () => {
  for (const [qty, shipping, faster] of [[1, 14, 26], [2, 14, 26], [3, 25, 37], [6, 25, 37], [7, 25, null], [30, 25, null]]) {
    await withCart(qty, async () => {
      const res = await call('/api/cart', undefined, 'GET');
      assert.equal(res.status, 200, `qty ${qty}`);
      assert.deepEqual({ shipping: res.body.cart.shipping, shippingFaster: res.body.cart.shippingFaster }, { shipping, shippingFaster: faster }, `qty ${qty}`);
    });
  }
});

// ── checkout sessions ──────────────────────────────────────────────────────────────────────────
const checkout = async (qty, shipping) => {
  let payload;
  stripeRouter.setCheckoutDependenciesForTest({
    ensurePrice: async () => 'price_ddr4_16gb',
    createSession: async (sent) => { payload = sent; return { id: 'cs_faster', url: 'https://stripe.test/faster' }; },
  });
  try {
    let response;
    await withCart(qty, async () => { response = await call('/api/stripe/create-checkout-session', shipping === undefined ? {} : { shipping }); });
    return { response, payload };
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
  }
};
const rateOf = (payload) => payload.shipping_options[0].shipping_rate_data;

test('checkout without a choice charges exactly the flat rate, as before', async () => {
  for (const [qty, cents] of [[1, 1400], [2, 1400], [3, 2500], [12, 2500]]) {
    for (const shipping of [undefined, { country: 'CA' }, { country: 'CA', faster: false, signature: false }]) {
      const { response, payload } = await checkout(qty, shipping);
      assert.equal(response.status, 200);
      assert.equal(rateOf(payload).fixed_amount.amount, cents, `qty ${qty}`);
      assert.equal(payload.metadata.canadaPostService, undefined);
    }
  }
});

test('checkout charges the flat Faster price, with the signature on top, and tells Stripe what it is', async () => {
  let { response, payload } = await checkout(2, { country: 'CA', faster: true });
  assert.equal(response.status, 200);
  assert.equal(rateOf(payload).fixed_amount.amount, 2600);
  assert.equal(rateOf(payload).display_name, FASTER_SHIPPING_LABEL);
  assert.equal(rateOf(payload).tax_behavior, 'exclusive', 'Stripe Tax adds the buyer\'s tax');
  assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['CA'] });
  assert.deepEqual(
    { country: payload.metadata.shippingCountry, service: payload.metadata.canadaPostService, signature: payload.metadata.signature, transit: payload.metadata.canadaPostTransitDays },
    { country: 'CA', service: 'DOM.XP', signature: 'no', transit: '3' },
  );
  assert.equal(payload.custom_text, undefined, 'no import-duty notice inside Canada');

  ({ response, payload } = await checkout(4, { country: 'CA', faster: true, signature: true }));
  assert.equal(response.status, 200);
  assert.equal(rateOf(payload).fixed_amount.amount, 3900, '$25 + $12 + $2');
  assert.equal(rateOf(payload).display_name, `${FASTER_SHIPPING_LABEL} + signature on delivery`);
  assert.equal(payload.metadata.signature, 'yes');

  ({ response, payload } = await checkout(2, { country: 'CA', signature: true }));
  assert.equal(response.status, 200);
  assert.equal(rateOf(payload).fixed_amount.amount, 1600, 'the flat $14 plus the $2 signature');
  assert.match(rateOf(payload).display_name, /^Flat-Rate Shipping .* \+ signature on delivery$/);
  assert.deepEqual({ service: payload.metadata.canadaPostService, signature: payload.metadata.signature }, { service: 'STANDARD', signature: 'yes' });
  assert.equal(payload.metadata.canadaPostTransitDays, undefined);
});

test('checkout takes only yes/no choices: a price, a service or a postal code from the client changes nothing or is refused', async () => {
  // a price smuggled in beside the choice is ignored
  let { response, payload } = await checkout(2, { country: 'CA', faster: true, price: 1, amount: 100, shippingCost: 0 });
  assert.equal(response.status, 200);
  assert.equal(rateOf(payload).fixed_amount.amount, 2600);
  // "faster" must be exactly true
  for (const faster of ['true', 1, 'yes', {}]) {
    ({ response, payload } = await checkout(2, { country: 'CA', faster }));
    assert.equal(response.status, 200);
    assert.equal(rateOf(payload).fixed_amount.amount, 1400, `faster=${JSON.stringify(faster)} is not a yes`);
  }
  // a page open from before the flat options still sends a postal code and a service code: told to reload
  for (const shipping of [
    { country: 'CA', postalCode: 'V6B1A1', serviceCode: 'DOM.XP' },
    { country: 'CA', postalCode: 'V6B1A1', serviceCode: 'DOM.PC', signature: true },
    { country: 'CA', postalCode: 'V6B1A1', signature: true },
    { country: 'CA', serviceCode: 'DOM.XP' },
  ]) {
    ({ response } = await checkout(2, shipping));
    assert.equal(response.status, 400, JSON.stringify(shipping));
    assert.match(response.body.error, /reload the page/);
  }
});

test('Faster shipping is refused for a big order, the flat rate and the signature are not', async () => {
  let { response } = await checkout(7, { country: 'CA', faster: true });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Email us/);
  ({ response } = await checkout(30, { country: 'CA', faster: true, signature: true }));
  assert.equal(response.status, 400);
  let { payload } = await checkout(30, { country: 'CA', signature: true });
  assert.equal(rateOf(payload).fixed_amount.amount, 2700, 'a big order still ships for the flat $25 (+ $2 signature)');
});

// ── the order the owner makes the label from ────────────────────────────────────────────────────
test('a paid order says which Canada Post service and option to buy, and dates delivery from Xpresspost\'s 3 days', async () => {
  const originals = [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate];
  const created = [];
  const session = (id, metadata, label) => ({
    id, payment_status: 'paid',
    metadata: { userId: 'guest', cartSessionId: 'session_0123456789', ...metadata },
    line_items: { data: [{ price: { id: 'price_ddr4_16gb', unit_amount: 17000 }, quantity: 1 }] },
    amount_subtotal: 17000, amount_total: 19600,
    total_details: { amount_discount: 0, amount_shipping: 2600, amount_tax: 0 },
    shipping_cost: { shipping_rate: { display_name: label } },
    customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Vancouver', state: 'BC', postal_code: 'V6B 1A1', country: 'CA' } },
    payment_intent: `pi_${id}`,
  });
  try {
    Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-16gb', sku: 'DDR4-16', name: '16GB DDR4', images: [] });
    Order.findOne = async () => null;
    Order.create = async (values) => { created.push(values); return { ...values, _id: 'order-id', orderNumber: `RFX-${created.length}`, stockDecremented: true }; };
    Cart.findOneAndUpdate = async () => undefined;
    const sessions = {
      cs_fast: session('cs_fast', { shippingCountry: 'CA', canadaPostService: 'DOM.XP', signature: 'yes', canadaPostTransitDays: '3' }, `${FASTER_SHIPPING_LABEL} + signature on delivery`),
      cs_fast_only: session('cs_fast_only', { shippingCountry: 'CA', canadaPostService: 'DOM.XP', signature: 'no', canadaPostTransitDays: '3' }, FASTER_SHIPPING_LABEL),
      cs_flat: session('cs_flat', {}, 'Flat-Rate Shipping'),
      cs_flat_signed: session('cs_flat_signed', { shippingCountry: 'CA', canadaPostService: 'STANDARD', signature: 'yes' }, 'Flat-Rate Shipping + signature on delivery'),
    };
    stripeRouter.setCheckoutDependenciesForTest({ retrieveSession: async (id) => sessions[id], decrementStock: async () => true });
    const server = http.createServer(app());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      for (const id of Object.keys(sessions)) {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${id}`);
        assert.equal(res.status, 200, id);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const [fast, fastOnly, flat, flatSigned] = created;
    assert.equal(fast.adminNotes, `SHIPPING: the buyer paid for "${FASTER_SHIPPING_LABEL} + signature on delivery". When you make the label, buy Xpresspost and add the Signature option.`);
    assert.equal(fastOnly.adminNotes, `SHIPPING: the buyer paid for "${FASTER_SHIPPING_LABEL}". When you make the label, buy Xpresspost.`);
    assert.equal(flat.adminNotes, undefined, 'a plain flat-rate order needs no note');
    assert.match(flatSigned.adminNotes, /When you make the label, add the Signature option\.$/);
    assert.doesNotMatch(flatSigned.adminNotes, /buy /);
    const daysAway = (order) => Math.round((order.estimatedDelivery - Date.now()) / 86400000);
    assert.ok(daysAway(fast) >= 9 && daysAway(fast) <= 11, `faster: ${daysAway(fast)} days`); // 3 dispatch + 3 transit + 1 = 7 business days
    assert.ok(daysAway(flat) >= 10 && daysAway(flat) <= 13, `flat rate: ${daysAway(flat)} days`); // 3 + 6 = 9 business days
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate] = originals;
  }
});

// Stripe hands back shipping_cost.shipping_rate as an ID unless the retrieve asks to expand it, so before 2026-10-06 every order recorded "Standard Shipping" whatever
// the buyer chose (the test above gives the session an already-expanded rate, which real Stripe does not). This fake behaves like Stripe: the rate object comes back
// only when the expansion is requested.
test('the order records the shipping option the buyer paid for: the fulfilment asks Stripe to expand the rate', async () => {
  const originals = [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate];
  const created = [];
  let asked = [];
  try {
    Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-16gb', sku: 'DDR4-16', name: '16GB DDR4', images: [] });
    Order.findOne = async () => null;
    Order.create = async (values) => { created.push(values); return { ...values, _id: 'order-id', orderNumber: 'RFX-1', stockDecremented: true }; };
    Cart.findOneAndUpdate = async () => undefined;
    const label = `${FASTER_SHIPPING_LABEL} + signature on delivery`;
    const retrieveSession = async (id, options = {}) => {
      asked = options.expand || [];
      return {
        id, payment_status: 'paid',
        metadata: { userId: 'guest', cartSessionId: 'session_0123456789', shippingCountry: 'CA', canadaPostService: 'DOM.XP', signature: 'yes', canadaPostTransitDays: '3' },
        line_items: { data: [{ price: { id: 'price_ddr4_16gb', unit_amount: 17000 }, quantity: 1 }] },
        amount_subtotal: 17000, amount_total: 19600,
        total_details: { amount_discount: 0, amount_shipping: 2600, amount_tax: 0 },
        shipping_cost: { shipping_rate: asked.includes('shipping_cost.shipping_rate') ? { id: 'shr_fast', display_name: label } : 'shr_fast' },
        customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Vancouver', state: 'BC', postal_code: 'V6B 1A1', country: 'CA' } },
        payment_intent: 'pi_expand',
      };
    };
    stripeRouter.setCheckoutDependenciesForTest({ retrieveSession, decrementStock: async () => true });
    const server = http.createServer(app());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=cs_expand`);
      assert.equal(res.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.ok(asked.includes('shipping_cost.shipping_rate'), `the retrieve must expand the shipping rate, it asked for ${asked.join(', ')}`);
    assert.equal(created.length, 1);
    assert.equal(created[0].shippingMethod, label, 'the stored label is the option the buyer paid for, not the "Standard Shipping" fallback');
    assert.match(created[0].adminNotes, /^SHIPPING: the buyer paid for "Faster shipping[^"]*\+ signature on delivery"\./);
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate] = originals;
  }
});

test('the live-quote endpoint and its Canada Post rating code are gone', () => {
  assert.equal(typeof require('../src/utils/canadaPost').rateDomestic, 'undefined');
  const routes = shippingRouter.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(routes.sort(), ['/countries', '/international-quote']);
});
