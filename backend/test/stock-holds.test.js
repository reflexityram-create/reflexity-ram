// Stock holds without a database: the rules that run in CI. The real-database behaviour (one winner among simultaneous buyers, expiry,
// the whole flow) is in stock-holds.integration.test.js, which needs MONGODB_TEST_URI.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } } };
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_stock_holds_unit';
process.env.JWT_SECRET ||= 'stock-holds-unit-secret';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const stripeRouter = require('../src/routes/stripe');
const { placeEtransferOrder } = require('../src/utils/etransfer');
const { paymentMethodSettings } = require('../src/utils/paymentMethods');
const { decrementStockForOrder, InsufficientStockError } = require('../src/utils/stock');
const holds = require('../src/utils/stockHolds');

const NOW = new Date('2026-10-14T12:00:00Z');
const MINUTE = 60 * 1000;

// ── the small rules ───────────────────────────────────────────────────────────────────────────────────────────
test('how long a checkout is held: 30 minutes, an hour for a bank debit, adjustable only within sane bounds', () => {
  const original = process.env.CHECKOUT_STOCK_HOLD_MINUTES;
  try {
    delete process.env.CHECKOUT_STOCK_HOLD_MINUTES;
    assert.equal(holds.holdMinutes(), 30);
    assert.equal(holds.holdMinutes({ bankDebit: true }), 60);
    process.env.CHECKOUT_STOCK_HOLD_MINUTES = '45';
    assert.equal(holds.holdMinutes(), 45);
    assert.equal(holds.holdMinutes({ bankDebit: true }), 60);
    process.env.CHECKOUT_STOCK_HOLD_MINUTES = '90';
    assert.equal(holds.holdMinutes({ bankDebit: true }), 90, 'a bank debit never gets less than the card hold');
    for (const bad of ['0', '2', '-5', '9999', 'abc', '']) {
      process.env.CHECKOUT_STOCK_HOLD_MINUTES = bad;
      assert.equal(holds.holdMinutes(), 30, `"${bad}" falls back to the default`);
    }
  } finally {
    if (original === undefined) delete process.env.CHECKOUT_STOCK_HOLD_MINUTES; else process.env.CHECKOUT_STOCK_HOLD_MINUTES = original;
  }
});

test('a hold belongs to the account, else the guest cart session, else nobody', () => {
  assert.equal(holds.ownerKey({ userId: '64b7f0c2a1b2c3d4e5f60719', sessionId: 'session_0123456789abcdef' }), 'u:64b7f0c2a1b2c3d4e5f60719', 'a signed-in buyer is the account, not the browser');
  assert.equal(holds.ownerKey({ sessionId: 'session_0123456789abcdef' }), 's:session_0123456789abcdef');
  assert.equal(holds.ownerKey({}), null);
  assert.equal(holds.ownerKey(), null);
});

test('what a buyer is told when stock is held for someone else', () => {
  const live = (owner, qty, minutes) => ({ owner, qty, expiresAt: new Date(NOW.getTime() + minutes * MINUTE) });
  const say = (product, qty) => holds.shortageMessage({ name: 'Hynix 64GB', qty }, holds.availabilityOf(product, 's:me', NOW), NOW);
  // all of it is set aside for someone else, 12 minutes left on their hold
  assert.equal(say({ stockQuantity: 1, stockHolds: [live('s:other', 1, 12)] }, 1), '"Hynix 64GB" is being checked out by another buyer right now. It frees up within 12 minutes if they do not finish. Try again then.');
  // one minute left reads singular
  assert.match(say({ stockQuantity: 1, stockHolds: [live('s:other', 1, 1)] }, 1), /within 1 minute if they do not finish/);
  // part of it is free
  assert.equal(say({ stockQuantity: 5, stockHolds: [live('s:other', 3, 7)] }, 3), 'Only 2 of "Hynix 64GB" can be set aside right now: another buyer is checking out with the rest. It frees up within 7 minutes if they do not finish. Lower the quantity, or try again then.');
  // the buyer's OWN hold and a lapsed hold are not in the way
  const mine = { stockQuantity: 1, stockHolds: [live('s:me', 1, 20), { owner: 's:old', qty: 1, expiresAt: new Date(NOW.getTime() - MINUTE) }] };
  assert.deepEqual(holds.availabilityOf(mine, 's:me', NOW), { stock: 1, held: 0, available: 1, freeAt: null });
  // nothing held by anyone: it is just not there
  assert.equal(say({ stockQuantity: 0 }, 1), '"Hynix 64GB" just sold out.');
  assert.equal(say({ stockQuantity: 2 }, 3), 'Only 2 units of "Hynix 64GB" available.');
  assert.equal(say({ stockQuantity: 1 }, 2), 'Only 1 unit of "Hynix 64GB" available.');
  // the soonest hold to run out decides the wait
  assert.equal(holds.availabilityOf({ stockQuantity: 2, stockHolds: [live('s:a', 1, 25), live('s:b', 1, 4)] }, 's:me', NOW).freeAt.getTime(), NOW.getTime() + 4 * MINUTE);
});

