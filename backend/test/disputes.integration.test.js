// Disputes on a REAL MongoDB replica set or single node: the nested `dispute` path, the "never let an older event overwrite a newer
// one" write, redelivery, concurrent events, and the owner's alerts, all through the SIGNED webhook route. Skipped unless
// MONGODB_TEST_URI is set; it drops that database. Recipe: see the header of payments-mongo.integration.test.js.
//   MONGODB_TEST_URI='mongodb://127.0.0.1:27019/rfx_disputes_test?directConnection=true' node --test backend/test/disputes.integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_TEST_URI;
const skip = URI ? false : 'set MONGODB_TEST_URI to a throw-away database to run this';

const cancelled = [];
const mail = { sent: 0, whileSending: null };   // whileSending: something that happens at the moment an email is being handed to Resend
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => { mail.sent += 1; if (mail.whileSending) await mail.whileSending(); return { data: { id: `email_${mail.sent}` }, error: null }; }, cancel: async (id) => { cancelled.push(id); return { data: { id }, error: null }; } }; } } },
};
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'disputes-integration-secret', FRONTEND_URL: 'https://reflexityram.com',
  STRIPE_SECRET_KEY: 'sk_test_disputes_int', STRIPE_WEBHOOK_SECRET: 'whsec_disputes_int',
});

const Order = require('../src/models/Order');
const AdminEvent = require('../src/models/AdminEvent');
const stripeRouter = require('../src/routes/stripe');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { scheduleReviewRequest } = require('../src/utils/reviewRequests');

const T0 = 1791972900;   // Stripe's clock, in seconds
let serial = 0;
const makeOrder = (extra = {}) => {
  serial += 1;
  return Order.create({
    orderNumber: `RFX-DSP-${serial}`, guestEmail: `private${serial}@example.com`,
    items: [{ slug: 'ddr4', sku: 'D4', name: '32GB DDR4 ECC RDIMM', price: 435, qty: 1 }],
    shippingAddress: { firstName: 'Samantha', lastName: 'Privatename', line1: '1 Secret St', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'CA', phone: '+14165550123' },
    subtotal: 435, shippingCost: 14, total: 449, paymentStatus: 'paid', status: 'processing',
    stripeChargeId: `ch_${serial}`, stripePaymentIntentId: `pi_${serial}`, ...extra,
  });
};
const dispute = (order, extra = {}) => ({
  id: 'dp_1', object: 'dispute', amount: 44900, currency: 'cad', charge: order?.stripeChargeId, payment_intent: order?.stripePaymentIntentId,
  created: T0 - 600, reason: 'product_not_received', status: 'needs_response',
  evidence_details: { due_by: T0 + 14 * 86400, has_evidence: false, past_due: false, submission_count: 0 }, ...extra,
});
let eventSerial = 0;
const event = (type, object, created) => { eventSerial += 1; return { id: `evt_${eventSerial}`, object: 'event', type, created, data: { object } }; };

