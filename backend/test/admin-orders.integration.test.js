// Runs against a REAL MongoDB (the semantics of "a missing field matches null" and of the list filters are exactly what is being
// tested, and a fake store cannot lie about them). Skipped unless MONGODB_TEST_URI is set; it drops the database named in it:
//   MONGODB_TEST_URI='mongodb://127.0.0.1:27019/rfx_admin_orders_test?directConnection=true' node --test backend/test/admin-orders.integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_TEST_URI;
const skip = URI ? false : 'set MONGODB_TEST_URI to a throw-away database to run this';

const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { sent.push(message); return { data: { id: `email_${sent.length}` }, error: null }; } }; } } },
};
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'admin-orders-integration-secret', FRONTEND_URL: 'https://reflexityram.com', STRIPE_SECRET_KEY: 'sk_test_admin_orders',
});

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const adminRouter = require('../src/routes/admin');
const { generateAccessToken } = require('../src/middleware/auth');
const { customerOrderResponse } = require('../src/utils/customerOrders');

let serial = 0;
const makeOrder = (extra = {}) => {
  serial += 1;
  return Order.create({
    orderNumber: `RFX-INT-${serial}`, guestEmail: `buyer${serial}@example.com`,
    items: [{ slug: 'ddr4', sku: 'D4', name: '32GB DDR4', price: 435, qty: 1 }],
    shippingAddress: { firstName: 'Sam', lastName: 'Buyer', line1: '1 Test St', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'CA' },
    subtotal: 435, shippingCost: 14, total: 449, ...extra,
  });
};
const minutesAgo = (n) => new Date(Date.now() - n * 60000);
// Marking an order shipped also schedules the buyer's review email (held by Resend for days): count only the shipping notices.
const shippingEmails = () => sent.filter((message) => /has shipped/.test(message.subject));

