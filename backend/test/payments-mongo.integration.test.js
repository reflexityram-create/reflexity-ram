// Runs against a REAL MongoDB replica set (transactions are part of what is being tested): the e-Transfer lane and the
// bank-debit settlement. Skipped unless MONGODB_TEST_URI is set, like the Atlas stock test. Locally:
//   docker run -d --name rfx-pay-mongo --ulimit nofile=65536:65536 -p 127.0.0.1:27019:27017 mongo:7 --replSet rs0 --bind_ip_all
//   (the --ulimit matters: with this machine's default of 1024 open files mongod aborts after about twenty runs of these suites, because every run drops and
//   recreates its collections and leaves a few dozen file handles open; the tests then hang until killed)
//   docker exec rfx-pay-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
//   MONGODB_TEST_URI='mongodb://127.0.0.1:27019/rfx_payments_test?directConnection=true' npm --prefix backend run test:payments
// It drops the database named in the URI, so point it only at a throw-away one.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_TEST_URI;
const skip = URI ? false : 'set MONGODB_TEST_URI to a throw-away replica-set database to run this';

const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { if (process.env.FAIL_EMAIL === '1') return { error: { message: 'down' } }; sent.push(message); return { data: { id: `email_${sent.length}` }, error: null }; } }; } } },
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'payments-integration-secret',
  FRONTEND_URL: 'https://reflexityram.com',
  STRIPE_SECRET_KEY: 'sk_test_payments_integration',
  STRIPE_WEBHOOK_SECRET: 'whsec_payments_integration',
  ETRANSFER_ENABLED: 'true',
  ETRANSFER_RECIPIENT_EMAIL: 'pay@reflexity.example',
  BANK_DEBIT_ENABLED: 'true',
});

const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Cart = require('../src/models/Cart');
const User = require('../src/models/User');
const AdminEvent = require('../src/models/AdminEvent');
const stripeRouter = require('../src/routes/stripe');
const adminRouter = require('../src/routes/admin');
const ordersRouter = require('../src/routes/orders');
const { createPaymentsRouter } = require('../src/routes/payments');
const { generateAccessToken } = require('../src/middleware/auth');
const {
  placeEtransferOrder, markEtransferReceived, recordEtransferRefund, sweepEtransferOrders, EtransferError,
} = require('../src/utils/etransfer');
const { cancelOrderAndRestoreStock } = require('../src/utils/stock');

const HOUR = 3600 * 1000;
const SESSION = 'session_etransfer_0123456789';
const BUYER = { firstName: 'Sam', lastName: 'Buyer', email: 'sam@example.com', phone: '+14165550123' };
const ADDRESS = { line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };

async function seedProduct(extra = {}) {
  return Product.create({
    slug: 'ddr4-16gb', sku: 'D4-16', name: '16GB DDR4 ECC RDIMM', line: 'Server', generation: 'DDR4', formFactor: 'RDIMM',
    capacity: 16, capacityLabel: '16GB', speed: 2666, speedLabel: '2666 MT/s', condition: 'Used', warranty: '1 year',
    price: 135, stockQuantity: 10, isActive: true, stripePriceId: 'price_d4_16', stripePriceAmount: 13500, stripePriceCurrency: 'cad', ...extra,
  });
}
const seedCart = (product, qty, sessionId = SESSION) => Cart.create({
  sessionId,
  items: [{ product: product._id, slug: product.slug, sku: product.sku, name: product.name, price: product.price, qty }],
});
const stockOf = async (product) => (await Product.findById(product._id).lean()).stockQuantity;
const place = (overrides = {}, deps) => placeEtransferOrder({ sessionId: SESSION, buyer: BUYER, address: ADDRESS, shipping: {}, ...overrides }, deps);
const lastEmail = () => sent.at(-1);

