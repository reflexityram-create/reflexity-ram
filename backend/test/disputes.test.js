// Disputes (chargebacks) and bank inquiries without a database: what is stored, what the owner's phone is told, and that the
// webhook route hands the events over. The real-database behaviour (late and out-of-order events, redelivery, the same events
// through the signed route) is in disputes.integration.test.js, which needs MONGODB_TEST_URI.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } } };
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_disputes_unit';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_disputes_unit';
process.env.JWT_SECRET ||= 'disputes-unit-secret';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeRouter = require('../src/routes/stripe');
const { recordDisputeEvent, disputeFacts, reasonText } = require('../src/utils/disputes');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { scheduleReviewRequest } = require('../src/utils/reviewRequests');

const ORDER = {
  _id: 'order-1', orderNumber: 'RFX-TEST-1', total: 643, paymentMethod: 'stripe', status: 'processing', paymentStatus: 'paid',
  items: [{ qty: 2, name: '16GB DDR4 ECC RDIMM' }, { qty: 1, name: '32GB DDR4 ECC RDIMM' }],
  guestEmail: 'sam.private@example.com',
  shippingAddress: { firstName: 'Samantha', lastName: 'Privatename', line1: '100 Secret St W', city: 'Toronto', phone: '+14165550123' },
};
const dispute = (extra = {}) => ({
  id: 'dp_1', object: 'dispute', amount: 64300, currency: 'cad', charge: 'ch_1', payment_intent: 'pi_1', created: 1791972874,
  reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: 1793400000, has_evidence: false, past_due: false, submission_count: 0 }, ...extra,
});
const event = (type, object, created = 1791972900) => ({ id: `evt_${type}_${object.status}`, object: 'event', type, created, data: { object } });

function harness({ order = ORDER, applied = true } = {}) {
  const calls = { finds: [], updates: [], alerts: [], cancels: [], cancelArgs: [], logs: [] };
  const OrderModel = {
    findOne: (filter) => { calls.finds.push(filter); return { lean: async () => order }; },
    findOneAndUpdate: async (filter, update, options) => { calls.updates.push({ filter, update, options }); return applied ? { ...order, dispute: update.$set.dispute } : null; },
  };
  const logger = { log: (m) => calls.logs.push(m), warn: (m) => calls.logs.push(m), error: (m) => calls.logs.push(m) };
  return { calls, deps: { OrderModel, record: async (alert) => { calls.alerts.push(alert); return alert; }, cancelReview: async (o) => { calls.cancels.push(o._id); calls.cancelArgs.push(o); return true; }, alertExists: async () => false, logger } };
}

test('what is kept about a dispute: dollars not cents, real dates, the reason in words, and the time of the event that made it', () => {
  const facts = disputeFacts(dispute(), { created: 1791972900 });
  assert.equal(facts.id, 'dp_1');
  assert.equal(facts.status, 'needs_response');
  assert.equal(facts.amount, 643);
  assert.equal(facts.currency, 'cad');
  assert.equal(facts.reason, 'fraudulent');
  assert.equal(facts.reasonText, 'the buyer says they did not make this payment');
  assert.equal(facts.openedAt.toISOString(), '2026-10-14T10:14:34.000Z');
  assert.equal(facts.evidenceDueBy.toISOString(), '2026-10-30T22:40:00.000Z');
  assert.equal(facts.eventAt.toISOString(), '2026-10-14T10:15:00.000Z');
  assert.equal('closedAt' in facts, false, 'still open');
  // closing records when; a due date Stripe does not give (0) is no date at all
  const closed = disputeFacts(dispute({ status: 'lost', evidence_details: { due_by: 0 } }), { created: 1791980000 });
  assert.equal(closed.closedAt.toISOString(), '2026-10-14T12:13:20.000Z');
  assert.equal(closed.evidenceDueBy, undefined);
  assert.equal(disputeFacts(dispute({ amount: 1999 })).amount, 19.99);
  assert.match(reasonText('something_new'), /something_new/, 'a reason code this code does not know is shown as it is');
  assert.equal(reasonText(undefined), 'the bank gave no reason');
});

