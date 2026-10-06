// Checkout to the United States (2026-10-06): Canada Post Tracked Packet USA plus the import duties Zonos quotes, prepaid inside
// the shipping rate. Hermetic: Canada Post, Zonos and Stripe are stand-ins, and every test says what a failure here would have cost.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY = 'placeholder-not-a-stripe-key';
process.env.CANADA_POST_API_KEY = 'test-key';
process.env.CANADA_POST_API_SECRET = 'test-secret';
process.env.ZONOS_API_KEY = 'zonos-test-key';

const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const canadaPost = require('../src/utils/canadaPost');
const zonos = require('../src/utils/zonos');
const { unitedStatesOption, clearQuoteCacheForTest } = require('../src/utils/internationalShipping');
const { quoteUnitedStates, usCheckoutAvailable, UsCheckoutError, clearUsCheckoutCacheForTest } = require('../src/utils/usCheckout');
const { buildShippingPreparation } = require('../src/utils/shippingPreparation');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { INTERNATIONAL_COUNTRIES, US_MAX_STICKS, parcelForSticks } = require('../src/config/shipping');
const shippingRouter = require('../src/routes/shipping');
const stripeRouter = require('../src/routes/stripe');

// ── stand-ins ──────────────────────────────────────────────────────────────────────────────────
const PRODUCT = {
  _id: 'p1', slug: 'ddr4-16gb', sku: 'RFX-DDR4-16GB', name: '16GB DDR4 ECC RDIMM', price: 170, stock: 'in', stockQuantity: 20,
  isActive: true, line: 'Server', countryOfOrigin: 'KR', hsCode: '8473.30',
};
// Real Canada Post commercial answers for the 0.4 kg box to NYC (2026-10-06), trimmed to what matters.
const US_QUOTES = [
  { serviceCode: 'USA.EP', serviceName: 'Expedited Parcel USA', priceDetails: { due: 24.58 }, serviceStandard: { expectedTransitTime: 3 } },
  { serviceCode: 'USA.SP.AIR', serviceName: 'Small Packet USA Air', priceDetails: { due: 16.7 }, serviceStandard: {} },
  { serviceCode: 'USA.TP', serviceName: 'Tracked Packet - USA', priceDetails: { due: 16.7 }, serviceStandard: { expectedTransitTime: 6 } },
  { serviceCode: 'USA.XP', serviceName: 'Xpresspost USA', priceDetails: { due: 33.81 }, serviceStandard: { expectedTransitTime: 4 } },
];
// What Zonos answers for 2 sticks at $170 shipped at $16.70 (shape as seen live; the numbers are made up but add up).
const zonosAnswer = (over = {}) => {
  const { items = 340, shipping = 16.7, duties = 87.4, fees = 12.1, taxes = 0, currency = 'CAD', id = 'landed_cost_test-1', landedCostTotal } = over;
  return {
    data: {
      landedCostCalculateWorkflow: [{
        id,
        amountSubtotals: { items, shipping, duties, taxes, fees, landedCostTotal: landedCostTotal ?? Math.round((duties + fees + taxes) * 100) / 100 },
        duties: [{ amount: duties, currency }], taxes: [], fees: [{ amount: fees, currency }],
      }],
    },
  };
};

// One fake network for both services; records what was asked.
const withNetwork = async (run, { zonosBody = zonosAnswer(), zonosStatus = 200, zonosThrows, cpQuotes = US_QUOTES, cpStatus = 200 } = {}) => {
  const seen = { zonos: [], canadaPost: [] };
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    const text = String(url);
    if (text.startsWith('http://127.0.0.1')) return original(url, init);
    if (text.includes('api.zonos.com')) {
      seen.zonos.push({ url: text, headers: init.headers, body: JSON.parse(init.body) });
      if (zonosThrows) throw zonosThrows;
      return { ok: zonosStatus === 200, status: zonosStatus, json: async () => (typeof zonosBody === 'function' ? zonosBody(seen.zonos.at(-1)) : zonosBody) };
    }
    if (text.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    if (text.includes('canadapost')) {
      seen.canadaPost.push({ url: text, body: init.body ? JSON.parse(init.body) : null });
      return { ok: cpStatus === 200, status: cpStatus, json: async () => cpQuotes };
    }
    throw new Error(`unexpected network call: ${text}`);
  };
  canadaPost.resetTokenCacheForTest();
  clearQuoteCacheForTest();
  zonos.clearZonosCacheForTest();
  clearUsCheckoutCacheForTest();
  try { await run(seen); } finally { global.fetch = original; }
};

