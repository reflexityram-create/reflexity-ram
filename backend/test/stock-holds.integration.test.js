// Stock holds and zero-total checkouts on a REAL MongoDB replica set (the atomic update and the transactions are what is being
// tested). Skipped unless MONGODB_TEST_URI is set; it drops that database. Recipe: see the header of payments-mongo.integration.test.js.
//   MONGODB_TEST_URI='mongodb://127.0.0.1:27019/rfx_holds_test?directConnection=true' node --test backend/test/stock-holds.integration.test.js
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
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { sent.push(message); return { data: { id: `email_${sent.length}` }, error: null }; } }; } } },
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'stock-holds-secret',
  FRONTEND_URL: 'https://reflexityram.com',
  STRIPE_SECRET_KEY: 'sk_test_stock_holds',
  STRIPE_WEBHOOK_SECRET: 'whsec_stock_holds',
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
const { generateAccessToken } = require('../src/middleware/auth');
const { placeEtransferOrder, EtransferError } = require('../src/utils/etransfer');
const { holdStockForCheckout, releaseCheckoutHold, ownerKey, holdMinutes } = require('../src/utils/stockHolds');

const MINUTE = 60 * 1000;
const A = 'session_buyer_a_0123456789';
const B = 'session_buyer_b_0123456789';
const BUYER = { firstName: 'Sam', lastName: 'Buyer', email: 'sam@example.com', phone: '+14165550123' };
const ADDRESS = { line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };

let counter = 0;
async function seedProduct(extra = {}) {
  counter += 1;
  return Product.create({
    slug: `ddr4-16gb-${counter}`, sku: `D4-16-${counter}`, name: `16GB DDR4 ECC RDIMM #${counter}`, line: 'Server', generation: 'DDR4', formFactor: 'RDIMM',
    capacity: 16, capacityLabel: '16GB', speed: 2666, speedLabel: '2666 MT/s', condition: 'Used', warranty: '1 year',
    price: 135, stockQuantity: 1, isActive: true, stripePriceId: `price_${counter}`, stripePriceAmount: 13500, stripePriceCurrency: 'cad', ...extra,
  });
}
const seedCart = (product, qty, sessionId) => Cart.create({
  sessionId, items: [{ product: product._id, slug: product.slug, sku: product.sku, name: product.name, price: product.price, qty }],
});
const holdsOf = async (product) => (await Product.findById(product._id).select('+stockHolds').lean()).stockHolds || [];
const stockOf = async (product) => (await Product.findById(product._id).lean()).stockQuantity;
const want = (product, qty = 1) => [{ product: product._id, name: product.name, qty }];

