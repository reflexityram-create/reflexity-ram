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
process.env.STRIPE_SECRET_KEY ||= 'sk_test_canada_shipping_unit_test';
process.env.CANADA_POST_API_KEY = 'test-key';
process.env.CANADA_POST_API_SECRET = 'test-secret';

const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const canadaPost = require('../src/utils/canadaPost');
const { canadaOptions, canadaOptionLabel, clearCanadaQuoteCacheForTest } = require('../src/utils/canadaShipping');
const { CANADA_POSTAL_CODE, normalizePostalCode } = require('../src/config/shipping');
const shippingRouter = require('../src/routes/shipping');
const stripeRouter = require('../src/routes/stripe');

// Canada Post's answer for a small box to Vancouver, shaped like the real one (2026-10-05) with the Signature
// option requested: `due` includes tax and the signature, which is why the code takes both back out.
const quote = (serviceCode, serviceName, { due, gst = 0, hst = 0, transit, guaranteed = true, signature = 2 }) => ({
  serviceCode,
  serviceName,
  priceDetails: {
    base: due - gst - hst - signature,
    taxes: { gst: { amt: gst, percent: 5 }, pst: { amt: 0, percent: 0 }, hst: { amt: hst, percent: 13 } },
    due,
    options: [
      { optionCode: 'SO', optionName: 'Signature option', optionPrice: signature },
      { optionCode: 'DC', optionName: 'Delivery confirmation', optionPrice: 0, qualifier: { included: true } },
    ],
  },
  serviceStandard: { guaranteedDelivery: guaranteed, expectedTransitTime: transit },
});
const VANCOUVER = [
  quote('DOM.XP', 'Xpresspost', { due: 26.62, gst: 1.27, transit: 2 }), // 25.35 before tax with the signature, 23.35 without
  quote('DOM.PC', 'Priority', { due: 64.04, gst: 3.05, transit: 1 }), // 60.99 / 58.99
  quote('DOM.EP', 'Expedited Parcel', { due: 23.89, gst: 1.14, transit: 4 }), // not a service we offer
  quote('DOM.RP', 'Regular Parcel', { due: 23.89, gst: 1.14, transit: 7, guaranteed: false }), // not a service we offer
];

// Stand-in for Canada Post: a token, then rating responses; records requests.
const withFakeFetch = async (quotes, run) => {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    if (!String(url).includes('canadapost')) return original(url, init);
    requests.push({ url, body: init.body && !String(url).endsWith('/oauth2/token') ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return { ok: true, json: async () => quotes };
  };
  canadaPost.resetTokenCacheForTest();
  clearCanadaQuoteCacheForTest();
  try { await run(requests); } finally { global.fetch = original; }
};

test('postal codes: spaces and case do not matter; letters Canada Post never uses are refused', () => {
  assert.equal(normalizePostalCode(' v6b 1a1 '), 'V6B1A1');
  assert.equal(normalizePostalCode('k1a-0b1'), 'K1A0B1');
  for (const ok of ['M5V2T6', 'V6B1A1', 'X1A2P3', 'A1C5S7', 'Y1A1A1', 'B3H3J5']) assert.ok(CANADA_POSTAL_CODE.test(ok), ok);
  for (const bad of ['D1A1A1', 'M5V2T', 'M5V2T66', '12345', 'M5I2T6', 'M5V2U6', 'W1A1A1', '', 'ABCDEF']) assert.equal(CANADA_POSTAL_CODE.test(bad), false, bad);
});

test('a domestic quote asks Canada Post for this postal code with the signature option, and drops tax and the signature from the price', async () => {
  await withFakeFetch(VANCOUVER, async (requests) => {
    const quotes = await canadaPost.rateDomestic({ postalCode: 'V6B1A1', parcel: { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } }, originPostalCode: 'M1P3T7', services: ['DOM.XP', 'DOM.PC'] });
    const sent = requests.find((r) => r.body).body;
    assert.deepEqual(sent.destination, { domestic: { postalCode: 'V6B1A1' } });
    assert.deepEqual(sent.options, [{ optionCode: 'SO' }]);
    assert.deepEqual(sent.services, ['DOM.XP', 'DOM.PC']);
    assert.equal(sent.originPostalCode, 'M1P3T7');
    const xp = quotes.find((q) => q.serviceCode === 'DOM.XP');
    assert.deepEqual({ price: xp.price, signaturePrice: xp.signaturePrice, transitDays: xp.transitDays, guaranteed: xp.guaranteed }, { price: 25.35, signaturePrice: 2, transitDays: 2, guaranteed: true });
  });
});