test('the admin Orders list and shipping on a real MongoDB', { skip }, async (root) => {
  await mongoose.connect(URI, { autoIndex: true });
  await mongoose.connection.dropDatabase();
  await Promise.all([Order, User].map((m) => m.init()));
  const reset = async () => { await Promise.all([Order, User].map((m) => m.deleteMany({}))); sent.length = 0; };
  root.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  const serve = async (run) => {
    const owner = (await User.findOne({ email: 'owner@reflexity.example' })) || await User.create({ email: 'owner@reflexity.example', firstName: 'Yusuf', lastName: 'Owner', role: 'admin', isEmailVerified: true });
    const headers = { authorization: `Bearer ${generateAccessToken(owner._id, owner.authVersion)}` };
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      return await run(async (method, path, body) => {
        const r = await fetch(base + path, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, body: await r.json().catch(() => null) };
      });
    } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  };
  const numbers = (response) => response.body.orders.map((o) => o.orderNumber);

  await root.test('the list shows EVERY order, archived ones included, newest first (the paid $643 order the old Archive button hid)', async () => {
    await reset();
    const hidden = await makeOrder({ orderNumber: 'RFX-HIDDEN-PAID', status: 'processing', paymentStatus: 'paid', archived: true, createdAt: minutesAgo(50) });
    await makeOrder({ orderNumber: 'RFX-SHIPPED', status: 'shipped', paymentStatus: 'paid', trackingNumber: 'CP1', createdAt: minutesAgo(40) });
    await makeOrder({ orderNumber: 'RFX-OLD-DELIVERED', status: 'delivered', paymentStatus: 'paid', trackingNumber: 'CP2', archived: true, createdAt: minutesAgo(30) });
    await makeOrder({ orderNumber: 'RFX-ETRANSFER', status: 'pending', paymentStatus: 'pending', paymentMethod: 'etransfer', createdAt: minutesAgo(20) });
    await makeOrder({ orderNumber: 'RFX-CANCELLED', status: 'cancelled', paymentStatus: 'pending', archived: true, createdAt: minutesAgo(10) });
    await serve(async (call) => {
      const all = await call('GET', '/api/admin/orders');
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.deepEqual(numbers(all), ['RFX-CANCELLED', 'RFX-ETRANSFER', 'RFX-OLD-DELIVERED', 'RFX-SHIPPED', 'RFX-HIDDEN-PAID']);
      assert.equal(all.body.pagination.total, 5);
      assert.ok(numbers(all).includes('RFX-HIDDEN-PAID'), 'an archived paid order that still has to be shipped is on the list');
      // an old open tab that still asks for the archived filter gets the same full list
      for (const archived of ['false', 'true', 'all']) assert.equal((await call('GET', `/api/admin/orders?archived=${archived}`)).body.pagination.total, 5, archived);
      assert.equal(String(hidden._id).length, 24);
    });
  });

  await root.test('each view holds exactly its orders, and the counts agree with the views whichever view is open', async () => {
    await serve(async (call) => {
      const expected = {
        all: 5,
        awaiting: ['RFX-ETRANSFER'],
        toship: ['RFX-HIDDEN-PAID'],
        shipped: ['RFX-SHIPPED'],
        delivered: ['RFX-OLD-DELIVERED'],
        closed: ['RFX-CANCELLED'],
      };
      for (const view of ['awaiting', 'toship', 'shipped', 'delivered', 'closed']) {
        const response = await call('GET', `/api/admin/orders?view=${view}`);
        assert.deepEqual(numbers(response), expected[view], view);
        assert.equal(response.body.pagination.total, expected[view].length, view);
        assert.deepEqual(response.body.counts, { all: 5, awaiting: 1, toship: 1, shipped: 1, delivered: 1, closed: 1 }, `counts while ${view} is open`);
      }
      assert.equal((await call('GET', '/api/admin/orders?view=all')).body.pagination.total, 5);
      assert.equal((await call('GET', '/api/admin/orders?view=nonsense')).status, 400);
      assert.equal((await call('GET', '/api/admin/orders?view=constructor')).status, 400);
    });
  });

  await root.test('an UNPAID order is never in "to ship", and a paid pending order is', async () => {
    await reset();
    await makeOrder({ orderNumber: 'RFX-UNPAID', status: 'pending', paymentStatus: 'pending', paymentMethod: 'bank_debit' });
    await makeOrder({ orderNumber: 'RFX-PAID-PENDING', status: 'pending', paymentStatus: 'paid' });
    await makeOrder({ orderNumber: 'RFX-PAID-PROCESSING', status: 'processing', paymentStatus: 'paid' });
    await serve(async (call) => {
      assert.deepEqual(numbers(await call('GET', '/api/admin/orders?view=toship')).sort(), ['RFX-PAID-PENDING', 'RFX-PAID-PROCESSING']);
      assert.deepEqual(numbers(await call('GET', '/api/admin/orders?view=awaiting')), ['RFX-UNPAID']);
      const counts = (await call('GET', '/api/admin/orders')).body.counts;
      assert.equal(counts.toship, 2);
      assert.equal(counts.awaiting, 1);
    });
  });

  await root.test('paging keeps the total honest', async () => {
    await reset();
    for (let i = 0; i < 25; i += 1) await makeOrder({ status: 'processing', paymentStatus: 'paid', createdAt: minutesAgo(100 - i) });
    await serve(async (call) => {
      const first = await call('GET', '/api/admin/orders?limit=20&page=1');
      const second = await call('GET', '/api/admin/orders?limit=20&page=2');
      assert.equal(first.body.orders.length, 20);
      assert.equal(second.body.orders.length, 5);
      assert.deepEqual({ ...first.body.pagination, page: Number(first.body.pagination.page) }, { page: 1, total: 25, pages: 2 });
      assert.equal(new Set([...numbers(first), ...numbers(second)]).size, 25, 'no order is on two pages');
    });
  });

  await root.test('the archive button is gone: its route no longer exists and nothing else changes an order\'s archived flag', async () => {
    await reset();
    const order = await makeOrder({ status: 'processing', paymentStatus: 'paid' });
    await serve(async (call) => {
      const response = await call('PATCH', `/api/admin/orders/${order._id}/archive`, { archived: true });
      assert.equal(response.status, 404);
    });
    assert.equal((await Order.findById(order._id).lean()).archived, false);
  });

  await root.test('shipping WITHOUT tracking: the real claim query matches the missing number, the buyer is emailed once, the order is untracked', async () => {
    await reset();
    const order = await makeOrder({ orderNumber: 'RFX-NO-TRACKING', status: 'processing', paymentStatus: 'paid', archived: true });
    await serve(async (call) => {
      const refused = await call('PATCH', `/api/admin/orders/${order._id}/status`, { status: 'shipped' });
      assert.equal(refused.status, 422);
      assert.equal((await Order.findById(order._id).lean()).status, 'processing');
      assert.equal(sent.length, 0);

      const shipped = await call('PATCH', `/api/admin/orders/${order._id}/status`, { status: 'shipped', noTracking: true });
      assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
      assert.equal(shipped.body.shippingNotification.status, 'sent', 'the claim must match an order that has no trackingNumber field at all');
      const saved = await Order.findById(order._id).lean();
      assert.equal(saved.status, 'shipped');
      assert.equal(saved.untracked, true);
      assert.equal('trackingNumber' in saved, false, 'no placeholder number was stored');
      assert.equal(saved.shippingNotification.status, 'sent');
      assert.match(saved.statusHistory.at(-1).note, /without a tracking number/);
      assert.equal(shippingEmails().length, 1);
      assert.equal(shippingEmails()[0].to, saved.guestEmail);
      assert.match(shippingEmails()[0].html, /without a tracking number/);
      assert.equal(shippingEmails()[0].replyTo, 'reflexityram@gmail.com');

      assert.equal((await call('PATCH', `/api/admin/orders/${order._id}/status`, { status: 'shipped', noTracking: true })).status, 409);
      assert.equal(shippingEmails().length, 1, 'still one shipping email');
      // what the buyer's own page is built from
      const buyerView = customerOrderResponse(saved);
      assert.equal(buyerView.untracked, true);
      assert.equal(buyerView.trackingNumber, undefined);
      assert.equal('archived' in buyerView, false);

      // and it can be marked delivered afterwards, with no email
      sent.length = 0;
      assert.equal((await call('PATCH', `/api/admin/orders/${order._id}/status`, { status: 'delivered' })).status, 200);
      assert.equal(sent.length, 0, 'delivered sends the buyer nothing at all');
    });
  });

  await root.test('a tracked shipment is unchanged: the number is stored, not untracked, one email with the number', async () => {
    await reset();
    const order = await makeOrder({ status: 'pending', paymentStatus: 'paid' });
    await serve(async (call) => {
      const shipped = await call('PATCH', `/api/admin/orders/${order._id}/status`, { status: 'shipped', trackingNumber: 'GD546149174CA' });
      assert.equal(shipped.status, 200);
      const saved = await Order.findById(order._id).lean();
      assert.equal(saved.trackingNumber, 'GD546149174CA');
      assert.equal(saved.untracked, false);
      assert.equal(shippingEmails().length, 1);
      assert.match(shippingEmails()[0].html, /GD546149174CA/);
      assert.equal(shippingEmails()[0].replyTo, undefined);
    });
  });
});