// ── how the update is sent to the database (a stub records it: the real behaviour is in the integration test) ───────────────
function recordingModel(results) {
  const calls = [];
  return {
    calls,
    findOneAndUpdate: async (filter, update, options) => { calls.push({ op: 'hold', filter, update, options }); return results.shift(); },
    updateMany: async (filter, update, options) => { calls.push({ op: 'release', filter, update, options }); return { modifiedCount: 1 }; },
    findById: () => ({ select: () => ({ lean: async () => ({ name: 'Hynix 64GB', stockQuantity: 1, stockHolds: [{ owner: 's:other', qty: 1, expiresAt: new Date(NOW.getTime() + 5 * MINUTE) }] }) }) }),
  };
}

test('the hold is ONE conditional pipeline update that does not touch updatedAt, and Mongoose is told it is a pipeline', async () => {
  const ProductModel = recordingModel([{ _id: 'p1' }]);
  const result = await holds.holdStockForCheckout({ owner: 's:me', lines: [{ product: 'p1', name: 'X', qty: 2 }], minutes: 30, now: NOW, ProductModel });
  assert.deepEqual(result, { ok: true, held: true, expiresAt: new Date(NOW.getTime() + 30 * MINUTE) });
  const [call] = ProductModel.calls;
  assert.equal(call.filter._id, 'p1');
  assert.ok(call.filter.$expr, 'the "is enough left" test is part of the same update, not a separate read');
  assert.ok(Array.isArray(call.update), 'a pipeline update');
  assert.equal(call.options.updatePipeline, true, 'Mongoose refuses an array update without this');
  assert.equal(call.options.timestamps, false, 'a checkout attempt is not a product change (the sitemap lastmod reads updatedAt)');
  assert.deepEqual(call.update[0].$set.stockHolds.$concatArrays[1], [{ owner: 's:me', qty: 2, expiresAt: new Date(NOW.getTime() + 30 * MINUTE) }]);
});

test('a product named twice in one cart is held once, with the quantities added', async () => {
  const ProductModel = recordingModel([{ _id: 'p1' }]);
  await holds.holdStockForCheckout({ owner: 's:me', lines: [{ product: 'p1', name: 'X', qty: 1 }, { product: 'p1', name: 'X', qty: 2 }], now: NOW, ProductModel });
  assert.equal(ProductModel.calls.length, 1);
  assert.equal(ProductModel.calls[0].update[0].$set.stockHolds.$concatArrays[1][0].qty, 3);
});

test('when a line cannot be had, what was held is given back and the buyer gets the sentence', async () => {
  const ProductModel = recordingModel([{ _id: 'p1' }, null]);
  const result = await holds.holdStockForCheckout({ owner: 's:me', lines: [{ product: 'p1', name: 'A', qty: 1 }, { product: 'p2', name: 'B', qty: 1 }], now: NOW, ProductModel });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /^"Hynix 64GB" is being checked out by another buyer right now\./);
  const release = ProductModel.calls.find((call) => call.op === 'release');
  assert.ok(release, 'the first line was released again');
  assert.deepEqual(release.filter, { 'stockHolds.owner': 's:me' });
  assert.equal(release.options.updatePipeline, true);
  assert.equal(release.options.timestamps, false);
});

