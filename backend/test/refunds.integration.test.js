// Refunds made in Stripe on a REAL MongoDB replica set or single node, through the SIGNED webhook route: a redelivery and overlapping
// deliveries of one event leave one history line and one alert, partial refunds keep a line each, a refund for a payment with no order
// reaches the owner, and an alert that could not be written makes the webhook fail so Stripe tries again. Skipped unless
// MONGODB_TEST_URI is set; it drops that database. Recipe: see the header of payments-mongo.integration.test.js.
//   MONGODB_TEST_URI='mongodb://127.0.0.1:27019/rfx_refunds_test?directConnection=true' node --test backend/test/refunds.integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_TEST_URI;
const skip = URI ? false : 'set MONGODB_TEST_URI to a throw-away database to run this';

const cancelled = [];
const mail = { sent: 0 };
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => { mail.sent += 1; return { data: { id: `email_${mail.sent}` }, error: null }; }, cancel: async (id) => { cancelled.push(id); return { data: { id }, error: null }; } }; } } },
};
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'refunds-integration-secret', FRONTEND_URL: 'https://reflexityram.com',
  STRIPE_SECRET_KEY: 'sk_test_refunds_int', STRIPE_WEBHOOK_SECRET: 'whsec_refunds_int',
});

const Order = require('../src/models/Order');
const AdminEvent = require('../src/models/AdminEvent');
const stripeRouter = require('../src/routes/stripe');
const { scheduleReviewRequest } = require('../src/utils/reviewRequests');
const { FULL_REFUND_NOTE, partialRefundNote } = require('../src/utils/refunds');

let serial = 0;
const makeOrder = (extra = {}) => {
  serial += 1;
  return Order.create({
    orderNumber: `RFX-RFD-${serial}`, guestEmail: `private${serial}@example.com`,
    items: [{ slug: 'ddr4', sku: 'D4', name: '32GB DDR4 ECC RDIMM', price: 435, qty: 1 }],
    shippingAddress: { firstName: 'Samantha', lastName: 'Privatename', line1: '1 Secret St', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'CA', phone: '+14165550123' },
    subtotal: 435, shippingCost: 14, total: 449, paymentStatus: 'paid', status: 'processing', stockDecremented: true,
    stripeChargeId: `ch_${serial}`, stripePaymentIntentId: `pi_${serial}`, ...extra,
  });
};
const fullCharge = (order, extra = {}) => ({ id: order?.stripeChargeId, object: 'charge', refunded: true, payment_intent: order?.stripePaymentIntentId, amount_refunded: 44900, currency: 'cad', ...extra });
const partialCharge = (order, amount, extra = {}) => ({ id: order?.stripeChargeId, object: 'charge', refunded: false, payment_intent: order?.stripePaymentIntentId, amount_refunded: amount, currency: 'cad', ...extra });
const event = (id, charge) => ({ id, object: 'event', type: 'charge.refunded', data: { object: charge } });

