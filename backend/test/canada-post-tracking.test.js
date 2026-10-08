const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';

const Order = require('../src/models/Order');
const canadaPost = require('../src/utils/canadaPost');
const { syncShippedOrders } = require('../src/utils/trackingSync');
const trackingRouter = require('../src/routes/tracking');

// Shapes copied from a real delivered Reflexity parcel (2026-09-24), locations removed.
const DELIVERED_SUMMARY = { serviceName: 'Flat rate box', expectedDeliveryDate: '2026-09-25', actualDeliveryDate: '2026-09-24', eventType: 'INFO', eventDescription: 'Photo available' };
const DELIVERED_EVENTS = [
  { eventIdentifier: '2001', eventDate: '2026-09-24', eventTime: '11:43:24', eventTimeZone: 'MST', eventDescription: 'Photo available' },
  { eventIdentifier: '1421', eventDate: '2026-09-24', eventTime: '11:43:24', eventTimeZone: 'MST', eventDescription: "Delivered to recipient's front door" },
  { eventIdentifier: '0174', eventDate: '2026-09-24', eventTime: '09:36:09', eventTimeZone: 'MST', eventDescription: 'Item out for delivery' },
  { eventIdentifier: '1302', eventDate: '2026-09-19', eventTime: '11:55:42', eventTimeZone: 'EST', eventDescription: 'Item accepted at the Post Office' },
];

test('Canada Post tracking is read as delivered, out for delivery or waiting for pickup', () => {
  const delivered = canadaPost.normalizeTracking(DELIVERED_SUMMARY, { significantEvents: DELIVERED_EVENTS, expectedDeliveryDate: '2026-09-25' });
  assert.equal(delivered.delivered, true);
  assert.equal(delivered.deliveredOn, '2026-09-24');
  assert.equal(delivered.outForDelivery, false);
  assert.equal(delivered.latest.description, "Delivered to recipient's front door", 'the photo note is not the headline event');

  const out = canadaPost.normalizeTracking({ expectedDeliveryDate: '2026-09-24' }, { significantEvents: DELIVERED_EVENTS.slice(2) });
  assert.equal(out.delivered, false);
  assert.equal(out.outForDelivery, true);
  assert.equal(out.expectedDeliveryDate, '2026-09-24');

  const pickup = canadaPost.normalizeTracking({}, { significantEvents: [
    { eventIdentifier: '1701', eventDate: '2026-09-24', eventTime: '15:02:00', eventDescription: 'Notice card left indicating where and when to pick up item' },
  ] });
  assert.equal(pickup.readyForPickup, true);
  assert.equal(pickup.outForDelivery, false);
});

test('the client caches its OAuth token and sends Bearer + language headers', async () => {
  process.env.CANADA_POST_API_KEY = 'test-key';
  process.env.CANADA_POST_API_SECRET = 'test-secret';
  canadaPost.resetTokenCacheForTest();
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
    if (url.endsWith('/summaries')) return { ok: true, json: async () => [DELIVERED_SUMMARY] };
    return { ok: true, json: async () => ({ significantEvents: DELIVERED_EVENTS }) };
  };
  const result = await canadaPost.trackParcel('1234 5678 9012 3456', fakeFetch);
  await canadaPost.trackParcel('1234567890123456', fakeFetch);
  assert.equal(result.delivered, true);
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1, 'one token for both lookups');
  const tracking = calls.find((c) => c.url.includes('/tracking/v1/pins/1234567890123456/details'));
  assert.ok(tracking, 'spaces are removed from the tracking number');
  assert.equal(tracking.headers.Authorization, 'Bearer tok-1');
  assert.equal(tracking.headers['Accept-Language'], 'en-CA');
  const token = calls.find((c) => c.url.endsWith('/oauth2/token'));
  assert.equal(token.headers['X-IBM-Client-Id'], 'test-key');
});

const { orderStore: fakeOrders } = require('./helpers/orderStore');

const withFakeOrders = async (docs, run) => {
  const fake = fakeOrders(docs);
  const originals = { find: Order.find, updateOne: Order.updateOne, findOneAndUpdate: Order.findOneAndUpdate };
  Object.assign(Order, { find: fake.find, updateOne: fake.updateOne, findOneAndUpdate: fake.findOneAndUpdate });
  try { await run(fake); } finally { Object.assign(Order, originals); }
};