test('a write that throws part-way leaves nothing held: the lines already held are given back before the error is raised', async () => {
  const calls = [];
  let n = 0;
  const ProductModel = {
    findOneAndUpdate: async () => { n += 1; if (n === 2) throw new Error('connection lost'); return { _id: `p${n}` }; },
    updateMany: async (filter, update, options) => { calls.push({ filter, update, options }); return { modifiedCount: 1 }; },
    findById: () => ({ select: () => ({ lean: async () => null }) }),
  };
  await assert.rejects(
    () => holds.holdStockForCheckout({ owner: 's:me', lines: [{ product: 'p1', name: 'A', qty: 1 }, { product: 'p2', name: 'B', qty: 1 }], now: NOW, ProductModel }),
    /connection lost/,
  );
  assert.equal(calls.length, 1, 'the first line was released again');
  assert.deepEqual(calls[0].filter, { 'stockHolds.owner': 's:me' });
});

test('no owner (no account and no cart session) means no hold, and nothing is touched', async () => {
  const ProductModel = recordingModel([]);
  assert.deepEqual(await holds.holdStockForCheckout({ owner: null, lines: [{ product: 'p1', name: 'A', qty: 1 }], ProductModel }), { ok: true, held: false });
  assert.equal(await holds.releaseCheckoutHold(null, { ProductModel }), 0);
  assert.equal(ProductModel.calls.length, 0);
});

test('the product field that stores holds is never returned unless asked for', () => {
  const field = Product.schema.path('stockHolds');
  assert.equal(field.options.select, false);
  assert.equal(Product.schema.paths.stockHolds.options.default, undefined);
});

test('the oversold clamp is sent as a pipeline update (a stub hid that Mongoose refuses it otherwise), and the hold code never touches stock', async (t) => {
  const seen = [];
  const original = { startSession: Order.startSession, findOneAndUpdate: Order.findOneAndUpdate, updateOne: Order.updateOne, pFind: Product.findOneAndUpdate, pById: Product.findById, pUpd: Product.findByIdAndUpdate };
  t.after(() => { Order.startSession = original.startSession; Order.findOneAndUpdate = original.findOneAndUpdate; Order.updateOne = original.updateOne; Product.findOneAndUpdate = original.pFind; Product.findById = original.pById; Product.findByIdAndUpdate = original.pUpd; });
  const quiet = console.error; console.error = () => {}; t.after(() => { console.error = quiet; });
  Order.startSession = async () => ({ withTransaction: async (work) => { await work(); }, endSession: async () => {} });
  Order.findOneAndUpdate = async () => ({ _id: 'o1', orderNumber: 'RFX-1', items: [{ product: 'p1', sku: 'RAM-1', qty: 2 }] });
  Order.updateOne = async () => ({});
  let calls = 0;
  Product.findOneAndUpdate = async (filter, update, options) => { calls += 1; seen.push({ filter, update, options }); return calls === 1 ? null : { stockQuantity: 1 }; };
  Product.findById = () => ({ select: () => ({ session: () => ({ then: (resolve) => resolve({ stockQuantity: 0 }) }), then: (resolve) => resolve({ stockQuantity: 0 }) }) });
  Product.findByIdAndUpdate = async () => ({});
  await decrementStockForOrder({ _id: 'o1' });
  const clamp = seen[1];
  assert.ok(Array.isArray(clamp.update), 'the clamp is a pipeline');
  assert.equal(clamp.options.updatePipeline, true);
});