test('the faster options are the services we offer, priced without the signature, in our order', async () => {
  await withFakeFetch(VANCOUVER, async () => {
    const { options, signaturePrice } = await canadaOptions({ postalCode: 'V6B1A1', sticks: 2 });
    assert.deepEqual(options.map((o) => [o.serviceCode, o.name, o.price, o.transitDays, o.guaranteed]), [
      ['DOM.XP', 'Xpresspost', 23.35, 2, true],
      ['DOM.PC', 'Priority', 58.99, 1, true],
    ]);
    assert.equal(signaturePrice, 2);
    assert.equal(canadaOptionLabel(options[0]), 'Xpresspost (about 2 business days)');
    assert.equal(canadaOptionLabel(options[1], { signature: true }), 'Priority (about 1 business day) + signature on delivery');
  });
});

test('quotes are cached for an hour per postal code and parcel size', async () => {
  let calls = 0;
  let clock = 1_000;
  const rate = async () => { calls += 1; return VANCOUVER.map((q) => ({ serviceCode: q.serviceCode, price: q.priceDetails.due - 1.27 - 2, signaturePrice: 2, transitDays: 2, guaranteed: true })); };
  clearCanadaQuoteCacheForTest();
  await canadaOptions({ postalCode: 'T2P1J9', sticks: 1, rate, now: () => clock });
  await canadaOptions({ postalCode: 'T2P1J9', sticks: 2, rate, now: () => clock }); // same parcel size
  assert.equal(calls, 1);
  await canadaOptions({ postalCode: 'T2P1J9', sticks: 3, rate, now: () => clock }); // bigger box
  await canadaOptions({ postalCode: 'M5V2T6', sticks: 1, rate, now: () => clock }); // another postal code
  assert.equal(calls, 3);
  clock += 61 * 60 * 1000;
  await canadaOptions({ postalCode: 'T2P1J9', sticks: 1, rate, now: () => clock });
  assert.equal(calls, 4);
});

test('a service Canada Post does not price, or prices at nothing, is left out; no signature price means no signature', async () => {
  const rate = async () => [
    { serviceCode: 'DOM.XP', price: 20, signaturePrice: null, transitDays: 2, guaranteed: true },
    { serviceCode: 'DOM.PC', price: 0, signaturePrice: null, transitDays: 1, guaranteed: true },
  ];
  clearCanadaQuoteCacheForTest();
  const { options, signaturePrice } = await canadaOptions({ postalCode: 'X1A2P3', sticks: 1, rate });
  assert.deepEqual(options.map((o) => [o.serviceCode, o.price]), [['DOM.XP', 20]]);
  assert.equal(signaturePrice, null);
});

// ── the endpoint and the checkout session ────────────────────────────────────────────────────
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/shipping', shippingRouter);
  a.use('/api/stripe', stripeRouter);
  return a;
};
const post = async (path, body) => {
  const server = http.createServer(app());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
const withCart = async (run, qty = 2) => {
  const originals = { cartFindOne: Cart.findOne, productFind: Product.find };
  const docs = [{ _id: 'p1', slug: 'ddr4-16gb', name: '16GB DDR4', price: 170, stock: 'in', stockQuantity: 10, isActive: true, line: 'Server' }];
  Cart.findOne = async () => ({ items: [{ slug: 'ddr4-16gb', qty }] });
  Product.find = () => ({ select: () => Promise.resolve(docs), then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject) });
  try { await run(); } finally { Cart.findOne = originals.cartFindOne; Product.find = originals.productFind; }
};

