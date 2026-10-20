// Regression tests for the 2026-10-06 review of the checkout / admin / auth paths. Each fix has a test that fails without it (mutation-checked);
// a few tests are deliberate controls: behaviour that must NOT change (older clients, edits without a stock change).
// Hermetic: the Stripe key is a placeholder, so utils/stripeSync stays off (it enables itself for sk_test_/sk_live_ keys) and the product PATCH makes no network call.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// No test may send a real email.
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } },
};
process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET = 'integrity-fixes-test-secret';
process.env.STRIPE_SECRET_KEY = 'placeholder-not-a-stripe-key';

const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const adminRouter = require('../src/routes/admin');
const stripeRouter = require('../src/routes/stripe');
const { cartStickCount } = require('../src/routes/shipping');
const { resolveGoogleUser } = require('../src/routes/auth');
const { decrementStockForOrder } = require('../src/utils/stock');

const PRODUCT_ID = '64b7f0c2a1b2c3d4e5f60719';

const query = (value) => {
  const chain = { select: () => chain, session: () => chain, populate: () => chain, lean: () => chain, sort: () => chain, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  return chain;
};
function stub(t, model, methods) {
  for (const [name, impl] of Object.entries(methods)) {
    const original = model[name];
    model[name] = impl;
    t.after(() => { model[name] = original; });
  }
}
async function request(app, method, urlPath, body, headers = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
function adminApp(t) {
  stub(t, User, { findById: () => query({ _id: 'admin-1', role: 'admin', isActive: true, authVersion: 0 }) });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return { app, headers: { Authorization: `Bearer ${jwt.sign({ id: 'admin-1', av: 0 }, process.env.JWT_SECRET)}` } };
}
const quiet = (t) => { const original = console.error; console.error = () => {}; t.after(() => { console.error = original; }); };

// ── 1. a stale product form must not put an old stock number back ──────────────────────────────
test('saving a product with the stock it was opened with only applies while stock is still that number', async (t) => {
  const { app, headers } = adminApp(t);
  const calls = [];
  stub(t, Product, {
    findOneAndUpdate: (filter, update) => { calls.push(['guarded', filter, update.$set]); return query({ _id: PRODUCT_ID, slug: 'x', ...update.$set }); },
    findByIdAndUpdate: (id, update) => { calls.push(['plain', id, update.$set]); return query({ _id: id, slug: 'x', ...update.$set }); },
  });
  const res = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { stockQuantity: 9, expectedStockQuantity: 5 }, headers);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ['guarded']);
  assert.deepEqual(calls[0][1], { _id: PRODUCT_ID, stockQuantity: 5 }, 'the write is conditional on the stock the form was opened with');
  assert.equal(calls[0][2].stockQuantity, 9);
  assert.equal('expectedStockQuantity' in calls[0][2], false, 'the guard is never stored on the product');
  assert.equal(calls[0][2].stock, 'in');
});

test('a save whose stock moved meanwhile is refused with 409 and the current number, not applied', async (t) => {
  const { app, headers } = adminApp(t);
  stub(t, Product, {
    findOneAndUpdate: () => query(null),                                          // stock is no longer 5: nothing matched
    findById: () => query({ stockQuantity: 3 }),
    findByIdAndUpdate: () => { throw new Error('the unguarded write must not run'); },
  });
  const res = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { stockQuantity: 9, expectedStockQuantity: 5 }, headers);
  assert.equal(res.status, 409);
  assert.equal(res.body.currentStock, 3);
  assert.match(res.body.error, /Stock changed since you opened this product \(it is now 3\)/);
});

test('a guarded save for a product that does not exist is a 404, and a bad guard value is a 400', async (t) => {
  const { app, headers } = adminApp(t);
  stub(t, Product, { findOneAndUpdate: () => query(null), findById: () => query(null) });
  assert.equal((await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { stockQuantity: 9, expectedStockQuantity: 5 }, headers)).status, 404);
  for (const bad of [-1, 1.5, 'abc', null]) {
    const res = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { stockQuantity: 9, expectedStockQuantity: bad }, headers);
    assert.equal(res.status, 400, `expectedStockQuantity ${JSON.stringify(bad)}`);
  }
});