test('refunds on a real MongoDB, through the signed webhook', { skip }, async (root) => {
  await mongoose.connect(URI, { autoIndex: true });
  await mongoose.connection.dropDatabase();
  await Promise.all([Order, AdminEvent].map((model) => model.init()));
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  stripeRouter.setCheckoutDependenciesForTest();
  const app = express();
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/stripe', stripeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  root.after(async () => {
    server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  });
  const send = async (evt) => {
    const payload = JSON.stringify(evt);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload,
    });
    return response.status;
  };
  const reset = async () => { await Promise.all([Order, AdminEvent].map((model) => model.deleteMany({}))); cancelled.length = 0; mail.sent = 0; };
  const fresh = (order) => Order.findById(order._id).lean();
  const alerts = () => AdminEvent.find().sort({ _id: 1 }).lean();
  const notes = (doc) => doc.statusHistory.map((line) => line.note);

  await root.test('a full refund makes the order refunded with the history line the admin screens show, and the owner is told once', async () => {
    await reset();
    const order = await makeOrder();
    const before = await fresh(order);
    assert.equal(await send(event('evt_full', fullCharge(order))), 200);
    const after = await fresh(order);
    assert.deepEqual([after.status, after.paymentStatus], ['refunded', 'refunded']);
    assert.deepEqual(after.statusHistory.map((line) => [line.status, line.note]), [['refunded', FULL_REFUND_NOTE]]);
    assert.equal(FULL_REFUND_NOTE, 'Fully refunded via Stripe; inventory unchanged pending return inspection');
    assert.equal(after.stockDecremented, before.stockDecremented, 'stock is not put back: it waits for the return to be inspected');
    assert.equal(after.total, before.total);
    assert.ok(after.updatedAt > before.updatedAt, 'the order was touched');
    const events = await alerts();
    assert.deepEqual(events.map((e) => [e.type, e.dedupeKey, e.priority]), [['order.refunded', `order.refunded:${order._id}`, 'normal']]);
    assert.equal(String(events[0].orderId), String(order._id));
    assert.equal(events[0].path, `/admin/orders?order=${order._id}`);
    for (const secret of ['Samantha', 'Privatename', 'private', 'example.com', '4165550123', 'Secret St']) assert.equal(`${events[0].title} ${events[0].body}`.includes(secret), false, secret);
  });

  await root.test('Stripe sends the same event again: the second delivery writes nothing', async () => {
    await reset();
    const order = await makeOrder();
    assert.equal(await send(event('evt_full', fullCharge(order))), 200);
    const first = await fresh(order);
    assert.equal(await send(event('evt_full', fullCharge(order))), 200);
    const second = await fresh(order);
    assert.equal(second.statusHistory.length, 1, 'one history line, not two');
    assert.equal(second.updatedAt.getTime(), first.updatedAt.getTime(), 'the order was not written again');
    assert.equal((await alerts()).length, 1);
  });

  await root.test('six deliveries of one event at the same moment leave one line and one alert', async () => {
    await reset();
    const order = await makeOrder();
    const statuses = await Promise.all(Array.from({ length: 6 }, () => send(event('evt_full', fullCharge(order)))));
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200]);
    assert.equal((await fresh(order)).statusHistory.length, 1);
    assert.equal((await alerts()).length, 1);
    // and the same for a partial refund
    await reset();
    const other = await makeOrder();
    await Promise.all(Array.from({ length: 6 }, () => send(event('evt_part', partialCharge(other, 5000)))));
    assert.deepEqual(notes(await fresh(other)), [partialRefundNote(partialCharge(other, 5000))]);
    assert.equal((await alerts()).length, 1);
  });

  await root.test('partial refunds keep a line each, change nothing else, and a later full refund finishes the order', async () => {
    await reset();
    const order = await makeOrder();
    assert.equal(await send(event('evt_p1', partialCharge(order, 5000))), 200);
    assert.equal(await send(event('evt_p1', partialCharge(order, 5000))), 200, 'redelivered');
    const afterFirst = await fresh(order);
    assert.deepEqual([afterFirst.status, afterFirst.paymentStatus], ['processing', 'paid'], 'a partial refund leaves the order as it was');
    assert.equal(afterFirst.statusHistory.length, 1);
    assert.equal(afterFirst.statusHistory[0].status, 'processing');
    assert.equal(afterFirst.statusHistory[0].note, 'Partial Stripe refund recorded (5000 minor currency units); inventory unchanged');
    assert.equal(await send(event('evt_p2', partialCharge(order, 9000))), 200);
    assert.equal(await send(event('evt_f', fullCharge(order))), 200);
    const done = await fresh(order);
    assert.deepEqual(notes(done), [
      'Partial Stripe refund recorded (5000 minor currency units); inventory unchanged',
      'Partial Stripe refund recorded (9000 minor currency units); inventory unchanged',
      FULL_REFUND_NOTE,
    ]);
    assert.deepEqual([done.status, done.paymentStatus], ['refunded', 'refunded']);
    assert.deepEqual((await alerts()).map((e) => e.dedupeKey), ['order.partial_refund:evt_p1', 'order.partial_refund:evt_p2', `order.refunded:${order._id}`]);
  });

  await root.test('two different partial refunds that arrive together both keep their line', async () => {
    await reset();
    const order = await makeOrder();
    await Promise.all([send(event('evt_a', partialCharge(order, 5000))), send(event('evt_b', partialCharge(order, 9000)))]);
    assert.deepEqual(notes(await fresh(order)).sort(), [partialRefundNote({ amount_refunded: 5000 }), partialRefundNote({ amount_refunded: 9000 })].sort());
  });

  await root.test('an order that was made already refunded gets no second line, and one alert', async () => {
    await reset();
    const born = 'Paid, then fully refunded in Stripe before this order was recorded; no stock taken';
    const order = await makeOrder({ status: 'refunded', paymentStatus: 'refunded', statusHistory: [{ status: 'refunded', note: born }] });
    assert.equal(await send(event('evt_late', fullCharge(order))), 200);
    assert.deepEqual(notes(await fresh(order)), [born]);
    assert.deepEqual((await alerts()).map((e) => e.dedupeKey), [`order.refunded:${order._id}`]);
  });

  await root.test('an order is found by its payment when the charge was never stored on it', async () => {
    await reset();
    const order = await makeOrder({ stripeChargeId: undefined });
    assert.equal(await send(event('evt_pi', fullCharge(order, { id: 'ch_not_stored' }))), 200);
    assert.equal((await fresh(order)).status, 'refunded');
  });

  await root.test('a refund for a payment with no order reaches the owner once, creates nothing and leaves other orders alone', async () => {
    await reset();
    const bystander = await makeOrder();
    const unknown = { id: 'ch_nobody', object: 'charge', refunded: true, payment_intent: 'pi_nobody', amount_refunded: 9900, currency: 'cad' };
    assert.equal(await send(event('evt_none', unknown)), 200);
    assert.equal(await send(event('evt_none_again', unknown)), 200);
    assert.equal(await Order.countDocuments(), 1);
    const untouched = await fresh(bystander);
    assert.deepEqual([untouched.status, untouched.paymentStatus, untouched.statusHistory.length], ['processing', 'paid', 0]);
    const events = await alerts();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'payment.refund_unmatched');
    assert.equal(events[0].dedupeKey, 'payment.refund_unmatched:ch_nobody');
    assert.equal(events[0].path, '/admin/orders');
    assert.match(events[0].body, /^Stripe refunded \$99\.00 CAD on charge ch_nobody, but the shop has no order for it\./);
  });

  await root.test('an alert that cannot be written makes the webhook fail, and Stripe\'s next delivery records it', async () => {
    await reset();
    const unknown = { id: 'ch_nobody', object: 'charge', refunded: true, payment_intent: 'pi_nobody', amount_refunded: 9900, currency: 'cad' };
    const realCreate = AdminEvent.create;
    const realError = console.error;
    AdminEvent.create = async () => { throw new Error('database blip'); };
    console.error = () => {};
    try {
      assert.equal(await send(event('evt_none', unknown)), 500, 'not 200: a 200 would tell Stripe the event was handled');
    } finally { AdminEvent.create = realCreate; console.error = realError; }
    assert.equal((await alerts()).length, 0);
    assert.equal(await send(event('evt_none', unknown)), 200, 'the redelivery');
    assert.deepEqual((await alerts()).map((e) => e.type), ['payment.refund_unmatched']);
  });

  await root.test('a full refund takes back the review email that is waiting, once', async () => {
    await reset();
    const order = await makeOrder({ status: 'shipped', shippedAt: new Date() });
    assert.equal((await scheduleReviewRequest(await Order.findById(order._id))).status, 'scheduled');
    assert.equal(mail.sent, 1);
    assert.equal(await send(event('evt_full', fullCharge(order))), 200);
    assert.deepEqual(cancelled, ['email_1']);
    assert.ok((await fresh(order)).reviewRequest.cancelledAt);
    assert.equal(await send(event('evt_full', fullCharge(order))), 200);
    assert.deepEqual(cancelled, ['email_1'], 'a redelivery does not ask Resend again');
  });
});