test('the quote endpoint prices the cart for a postal code and refuses what is not one', async () => {
  await withFakeFetch(VANCOUVER, async () => {
    await withCart(async () => {
      const ok = await post('/api/shipping/canada-quote', { postalCode: 'v6b 1a1' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.postalCode, 'V6B1A1');
      assert.equal(ok.body.sticks, 2);
      assert.deepEqual(ok.body.options.map((o) => [o.serviceCode, o.price]), [['DOM.XP', 23.35], ['DOM.PC', 58.99]]);
      assert.equal(ok.body.signaturePrice, 2);
      assert.equal((await post('/api/shipping/canada-quote', { postalCode: '12345' })).status, 400);
      assert.equal((await post('/api/shipping/canada-quote', {})).status, 400);
    });
  });
});

test('the quote endpoint says so when there is no cart, and when Canada Post is not configured', async () => {
  await withFakeFetch(VANCOUVER, async () => {
    const original = Cart.findOne;
    Cart.findOne = async () => null;
    try {
      const empty = await post('/api/shipping/canada-quote', { postalCode: 'V6B1A1' });
      assert.equal(empty.status, 400);
      assert.match(empty.body.error, /cart is empty/);
    } finally { Cart.findOne = original; }
    const key = process.env.CANADA_POST_API_KEY;
    delete process.env.CANADA_POST_API_KEY;
    try {
      const off = await post('/api/shipping/canada-quote', { postalCode: 'V6B1A1' });
      assert.equal(off.status, 503);
      assert.match(off.body.error, /Standard delivery still works/);
    } finally { process.env.CANADA_POST_API_KEY = key; }
  });
});

test('checkout charges the faster service Canada Post quoted for the postal code, never a price from the client', async () => {
  await withFakeFetch(VANCOUVER, async () => {
    await withCart(async () => {
      let payload;
      stripeRouter.setCheckoutDependenciesForTest({
        ensurePrice: async () => 'price_ddr4_16gb',
        createSession: async (sent) => { payload = sent; return { id: 'cs_ca', url: 'https://stripe.test/ca' }; },
      });
      try {
        const express = await post('/api/stripe/create-checkout-session', { shipping: { country: 'CA', postalCode: 'V6B 1A1', serviceCode: 'DOM.XP', price: 1, amount: 100 } });
        assert.equal(express.status, 200);
        let rate = payload.shipping_options[0].shipping_rate_data;
        assert.equal(rate.fixed_amount.amount, 2335, 'Canada Post\'s price before tax; Stripe Tax adds the buyer\'s tax');
        assert.equal(rate.display_name, 'Xpresspost (about 2 business days)');
        assert.equal(rate.tax_behavior, 'exclusive');
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['CA'] });
        assert.deepEqual(
          { country: payload.metadata.shippingCountry, service: payload.metadata.canadaPostService, signature: payload.metadata.signature, transit: payload.metadata.canadaPostTransitDays },
          { country: 'CA', service: 'DOM.XP', signature: 'no', transit: '2' },
        );
        assert.equal(payload.custom_text, undefined, 'no import-duty notice inside Canada');

        const signed = await post('/api/stripe/create-checkout-session', { shipping: { country: 'CA', postalCode: 'V6B1A1', serviceCode: 'DOM.PC', signature: true } });
        assert.equal(signed.status, 200);
        rate = payload.shipping_options[0].shipping_rate_data;
        assert.equal(rate.fixed_amount.amount, 6099);
        assert.equal(rate.display_name, 'Priority (about 1 business day) + signature on delivery');
        assert.equal(payload.metadata.signature, 'yes');

        // the flat rate with only a signature added: $14 for two sticks + the signature
        const flatSigned = await post('/api/stripe/create-checkout-session', { shipping: { country: 'CA', postalCode: 'V6B1A1', signature: true } });
        assert.equal(flatSigned.status, 200);
        rate = payload.shipping_options[0].shipping_rate_data;
        assert.equal(rate.fixed_amount.amount, 1600);
        assert.match(rate.display_name, /^Flat-Rate Shipping .* \+ signature on delivery$/);
        assert.deepEqual({ service: payload.metadata.canadaPostService, signature: payload.metadata.signature }, { service: 'STANDARD', signature: 'yes' });

        // the flat rate, nothing extra: exactly as before (no shipping field, or the standard choice)
        for (const body of [{}, { shipping: { country: 'CA' } }, { shipping: { country: 'CA', serviceCode: undefined, signature: false } }]) {
          const plain = await post('/api/stripe/create-checkout-session', body);
          assert.equal(plain.status, 200);
          assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, 1400);
          assert.equal(payload.metadata.canadaPostService, undefined);
        }
      } finally {
        stripeRouter.setCheckoutDependenciesForTest();
      }
    });
  });
});