// ── the checkout route ────────────────────────────────────────────────────────────────────────────────────────────
const productQuery = (items) => ({ then: (resolve, reject) => Promise.resolve(items).then(resolve, reject) });
async function checkout(app, headers = { 'x-session-id': 'session_0123456789' }, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/create-checkout-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}),
    });
    return { status: response.status, body: await response.json() };
  } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
}
function routeHarness(t, deps = {}, { qty = 2 } = {}) {
  const originals = { find: Product.find, cartFindOne: Cart.findOne };
  t.after(() => { Product.find = originals.find; Cart.findOne = originals.cartFindOne; stripeRouter.setCheckoutDependenciesForTest(); });
  Product.find = () => productQuery([{ _id: 'product-id', slug: 'ddr4-16gb', name: '16GB DDR4', price: 135, stock: 'in', stockQuantity: 10, isActive: true, line: 'Server' }]);
  Cart.findOne = async () => ({ items: [{ product: 'product-id', slug: 'ddr4-16gb', qty }] });
  const seen = { sessions: 0, holds: [], releases: [], expired: [], order: [] };
  stripeRouter.setCheckoutDependenciesForTest({
    ensurePrice: async () => 'price_ddr4_16gb',
    ensureCoupon: async () => 'coupon_test',
    createSession: async () => { seen.sessions += 1; seen.order.push('session'); return { id: 'cs_hold', url: 'https://stripe.test/hold' }; },
    holdStock: async (request) => { seen.order.push('hold'); seen.holds.push(request); return { ok: true, held: true }; },
    releaseHold: async (owner) => { seen.releases.push(owner); return 1; },
    expireSession: async (id) => { seen.expired.push(id); return {}; },
    ...deps,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/stripe', stripeRouter);
  return { app, seen };
}

test('checkout sets the cart aside once the Stripe page exists, for the standard time, under the guest\'s cart session', async (t) => {
  const { app, seen } = routeHarness(t);
  const response = await checkout(app);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { url: 'https://stripe.test/hold', sessionId: 'cs_hold' });
  assert.equal(seen.sessions, 1);
  assert.deepEqual(seen.order, ['session', 'hold'], 'the page is made first, so a Stripe failure can never touch a hold');
  assert.deepEqual(seen.holds, [{ owner: 's:session_0123456789', lines: [{ product: 'product-id', name: '16GB DDR4', qty: 2 }], minutes: 30 }]);
  assert.deepEqual(seen.releases, []);
  assert.deepEqual(seen.expired, []);
});

test('a bank debit is held for an hour', async (t) => {
  process.env.BANK_DEBIT_ENABLED = 'true';
  t.after(() => { delete process.env.BANK_DEBIT_ENABLED; });
  const { app, seen } = routeHarness(t);
  assert.equal((await checkout(app, { 'x-session-id': 'session_0123456789' }, { paymentMethod: 'bank_debit' })).status, 200);
  assert.equal(seen.holds[0].minutes, 60);
});

test('when the unit is held for someone else the buyer gets a 409 with the sentence and NO link to pay, and the unused page is closed', async (t) => {
  const { app, seen } = routeHarness(t, { holdStock: async () => ({ ok: false, status: 409, message: '"16GB DDR4" is being checked out by another buyer right now. It frees up within 12 minutes if they do not finish. Try again then.' }) });
  const response = await checkout(app);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /is being checked out by another buyer right now/);
  assert.equal('url' in response.body, false, 'the buyer is not given a page to pay on');
  assert.deepEqual(seen.expired, ['cs_hold'], 'the page nobody was given is closed (tidiness: nobody could have reached it)');
});

test('closing the unused page can fail without changing what the buyer sees', async (t) => {
  const { app } = routeHarness(t, {
    holdStock: async () => ({ ok: false, status: 409, message: 'held' }),
    expireSession: async () => { throw new Error('Stripe is slow'); },
  });
  const response = await checkout(app);
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'held');
});

test('a Stripe failure never touches a hold: nothing is held yet, so an earlier page of the same buyer keeps its own', async (t) => {
  const quiet = console.error; console.error = () => {}; t.after(() => { console.error = quiet; });
  const { app, seen } = routeHarness(t, { createSession: async () => { throw new Error('Stripe is down'); } });
  const response = await checkout(app);
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Failed to start checkout');
  assert.deepEqual(seen.holds, [], 'no hold was asked for');
  assert.deepEqual(seen.releases, [], 'and none was given back');
});