test('edits without a stock change, and older clients without the guard, behave exactly as before', async (t) => {
  const { app, headers } = adminApp(t);
  const calls = [];
  stub(t, Product, {
    findOneAndUpdate: () => { throw new Error('no guard was asked for'); },
    findByIdAndUpdate: (id, update) => { calls.push(update.$set); return query({ _id: id, slug: 'x', ...update.$set }); },
  });
  assert.equal((await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { stockQuantity: 9 }, headers)).status, 200);
  assert.equal((await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { price: 12, expectedStockQuantity: 5 }, headers)).status, 200);
  assert.equal(calls[0].stockQuantity, 9);
  assert.deepEqual(Object.keys(calls[1]), ['price'], 'a guard with no stock change writes nothing about stock');
});

// ── 2. the oversold flag is added to the notes an order already has ───────────────────────────
function oversoldHarness(t, existingNotes) {
  quiet(t);
  const updates = [];
  let productCalls = 0;
  const claimed = { _id: 'order-1', orderNumber: 'RFX-1', adminNotes: existingNotes, items: [{ product: 'p1', sku: 'RAM-1', qty: 2 }] };
  stub(t, Order, {
    startSession: async () => ({ withTransaction: async (work) => { await work(); }, endSession: async () => {} }),
    findOneAndUpdate: async () => claimed,
    updateOne: async (filter, update) => { updates.push(update); return {}; },
  });
  stub(t, Product, {
    findOneAndUpdate: async () => { productCalls += 1; return productCalls === 1 ? null : { stockQuantity: 1 }; },   // the full decrement fails, the clamp finds 1 left
    findById: () => query({ _id: 'p1', stockQuantity: 0 }),
    findByIdAndUpdate: async () => ({}),
  });
  return updates;
}

test('an oversold order keeps its SHIPPING and review notes and gets the OVERSOLD flag after them', async (t) => {
  const existing = 'REVIEW: disposable email detected after Stripe Checkout. Confirm before fulfillment.\nSHIPPING: the buyer paid for "Faster shipping". When you make the label, buy Xpresspost.';
  const updates = oversoldHarness(t, existing);
  assert.equal(await decrementStockForOrder({ _id: 'order-1' }), true);
  const flag = updates.find((u) => u.$set && 'adminNotes' in u.$set);
  assert.ok(flag, 'the order was flagged');
  assert.equal(flag.$set.adminNotes, `${existing}\nOVERSOLD — needs manual review: RAM-1 (wanted 2, got 1)`);
  assert.equal(flag.$push.statusHistory.note, 'OVERSOLD — needs manual review: RAM-1 (wanted 2, got 1)');
});

test('an oversold order with no notes yet gets just the OVERSOLD flag', async (t) => {
  const updates = oversoldHarness(t, undefined);
  await decrementStockForOrder({ _id: 'order-1' });
  assert.equal(updates.find((u) => u.$set && 'adminNotes' in u.$set).$set.adminNotes, 'OVERSOLD — needs manual review: RAM-1 (wanted 2, got 1)');
});

// ── 3. a guest-session cookie is a string or nothing ──────────────────────────────────────────
test('the international quote ignores a cart cookie that cookie-parser turned into an object', async (t) => {
  const lookups = [];
  stub(t, Cart, { findOne: (filter) => { lookups.push(filter); return Promise.resolve(null); } });
  // cookie-parser decodes `j:{...}` cookies into objects; that object used to reach the Mongo filter as operators
  const req = { headers: {}, cookies: { cartSessionId: { $regex: '^a' } } };
  assert.equal(await cartStickCount(req), 0);
  assert.deepEqual(lookups, [], 'no query ran for an invalid session id');
  assert.equal(await cartStickCount({ headers: { 'x-session-id': 'short' }, cookies: {} }), 0);
  assert.equal(lookups.length, 0);
  await cartStickCount({ headers: {}, cookies: { cartSessionId: 'session_0123456789abcdef' } });
  assert.deepEqual(lookups, [{ sessionId: 'session_0123456789abcdef' }], 'a well-formed id still finds the cart');
});

