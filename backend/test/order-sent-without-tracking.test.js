// POST /api/admin/orders/:id/sent-without-tracking: a shipped order that carries a tracking "number" that is not one (the word
// "error" was typed on 2026-10-09, before the ship form had a "No tracking number" tick-box) is changed to "sent without tracking".
// What matters: the buyer is NOT emailed, only a shipped order carrying a number can be changed, a racing change is not overwritten,
// and the tracking sync stops asking Canada Post about the order.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'order-sent-without-tracking-test-secret';

// Every email function counts: any email at all fails the "nobody is emailed" check. A name the route does not call stays unused.
const emailed = [];
const emailPath = require.resolve('../src/utils/email');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: new Proxy({}, { get: (_target, name) => async (...args) => { emailed.push({ name: String(name), args }); return { id: 'x' }; } }),
};

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const adminRouter = require('../src/routes/admin');
const { syncShippedOrders } = require('../src/utils/trackingSync');
const { orderStore } = require('./helpers/orderStore');

const ID = '64b7f0c2a1b2c3d4e5f60719';
const shipped = (extra = {}) => ({
  _id: ID, orderNumber: 'RFX-UNTRACK-1', status: 'shipped', paymentStatus: 'paid', guestEmail: 'buyer@example.com',
  shippingAddress: { firstName: 'Buyer' }, trackingNumber: 'error', trackingUrl: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=error',
  trackingLatest: { description: 'old scan', checkedAt: new Date('2026-10-13T12:00:00Z') }, shippedAt: new Date('2026-10-09T21:39:00Z'),
  shippingNotification: { status: 'sent' }, reviewRequest: { scheduledFor: new Date('2026-10-19T14:00:00Z') },
  statusHistory: [{ status: 'shipped', note: 'Status updated to shipped', timestamp: new Date('2026-10-09T21:39:00Z') }],
  ...extra,
});

const chain = (value) => ({
  select() { return this; }, populate() { return this; }, lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

async function request(app, method, path, body, headers) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function setup(t, initial, { onRead } = {}) {
  emailed.length = 0;
  const fake = orderStore([initial]);
  const original = { findById: Order.findById, findOneAndUpdate: Order.findOneAndUpdate, updateOne: Order.updateOne, find: Order.find, userFindById: User.findById };
  User.findById = () => chain({ _id: 'admin-1', role: 'admin', isActive: true, authVersion: 0 });
  Order.findById = (id) => { const read = fake.findById(id); if (onRead) onRead(fake); return read; };
  Order.findOneAndUpdate = fake.findOneAndUpdate;
  Order.updateOne = fake.updateOne;
  Order.find = fake.find;
  t.after(() => {
    Order.findById = original.findById; Order.findOneAndUpdate = original.findOneAndUpdate; Order.updateOne = original.updateOne;
    Order.find = original.find; User.findById = original.userFindById;
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  const headers = { Authorization: `Bearer ${jwt.sign({ id: 'admin-1', av: 0 }, process.env.JWT_SECRET)}` };
  const post = (id = ID) => request(app, 'POST', `/api/admin/orders/${id}/sent-without-tracking`, {}, headers);
  return { fake, post, doc: () => fake.store[0] };
}

test('a shipped order carrying the word "error" becomes "sent without tracking" and nobody is emailed', async (t) => {
  const h = setup(t, shipped());
  const res = await h.post();
  assert.equal(res.status, 200);
  assert.equal(res.body.order.untracked, true);
  assert.equal(res.body.order.trackingNumber, undefined, 'the answer no longer shows the number');

  const stored = h.doc();
  assert.equal(stored.status, 'shipped', 'it stays shipped');
  assert.equal(stored.untracked, true);
  for (const field of ['trackingNumber', 'trackingUrl', 'trackingLatest']) assert.equal(stored[field], undefined, `${field} is removed`);
  assert.equal(stored.shippingNotification.status, 'sent', 'the shipped-email record is untouched');
  assert.ok(stored.reviewRequest.scheduledFor, 'the scheduled review email is untouched');
  assert.equal(stored.statusHistory.length, 2);
  assert.equal(stored.statusHistory[1].status, 'shipped');
  assert.match(stored.statusHistory[1].note, /Tracking number removed \(it was "error"\): sent without tracking/);
  assert.deepEqual(emailed, [], 'no email of any kind goes to the buyer');
});

test('only a shipped order that carries a number can be changed, and a refusal writes nothing', async (t) => {
  for (const status of ['pending', 'processing', 'delivered', 'cancelled']) {
    const h = setup(t, shipped({ status }));
    const res = await h.post();
    assert.equal(res.status, 409, `a ${status} order is refused`);
    assert.match(res.body.error, /marked shipped/);
    assert.deepEqual(h.fake.writes, [], `nothing is written for a ${status} order`);
    assert.equal(h.doc().trackingNumber, 'error');
  }
  for (const [label, order] of [['untracked already', shipped({ trackingNumber: undefined, untracked: true })], ['blank number', shipped({ trackingNumber: '   ' })]]) {
    const h = setup(t, order);
    const res = await h.post();
    assert.equal(res.status, 409, label);
    assert.match(res.body.error, /no tracking number to remove/);
    assert.deepEqual(h.fake.writes, [], `${label}: nothing is written`);
  }
  const unknown = setup(t, shipped());
  assert.equal((await unknown.post('64b7f0c2a1b2c3d4e5f60777')).status, 404);
  const malformed = setup(t, shipped());
  assert.equal((await malformed.post('not-an-id')).status, 400);
  assert.deepEqual([...unknown.fake.writes, ...malformed.fake.writes], []);
});

test('a number that changed while the request was running is not removed', async (t) => {
  // The route reads the order, then writes only if the number is still the one it read; here it changes in between.
  const h = setup(t, shipped(), { onRead: (fake) => { fake.store[0].trackingNumber = '7023 2100 3941 4604'; } });
  const res = await h.post();
  assert.equal(res.status, 409);
  assert.match(res.body.error, /changed while/);
  assert.equal(h.doc().trackingNumber, '7023 2100 3941 4604', 'the newer number is kept');
  assert.equal(h.doc().untracked, undefined);
  assert.equal(h.doc().statusHistory.length, 1, 'no history line is added for a change that did not happen');
});

test('the tracking sync asks Canada Post about the placeholder before, and never again after the change', async (t) => {
  const h = setup(t, shipped());
  const asked = [];
  const deps = (hoursLater) => ({
    // Canada Post answers a made-up number with 404; the sync counts that as an error and tries again later.
    trackParcel: async (number) => { asked.push(number); throw new Error('Canada Post tracking lookup failed (404)'); },
    now: () => new Date(Date.now() + hoursLater * 3600e3),
    recordEvent: async () => {}, notifyShipment: async () => ({}), scheduleReview: async () => ({}),
  });
  const originalError = console.error; console.error = () => {};
  t.after(() => { console.error = originalError; });

  const before = await syncShippedOrders(deps(1));
  assert.deepEqual(asked, ['error'], 'premise: the sync really does look up the word "error"');
  assert.equal(before.errors, 1);

  assert.equal((await h.post()).status, 200);
  asked.length = 0;
  const after = await syncShippedOrders(deps(2));
  assert.deepEqual(asked, [], 'after the change the sync does not look the order up');
  assert.deepEqual(after, { checked: 0, delivered: 0, emails: 0, errors: 0 });
  assert.deepEqual(emailed, []);
});
