// Refunds made in Stripe (charge.refunded) without a database: what the order gets, what the owner's phone is told, that a redelivery
// changes nothing twice, and that a failure makes the webhook answer 500 so Stripe sends the event again. The same things on a real
// MongoDB, through the signed route and with overlapping deliveries, are in refunds.integration.test.js (needs MONGODB_TEST_URI).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } } };
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_refunds_unit';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_refunds_unit';
process.env.JWT_SECRET ||= 'refunds-unit-secret';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeRouter = require('../src/routes/stripe');
const { recordRefundEvent, isFullyRefundedCharge, FULL_REFUND_NOTE, partialRefundNote } = require('../src/utils/refunds');
const { recordRequiredAdminEvent } = require('../src/utils/adminEvents');
const { refundOrderStore } = require('./helpers/refundOrderStore');

const baseOrder = (extra = {}) => ({
  _id: 'order-1', orderNumber: 'RFX-TEST-1', total: 281.3, paymentMethod: 'stripe', status: 'processing', paymentStatus: 'paid',
  items: [{ qty: 2, name: '16GB DDR4 ECC RDIMM' }], guestEmail: 'sam.private@example.com',
  shippingAddress: { firstName: 'Samantha', lastName: 'Privatename', line1: '100 Secret St W', city: 'Toronto', phone: '+14165550123' },
  statusHistory: [], reviewRequest: {}, ...extra,
});
const full = (extra = {}) => ({ id: 'ch_1', object: 'charge', refunded: true, payment_intent: 'pi_1', amount_refunded: 28130, currency: 'cad', ...extra });
const partial = (amount, extra = {}) => ({ id: 'ch_1', object: 'charge', refunded: false, payment_intent: 'pi_1', amount_refunded: amount, currency: 'cad', ...extra });
const event = (id, charge) => ({ id, object: 'event', type: 'charge.refunded', data: { object: charge } });

function harness(order = baseOrder(), { found = true } = {}) {
  const store = refundOrderStore(order);
  const calls = { finds: [], alerts: [], required: [], cancels: [], logs: [] };
  const OrderModel = { findOne: async (filter) => { calls.finds.push(filter); return found ? order : null; }, findOneAndUpdate: store.findOneAndUpdate };
  const logger = { log: (m) => calls.logs.push(m), warn: (m) => calls.logs.push(m), error: (m) => calls.logs.push(m) };
  return {
    order, store, calls,
    deps: {
      OrderModel, logger, now: () => new Date('2026-10-20T12:00:00Z'),
      record: async (alert) => { calls.alerts.push(alert); return alert; },
      announce: async (alert) => { calls.required.push(alert); },
      cancelReview: async (o) => { calls.cancels.push(o._id); return true; },
    },
  };
}

test('only `refunded: true` is a full refund (Stripe sends charge.refunded for partial ones too)', () => {
  assert.equal(isFullyRefundedCharge({ refunded: true, amount_refunded: 1000 }), true);
  assert.equal(isFullyRefundedCharge({ refunded: false, amount_refunded: 500 }), false);
  assert.equal(isFullyRefundedCharge(null), false);
});

test('a full refund makes the order refunded with one history line, tells the owner and cancels the waiting review email', async () => {
  const { order, calls, deps, store } = harness();
  const result = await recordRefundEvent(event('evt_full', full()), deps);
  assert.deepEqual(result, { matched: true, applied: true });
  assert.deepEqual(calls.finds, [{ $or: [{ stripeChargeId: 'ch_1' }, { stripePaymentIntentId: 'pi_1' }] }]);
  assert.equal(order.status, 'refunded');
  assert.equal(order.paymentStatus, 'refunded');
  assert.deepEqual(order.statusHistory.map((line) => [line.status, line.note]), [['refunded', 'Fully refunded via Stripe; inventory unchanged pending return inspection']]);
  assert.equal(FULL_REFUND_NOTE, order.statusHistory[0].note, 'the wording the admin screens have always shown');
  // the write is conditional: it only changes an order that is not refunded yet
  assert.deepEqual(store.updates[0].filter, { _id: 'order-1', paymentStatus: { $ne: 'refunded' } });
  assert.deepEqual(calls.alerts.map((a) => [a.type, a.dedupeKey, a.priority]), [['order.refunded', 'order.refunded:order-1', 'normal']]);
  assert.deepEqual(calls.cancels, ['order-1']);
  assert.deepEqual(calls.required, [], 'an order was found: no "refund with no order" alert');
});

