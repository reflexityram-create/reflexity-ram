const test = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../src/models/Order');
const { normalizeTracking } = require('../src/utils/canadaPost');
const { syncShippedOrders } = require('../src/utils/trackingSync');
const { notifyShipment, CLAIM_MS } = require('../src/utils/shippingNotifications');
const { orderStore } = require('./helpers/orderStore');

const NOW = new Date('2026-10-08T15:00:00Z');
const order = (extra = {}) => ({ _id: 'order-1', orderNumber: 'RFX-TEST', status: 'pending', paymentStatus: 'paid',
  trackingNumber: 'CP123', guestEmail: 'buyer@example.com', ...extra });
const accepted = normalizeTracking({}, { significantEvents: [
  { eventIdentifier: '1302', eventDescription: 'Item accepted at the Post Office', eventDate: '2026-10-08' },
] });
async function withStore(docs, run) {
  const fake = orderStore(docs);
  const originals = { find: Order.find, updateOne: Order.updateOne, findOneAndUpdate: Order.findOneAndUpdate };
  Object.assign(Order, { find: fake.find, updateOne: fake.updateOne, findOneAndUpdate: fake.findOneAndUpdate });
  try { await run(fake); } finally { Object.assign(Order, originals); }
}
const depsFor = (tracking, sent, extra = {}) => ({ trackParcel: async () => tracking, now: () => NOW,
  scheduleReview: async () => {}, sendEmail: async (m) => sent.push(m.kind),
  notifyShipment: (o, opts) => notifyShipment(o, { ...opts, sendEmail: async (m) => sent.push(m) }), ...extra });

test('electronic information and labels cannot count as physical shipment', () => {
  for (const eventDescription of ['Electronic information submitted by shipper', 'Shipping label created', 'Expected delivery']) {
    assert.equal(normalizeTracking({}, { significantEvents: [{ eventDescription }] }).hasShipped, false);
  }
  assert.equal(accepted.hasShipped, true);
  assert.equal(accepted.shippedOn, '2026-10-08');
});

test('a pending paid order becomes shipped only on a physical scan and notifies once', async () => {
  await withStore([order()], async (fake) => {
    const sent = [];
    const deps = depsFor(accepted, sent);
    await syncShippedOrders(deps);
    assert.equal(fake.store[0].status, 'shipped');
    assert.equal(fake.store[0].shippingNotification.status, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].order.trackingNumber, 'CP123');
    assert.equal(sent[0].idempotencyKey, 'shipment/order-1');
    fake.store[0].trackingLatest.checkedAt = undefined;
    await syncShippedOrders(deps);
    assert.equal(sent.length, 1);
    assert.equal(fake.store[0].statusHistory.length, 1);
  });
});

test('label-only pending orders, unpaid orders and cancelled orders never send shipping mail', async () => {
  await withStore([order(), order({ _id: 'unpaid', paymentStatus: 'pending' }), order({ _id: 'cancelled', status: 'cancelled' })], async (fake) => {
    const sent = [];
    const result = await syncShippedOrders(depsFor(normalizeTracking({}, { significantEvents: [{ eventDescription: 'Electronic information submitted by shipper' }] }), sent));
    assert.equal(result.checked, 1);
    assert.deepEqual(sent, []);
    assert.equal(fake.store[0].status, 'pending');
  });
});

test('failed shipping mail retries automatically while legacy shipped orders are not re-emailed', async () => {
  await withStore([order(), order({ _id: 'legacy', status: 'shipped' })], async (fake) => {
    let attempts = 0;
    const deps = depsFor(accepted, [], {
      notifyShipment: (o, opts) => notifyShipment(o, { ...opts, sendEmail: async () => { if (++attempts === 1) throw new Error('provider unavailable'); } }),
    });
    await syncShippedOrders(deps);
    assert.equal(fake.store[0].shippingNotification.status, 'failed');
    await syncShippedOrders(deps);
    assert.equal(fake.store[0].shippingNotification.status, 'sent');
    assert.equal(attempts, 2);
    assert.equal(fake.store[1].shippingNotification, undefined);
  });
});

test('two workers share one claim and a crashed claim can be reclaimed after its lease', async () => {
  const fake = orderStore([order({ status: 'shipped', shippingNotification: { status: 'pending' } })]);
  let sends = 0;
  const deps = { Order: fake, now: () => NOW, sendEmail: async () => { sends += 1; } };
  await Promise.all([notifyShipment(fake.store[0], deps), notifyShipment(fake.store[0], deps)]);
  assert.equal(sends, 1);
  fake.store[0].shippingNotification = { status: 'sending', claimedAt: new Date(NOW - CLAIM_MS - 1) };
  await notifyShipment(fake.store[0], deps);
  assert.equal(sends, 2);
});

test('first lookup already delivered skips misleading shipped email and retries delivery failures', async () => {
  await withStore([order()], async (fake) => {
    const sent = [];
    let attempts = 0;
    const deps = depsFor(normalizeTracking({ actualDeliveryDate: '2026-10-08' }, {}), sent, {
      sendEmail: async (m) => { if (++attempts === 1) throw new Error('provider unavailable'); sent.push(m.kind); },
    });
    await syncShippedOrders(deps);
    assert.equal(fake.store[0].status, 'delivered');
    assert.equal(fake.store[0].shippingNotification.status, 'skipped');
    fake.store[0].trackingLatest.checkedAt = undefined;
    await syncShippedOrders(deps);
    assert.deepEqual(sent, ['delivered']);
  });
});

test('a tracking number changed during the carrier request cannot overwrite the new number or send mail', async () => {
  await withStore([order()], async (fake) => {
    const sent = [];
    await syncShippedOrders(depsFor(accepted, sent, { trackParcel: async () => { fake.store[0].trackingNumber = 'REPLACED'; return accepted; } }));
    assert.equal(fake.store[0].status, 'pending');
    assert.equal(fake.store[0].trackingLatest, undefined);
    assert.deepEqual(sent, []);
  });
});