test('disputes on a real MongoDB, through the signed webhook', { skip }, async (root) => {
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
  const reset = async () => { await Promise.all([Order, AdminEvent].map((model) => model.deleteMany({}))); cancelled.length = 0; mail.sent = 0; mail.whileSending = null; };
  const fresh = (order) => Order.findById(order._id).lean();
  const alerts = () => AdminEvent.find().sort({ _id: 1 }).lean();

  await root.test('an opened dispute is saved on the order, nothing else about the order changes, and the owner is alerted', async () => {
    await reset();
    const order = await makeOrder();
    const before = await fresh(order);
    assert.equal(await send(event('charge.dispute.created', dispute(order), T0)), 200);
    const after = await fresh(order);
    assert.deepEqual(
      { id: after.dispute.id, status: after.dispute.status, reason: after.dispute.reason, amount: after.dispute.amount, currency: after.dispute.currency },
      { id: 'dp_1', status: 'needs_response', reason: 'product_not_received', amount: 449, currency: 'cad' },
    );
    assert.equal(after.dispute.reasonText, 'the buyer says the order never arrived');
    assert.equal(after.dispute.evidenceDueBy.getTime(), (T0 + 14 * 86400) * 1000);
    assert.equal(after.dispute.openedAt.getTime(), (T0 - 600) * 1000);
    assert.equal(after.dispute.eventAt.getTime(), T0 * 1000);
    assert.equal(after.dispute.closedAt, undefined);
    // the order itself is exactly as it was: the owner decides what a dispute means
    for (const field of ['status', 'paymentStatus', 'total', 'stockDecremented', 'stripeChargeId', 'stripePaymentIntentId', 'trackingNumber']) assert.deepEqual(after[field], before[field], field);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.statusHistory.length, before.statusHistory.length, 'no line is added to the history the buyer can read');
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'and updatedAt does not move');
    const events = await alerts();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'order.dispute_opened');
    assert.equal(events[0].priority, 'high');
    assert.equal(events[0].dedupeKey, 'order.dispute_opened:dp_1');
    assert.equal(String(events[0].orderId), String(order._id));
    assert.equal(events[0].path, `/admin/orders?order=${order._id}`);
    assert.match(events[0].body, new RegExp(`^${order.orderNumber} · \\$449\\.00 CAD · 1× 32GB DDR4 ECC RDIMM · Card · the buyer says the order never arrived\\. Stripe took \\$449\\.00 back until it is settled\\. Send evidence in Stripe by Oct 28\\. Do not ship it\\.$`));
    for (const secret of ['Samantha', 'Privatename', 'private', 'example.com', '4165550123', 'Secret St']) assert.equal(`${events[0].title} ${events[0].body}`.includes(secret), false, secret);
  });

  await root.test('the buyer\'s own view of the order never shows it', async () => {
    await reset();
    const order = await makeOrder();
    await send(event('charge.dispute.created', dispute(order), T0));
    const shaped = customerOrderResponse(await Order.findById(order._id));
    assert.equal('dispute' in shaped, false);
    assert.equal(JSON.stringify(shaped).includes('dp_1'), false);
  });

  await root.test('Stripe sends the same event again: still one alert, the same record', async () => {
    await reset();
    const order = await makeOrder();
    const evt = event('charge.dispute.created', dispute(order), T0);
    for (let n = 0; n < 3; n += 1) assert.equal(await send(evt), 200);
    assert.equal((await alerts()).length, 1);
    assert.equal((await fresh(order)).dispute.status, 'needs_response');
  });

  await root.test('the whole life of a dispute: opened, evidence sent, lost; each step recorded, the owner alerted at the start and the end', async () => {
    await reset();
    const order = await makeOrder();
    await send(event('charge.dispute.created', dispute(order), T0));
    await send(event('charge.dispute.updated', dispute(order, { status: 'under_review', evidence_details: { due_by: T0 + 14 * 86400, has_evidence: true, past_due: false, submission_count: 1 } }), T0 + 3600));
    let state = (await fresh(order)).dispute;
    assert.equal(state.status, 'under_review');
    assert.equal(state.closedAt, undefined);
    await send(event('charge.dispute.closed', dispute(order, { status: 'lost' }), T0 + 7200));
    state = (await fresh(order)).dispute;
    assert.equal(state.status, 'lost');
    assert.equal(state.closedAt.getTime(), (T0 + 7200) * 1000);
    assert.deepEqual((await alerts()).map((e) => [e.type, e.priority]), [['order.dispute_opened', 'high'], ['order.dispute_lost', 'high']]);
    assert.equal((await fresh(order)).status, 'processing', 'losing does not cancel, refund or ship anything by itself');
  });

  await root.test('events that arrive late and out of order never undo a newer state', async () => {
    await reset();
    const order = await makeOrder();
    // the closing event is delivered first; the older ones show up afterwards (Stripe retries, network delays)
    assert.equal(await send(event('charge.dispute.closed', dispute(order, { status: 'won' }), T0 + 7200)), 200);
    assert.equal(await send(event('charge.dispute.updated', dispute(order, { status: 'under_review' }), T0 + 3600)), 200);
    assert.equal(await send(event('charge.dispute.created', dispute(order), T0)), 200);
    const state = (await fresh(order)).dispute;
    assert.equal(state.status, 'won');
    assert.equal(state.eventAt.getTime(), (T0 + 7200) * 1000);
    assert.deepEqual((await alerts()).map((e) => e.type), ['order.dispute_won'], 'and the late events said nothing');
  });

  await root.test('events racing each other settle on the newest one every time', async () => {
    for (let round = 0; round < 8; round += 1) {
      await reset();
      const order = await makeOrder();
      const steps = [
        event('charge.dispute.created', dispute(order), T0),
        event('charge.dispute.updated', dispute(order, { status: 'under_review' }), T0 + 100),
        event('charge.dispute.updated', dispute(order, { status: 'under_review', reason: 'general' }), T0 + 200),
        event('charge.dispute.closed', dispute(order, { status: 'lost' }), T0 + 300),
      ];
      // a different order each round
      const shuffled = [...steps].sort(() => Math.random() - 0.5);
      const statuses = await Promise.all(shuffled.map((evt) => send(evt)));
      assert.deepEqual(statuses, [200, 200, 200, 200]);
      const state = (await fresh(order)).dispute;
      assert.equal(state.status, 'lost', `round ${round}`);
      assert.equal(state.eventAt.getTime(), (T0 + 300) * 1000, `round ${round}`);
    }
  });

  await root.test('a bank inquiry that closes, then a real dispute with a new id: the order shows the newer one', async () => {
    await reset();
    const order = await makeOrder();
    await send(event('charge.dispute.created', dispute(order, { id: 'dp_inq', status: 'warning_needs_response' }), T0));
    await send(event('charge.dispute.closed', dispute(order, { id: 'dp_inq', status: 'warning_closed' }), T0 + 100));
    assert.equal((await fresh(order)).dispute.status, 'warning_closed');
    await send(event('charge.dispute.created', dispute(order, { id: 'dp_real', status: 'needs_response' }), T0 + 200));
    const state = (await fresh(order)).dispute;
    assert.deepEqual([state.id, state.status], ['dp_real', 'needs_response']);
    assert.deepEqual((await alerts()).map((e) => e.type), ['order.dispute_inquiry', 'order.dispute_inquiry_closed', 'order.dispute_opened']);
  });

  await root.test('a late event about an OLDER dispute never replaces a newer dispute on the order (an inquiry\'s closing arriving after the real dispute opened)', async () => {
    await reset();
    const order = await makeOrder();
    await send(event('charge.dispute.created', dispute(order, { id: 'dp_inq', status: 'warning_needs_response' }), T0));
    // the real dispute opens at T0+200; only then does the inquiry's closing event (made at T0+100) get through
    await send(event('charge.dispute.created', dispute(order, { id: 'dp_real', status: 'needs_response' }), T0 + 200));
    assert.equal(await send(event('charge.dispute.closed', dispute(order, { id: 'dp_inq', status: 'warning_closed' }), T0 + 100)), 200);
    const state = (await fresh(order)).dispute;
    assert.deepEqual([state.id, state.status], ['dp_real', 'needs_response'], 'the owner still sees the dispute that needs an answer');
    assert.deepEqual((await alerts()).map((e) => e.type), ['order.dispute_inquiry', 'order.dispute_opened']);
  });

  await root.test('events made in the very same second never move a dispute backwards, in either order of arrival, and a repeat is taken again', async () => {
    for (const [name, steps, expected] of [
      ['the closing arrives first', [['closed', 'lost'], ['updated', 'under_review'], ['created', 'needs_response']], 'lost'],
      ['the closing arrives last', [['created', 'needs_response'], ['updated', 'under_review'], ['closed', 'lost']], 'lost'],
      ['evidence in, then the first snapshot late', [['updated', 'under_review'], ['created', 'needs_response']], 'under_review'],
    ]) {
      await reset();
      const order = await makeOrder();
      for (const [kind, status] of steps) assert.equal(await send(event(`charge.dispute.${kind}`, dispute(order, { status }), T0)), 200, `${name}: ${kind}`);
      const state = (await fresh(order)).dispute;
      assert.equal(state.status, expected, name);
      assert.equal(Boolean(state.closedAt), expected === 'lost', `${name}: a closed dispute keeps its closing time and an open one has none`);
    }
    // the same event delivered twice in that second is not "backwards"
    await reset();
    const order = await makeOrder();
    const evt = event('charge.dispute.updated', dispute(order, { status: 'under_review' }), T0);
    assert.deepEqual([await send(evt), await send(evt)], [200, 200]);
    assert.equal((await fresh(order)).dispute.status, 'under_review');
    // a different dispute in the same second is just the latest one to arrive (the inquiry's end and the real dispute's start)
    await reset();
    const other = await makeOrder();
    await send(event('charge.dispute.closed', dispute(other, { id: 'dp_inq', status: 'warning_closed' }), T0));
    await send(event('charge.dispute.created', dispute(other, { id: 'dp_real', status: 'needs_response' }), T0));
    assert.deepEqual([(await fresh(other)).dispute.id, (await fresh(other)).dispute.status], ['dp_real', 'needs_response'], 'a first-stage dispute is not refused because an inquiry had finished');
  });

  await root.test('if the owner\'s alert cannot be written the webhook fails and the retry sends it: the alert is never silently lost', async () => {
    await reset();
    const order = await makeOrder();
    const quiet = console.error; console.error = () => {};
    const original = AdminEvent.create;
    AdminEvent.create = async () => { throw new Error('insert failed'); };
    let failedStatus;
    try { failedStatus = await send(event('charge.dispute.created', dispute(order), T0)); } finally { AdminEvent.create = original; console.error = quiet; }
    assert.equal(failedStatus, 500, 'Stripe is told to try again');
    assert.equal((await alerts()).length, 0);
    assert.equal((await fresh(order)).dispute.status, 'needs_response', 'the dispute itself was saved');
    // Stripe's retry, with the very same event
    const evt = event('charge.dispute.created', dispute(order), T0);
    assert.equal(await send(evt), 200);
    const events = await alerts();
    assert.deepEqual(events.map((e) => e.type), ['order.dispute_opened']);
    // and once it is there, a further retry is a plain duplicate: no error, no second alert
    assert.equal(await send(evt), 200);
    assert.equal((await alerts()).length, 1);
  });

  await root.test('a dispute that lands while the review email is being scheduled still stops it: whichever finishes second sees the other', async () => {
    await reset();
    const order = await makeOrder({ status: 'shipped', shippedAt: new Date() });
    const snapshot = await Order.findById(order._id);   // what the shipping code holds: from before the dispute
    mail.whileSending = async () => { mail.whileSending = null; assert.equal(await send(event('charge.dispute.created', dispute(order), T0)), 200); };
    const result = await scheduleReviewRequest(snapshot);
    assert.deepEqual(result, { status: 'skipped', reason: 'disputed' });
    assert.deepEqual(cancelled, ['email_1'], 'the email that was scheduled a moment before the dispute is taken back');
    assert.ok((await fresh(order)).reviewRequest.cancelledAt);
  });

  await root.test('an out-of-date copy of an order is not enough to schedule a review email for a disputed one, and a won dispute is asked as usual', async () => {
    await reset();
    const order = await makeOrder({ status: 'shipped', shippedAt: new Date() });
    const snapshot = await Order.findById(order._id);
    await send(event('charge.dispute.created', dispute(order), T0));
    assert.deepEqual(await scheduleReviewRequest(snapshot), { status: 'skipped', reason: 'disputed' }, 'the claim itself looks at the database');
    assert.equal(mail.sent, 0, 'nothing was handed to Resend');
    assert.equal((await fresh(order)).reviewRequest?.claimedAt, undefined, 'and nothing was claimed');
    await send(event('charge.dispute.closed', dispute(order, { status: 'won' }), T0 + 100));
    assert.equal((await scheduleReviewRequest(await Order.findById(order._id))).status, 'scheduled', 'once the dispute is won the buyer is asked');
  });

  await root.test('an order is found by its payment when the charge was never stored on it', async () => {
    await reset();
    const order = await makeOrder({ stripeChargeId: undefined });
    await send(event('charge.dispute.created', dispute(order, { charge: 'ch_not_stored' }), T0));
    assert.equal((await fresh(order)).dispute.id, 'dp_1');
  });

  await root.test('a dispute for a payment with no order alerts the owner and touches nothing', async () => {
    await reset();
    const order = await makeOrder();
    assert.equal(await send(event('charge.dispute.created', dispute(order, { charge: 'ch_nobody', payment_intent: 'pi_nobody' }), T0)), 200);
    assert.equal((await fresh(order)).dispute, undefined);
    const events = await alerts();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'payment.dispute_unmatched');
    assert.equal(events[0].orderId, undefined);
    assert.equal(events[0].path, '/admin/orders');
    // sent again, and updated: still one
    await send(event('charge.dispute.updated', dispute(order, { charge: 'ch_nobody', payment_intent: 'pi_nobody', status: 'under_review' }), T0 + 60));
    assert.equal((await alerts()).length, 1);
  });

  await root.test('a buyer who disputes is not asked how the order went: the waiting email is cancelled once, and none is scheduled later', async () => {
    await reset();
    const soon = new Date(Date.now() + 5 * 86400000);
    const order = await makeOrder({ status: 'shipped', reviewRequest: { claimedAt: new Date(), scheduledFor: soon, emailId: 'email_review_1' } });
    await send(event('charge.dispute.created', dispute(order), T0));
    assert.deepEqual(cancelled, ['email_review_1']);
    assert.ok((await fresh(order)).reviewRequest.cancelledAt, 'and it is marked cancelled');
    await send(event('charge.dispute.updated', dispute(order, { status: 'under_review' }), T0 + 60));
    assert.deepEqual(cancelled, ['email_review_1'], 'a second event does not cancel it again');
    // won: nothing is cancelled for an order whose dispute ended well (this order has no email waiting any more)
    const won = await makeOrder({ status: 'shipped', reviewRequest: { claimedAt: new Date(), scheduledFor: soon, emailId: 'email_review_2' } });
    await send(event('charge.dispute.closed', dispute(won, { id: 'dp_won', status: 'won' }), T0));
    assert.deepEqual(cancelled, ['email_review_1'], 'a won dispute leaves the email alone');
  });

  await root.test('a database that is down makes the webhook answer 500 (Stripe tries again) rather than losing the dispute', async () => {
    await reset();
    const order = await makeOrder();
    const quiet = console.error; console.error = () => {};
    const original = Order.findOne;
    Order.findOne = () => { throw new Error('connection lost'); };
    try { assert.equal(await send(event('charge.dispute.created', dispute(order), T0)), 500); } finally { Order.findOne = original; console.error = quiet; }
    assert.equal(await send(event('charge.dispute.created', dispute(order), T0)), 200, 'the retry works');
    assert.equal((await fresh(order)).dispute.id, 'dp_1');
    assert.equal((await alerts()).length, 1);
  });
});