test('payments on a real MongoDB replica set', { skip }, async (root) => {
  await mongoose.connect(URI, { autoIndex: true });
  await mongoose.connection.dropDatabase();
  await Promise.all([Order, Product, Cart, User, AdminEvent].map((m) => m.init()));
  const reset = async () => {
    await Promise.all([Order, Product, Cart, User, AdminEvent].map((m) => m.deleteMany({})));
    sent.length = 0;
    delete process.env.FAIL_EMAIL;
  };
  root.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  // ── placing an e-Transfer order ──────────────────────────────────────────────
  await root.test('an e-Transfer order holds its stock, takes the discount off the goods only, and tells the buyer what to send', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const order = await place();

    assert.equal(order.paymentMethod, 'etransfer');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.status, 'pending');
    assert.equal(order.subtotal, 270);                // 2 x 135, before the discount
    assert.equal(order.discount, 5.4);                // 2% of the goods
    assert.equal(order.shippingCost, 14);             // not discounted
    assert.equal(order.total, 278.6);
    assert.equal(order.tax, 0);
    assert.equal(order.etransfer.amountDue, 278.6);
    assert.equal(order.etransfer.recipientEmail, 'pay@reflexity.example');
    assert.equal(order.paymentDiscountPct, 2);
    assert.equal(order.guestEmail, 'sam@example.com');
    assert.equal(order.user, undefined);
    assert.equal(order.shippingAddress.country, 'CA');
    assert.equal(order.shippingAddress.zip, 'M5H 2N2');
    assert.ok(Math.abs(order.etransfer.expiresAt - Date.now() - 48 * HOUR) < 60_000, 'held for 48 hours');
    assert.equal(order.stockDecremented, true);
    assert.equal(order.items[0].decrementedQty, 2);
    assert.match(order.adminNotes, /^AWAITING e-Transfer/);

    assert.equal(await stockOf(product), 8, 'stock is held');
    assert.equal((await Cart.findOne({ sessionId: SESSION })).items.length, 0, 'the cart is emptied');

    const email = lastEmail();
    assert.equal(email.to, 'sam@example.com');
    assert.match(email.subject, new RegExp(`Send your e-Transfer to confirm order ${order.orderNumber}`));
    assert.match(email.html, /pay@reflexity\.example/);
    assert.match(email.html, /\$278\.60 CAD/);
    assert.ok(email.html.includes(order.orderNumber), 'the order number is the message to put on the transfer');
    assert.match(email.html, /Toronto time/);
    assert.match(email.html, /#email=sam%40example\.com/, 'the guest link carries the email proof the order page needs');

    const alert = await AdminEvent.findOne({ type: 'order.etransfer_pending' }).lean();
    assert.ok(alert, 'the owner\'s phone is told');
    assert.equal(alert.priority, 'high');
    assert.ok(alert.body.includes(order.orderNumber));
    for (const private_ of ['sam@example.com', 'Queen', 'Sam']) assert.ok(!JSON.stringify(alert).includes(private_), `${private_} stays out of the alert`);
  });

  await root.test('faster shipping and a signature are priced on the server and noted for the label', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const order = await place({ shipping: { faster: true, signature: true, price: 0.01 } });
    assert.equal(order.shippingCost, 28);             // 14 + 12 faster + 2 signature, whatever the browser claimed
    assert.equal(order.total, 135 - 2.7 + 28);
    assert.match(order.shippingMethod, /Faster shipping.*\+ signature on delivery/);
    assert.match(order.adminNotes, /buy Xpresspost and add the Signature option/);
  });

  await root.test('the last unit goes to exactly one of two simultaneous buyers, and the other gets no order at all', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, 'session_buyer_one_0123456');
    await seedCart(product, 1, 'session_buyer_two_0123456');
    // Both pass the early stock check (they read stock 1), then race for the unit inside the transaction.
    const results = await Promise.allSettled([
      place({ sessionId: 'session_buyer_one_0123456', buyer: { ...BUYER, email: 'one@example.com' } }),
      place({ sessionId: 'session_buyer_two_0123456', buyer: { ...BUYER, email: 'two@example.com' } }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(lost.length, 1);
    assert.ok(lost[0].reason instanceof EtransferError, lost[0].reason?.stack);
    assert.equal(lost[0].reason.status, 409);
    assert.equal(await Order.countDocuments(), 1, 'the loser left no half-made order behind');
    assert.equal(await stockOf(product), 0, 'and stock never went negative');
  });

  await root.test('an out-of-stock cart, an empty cart, a closed lane and too many open orders are all refused cleanly', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    await seedCart(product, 5);
    await assert.rejects(place(), (e) => e instanceof EtransferError && e.status === 400 && /Only 3 units/.test(e.publicMessage));
    await Cart.deleteMany({});
    await assert.rejects(place(), (e) => e instanceof EtransferError && /Cart is empty/.test(e.publicMessage));
    await seedCart(product, 1);
    await assert.rejects(place({}, { settings: { etransfer: { enabled: false } } }), (e) => e.status === 503);
    assert.equal(await stockOf(product), 3, 'nothing was taken');

    await Product.updateOne({ _id: product._id }, { $set: { stockQuantity: 10 } });
    for (let i = 0; i < 3; i += 1) { await Cart.deleteMany({}); await seedCart(product, 1); await place(); }
    await Cart.deleteMany({}); await seedCart(product, 1);
    await assert.rejects(place(), (e) => e.status === 429 && /already have 3 orders waiting/.test(e.publicMessage));
    assert.equal(await stockOf(product), 7, 'the refused fourth order took nothing');
  });

  // ── the owner confirms the money ─────────────────────────────────────────────
  const admin = (extra = {}) => ({ _id: new mongoose.Types.ObjectId(), firstName: 'Yusuf', ...extra });

  await root.test('marking the exact amount received makes the order paid and shippable, once', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const placed = await place();
    sent.length = 0;

    await assert.rejects(markEtransferReceived(placed._id, { amount: 270, admin: admin() }), (e) => e.code === 'AMOUNT_MISMATCH' && e.status === 409);
    assert.equal((await Order.findById(placed._id)).paymentStatus, 'pending', 'a wrong amount changed nothing');

    const confirmedBy = admin();
    const paid = await markEtransferReceived(placed._id, { amount: 278.6, confirmation: 'CAxyz123', admin: confirmedBy });
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.status, 'processing');
    assert.equal(paid.etransfer.receivedAmount, 278.6);
    assert.equal(paid.etransfer.confirmation, 'CAxyz123');
    assert.equal(String(paid.etransfer.confirmedBy), String(confirmedBy._id));
    assert.ok(paid.estimatedDelivery > new Date(), 'a delivery estimate counted from today');
    assert.equal(paid.adminNotes, undefined, 'the AWAITING line is gone');
    assert.match(paid.statusHistory.at(-1).note, /Payment received by Interac e-Transfer, confirmed by Yusuf, ref CAxyz123/);
    assert.equal(await stockOf(product), 8, 'stock was already held; it is not taken twice');
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Order confirmed/);

    await assert.rejects(markEtransferReceived(placed._id, { amount: 278.6, admin: admin() }), (e) => e.code === 'ALREADY_PAID');
    assert.equal(sent.length, 1, 'no second confirmation');
  });

  await root.test('two people pressing "received" at the same moment record one payment and send one confirmation', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const placed = await place();
    sent.length = 0;
    const results = await Promise.allSettled([
      markEtransferReceived(placed._id, { amount: 278.6, admin: admin({ firstName: 'One' }) }),
      markEtransferReceived(placed._id, { amount: 278.6, admin: admin({ firstName: 'Two' }) }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.find((r) => r.status === 'rejected').reason instanceof EtransferError);
    const after = await Order.findById(placed._id);
    assert.equal(after.statusHistory.filter((h) => /Payment received by Interac e-Transfer/.test(h.note)).length, 1, 'one payment line in the history');
    assert.equal(sent.length, 1, 'one confirmation email');
    assert.equal(await stockOf(product), 8);
  });

  await root.test('a different amount can be accepted only on purpose, with a note', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const placed = await place();
    await assert.rejects(markEtransferReceived(placed._id, { amount: 100, acceptDifferentAmount: true, admin: admin() }), (e) => e.status === 400 && /note/.test(e.publicMessage));
    const paid = await markEtransferReceived(placed._id, { amount: 100, acceptDifferentAmount: true, note: 'customer sent two transfers', admin: admin() });
    assert.equal(paid.paymentStatus, 'paid');
    assert.match(paid.statusHistory.at(-1).note, /\$100\.00 instead of \$146\.30\), confirmed by Yusuf: customer sent two transfers/);
  });

  await root.test('an unpaid e-Transfer order cannot be shipped or processed by hand', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const placed = await place();
    const { canTransitionOrder } = require('../src/utils/orderTransitions');
    for (const to of ['processing', 'shipped', 'delivered']) assert.equal(canTransitionOrder(placed.status, to, placed.paymentStatus), false, to);
    assert.equal(canTransitionOrder(placed.status, 'cancelled', placed.paymentStatus), true, 'but the owner can cancel it');
  });

  // ── expiry, reminders and the late payment ───────────────────────────────────
  await root.test('an unpaid order past its hold is cancelled, its stock goes back, the buyer is told, and the owner is told', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 3);
    const placed = await place();
    assert.equal(await stockOf(product), 7);
    sent.length = 0;

    assert.deepEqual(await sweepEtransferOrders({ now: new Date() }), { expired: 0, reminded: 0, staleBankDebit: 0, errors: 0 }, 'nothing is due yet');
    await Order.updateOne({ _id: placed._id }, { $set: { 'etransfer.expiresAt': new Date(Date.now() - 1000) } });
    const summary = await sweepEtransferOrders({ now: new Date() });
    assert.equal(summary.expired, 1);

    const after = await Order.findById(placed._id);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.paymentStatus, 'pending');
    assert.ok(after.etransfer.expiredAt);
    assert.equal(after.stockDecremented, false);
    assert.equal(await stockOf(product), 10, 'every unit is back on sale');
    assert.match(sent[0].subject, /was cancelled: no e-Transfer received/);
    assert.ok(await AdminEvent.findOne({ type: 'order.etransfer_expired' }));
    assert.deepEqual(await sweepEtransferOrders({ now: new Date() }), { expired: 0, reminded: 0, staleBankDebit: 0, errors: 0 }, 'only once');
    assert.equal(await stockOf(product), 10, 'and the stock is not returned twice');
  });

  await root.test('the money arriving after the hold brings the order back when the stock is still there, and not when it is gone', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const placed = await place();
    await Order.updateOne({ _id: placed._id }, { $set: { 'etransfer.expiresAt': new Date(Date.now() - 1000) } });
    await sweepEtransferOrders();
    assert.equal(await stockOf(product), 10);

    // someone else buys most of it meanwhile: only 1 left
    await Product.updateOne({ _id: product._id }, { $set: { stockQuantity: 1 } });
    await assert.rejects(markEtransferReceived(placed._id, { amount: 278.6, admin: admin() }), (e) => e.code === 'OUT_OF_STOCK' && /Send the money back/.test(e.publicMessage));
    const still = await Order.findById(placed._id);
    assert.equal(still.status, 'cancelled', 'the failed reinstatement rolled back completely');
    assert.equal(still.paymentStatus, 'pending');
    assert.equal(await stockOf(product), 1);

    await Product.updateOne({ _id: product._id }, { $set: { stockQuantity: 4 } });
    const back = await markEtransferReceived(placed._id, { amount: 278.6, admin: admin() });
    assert.equal(back.status, 'processing');
    assert.equal(back.paymentStatus, 'paid');
    assert.equal(back.stockDecremented, true);
    assert.equal(back.etransfer.expiredAt, undefined);
    assert.equal(back.cancelledAt, undefined);
    assert.equal(await stockOf(product), 2, 'the two units are taken again');
  });

  await root.test('one reminder after 24 hours, once, and a failed email is retried on the next sweep', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const placed = await place();
    sent.length = 0;
    await Order.collection.updateOne({ _id: placed._id }, { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } });   // bypass Mongoose: createdAt is immutable there

    process.env.FAIL_EMAIL = '1';
    const failed = await sweepEtransferOrders();
    assert.equal(failed.reminded, 0);
    assert.equal(failed.errors, 1);
    assert.equal((await Order.findById(placed._id)).etransfer.reminderSentAt, undefined, 'the claim was given back');

    delete process.env.FAIL_EMAIL;
    assert.equal((await sweepEtransferOrders()).reminded, 1);
    assert.match(sent.at(-1).subject, /We have not received your e-Transfer yet/);
    assert.equal((await sweepEtransferOrders()).reminded, 0, 'never twice');
    assert.equal(sent.length, 1);
  });

  await root.test('two sweeps at the same moment send one reminder, and expire an order once', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 3);
    const first = await place();
    await Cart.deleteMany({});
    await seedCart(product, 2);
    const second = await place({ buyer: { ...BUYER, email: 'later@example.com' } });
    sent.length = 0;
    await Order.collection.updateOne({ _id: first._id }, { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    await Promise.all([sweepEtransferOrders(), sweepEtransferOrders(), sweepEtransferOrders()]);
    assert.equal(sent.filter((m) => /not received your e-Transfer yet/.test(m.subject)).length, 1, 'one reminder however many sweeps overlap');

    await Order.updateOne({ _id: second._id }, { $set: { 'etransfer.expiresAt': new Date(Date.now() - 1000) } });
    sent.length = 0;
    const totals = await Promise.all([sweepEtransferOrders(), sweepEtransferOrders(), sweepEtransferOrders()]);
    assert.equal(totals.reduce((n, t) => n + t.expired, 0), 1, 'expired once');
    assert.equal(sent.filter((m) => /was cancelled: no e-Transfer received/.test(m.subject)).length, 1, 'one cancellation email');
    assert.equal(await stockOf(product), 7, 'the second order\'s 2 units came back exactly once (10 - 3 still held by the first)');
    assert.equal(await AdminEvent.countDocuments({ type: 'order.etransfer_expired' }), 1);
  });

  await root.test('the 15-minute cron call expires a lapsed e-Transfer order even when Canada Post is not configured', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const placed = await place();
    await Order.updateOne({ _id: placed._id }, { $set: { 'etransfer.expiresAt': new Date(Date.now() - 1000) } });
    process.env.TRACKING_SYNC_TOKEN = 'sync-secret';
    delete process.env.CANADA_POST_API_KEY;
    delete process.env.CANADA_POST_API_SECRET;
    const trackingRouter = require('../src/routes/tracking');
    const app = express();
    app.use('/api/tracking', trackingRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const call = (auth) => fetch(`http://127.0.0.1:${server.address().port}/api/tracking/sync`, { method: 'POST', headers: auth ? { Authorization: auth } : {} });
      assert.equal((await call()).status, 401, 'no token, no sweep');
      assert.equal((await Order.findById(placed._id)).status, 'pending', 'an unauthenticated call changed nothing');
      assert.equal((await call('Bearer sync-secret')).status, 503, 'the carrier is not configured');
    } finally { await new Promise((resolve) => server.close(resolve)); }
    const after = await Order.findById(placed._id);
    assert.equal(after.status, 'cancelled');
    assert.equal(await stockOf(product), 10);
  });

  await root.test('a paid order that is refunded is recorded once, and an unpaid one cannot be', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const placed = await place();
    await assert.rejects(recordEtransferRefund(placed._id, { admin: admin() }), EtransferError);
    await markEtransferReceived(placed._id, { amount: 146.3, admin: admin() });
    const refunded = await recordEtransferRefund(placed._id, { note: 'returned', admin: admin() });
    assert.equal(refunded.paymentStatus, 'refunded');
    assert.equal(refunded.status, 'refunded');
    assert.match(refunded.statusHistory.at(-1).note, /Refunded by e-Transfer, recorded by Yusuf: returned/);
    await assert.rejects(recordEtransferRefund(placed._id, { admin: admin() }), EtransferError, 'not twice');
  });

  // ── over HTTP, with the real routers and real auth ───────────────────────────
  const serve = async (run) => {
    const app = express();
    app.use(express.json());
    app.use('/api/payments', createPaymentsRouter());
    app.use('/api/orders', ordersRouter);
    app.use('/api/admin', adminRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try { return await run(async (method, path, { headers = {}, body } = {}) => {
      const r = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    }); } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  };
  const form = (extra = {}) => ({ buyer: BUYER, address: { ...ADDRESS, zip: 'm5h2n2' }, shipping: {}, acceptTerms: true, ...extra });

  await root.test('the whole lane over HTTP: order, the buyer\'s page, the owner\'s panel, marking it paid', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const owner = await User.create({ email: 'owner@reflexity.example', firstName: 'Yusuf', lastName: 'Owner', role: 'admin', isEmailVerified: true });
    const adminHeaders = { authorization: `Bearer ${generateAccessToken(owner._id, owner.authVersion)}` };

    await serve(async (call) => {
      const methods = await call('GET', '/api/payments/methods');
      assert.deepEqual(methods.body.methods.map((m) => m.id), ['card', 'bank_debit', 'etransfer']);
      assert.ok(!JSON.stringify(methods.body).includes('pay@reflexity.example'));

      const placed = await call('POST', '/api/payments/etransfer/orders', { headers: { 'x-session-id': SESSION }, body: form() });
      assert.equal(placed.status, 201, JSON.stringify(placed.body));
      assert.equal(placed.body.total, 278.6);
      assert.equal(placed.body.etransfer.recipientEmail, 'pay@reflexity.example');
      assert.equal(placed.body.email, 'sam@example.com');
      const { orderNumber } = placed.body;

      // the buyer's own page shows what to send, only to the buyer
      const stranger = await call('GET', `/api/orders/${orderNumber}`);
      assert.equal(stranger.status, 404);
      const wrongEmail = await call('GET', `/api/orders/${orderNumber}`, { headers: { 'x-order-email': 'other@example.com' } });
      assert.equal(wrongEmail.status, 404);
      const mine = await call('GET', `/api/orders/${orderNumber}`, { headers: { 'x-order-email': 'sam@example.com' } });
      assert.equal(mine.status, 200);
      assert.equal(mine.body.order.paymentMethod, 'etransfer');
      assert.deepEqual(Object.keys(mine.body.order.etransfer).sort(), ['amountDue', 'expiresAt', 'message', 'recipientEmail']);
      assert.equal(mine.body.order.etransfer.message, orderNumber);
      assert.ok(!JSON.stringify(mine.body).includes('AWAITING'), 'admin notes stay private');

      // the owner finds it, filtered as "awaiting payment"
      const awaiting = await call('GET', '/api/admin/orders?payment=awaiting', { headers: adminHeaders });
      assert.deepEqual(awaiting.body.orders.map((o) => o.orderNumber), [orderNumber]);
      assert.equal((await call('GET', '/api/admin/orders?payment=awaiting')).status, 401);
      const orderId = awaiting.body.orders[0]._id;

      // only the owner can mark it, and only with a real amount
      const asBuyer = await call('POST', `/api/admin/orders/${orderId}/etransfer/received`, { body: { amount: 278.6 } });
      assert.equal(asBuyer.status, 401);
      const bad = await call('POST', `/api/admin/orders/${orderId}/etransfer/received`, { headers: adminHeaders, body: { amount: 'lots' } });
      assert.equal(bad.status, 400);
      const wrong = await call('POST', `/api/admin/orders/${orderId}/etransfer/received`, { headers: adminHeaders, body: { amount: 270 } });
      assert.equal(wrong.status, 409);
      assert.equal(wrong.body.code, 'AMOUNT_MISMATCH');
      const right = await call('POST', `/api/admin/orders/${orderId}/etransfer/received`, { headers: adminHeaders, body: { amount: 278.6, confirmation: 'CAabc' } });
      assert.equal(right.status, 200, JSON.stringify(right.body));
      assert.equal(right.body.order.paymentStatus, 'paid');
      assert.equal(right.body.order.status, 'processing');

      // paid now: no instructions for the buyer, and the normal shipping flow is open
      const after = await call('GET', `/api/orders/${orderNumber}`, { headers: { 'x-order-email': 'sam@example.com' } });
      assert.equal(after.body.order.etransfer, undefined);
      const ship = await call('PATCH', `/api/admin/orders/${orderId}/status`, { headers: adminHeaders, body: { status: 'shipped', trackingNumber: 'CP123' } });
      assert.equal(ship.status, 200);
      const refund = await call('POST', `/api/admin/orders/${orderId}/etransfer/refund`, { headers: adminHeaders, body: { note: 'x' } });
      assert.equal(refund.status, 200);
    });
  });

  await root.test('the order form is validated on the server', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    await serve(async (call) => {
      const post = (body, headers = { 'x-session-id': SESSION }) => call('POST', '/api/payments/etransfer/orders', { headers, body });
      const cases = [
        ['no terms', form({ acceptTerms: false })],
        ['terms as a string', form({ acceptTerms: 'true' })],
        ['bad province', form({ address: { ...ADDRESS, state: 'ZZ' } })],
        ['US zip', form({ address: { ...ADDRESS, zip: '90210' } })],
        ['no phone', form({ buyer: { ...BUYER, phone: '' } })],
        ['bad email', form({ buyer: { ...BUYER, email: 'nope' } })],
        ['disposable email', form({ buyer: { ...BUYER, email: 'x@mailinator.com' } })],
        ['operator injection in the name', form({ buyer: { ...BUYER, firstName: { $gt: '' } } })],
        ['no address', { buyer: BUYER, acceptTerms: true }],
      ];
      for (const [label, body] of cases) {
        const r = await post(body);
        assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`);
      }
      assert.equal(await Order.countDocuments(), 0, 'no refused request made an order');
      assert.equal(await stockOf(product), 10);
      const noSession = await post(form(), {});
      assert.equal(noSession.status, 400);
      const ok = await post(form({ address: { ...ADDRESS, state: 'on' } }));
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal((await Order.findOne()).shippingAddress.state, 'ON');
    });
  });

  await root.test('a logged-in buyer\'s account email is used, and the form email cannot redirect the instructions', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1, 'session_unused_0123456789');
    const account = await User.create({ email: 'member@example.com', firstName: 'Mia', lastName: 'Member', isEmailVerified: true });
    await Cart.create({ user: account._id, items: [{ product: product._id, slug: product.slug, sku: product.sku, name: product.name, price: 135, qty: 1 }] });
    await serve(async (call) => {
      const r = await call('POST', '/api/payments/etransfer/orders', {
        headers: { authorization: `Bearer ${generateAccessToken(account._id, 0)}` },
        body: form({ buyer: { ...BUYER, email: 'attacker@example.com' } }),
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.email, undefined);
      const order = await Order.findOne();
      assert.equal(String(order.user), String(account._id));
      assert.equal(order.guestEmail, undefined);
      assert.equal(sent.at(-1).to, 'member@example.com');
    });
  });

  // ── bank debit: the Stripe side, driven with sessions shaped like Stripe's ────
  const session = (extra = {}) => ({
    id: 'cs_test_bankdebit_1', object: 'checkout.session', status: 'complete', payment_status: 'unpaid',
    payment_method_types: ['acss_debit'],
    metadata: { userId: 'guest', cartSessionId: SESSION, paymentMethod: 'bank_debit', paymentDiscountPct: '1' },
    customer_details: { email: 'sam@example.com', name: 'Sam Buyer', phone: '+14165550123' },
    collected_information: { shipping_details: { name: 'Sam Buyer', address: { line1: '100 Queen St W', city: 'Toronto', state: 'ON', postal_code: 'M5H 2N2', country: 'CA' } } },
    line_items: { data: [{ price: { id: 'price_d4_16', unit_amount: 13500, product: { metadata: { slug: 'ddr4-16gb' } } }, quantity: 2 }] },
    amount_subtotal: 27000,
    total_details: { amount_discount: 270, amount_shipping: 1400, amount_tax: 0 },
    amount_total: 28130,
    shipping_cost: { shipping_rate: { display_name: 'Flat-Rate Shipping (delivery 3–6 business days after dispatch)' } },
    payment_intent: { id: 'pi_bankdebit_1', status: 'processing', latest_charge: 'ch_bankdebit_1' },
    ...extra,
  });
  const paidSession = () => session({ payment_status: 'paid', payment_intent: { id: 'pi_bankdebit_1', status: 'succeeded', latest_charge: 'ch_bankdebit_1' } });
  const withStripe = async (current, run) => {
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => current() });
    try { await run(stripeRouter.internalsForTest); } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  };
  const bankSetup = async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    return product;
  };

  await root.test('checkout email: a crash immediately after the order insert is recovered without another stock decrement or email', async () => {
    const product = await bankSetup();
    const create = Order.create;
    await withStripe(() => paidSession(), async ({ fulfillCheckoutSession }) => {
      Order.create = async (...args) => { await create.apply(Order, args); throw new Error('process stopped after durable insert'); };
      try { await assert.rejects(fulfillCheckoutSession('cs_test_bankdebit_1'), /process stopped/); }
      finally { Order.create = create; }
      assert.equal(sent.length, 0);
      await require('../src/utils/checkoutEmails').retryCheckoutEmails({ recover: fulfillCheckoutSession });
      const recovered = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal((await Order.findById(recovered._id)).checkoutEmail.status, 'sent');
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(await stockOf(product), 8);
      assert.equal(sent.length, 1);
    });
  });

  await root.test('checkout email: a provider failure retries from the saved marker, and old orders without markers are silent', async () => {
    await bankSetup();
    await withStripe(() => paidSession(), async ({ fulfillCheckoutSession }) => {
      process.env.FAIL_EMAIL = '1';
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal((await Order.findById(order._id)).checkoutEmail.status, 'failed');
      delete process.env.FAIL_EMAIL;
      const { retryCheckoutEmails } = require('../src/utils/checkoutEmails');
      await retryCheckoutEmails();
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(sent.length, 1);
      await Order.updateOne({ _id: order._id }, { $unset: { checkoutEmail: '' } });
      await retryCheckoutEmails();
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(sent.length, 1, 'no replay of historic confirmations');
    });
  });

  await root.test('checkout email: cancelled orders cannot fill the retry batch and starve a valid receipt', async () => {
    await bankSetup();
    for (let i = 0; i < 26; i++) await Order.create({
      orderNumber: `RFX-CANCELLED-QUEUE-${i}`, guestEmail: 'cancelled@example.com',
      shippingAddress: { ...ADDRESS, firstName: 'Sam', lastName: 'Buyer', country: 'CA' },
      items: [{ slug: 'ddr4-16gb', sku: 'D4', name: '16GB DDR4', price: 135, qty: 1 }],
      subtotal: 135, total: 135, paymentMethod: 'stripe', paymentStatus: 'paid', status: 'cancelled',
      checkoutEmail: { email: 'cancelled@example.com', kind: 'confirmation', status: 'pending', ready: true, queuedAt: new Date() },
    });
    await withStripe(() => paidSession(), async ({ fulfillCheckoutSession }) => {
      process.env.FAIL_EMAIL = '1';
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      delete process.env.FAIL_EMAIL;
      await Order.updateOne({ _id: order._id }, { $set: { 'checkoutEmail.claimedAt': new Date(Date.now() - 6 * 60000) } });
      await require('../src/utils/checkoutEmails').retryCheckoutEmails();
      assert.equal(sent.length, 1);
      assert.equal((await Order.findById(order._id)).checkoutEmail.status, 'sent');
      assert.equal(sent[0].to, 'sam@example.com');
    });
  });

  await root.test('checkout email: acceptance followed by a failed database stamp reuses the provider key, including racing retries', async () => {
    await bankSetup();
    await withStripe(() => paidSession(), async ({ fulfillCheckoutSession }) => {
      process.env.FAIL_EMAIL = '1';
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      delete process.env.FAIL_EMAIL;
      const { deliverCheckoutEmail } = require('../src/utils/checkoutEmails');
      const keys = new Set(); let attempts = 0; let failStamp = true;
      const model = {
        findOneAndUpdate: (...args) => Order.findOneAndUpdate(...args),
        updateOne: (...args) => {
          if (failStamp && args[1].$set['checkoutEmail.status'] === 'sent') { failStamp = false; throw new Error('stamp lost'); }
          return Order.updateOne(...args);
        },
      };
      const confirm = async ({ idempotencyKey }) => { attempts++; keys.add(idempotencyKey); };
      const fresh = await Order.findById(order._id);
      assert.equal((await deliverCheckoutEmail(fresh, 'checkoutEmail', { Order: model, confirm })).status, 'failed');
      await Promise.all(Array.from({ length: 5 }, () => deliverCheckoutEmail(fresh, 'checkoutEmail', { Order: model, confirm })));
      assert.equal(attempts, 2); assert.equal(keys.size, 1);
      assert.equal((await Order.findById(order._id)).checkoutEmail.status, 'sent');
    });
  });

  await root.test('checkout email: a dead sender lease expires, but retries stop before provider deduplication expires', async () => {
    await bankSetup();
    await withStripe(() => paidSession(), async ({ fulfillCheckoutSession }) => {
      process.env.FAIL_EMAIL = '1';
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      delete process.env.FAIL_EMAIL;
      const { retryCheckoutEmails } = require('../src/utils/checkoutEmails');
      await Order.updateOne({ _id: order._id }, { $set: { 'checkoutEmail.status': 'sending', 'checkoutEmail.claimedAt': new Date(Date.now() - 6 * 60000) } });
      await retryCheckoutEmails(); assert.equal(sent.length, 1);
      await Order.updateOne({ _id: order._id }, { $set: { 'checkoutEmail.status': 'failed', 'checkoutEmail.queuedAt': new Date(Date.now() - 24 * HOUR) } });
      await retryCheckoutEmails(); assert.equal(sent.length, 1);
    });
  });

  await root.test('checkout email: a failed bank-debit clearing confirmation retries without replaying the pending notice', async () => {
    await bankSetup(); let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      current = paidSession(); process.env.FAIL_EMAIL = '1';
      await settleBankDebitPaid('cs_test_bankdebit_1');
      delete process.env.FAIL_EMAIL;
      await require('../src/utils/checkoutEmails').retryCheckoutEmails();
      await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(sent.filter((m) => /bank debit processing/.test(m.subject)).length, 1);
      assert.equal(sent.filter((m) => /Order confirmed/.test(m.subject)).length, 1);
    });
  });

  await root.test('bank debit: authorized but not cleared makes a pending order that holds stock, tells the buyer and the owner, and is idempotent', async () => {
    const product = await bankSetup();
    await withStripe(() => session(), async ({ fulfillCheckoutSession, isDelayedBankDebit }) => {
      assert.equal(isDelayedBankDebit(session()), true);
      assert.equal(isDelayedBankDebit(session({ payment_status: 'paid' })), false);
      assert.equal(isDelayedBankDebit(session({ status: 'open' })), false);
      assert.equal(isDelayedBankDebit(session({ payment_method_types: ['card'] })), false, 'another unpaid method is not an order yet');

      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentMethod, 'bank_debit');
      assert.equal(order.paymentStatus, 'pending');
      assert.equal(order.status, 'pending');
      assert.equal(order.subtotal, 270);
      assert.equal(order.discount, 2.7);
      assert.equal(order.total, 281.3);
      assert.equal(order.paymentDiscountPct, 1);
      assert.equal(order.estimatedDelivery, undefined);
      assert.match(order.adminNotes, /^AWAITING bank debit/);
      assert.equal(await stockOf(product), 8);
      assert.equal((await Cart.findOne({ sessionId: SESSION })).items.length, 0);
      assert.match(sent.at(-1).subject, /bank debit processing/);
      assert.ok(await AdminEvent.findOne({ type: 'order.bank_debit_pending', priority: 'high' }));
      const { canTransitionOrder } = require('../src/utils/orderTransitions');
      assert.equal(canTransitionOrder(order.status, 'shipped', order.paymentStatus), false, 'cannot be shipped while it clears');

      const again = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(String(again._id), String(order._id));
      assert.equal(await Order.countDocuments(), 1);
      assert.equal(await stockOf(product), 8, 'not taken twice');
      assert.equal(sent.filter((m) => /bank debit processing/.test(m.subject)).length, 1, 'one email');
    });
  });

  await root.test('bank debit: when the bank clears it the order becomes paid and shippable, exactly once', async () => {
    const product = await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      sent.length = 0;
      current = paidSession();
      const paid = await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(paid.paymentStatus, 'paid');
      assert.equal(paid.status, 'processing');
      assert.equal(paid.stripeChargeId, 'ch_bankdebit_1');
      assert.ok(paid.estimatedDelivery > new Date());
      assert.equal(paid.adminNotes, undefined);
      assert.match(paid.statusHistory.at(-1).note, /Bank debit cleared/);
      assert.equal(await stockOf(product), 8);
      assert.equal(sent.length, 1);
      assert.match(sent[0].subject, /Order confirmed/);
      assert.ok(await AdminEvent.findOne({ type: 'order.bank_debit_paid' }));

      await settleBankDebitPaid('cs_test_bankdebit_1');          // Stripe retries the webhook
      assert.equal(sent.length, 1, 'one confirmation');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_paid' }), 1);
      await fulfillCheckoutSession('cs_test_bankdebit_1');        // ... and the "completed" event is retried too
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_pending' }), 1, 'announced as placed once');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.paid' }), 0, 'a cleared bank debit is not also announced as a card sale');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_paid' }), 1);
    });
  });

  await root.test('bank debit: an alert lost to a crash is sent when Stripe retries the event, once, and never for an old order', async () => {
    const product = await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid, settleBankDebitFailed }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      current = paidSession();
      const realCreate = AdminEvent.create;
      AdminEvent.create = async () => { throw new Error('database blip'); };      // the alert cannot be written this time
      try { await settleBankDebitPaid('cs_test_bankdebit_1'); } finally { AdminEvent.create = realCreate; }
      assert.equal((await Order.findOne()).paymentStatus, 'paid', 'the payment itself was recorded');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_paid' }), 0, 'but the alert was lost');
      await settleBankDebitPaid('cs_test_bankdebit_1');                           // Stripe retries the webhook
      await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_paid' }), 1, 'sent on the retry, and only once');

      // an old settled order, retried much later, stays quiet
      await AdminEvent.deleteMany({});
      await Order.collection.updateOne({}, { $set: { updatedAt: new Date(Date.now() - 3 * 24 * HOUR) } });
      await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(await AdminEvent.countDocuments({}), 0);
    });

    // the same for a failed debit
    await reset();
    await seedProduct();
    await seedCart(await Product.findOne(), 2);
    let failing = session();
    await withStripe(() => failing, async ({ fulfillCheckoutSession, settleBankDebitFailed }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      const realCreate = AdminEvent.create;
      AdminEvent.create = async () => { throw new Error('database blip'); };
      try { await settleBankDebitFailed('cs_test_bankdebit_1'); } finally { AdminEvent.create = realCreate; }
      assert.equal((await Order.findOne()).status, 'cancelled');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.payment_failed' }), 0, 'lost');
      await settleBankDebitFailed('cs_test_bankdebit_1');
      await settleBankDebitFailed('cs_test_bankdebit_1');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.payment_failed' }), 1, 'sent on the retry, once');
    });
  });

  await root.test('bank debit: an "it cleared" event with no earlier order creates a paid order', async () => {
    const product = await bankSetup();
    await withStripe(() => paidSession(), async ({ settleBankDebitPaid }) => {
      const order = await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'paid');
      assert.equal(order.status, 'processing');
      assert.equal(order.paymentMethod, 'bank_debit');
      assert.equal(await Order.countDocuments(), 1);
      assert.equal(await stockOf(product), 8);
    });
  });

  await root.test('bank debit: a debit that fails cancels the order, returns the stock and tells the buyer; a later "cleared" cannot revive it', async () => {
    const product = await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitFailed, settleBankDebitPaid }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(await stockOf(product), 8);
      sent.length = 0;
      const failed = await settleBankDebitFailed('cs_test_bankdebit_1');
      const after = await Order.findById(failed._id);
      assert.equal(after.status, 'cancelled');
      assert.equal(after.paymentStatus, 'failed');
      assert.equal(after.stockDecremented, false);
      assert.equal(await stockOf(product), 10, 'stock returned');
      assert.match(sent[0].subject, /did not go through/);
      assert.ok(await AdminEvent.findOne({ type: 'order.payment_failed', priority: 'high' }));

      await settleBankDebitFailed('cs_test_bankdebit_1');
      assert.equal(sent.length, 1, 'once');
      assert.equal(await stockOf(product), 10, 'stock not returned twice');

      current = paidSession();                                   // a contradictory later event
      await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal((await Order.findById(failed._id)).paymentStatus, 'failed');
      assert.equal((await Order.findById(failed._id)).status, 'cancelled');
    });
  });

  await root.test('bank debit: a failure with no order yet changes nothing, and a debit that clears on a hand-cancelled order flags it for a refund', async () => {
    const product = await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitFailed, settleBankDebitPaid }) => {
      assert.equal(await settleBankDebitFailed('cs_test_bankdebit_1'), null);
      assert.equal(await stockOf(product), 10);

      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(await stockOf(product), 8);
      await cancelOrderAndRestoreStock(order._id, { status: 'cancelled', cancelledAt: new Date() }, { status: 'pending', paymentStatus: 'pending' });
      assert.equal(await stockOf(product), 10);

      current = paidSession();
      await settleBankDebitPaid('cs_test_bankdebit_1');
      const flagged = await Order.findById(order._id);
      assert.equal(flagged.status, 'cancelled');
      assert.match(flagged.adminNotes, /REVIEW: the bank debit CLEARED after this order was cancelled/);
      const alert = await AdminEvent.findOne({ type: 'order.payment_after_cancel' });
      assert.ok(alert);
      assert.equal(alert.priority, 'high');
    });
  });

  await root.test('the success-page poll sees a clearing debit as "processing" with an order number, and a card sale as before', async () => {
    await bankSetup();
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => session() });
    try {
      const app = express();
      app.use('/api/stripe', stripeRouter);
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=cs_test_bankdebit_1`);
        const body = await r.json();
        assert.equal(body.status, 'processing');
        assert.match(body.orderNumber, /^RFX-/);
        assert.equal(body.email, 'sam@example.com');
        assert.equal(body.paymentMethod, 'bank_debit');
        assert.equal(body.value, undefined, 'no purchase is reported to analytics until it clears');
      } finally { await new Promise((resolve) => server.close(resolve)); }
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('the signed webhook routes each Stripe event to the right step', async () => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const product = await bankSetup();
    await seedCart(product, 1, 'session_second_buyer_0123456');
    const sessions = new Map();
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id) => sessions.get(id) });
    const app = express();
    app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
    app.use('/api/stripe', stripeRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const send = async (type, object, { sign = true } = {}) => {
      const payload = JSON.stringify({ id: `evt_${type}_${object.id}`, object: 'event', type, data: { object } });
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sign ? { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) } : {}) },
        body: payload,
      });
      return r.status;
    };
    try {
      const one = session({ id: 'cs_one' });
      const two = session({ id: 'cs_two', metadata: { userId: 'guest', cartSessionId: 'session_second_buyer_0123456', paymentMethod: 'bank_debit', paymentDiscountPct: '1' },
        line_items: { data: [{ price: { id: 'price_d4_16', unit_amount: 13500, product: { metadata: { slug: 'ddr4-16gb' } } }, quantity: 1 }] },
        payment_intent: { id: 'pi_two', status: 'processing', latest_charge: 'ch_two' } });
      sessions.set('cs_one', one); sessions.set('cs_two', two);

      assert.equal(await send('checkout.session.completed', one, { sign: false }), 400, 'an unsigned event is refused');
      assert.equal(await Order.countDocuments(), 0);

      assert.equal(await send('checkout.session.completed', one), 200);
      assert.equal(await send('checkout.session.completed', two), 200);
      assert.equal(await Order.countDocuments({ paymentStatus: 'pending', paymentMethod: 'bank_debit' }), 2, 'both clearing debits became pending orders');
      assert.equal(await stockOf(product), 7);

      sessions.set('cs_one', { ...one, payment_status: 'paid', payment_intent: { id: 'pi_bankdebit_1', status: 'succeeded', latest_charge: 'ch_bankdebit_1' } });
      assert.equal(await send('checkout.session.async_payment_succeeded', sessions.get('cs_one')), 200);
      assert.equal((await Order.findOne({ stripeCheckoutSessionId: 'cs_one' })).paymentStatus, 'paid');
      assert.equal((await Order.findOne({ stripeCheckoutSessionId: 'cs_two' })).paymentStatus, 'pending', 'the other debit is untouched');

      assert.equal(await send('checkout.session.async_payment_failed', two), 200);
      const failed = await Order.findOne({ stripeCheckoutSessionId: 'cs_two' });
      assert.equal(failed.status, 'cancelled');
      assert.equal(failed.paymentStatus, 'failed');
      assert.equal(await stockOf(product), 8, 'only the failed order\'s unit came back');

      // a card payment that completed unpaid for some other reason is still not an order
      sessions.set('cs_card', session({ id: 'cs_card', payment_method_types: ['card'], metadata: { userId: 'guest', cartSessionId: SESSION } }));
      assert.equal(await send('checkout.session.completed', sessions.get('cs_card')), 200);
      assert.equal(await Order.countDocuments({ stripeCheckoutSessionId: 'cs_card' }), 0);
    } finally {
      stripeRouter.setCheckoutDependenciesForTest();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await root.test('an ordinary card order is still created paid, as before', async () => {
    const product = await bankSetup();
    const card = session({
      payment_status: 'paid', payment_method_types: ['card'], metadata: { userId: 'guest', cartSessionId: SESSION },
      total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 }, amount_total: 28400,
      payment_intent: { id: 'pi_card_1', latest_charge: 'ch_card_1' },
    });
    await withStripe(() => card, async ({ fulfillCheckoutSession }) => {
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentMethod, 'stripe');
      assert.equal(order.paymentStatus, 'paid');
      assert.equal(order.status, 'processing');
      assert.equal(order.paymentDiscountPct, undefined);
      assert.ok(order.estimatedDelivery);
      assert.equal(await stockOf(product), 8);
      assert.match(sent.at(-1).subject, /Order confirmed/);
      assert.ok(await AdminEvent.findOne({ type: 'order.paid' }));
    });
  });

  // ── what the independent review of this change found (each test fails against the code it reviewed) ────────────
  const { estimateDeliveryDate } = require('../src/utils/deliveryEstimate');

  await root.test('review F1: a failure Stripe reports BEFORE "completed" is handled leaves no order behind, now or when "completed" is retried', async () => {
    const product = await bankSetup();
    // What Stripe returns once the bank has refused the debit: the session stays complete + unpaid, the PaymentIntent is back at requires_payment_method.
    const afterFailure = session({ payment_intent: { id: 'pi_bankdebit_1', status: 'requires_payment_method', latest_charge: null } });
    await withStripe(() => afterFailure, async ({ fulfillCheckoutSession, settleBankDebitFailed, bankDebitInFlight }) => {
      assert.equal(bankDebitInFlight(afterFailure), false);
      assert.equal(bankDebitInFlight(session({ payment_intent: { status: 'requires_action' } })), false, 'waiting for the buyer to verify');
      assert.equal(bankDebitInFlight(session({ payment_intent: { status: 'canceled' } })), false);
      assert.equal(bankDebitInFlight(session()), true, 'a processing PaymentIntent is a debit in flight');
      // the unknown fails SAFE for a real buyer: a state this code has never heard of, or a PaymentIntent that was not expanded, still gets an order
      assert.equal(bankDebitInFlight(session({ payment_intent: { status: 'some_future_state' } })), true);
      assert.equal(bankDebitInFlight(session({ payment_intent: 'pi_not_expanded' })), true);
      assert.equal(bankDebitInFlight(session({ payment_intent: undefined })), true);
      assert.equal(await settleBankDebitFailed('cs_test_bankdebit_1'), null, 'no order yet, so nothing to cancel');
      assert.equal(await fulfillCheckoutSession('cs_test_bankdebit_1'), null, 'the retried "completed" must not create an order for a debit that already failed');
      assert.equal(await Order.countDocuments(), 0);
      assert.equal(await stockOf(product), 10, 'no stock is held for it');
      assert.equal(sent.length, 0, 'the buyer is not told "processing"');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_pending' }), 0, 'the owner is not told to wait for it');
    });
  });

  await root.test('review F1: a debit that is waiting for the BUYER (micro-deposits) holds nothing, and becomes a paid order only when the money clears', async () => {
    const product = await bankSetup();
    let current = session({ payment_intent: { id: 'pi_bankdebit_1', status: 'requires_action', latest_charge: null } });
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      assert.equal(await fulfillCheckoutSession('cs_test_bankdebit_1'), null);
      assert.equal(await stockOf(product), 10, 'nothing held while the buyer has not verified the account');
      current = paidSession();
      const order = await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'paid');
      assert.equal(order.status, 'processing');
      assert.equal(await Order.countDocuments(), 1);
      assert.equal(await stockOf(product), 8, 'taken when it was paid');
    });
  });

  await root.test('review F1: a bank debit still clearing after 8 days is flagged to the owner once, never cancelled by the sweep, and a fresh one is left alone', async () => {
    const product = await bankSetup();
    await withStripe(() => session(), async ({ fulfillCheckoutSession }) => { await fulfillCheckoutSession('cs_test_bankdebit_1'); });
    assert.equal((await sweepEtransferOrders({ now: new Date() })).staleBankDebit, 0, 'placed just now');
    await Order.collection.updateOne({}, { $set: { createdAt: new Date(Date.now() - 9 * 24 * HOUR) } });
    assert.equal((await sweepEtransferOrders({ now: new Date() })).staleBankDebit, 1);
    assert.equal((await sweepEtransferOrders({ now: new Date() })).staleBankDebit, 0, 'once');
    const alert = await AdminEvent.findOne({ type: 'order.bank_debit_stale' });
    assert.ok(alert);
    assert.equal(alert.priority, 'high');
    assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_stale' }), 1);
    const still = await Order.findOne();
    assert.equal(still.status, 'pending', 'the owner decides, not the sweep');
    assert.equal(await stockOf(product), 8);

    // an old debit the owner has already cancelled by hand is not worth an alert
    await AdminEvent.deleteMany({});
    await Order.collection.updateOne({ _id: still._id }, { $set: { status: 'cancelled' } });
    assert.equal((await sweepEtransferOrders({ now: new Date() })).staleBankDebit, 0);
    assert.equal(await AdminEvent.countDocuments({ type: 'order.bank_debit_stale' }), 0);
  });

  await root.test('review F2/F11: one e-Transfer order may not hold more than the settings allow, and a refused one takes nothing', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 60 });
    await seedCart(product, 17);
    await assert.rejects(place(), (e) => e instanceof EtransferError && e.status === 400 && e.code === 'ETRANSFER_TOO_LARGE' && /limited to 16 items and \$3,000 CAD/.test(e.publicMessage));
    await Cart.updateOne({ sessionId: SESSION }, { $set: { 'items.0.qty': 16 } });
    const atTheLimit = await place();                                   // exactly 16 items is allowed
    assert.equal(atTheLimit.items[0].qty, 16);
    assert.equal(await stockOf(product), 44);
    await reset();
    const again = await seedProduct({ stockQuantity: 60 });
    await seedCart(again, 17);
    await assert.rejects(place(), (e) => e.code === 'ETRANSFER_TOO_LARGE');
    assert.equal(await stockOf(again), 60, 'nothing taken');
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Cart.findOne({ sessionId: SESSION })).items.length, 1, 'the cart is left alone so the buyer can still pay by card');

    await reset();
    const pricey = await seedProduct({ price: 400, stockQuantity: 60 });
    await seedCart(pricey, 8);                                       // 8 x 400 = 3200, over the 3000 cap
    await assert.rejects(place(), (e) => e.code === 'ETRANSFER_TOO_LARGE');
    await Cart.updateOne({ sessionId: SESSION }, { $set: { 'items.0.qty': 7 } });   // 7 x 400 = 2800 - 2% + 25 shipping (3 or more sticks) = 2769: fine
    assert.equal((await place()).total, 2769);

    // the cap is on the order's total, to the cent, and follows the setting
    await reset();
    const normal = await seedProduct();
    await seedCart(normal, 2);                                        // total 278.60
    process.env.ETRANSFER_MAX_TOTAL_CAD = '278.59';
    try {
      await assert.rejects(place(), (e) => e.code === 'ETRANSFER_TOO_LARGE');
      process.env.ETRANSFER_MAX_TOTAL_CAD = '278.6';
      assert.equal((await place()).total, 278.6, 'exactly at the cap is allowed');
    } finally { delete process.env.ETRANSFER_MAX_TOTAL_CAD; }
  });

  await root.test('the e-Transfer cap is atomic across different carts and different products for one email', async () => {
    await reset();
    const carts = [];
    for (let i = 0; i < 6; i++) {
      const product = await seedProduct({ slug: `cap-${i}`, sku: `CAP-${i}`, stripePriceId: `price_cap_${i}` });
      const sessionId = `cap_session_${i}_0123456789`;
      await seedCart(product, 1, sessionId); carts.push({ product, sessionId });
    }
    const results = await Promise.allSettled(carts.map(({ sessionId }) => place({ sessionId })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
    const refused = results.filter((r) => r.status === 'rejected');
    assert.ok(refused.every((r) => r.reason instanceof EtransferError && r.reason.status === 429));
    assert.equal(await Order.countDocuments(), 3);
    assert.equal(sent.length, 3);
    assert.equal(await Cart.countDocuments({ 'items.0': { $exists: true } }), 3, 'refused carts survive transaction rollback');
    const products = await Product.find().lean();
    assert.equal(products.reduce((n, p) => n + p.stockQuantity, 0), 57, 'only three units reserved');
  });

  await root.test('review F3: five simultaneous submits of one cart make exactly one order, one set of instructions and one alert', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => place({ buyer: { ...BUYER, email: 'burst@example.com' } })));
    const made = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    assert.equal(made.length, 1, JSON.stringify(results.map((r) => r.status === 'rejected' ? r.reason.message : 'ok')));
    assert.ok(refused.every((r) => r.reason instanceof EtransferError && r.reason.status === 409 && r.reason.code === 'CART_CHANGED'), 'the others are turned away cleanly');
    assert.equal(await Order.countDocuments(), 1);
    assert.equal(await stockOf(product), 8, 'one order\'s stock, not five');
    assert.equal(sent.filter((m) => /Send your e-Transfer/.test(m.subject)).length, 1, 'one set of instructions');
    assert.equal(await AdminEvent.countDocuments({ type: 'order.etransfer_pending' }), 1, 'one alert');
    assert.equal((await Cart.findOne({ sessionId: SESSION })).items.length, 0);
  });

  await root.test('review F3: a cart that changed after it was priced is not ordered from', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    // the buyer edits the cart in another tab in the instant between reading and ordering
    const realFindOne = Cart.findOne;
    Cart.findOne = function (...args) {
      const query = realFindOne.apply(this, args);
      return query.then(async (found) => {
        await Cart.updateOne({ _id: found._id }, { $set: { 'items.0.qty': 5 } });   // bumps updatedAt too
        return found;
      });
    };
    try {
      await assert.rejects(place(), (e) => e.code === 'CART_CHANGED');
    } finally { Cart.findOne = realFindOne; }
    assert.equal(await Order.countDocuments(), 0);
    assert.equal(await stockOf(product), 10);
    assert.equal((await Cart.findOne({ sessionId: SESSION })).items[0].qty, 5, 'the buyer\'s newer cart is untouched');
  });

  await root.test('review F4: marking an e-Transfer received and a bank debit clearing both record when the money arrived', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    const placed = await place();
    assert.equal(placed.paidAt, undefined, 'unpaid orders have no paid date');
    const t0 = Date.now();
    const paid = await markEtransferReceived(placed._id, { amount: 146.3, admin: admin() });
    assert.ok(paid.paidAt && Math.abs(paid.paidAt - t0) < 5000, 'the e-Transfer was paid just now');

    const debitProduct = await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paidAt, undefined);
      await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: new Date(Date.now() - 4 * 24 * HOUR) } });   // authorized four days ago
      current = paidSession();
      const cleared = await settleBankDebitPaid('cs_test_bankdebit_1');
      assert.ok(cleared.paidAt && Math.abs(cleared.paidAt - Date.now()) < 5000, 'cleared just now, not four days ago');
      // the GA4 report works from that date: four days after the order was placed it is still reported, dated when it was paid
      const { reportPaidOrderToGa4 } = require('../src/utils/purchaseAnalytics');
      const calls = [];
      const ok = await reportPaidOrderToGa4(await Order.findById(cleared._id).lean(), {
        currency: 'CAD', isEnabled: () => true, send: async (o) => { calls.push(o); return { sent: true }; },
      });
      assert.equal(ok, true);
      assert.equal(calls.length, 1);
    });
    assert.ok(debitProduct);
  });

  await root.test('review F5: a replayed "it cleared" event flags a hand-cancelled order once', async () => {
    await bankSetup();
    let current = session();
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      await cancelOrderAndRestoreStock(order._id, { status: 'cancelled', cancelledAt: new Date() }, { status: 'pending', paymentStatus: 'pending' });
      current = paidSession();
      await settleBankDebitPaid('cs_test_bankdebit_1');
      await settleBankDebitPaid('cs_test_bankdebit_1');
      await Promise.all([settleBankDebitPaid('cs_test_bankdebit_1'), settleBankDebitPaid('cs_test_bankdebit_1')]);
      const flagged = await Order.findById(order._id);
      assert.equal((flagged.adminNotes.match(/REVIEW: the bank debit CLEARED/g) || []).length, 1, flagged.adminNotes);
      assert.equal(await AdminEvent.countDocuments({ type: 'order.payment_after_cancel' }), 1);
    });
  });

  await root.test('review F6: a Faster-shipping bank debit gets the Faster delivery estimate when it clears, like the card and e-Transfer paths', async () => {
    await bankSetup();
    const fasterMeta = { ...session().metadata, shippingCountry: 'CA', canadaPostTransitDays: '3' };
    let current = session({ metadata: fasterMeta });
    await withStripe(() => current, async ({ fulfillCheckoutSession, settleBankDebitPaid }) => {
      await fulfillCheckoutSession('cs_test_bankdebit_1');
      current = paidSession(); current.metadata = fasterMeta;
      const paid = await settleBankDebitPaid('cs_test_bankdebit_1');
      const faster = estimateDeliveryDate({ placedAt: paid.paidAt, country: 'CA', transitDays: 3 });
      const standard = estimateDeliveryDate({ placedAt: paid.paidAt, country: 'CA' });
      assert.notEqual(+faster, +standard, 'the two estimates really differ');
      assert.equal(+paid.estimatedDelivery, +faster);
    });
  });

  await root.test('review F7: a refunded card order\'s success link answers "complete" as before; an unpaid or failed bank debit answers "processing", never a sale', async () => {
    const product = await bankSetup();
    const card = session({
      payment_status: 'paid', payment_method_types: ['card'], metadata: { userId: 'guest', cartSessionId: SESSION },
      total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 }, amount_total: 28400,
      payment_intent: { id: 'pi_card_1', latest_charge: 'ch_card_1' },
    });
    const poll = async (current) => {
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => current });
      const app = express();
      app.use('/api/stripe', stripeRouter);
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${current.id}`);
        return await r.json();
      } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); stripeRouter.setCheckoutDependenciesForTest(); }
    };
    const first = await poll(card);
    assert.equal(first.status, 'complete');
    await Order.updateOne({ stripeCheckoutSessionId: card.id }, { $set: { paymentStatus: 'refunded', status: 'refunded' } });
    const again = await poll(card);
    assert.equal(again.status, 'complete', 'exactly what a refunded card order has always answered');
    assert.equal(again.orderNumber, first.orderNumber);

    // a bank debit that failed and was cancelled is shown as an order that is not paid, with nothing for analytics
    await reset();
    await seedProduct();
    await seedCart(await Product.findOne(), 2);
    let failing = session({ id: 'cs_failed_debit' });
    await withStripe(() => failing, async ({ fulfillCheckoutSession, settleBankDebitFailed }) => {
      await fulfillCheckoutSession('cs_failed_debit');
      await settleBankDebitFailed('cs_failed_debit');
    });
    const body = await poll(session({ id: 'cs_failed_debit', payment_intent: { id: 'pi_x', status: 'requires_payment_method' } }));
    assert.equal(body.status, 'processing');
    assert.equal(body.value, undefined);
    assert.ok(product);
  });

  await root.test('review F8: the dashboard\'s "pending" counts orders to process, and orders waiting for money are counted on their own', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 30 });
    await seedCart(product, 1);
    await place();                                                        // an e-Transfer order, unpaid
    await seedCart(product, 1, 'session_card_buyer_0123456789');
    const card = session({
      id: 'cs_card_for_stats', payment_status: 'paid', payment_method_types: ['card'], metadata: { userId: 'guest', cartSessionId: 'session_card_buyer_0123456789' },
      total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 }, amount_total: 28400, payment_intent: { id: 'pi_card_stats', latest_charge: 'ch_card_stats' },
    });
    await withStripe(() => card, async ({ fulfillCheckoutSession }) => { await fulfillCheckoutSession('cs_card_for_stats'); });
    const owner = await User.create({ email: 'owner2@reflexity.example', firstName: 'Yusuf', lastName: 'Owner', role: 'admin', isEmailVerified: true });
    const adminHeaders = { authorization: `Bearer ${generateAccessToken(owner._id, owner.authVersion)}` };
    await serve(async (call) => {
      const stats = await call('GET', '/api/admin/stats', { headers: adminHeaders });
      assert.equal(stats.status, 200);
      assert.equal(stats.body.stats.totalOrders, 2);
      assert.equal(stats.body.stats.pendingOrders, 1, 'only the paid card order is waiting to be processed');
      assert.equal(stats.body.stats.awaitingPayment, 1, 'the e-Transfer order is waiting for money');
    });
  });

  await root.test('review F10: the e-Transfer instructions tell a stranger whose address was typed in by mistake to ignore them', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 1);
    await place();
    assert.match(lastEmail().html, /Did not place this order\? Ignore this email and do not send anything/);
  });

  await root.test('review F12: "received" ignores a mismatched amount when acceptDifferentAmount is the TEXT "false" (the route coerces it, nothing else does)', async () => {
    await reset();
    const product = await seedProduct();
    await seedCart(product, 2);
    const owner = await User.create({ email: 'owner3@reflexity.example', firstName: 'Yusuf', lastName: 'Owner', role: 'admin', isEmailVerified: true });
    const adminHeaders = { authorization: `Bearer ${generateAccessToken(owner._id, owner.authVersion)}` };
    const placed = await place();
    await serve(async (call) => {
      for (const value of ['false', 'no', 0, 'true ', 'TRUE ']) {
        const r = await call('POST', `/api/admin/orders/${placed._id}/etransfer/received`, { headers: adminHeaders, body: { amount: 100, acceptDifferentAmount: value, note: 'trying' } });
        assert.ok([400, 409].includes(r.status), `${JSON.stringify(value)} -> ${r.status} ${JSON.stringify(r.body)}`);
      }
      assert.equal((await Order.findById(placed._id)).paymentStatus, 'pending', 'never paid by a mismatched amount');
    });
  });

  // ── full review of 2026-10-14: order creation (each test fails against the code before it) ────────────────────────
  // Stripe answers latest_charge as an ID unless the request asks for the charge itself; this fake does the same, so a test
  // only sees a refund when the code really asks for it.
  const asStripe = (base, charge) => async (id, options = {}) => {
    const s = base();
    if (charge && (options.expand || []).includes('payment_intent.latest_charge')) s.payment_intent = { ...s.payment_intent, latest_charge: charge };
    return s;
  };
  const cardSession = (extra = {}) => session({
    payment_status: 'paid', payment_method_types: ['card'], metadata: { userId: 'guest', cartSessionId: SESSION },
    total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 }, amount_total: 28400,
    payment_intent: { id: 'pi_card_review', status: 'succeeded', latest_charge: 'ch_card_review' },
    ...extra,
  });

  await root.test('review 2026-10-14: a payment refunded before its order existed becomes a refunded order: no stock, no confirmation, the owner told', async () => {
    const product = await bankSetup();
    const before = sent.length;
    const refunded = { id: 'ch_card_review', object: 'charge', refunded: true, amount_refunded: 28400 };
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: asStripe(() => cardSession(), refunded) });
    try {
      const { fulfillCheckoutSession } = stripeRouter.internalsForTest;
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'refunded');
      assert.equal(order.status, 'refunded');
      assert.equal(order.stripeChargeId, 'ch_card_review', 'the charge ID, not the expanded charge object');
      assert.match(order.adminNotes, /REFUNDED in Stripe before this order was recorded: do NOT ship/);
      assert.equal(await stockOf(product), 10, 'no stock taken for a refunded payment');
      assert.equal(sent.length, before, 'the buyer is not told "order confirmed"');
      const alert = await AdminEvent.findOne({ type: 'order.refunded' });
      assert.ok(alert);
      assert.equal(alert.priority, 'high');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.paid' }), 0, 'no "new order, paid" alert');
      const again = await fulfillCheckoutSession('cs_test_bankdebit_1');   // a retry (the buyer's success page, a Stripe retry)
      assert.equal(String(again._id), String(order._id));
      assert.equal(await stockOf(product), 10);
      assert.equal(await Order.countDocuments(), 1);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a refund made WHILE the order was being written is caught by the second look at the charge', async () => {
    const product = await bankSetup();
    const before = sent.length;
    let reads = 0;
    // The first read (the one the order is built from) sees an unrefunded charge; the refund lands before the order is saved,
    // its charge.refunded finds no order, and only the second look, after the save, can see it.
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id, options = {}) => {
      reads += 1;
      const charge = { id: 'ch_card_review', object: 'charge', refunded: reads > 1, amount_refunded: reads > 1 ? 28400 : 0 };
      return asStripe(() => cardSession(), charge)(id, options);
    } });
    try {
      const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(reads, 2);
      assert.equal(order.paymentStatus, 'refunded');
      assert.equal(order.status, 'refunded');
      assert.match(order.adminNotes, /REFUNDED in Stripe while this order was being recorded: do NOT ship/);
      assert.equal(await stockOf(product), 10, 'no stock taken');
      assert.equal(sent.length, before, 'no "order confirmed" email');
      assert.ok(await AdminEvent.findOne({ type: 'order.refunded' }));
      assert.equal(await AdminEvent.countDocuments({ type: 'order.paid' }), 0);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a known refund still wins when the buyer\'s success page takes the stock in the same moment', async () => {
    const product = await bankSetup();
    const before = sent.length;
    let reads = 0;
    const { fulfillCheckoutSession } = stripeRouter.internalsForTest;
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id, options = {}) => {
      reads += 1;
      if (reads === 2) await fulfillCheckoutSession(id);   // the success page's own call: finds the new order, takes its stock
      const charge = { id: 'ch_card_review', object: 'charge', refunded: reads > 1, amount_refunded: reads > 1 ? 28400 : 0 };
      return asStripe(() => cardSession(), charge)(id, options);
    } });
    try {
      const order = await fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'refunded');
      assert.equal(order.status, 'refunded');
      assert.equal(await stockOf(product), 8, 'the stock the success page took stays taken, as for any refund');
      assert.equal(sent.length, before, 'no "order confirmed" email');
      const alert = await AdminEvent.findOne({ type: 'order.refunded' }).lean();
      assert.match(alert.body, /do not ship · its stock was taken: put it back$/);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a refund seen on the second look is never confirmed as a sale, even if the database then fails', async () => {
    await bankSetup();
    const before = sent.length;
    let reads = 0;
    const realFindById = Order.findById;
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id, options = {}) => {
      reads += 1;
      if (reads === 2) {
        // Stripe's charge.refunded got there first and marked the order; then the database fails the read-back.
        await Order.updateOne({ stripeCheckoutSessionId: id }, { $set: { paymentStatus: 'refunded', status: 'refunded' } });
        Order.findById = () => { throw new Error('database blip'); };
      }
      const charge = { id: 'ch_card_review', object: 'charge', refunded: reads > 1, amount_refunded: reads > 1 ? 28400 : 0 };
      return asStripe(() => cardSession(), charge)(id, options);
    } });
    try {
      await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_test_bankdebit_1');
      Order.findById = realFindById;
      assert.equal(sent.length, before, 'no "order confirmed" email');
      assert.equal(await AdminEvent.countDocuments({ type: 'order.paid' }), 0, 'no "new order, paid" alert');
      assert.ok(await AdminEvent.findOne({ type: 'order.refunded' }));
      assert.equal((await Order.findOne({ stripeCheckoutSessionId: 'cs_test_bankdebit_1' })).paymentStatus, 'refunded');
    } finally { Order.findById = realFindById; stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: if the second look at the charge fails, the paid order goes ahead as before', async () => {
    const product = await bankSetup();
    let reads = 0;
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id, options = {}) => {
      reads += 1;
      if (reads > 1) throw new Error('Stripe is unreachable');
      return asStripe(() => cardSession(), { id: 'ch_card_review', object: 'charge', refunded: false, amount_refunded: 0 })(id, options);
    } });
    try {
      const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'paid');
      assert.equal(order.status, 'processing');
      assert.equal(await stockOf(product), 8);
      assert.match(sent.at(-1).subject, /Order confirmed/);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a payment partly refunded before its order existed is an ordinary paid order with a note', async () => {
    const product = await bankSetup();
    const partial = { id: 'ch_card_review', object: 'charge', refunded: false, amount_refunded: 1000 };
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: asStripe(() => cardSession(), partial) });
    try {
      const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_test_bankdebit_1');
      assert.equal(order.paymentStatus, 'paid');
      assert.equal(order.status, 'processing');
      assert.equal(order.stripeChargeId, 'ch_card_review');
      assert.match(order.adminNotes, /part of this payment \(1000 minor currency units\) was refunded in Stripe before this order was recorded/);
      assert.equal(await stockOf(product), 8);
      assert.match(sent.at(-1).subject, /Order confirmed/);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a line whose price AND slug changed during checkout still finds its product; a sale matching nothing alerts the owner', async () => {
    const product = await bankSetup();
    // After the buyer opened checkout the owner changed the price (a new Stripe Price) and the slug.
    await Product.updateOne({ _id: product._id }, { $set: { stripePriceId: 'price_d4_16_new', slug: 'ddr4-16gb-renamed', stripeProductId: 'prod_d4_16' } });
    const line = (productField) => ({ data: [{ id: 'li_1', price: { id: 'price_d4_16', unit_amount: 13500, product: productField }, quantity: 2 }] });
    const stripeProduct = { id: 'prod_d4_16', object: 'product', metadata: { slug: 'ddr4-16gb', productId: String(product._id) } };
    const { fulfillCheckoutSession } = stripeRouter.internalsForTest;
    try {
      // through the Stripe Product we stored
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => cardSession({ id: 'cs_by_product', line_items: line(stripeProduct) }) });
      const byProduct = await fulfillCheckoutSession('cs_by_product');
      assert.ok(byProduct, 'an order was made');
      assert.equal(String(byProduct.items[0].product), String(product._id));
      assert.equal(byProduct.items[0].slug, 'ddr4-16gb-renamed');
      assert.equal(byProduct.items[0].qty, 2);

      // through the productId the sync wrote into the Stripe Product (our record of its ID was lost)
      await Product.updateOne({ _id: product._id }, { $unset: { stripeProductId: '' } });
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => cardSession({ id: 'cs_by_metadata', payment_intent: { id: 'pi_by_metadata', status: 'succeeded', latest_charge: 'ch_by_metadata' }, line_items: line({ ...stripeProduct, id: 'prod_unknown' }) }) });
      const byMetadata = await fulfillCheckoutSession('cs_by_metadata');
      assert.ok(byMetadata);
      assert.equal(String(byMetadata.items[0].product), String(product._id));

      // nothing matches at all: no order, and the owner hears about it once
      const nothing = { id: 'prod_gone', object: 'product', metadata: { slug: 'no-such-slug', productId: '64b7f0c2a1b2c3d4e5f60719' } };
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => cardSession({ id: 'cs_nothing', currency: 'cad', payment_intent: { id: 'pi_nothing', status: 'succeeded', latest_charge: 'ch_nothing' }, line_items: line(nothing) }) });
      assert.equal(await fulfillCheckoutSession('cs_nothing'), null);
      assert.equal(await fulfillCheckoutSession('cs_nothing'), null);
      assert.equal(await Order.countDocuments({ stripeCheckoutSessionId: 'cs_nothing' }), 0);
      const alerts = await AdminEvent.find({ type: 'payment.unmatched' }).lean();
      assert.equal(alerts.length, 1, 'one alert, however often it is retried');
      assert.equal(alerts[0].priority, 'high');
      assert.match(alerts[0].body, /^Paid 284\.00 CAD, Stripe checkout cs_nothing: none of its 1 line item\(s\) matches a product\.$/);
      assert.ok(!alerts[0].body.includes('sam@example.com'), 'lock-screen text never carries the buyer\'s email');
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a cart with more lines than Stripe\'s first page is ordered whole', async () => {
    await reset();
    const products = [];
    for (const n of [1, 2, 3]) {
      products.push(await seedProduct({ slug: `ddr4-many-${n}`, sku: `D4-MANY-${n}`, stripePriceId: `price_many_${n}`, stockQuantity: 5 }));
    }
    const lineFor = (n) => ({ id: `li_many_${n}`, price: { id: `price_many_${n}`, unit_amount: 13500, product: { id: `prod_many_${n}`, metadata: { slug: `ddr4-many-${n}` } } }, quantity: 1 });
    const pages = [];
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail,
      retrieveSession: async () => cardSession({ id: 'cs_many', line_items: { object: 'list', data: [lineFor(1)], has_more: true } }),
      listLineItems: async (id, params) => {
        pages.push({ id, ...params });
        return params.starting_after === 'li_many_1'
          ? { object: 'list', data: [lineFor(2)], has_more: true }
          : { object: 'list', data: [lineFor(3)], has_more: false };
      },
    });
    try {
      const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_many');
      assert.deepEqual(order.items.map((i) => i.slug), ['ddr4-many-1', 'ddr4-many-2', 'ddr4-many-3']);
      for (const product of products) assert.equal(await stockOf(product), 4, product.slug);
      assert.deepEqual(pages.map((p) => [p.id, p.starting_after]), [['cs_many', 'li_many_1'], ['cs_many', 'li_many_2']]);
      assert.deepEqual(pages[0].expand, ['data.price.product'], 'later pages come with their products, like the first');
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });

  await root.test('review 2026-10-14: a failed "shipped" email for a parcel without tracking is sent again; tracked, old and sent ones are left alone', async () => {
    await reset();
    const { retryUntrackedShipmentNotices } = require('../src/utils/shippingNotifications');
    const DAY = 24 * HOUR;
    const make = (extra) => Order.create({
      guestEmail: 'sam@example.com', items: [{ slug: 'ddr4-16gb', sku: 'D4-16', name: '16GB DDR4 ECC RDIMM', price: 135, qty: 1 }],
      shippingAddress: { firstName: 'Sam', lastName: 'Buyer', line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'CA' },
      subtotal: 135, total: 149, paymentStatus: 'paid', status: 'shipped', untracked: true, shippedAt: new Date(), ...extra,
    });
    const failed = await make({ shippingNotification: { status: 'failed' } });
    const stale = await make({ shippingNotification: { status: 'sending', claimedAt: new Date(Date.now() - HOUR) } });
    const old = await make({ shippedAt: new Date(Date.now() - 8 * DAY), shippingNotification: { status: 'failed' } });
    const tracked = await make({ trackingNumber: 'GD546149174CA', untracked: false, shippingNotification: { status: 'failed' } });
    const done = await make({ shippingNotification: { status: 'sent', sentAt: new Date() } });
    const before = sent.length;
    const summary = await retryUntrackedShipmentNotices();
    assert.deepEqual(summary, { checked: 2, sent: 2, failed: 0 });
    assert.equal(sent.length - before, 2);
    for (const order of [failed, stale]) assert.equal((await Order.findById(order._id)).shippingNotification.status, 'sent');
    assert.equal((await Order.findById(old._id)).shippingNotification.status, 'failed', 'a week later the news is stale');
    assert.equal((await Order.findById(tracked._id)).shippingNotification.status, 'failed', 'tracked parcels are the tracking worker\'s');
    assert.equal((await Order.findById(done._id)).shippingNotification.status, 'sent');
    assert.deepEqual(await retryUntrackedShipmentNotices(), { checked: 0, sent: 0, failed: 0 }, 'nothing is sent twice');
  });

  await root.test('review 2026-10-14: when more notices keep failing than one run tries, the next run tries the others', async () => {
    await reset();
    const { retryUntrackedShipmentNotices, notifyShipment } = require('../src/utils/shippingNotifications');
    const make = () => Order.create({
      guestEmail: 'sam@example.com', items: [{ slug: 'ddr4-16gb', sku: 'D4-16', name: '16GB DDR4 ECC RDIMM', price: 135, qty: 1 }],
      shippingAddress: { firstName: 'Sam', lastName: 'Buyer', line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'CA' },
      subtotal: 135, total: 149, paymentStatus: 'paid', status: 'shipped', untracked: true, shippedAt: new Date(), shippingNotification: { status: 'failed' },
    });
    const orders = [await make(), await make(), await make()];
    const tried = [];
    const failing = (order, options) => { tried.push(String(order._id)); return notifyShipment(order, { ...options, sendEmail: async () => { throw new Error('mail down'); } }); };
    const first = await retryUntrackedShipmentNotices({ notify: failing, limit: 2 });
    assert.deepEqual(first, { checked: 2, sent: 0, failed: 2 });
    const second = await retryUntrackedShipmentNotices({ notify: failing, limit: 2, now: () => new Date(Date.now() + 1000) });
    assert.equal(second.checked, 2);
    assert.equal(tried[2], String(orders[2]._id), 'the one not tried yet goes first in the next run');
    assert.deepEqual(new Set(tried), new Set(orders.map((o) => String(o._id))), 'every notice was tried');
  });
});
