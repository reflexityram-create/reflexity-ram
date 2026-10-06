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
    return { status: response.status, body: await response.json() };
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
  stub(t, Order, { findOne: async () => null, create: async (values) => { created.push(values); return { ...values, _id: 'o1', orderNumber: 'RFX-9', stockDecremented: true }; } });
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

test('an order made from a session with an unmatched paid line item says so in its admin notes', async (t) => {
  const order = await fulfil(t, stripeSession({
    id: 'cs_unmatched',
    line_items: { data: [
      { price: { id: 'price_known', unit_amount: 17000, product: {} }, quantity: 1 },
      { price: { id: 'price_gone', unit_amount: 5000, product: {} }, quantity: 1 },
    ] },
    amount_subtotal: 22000, amount_total: 22000,
  }));
  assert.equal(order.items.length, 1, 'only the matched item is on the order');
  assert.match(order.adminNotes, /^REVIEW: 1 paid line item could not be matched to a product and is NOT on this order \(Stripe price price_gone\)\. Check the Stripe payment before shipping\.$/m);
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
