const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPurchasePayload,
  fallbackClientId,
  ga4Config,
  isServerPurchaseTrackingEnabled,
  sanitizeAnalyticsIds,
  sendPurchaseEvent,
} = require('../src/utils/ga4');

const order = {
  orderNumber: 'RFX-MU6ZLMTV-78B757',
  createdAt: '2026-09-18T13:21:13.171Z',
  total: 1094,
  tax: 125.8,
  shippingCost: 14,
  items: [{ sku: 'RFX-SK-HYNIX', slug: 'sk-hynix', name: 'SK hynix 64GB', price: 500, qty: 2 }],
};
const silentLogger = { warn: () => {}, error: () => {}, log: () => {} };

test('server purchase tracking is off until an API secret is configured', () => {
  assert.equal(ga4Config({}), null);
  assert.equal(isServerPurchaseTrackingEnabled({}), false);
  assert.equal(isServerPurchaseTrackingEnabled({ GA4_API_SECRET: '   ' }), false);
  assert.deepEqual(ga4Config({ GA4_API_SECRET: 'shh' }), { apiSecret: 'shh', measurementId: 'G-LHK5KZSYG6' });
  assert.deepEqual(
    ga4Config({ GA4_API_SECRET: 'shh', GA4_MEASUREMENT_ID: 'G-ABCDEF1234' }),
    { apiSecret: 'shh', measurementId: 'G-ABCDEF1234' },
  );
  assert.equal(ga4Config({ GA4_API_SECRET: 'shh', GA4_MEASUREMENT_ID: 'UA-1234-1' }), null);
});

test('browser-supplied GA ids are accepted only in the exact gtag shapes', () => {
  assert.deepEqual(sanitizeAnalyticsIds({ clientId: '1234567890.1700000000', sessionId: '1789737000' }), {
    clientId: '1234567890.1700000000',
    sessionId: '1789737000',
  });
  assert.deepEqual(sanitizeAnalyticsIds(undefined), { clientId: undefined, sessionId: undefined });
  for (const bad of ['', 'abc', '12.3.4', '1234567890', '<script>', '1'.repeat(40) + '.1', 12345, null, {}]) {
    assert.equal(sanitizeAnalyticsIds({ clientId: bad }).clientId, undefined, `client id ${String(bad)}`);
  }
  for (const bad of ['', '123', 'abc123456', '1'.repeat(30), 1789737000, null]) {
    assert.equal(sanitizeAnalyticsIds({ sessionId: bad }).sessionId, undefined, `session id ${String(bad)}`);
  }
});

test('the purchase payload carries the verified order values and joins the browser session', () => {
  const payload = buildPurchasePayload(order, { clientId: '111.222', sessionId: '1789737000' }, {
    currency: 'cad',
    now: Date.parse('2026-09-18T13:21:20.000Z'),
  });
  assert.equal(payload.client_id, '111.222');
  assert.equal(payload.timestamp_micros, Date.parse('2026-09-18T13:21:13.171Z') * 1000);
  assert.equal(payload.events.length, 1);
  assert.deepEqual(payload.events[0], {
    name: 'purchase',
    params: {
      transaction_id: 'RFX-MU6ZLMTV-78B757',
      currency: 'CAD',
      value: 1094,
      tax: 125.8,
      shipping: 14,
      items: [{ item_id: 'RFX-SK-HYNIX', item_name: 'SK hynix 64GB', price: 500, quantity: 2 }],
      page_location: 'https://reflexityram.com/order/success',
      page_title: 'Order confirmed',
      session_id: '1789737000',
      engagement_time_msec: 1,
    },
  });
});

test('a blocked browser still yields a stable client id and no session id', () => {
  const first = buildPurchasePayload(order, {}, { currency: 'cad' });
  const second = buildPurchasePayload(order, {}, { currency: 'cad' });
  assert.match(first.client_id, /^\d{1,15}\.\d{1,15}$/);
  assert.equal(first.client_id, second.client_id);
  assert.equal(first.client_id, fallbackClientId(order.orderNumber));
  assert.notEqual(first.client_id, fallbackClientId('RFX-OTHER-ORDER'));
  assert.equal('session_id' in first.events[0].params, false);
});

test('an event is never timestamped in the future', () => {
  const payload = buildPurchasePayload({ ...order, createdAt: '2099-01-01T00:00:00Z' }, {}, { currency: 'cad', now: 1_000_000 });
  assert.equal(payload.timestamp_micros, 1_000_000 * 1000);
});

test('sendPurchaseEvent posts to Measurement Protocol with the configured stream', async () => {
  const calls = [];
  const result = await sendPurchaseEvent(order, { clientId: '111.222' }, {
    env: { GA4_API_SECRET: 'top-secret', GA4_MEASUREMENT_ID: 'G-ABCDEF1234' },
    currency: 'cad',
    logger: silentLogger,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 }; },
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.google-analytics.com/mp/collect');
  assert.equal(url.searchParams.get('measurement_id'), 'G-ABCDEF1234');
  assert.equal(url.searchParams.get('api_secret'), 'top-secret');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).events[0].params.transaction_id, order.orderNumber);
});

test('sendPurchaseEvent does nothing without configuration', async () => {
  let called = false;
  const result = await sendPurchaseEvent(order, {}, {
    env: {},
    logger: silentLogger,
    fetchImpl: async () => { called = true; return { ok: true }; },
  });
  assert.deepEqual(result, { sent: false, reason: 'not-configured' });
  assert.equal(called, false);
});

test('sendPurchaseEvent never throws and never logs the API secret', async () => {
  const logged = [];
  const logger = { warn: (message) => logged.push(String(message)), error: (message) => logged.push(String(message)) };
  const env = { GA4_API_SECRET: 'top-secret' };

  const rejected = await sendPurchaseEvent(order, {}, { env, logger, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(rejected, { sent: false, reason: 'http-500' });

  const networkError = await sendPurchaseEvent(order, {}, {
    env,
    logger,
    fetchImpl: async (url) => { throw Object.assign(new Error(`connect failed ${url}`), { name: 'FetchError' }); },
  });
  assert.deepEqual(networkError, { sent: false, reason: 'network' });

  const timedOut = await sendPurchaseEvent(order, {}, {
    env,
    logger,
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.deepEqual(timedOut, { sent: false, reason: 'network' });

  assert.equal(logged.length, 3);
  assert.equal(logged.some((line) => line.includes('top-secret')), false, 'API secret must never reach logs');
});