test('the same full-refund event delivered again adds no second line and no second change, and still repeats the keyed alert and cancel', async () => {
  const { order, calls, deps } = harness();
  assert.equal((await recordRefundEvent(event('evt_full', full()), deps)).applied, true);
  const again = await recordRefundEvent(event('evt_full', full()), deps);
  assert.deepEqual(again, { matched: true, applied: false });
  assert.equal(order.statusHistory.length, 1);
  // a first delivery that stopped after the write is finished by the redelivery: the alert (it has a key) and the cancel are repeated
  assert.equal(calls.alerts.length, 2);
  assert.equal(calls.alerts[0].dedupeKey, calls.alerts[1].dedupeKey);
  assert.equal(calls.cancels.length, 2);
});

test('an order that was made already refunded (the refund came first) gets no extra line when charge.refunded arrives', async () => {
  const { order, deps, calls } = harness(baseOrder({ status: 'refunded', paymentStatus: 'refunded', statusHistory: [{ status: 'refunded', note: 'Paid, then fully refunded in Stripe before this order was recorded; no stock taken' }] }));
  const result = await recordRefundEvent(event('evt_late', full()), deps);
  assert.deepEqual(result, { matched: true, applied: false });
  assert.equal(order.statusHistory.length, 1);
  assert.equal(calls.alerts[0].dedupeKey, 'order.refunded:order-1', 'the same key the order\'s own "refunded" alert has, so the owner hears it once');
});

test('a partial refund adds one line with the total refunded so far, leaves status, payment and stock alone, and a redelivery adds nothing', async () => {
  const { order, calls, deps, store } = harness();
  assert.deepEqual(await recordRefundEvent(event('evt_p1', partial(5000)), deps), { matched: true, applied: true });
  assert.deepEqual(await recordRefundEvent(event('evt_p1', partial(5000)), deps), { matched: true, applied: false });
  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.statusHistory[0].note, 'Partial Stripe refund recorded (5000 minor currency units); inventory unchanged');
  assert.equal(order.statusHistory[0].note, partialRefundNote(partial(5000)));
  assert.equal(order.statusHistory[0].status, 'processing', 'the line carries the order\'s own status');
  assert.deepEqual([order.status, order.paymentStatus], ['processing', 'paid']);
  assert.deepEqual(store.updates[0].filter, { _id: 'order-1', 'statusHistory.note': { $ne: 'Partial Stripe refund recorded (5000 minor currency units); inventory unchanged' } });
  assert.equal(store.updates[0].update.$set, undefined, 'a partial refund sets nothing on the order');
  assert.deepEqual(calls.alerts.map((a) => [a.type, a.dedupeKey]), [['order.partial_refund', 'order.partial_refund:evt_p1'], ['order.partial_refund', 'order.partial_refund:evt_p1']]);
  assert.deepEqual(calls.cancels, [], 'a partial refund leaves the review email alone');
  // a second partial refund is a new fact: the total so far is larger, so it has its own line
  assert.deepEqual(await recordRefundEvent(event('evt_p2', partial(9000)), deps), { matched: true, applied: true });
  assert.equal(order.statusHistory.length, 2);
});

