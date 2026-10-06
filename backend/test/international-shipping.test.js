const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_international_unit_test';
process.env.CANADA_POST_API_KEY = 'test-key';
process.env.CANADA_POST_API_SECRET = 'test-secret';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const canadaPost = require('../src/utils/canadaPost');
const { internationalOptions, clearQuoteCacheForTest } = require('../src/utils/internationalShipping');
const { INTERNATIONAL_COUNTRIES, parcelForSticks } = require('../src/config/shipping');
const shippingRouter = require('../src/routes/shipping');
const stripeRouter = require('../src/routes/stripe');

// Real counter-rate quotes for a small box to the UK (2026-10-05), trimmed.
const UK_QUOTES = [
  { serviceCode: 'INT.IP.SURF', serviceName: 'International Parcel Surface', priceDetails: { due: 65.09 }, serviceStandard: {} },
  { serviceCode: 'INT.SP.AIR', serviceName: 'Small Packet International Air', priceDetails: { due: 28.84 }, serviceStandard: {} },
  { serviceCode: 'INT.TP', serviceName: 'Tracked Packet - International', priceDetails: { due: 68.88 }, serviceStandard: { expectedTransitTime: 7, guaranteedDelivery: false } },
  { serviceCode: 'INT.XP', serviceName: 'Xpresspost International', priceDetails: { due: 94.15 }, serviceStandard: { expectedTransitTime: 6, guaranteedDelivery: true } },
];

// Stand-in for Canada Post: a token, then rating responses; records requests.
const fakeCanadaPost = () => {
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    requests.push({ url, body: init.body ? (url.endsWith('/oauth2/token') ? init.body : JSON.parse(init.body)) : null });
    if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return { ok: true, json: async () => UK_QUOTES };
  };
  return { requests, fakeFetch };
};

const withFakeFetch = async (run) => {
  const { requests, fakeFetch } = fakeCanadaPost();
  const original = global.fetch;
  global.fetch = (url, init) => (String(url).includes('canadapost') ? fakeFetch(url, init) : original(url, init));
  canadaPost.resetTokenCacheForTest();
  clearQuoteCacheForTest();
  try { await run(requests); } finally { global.fetch = original; }
};

test('website checkout ships only where Canada Post has a tracked service, minus the US', () => {
  const { STRIPE_SHIPPING_COUNTRIES } = require('../src/config/countries');
  assert.equal(INTERNATIONAL_COUNTRIES.length, 73, 'the live sweep of 2026-10-05');
  assert.ok(INTERNATIONAL_COUNTRIES.every((code) => STRIPE_SHIPPING_COUNTRIES.includes(code)), 'Stripe can collect every listed country');
  for (const code of ['GB', 'AU', 'JP', 'AE', 'MX', 'IT', 'NL']) assert.ok(INTERNATIONAL_COUNTRIES.includes(code), code);
  // Only International Parcel / Small Packet there: no delivery confirmation.
  for (const code of ['ZA', 'NG', 'EG', 'PK']) assert.equal(INTERNATIONAL_COUNTRIES.includes(code), false, code);
  // Canada's own rates, US duties, Canada Post's parcel suspensions (EU and others), sanctions.
  for (const code of ['CA', 'US', 'PR', 'FR', 'DE', 'AT', 'BE', 'CZ', 'DK', 'FI', 'LU', 'PT', 'HT', 'PS', 'SD', 'RU', 'BY', 'IR', 'KP', 'CU']) {
    assert.equal(INTERNATIONAL_COUNTRIES.includes(code), false, code);
  }
  assert.deepEqual(parcelForSticks(2), { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } });
  assert.equal(parcelForSticks(3).weight, 0.9);
});

test('buyers abroad are offered only tracked Canada Post services, at Canada Post\'s price, cached', async () => {
  let calls = 0;
  const rate = async () => { calls += 1; return UK_QUOTES.map((q) => ({ serviceCode: q.serviceCode, serviceName: q.serviceName, price: q.priceDetails.due, transitDays: q.serviceStandard.expectedTransitTime ?? null, guaranteed: Boolean(q.serviceStandard.guaranteedDelivery) })); };
  clearQuoteCacheForTest();
  const options = await internationalOptions({ country: 'GB', sticks: 2, rate });
  assert.deepEqual(options.map((o) => [o.serviceCode, o.price, o.transitDays]), [['INT.TP', 68.88, 7], ['INT.XP', 94.15, 6]]);
  await internationalOptions({ country: 'GB', sticks: 1, rate });
  assert.equal(calls, 1, 'same country and box size reuse the quote');
  await assert.rejects(internationalOptions({ country: 'US', sticks: 1, rate }));
});