test('stock holds on a real MongoDB replica set', { skip }, async (root) => {
  await mongoose.connect(URI, { autoIndex: true });
  await mongoose.connection.dropDatabase();
  await Promise.all([Order, Product, Cart, User, AdminEvent].map((m) => m.init()));
  const reset = async () => {
    await Promise.all([Order, Product, Cart, User, AdminEvent].map((m) => m.deleteMany({})));
    sent.length = 0;
    stripeRouter.setCheckoutDependenciesForTest();
  };
  root.after(async () => { stripeRouter.setCheckoutDependenciesForTest(); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  // ── the hold itself ──────────────────────────────────────────────────────────────────────────────────────────
  await root.test('twelve buyers ask for the last unit at the same moment: exactly one gets it', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    const owners = Array.from({ length: 12 }, (_, n) => `s:buyer_${n}_0123456789abcdef`);
    const results = await Promise.all(owners.map((owner) => holdStockForCheckout({ owner, lines: want(product) })));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.ok)));
    const refused = results.filter((r) => !r.ok);
    assert.equal(refused.length, 11);
    assert.ok(refused.every((r) => r.status === 409 && /is being checked out by another buyer right now/.test(r.message)), refused[0].message);
    assert.equal((await holdsOf(product)).length, 1);
    assert.equal(await stockOf(product), 1, 'a hold changes no stock number');
  });

  await root.test('three units, five buyers wanting one each at once: three get one, two are refused', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    const results = await Promise.all(Array.from({ length: 5 }, (_, n) => holdStockForCheckout({ owner: `s:five_${n}_0123456789abcdef`, lines: want(product) })));
    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.equal((await holdsOf(product)).reduce((n, h) => n + h.qty, 0), 3);
  });

  await root.test('a buyer asking again (a second try, the back button) replaces their own hold and never blocks themselves', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 2 });
    const owner = `s:${A}`;
    assert.equal((await holdStockForCheckout({ owner, lines: want(product, 2) })).ok, true);
    assert.equal((await holdStockForCheckout({ owner, lines: want(product, 2) })).ok, true, 'their own hold does not count against them');
    const holds = await holdsOf(product);
    assert.deepEqual(holds.map((h) => [h.owner, h.qty]), [[owner, 2]], 'one hold, not two');
    assert.equal((await holdStockForCheckout({ owner, lines: want(product, 1) })).ok, true);
    assert.deepEqual((await holdsOf(product)).map((h) => h.qty), [1], 'the new quantity replaced the old');
  });

  await root.test('a hold runs out by itself: after its time another buyer can have the unit, and the lapsed hold is dropped', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    const start = new Date();
    assert.equal((await holdStockForCheckout({ owner: 's:first', lines: want(product), minutes: 30, now: start })).ok, true);
    const tooSoon = await holdStockForCheckout({ owner: 's:second', lines: want(product), now: new Date(start.getTime() + 29 * MINUTE) });
    assert.equal(tooSoon.ok, false);
    assert.match(tooSoon.message, /frees up within 1 minute/);
    const later = await holdStockForCheckout({ owner: 's:second', lines: want(product), now: new Date(start.getTime() + 31 * MINUTE) });
    assert.equal(later.ok, true);
    assert.deepEqual((await holdsOf(product)).map((h) => h.owner), ['s:second'], 'the lapsed hold was cleaned out');
  });

  await root.test('a cart of two products is all or nothing: when the second cannot be had, nothing stays held', async () => {
    await reset();
    const plenty = await seedProduct({ stockQuantity: 5 });
    const scarce = await seedProduct({ stockQuantity: 1 });
    assert.equal((await holdStockForCheckout({ owner: 's:other', lines: want(scarce) })).ok, true);
    const result = await holdStockForCheckout({ owner: 's:me', lines: [...want(plenty, 2), ...want(scarce)] });
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`"${scarce.name}" is being checked out by another buyer`));
    assert.deepEqual(await holdsOf(plenty), [], 'the first product was not left held');
  });

  await root.test('when only part of the quantity is free the message says how many', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 5 });
    assert.equal((await holdStockForCheckout({ owner: 's:other', lines: want(product, 3) })).ok, true);
    const result = await holdStockForCheckout({ owner: 's:me', lines: want(product, 3) });
    assert.equal(result.ok, false);
    assert.match(result.message, /Only 2 of ".*" can be set aside right now: another buyer is checking out with the rest\./);
    assert.equal((await holdStockForCheckout({ owner: 's:me', lines: want(product, 2) })).ok, true);
  });

  await root.test('a buyer who has paid (or left) gives the hold back at once', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await holdStockForCheckout({ owner: 's:first', lines: want(product) });
    assert.equal(await releaseCheckoutHold('s:first'), 1);
    assert.equal((await holdStockForCheckout({ owner: 's:second', lines: want(product) })).ok, true);
    assert.equal(await releaseCheckoutHold('s:nobody'), 0);
  });

  await root.test('a refused second try changes nothing: the buyer\'s earlier page keeps exactly the hold it had', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    assert.equal((await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_1', lines: want(product, 2) })).ok, true);
    assert.equal((await holdStockForCheckout({ owner: 's:other', sessionId: 'cs_other', lines: want(product, 1) })).ok, true);
    const before = await holdsOf(product);
    const refused = await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_2', lines: want(product, 3) });
    assert.equal(refused.ok, false, 'asking for more than is free to them is refused');
    assert.deepEqual(await holdsOf(product), before, 'both holds are exactly as they were, the earlier page\'s session id included');
  });

  await root.test('a cart of two products where the second is refused puts the first back as it was, not as nothing', async () => {
    await reset();
    const first = await seedProduct({ stockQuantity: 5 });
    const second = await seedProduct({ stockQuantity: 1 });
    assert.equal((await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_1', lines: want(first, 2) })).ok, true);
    assert.equal((await holdStockForCheckout({ owner: 's:other', sessionId: 'cs_other', lines: want(second, 1) })).ok, true);
    const refused = await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_2', lines: [...want(first, 4), ...want(second, 1)] });
    assert.equal(refused.ok, false);
    const [kept] = await holdsOf(first);
    assert.deepEqual([kept.owner, kept.sessionId, kept.qty], ['s:me', 'cs_page_1', 2], 'the earlier page still has its 2, not the 4 of the failed try');
  });

  await root.test('paying on a page gives back only that page\'s hold: a newer page of the same buyer keeps its own', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 4 });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_1', lines: want(product, 1) });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_2', lines: want(product, 2) });   // replaces the first
    assert.equal(await releaseCheckoutHold('s:me', { sessionId: 'cs_page_1' }), 0, 'the older page has no hold left to give back');
    assert.deepEqual((await holdsOf(product)).map((h) => [h.sessionId, h.qty]), [['cs_page_2', 2]]);
    assert.equal(await releaseCheckoutHold('s:me', { sessionId: 'cs_page_2' }), 1);
    assert.deepEqual(await holdsOf(product), []);
  });

  await root.test('a new hold gives up what the buyer held on products they have taken out of the cart since', async () => {
    await reset();
    const kept = await seedProduct({ stockQuantity: 2 });
    const dropped = await seedProduct({ stockQuantity: 2 });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_1', lines: [...want(kept), ...want(dropped)] });
    await holdStockForCheckout({ owner: 's:other', sessionId: 'cs_other', lines: want(dropped) });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_2', lines: want(kept) });
    assert.deepEqual((await holdsOf(dropped)).map((h) => h.owner), ['s:other'], 'only the other buyer\'s hold is left on the removed product');
    assert.deepEqual((await holdsOf(kept)).map((h) => h.sessionId), ['cs_page_2']);
  });

  await root.test('one buyer making two checkout attempts at the same moment with different carts: neither hold is lost, and the last one standing is never "none"', async () => {
    for (let round = 0; round < 15; round += 1) {
      await reset();
      const first = await seedProduct({ stockQuantity: 2 });
      const second = await seedProduct({ stockQuantity: 2 });
      const [a, b] = await Promise.all([
        holdStockForCheckout({ owner: 's:me', sessionId: 'cs_cart_a', lines: want(first) }),
        holdStockForCheckout({ owner: 's:me', sessionId: 'cs_cart_b', lines: want(second) }),
      ]);
      assert.equal(a.ok && b.ok, true);
      const held = (await holdsOf(first)).length + (await holdsOf(second)).length;
      assert.ok(held >= 1, `round ${round}: both attempts reported success but nothing is held (each cleanup removed the other's hold)`);
    }
  });

  await root.test('a refused try of a two-product cart leaves both products exactly as they were, even while others take holds around it', async () => {
    await reset();
    const first = await seedProduct({ stockQuantity: 5 });
    const second = await seedProduct({ stockQuantity: 1 });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_1', lines: want(first, 2) });
    await holdStockForCheckout({ owner: 's:other', sessionId: 'cs_other', lines: want(second) });
    const [refused, other] = await Promise.all([
      holdStockForCheckout({ owner: 's:me', sessionId: 'cs_page_2', lines: [...want(first, 3), ...want(second)] }),
      holdStockForCheckout({ owner: 's:third', sessionId: 'cs_third', lines: want(first, 1) }),
    ]);
    assert.equal(refused.ok, false);
    assert.equal(other.ok, true);
    assert.deepEqual((await holdsOf(first)).map((h) => [h.owner, h.sessionId, h.qty]).sort(), [['s:me', 'cs_page_1', 2], ['s:third', 'cs_third', 1]]);
  });

  await root.test('giving a hold back inside a transaction is part of that transaction: if it is rolled back, the hold is still there (the e-Transfer order and the hold cleanup rely on it)', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 2 });
    await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_1', lines: want(product) });
    const session = await Product.startSession();
    try {
      await assert.rejects(() => session.withTransaction(async () => {
        assert.equal(await releaseCheckoutHold('s:me', { session }), 1);
        const inside = await Product.findById(product._id).select('+stockHolds').session(session).lean();
        assert.deepEqual(inside.stockHolds, [], 'inside the transaction it is already gone');
        throw new Error('rolled back on purpose');
      }), /rolled back on purpose/);
    } finally { await session.endSession(); }
    assert.deepEqual((await holdsOf(product)).map((h) => [h.owner, h.sessionId]), [['s:me', 'cs_1']], 'outside, nothing happened');
  });

  await root.test('a hold stuck behind another open transaction on the same product gives up at its deadline (the driver cancels it), leaves nothing behind, and works again once the blocker is gone', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    const blocker = await Product.startSession();
    blocker.startTransaction();
    try {
      // another transaction has written this product and is not finished: a second writer is turned away and retried until the deadline
      await Product.updateOne({ _id: product._id }, { $inc: { stockQuantity: 0 } }, { session: blocker });
      const started = Date.now();
      await assert.rejects(
        () => holdStockForCheckout({ owner: 's:me', sessionId: 'cs_1', lines: want(product), timeoutMs: 1000 }),
        (err) => err.name === 'MongoOperationTimeoutError',
      );
      const waited = Date.now() - started;
      assert.ok(waited < 3000, `gave up after ${waited} ms: the deadline was 1000 (the driver may stop a little before it), the default retry window is 120000`);
    } finally { await blocker.abortTransaction(); await blocker.endSession(); }
    assert.deepEqual(await holdsOf(product), [], 'nothing was left behind');
    assert.equal((await holdStockForCheckout({ owner: 's:me', sessionId: 'cs_1', lines: want(product) })).ok, true, 'and the next hold works');
    assert.equal((await holdsOf(product)).length, 1);
  });

  await root.test('holds are never shown: not by a normal read, not by the public product projection, and a hold does not touch updatedAt', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 2 });
    const before = (await Product.findById(product._id).lean()).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await holdStockForCheckout({ owner: 's:secret_guest_cart_session', lines: want(product) });
    const plain = await Product.findById(product._id).lean();
    assert.equal('stockHolds' in plain, false);
    assert.equal(JSON.stringify(plain).includes('secret_guest_cart_session'), false);
    assert.equal(Number(plain.updatedAt), Number(before), 'a checkout attempt is not a product change (the sitemap lastmod reads updatedAt)');
    const { PUBLIC_PRODUCT_PROJECTION } = require('../src/utils/publicProducts');
    assert.equal(Object.keys(PUBLIC_PRODUCT_PROJECTION || {}).includes('stockHolds'), false);
  });

  // ── the e-Transfer lane respects holds too ───────────────────────────────────────────────────────────────────
  const place = (sessionId, overrides = {}) => placeEtransferOrder({ sessionId, buyer: BUYER, address: ADDRESS, shipping: {}, ...overrides });

  await root.test('an e-Transfer order cannot take a unit another buyer is paying for by card, and says why', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, B);
    assert.equal((await holdStockForCheckout({ owner: `s:${A}`, lines: want(product) })).ok, true);
    await assert.rejects(() => place(B), (err) => err instanceof EtransferError && err.status === 409 && err.code === 'OUT_OF_STOCK' && /is being checked out by another buyer right now/.test(err.publicMessage));
    assert.equal(await stockOf(product), 1);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Cart.findOne({ sessionId: B })).items.length, 1, 'their cart is untouched');
  });

  await root.test('the same buyer switching from card to e-Transfer is not blocked by their own hold, and it is given back', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A);
    await holdStockForCheckout({ owner: `s:${A}`, lines: want(product) });
    const order = await place(A);
    assert.equal(order.paymentMethod, 'etransfer');
    assert.equal(await stockOf(product), 0);
    assert.deepEqual(await holdsOf(product), [], 'their card-checkout hold went with the order');
  });

  await root.test('once the other buyer\'s hold has lapsed, the e-Transfer order goes through', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, B);
    await holdStockForCheckout({ owner: `s:${A}`, lines: want(product), now: new Date(Date.now() - 45 * MINUTE) });
    const order = await place(B);
    assert.equal(order.stockDecremented, true);
    assert.equal(await stockOf(product), 0);
  });

  // ── the card checkout route, with Stripe faked and the holds real ────────────────────────────────────────────
  const sessions = [];
  const expired = [];
  const cardApp = (extra = {}) => {
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail,
      ensurePrice: async (p) => p.stripePriceId,
      ensureCoupon: async () => 'coupon_test',
      createSession: async (payload) => { const id = `cs_test_${sessions.length + 1}`; sessions.push({ id, payload }); return { id, url: `https://stripe.test/${id}` }; },
      holdStock: holdStockForCheckout,
      releaseHold: releaseCheckoutHold,
      expireSession: async (id) => { expired.push(id); return {}; },
      ...extra,
    });
    const app = express();
    app.use(express.json());
    app.use('/api/stripe', stripeRouter);
    return app;
  };
  const post = async (app, headers, body = {}) => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/create-checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  };

  await root.test('the second buyer of the last unit gets a 409 and NO link to pay, is told when to retry, and the unused page is closed', async () => {
    await reset(); sessions.length = 0; expired.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A); await seedCart(product, 1, B);
    const app = cardApp();
    const first = await post(app, { 'x-session-id': A });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.url, 'https://stripe.test/cs_test_1');
    const second = await post(app, { 'x-session-id': B });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.match(second.body.error, /is being checked out by another buyer right now\. It frees up within \d+ minutes? if they do not finish\. Try again then\./);
    assert.equal('url' in second.body, false, 'no page to pay on is handed out');
    assert.deepEqual(expired, ['cs_test_2'], 'the page nobody was given is closed');
    const [hold] = await holdsOf(product);
    assert.equal(hold.owner, `s:${A}`);
    assert.ok(Math.abs(hold.expiresAt - Date.now() - holdMinutes() * MINUTE) < 30_000, 'a card checkout is held for the standard time');
    // the first buyer retrying (back button, second click) is not blocked by themselves
    assert.equal((await post(app, { 'x-session-id': A })).status, 200);
  });

  await root.test('simultaneous checkouts of the last unit from different carts: exactly one is sent to pay, the others are refused and their pages closed', async () => {
    await reset(); sessions.length = 0; expired.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    const ids = Array.from({ length: 6 }, (_, n) => `session_race_${n}_0123456789abc`);
    for (const id of ids) await seedCart(product, 1, id);
    const app = cardApp();
    const results = await Promise.all(ids.map((id) => post(app, { 'x-session-id': id })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409, 409, 409]);
    assert.equal(results.filter((r) => r.body.url).length, 1, 'only one buyer was given a page to pay on');
    assert.equal(expired.length, 5);
    assert.equal((await holdsOf(product)).length, 1);
  });

  await root.test('a signed-in buyer\'s hold is theirs across devices, a bank-debit checkout is held for an hour', async () => {
    await reset(); sessions.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    const account = await User.create({ email: 'member@example.com', firstName: 'Mia', lastName: 'Member', isEmailVerified: true });
    await Cart.create({ user: account._id, items: [{ product: product._id, slug: product.slug, sku: product.sku, name: product.name, price: 135, qty: 1 }] });
    const app = cardApp();
    const auth = { authorization: `Bearer ${generateAccessToken(account._id, 0)}` };
    const r = await post(app, auth, { paymentMethod: 'bank_debit' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [hold] = await holdsOf(product);
    assert.equal(hold.owner, `u:${account._id}`);
    assert.ok(Math.abs(hold.expiresAt - Date.now() - 60 * MINUTE) < 30_000, 'a bank debit is held for an hour');
  });

  await root.test('a Stripe failure never touches a hold: the buyer\'s earlier page keeps its unit, and a failed first try holds nothing', async () => {
    await reset(); sessions.length = 0; expired.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A); await seedCart(product, 1, B);
    const quiet = console.error; console.error = () => {};
    try {
      // (the router's dependencies are shared, so the failing Stripe is set up again right before each failing request)
      const failing = () => cardApp({ createSession: async () => { throw new Error('Stripe is down'); } });
      assert.equal((await post(failing(), { 'x-session-id': A })).status, 500);
      assert.deepEqual(await holdsOf(product), [], 'a failed first try holds nothing, so the next buyer is not locked out by a page that never existed');
      assert.equal((await post(cardApp(), { 'x-session-id': A })).status, 200, 'A tries again and gets a page and a hold');
      assert.equal((await post(failing(), { 'x-session-id': A })).status, 500, 'a second try that fails at Stripe...');
    } finally { console.error = quiet; }
    assert.deepEqual((await holdsOf(product)).map((h) => h.owner), [`s:${A}`], '...leaves the first page\'s hold alone');
    assert.equal((await post(cardApp(), { 'x-session-id': B })).status, 409);
  });

  await root.test('a hold that cannot be written never stops a sale (fail open), and says so in the log', async () => {
    await reset(); sessions.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A);
    const lines = [];
    const quiet = console.error; console.error = (...args) => lines.push(args.join(' '));
    try {
      const app = cardApp({ holdStock: async () => { throw new Error('database blip'); } });
      assert.equal((await post(app, { 'x-session-id': A })).status, 200);
    } finally { console.error = quiet; }
    assert.equal(sessions.length, 1);
    assert.match(lines.join('\n'), /Stock hold failed; checkout continues without it: database blip/);
  });

  // ── paying: the hold goes only after the stock has been taken ─────────────────────────────────────────────────
  const paid = (extra = {}) => ({
    id: 'cs_paid_1', object: 'checkout.session', status: 'complete', payment_status: 'paid', payment_method_types: ['card'],
    metadata: { userId: 'guest', cartSessionId: A },
    customer_details: { email: 'sam@example.com', name: 'Sam Buyer', phone: '+14165550123' },
    collected_information: { shipping_details: { name: 'Sam Buyer', address: { line1: '100 Queen St W', city: 'Toronto', state: 'ON', postal_code: 'M5H 2N2', country: 'CA' } } },
    line_items: { data: [] }, amount_subtotal: 13500, total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 }, amount_total: 14900,
    shipping_cost: { shipping_rate: { display_name: 'Flat-Rate Shipping' } },
    payment_intent: { id: 'pi_paid_1', status: 'succeeded', latest_charge: 'ch_paid_1' },
    ...extra,
  });
  const lineFor = (product, qty = 1) => ({ data: [{ id: `li_${product.slug}`, price: { id: product.stripePriceId, unit_amount: 13500, product: { id: `prod_${product.slug}`, metadata: {} } }, quantity: qty }] });

  await root.test('paying makes the order, takes the stock, THEN frees the hold (never the other way round), and clears the cart', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 2 });
    await seedCart(product, 1, A);
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_paid_1', lines: want(product) });
    const calls = [];
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail,
      retrieveSession: async () => paid({ line_items: lineFor(product) }),
      decrementStock: async (order) => { calls.push(['decrement', (await holdsOf(product)).length]); return require('../src/utils/stock').decrementStockForOrder(order); },
      releaseHold: async (owner, options) => { calls.push(['release', await stockOf(product)]); return releaseCheckoutHold(owner, options); },
    });
    const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    assert.equal(order.paymentStatus, 'paid');
    assert.deepEqual(calls, [['decrement', 1], ['release', 1]], 'the hold was still there while the stock was taken, and the stock was already down when it was released');
    assert.equal(await stockOf(product), 1);
    assert.deepEqual(await holdsOf(product), []);
    assert.equal((await Cart.findOne({ sessionId: A })).items.length, 0);
  });

  await root.test('after one buyer pays, the next can still buy what is left, and is refused what is gone', async () => {
    await reset(); sessions.length = 0;
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A); await seedCart(product, 1, B);
    const app = cardApp();
    assert.equal((await post(app, { 'x-session-id': A })).status, 200);
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product) }), holdStock: holdStockForCheckout, releaseHold: releaseCheckoutHold });
    await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    const second = await post(cardApp(), { 'x-session-id': B });
    assert.equal(second.status, 400);
    assert.match(second.body.error, /is out of stock/);
  });

  await root.test('a payment that was refunded before its order existed also gives the hold back', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    await seedCart(product, 1, A);
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_paid_1', lines: want(product) });
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail,
      retrieveSession: async () => paid({ line_items: lineFor(product), payment_intent: { id: 'pi_refunded_1', status: 'succeeded', latest_charge: { id: 'ch_refunded_1', refunded: true, amount_refunded: 14900, amount: 14900 } } }),
      releaseHold: releaseCheckoutHold,
    });
    const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    assert.equal(order.paymentStatus, 'refunded');
    assert.equal(await stockOf(product), 1, 'no stock was taken for a refunded payment');
    assert.deepEqual(await holdsOf(product), []);
  });

  // ── an order that was saved but whose first attempt stopped before the end ────────────────────────────────────────
  await root.test('a crash right after the order is saved: the retry takes the stock, gives the hold back and empties the cart (and only once)', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    await seedCart(product, 2, A);
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_paid_1', lines: want(product, 2) });
    const realCartUpdate = Cart.findOneAndUpdate;
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product, 2) }), releaseHold: releaseCheckoutHold });
    // the server "stops" while emptying the cart: the order is saved, the stock taken, the hold released, the cart still full
    Cart.findOneAndUpdate = async () => { throw new Error('process stopped'); };
    const quiet = console.error; console.error = () => {};
    try {
      await assert.rejects(() => stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1'), /process stopped/);
    } finally { Cart.findOneAndUpdate = realCartUpdate; console.error = quiet; }
    const saved = await Order.findOne({ stripeCheckoutSessionId: 'cs_paid_1' });
    assert.equal(saved.postOrderPending, true, 'the order says its last steps are not done');
    assert.equal((await Cart.findOne({ sessionId: A })).items.length, 1, 'the cart is still full');

    // Stripe delivers the event again
    const again = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    assert.equal(String(again._id), String(saved._id));
    assert.equal(await Order.countDocuments(), 1);
    assert.equal(await stockOf(product), 1, 'the stock was taken once');
    assert.equal((await Cart.findOne({ sessionId: A })).items.length, 0, 'the cart is empty now');
    assert.deepEqual(await holdsOf(product), []);
    assert.equal((await Order.findById(saved._id).lean()).postOrderPending, undefined, 'finished: nothing left to do');
  });

  await root.test('the retry leaves a cart alone that the buyer has started filling again since the order', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    const other = await seedProduct({ stockQuantity: 3 });
    await seedCart(product, 1, A);
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product) }), releaseHold: releaseCheckoutHold });
    const realCartUpdate = Cart.findOneAndUpdate;
    Cart.findOneAndUpdate = async () => { throw new Error('process stopped'); };
    const quiet = console.error; console.error = () => {};
    try { await assert.rejects(() => stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1')); } finally { Cart.findOneAndUpdate = realCartUpdate; console.error = quiet; }
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the buyer is shopping again: a different stick goes into the same cart session
    await Cart.updateOne({ sessionId: A }, { $set: { items: [{ product: other._id, slug: other.slug, sku: other.sku, name: other.name, price: 135, qty: 1 }] } });
    await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    const cart = await Cart.findOne({ sessionId: A });
    assert.deepEqual(cart.items.map((i) => i.slug), [other.slug], 'their new cart is not emptied');
    assert.equal((await Order.findOne({ stripeCheckoutSessionId: 'cs_paid_1' }).lean()).postOrderPending, undefined);
  });

  await root.test('a guest who signs in with a checkout started: the hold under the guest session is given back, so the account is not blocked by it', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    const account = await User.create({ email: 'member@example.com', firstName: 'Mia', lastName: 'Member', isEmailVerified: true });
    await seedCart(product, 1, A);
    assert.equal((await holdStockForCheckout({ owner: `s:${A}`, lines: want(product) })).ok, true);
    // as the account, the guest's own hold would count against them...
    assert.equal((await holdStockForCheckout({ owner: `u:${account._id}`, lines: want(product) })).ok, false);
    await require('../src/utils/guestCartMerge').mergeGuestCartForUser(account._id, A);
    assert.deepEqual(await holdsOf(product), [], 'the guest hold is gone');
    assert.equal((await holdStockForCheckout({ owner: `u:${account._id}`, lines: want(product) })).ok, true);
    assert.equal((await Cart.findOne({ user: account._id })).items.length, 1, 'and the cart is theirs');
  });

  await root.test('paying on an older page leaves the hold of the buyer\'s newer page alone (and a hold left by an old crash cannot wipe a fresh one)', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 4 });
    await seedCart(product, 1, A);
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_paid_1', lines: want(product, 1) });
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_newer', lines: want(product, 2) });
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product) }), releaseHold: releaseCheckoutHold });
    await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    assert.deepEqual((await holdsOf(product)).map((h) => [h.sessionId, h.qty]), [['cs_newer', 2]]);
  });

  await root.test('the cart is emptied only if it is unchanged since the buyer started THIS checkout', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 9 });
    const created = Math.floor(Date.now() / 1000) - 600;           // the checkout was started ten minutes ago
    // untouched since: emptied
    await seedCart(product, 1, A);
    await Cart.collection.updateOne({ sessionId: A }, { $set: { updatedAt: new Date((created - 120) * 1000) } });
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id) => paid({ id, created, line_items: lineFor(product) }), releaseHold: releaseCheckoutHold });
    await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    assert.equal((await Cart.findOne({ sessionId: A })).items.length, 0);
    // something was added after the checkout started (another tab): it was not paid for, so it stays
    await seedCart(product, 1, B);
    await Cart.collection.updateOne({ sessionId: B }, { $set: { updatedAt: new Date() } });
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id) => paid({ id, created, metadata: { userId: 'guest', cartSessionId: B }, line_items: lineFor(product), payment_intent: { id: 'pi_b', status: 'succeeded', latest_charge: 'ch_b' } }), releaseHold: releaseCheckoutHold });
    await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_2');
    assert.equal((await Cart.findOne({ sessionId: B })).items.length, 1, 'edited after the checkout started: left alone');
  });

  await root.test('a hold that cannot be given back leaves the order marked unfinished, and the next retry gives it back', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    await seedCart(product, 1, A);
    await holdStockForCheckout({ owner: `s:${A}`, sessionId: 'cs_paid_1', lines: want(product, 1) });
    const quiet = console.error; console.error = () => {};
    try {
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product) }), releaseHold: async () => { throw new Error('database blip'); } });
      const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
      assert.ok(order, 'the order is made all the same');
      assert.equal((await Order.findById(order._id).lean()).postOrderPending, true, 'and stays marked');
      assert.equal((await holdsOf(product)).length, 1, 'the hold is still there');
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => paid({ line_items: lineFor(product) }), releaseHold: releaseCheckoutHold });
      await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_paid_1');
    } finally { console.error = quiet; }
    assert.deepEqual(await holdsOf(product), []);
    assert.equal((await Order.findOne().lean()).postOrderPending, undefined);
    assert.equal(await stockOf(product), 2, 'the stock was taken once');
  });

  // ── the safety net under the holds: a payment that still finds the stock gone ─────────────────────────────────
  const paidOrder = (product, qty) => Order.create({
    items: [{ product: product._id, slug: product.slug, sku: product.sku, name: product.name, price: 135, qty }],
    shippingAddress: { firstName: 'Sam', lastName: 'Buyer', line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'CA' },
    subtotal: 135 * qty, total: 135 * qty, paymentStatus: 'paid', status: 'processing',
    stripeCheckoutSessionId: `cs_oversold_${Math.random().toString(36).slice(2)}`, adminNotes: 'SHIPPING: Xpresspost',
  });
  const { decrementStockForOrder } = require('../src/utils/stock');

  await root.test('two paid orders for the last unit: the second is clamped, flagged OVERSOLD and the owner alerted, nothing throws (it threw on a real database before)', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 1 });
    const [one, two] = [await paidOrder(product, 1), await paidOrder(product, 1)];
    const quiet = console.error; console.error = () => {};
    try {
      assert.equal(await decrementStockForOrder(one), true);
      assert.equal(await decrementStockForOrder(two), true, 'the clamp worked instead of throwing');
    } finally { console.error = quiet; }
    assert.equal(await stockOf(product), 0, 'stock never goes negative');
    const first = await Order.findById(one._id).lean();
    const second = await Order.findById(two._id).lean();
    assert.equal(first.items[0].decrementedQty, 1);
    assert.equal(second.items[0].decrementedQty, 0);
    assert.equal(second.stockDecremented, true);
    assert.match(second.adminNotes, /^SHIPPING: Xpresspost\nOVERSOLD — needs manual review: .* \(wanted 1, got 0\)$/);
    const alert = await AdminEvent.findOne({ type: 'order.oversold' }).lean();
    assert.ok(alert && alert.priority === 'high', 'the owner\'s phone is told');
    assert.equal(await AdminEvent.countDocuments({ type: 'order.oversold' }), 1, 'only the second order is flagged');
  });

  await root.test('an order for more than is left is filled with what there is, and the shortfall is recorded exactly', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 2 });
    const order = await paidOrder(product, 3);
    const quiet = console.error; console.error = () => {};
    try { await decrementStockForOrder(order); } finally { console.error = quiet; }
    assert.equal(await stockOf(product), 0);
    assert.equal((await Order.findById(order._id).lean()).items[0].decrementedQty, 2);
  });

  // ── a session with nothing to pay ────────────────────────────────────────────────────────────────────────────
  const free = (product, extra = {}) => paid({
    id: 'cs_free_1', payment_status: 'no_payment_required', amount_total: 0, amount_subtotal: 13500,
    total_details: { amount_discount: 13500, amount_shipping: 0, amount_tax: 0 }, payment_intent: null, line_items: lineFor(product), ...extra,
  });

  await root.test('a completed session that needed no payment (100% code, free shipping) becomes a real, $0 order with its stock taken', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    await seedCart(product, 1, A);
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => free(product) });
    const order = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_free_1');
    assert.ok(order, 'the order exists');
    assert.equal(order.total, 0);
    assert.equal(order.discount, 135);
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.status, 'processing');
    assert.equal(order.stripePaymentIntentId, undefined);
    assert.match(order.adminNotes, /NOTE: the total of this order is \$0\.00/);
    assert.match(order.statusHistory[0].note, /discount code covered the whole total/);
    assert.equal(await stockOf(product), 2);
    assert.match(sent.at(-1).subject, /Order confirmed/);
    const alert = await AdminEvent.findOne({ type: 'order.paid' }).lean();
    assert.equal(alert.title, 'New order: $0, a discount code covered it');
    assert.equal((await Cart.findOne({ sessionId: A })).items.length, 0);
    // asked again (the webhook and the success page both ask): the same order, no second one, no second stock take
    const again = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_free_1');
    assert.equal(String(again._id), String(order._id));
    assert.equal(await Order.countDocuments(), 1);
    assert.equal(await stockOf(product), 2);
  });

  await root.test('two $0 orders in a row both save: neither has a PaymentIntent, and that must not collide', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 5 });
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async (id) => free(product, { id }) });
    const one = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_free_a');
    const two = await stripeRouter.internalsForTest.fulfillCheckoutSession('cs_free_b');
    assert.notEqual(String(one._id), String(two._id));
    assert.equal(await Order.countDocuments(), 2);
  });

  await root.test('a session that is still open, or that owes money, is never taken for a free order', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    for (const [label, extra] of [['still open', { status: 'open' }], ['owes money', { amount_total: 14900 }], ['unpaid', { payment_status: 'unpaid' }]]) {
      stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => free(product, extra) });
      assert.equal(await stripeRouter.internalsForTest.fulfillCheckoutSession(`cs_free_${label.replace(/\W/g, '')}`), null, label);
    }
    assert.equal(await Order.countDocuments(), 0);
    assert.equal(await stockOf(product), 3);
  });

  await root.test('the signed webhook sends a free completed session to fulfilment', async () => {
    await reset();
    const product = await seedProduct({ stockQuantity: 3 });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    stripeRouter.setCheckoutDependenciesForTest({ deliverEmail: require('../src/utils/checkoutEmails').deliverCheckoutEmail, retrieveSession: async () => free(product) });
    const app = express();
    app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
    app.use('/api/stripe', stripeRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const payload = JSON.stringify({ id: 'evt_free_1', object: 'event', type: 'checkout.session.completed', data: { object: free(product) } });
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) },
        body: payload,
      });
      assert.equal(r.status, 200);
    } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    assert.equal(await Order.countDocuments({ total: 0, paymentStatus: 'paid' }), 1);
  });

  assert.equal(ownerKey({ userId: 'abc' }), 'u:abc');
  assert.equal(ownerKey({ sessionId: 'xyz' }), 's:xyz');
  assert.equal(ownerKey({}), null);
});