test('checkout refuses a made-up service, a missing postal code, and a service that is not offered there', async () => {
  await withFakeFetch(VANCOUVER, async () => {
    await withCart(async () => {
      stripeRouter.setCheckoutDependenciesForTest({
        ensurePrice: async () => 'price_ddr4_16gb',
        createSession: async () => ({ id: 'cs_ca', url: 'https://stripe.test/ca' }),
      });
      try {
        for (const shipping of [
          { country: 'CA', postalCode: 'V6B1A1', serviceCode: 'DOM.FAKE' },
          { country: 'CA', postalCode: 'V6B1A1', serviceCode: 'DOM.EP' }, // priced by Canada Post, but not a tier we offer
          { country: 'CA', serviceCode: 'DOM.XP' },
          { country: 'CA', postalCode: 'not a code', serviceCode: 'DOM.XP' },
          { country: 'CA', signature: true },
        ]) {
          const refused = await post('/api/stripe/create-checkout-session', { shipping });
          assert.equal(refused.status, 400, JSON.stringify(shipping));
        }
      } finally {
        stripeRouter.setCheckoutDependenciesForTest();
      }
    });
  });
});

// The owner makes the label by hand: the order has to say which service and option the buyer paid for.
test('a paid order says which Canada Post service and option to buy, and dates delivery from its transit time', async () => {
  const originals = [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate];
  const created = [];
  const session = (id, metadata) => ({
    id, payment_status: 'paid',
    metadata: { userId: 'guest', cartSessionId: 'session_0123456789', ...metadata },
    line_items: { data: [{ price: { id: 'price_ddr4_16gb', unit_amount: 17000 }, quantity: 1 }] },
    amount_subtotal: 17000, amount_total: 19535,
    total_details: { amount_discount: 0, amount_shipping: 2535, amount_tax: 0 },
    shipping_cost: { shipping_rate: { display_name: metadata.label || 'Flat-Rate Shipping' } },
    customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Vancouver', state: 'BC', postal_code: 'V6B 1A1', country: 'CA' } },
    payment_intent: `pi_${id}`,
  });
  try {
    Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-16gb', sku: 'DDR4-16', name: '16GB DDR4', images: [] });
    Order.findOne = async () => null;
    Order.create = async (values) => { created.push(values); return { ...values, _id: 'order-id', orderNumber: `RFX-${created.length}`, stockDecremented: true }; };
    Cart.findOneAndUpdate = async () => undefined;
    const sessions = {
      cs_xp: session('cs_xp', { shippingCountry: 'CA', canadaPostService: 'DOM.XP', signature: 'yes', canadaPostTransitDays: '2', label: 'Xpresspost (about 2 business days) + signature on delivery' }),
      cs_flat: session('cs_flat', {}),
      cs_flat_signed: session('cs_flat_signed', { shippingCountry: 'CA', canadaPostService: 'STANDARD', signature: 'yes' }),
    };
    stripeRouter.setCheckoutDependenciesForTest({ retrieveSession: async (id) => sessions[id], decrementStock: async () => true });
    const server = http.createServer(app());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      for (const id of ['cs_xp', 'cs_flat', 'cs_flat_signed']) {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${id}`);
        assert.equal(res.status, 200, id);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const [xp, flat, flatSigned] = created;
    assert.equal(xp.adminNotes, 'SHIPPING: the buyer paid for "Xpresspost (about 2 business days) + signature on delivery". When you make the label, buy DOM.XP and add the Signature option.');
    assert.equal(flat.adminNotes, undefined, 'a plain flat-rate order needs no note');
    assert.match(flatSigned.adminNotes, /add the Signature option\.$/);
    assert.doesNotMatch(flatSigned.adminNotes, /buy /);
    const daysAway = (order) => Math.round((order.estimatedDelivery - Date.now()) / 86400000);
    assert.ok(daysAway(xp) >= 7 && daysAway(xp) <= 10, `Xpresspost: ${daysAway(xp)} days`); // 3 dispatch + 2 transit + 1 = 6 business days
    assert.ok(daysAway(flat) >= 10 && daysAway(flat) <= 13, `flat rate: ${daysAway(flat)} days`); // 3 + 6 = 9 business days
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate] = originals;
  }
});
