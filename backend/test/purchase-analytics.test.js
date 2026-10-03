const test = require('node:test');
const assert = require('node:assert/strict');
const { reportPaidOrderToGa4 } = require('../src/utils/purchaseAnalytics');

const NOW = Date.parse('2026-09-18T13:30:00Z');
const logger = { warn: () => {}, error: () => {} };

// A tiny in-memory stand-in for the Order model's claim/release operations.
function fakeOrderModel({ sentAt = null, clientId = '111.222', sessionId = '1789737000' } = {}) {
  const state = { sentAt, updates: [] };
  return {
    state,
    findOneAndUpdate(filter, update) {
      assert.equal(filter.analyticsPurchaseSentAt, null, 'the claim must only match unreported orders');
      const doc = state.sentAt === null ? { analyticsClientId: clientId, analyticsSessionId: sessionId } : null;
      if (doc) state.sentAt = update.$set.analyticsPurchaseSentAt;
      const query = { select: (fields) => { assert.match(fields, /analyticsClientId/); return query; }, then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject) };
      return query;
    },
    async updateOne(_filter, update) {
      state.updates.push(update);
      state.sentAt = update.$set.analyticsPurchaseSentAt;
    },
  };
}

const paid = { _id: 'order-1', orderNumber: 'RFX-1', paymentStatus: 'paid', createdAt: new Date(NOW - 60_000) };
const enabled = () => true;

test('a paid order is reported once with the buyer\'s GA ids, then never again', async () => {
  const OrderModel = fakeOrderModel();
  const sends = [];
  const send = async (order, ids) => { sends.push({ order, ids }); return { sent: true }; };
  const options = { OrderModel, send, isEnabled: enabled, currency: 'cad', now: () => NOW, logger };

  assert.equal(await reportPaidOrderToGa4(paid, options), true);
  assert.equal(await reportPaidOrderToGa4(paid, options), false, 'webhook + success-page race must not double-report');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].ids, { clientId: '111.222', sessionId: '1789737000' });
  assert.equal(OrderModel.state.sentAt instanceof Date, true);
});

test('a failed send releases the claim so a later fulfilment call retries', async () => {
  const OrderModel = fakeOrderModel();
  let attempt = 0;
  const send = async () => (++attempt === 1 ? { sent: false, reason: 'network' } : { sent: true });
  const options = { OrderModel, send, isEnabled: enabled, now: () => NOW, logger };

  assert.equal(await reportPaidOrderToGa4(paid, options), false);
  assert.equal(OrderModel.state.sentAt, null, 'claim must be released after a failed send');
  assert.equal(await reportPaidOrderToGa4(paid, options), true);
  assert.equal(attempt, 2);
});

test('nothing is sent when tracking is off, the order is unpaid, or it is too old for GA4', async () => {
  const OrderModel = fakeOrderModel();
  let sends = 0;
  const send = async () => { sends += 1; return { sent: true }; };
  const base = { OrderModel, send, now: () => NOW, logger };

  assert.equal(await reportPaidOrderToGa4(paid, { ...base, isEnabled: () => false }), false);
  assert.equal(await reportPaidOrderToGa4({ ...paid, paymentStatus: 'pending' }, { ...base, isEnabled: enabled }), false);
  assert.equal(await reportPaidOrderToGa4({ ...paid, createdAt: new Date(NOW - 4 * 24 * 3600 * 1000) }, { ...base, isEnabled: enabled }), false);
  assert.equal(await reportPaidOrderToGa4(null, { ...base, isEnabled: enabled }), false);
  assert.equal(sends, 0);
  assert.equal(OrderModel.state.sentAt, null, 'skipped orders must not be claimed');
});

test('database or sender failures are swallowed so fulfilment is never blocked', async () => {
  const exploding = { findOneAndUpdate: () => { throw new Error('db down'); } };
  assert.equal(await reportPaidOrderToGa4(paid, { OrderModel: exploding, isEnabled: enabled, now: () => NOW, logger }), false);

  const OrderModel = fakeOrderModel();
  const send = async () => { throw new Error('boom'); };
  assert.equal(await reportPaidOrderToGa4(paid, { OrderModel, send, isEnabled: enabled, now: () => NOW, logger }), false);
});