test('a dispute opens: it is saved on the order and the phone gets one high alert that says what to do', async () => {
  const { calls, deps } = harness();
  const result = await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
  assert.deepEqual(result, { matched: true, applied: true });
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.finds, [{ $or: [{ stripeChargeId: 'ch_1' }, { stripePaymentIntentId: 'pi_1' }] }]);
  assert.equal(calls.updates[0].update.$set.dispute.id, 'dp_1');
  assert.equal(calls.updates[0].options.timestamps, false, 'a dispute does not touch the order\'s updatedAt');
  assert.equal(calls.alerts.length, 1);
  const alert = calls.alerts[0];
  assert.equal(alert.type, 'order.dispute_opened');
  assert.equal(alert.priority, 'high');
  assert.equal(alert.dedupeKey, 'order.dispute_opened:dp_1');
  assert.equal(alert.order, ORDER, 'the alert opens this order when tapped');
  assert.match(alert.body, /^RFX-TEST-1 · \$643\.00 CAD · 2× 16GB DDR4 ECC RDIMM, 1× 32GB DDR4 ECC RDIMM · Card · /);
  assert.match(alert.body, /the buyer says they did not make this payment/);
  assert.match(alert.body, /Stripe took \$643\.00 back/);
  assert.match(alert.body, /Send evidence in Stripe by Oct 30\./);
  assert.match(alert.body, /Do not ship it\.$/, 'an order that has not gone out must not');
});

test('an order that already shipped is told to send the tracking and proof of delivery, not to hold the parcel', async () => {
  for (const status of ['shipped', 'delivered']) {
    const { calls, deps } = harness({ order: { ...ORDER, status } });
    await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
    assert.match(calls.alerts[0].body, /Send the tracking and proof of delivery\.$/, status);
    assert.doesNotMatch(calls.alerts[0].body, /Do not ship/, status);
  }
  const { calls, deps } = harness({ order: { ...ORDER, status: 'cancelled' } });
  await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
  assert.doesNotMatch(calls.alerts[0].body, /Do not ship|tracking/, 'a cancelled order needs neither advice');
});

test('the alert goes on a lock screen: it never carries the buyer\'s name, email, phone or address', async () => {
  const { calls, deps } = harness();
  for (const [type, status] of [['charge.dispute.created', 'needs_response'], ['charge.dispute.created', 'warning_needs_response'], ['charge.dispute.closed', 'won'], ['charge.dispute.closed', 'lost'], ['charge.dispute.closed', 'warning_closed']]) {
    await recordDisputeEvent(event(type, dispute({ status })), deps);
  }
  assert.equal(calls.alerts.length, 5);
  for (const alert of calls.alerts) {
    const text = `${alert.title} ${alert.body}`;
    for (const secret of ['Samantha', 'Privatename', 'sam.private', 'example.com', '4165550123', 'Secret St', 'Toronto']) assert.equal(text.includes(secret), false, `${alert.type} shows "${secret}"`);
  }
});

test('the order is found by the payment too, when the charge id has not been stored on it', async () => {
  const { calls, deps } = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute({ charge: undefined })), deps);
  assert.deepEqual(calls.finds[0], { $or: [{ stripePaymentIntentId: 'pi_1' }] });
  const expanded = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute({ charge: { id: 'ch_9' }, payment_intent: { id: 'pi_9' } })), expanded.deps);
  assert.deepEqual(expanded.calls.finds[0], { $or: [{ stripeChargeId: 'ch_9' }, { stripePaymentIntentId: 'pi_9' }] }, 'an expanded object works as well as an id');
});

test('every step of a dispute alerts at most once per kind, whatever event carried it', async () => {
  const { calls, deps } = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
  await recordDisputeEvent(event('charge.dispute.updated', dispute({ status: 'under_review' }), 1791973000), deps);
  assert.equal(calls.alerts[0].dedupeKey, calls.alerts[1].dedupeKey, 'sending evidence is not "a new dispute": the same key');
  await recordDisputeEvent(event('charge.dispute.closed', dispute({ status: 'won' }), 1791974000), deps);
  await recordDisputeEvent(event('charge.dispute.closed', dispute({ status: 'won' }), 1791974000), deps);
  const won = calls.alerts.filter((alert) => alert.type === 'order.dispute_won');
  assert.equal(won.length, 2);
  assert.equal(won[0].dedupeKey, won[1].dedupeKey, 'a redelivered closing event repeats the key, so the phone is told once');
  assert.equal(won[0].priority, 'normal');
  assert.match(won[0].body, /the money stays with you/);
});

