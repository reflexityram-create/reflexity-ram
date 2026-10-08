// The admin shipping transition must be usable from the order's initial
// pending state, require a trackable number, and claim the transition once.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'order-status-shipping-test-secret';

const sent = [];
let shippingEmailError = null;
const emailPath = require.resolve('../src/utils/email');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendShippingNotificationEmail: async (message) => {
      if (shippingEmailError) throw shippingEmailError;
      sent.push(message);
      return { id: `shipping-${sent.length}` };
    },
  },
};
const reviewPath = require.resolve('../src/utils/reviewRequests');
require.cache[reviewPath] = {
  id: reviewPath,
  filename: reviewPath,
  loaded: true,
  exports: { scheduleReviewRequest: async () => ({ status: 'skipped', reason: 'test' }) },
};

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const adminRouter = require('../src/routes/admin');

const chain = (value) => ({
  select() { return this; },
  populate() { return this; },
  lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

async function request(app, method, path, body, headers) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function setup(t, initial) {
  const fake = require('./helpers/orderStore').orderStore([initial]);
  const originalOrder = { findById: Order.findById, findOneAndUpdate: Order.findOneAndUpdate, updateOne: Order.updateOne };
  const originalUser = User.findById;
  User.findById = () => chain({ _id: 'admin-1', role: 'admin', isActive: true, authVersion: 0 });
  Order.findById = fake.findById;
  Order.findOneAndUpdate = fake.findOneAndUpdate;
  Order.updateOne = fake.updateOne;
  t.after(() => {
    Order.findById = originalOrder.findById;
    Order.findOneAndUpdate = originalOrder.findOneAndUpdate;
    Order.updateOne = originalOrder.updateOne;
    User.findById = originalUser;
    shippingEmailError = null;
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  const headers = { Authorization: `Bearer ${jwt.sign({ id: 'admin-1', av: 0 }, process.env.JWT_SECRET)}` };
  return { app, headers, get updates() { return fake.writes.filter((w) => w.update.status); }, getCurrent: () => fake.store[0] };
}

test('a paid pending order can be shipped with tracking and emails once', async (t) => {
  sent.length = 0;
  const harness = setup(t, {
    _id: '64b7f0c2a1b2c3d4e5f60719', orderNumber: 'RFX-SHIP-1', status: 'pending', paymentStatus: 'paid',
    guestEmail: 'buyer@example.com', shippingAddress: { firstName: 'Buyer' }, statusHistory: [],
  });
  const first = await request(harness.app, 'PATCH', `/api/admin/orders/${harness.getCurrent()._id}/status`, {
    status: 'shipped', trackingNumber: '7023 2100 3941 4604',
  }, harness.headers);
  assert.equal(first.status, 200);
  assert.equal(harness.getCurrent().status, 'shipped');
  assert.equal(harness.getCurrent().trackingNumber, '7023 2100 3941 4604');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].order.trackingNumber, '7023 2100 3941 4604');
  assert.equal(harness.updates.length, 1);

  const repeated = await request(harness.app, 'PATCH', `/api/admin/orders/${harness.getCurrent()._id}/status`, {
    status: 'shipped', trackingNumber: '7023 2100 3941 4604',
  }, harness.headers);
  assert.equal(repeated.status, 409);
  assert.equal(sent.length, 1, 'the repeated transition cannot send a duplicate buyer email');
  assert.equal(harness.updates.length, 1, 'the repeated transition cannot append history');
});

test('shipping without tracking is refused and unpaid pending orders stay protected', async (t) => {
  sent.length = 0;
  const paid = setup(t, { _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'paid' });
  const missing = await request(paid.app, 'PATCH', `/api/admin/orders/${paid.getCurrent()._id}/status`, { status: 'shipped' }, paid.headers);
  assert.equal(missing.status, 422);
  assert.match(missing.body.error, /Tracking number is required/);
  assert.equal(paid.updates.length, 0);

  const unpaid = setup(t, { _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'pending' });
  const refused = await request(unpaid.app, 'PATCH', `/api/admin/orders/${unpaid.getCurrent()._id}/status`, {
    status: 'shipped', trackingNumber: 'CP123',
  }, unpaid.headers);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Cannot change order/);
  assert.equal(unpaid.updates.length, 0);
});

test('whitespace-only legacy tracking cannot satisfy the shipped guard', async (t) => {
  sent.length = 0;
  const harness = setup(t, {
    _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'paid', trackingNumber: '   ',
  });
  const response = await request(harness.app, 'PATCH', `/api/admin/orders/${harness.getCurrent()._id}/status`, { status: 'shipped' }, harness.headers);
  assert.equal(response.status, 422);
  assert.equal(harness.updates.length, 0);
});

test('shipping with saved tracking persists the normalized number and notifies the buyer', async (t) => {
  sent.length = 0;
  const harness = setup(t, {
    _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'paid',
    trackingNumber: '  CP123  ', guestEmail: 'buyer@example.com',
  });
  const response = await request(harness.app, 'PATCH', `/api/admin/orders/${harness.getCurrent()._id}/status`, {
    status: 'shipped',
  }, harness.headers);
  assert.equal(response.status, 200);
  assert.equal(harness.getCurrent().trackingNumber, 'CP123');
  assert.equal(sent[0].order.trackingNumber, 'CP123');
  assert.equal(response.body.shippingNotification.status, 'sent');
});

test('shipping email failure is surfaced without pretending the buyer was notified', async (t) => {
  sent.length = 0;
  shippingEmailError = new Error('Resend unavailable');
  const harness = setup(t, {
    _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'paid', guestEmail: 'buyer@example.com',
  });
  const response = await request(harness.app, 'PATCH', `/api/admin/orders/${harness.getCurrent()._id}/status`, {
    status: 'shipped', trackingNumber: 'CP123',
  }, harness.headers);
  assert.equal(response.status, 200);
  assert.equal(response.body.order.status, 'shipped');
  assert.deepEqual(response.body.shippingNotification, {
    status: 'failed', message: 'Order shipped, but the buyer notification could not be sent',
  });
  assert.equal(sent.length, 0);
});

test('saving tracking leaves a paid pending order pending and sends no premature email', async (t) => {
  sent.length = 0;
  const h = setup(t, { _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'paid',
    trackingUrl: 'https://carrier.example/old', trackingLatest: { description: 'old number' } });
  const result = await request(h.app, 'PATCH', `/api/admin/orders/${h.getCurrent()._id}/tracking`, { trackingNumber: ' CP123 ' }, h.headers);
  assert.equal(result.status, 200);
  assert.equal(h.getCurrent().status, 'pending');
  assert.equal(h.getCurrent().trackingNumber, 'CP123');
  assert.equal(h.getCurrent().trackingLatest, undefined);
  assert.equal(h.getCurrent().trackingUrl, undefined);
  assert.equal(sent.length, 0);
});

test('saving tracking rejects empty numbers, unpaid orders and already shipped orders', async (t) => {
  const h = setup(t, { _id: '64b7f0c2a1b2c3d4e5f60719', status: 'pending', paymentStatus: 'pending' });
  const path = `/api/admin/orders/${h.getCurrent()._id}/tracking`;
  assert.equal((await request(h.app, 'PATCH', path, { trackingNumber: 'CP123' }, h.headers)).status, 409);
  h.getCurrent().paymentStatus = 'paid';
  assert.equal((await request(h.app, 'PATCH', path, { trackingNumber: '   ' }, h.headers)).status, 400);
  h.getCurrent().status = 'shipped';
  assert.equal((await request(h.app, 'PATCH', path, { trackingNumber: 'CP123' }, h.headers)).status, 409);
});