const shippedOrder = (extra = {}) => ({
  _id: 'o1', orderNumber: 'RFX-TRACK', status: 'shipped', paymentStatus: 'paid', trackingNumber: '1234567890123456',
  guestEmail: 'buyer@example.com', shippingAddress: { firstName: 'Buyer' }, ...extra,
});

test('a delivered parcel marks the order delivered and emails the buyer once', async () => {
  await withFakeOrders([shippedOrder()], async (fake) => {
    const sent = [];
    const deps = {
      trackParcel: async () => canadaPost.normalizeTracking(DELIVERED_SUMMARY, { significantEvents: DELIVERED_EVENTS }),
      sendEmail: async (message) => { sent.push(message.kind); },
      now: () => new Date('2026-09-24T20:00:00Z'),
    };
    const first = await syncShippedOrders(deps);
    assert.deepEqual(first, { checked: 1, delivered: 1, emails: 1, errors: 0 });
    const order = fake.store[0];
    assert.equal(order.status, 'delivered');
    assert.equal(order.deliveredAt.toISOString().slice(0, 10), '2026-09-24');
    assert.equal(order.statusHistory.at(-1).note, 'Delivered (Canada Post tracking)');
    assert.equal(order.trackingLatest.description, "Delivered to recipient's front door");
    assert.deepEqual(sent, ['delivered']);
  });
});

test('out for delivery emails once; a stale delivery is recorded without an email', async () => {
  const outTracking = canadaPost.normalizeTracking({}, { significantEvents: DELIVERED_EVENTS.slice(2) });
  await withFakeOrders([shippedOrder()], async (fake) => {
    const sent = [];
    const deps = { trackParcel: async () => outTracking, sendEmail: async (m) => { sent.push(m.kind); }, now: () => new Date('2026-09-24T18:00:00Z') };
    await syncShippedOrders(deps);
    fake.store[0].trackingLatest.checkedAt = undefined; // due again
    await syncShippedOrders(deps);
    assert.deepEqual(sent, ['outForDelivery'], 'second run does not repeat the email');
  });
  await withFakeOrders([shippedOrder()], async (fake) => {
    const sent = [];
    const deps = {
      trackParcel: async () => canadaPost.normalizeTracking(DELIVERED_SUMMARY, { significantEvents: DELIVERED_EVENTS }),
      sendEmail: async (m) => { sent.push(m.kind); },
      now: () => new Date('2026-10-05T12:00:00Z'), // eleven days later
    };
    const result = await syncShippedOrders(deps);
    assert.equal(fake.store[0].status, 'delivered');
    assert.equal(result.emails, 0);
    assert.deepEqual(sent, []);
  });
});

test('a failed email is released so the next run retries it', async () => {
  const outTracking = canadaPost.normalizeTracking({}, { significantEvents: DELIVERED_EVENTS.slice(2) });
  await withFakeOrders([shippedOrder()], async (fake) => {
    let attempts = 0;
    const deps = {
      trackParcel: async () => outTracking,
      sendEmail: async () => { attempts += 1; if (attempts === 1) throw new Error('Resend down'); },
      now: () => new Date('2026-09-24T18:00:00Z'),
    };
    await syncShippedOrders(deps);
    assert.equal(fake.store[0].outForDeliveryEmailAt, undefined, 'claim released after the failure');
    fake.store[0].trackingLatest.checkedAt = undefined;
    await syncShippedOrders(deps);
    assert.equal(attempts, 2);
    assert.ok(fake.store[0].outForDeliveryEmailAt, 'sent on the retry');
  });
});

test('the sync endpoint needs the shared token', async () => {
  const app = express();
  app.use('/api/tracking', trackingRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const call = (auth) => fetch(`http://127.0.0.1:${server.address().port}/api/tracking/sync`, { method: 'POST', headers: auth ? { Authorization: auth } : {} });
  const original = Order.find;
  try {
    process.env.TRACKING_SYNC_TOKEN = 'sync-secret';
    Order.find = () => ({ sort() { return this; }, populate() { return this; }, limit: async () => [] });
    assert.equal((await call()).status, 401);
    assert.equal((await call('Bearer wrong')).status, 401);
    const ok = await call('Bearer sync-secret');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { checked: 0, delivered: 0, emails: 0, errors: 0 });
  } finally {
    Order.find = original;
    await new Promise((resolve) => server.close(resolve));
  }
});