test('losing is a high alert that says the money is gone; an inquiry says no money has been taken yet', async () => {
  const lost = harness();
  await recordDisputeEvent(event('charge.dispute.closed', dispute({ status: 'lost' })), lost.deps);
  assert.equal(lost.calls.alerts[0].type, 'order.dispute_lost');
  assert.equal(lost.calls.alerts[0].priority, 'high');
  assert.match(lost.calls.alerts[0].body, /\$643\.00 was not returned/);
  assert.ok(lost.calls.updates[0].update.$set.dispute.closedAt, 'when it closed is kept');

  const inquiry = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute({ status: 'warning_needs_response' })), inquiry.deps);
  assert.equal(inquiry.calls.alerts[0].type, 'order.dispute_inquiry');
  assert.equal(inquiry.calls.alerts[0].priority, 'high');
  assert.match(inquiry.calls.alerts[0].body, /No money is taken yet/);
  assert.doesNotMatch(inquiry.calls.alerts[0].body, /took .* back/);

  for (const [status, type, priority] of [['warning_closed', 'order.dispute_inquiry_closed', 'low'], ['prevented', 'order.dispute_prevented', 'low']]) {
    const quiet = harness();
    await recordDisputeEvent(event('charge.dispute.closed', dispute({ status })), quiet.deps);
    assert.deepEqual([quiet.calls.alerts[0].type, quiet.calls.alerts[0].priority], [type, priority], status);
  }
  const unknown = harness();
  await recordDisputeEvent(event('charge.dispute.updated', dispute({ status: 'some_new_status' })), unknown.deps);
  assert.equal(unknown.calls.updates.length, 1, 'a status this code does not know is still recorded');
  assert.equal(unknown.calls.alerts.length, 0, 'but not announced');
});

test('an event older than what is stored changes nothing and alerts nobody', async () => {
  const { calls, deps } = harness({ applied: false });
  const result = await recordDisputeEvent(event('charge.dispute.updated', dispute({ status: 'needs_response' })), deps);
  assert.deepEqual(result, { matched: true, applied: false });
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.cancels.length, 0);
  assert.match(calls.logs.join('\n'), /a newer event is already recorded/);
});

test('money taken back for a payment the shop has no order for still reaches the phone, once', async () => {
  const calls = { alerts: [], updates: 0 };
  const deps = {
    OrderModel: { findOne: () => ({ lean: async () => null }), findOneAndUpdate: async () => { calls.updates += 1; return null; } },
    record: async (alert) => { calls.alerts.push(alert); return alert; },   // like the real one: the saved event
    cancelReview: async () => { throw new Error('nothing to cancel'); },
    logger: { log() {}, warn() {}, error() {} },
  };
  const result = await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
  assert.deepEqual(result, { matched: false, applied: false });
  assert.equal(calls.updates, 0);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].type, 'payment.dispute_unmatched');
  assert.equal(calls.alerts[0].priority, 'high');
  assert.equal(calls.alerts[0].dedupeKey, 'payment.dispute_unmatched:dp_1');
  assert.equal(calls.alerts[0].path, '/admin/orders');
  assert.match(calls.alerts[0].body, /dp_1 · \$643\.00 CAD · the buyer says they did not make this payment\. Send evidence in Stripe by Oct 30\./);
  // a dispute that names neither a charge nor a payment cannot be looked up at all, and says so the same way
  const none = await recordDisputeEvent(event('charge.dispute.created', dispute({ charge: null, payment_intent: null })), { ...deps, OrderModel: { findOne: () => { throw new Error('must not look up with an empty filter'); } } });
  assert.deepEqual(none, { matched: false, applied: false });
  assert.equal(calls.alerts.length, 2);
});