test('with a customer number the rating request asks for the account\'s discounted price', async () => {
  await withFakeFetch(async (requests) => {
    process.env.CANADA_POST_CUSTOMER_NUMBER = '0001234567';
    try {
      await canadaPost.rateInternational({ countryCode: 'GB', parcel: parcelForSticks(1), originPostalCode: 'M5H2N2' });
    } finally {
      delete process.env.CANADA_POST_CUSTOMER_NUMBER;
    }
    const rating = requests.find((r) => r.url.endsWith('/rating/v1/prices'));
    assert.equal(rating.body.quoteType, 'commercial');
    assert.equal(rating.body.customerNumber, '0001234567');
    assert.deepEqual(rating.body.destination, { international: { countryCode: 'GB' } });
  });
});

const app = () => {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/shipping', shippingRouter);
  instance.use('/api/stripe', stripeRouter);
  return instance;
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

const withCart = async (run) => {
  const originals = { cartFindOne: Cart.findOne, productFind: Product.find };
  Cart.findOne = async () => ({ items: [{ slug: 'ddr4-16gb', qty: 2 }] });
  Product.find = () => {
    const docs = [{ _id: 'p1', slug: 'ddr4-16gb', name: '16GB DDR4', price: 170, stock: 'in', stockQuantity: 10, isActive: true, line: 'Server' }];
    const query = { select: () => Promise.resolve(docs), then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject) };
    return query;
  };
  try { await run(); } finally { Cart.findOne = originals.cartFindOne; Product.find = originals.productFind; }
};

test('the quote endpoint prices the cart for the country and keeps the US closed until Zonos is configured', async () => {
  await withFakeFetch(async () => {
    await withCart(async () => {
      const uk = await post('/api/shipping/international-quote', { country: 'gb' });
      assert.equal(uk.status, 200);
      assert.equal(uk.body.sticks, 2);
      assert.deepEqual(uk.body.options.map((o) => o.serviceCode), ['INT.TP', 'INT.XP']);
      // The US has its own quote (see us-checkout.test.js); without the Zonos key it is simply not open.
      const us = await post('/api/shipping/international-quote', { country: 'US' });
      assert.equal(us.status, 422);
      assert.match(us.body.error, /Email us/);
    });
  });
});

test('checkout abroad charges the chosen Canada Post service and only accepts that country', async () => {
  await withFakeFetch(async () => {
    await withCart(async () => {
      let payload;
      stripeRouter.setCheckoutDependenciesForTest({
        ensurePrice: async () => 'price_ddr4_16gb',
        createSession: async (sent) => { payload = sent; return { id: 'cs_intl', url: 'https://stripe.test/intl' }; },
      });
      try {
        const ok = await post('/api/stripe/create-checkout-session', { shipping: { country: 'GB', serviceCode: 'INT.XP' } });
        assert.equal(ok.status, 200);
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['GB'] });
        const rate = payload.shipping_options[0].shipping_rate_data;
        assert.equal(rate.fixed_amount.amount, 9415);
        assert.match(rate.display_name, /^Xpresspost/);
        assert.match(payload.custom_text.shipping_address.message, /Import taxes and duties/);
        assert.equal(payload.metadata.shippingCountry, 'GB');

        const madeUp = await post('/api/stripe/create-checkout-session', { shipping: { country: 'GB', serviceCode: 'INT.FAKE' } });
        assert.equal(madeUp.status, 400);
        // The US is never sold through an international service code: without the Zonos key it is not open at all.
        const us = await post('/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'INT.XP' } });
        assert.equal(us.status, 422);

        const canada = await post('/api/stripe/create-checkout-session', {});
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['CA'] }, 'Canada keeps its flat rates');
        assert.equal(canada.status, 200);
      } finally {
        stripeRouter.setCheckoutDependenciesForTest();
      }
    });
  });
});