const chain = (value) => ({ select: () => chain(value), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
const withCart = async (run, { product = PRODUCT, qty = 2 } = {}) => {
  const originals = { cartFindOne: Cart.findOne, productFind: Product.find, exists: Product.exists };
  Cart.findOne = async () => ({ items: [{ slug: product.slug, qty }] });
  Product.find = () => chain([product]);
  Product.exists = async () => ({ _id: product._id });
  try { await run(); } finally { Cart.findOne = originals.cartFindOne; Product.find = originals.productFind; Product.exists = originals.exists; }
};
// Fulfilment logs a line per order and the failure paths log errors; keep the runner's stdout free of both (interleaved output has corrupted its event stream once).
const quiet = (t) => {
  const originals = { error: console.error, log: console.log, warn: console.warn };
  console.error = () => {}; console.log = () => {}; console.warn = () => {};
  t.after(() => { Object.assign(console, originals); });
};

const app = () => {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/shipping', shippingRouter);
  instance.use('/api/stripe', stripeRouter);
  return instance;
};
const call = async (method, path, body) => {
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

const LINES = [{ sku: 'RFX-DDR4-16GB', name: '16GB DDR4 ECC RDIMM', qty: 2, unitPriceCad: 170, hsCode: '8473.30', countryOfOrigin: 'KR' }];

// ── 1. the Zonos client ──────────────────────────────────────────────────────────────────────────
test('the duty quote asks Zonos for a quote only, sends what the customs form needs and nothing about the buyer', async () => {
  await withNetwork(async (seen) => {
    const quote = await zonos.quoteUsDuties({ lines: LINES, shippingCad: 16.7, shipServiceCode: 'USA.TP', shipServiceName: 'Tracked Packet – USA' });
    assert.deepEqual(quote, { quoteId: 'landed_cost_test-1', duties: 87.4, fees: 12.1, taxes: 0, total: 99.5 });
    const [request] = seen.zonos;
    assert.equal(request.url, 'https://api.zonos.com/graphql');
    assert.equal(request.headers.credentialToken, 'zonos-test-key', 'the key goes in the credentialToken header');
    assert.doesNotMatch(request.body.query, /orderCreate/, 'a quote never creates a Zonos order (that is what Zonos bills)');
    const v = request.body.variables;
    assert.deepEqual(v.parties[1], { type: 'DESTINATION', location: { countryCode: 'US' } }, 'only the country: the buyer has not given an address yet');
    assert.deepEqual(v.parties[0].location, { countryCode: 'CA', administrativeAreaCode: 'ON', locality: 'Toronto' }, 'no postal code of ours leaves the shop');
    assert.equal(v.items.length, 1);
    assert.equal(v.items[0].amount, 170, 'the unit price');
    assert.equal(v.items[0].quantity, 2);
    assert.equal(v.items[0].countryOfOrigin, 'KR');
    assert.equal(v.items[0].hsCode, '8473.30');
    assert.equal(v.ship.amount, 16.7);
    assert.equal(v.lc.method, 'DDP', 'duties prepaid');
    assert.equal(v.lc.currencyCode, 'CAD');
  });
});

test('the same cart reuses its quote for ten minutes; a changed cart or shipping price asks again', async () => {
  // Zonos prices whatever it is sent: answer with the goods' value from the request, as the real one does.
  const goodsOf = (request) => request.body.variables.items.reduce((sum, item) => sum + item.amount * item.quantity, 0);
  await withNetwork(async (seen) => {
    let clock = 1_000_000;
    const args = { lines: LINES, shippingCad: 16.7, shipServiceCode: 'USA.TP', shipServiceName: 'T', now: () => clock };
    await zonos.quoteUsDuties(args);
    await zonos.quoteUsDuties(args);
    assert.equal(seen.zonos.length, 1);
    await zonos.quoteUsDuties({ ...args, shippingCad: 24.72 });
    assert.equal(seen.zonos.length, 2, 'a different box is a different quote');
    await zonos.quoteUsDuties({ ...args, lines: [{ ...LINES[0], qty: 3 }] });
    assert.equal(seen.zonos.length, 3, 'a different quantity too');
    clock += 11 * 60 * 1000;
    await zonos.quoteUsDuties(args);
    assert.equal(seen.zonos.length, 4, 'after ten minutes the tariff is asked again');
  }, { zonosBody: (request) => zonosAnswer({ items: goodsOf(request) }) });
});

const without = (field, over) => {
  const body = zonosAnswer(over);
  delete body.data.landedCostCalculateWorkflow[0].amountSubtotals[field];
  return body;
};

test('a Zonos answer that is missing, in another currency, for other goods, out of range or does not add up is refused, never charged', async () => {
  const bad = {
    'no quote': { data: { landedCostCalculateWorkflow: [] } },
    'graphql errors': { errors: [{ message: 'item invalid' }] },
    'another currency': zonosAnswer({ currency: 'USD' }),
    'priced other goods (unit vs total mix-up)': zonosAnswer({ items: 170 }),
    'total does not match its parts': zonosAnswer({ landedCostTotal: 50 }),
    'absurd total (over twice the goods)': zonosAnswer({ duties: 900, fees: 10 }),
    'negative amount': zonosAnswer({ duties: -5, fees: 1 }),
    'not numbers': zonosAnswer({ duties: 'lots' }),
    // A missing or null amount used to read as 0 and a missing check field used to skip its check: the quote was accepted and the
    // buyer charged shipping only, with the shop paying the duties at label time.
    'null duties (Number(null) is 0)': zonosAnswer({ duties: null, fees: 0, landedCostTotal: 0 }),
    'a landed cost of zero': zonosAnswer({ duties: 0, fees: 0, taxes: 0 }),
    'no items subtotal to compare with the cart': without('items'),
    'no landed cost total to compare with its parts': without('landedCostTotal'),
  };
  for (const [name, body] of Object.entries(bad)) {
    await withNetwork(async () => {
      await assert.rejects(zonos.quoteUsDuties({ lines: LINES, shippingCad: 16.7, shipServiceCode: 'USA.TP', shipServiceName: 'T' }), zonos.ZonosError, name);
    }, { zonosBody: body });
  }
});

test('Zonos being down, slow or unconfigured fails closed', async () => {
  await withNetwork(async () => {
    await assert.rejects(zonos.quoteUsDuties({ lines: LINES, shippingCad: 16.7, shipServiceCode: 'x', shipServiceName: 'x' }), /HTTP 503/);
  }, { zonosStatus: 503 });
  await withNetwork(async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await assert.rejects(zonos.quoteUsDuties({ lines: LINES, shippingCad: 16.7, shipServiceCode: 'x', shipServiceName: 'x' }), /did not answer in time/);
    assert.ok(aborted);
  }, { zonosThrows: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  const key = process.env.ZONOS_API_KEY;
  delete process.env.ZONOS_API_KEY;
  try {
    assert.equal(zonos.isConfigured(), false);
    await assert.rejects(zonos.quoteUsDuties({ lines: LINES, shippingCad: 1, shipServiceCode: 'x', shipServiceName: 'x' }), /not configured/);
  } finally { process.env.ZONOS_API_KEY = key; }
});

test('an answer that stalls after its headers is cut off at the deadline, for Zonos and for Canada Post', async () => {
  await withNetwork(async () => {
    const started = Date.now();
    await assert.rejects(zonos.quoteUsDuties({ lines: LINES, shippingCad: 16.7, shipServiceCode: 'x', shipServiceName: 'x', timeoutMs: 40 }), /did not answer in time/);
    assert.ok(Date.now() - started < 2000, 'it gave up at the deadline instead of waiting for the body');
  }, { zonosBody: () => new Promise(() => {}) });
  canadaPost.resetTokenCacheForTest();
  const stalled = async (url) => (String(url).endsWith('/oauth2/token')
    ? { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
    : { ok: true, json: () => new Promise(() => {}) });
  await assert.rejects(canadaPost.rateUnitedStates({ zipCode: '10001', parcel: parcelForSticks(2), originPostalCode: 'M5H2N2', fetchImpl: stalled, timeoutMs: 40 }), /timed out/);
  canadaPost.resetTokenCacheForTest();
});

// ── 2. Canada Post Tracked Packet USA ────────────────────────────────────────────────────────────
test('shipping is Tracked Packet USA at Canada Post\'s price, one fixed ZIP for every buyer, cached by box size, up to 11 sticks', async () => {
  let calls = 0;
  let asked;
  const rate = async (args) => {
    calls += 1; asked = args;
    return US_QUOTES.map((q) => ({ serviceCode: q.serviceCode, serviceName: q.serviceName, price: q.priceDetails.due, transitDays: q.serviceStandard.expectedTransitTime ?? null }));
  };
  clearQuoteCacheForTest();
  const option = await unitedStatesOption({ sticks: 2, rate });
  assert.deepEqual(option, { serviceCode: 'USA.TP', name: 'Tracked Packet – USA', price: 16.7, transitDays: 6, guaranteed: false }, 'only the tracked service: not Small Packet, not the ZIP-priced ones');
  assert.equal(asked.zipCode, '10001');
  assert.deepEqual(asked.parcel, parcelForSticks(2));
  await unitedStatesOption({ sticks: 1, rate });
  assert.equal(calls, 1, 'one or two sticks share a box and a quote');
  await unitedStatesOption({ sticks: 4, rate });
  assert.equal(calls, 2, 'a bigger box is its own quote');
  assert.equal(await unitedStatesOption({ sticks: US_MAX_STICKS + 1, rate }), null, 'over 2 kg Canada Post has no Tracked Packet');
  assert.equal(calls, 2, '...and it does not even ask');
  // parcelForSticks rounds to 0.1 kg, which once let a 2.04 kg parcel (12 sticks) pass as 2.0 kg. The limit is about the REAL weight
  // (the model behind parcelForSticks: 0.6 kg of box and padding plus 0.12 kg a stick), so check that, not the rounded one.
  const realKg = (sticks) => 0.6 + 0.12 * sticks;
  assert.equal(realKg(US_MAX_STICKS) <= 2, true, 'the biggest US order really fits Tracked Packet USA\'s 2 kg');
  assert.equal(realKg(US_MAX_STICKS + 1) > 2, true, 'and one more stick really does not');
  assert.equal(parcelForSticks(US_MAX_STICKS).weight <= 2, true);
  clearQuoteCacheForTest();
  assert.equal(await unitedStatesOption({ sticks: 2, rate: async () => [{ serviceCode: 'USA.XP', price: 33.81 }] }), null, 'no tracked service quoted');
});

test('the rating request names the United States destination and asks for the account\'s commercial price', async () => {
  await withNetwork(async (seen) => {
    process.env.CANADA_POST_CUSTOMER_NUMBER = '0001234567';
    try {
      await canadaPost.rateUnitedStates({ zipCode: '10001', parcel: parcelForSticks(1), originPostalCode: 'M5H2N2' });
    } finally { delete process.env.CANADA_POST_CUSTOMER_NUMBER; }
    const body = seen.canadaPost.find((r) => r.url.endsWith('/rating/v1/prices')).body;
    assert.deepEqual(body.destination, { unitedStates: { zipCode: '10001' } });
    assert.equal(body.quoteType, 'commercial');
    // The other countries still use the international destination.
    await canadaPost.rateInternational({ countryCode: 'GB', parcel: parcelForSticks(1), originPostalCode: 'M5H2N2' });
    assert.deepEqual(seen.canadaPost.at(-1).body.destination, { international: { countryCode: 'GB' } });
  });
});

// ── 3. the US quote for a cart ───────────────────────────────────────────────────────────────────
test('a US cart is quoted as Tracked Packet USA plus the prepaid duties, and the total is what the shipping rate will charge', async () => {
  await withNetwork(async () => {
    const quote = await quoteUnitedStates({ lines: [{ product: PRODUCT, qty: 2 }] });
    assert.equal(quote.service.price, 16.7);
    assert.equal(quote.duties.total, 99.5);
    assert.equal(quote.total, 116.2);
    assert.equal(quote.sticks, 2);
  });
});

test('a cart that cannot honestly go to the US is refused with something the buyer can read, never guessed', async () => {
  const refusal = async (lines, status, pattern) => {
    await withNetwork(async () => {
      await assert.rejects(quoteUnitedStates({ lines }), (err) => err instanceof UsCheckoutError && err.status === status && pattern.test(err.publicMessage));
    });
  };
  await refusal([{ product: { ...PRODUCT, countryOfOrigin: undefined }, qty: 1 }], 422, /"16GB DDR4 ECC RDIMM" cannot be ordered to the United States from the website yet/);
  await refusal([{ product: { ...PRODUCT, countryOfOrigin: 'Korea' }, qty: 1 }], 422, /cannot be ordered/);
  await refusal([{ product: { ...PRODUCT, hsCode: '' }, qty: 1 }], 422, /cannot be ordered/);
  await refusal([{ product: { ...PRODUCT, hsCode: 'abc' }, qty: 1 }], 422, /cannot be ordered/);
  await refusal([{ product: { ...PRODUCT, price: 0 }, qty: 1 }], 422, /cannot be ordered/);
  await refusal([{ product: PRODUCT, qty: US_MAX_STICKS + 1 }], 422, new RegExp(`up to ${US_MAX_STICKS} sticks`));
  // one good line does not rescue a bad one
  await refusal([{ product: PRODUCT, qty: 1 }, { product: { ...PRODUCT, slug: 'other', sku: 'OTHER', name: 'Other stick', hsCode: undefined }, qty: 1 }], 422, /"Other stick" cannot be ordered/);
});

test('a US order above the goods cap is refused for email, and one at the cap is quoted', async () => {
  const deps = {
    zonos: { isConfigured: () => true, quoteUsDuties: async () => ({ quoteId: 'q', duties: 90, fees: 10, taxes: 0, total: 100 }) },
    unitedStatesOption: async () => ({ serviceCode: 'USA.TP', name: 'Tracked Packet – USA', price: 20, transitDays: 6 }),
  };
  const cart = (price, qty) => [{ product: { ...PRODUCT, price }, qty }];
  await assert.rejects(quoteUnitedStates({ lines: cart(500.01, 6), deps }), (err) => err instanceof UsCheckoutError && err.status === 422 && /up to \$3,000/.test(err.publicMessage));
  const quote = await quoteUnitedStates({ lines: cart(500, 6), deps });
  assert.equal(quote.total, 120, '$3,000.00 of goods is still quoted');
});

test('Canada Post or Zonos failing is a 502 with a retry message, and a missing key means the US is simply not open', async (t) => {
  quiet(t);
  await withNetwork(async () => {
    await assert.rejects(quoteUnitedStates({ lines: [{ product: PRODUCT, qty: 1 }] }), (err) => err.status === 502 && /Canada Post prices/.test(err.publicMessage));
  }, { cpStatus: 500 });
  await withNetwork(async () => {
    await assert.rejects(quoteUnitedStates({ lines: [{ product: PRODUCT, qty: 1 }] }), (err) => err.status === 502 && /US import duties/.test(err.publicMessage));
  }, { zonosStatus: 500 });
  await withNetwork(async () => {
    await assert.rejects(quoteUnitedStates({ lines: [{ product: PRODUCT, qty: 1 }] }), (err) => err.status === 422 && /Canada Post has no tracked service to the United States/.test(err.publicMessage));
  }, { cpQuotes: [] });
  const key = process.env.ZONOS_API_KEY;
  delete process.env.ZONOS_API_KEY;
  try {
    await withNetwork(async () => {
      await assert.rejects(quoteUnitedStates({ lines: [{ product: PRODUCT, qty: 1 }] }), (err) => err.status === 422 && /not open/.test(err.publicMessage));
    });
  } finally { process.env.ZONOS_API_KEY = key; }
});

test('the United States is listed only when configured and a sellable product has its customs data saved (cached for a minute)', async () => {
  let asked = 0;
  let filter;
  let clock = 5_000_000;
  const exists = async (f) => { asked += 1; filter = f; return asked === 1 ? { _id: 'p1' } : null; };
  clearUsCheckoutCacheForTest();
  assert.equal(await usCheckoutAvailable({ now: () => clock, exists }), true);
  assert.equal(asked, 1);
  assert.equal(filter.isActive, true);
  assert.equal(filter.line, 'Server');
  assert.deepEqual(filter.stockQuantity, { $gt: 0 }, 'a sold-out product does not open the country');
  assert.ok(filter.countryOfOrigin && filter.hsCode, 'both customs fields are required');
  assert.equal(await usCheckoutAvailable({ now: () => clock, exists }), true, 'cached');
  assert.equal(asked, 1);
  clock += 61 * 1000;
  assert.equal(await usCheckoutAvailable({ now: () => clock, exists }), false, 'after a minute it asks again (and now none is ready)');
  const key = process.env.ZONOS_API_KEY;
  delete process.env.ZONOS_API_KEY;
  try {
    clearUsCheckoutCacheForTest();
    assert.equal(await usCheckoutAvailable({ now: () => clock, exists: async () => ({ _id: 'p1' }) }), false, 'without the Zonos key the US stays closed');
  } finally { process.env.ZONOS_API_KEY = key; }
});

// ── 4. the endpoints ─────────────────────────────────────────────────────────────────────────────
test('GET /countries adds the United States only when it is open', async () => {
  await withNetwork(async () => {
    await withCart(async () => {
      const open = await call('GET', '/api/shipping/countries');
      assert.equal(open.body.countries.includes('US'), true);
      assert.equal(open.body.countries.length, INTERNATIONAL_COUNTRIES.length + 1);
      assert.equal(INTERNATIONAL_COUNTRIES.includes('US'), false, 'the shared list (feed, policies) never gains the US');
      clearUsCheckoutCacheForTest();
      Product.exists = async () => null;
      const closed = await call('GET', '/api/shipping/countries');
      assert.equal(closed.body.countries.includes('US'), false);
      assert.equal(closed.body.countries.length, INTERNATIONAL_COUNTRIES.length);
    });
  });
});

test('POST /international-quote for the US returns the one service and the prepaid duties, and explains a refusal', async (t) => {
  quiet(t);
  await withNetwork(async () => {
    await withCart(async () => {
      const ok = await call('POST', '/api/shipping/international-quote', { country: 'us' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.country, 'US');
      assert.deepEqual(ok.body.options.map((o) => [o.serviceCode, o.price]), [['USA.TP', 16.7]]);
      assert.deepEqual(ok.body.duties, { amount: 99.5, duties: 87.4, fees: 12.1, taxes: 0 });
    });
    await withCart(async () => {
      const refused = await call('POST', '/api/shipping/international-quote', { country: 'US' });
      assert.equal(refused.status, 422);
      assert.match(refused.body.error, /cannot be ordered to the United States/);
    }, { product: { ...PRODUCT, countryOfOrigin: undefined } });
  });
  await withNetwork(async () => {
    await withCart(async () => {
      const down = await call('POST', '/api/shipping/international-quote', { country: 'US' });
      assert.equal(down.status, 502);
    });
  }, { zonosStatus: 500 });
});

// ── 5. the Stripe session ────────────────────────────────────────────────────────────────────────
test('the US session charges shipping plus duties as ONE shipping rate, to US addresses only, with no promotion codes', async () => {
  await withNetwork(async () => {
    await withCart(async () => {
      let payload;
      stripeRouter.setCheckoutDependenciesForTest({ ensurePrice: async () => 'price_ddr4', createSession: async (sent) => { payload = sent; return { id: 'cs_us', url: 'https://stripe.test/us' }; } });
      try {
        const ok = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.TP' } });
        assert.equal(ok.status, 200);
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['US'] });
        assert.equal(payload.shipping_options.length, 1);
        const rate = payload.shipping_options[0].shipping_rate_data;
        assert.equal(rate.fixed_amount.amount, 11620, '$16.70 shipping + $99.50 duties and fees');
        assert.equal(rate.fixed_amount.currency, 'cad');
        assert.match(rate.display_name, /^Tracked Packet – USA \(about 6 business days\) \+ prepaid US import duties and fees$/);
        assert.ok(rate.display_name.length <= 100, 'Stripe caps the name at 100 characters');
        assert.equal(rate.metadata.usDutiesCad, '99.50');
        assert.equal(rate.metadata.usShippingCad, '16.70');
        assert.equal(payload.allow_promotion_codes, false, 'a coupon must never discount duties');
        assert.equal(payload.line_items.length, 1, 'duties are not a line item: the order\'s subtotal stays the goods');
        assert.match(payload.custom_text.shipping_address.message, /prepaid/);
        assert.equal(payload.metadata.shippingCountry, 'US');
        assert.equal(payload.metadata.canadaPostService, 'USA.TP');
        assert.equal(payload.metadata.usDutiesCad, '99.50');
        assert.equal(payload.metadata.zonosLandedCostId, 'landed_cost_test-1');
        assert.equal(payload.metadata.canadaPostTransitDays, '6');

        // The server decides every price. Client-sent price fields next to the RIGHT service code change nothing (the first version of
        // this check sent the wrong code, so it only proved the service check)...
        const tampered = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.TP', price: 1, duties: 0, amount: 1, shippingCost: 0 }, price: 1, duties: 0 });
        assert.equal(tampered.status, 200);
        assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, 11620, 'the charge is still shipping + duties, whatever the browser claims');
        assert.equal(payload.line_items[0].quantity, 2);
        const lower = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'us', serviceCode: 'USA.TP' } });
        assert.equal(lower.status, 200);
        assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, 11620, 'a lower-case country is the US, priced the same');
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['US'] });
        // ...and a service that is not the one on offer is refused.
        const wrong = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.XP', price: 1, duties: 0 } });
        assert.equal(wrong.status, 400);
        const none = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US' } });
        assert.equal(none.status, 400);

        // Controls: Canada and the other countries are untouched.
        const canada = await call('POST', '/api/stripe/create-checkout-session', {});
        assert.equal(canada.status, 200);
        assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['CA'] });
        assert.equal(payload.allow_promotion_codes, true);
        const gb = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'GB', serviceCode: 'INT.TP' } });
        assert.equal(gb.status, 400, 'an unlisted service for GB is still refused (this stand-in only quotes USA services)');
      } finally { stripeRouter.setCheckoutDependenciesForTest(); }
    });
  });
});

