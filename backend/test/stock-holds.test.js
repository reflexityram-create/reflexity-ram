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
  const seen = { sessions: 0, holds: [], releases: [] };
  stripeRouter.setCheckoutDependenciesForTest({
    ensurePrice: async () => 'price_ddr4_16gb',
    ensureCoupon: async () => 'coupon_test',
    createSession: async () => { seen.sessions += 1; return { id: 'cs_hold', url: 'https://stripe.test/hold' }; },
    holdStock: async (request) => { seen.holds.push(request); return { ok: true, held: true }; },
    releaseHold: async (owner) => { seen.releases.push(owner); return 1; },
    ...deps,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/stripe', stripeRouter);
  return { app, seen };
}

test('checkout sets the cart aside before it sends the buyer to Stripe, for the standard time, under the guest\'s cart session', async (t) => {
  const { app, seen } = routeHarness(t);
  const response = await checkout(app);
  assert.equal(response.status, 200);
  assert.equal(seen.sessions, 1);
  assert.deepEqual(seen.holds, [{ owner: 's:session_0123456789', lines: [{ product: 'product-id', name: '16GB DDR4', qty: 2 }], minutes: 30 }]);
  assert.deepEqual(seen.releases, [], 'nothing is given back when the session was made');
});

test('a bank debit is held for an hour', async (t) => {
  process.env.BANK_DEBIT_ENABLED = 'true';
  t.after(() => { delete process.env.BANK_DEBIT_ENABLED; });
  const { app, seen } = routeHarness(t);
  assert.equal((await checkout(app, { 'x-session-id': 'session_0123456789' }, { paymentMethod: 'bank_debit' })).status, 200);
  assert.equal(seen.holds[0].minutes, 60);
});

test('when the unit is held for someone else the buyer gets a 409 with the sentence, and Stripe is never called', async (t) => {
  const { app, seen } = routeHarness(t, { holdStock: async () => ({ ok: false, status: 409, message: '"16GB DDR4" is being checked out by another buyer right now. It frees up within 12 minutes if they do not finish. Try again then.' }) });
  const response = await checkout(app);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /is being checked out by another buyer right now/);
  assert.equal(seen.sessions, 0, 'no Stripe session was made');
});

test('if the session cannot be made after the hold, the hold is given back and the buyer sees the ordinary error', async (t) => {
  const quiet = console.error; console.error = () => {}; t.after(() => { console.error = quiet; });
  const { app, seen } = routeHarness(t, { createSession: async () => { throw new Error('Stripe is down'); } });
  const response = await checkout(app);
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Failed to start checkout');
  assert.deepEqual(seen.releases, ['s:session_0123456789']);
});

test('a hold that fails never stops the sale: the checkout goes ahead and the failure is logged', async (t) => {
  const lines = [];
  const original = console.error; console.error = (...args) => lines.push(args.join(' ')); t.after(() => { console.error = original; });
  const { app, seen } = routeHarness(t, { holdStock: async () => { throw new Error('database blip'); } });
  const response = await checkout(app);
  assert.equal(response.status, 200);
  assert.equal(seen.sessions, 1);
  assert.deepEqual(seen.releases, [], 'no hold exists, so none is given back');
  assert.match(lines.join('\n'), /Stock hold failed; checkout continues without it: database blip/);
});

test('a checkout that fails validation before the hold (bad payment method) never holds anything', async (t) => {
  const { app, seen } = routeHarness(t);
  const response = await checkout(app, { 'x-session-id': 'session_0123456789' }, { paymentMethod: 'bitcoin' });
  assert.equal(response.status, 400);
  assert.deepEqual(seen.holds, []);
});

test('the test hook leaves holds OFF by default, so the many checkout tests that have no database do not wait on one', async (t) => {
  const { app } = routeHarness(t, { holdStock: undefined, releaseHold: undefined });
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