test('checkout refuses a cart cookie that is not a plain session id, before any cart lookup', async (t) => {
  const lookups = [];
  stub(t, Cart, { findOne: (filter) => { lookups.push(filter); return Promise.resolve(null); } });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/stripe', stripeRouter);
  const res = await request(app, 'POST', '/api/stripe/create-checkout-session', {}, { Cookie: 'cartSessionId=j:{"$regex":"^a"}' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Session ID required/);
  assert.deepEqual(lookups, [], 'the operator object never reached the query');
  await request(app, 'POST', '/api/stripe/create-checkout-session', {}, { Cookie: 'cartSessionId=session_0123456789abcdef' });
  assert.deepEqual(lookups, [{ sessionId: 'session_0123456789abcdef' }]);
});

// ── 4. an email Google has not verified never links to or creates an account ──────────────────
test('a Google profile whose email Google reports as unverified resolves to no account and touches no user record', async () => {
  const touched = [];
  const UserModel = { findOne: async (...args) => { touched.push(['findOne', args]); return null; }, create: async (...args) => { touched.push(['create', args]); return {}; } };
  for (const flag of [{ verified_email: false }, { email_verified: false }]) {
    for (const purpose of ['general', 'admin']) {
      assert.equal(await resolveGoogleUser({ id: 'g-1', email: 'victim@example.com', name: 'X', ...flag }, purpose, { UserModel }), null);
    }
  }
  assert.deepEqual(touched, []);
  // controls: verified, and the field absent altogether, still go on to look the account up
  await resolveGoogleUser({ id: 'g-1', email: 'a@example.com', verified_email: true }, 'general', { UserModel });
  await resolveGoogleUser({ id: 'g-1', email: 'a@example.com' }, 'general', { UserModel });
  assert.equal(touched.filter(([kind]) => kind === 'findOne').length, 2);
});

// ── 5. a paid line item no product matches is put on the order, not just in a log ─────────────
const stripeSession = (overrides = {}) => ({
  id: 'cs_fulfil', payment_status: 'paid',
  metadata: { userId: 'guest', cartSessionId: 'session_0123456789' },
  line_items: { data: [{ price: { id: 'price_known', unit_amount: 17000, product: {} }, quantity: 1 }] },
  amount_subtotal: 17000, amount_total: 17000, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
  shipping_cost: { shipping_rate: { display_name: 'Flat-Rate Shipping' } },
  customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Toronto', state: 'ON', postal_code: 'M1P 3T7', country: 'CA' } },
  payment_intent: 'pi_fulfil',
  ...overrides,
});
// Runs the real fulfilment (GET /session-status) for `session` against stubbed models and returns the order it created.
async function fulfil(t, session) {
  quiet(t);
  const created = [];
  stub(t, Product, { findOne: async (q) => (q.stripePriceId === 'price_known' ? { _id: 'p1', slug: 'known', sku: 'RAM-1', name: 'Known stick', images: [] } : null) });
  stub(t, Order, { findOne: async () => null, create: async (values) => { created.push(values); return { ...values, _id: 'o1', orderNumber: 'RFX-9', stockDecremented: true }; }, updateOne: async () => ({ modifiedCount: 1 }) });
  stub(t, Cart, { findOneAndUpdate: async () => undefined });
  stripeRouter.setCheckoutDependenciesForTest({ retrieveSession: async () => session, decrementStock: async () => true });
  t.after(() => stripeRouter.setCheckoutDependenciesForTest());
  const app = express();
  app.use('/api/stripe', stripeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${session.id}`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(created.length, 1);
  return created[0];
}

test('an order made from a session with an unmatched paid line item preserves it as a blocked placeholder', async (t) => {
  const order = await fulfil(t, stripeSession({
    id: 'cs_unmatched',
    line_items: { data: [
      { price: { id: 'price_known', unit_amount: 17000, product: {} }, quantity: 1 },
      { price: { id: 'price_gone', unit_amount: 5000, product: {} }, quantity: 1 },
    ] },
    amount_subtotal: 22000, amount_total: 22000,
  }));
  assert.equal(order.items.length, 2, 'every paid line remains on the order');
  assert.equal(order.items[1].sku, 'STRIPE-price_gone');
  assert.equal(order.items[1].price, 50);
  assert.equal(order.items[1].qty, 1);
  assert.equal(order.fulfillmentBlocked, true);
  assert.match(order.adminNotes, /preserved as Stripe item placeholder/);
});

test('an all-unmatched paid session still records the charged line and order totals', async (t) => {
  const order = await fulfil(t, stripeSession({
    id: 'cs_all_unmatched',
    line_items: { data: [{ price: { id: 'price_gone', unit_amount: 5000, product: { name: 'Legacy RAM bundle' } }, quantity: 2, description: 'Legacy RAM bundle' }] },
    amount_subtotal: 10000, amount_total: 10000,
  }));
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].name, 'Legacy RAM bundle');
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.total, 100);
  assert.equal(order.fulfillmentBlocked, true);
});

test('the "needs you" alert for an unmatched paid line opens that order when tapped, not the bare order list', async (t) => {
  const mongoose = require('mongoose');
  const AdminEvent = require('../src/models/AdminEvent');
  const saved = [];
  const realCreate = AdminEvent.create;
  const realState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  AdminEvent.create = async (doc) => { saved.push(doc); return { ...doc, _id: 'event-1' }; };
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
  t.after(() => {
    AdminEvent.create = realCreate;
    if (realState) Object.defineProperty(mongoose.connection, 'readyState', realState); else delete mongoose.connection.readyState;
  });
  await fulfil(t, stripeSession({
    id: 'cs_unmatched_alert',
    line_items: { data: [{ price: { id: 'price_gone', unit_amount: 5000, product: {} }, quantity: 1 }] },
    amount_subtotal: 5000, amount_total: 5000,
  }));
  const alert = saved.find((event) => event.type === 'payment.unmatched');
  assert.ok(alert, 'the owner is alerted');
  assert.equal(alert.orderNumber, 'RFX-9');
  assert.equal(alert.path, '/admin/orders?order=o1');
});

// The owner's two alerts for an order held for an unmatched line must say what is true about its money.
function captureAdminEvents(t) {
  const mongoose = require('mongoose');
  const AdminEvent = require('../src/models/AdminEvent');
  const saved = [];
  const realCreate = AdminEvent.create;
  const realState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  AdminEvent.create = async (doc) => { saved.push(doc); return { ...doc, _id: 'event-1' }; };
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
  t.after(() => {
    AdminEvent.create = realCreate;
    if (realState) Object.defineProperty(mongoose.connection, 'readyState', realState); else delete mongoose.connection.readyState;
  });
  return saved;
}
const unmatchedOnly = (extra = {}) => stripeSession({
  currency: 'cad',
  line_items: { data: [{ price: { id: 'price_gone', unit_amount: 5000, product: {} }, quantity: 1 }] },
  amount_subtotal: 5000, amount_total: 5000, ...extra,
});

test('a paid order held for an unmatched line: the first alert says it is on hold, the "needs you" alert says Paid; an ordinary order is unchanged', async (t) => {
  const saved = captureAdminEvents(t);
  await fulfil(t, unmatchedOnly({ id: 'cs_held_alerts' }));
  assert.equal(saved.find((event) => event.type === 'order.paid').title, 'New order, paid: on hold, needs a check');
  const needsYou = saved.find((event) => event.type === 'payment.unmatched');
  assert.equal(needsYou.title, 'Paid order contains unmatched Stripe item(s): needs you');
  assert.equal(needsYou.body, 'Paid 50.00 CAD, Stripe checkout cs_held_alerts: 1 line item(s) were preserved as blocked placeholders. Review the payment before shipping.');
  saved.length = 0;
  await fulfil(t, stripeSession({ id: 'cs_ordinary_alerts', currency: 'cad' }));
  assert.equal(saved.find((event) => event.type === 'order.paid').title, 'New order, paid');
  assert.equal(saved.find((event) => event.type === 'payment.unmatched'), undefined, 'no "needs you" alert when every line matched');
});

test('a bank debit that is still clearing is not announced as Paid when it holds an unmatched line', async (t) => {
  const saved = captureAdminEvents(t);
  await fulfil(t, unmatchedOnly({
    id: 'cs_held_debit', status: 'complete', payment_status: 'unpaid', payment_method_types: ['acss_debit'],
    metadata: { userId: 'guest', cartSessionId: 'session_0123456789', paymentMethod: 'bank_debit' },
    payment_intent: { id: 'pi_held_debit', status: 'processing', latest_charge: null },
  }));
  const needsYou = saved.find((event) => event.type === 'payment.unmatched');
  assert.equal(needsYou.title, 'Bank debit order contains unmatched Stripe item(s): needs you');
  assert.equal(needsYou.body, 'Bank debit of 50.00 CAD, still clearing, Stripe checkout cs_held_debit: 1 line item(s) were preserved as blocked placeholders. Review the payment before shipping.');
  assert.equal(saved.find((event) => event.type === 'order.paid'), undefined, 'and it is not called a paid sale either');
  assert.equal(saved.find((event) => event.type === 'order.bank_debit_pending').title, 'Bank debit order: payment processing');
});

test('a bank debit that clears while its item mapping is still held stays on hold in the cleared alert', async (t) => {
  const saved = captureAdminEvents(t);
  const order = { _id: 'o-held-cleared', orderNumber: 'RFX-HOLD', fulfillmentBlocked: true, paymentMethod: 'bank_debit', paymentStatus: 'paid', status: 'processing', items: [] };
  await stripeRouter.internalsForTest.announceCleared(order);
  assert.equal(order.fulfillmentBlocked, true, 'settlement does not release the mapping hold');
  assert.equal(saved[0].title, 'Bank debit cleared: on hold, needs a check');
});

test('an unmatched terminal order alert reports the retained line without telling the owner to ship', async (t) => {
  const saved = captureAdminEvents(t);
  const item = { slug: 'stripe-unmatched-price_gone', sku: 'STRIPE-price_gone', name: 'Legacy module', qty: 1, price: 50 };
  await stripeRouter.internalsForTest.announceUnmatched({ _id: 'o-refunded', stripeCheckoutSessionId: 'cs_refunded', status: 'refunded', paymentStatus: 'refunded', total: 50, items: [item] }, '50.00 CAD');
  assert.equal(saved[0].title, 'Refunded order contains unmatched Stripe item(s): needs you');
  assert.match(saved[0].body, /Refunded payment 50\.00 CAD/);
  assert.match(saved[0].body, /1 line item\(s\) were preserved as blocked placeholders/);
  assert.match(saved[0].body, /No shipping action is needed\./);
  assert.doesNotMatch(saved[0].body, /Review the payment before shipping/);
});

test('shipped and delivered unmatched orders keep their terminal state in the alert', async (t) => {
  const saved = captureAdminEvents(t);
  for (const status of ['shipped', 'delivered']) {
    saved.length = 0;
    await stripeRouter.internalsForTest.announceUnmatched({ _id: `o-${status}`, stripeCheckoutSessionId: `cs-${status}`, status, paymentStatus: 'paid', total: 50, items: [{ sku: 'STRIPE-price_gone', qty: 1, price: 50 }] }, '50.00 CAD');
    assert.equal(saved[0].title, 'Shipped order contains unmatched Stripe item(s): needs you');
    assert.match(saved[0].body, /already shipped/);
    assert.doesNotMatch(saved[0].body, /Review the payment before shipping/);
  }
});

test('the note that says which service to buy names international services instead of showing Canada Post codes', async (t) => {
  const order = await fulfil(t, stripeSession({
    id: 'cs_intl',
    metadata: { userId: 'guest', cartSessionId: 'session_0123456789', canadaPostService: 'INT.TP', signature: 'no', shippingCountry: 'DE' },
    shipping_cost: { shipping_rate: { display_name: 'Tracked Packet – International (about 8 business days)' } },
    customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Hauptstr', city: 'Berlin', postal_code: '10115', country: 'DE' } },
  }));
  assert.equal(order.adminNotes, 'SHIPPING: the buyer paid for "Tracked Packet – International (about 8 business days)". When you make the label, buy Tracked Packet – International.');
  const unknown = await fulfil(t, stripeSession({ id: 'cs_odd', metadata: { userId: 'guest', cartSessionId: 'session_0123456789', canadaPostService: 'XYZ.NEW', signature: 'no' } }));
  assert.match(unknown.adminNotes, /buy XYZ\.NEW\.$/, 'a code the shop does not know yet is shown as it is');
});

// ── 5b. the admin order page ──────────────────────────────────────────────────────────────────────
const orderDoc = (over = {}) => ({
  _id: PRODUCT_ID, orderNumber: 'RFX-1', status: 'processing', paymentStatus: 'paid', shippingMethod: 'Flat-Rate Shipping',
  items: [{ product: PRODUCT_ID, sku: 'RAM-1', name: 'RAM', price: 10, qty: 1 }],
  shippingAddress: { firstName: 'A', lastName: 'B', line1: '1 Main', city: 'Toronto', state: 'ON', zip: 'M1P 3T7', country: 'CA' },
  ...over,
});

test('GET /admin/orders/:id returns the order with its shipping preparation', async (t) => {
  const { app, headers } = adminApp(t);
  stub(t, Order, { findById: () => query(orderDoc()) });
  stub(t, Product, { find: () => query([]) });
  const res = await request(app, 'GET', `/api/admin/orders/${PRODUCT_ID}`, undefined, headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.order.shippingPreparation.fulfillment.canCreateLabel, true);
  assert.equal(res.body.order.shippingPreparation.recipient.city, 'Toronto');
});

test('...and still returns the order, without the panel, when the shipping helper fails', async (t) => {
  quiet(t);
  const { app, headers } = adminApp(t);
  stub(t, Order, { findById: () => query(orderDoc()) });
  stub(t, Product, { find: () => { throw new Error('catalog unavailable'); } });
  const res = await request(app, 'GET', `/api/admin/orders/${PRODUCT_ID}`, undefined, headers);
  assert.equal(res.status, 200, 'a failure in the convenience panel must not 500 the order page');
  assert.equal(res.body.order.shippingPreparation, null);
  assert.equal(res.body.order.orderNumber, 'RFX-1');
});

test('admin fulfillment transitions refuse orders blocked by unmatched paid Stripe lines', async (t) => {
  const { app, headers } = adminApp(t);
  stub(t, Order, {
    findById: () => query(orderDoc({ fulfillmentBlocked: true })),
    findOneAndUpdate: () => { throw new Error('must not write a blocked order'); },
  });
  const tracking = await request(app, 'PATCH', `/api/admin/orders/${PRODUCT_ID}/tracking`, { trackingNumber: 'CP1' }, headers);
  assert.equal(tracking.status, 409);
  const shipped = await request(app, 'PATCH', `/api/admin/orders/${PRODUCT_ID}/status`, { status: 'shipped', noTracking: true }, headers);
  assert.equal(shipped.status, 409);
  assert.match(shipped.body.error, /unmatched Stripe item/);
});

// The 409 above says "must be reviewed before fulfillment". Nothing could record that review, so a paid order with one unmatched line
// (the other lines matched, their stock already taken) could never be given a tracking number or marked shipped.
test('the owner can release a blocked order after reviewing it, once, and its tracking can then be saved', async (t) => {
  const { app, headers } = adminApp(t);
  let doc = orderDoc({ fulfillmentBlocked: true, statusHistory: [] });
  const writes = [];
  stub(t, Order, {
    findById: () => query(doc),
    findOneAndUpdate: (filter, update) => {
      writes.push({ filter, update });
      const fits = Object.entries(filter).every(([key, value]) => key === '_id' || key === 'trackingNumber' || doc[key] === value);
      if (!fits) return query(null);
      doc = { ...doc, ...update.$set, statusHistory: [...doc.statusHistory, ...(update.$push?.statusHistory ? [update.$push.statusHistory] : [])] };
      return query(doc);
    },
  });
  const released = await request(app, 'POST', `/api/admin/orders/${PRODUCT_ID}/fulfillment-review`, { note: 'Checked in Stripe' }, headers);
  assert.equal(released.status, 200, 'a review action exists');
  assert.equal(released.body.order.fulfillmentBlocked, false);
  assert.equal(writes[0].filter.fulfillmentBlocked, true, 'only a still-blocked order is released (atomic with the check)');
  assert.match(writes[0].update.$push.statusHistory.note, /reviewed.*Checked in Stripe/);
  const again = await request(app, 'POST', `/api/admin/orders/${PRODUCT_ID}/fulfillment-review`, {}, headers);
  assert.equal(again.status, 409, 'an order that is not blocked has nothing to release');
  const tracking = await request(app, 'PATCH', `/api/admin/orders/${PRODUCT_ID}/tracking`, { trackingNumber: 'CP1' }, headers);
  assert.equal(tracking.status, 200, 'the released order goes on through the normal shipping actions');
});

// The review of the release route (2026-10-20): a POST with no body at all threw on `req.body.note` and answered 500 although the note is
// optional; a cancelled, refunded or unpaid order could be "released", writing a history line that said so.
test('the release works without a body, refuses a bad note, and refuses an order that is no longer paid and open', async (t) => {
  const { app, headers } = adminApp(t);
  const url = `/api/admin/orders/${PRODUCT_ID}/fulfillment-review`;
  let doc = orderDoc({ fulfillmentBlocked: true, statusHistory: [] });
  const writes = [];
  stub(t, Order, {
    findById: () => query(doc),
    findOneAndUpdate: (filter, update) => { writes.push({ filter, update }); doc = { ...doc, ...update.$set }; return query(doc); },
  });
  assert.equal((await request(app, 'POST', url, { note: 'x'.repeat(301) }, headers)).status, 400, 'a note is at most 300 characters');
  assert.equal((await request(app, 'POST', url, { note: ['a'] }, headers)).status, 400, 'and text');
  for (const closed of [{ status: 'cancelled' }, { status: 'refunded', paymentStatus: 'refunded' }, { status: 'pending', paymentStatus: 'pending' }, { status: 'shipped' }]) {
    doc = orderDoc({ fulfillmentBlocked: true, statusHistory: [], ...closed });
    assert.equal((await request(app, 'POST', url, {}, headers)).status, 409, `an order that is ${JSON.stringify(closed)} is not released`);
  }
  assert.equal(writes.length, 0, 'nothing was written for any refused call');
  doc = orderDoc({ fulfillmentBlocked: true, statusHistory: [] });
  const bare = await request(app, 'POST', url, undefined, headers);   // no body at all: the note is optional, so the body is too
  assert.equal(bare.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter.paymentStatus, 'paid', 'the write itself needs a paid order, not only the read before it');
  assert.equal(writes[0].update.$push.statusHistory.note, 'Unmatched Stripe item(s) reviewed by the owner and released for fulfillment');
});

test('the Google callback refuses an unverified email with its own error code, and the page has a message for it', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.match(auth, /if \(!profile\.email\) return fail\('no_email'\);\s+if \(profile\.verified_email === false \|\| profile\.email_verified === false\) return fail\('email_not_verified'\);/);
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/AuthCallback.jsx'), 'utf8');
  assert.match(page, /email_not_verified:\s+'Google has not verified this email address/);
});

// ── 6. startup says whether the duplicate-fulfilment indexes exist ───────────────────────────────
test('server startup reports, read-only, whether the unique payment indexes exist on orders', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(source, /Order\.collection\.indexes\(\)/);
  assert.match(source, /Order collection has NO unique index on/);
  assert.match(source, /Order payment-id unique indexes present/);
  assert.doesNotMatch(source, /createIndex\(/, 'the check must not create or change an index');
});