test('a US session is never created for a cart that cannot be declared, nor when duties cannot be quoted', async (t) => {
  quiet(t);
  let created = 0;
  stripeRouter.setCheckoutDependenciesForTest({ ensurePrice: async () => 'price_ddr4', createSession: async () => { created += 1; return { id: 'cs_x', url: 'https://stripe.test/x' }; } });
  t.after(() => stripeRouter.setCheckoutDependenciesForTest());
  await withNetwork(async () => {
    await withCart(async () => {
      const res = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.TP' } });
      assert.equal(res.status, 422);
      assert.match(res.body.error, /cannot be ordered to the United States/);
    }, { product: { ...PRODUCT, countryOfOrigin: undefined } });
    await withCart(async () => {
      const res = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.TP' } });
      assert.equal(res.status, 422);
      assert.match(res.body.error, new RegExp(`up to ${US_MAX_STICKS} sticks`));
    }, { qty: US_MAX_STICKS + 1 });
  });
  await withNetwork(async () => {
    await withCart(async () => {
      const res = await call('POST', '/api/stripe/create-checkout-session', { shipping: { country: 'US', serviceCode: 'USA.TP' } });
      assert.equal(res.status, 502);
    });
  }, { zonosStatus: 500 });
  assert.equal(created, 0, 'no Stripe session was created in any of these');
});