test('a hold that fails never stops the sale: the buyer is sent to pay and the failure is logged', async (t) => {
  const lines = [];
  const original = console.error; console.error = (...args) => lines.push(args.join(' ')); t.after(() => { console.error = original; });
  const { app, seen } = routeHarness(t, { holdStock: async () => { throw new Error('database blip'); } });
  const response = await checkout(app);
  assert.equal(response.status, 200);
  assert.equal(response.body.url, 'https://stripe.test/hold');
  assert.equal(seen.sessions, 1);
  assert.deepEqual(seen.expired, [], 'the page is kept: the buyer is on it');
  assert.match(lines.join('\n'), /Stock hold failed; checkout continues without it: database blip/);
});

test('a checkout that fails validation (bad payment method) makes no page and holds nothing', async (t) => {
  const { app, seen } = routeHarness(t);
  const response = await checkout(app, { 'x-session-id': 'session_0123456789' }, { paymentMethod: 'bitcoin' });
  assert.equal(response.status, 400);
  assert.deepEqual(seen.holds, []);
  assert.equal(seen.sessions, 0);
});

test('the test hook leaves holds OFF by default, so the many checkout tests that have no database do not wait on one', async (t) => {
  const { app } = routeHarness(t, { holdStock: undefined, releaseHold: undefined, expireSession: undefined });
  assert.equal((await checkout(app)).status, 200);
});

