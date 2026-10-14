// The money path of an Interac e-Transfer order, with the database faked: WHERE the buyer is told to send the money, HOW MUCH, what is
// stored, and who may see it. Until now only an opt-in integration test (needs MongoDB, not run in CI) looked at this, so a wrong payee,
// a wrong total or a missing terms box would have passed the whole suite (found by an independent review on 2026-10-14).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } } };
process.env.NODE_ENV ||= 'test';

const { placeEtransferOrder, EtransferError } = require('../src/utils/etransfer');
const { paymentMethodSettings } = require('../src/utils/paymentMethods');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { createPaymentsRouter } = require('../src/routes/payments');

const SETTINGS_ENV = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'reflexityram@gmail.com', ETRANSFER_DISCOUNT_PCT: '2' };
const NOW = new Date('2026-10-14T12:00:00Z');
const product = (extra = {}) => ({ _id: 'p1', slug: 'ddr4-16gb', sku: 'SKU-16', name: '16GB DDR4', price: 100, stockQuantity: 5, stock: 'in', images: [{ url: 'https://img/x.jpg' }], ...extra });

// a cart holding `qty` of one product, and what the order store would be given
function harness({ qty = 2, env = SETTINGS_ENV, lines, open = 0, cartConsumed = true, sendNoticeFails = false } = {}) {
  const calls = { created: null, notices: [], events: [], cartUpdates: [] };
  const cart = { _id: 'c1', updatedAt: new Date('2026-10-14T11:00:00Z'), items: [{ product: 'p1', qty }] };
  const deps = {
    Cart: { findOne: async () => cart, updateOne: async (...args) => { calls.cartUpdates.push(args); return { modifiedCount: cartConsumed ? 1 : 0 }; } },
    Order: { countDocuments: async () => open },
    resolveLines: async () => lines || [{ item: { qty }, product: product() }],
    createOrder: async (data, { beforeCommit }) => { await beforeCommit({}); calls.created = data; return { ...data, _id: 'o1', orderNumber: 'RFX-TEST-1' }; },
    sendNotice: async (n) => { calls.notices.push(n); if (sendNoticeFails) throw new Error('mail down'); },
    record: async (e) => { calls.events.push(e); },
    settings: paymentMethodSettings(env),
  };
  const buyer = { firstName: 'Sam', lastName: 'Buyer', email: ' Sam.Buyer@Example.com ', phone: '416 555 0123' };
  const address = { line1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };
  const place = (extra = {}) => placeEtransferOrder({ user: null, sessionId: 'sess_test_0123456789abcdef', buyer, address, shipping: {}, analytics: {}, now: NOW, ...extra }, deps);
  return { calls, deps, place };
}

test('the order stores the payee from the host setting, the exact amount, no tax, an unpaid state, and the buyer is told the same', async () => {
  const { calls, place } = harness({ qty: 2 });
  const order = await place();
  const data = calls.created;
  assert.equal(data.etransfer.recipientEmail, 'reflexityram@gmail.com', 'the payee is whatever ETRANSFER_RECIPIENT_EMAIL says');
  // 2 x $100 goods, 2% off the goods = $4.00, shipping $14 (1-2 sticks), no tax
  assert.equal(data.subtotal, 200);
  assert.equal(data.discount, 4);
  assert.equal(data.shippingCost, 14);
  assert.equal(data.tax, 0);
  assert.equal(data.total, 210);
  assert.equal(data.etransfer.amountDue, 210, 'what the buyer is told to send is the stored total');
  assert.equal(data.paymentMethod, 'etransfer');
  assert.equal(data.paymentStatus, 'pending');
  assert.equal(data.status, 'pending');
  assert.equal(data.guestEmail, 'sam.buyer@example.com', 'the buyer\'s email is tidied');
  assert.equal(data.etransfer.expiresAt.toISOString(), '2026-10-16T12:00:00.000Z', 'the hold is 48 hours from now');
  assert.match(data.adminNotes, /AWAITING e-Transfer: do not ship until you mark the payment received/);
  // the instructions email goes to the buyer for THIS order
  assert.equal(calls.notices.length, 1);
  assert.equal(calls.notices[0].kind, 'etransferInstructions');
  assert.equal(calls.notices[0].email, 'sam.buyer@example.com');
  assert.equal(calls.notices[0].order.etransfer.recipientEmail, 'reflexityram@gmail.com');
  assert.equal(order.orderNumber, 'RFX-TEST-1');
  assert.equal(calls.events[0].type, 'order.etransfer_pending', 'the owner\'s phone is told');
});

test('the payee follows the setting: change the host variable and the next order names the new address', async () => {
  const { calls, place } = harness({ env: { ...SETTINGS_ENV, ETRANSFER_RECIPIENT_EMAIL: 'other@example.com' } });
  await place();
  assert.equal(calls.created.etransfer.recipientEmail, 'other@example.com');
});

test('the cart is emptied inside the order\'s own transaction, only if it still holds what was priced, and a second try is turned away', async () => {
  const first = harness();
  await first.place();
  assert.equal(first.calls.cartUpdates.length, 1);
  const [filter, update] = first.calls.cartUpdates[0];
  assert.deepEqual(filter._id, 'c1');
  assert.deepEqual(filter['items.0'], { $exists: true });
  assert.ok(filter.updatedAt, 'the cart must not have changed since it was priced');
  assert.deepEqual(update.$set.items, []);
  const second = harness({ cartConsumed: false });
  await assert.rejects(second.place(), (err) => err instanceof EtransferError && err.status === 409 && err.code === 'CART_CHANGED');
});