test('a refund for a charge with no order tells the owner (once per charge, nothing private) and returns without touching anything', async () => {
  const { order, calls, deps, store } = harness(baseOrder(), { found: false });
  const result = await recordRefundEvent(event('evt_none', full({ id: 'ch_none', payment_intent: 'pi_none', amount_refunded: 9900 })), deps);
  assert.deepEqual(result, { matched: false, applied: false });
  assert.equal(store.updates.length, 0);
  assert.deepEqual(order.statusHistory, []);
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.required.length, 1);
  const [alert] = calls.required;
  assert.equal(alert.type, 'payment.refund_unmatched');
  assert.equal(alert.dedupeKey, 'payment.refund_unmatched:ch_none');
  assert.equal(alert.priority, 'normal');
  assert.equal(alert.title, 'Refund on a payment with no order');
  assert.match(alert.body, /^Stripe refunded \$99\.00 CAD on charge ch_none, but the shop has no order for it\./);
  for (const secret of ['Samantha', 'Privatename', 'sam.private', 'example.com', '4165550123', 'Secret St']) assert.equal(`${alert.title} ${alert.body}`.includes(secret), false, secret);
  assert.ok(calls.logs.some((line) => /Refund on charge ch_none matches no order/.test(line)), 'and it is logged as before');
});

test('the alert for a refund with no order must be recorded: one that could not be written throws, so Stripe sends the event again', async () => {
  const { deps } = harness(baseOrder(), { found: false });
  const unrecorded = { ...deps, announce: (alert) => recordRequiredAdminEvent(alert, { record: async () => null, exists: async () => false }) };
  await assert.rejects(recordRefundEvent(event('evt_none', full({ id: 'ch_none' })), unrecorded), /The "payment.refund_unmatched" alert for payment.refund_unmatched:ch_none could not be recorded/);
  // already announced earlier (a redelivery) is fine
  const announced = { ...deps, announce: (alert) => recordRequiredAdminEvent(alert, { record: async () => null, exists: async () => true }) };
  assert.deepEqual(await recordRefundEvent(event('evt_none', full({ id: 'ch_none' })), announced), { matched: false, applied: false });
});

test('an event without a charge is ignored, and a database error is not swallowed', async () => {
  const { deps, calls } = harness();
  assert.deepEqual(await recordRefundEvent({ id: 'evt_x', data: { object: {} } }, deps), { matched: false, applied: false });
  assert.equal(calls.finds.length, 0);
  const broken = { ...deps, OrderModel: { findOne: async () => { throw new Error('connection lost'); }, findOneAndUpdate: async () => null } };
  await assert.rejects(recordRefundEvent(event('evt_full', full()), broken), /connection lost/);
  const failsOnWrite = { ...deps, OrderModel: { findOne: async () => baseOrder(), findOneAndUpdate: async () => { throw new Error('write failed'); } } };
  await assert.rejects(recordRefundEvent(event('evt_full', full()), failsOnWrite), /write failed/);
});

test('a review email that cannot be cancelled is logged and does not undo the refund', async () => {
  const { order, deps, calls } = harness();
  const result = await recordRefundEvent(event('evt_full', full()), { ...deps, cancelReview: async () => { throw new Error('resend down'); } });
  assert.equal(result.applied, true);
  assert.equal(order.status, 'refunded');
  assert.ok(calls.logs.some((line) => /Review email cancel failed/.test(line)));
});

// ─── the webhook route hands the event over, and a failure makes Stripe try again ────────────────────────────────────────
async function post(app, evt) {
  const payload = JSON.stringify(evt);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) },
      body: payload,
    });
    return response.status;
  } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
}

test('the signed webhook hands charge.refunded to the recorder: 200 when it succeeds, 500 when it throws (Stripe retries)', async (t) => {
  const app = express();
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/stripe', stripeRouter);
  t.after(() => stripeRouter.setCheckoutDependenciesForTest());
  const seen = [];
  stripeRouter.setCheckoutDependenciesForTest({ recordRefund: async (evt) => { seen.push(evt.id); return { matched: true, applied: true }; } });
  assert.equal(await post(app, event('evt_route_ok', full())), 200);
  assert.deepEqual(seen, ['evt_route_ok']);
  const logError = console.error;
  console.error = () => {};
  try {
    stripeRouter.setCheckoutDependenciesForTest({ recordRefund: async () => { throw new Error('database down'); } });
    assert.equal(await post(app, event('evt_route_fail', full())), 500);
  } finally { console.error = logError; }
});