test('the "how was your order?" email is cancelled while a dispute is open or after it is lost, and left alone otherwise', async () => {
  const wanted = { needs_response: true, under_review: true, warning_needs_response: true, warning_under_review: true, lost: true, won: false, warning_closed: false, prevented: false };
  for (const [status, cancelled] of Object.entries(wanted)) {
    const { calls, deps } = harness();
    await recordDisputeEvent(event('charge.dispute.updated', dispute({ status })), deps);
    assert.deepEqual(calls.cancels, cancelled ? ['order-1'] : [], status);
  }
  // a failure to cancel never stops the dispute from being recorded and announced
  const { calls, deps } = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute()), { ...deps, cancelReview: async () => { throw new Error('Resend is down'); } });
  assert.equal(calls.alerts.length, 1);
  assert.match(calls.logs.join('\n'), /Review email cancel failed/);
});

test('a disputed order is not asked how it went, unless the dispute was won', async () => {
  const shipped = { paymentStatus: 'paid', status: 'shipped', guestEmail: 'buyer@example.com' };
  for (const status of ['needs_response', 'under_review', 'warning_needs_response', 'lost']) {
    assert.deepEqual(await scheduleReviewRequest({ ...shipped, dispute: { id: 'dp_1', status } }), { status: 'skipped', reason: 'disputed' }, status);
  }
});

test('the buyer\'s own view of an order never carries the dispute', () => {
  const shaped = customerOrderResponse({ ...ORDER, shippingAddress: { ...ORDER.shippingAddress, country: 'CA' }, dispute: { id: 'dp_1', status: 'needs_response', reason: 'fraudulent', reasonText: 'the buyer says they did not make this payment', amount: 643 } });
  assert.equal('dispute' in shaped, false);
  assert.equal(JSON.stringify(shaped).includes('dp_1'), false);
  assert.equal(JSON.stringify(shaped).includes('fraudulent'), false);
});

test('the review email is cancelled on the order as the write left it, so an email scheduled a moment ago is seen', async () => {
  const { calls, deps } = harness();
  await recordDisputeEvent(event('charge.dispute.created', dispute()), deps);
  assert.equal(calls.cancelArgs.length, 1);
  assert.equal(calls.cancelArgs[0].dispute.id, 'dp_1', 'it got the updated document, not the copy read before the write');
});

test('an alert that could not be written fails the webhook (Stripe sends the event again); one that was already written does not', async () => {
  // recordAdminEvent answers null both for "already told" and for "could not write": the dispute code tells them apart
  const lost = harness();
  await assert.rejects(() => recordDisputeEvent(event('charge.dispute.created', dispute()), { ...lost.deps, record: async () => null, alertExists: async () => false }), /could not be recorded/);
  assert.equal(lost.calls.updates.length, 1, 'the dispute itself was saved; it is the alert that is retried');
  const repeated = harness();
  const keys = [];
  const result = await recordDisputeEvent(event('charge.dispute.created', dispute()), { ...repeated.deps, record: async () => null, alertExists: async (key) => { keys.push(key); return true; } });
  assert.deepEqual(result, { matched: true, applied: true });
  assert.deepEqual(keys, ['order.dispute_opened:dp_1'], 'the check asks about this alert\'s own key');
  // a payment with no order is the same
  const orphan = { OrderModel: { findOne: () => ({ lean: async () => null }) }, logger: { log() {}, warn() {}, error() {} }, cancelReview: async () => {} };
  await assert.rejects(() => recordDisputeEvent(event('charge.dispute.created', dispute()), { ...orphan, record: async () => null, alertExists: async () => false }), /payment\.dispute_unmatched/);
  assert.deepEqual(await recordDisputeEvent(event('charge.dispute.created', dispute()), { ...orphan, record: async () => null, alertExists: async () => true }), { matched: false, applied: false });
  // an event that changes nothing (older than what is stored) has no alert to lose
  const stale = harness({ applied: false });
  assert.deepEqual(await recordDisputeEvent(event('charge.dispute.updated', dispute()), { ...stale.deps, record: async () => null, alertExists: async () => false }), { matched: true, applied: false });
});