test('it refuses when e-Transfer is off, the cart is empty, stock is short, the order is too big, or the buyer has too many open orders', async () => {
  await assert.rejects(harness({ env: {} }).place(), (err) => err.status === 503 && err.code === 'ETRANSFER_OFF');
  await assert.rejects(harness({ env: { ETRANSFER_ENABLED: 'true' } }).place(), (err) => err.status === 503, 'no payee address, no e-Transfer: the shop never guesses where money goes');
  const empty = harness();
  empty.deps.Cart.findOne = async () => ({ _id: 'c1', items: [] });
  await assert.rejects(empty.place(), (err) => err.status === 400 && /Cart is empty/.test(err.message));
  await assert.rejects(harness({ qty: 6 }).place(), (err) => err.status === 400 && /Only 5 units/.test(err.message));
  await assert.rejects(harness({ lines: [{ item: { qty: 1 }, product: product({ stockQuantity: 0, stock: 'out' }) }] }).place(), (err) => err.status === 400 && /out of stock/.test(err.message));
  await assert.rejects(harness({ qty: 5, lines: [{ item: { qty: 5 }, product: product({ price: 700, stockQuantity: 9 }) }] }).place(), (err) => err.status === 400 && err.code === 'ETRANSFER_TOO_LARGE', 'over the C$3000 cap');
  await assert.rejects(harness({ open: 3 }).place(), (err) => err.status === 429);
  await assert.rejects(harness().place({ sessionId: undefined }), (err) => err.status === 400, 'a guest needs a cart session');
});

test('an email that fails to send does not undo the order', async () => {
  const { calls, place } = harness({ sendNoticeFails: true });
  const original = console.error;
  console.error = () => {};
  try { const order = await place(); assert.equal(order.orderNumber, 'RFX-TEST-1'); } finally { console.error = original; }
  assert.equal(calls.events.length, 1, 'and the owner is still told');
});

test('the buyer-facing order shows the payee only while the e-Transfer is waiting for its money', () => {
  const base = { orderNumber: 'RFX-T', total: 210, paymentMethod: 'etransfer', etransfer: { recipientEmail: 'reflexityram@gmail.com', amountDue: 210, expiresAt: NOW }, items: [] };
  const waiting = customerOrderResponse({ ...base, status: 'pending', paymentStatus: 'pending' });
  assert.equal(waiting.etransfer.recipientEmail, 'reflexityram@gmail.com');
  assert.equal(waiting.etransfer.amountDue, 210);
  assert.equal(waiting.etransfer.message, 'RFX-T');
  for (const [status, paymentStatus] of [['processing', 'paid'], ['cancelled', 'pending'], ['shipped', 'paid'], ['pending', 'paid'], ['cancelled', 'refunded']]) {
    assert.equal(customerOrderResponse({ ...base, status, paymentStatus }).etransfer, undefined, `${status}/${paymentStatus}: no payee shown`);
  }
  assert.equal(customerOrderResponse({ ...base, paymentMethod: 'stripe', status: 'pending', paymentStatus: 'pending' }).etransfer, undefined, 'a card order never shows an e-Transfer payee');
  assert.equal(customerOrderResponse({ ...base, etransfer: {}, status: 'pending', paymentStatus: 'pending' }).etransfer, undefined, 'no payee on file, nothing to show');
});

// ── the route: the terms box is required, and the order's own answer carries the payee ──
async function post(app, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/payments/etransfer/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'sess_test_0123456789abcdef' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /etransfer/orders needs the terms box, a Canadian address and a real email, and answers with the payee and amount', async () => {
  const placed = [];
  const app = express();
  app.use(express.json());
  app.use('/api/payments', createPaymentsRouter({
    place: async (input) => { placed.push(input); return { orderNumber: 'RFX-TEST-1', total: 210, discount: 4, etransfer: { recipientEmail: 'reflexityram@gmail.com', amountDue: 210, expiresAt: NOW } }; },
    assertEmail: () => {},
  }));
  const good = {
    buyer: { firstName: 'Sam', lastName: 'Buyer', phone: '416 555 0123', email: 'Sam@Example.com' },
    address: { line1: '100 Queen St W', city: 'Toronto', state: 'on', zip: 'm5h2n2' },
    shipping: {}, acceptTerms: true,
  };
  const ok = await post(app, good);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.etransfer.recipientEmail, 'reflexityram@gmail.com');
  assert.equal(ok.body.etransfer.amountDue, 210);
  assert.equal(placed[0].address.state, 'ON', 'the province is tidied');
  assert.equal(placed[0].address.zip, 'M5H 2N2', 'and the postal code');
  assert.equal(placed[0].buyer.email, 'sam@example.com');
  placed.length = 0;
  for (const [name, mutate] of [
    ['no terms box', (b) => { delete b.acceptTerms; }],
    ['terms false', (b) => { b.acceptTerms = false; }],
    ['terms as text', (b) => { b.acceptTerms = 'true'; }],
    ['no street', (b) => { b.address.line1 = ''; }],
    ['not a province', (b) => { b.address.state = 'ZZ'; }],
    ['not a postal code', (b) => { b.address.zip = '12345'; }],
    ['no phone', (b) => { b.buyer.phone = ''; }],
    ['not an email', (b) => { b.buyer.email = 'not-an-email'; }],
  ]) {
    const bad = JSON.parse(JSON.stringify(good));
    mutate(bad);
    const refused = await post(app, bad);
    assert.ok([400, 422].includes(refused.status), `${name}: refused (got ${refused.status})`);
  }
  assert.equal(placed.length, 0, 'none of the refused requests reached the order code');
});