// ── 6. the paid order ────────────────────────────────────────────────────────────────────────────
const stripeSession = (over = {}) => ({
  id: 'cs_us_paid', payment_status: 'paid',
  metadata: {
    userId: 'guest', cartSessionId: 'session_0123456789', shippingCountry: 'US', canadaPostService: 'USA.TP', canadaPostTransitDays: '6',
    usShippingCad: '16.70', usDutiesCad: '99.50', zonosLandedCostId: 'landed_cost_test-1',
  },
  line_items: { data: [{ price: { id: 'price_known', unit_amount: 17000, product: {} }, quantity: 2 }] },
  amount_subtotal: 34000, amount_total: 45620, total_details: { amount_discount: 0, amount_shipping: 11620, amount_tax: 0 },
  shipping_cost: { shipping_rate: { display_name: 'Tracked Packet – USA (about 6 business days) + prepaid US import duties and fees' } },
  customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Broadway', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' } },
  payment_intent: 'pi_us',
  ...over,
});
async function fulfil(t, session) {
  quiet(t);
  const created = [];
  const originals = { productFindOne: Product.findOne, orderFindOne: Order.findOne, orderCreate: Order.create, cart: Cart.findOneAndUpdate };
  Product.findOne = async (q) => (q.stripePriceId === 'price_known' ? { _id: 'p1', slug: 'ddr4-16gb', sku: 'RFX-DDR4-16GB', name: 'Known stick', images: [] } : null);
  Order.findOne = async () => null;
  Order.create = async (values) => { created.push(values); return { ...values, _id: 'o1', orderNumber: 'RFX-9', stockDecremented: true }; };
  Cart.findOneAndUpdate = async () => undefined;
  stripeRouter.setCheckoutDependenciesForTest({ retrieveSession: async () => session, decrementStock: async () => true });
  const server = http.createServer(app());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${session.id}`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    stripeRouter.setCheckoutDependenciesForTest();
    Product.findOne = originals.productFindOne; Order.findOne = originals.orderFindOne; Order.create = originals.orderCreate; Cart.findOneAndUpdate = originals.cart;
  }
  assert.equal(created.length, 1);
  return created[0];
}

test('a paid US order records the prepaid duties apart from shipping and tells the owner how to make the label', async (t) => {
  const order = await fulfil(t, stripeSession());
  assert.equal(order.importDuties, 99.5);
  assert.equal(order.importDutiesQuoteId, 'landed_cost_test-1');
  assert.equal(order.shippingCost, 116.2, 'shippingCost stays what the buyer was charged under "shipping", so total = subtotal + shipping + tax');
  assert.equal(order.subtotal, 340, 'the subtotal is the goods only');
  assert.equal(order.total, 456.2);
  assert.match(order.adminNotes, /^SHIPPING: the buyer paid for "Tracked Packet – USA \(about 6 business days\) \+ prepaid US import duties and fees"\. When you make the label, buy Tracked Packet – USA\.$/m);
  assert.match(order.adminNotes, /^US ORDER: the buyer prepaid US import duties and fees of \$99\.50 CAD inside the shipping charge \(Zonos quote landed_cost_test-1\)\. Make the label in Snap Ship with the Zonos duties-paid option/m);
  assert.ok(order.estimatedDelivery instanceof Date);
});

test('duties that do not fit the shipping charge, a non-US order, or a missing amount record nothing as duties', async (t) => {
  const bigger = await fulfil(t, stripeSession({ id: 'cs_a', metadata: { ...stripeSession().metadata, usDutiesCad: '999.00' } }));
  assert.equal(bigger.importDuties, undefined, 'a duty amount larger than the shipping charge is not believed');
  const missing = await fulfil(t, stripeSession({ id: 'cs_b', metadata: { userId: 'guest', cartSessionId: 'session_0123456789', shippingCountry: 'US', canadaPostService: 'USA.TP' } }));
  assert.equal(missing.importDuties, undefined);
  const canada = await fulfil(t, stripeSession({
    id: 'cs_c', metadata: { userId: 'guest', cartSessionId: 'session_0123456789', usDutiesCad: '5.00' },
    shipping_cost: { shipping_rate: { display_name: 'Flat-Rate Shipping' } }, total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 },
    customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main', city: 'Toronto', state: 'ON', postal_code: 'M1P 3T7', country: 'CA' } },
  }));
  assert.equal(canada.importDuties, undefined, 'only a US session counts duties');
  assert.doesNotMatch(canada.adminNotes || '', /US ORDER/);
});

test('the admin shipping panel shows what was prepaid and the customs lines, and an order without duties shows none', async () => {
  const order = {
    status: 'processing', paymentStatus: 'paid', shippingMethod: 'Tracked Packet – USA (about 6 business days) + prepaid US import duties and fees',
    adminNotes: 'SHIPPING: the buyer paid for "Tracked Packet – USA (about 6 business days) + prepaid US import duties and fees". When you make the label, buy Tracked Packet – USA.',
    importDuties: 99.5, importDutiesQuoteId: 'landed_cost_test-1',
    items: [{ product: '64b7f0c2a1b2c3d4e5f60719', sku: 'RFX-DDR4-16GB', name: '16GB DDR4 ECC RDIMM', price: 170, qty: 2 }],
    shippingAddress: { firstName: 'A', lastName: 'B', line1: '1 Broadway', city: 'New York', state: 'NY', zip: '10001', country: 'US' },
  };
  const ProductModel = { find: () => ({ select: () => ({ lean: async () => [{ _id: '64b7f0c2a1b2c3d4e5f60719', sku: 'RFX-DDR4-16GB', countryOfOrigin: 'KR', hsCode: '8473.30', isActive: true }] }) }) };
  const prep = await buildShippingPreparation(order, ProductModel);
  assert.equal(prep.service.name, 'Tracked Packet – USA');
  assert.deepEqual(prep.duties, { prepaidCAD: 99.5, quoteId: 'landed_cost_test-1' });
  assert.equal(prep.customs.required, true);
  assert.equal(prep.fulfillment.canCreateLabel, true);
  assert.match(prep.copyText, /US import duties and fees prepaid by the buyer: CAD \$99\.50/);
  assert.match(prep.copyText, /2 × 16GB DDR4 ECC RDIMM \| CAD \$170\.00 each \| origin KR \| HS 8473\.30/);
  const plain = await buildShippingPreparation({ ...order, importDuties: undefined, shippingAddress: { ...order.shippingAddress, country: 'GB' } }, ProductModel);
  assert.equal(plain.duties, null);
  assert.doesNotMatch(plain.copyText, /prepaid by the buyer/);
});

test('the customer order data carries the prepaid duties only when there are some, and never the admin notes', () => {
  const base = { _id: 'o1', orderNumber: 'RFX-9', items: [], shippingAddress: {}, status: 'processing', paymentStatus: 'paid', subtotal: 340, shippingCost: 116.2, tax: 0, discount: 0, total: 456.2, adminNotes: 'US ORDER: secret' };
  const us = customerOrderResponse({ ...base, importDuties: 99.5, importDutiesQuoteId: 'landed_cost_x' });
  assert.equal(us.importDuties, 99.5);
  assert.equal(JSON.stringify(us).includes('landed_cost_x'), false, 'the Zonos quote id is for the owner');
  assert.equal(JSON.stringify(us).includes('US ORDER'), false);
  assert.equal('importDuties' in customerOrderResponse({ ...base, importDuties: 0 }), false);
  assert.equal('importDuties' in customerOrderResponse(base), false);
});