// ── the e-Transfer lane ───────────────────────────────────────────────────────────────────────────────────────────
function etransferHarness({ user = null, sessionId = 'sess_test_0123456789abcdef' } = {}) {
  const seen = { options: null };
  const deps = {
    Cart: { findOne: async () => ({ _id: 'c1', updatedAt: NOW, items: [{ product: 'p1', qty: 1 }] }), updateOne: async () => ({ modifiedCount: 1 }) },
    Order: { countDocuments: async () => 0 },
    resolveLines: async () => [{ item: { qty: 1 }, product: { _id: 'p1', slug: 's', sku: 'S', name: 'N', price: 100, stockQuantity: 5, stock: 'in', images: [] } }],
    createOrder: async (data, options) => { seen.options = options; await options.beforeCommit({}); return { ...data, _id: 'o1', orderNumber: 'RFX-T-1' }; },
    sendNotice: async () => {}, record: async () => {},
    settings: paymentMethodSettings({ ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' }),
  };
  const buyer = { firstName: 'Sam', lastName: 'Buyer', email: 'sam@example.com', phone: '416 555 0123' };
  const address = { line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };
  return { seen, place: () => placeEtransferOrder({ user, sessionId, buyer, address, shipping: {}, now: NOW }, deps) };
}

test('an e-Transfer order is placed under the buyer\'s hold identity, so it respects other buyers\' holds and gives back its own', async () => {
  const guest = etransferHarness();
  await guest.place();
  assert.equal(guest.seen.options.holdOwner, 's:sess_test_0123456789abcdef');
  const member = etransferHarness({ user: { _id: '64b7f0c2a1b2c3d4e5f60719', email: 'member@example.com' } });
  await member.place();
  assert.equal(member.seen.options.holdOwner, 'u:64b7f0c2a1b2c3d4e5f60719');
});

test('an e-Transfer blocked only by someone else\'s hold says so, not "sold out"', () => {
  const held = new InsufficientStockError({ name: 'Hynix 64GB' }, 0, { held: true });
  assert.equal(held.publicMessage, '"Hynix 64GB" is being checked out by another buyer right now. Try again in a few minutes.');
  assert.equal(new InsufficientStockError({ name: 'Hynix 64GB' }, 1, { held: true }).publicMessage, 'Only 1 of "Hynix 64GB" can be reserved right now: another buyer is checking out with the rest. Try again in a few minutes.');
  assert.equal(new InsufficientStockError({ name: 'Hynix 64GB' }, 0).publicMessage, '"Hynix 64GB" just sold out.', 'the plain messages are unchanged');
  assert.equal(new InsufficientStockError({ name: 'Hynix 64GB' }, 2).publicMessage, 'Only 2 of "Hynix 64GB" are left now. Update your cart and try again.');
});

// ── the payment is what releases the hold ─────────────────────────────────────────────────────────────────────────
test('after the order is made and the stock taken the hold is released, in that order; a refunded-first payment releases it too', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/stripe.js'), 'utf8');
  const decrement = source.indexOf('await stockDecrementer(order);');
  const release = source.indexOf("await releaseHoldsOf(userId, session.metadata?.cartSessionId);", decrement);
  assert.ok(decrement > 0 && release > decrement, 'the release comes after the stock is taken');
  assert.match(source, /await releaseHoldsOf\(userId, session\.metadata\?\.cartSessionId\);   \/\/ no stock was taken/);
});

// ── what follows the order: the hold given back and the cart emptied, even when the first attempt stopped before them ───────────────
function recoveryHarness(t, { order = {}, session = { metadata: { userId: 'guest', cartSessionId: 'session_0123456789' } }, retrieveFails = false } = {}) {
  const calls = [];
  const original = { findOne: Order.findOne, orderUpdateOne: Order.updateOne, cartUpdateOne: Cart.updateOne };
  t.after(() => { Order.findOne = original.findOne; Order.updateOne = original.orderUpdateOne; Cart.updateOne = original.cartUpdateOne; stripeRouter.setCheckoutDependenciesForTest(); });
  const existing = {
    _id: 'o1', orderNumber: 'RFX-RECOVER', stripeCheckoutSessionId: 'cs_recover', paymentStatus: 'paid', status: 'processing',
    stockDecremented: true, postOrderPending: true, createdAt: new Date('2026-10-14T12:00:00Z'), ...order,
  };
  Order.findOne = async () => existing;
  Order.updateOne = async (filter, update) => { calls.push(['order.updateOne', filter, update]); return { modifiedCount: 1 }; };
  Cart.updateOne = async (filter, update) => { calls.push(['cart.updateOne', filter, update]); return { modifiedCount: 1 }; };
  stripeRouter.setCheckoutDependenciesForTest({
    retrieveSession: async (id) => { calls.push(['retrieve', id]); if (retrieveFails) throw new Error('Stripe is down'); return session; },
    releaseHold: async (owner) => { calls.push(['release', owner]); return 1; },
  });
  return { calls, existing };
}

test('a retry of an order that was saved but never finished gives the guest\'s hold back and empties their untouched cart, then clears the mark', async (t) => {
  const { calls, existing } = recoveryHarness(t);
  const result = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_recover');
  assert.equal(result, existing);
  assert.deepEqual(calls, [
    ['retrieve', 'cs_recover'],
    ['release', 's:session_0123456789'],
    ['cart.updateOne', { sessionId: 'session_0123456789', updatedAt: { $lte: existing.createdAt } }, { $set: { items: [], discount: 0 }, $unset: { couponCode: '' } }],
    ['order.updateOne', { _id: 'o1' }, { $unset: { postOrderPending: '' } }],
  ], 'only a cart nobody touched since the order is emptied (the buyer may already be shopping again)');
});

test('in a retry the stock is taken first and the hold given back after, as in the first attempt', async (t) => {
  const { calls } = recoveryHarness(t, { order: { stockDecremented: false } });
  const original = require('../src/utils/stock');
  stripeRouter.setCheckoutDependenciesForTest({
    retrieveSession: async () => ({ metadata: { userId: 'guest', cartSessionId: 'session_0123456789' } }),
    releaseHold: async (owner) => { calls.push(['release', owner]); return 1; },
    decrementStock: async () => { calls.push(['decrement']); return true; },
  });
  // ensureCriticalFulfillmentEffects calls the stock helper it imported (not the injected one), so check through the order of effects it makes
  assert.ok(original.shouldDecrementStockForFulfillment({ stockDecremented: false, status: 'processing' }));
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/stripe.js'), 'utf8');
  const recovery = source.slice(source.indexOf('const ensureCriticalFulfillmentEffects'), source.indexOf('// A session that is paid, or that needed no payment'));
  assert.ok(recovery.indexOf('await decrementStockForOrder(order)') > 0 && recovery.indexOf('await decrementStockForOrder(order)') < recovery.indexOf('await finishPostOrderSteps(order)'), 'decrement, then the hold is given back');
});

test('the same for a signed-in buyer: their account\'s hold and cart', async (t) => {
  const { calls } = recoveryHarness(t, { session: { metadata: { userId: '64b7f0c2a1b2c3d4e5f60719', cartSessionId: '' } } });
  await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_recover');
  assert.deepEqual(calls.filter(([name]) => name === 'release'), [['release', 'u:64b7f0c2a1b2c3d4e5f60719']]);
  assert.deepEqual(calls.find(([name]) => name === 'cart.updateOne')[1].user, '64b7f0c2a1b2c3d4e5f60719');
});

test('an order that is already finished is left alone: no Stripe call, no cart touched', async (t) => {
  const { calls } = recoveryHarness(t, { order: { postOrderPending: undefined } });
  await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_recover');
  assert.deepEqual(calls, []);
});

test('if the retry cannot reach Stripe it says so and returns the order unchanged, leaving the mark for the next retry', async (t) => {
  const lines = [];
  const original = console.error; console.error = (...args) => lines.push(args.join(' ')); t.after(() => { console.error = original; });
  const { calls, existing } = recoveryHarness(t, { retrieveFails: true });
  assert.equal(await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_recover'), existing);
  assert.deepEqual(calls.map(([name]) => name), ['retrieve'], 'nothing was released or emptied, and the mark stays');
  assert.match(lines.join('\n'), /Finishing the steps after order RFX-RECOVER failed \(a retry will try again\): Stripe is down/);
});

test('a new order is saved marked as unfinished, and the mark is cleared only after the stock is taken, the hold released and the cart emptied', async (t) => {
  const calls = [];
  const original = { pFindOne: Product.findOne, oFindOne: Order.findOne, create: Order.create, cart: Cart.findOneAndUpdate, updateOne: Order.updateOne };
  t.after(() => { Product.findOne = original.pFindOne; Order.findOne = original.oFindOne; Order.create = original.create; Cart.findOneAndUpdate = original.cart; Order.updateOne = original.updateOne; stripeRouter.setCheckoutDependenciesForTest(); });
  Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-64gb', sku: 'DDR4-64', name: '64GB DDR4', images: [] });
  Order.findOne = async () => null;
  Order.create = async (values) => { calls.push(['create', values.postOrderPending]); return { ...values, _id: 'o9', orderNumber: 'RFX-NEW' }; };
  Cart.findOneAndUpdate = async () => { calls.push(['cart']); };
  Order.updateOne = async (filter, update) => { calls.push(['unmark', update]); return { modifiedCount: 1 }; };
  stripeRouter.setCheckoutDependenciesForTest({
    retrieveSession: async () => ({
      id: 'cs_new', status: 'complete', payment_status: 'paid', metadata: { userId: 'guest', cartSessionId: 'session_0123456789' },
      line_items: { data: [{ price: { id: 'price_x', unit_amount: 50000 }, quantity: 1 }] }, amount_subtotal: 50000, amount_total: 51400,
      total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 },
      customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Toronto', state: 'ON', postal_code: 'M5V 1E3', country: 'CA' } },
      payment_intent: 'pi_new',
    }),
    decrementStock: async () => { calls.push(['decrement']); return true; },
    releaseHold: async (owner) => { calls.push(['release', owner]); return 1; },
  });
  const quiet = console.log; console.log = () => {}; t.after(() => { console.log = quiet; });
  await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_new');
  const names = calls.map(([name]) => name);
  assert.deepEqual(names.slice(0, 5), ['create', 'decrement', 'release', 'cart', 'unmark']);
  assert.equal(calls[0][1], true, 'saved marked as unfinished');
  assert.deepEqual(calls.find(([name]) => name === 'unmark')[1], { $unset: { postOrderPending: '' } });
});