test('what "not older than the one stored" means: by time first, then, within the same second, by how far along the dispute is', () => {
  const { notOlderThanStored } = require('../src/utils/disputes');
  const at = new Date('2026-10-14T10:15:00Z');
  const guard = (status) => notOlderThanStored({ id: 'dp_1', status, eventAt: at }).$or;
  assert.deepEqual(guard('under_review').slice(0, 3), [
    { 'dispute.eventAt': { $exists: false } },
    { 'dispute.eventAt': { $lt: at } },
    { 'dispute.eventAt': at, 'dispute.id': { $ne: 'dp_1' } },
  ], 'nothing stored, or an older time, or another dispute in the same second: take it');
  const sameSecond = (status) => guard(status)[3];
  assert.deepEqual(sameSecond('needs_response')['dispute.status'], { $nin: ['warning_under_review', 'under_review', 'warning_closed', 'won', 'lost', 'prevented'] }, 'a first-stage snapshot never replaces a later one');
  assert.deepEqual(sameSecond('under_review')['dispute.status'], { $nin: ['warning_closed', 'won', 'lost', 'prevented'] });
  assert.deepEqual(sameSecond('lost')['dispute.status'], { $nin: [] }, 'the end of a dispute is always taken');
  assert.deepEqual(sameSecond('some_new_status')['dispute.status'], { $nin: ['warning_under_review', 'under_review', 'warning_closed', 'won', 'lost', 'prevented'] }, 'a status this code does not know counts as the first stage');
  assert.equal(sameSecond('lost')['dispute.id'], 'dp_1', 'the stage rule is only for the same dispute');
});

test('a malformed event is ignored and a database failure is not swallowed (so Stripe sends the event again)', async () => {
  const { calls, deps } = harness();
  assert.deepEqual(await recordDisputeEvent({ id: 'evt_x', type: 'charge.dispute.created', data: { object: {} } }, deps), { matched: false, applied: false });
  assert.deepEqual(await recordDisputeEvent(undefined, deps), { matched: false, applied: false });
  assert.equal(calls.finds.length, 0);
  const broken = { ...deps, OrderModel: { findOne: () => ({ lean: async () => { throw new Error('connection lost'); } }) } };
  await assert.rejects(() => recordDisputeEvent(event('charge.dispute.created', dispute()), broken), /connection lost/);
  const writeFails = { ...deps, OrderModel: { findOne: () => ({ lean: async () => ORDER }), findOneAndUpdate: async () => { throw new Error('write failed'); } } };
  await assert.rejects(() => recordDisputeEvent(event('charge.dispute.created', dispute()), writeFails), /write failed/);
  assert.equal(calls.alerts.length, 0, 'nothing was announced for a write that did not happen');
});

// ── the real webhook route ────────────────────────────────────────────────────────────────────────────────────
async function withWebhook(t, recordDispute, run) {
  stripeRouter.setCheckoutDependenciesForTest({ recordDispute });
  t.after(() => stripeRouter.setCheckoutDependenciesForTest());
  const app = express();
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/stripe', stripeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const post = (payload, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: payload });
    await run(post);
  } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
}
const signed = (payload) => ({ 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) });

test('the webhook hands all three dispute events to the dispute code, and only when the signature is Stripe\'s', async (t) => {
  const seen = [];
  await withWebhook(t, async (e) => { seen.push(e.type); }, async (post) => {
    for (const type of ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']) {
      const payload = JSON.stringify(event(type, dispute()));
      assert.equal((await post(payload, signed(payload))).status, 200, type);
    }
    assert.deepEqual(seen, ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);
    const payload = JSON.stringify(event('charge.dispute.created', dispute()));
    assert.equal((await post(payload, { 'stripe-signature': 't=1,v1=deadbeef' })).status, 400, 'a forged event is refused');
    assert.equal((await post(payload)).status, 400, 'so is an unsigned one');
    const funds = JSON.stringify(event('charge.dispute.funds_withdrawn', dispute()));
    assert.equal((await post(funds, signed(funds))).status, 200, 'an event this code does not use is just acknowledged');
    assert.equal(seen.length, 3, 'and none of those reached the dispute code');
  });
});

test('if recording a dispute fails the webhook answers 500, so Stripe sends the event again instead of losing it', async (t) => {
  const quiet = console.error; console.error = () => {}; t.after(() => { console.error = quiet; });
  await withWebhook(t, async () => { throw new Error('database is down'); }, async (post) => {
    const payload = JSON.stringify(event('charge.dispute.created', dispute()));
    assert.equal((await post(payload, signed(payload))).status, 500);
  });
});
