// The admin endpoints for Canada Post labels, run through the real router with real auth middleware.
// Only POST .../label can spend money; everything else here is a read or a check, and the rest of the file proves that
// the route refuses anything that is not an explicit, exact approval before the label code is even reached.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-label-routes-test-secret';

const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const canadaPost = require('../src/utils/canadaPost');
const adminRouter = require('../src/routes/admin');
const { orderStore, chain } = require('./helpers/orderStore');
const { fakeCanadaPost, labelEnv, labelOrder, SHIPPING } = require('./helpers/fakeCanadaPost');

const realFetch = globalThis.fetch;
const ORDER_ID = '64b7f0c2a1b2c3d4e5f60719';
const LABEL_ENV_KEYS = Object.keys(labelEnv());

// Everything the label code reads from the environment and the network is replaced for one test, then put back.
function setup(t, { order = {}, scenario = {}, env = {}, role = 'admin' } = {}) {
  canadaPost.resetTokenCacheForTest();
  const store = orderStore([labelOrder({ _id: ORDER_ID, ...order })]);
  const cp = fakeCanadaPost(scenario);
  const savedEnv = Object.fromEntries(LABEL_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, labelEnv(env));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; }
  const original = {
    findById: Order.findById, findOneAndUpdate: Order.findOneAndUpdate, updateOne: Order.updateOne, countDocuments: Order.countDocuments, find: Order.find,
    userFindById: User.findById, productFind: Product.find, fetch: globalThis.fetch,
  };
  User.findById = () => chain({ _id: 'admin-1', role, isActive: true, authVersion: 0 });
  Product.find = () => chain([]);
  Object.assign(Order, {
    findById: store.findById, findOneAndUpdate: store.findOneAndUpdate, updateOne: store.updateOne, countDocuments: store.countDocuments, find: store.find,
  });
  // Canada Post goes to the fake; the test's own calls to the local server go to the real fetch.
  globalThis.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : cp.fetchImpl(url, init));
  t.after(() => {
    Object.assign(Order, { findById: original.findById, findOneAndUpdate: original.findOneAndUpdate, updateOne: original.updateOne, countDocuments: original.countDocuments, find: original.find });
    User.findById = original.userFindById;
    Product.find = original.productFind;
    globalThis.fetch = original.fetch;
    for (const key of LABEL_ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  const headers = { Authorization: `Bearer ${jwt.sign({ id: 'admin-1', av: 0 }, process.env.JWT_SECRET)}` };
  return { app, headers, store, cp, order: () => store.store[0] };
}

async function call(app, method, path, { body, headers, raw = false } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (raw) return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const creates = (cp) => cp.calls.filter((c) => c.create);
const base = `/api/admin/orders/${ORDER_ID}`;
const approve = (extra = {}) => ({ serviceCode: 'DOM.EP', signature: false, approvedDue: 19.16, approve: true, ...extra });

test('every label endpoint needs a signed-in admin', async (t) => {
  const anonymous = setup(t);
  for (const [method, path] of [['GET', `${base}/label/options`], ['POST', `${base}/label`], ['POST', `${base}/label/reconcile`], ['GET', `${base}/label/pdf`]]) {
    const res = await call(anonymous.app, method, path, { body: method === 'POST' ? approve() : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  assert.equal(anonymous.cp.calls.length, 0);

  const customer = setup(t, { role: 'customer' });
  for (const [method, path] of [['GET', `${base}/label/options`], ['POST', `${base}/label`], ['POST', `${base}/label/reconcile`], ['GET', `${base}/label/pdf`]]) {
    const res = await call(customer.app, method, path, { headers: customer.headers, body: method === 'POST' ? approve() : undefined });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal(customer.cp.calls.length, 0, 'a customer token reaches nothing');
  assert.equal(customer.order().label, undefined);
});

test('GET options returns the live prices and buys nothing', async (t) => {
  const h = setup(t);
  const res = await call(h.app, 'GET', `${base}/label/options`, { headers: h.headers });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.options.options.map((o) => [o.serviceCode, o.due]), [['DOM.EP', 19.16], ['DOM.RP', 19.16], ['DOM.XP', 24.13], ['DOM.PC', 57.69]]);
  assert.equal(res.body.options.recommended.serviceCode, 'DOM.EP');
  assert.equal(res.body.options.switchedOff, false);
  assert.equal(creates(h.cp).length, 0);
  assert.equal(h.store.writes.length, 0);

  assert.equal((await call(h.app, 'GET', '/api/admin/orders/not-an-id/label/options', { headers: h.headers })).status, 400);
  assert.equal((await call(h.app, 'GET', '/api/admin/orders/64b7f0c2a1b2c3d4e5f60aaa/label/options', { headers: h.headers })).status, 404);
});

test('GET options explains an order that cannot get a label, and an upstream failure is a 502 with no internals', async (t) => {
  const unpaid = setup(t, { order: { paymentStatus: 'pending' } });
  const refused = await call(unpaid.app, 'GET', `${base}/label/options`, { headers: unpaid.headers });
  assert.deepEqual([refused.status, refused.body.code], [409, 'not-eligible']);

  const down = setup(t, { scenario: { rating: 'error' } });
  const res = await call(down.app, 'GET', `${base}/label/options`, { headers: down.headers });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, 'rating-failed');

  const broken = setup(t);
  globalThis.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : Promise.reject(new TypeError('fetch failed: secret-host.internal')));
  const log = console.error;
  console.error = () => {}; // the server logs the cause; the browser must not see it
  const crashed = await call(broken.app, 'GET', `${base}/label/options`, { headers: broken.headers }).finally(() => { console.error = log; });
  assert.equal(crashed.status, 502);
  assert.doesNotMatch(JSON.stringify(crashed.body), /secret-host|TypeError|stack/i);
});

test('the purchase route refuses anything that is not an explicit approval of an exact price, before the label code runs', async (t) => {
  const h = setup(t);
  const bad = [
    ['no body', undefined],
    ['empty body', {}],
    ['approve missing', { serviceCode: 'DOM.EP', signature: false, approvedDue: 19.16 }],
    ['approve false', approve({ approve: false })],
    ['approve as a string', approve({ approve: 'true' })],
    ['approve as 1', approve({ approve: 1 })],
    ['price as a string', approve({ approvedDue: '19.16' })],
    ['price zero', approve({ approvedDue: 0 })],
    ['price negative', approve({ approvedDue: -19.16 })],
    ['price huge', approve({ approvedDue: 1e9 })],
    ['price not a number', approve({ approvedDue: null })],
    ['unknown service', approve({ serviceCode: 'DOM.XX' })],
    ['an international service', approve({ serviceCode: 'INT.TP' })],
    ['signature missing', { serviceCode: 'DOM.EP', approvedDue: 19.16, approve: true }],
    ['signature as a string', approve({ signature: 'yes' })],
  ];
  for (const [name, body] of bad) {
    const res = await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body });
    assert.equal(res.status, 400, `${name} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  assert.equal((await call(h.app, 'POST', '/api/admin/orders/not-an-id/label', { headers: h.headers, body: approve() })).status, 400);
  assert.equal(h.cp.calls.length, 0, 'not one request reached Canada Post');
  assert.equal(h.store.writes.length, 0, 'and the order was never claimed');
});

test('an approved purchase creates one label and answers with the label only', async (t) => {
  const h = setup(t);
  const res = await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body: approve() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body), ['label']);
  assert.deepEqual([res.body.label.status, res.body.label.trackingPin, res.body.label.serviceName, res.body.label.price.due], ['created', '123456789012', 'Expedited Parcel', 19.16]);
  assert.doesNotMatch(JSON.stringify(res.body), /https?:|artifact|Winnipeg|Example/i, 'no link, no buyer address');
  assert.equal(creates(h.cp).length, 1);
  assert.equal(h.order().trackingNumber, '123456789012');
  assert.equal(h.order().label.approvedBy, 'admin-1', 'the admin who approved it is on record');
  assert.equal(h.order().status, 'processing');
});

test('a stale price, a switched-off server and a repeated click are refused with a reason the screen can show', async (t) => {
  const stale = setup(t);
  const moved = await call(stale.app, 'POST', `${base}/label`, { headers: stale.headers, body: approve({ approvedDue: 18.5 }) });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.code, 'price-changed');
  assert.equal(moved.body.quote.due, 19.16, 'the new price travels back so the screen can show it');
  assert.equal(creates(stale.cp).length, 0);

  const off = setup(t, { env: { CANADA_POST_LABELS_ENABLED: 'false' } });
  const disabled = await call(off.app, 'POST', `${base}/label`, { headers: off.headers, body: approve() });
  assert.deepEqual([disabled.status, disabled.body.code], [403, 'not-enabled']);
  assert.equal(off.cp.calls.length, 0);

  const again = setup(t);
  await call(again.app, 'POST', `${base}/label`, { headers: again.headers, body: approve() });
  const repeat = await call(again.app, 'POST', `${base}/label`, { headers: again.headers, body: approve() });
  assert.deepEqual([repeat.status, repeat.body.code], [409, 'already-labelled']);
  assert.equal(creates(again.cp).length, 1);
});

test('an unclear answer is a 502 that tells the admin to check first, and the order then refuses a new purchase', async (t) => {
  const h = setup(t, { scenario: { create: 'server-error' } });
  const res = await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body: approve() });
  assert.deepEqual([res.status, res.body.code], [502, 'unknown-outcome']);
  assert.match(res.body.error, /Check with Canada Post/);
  const again = await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body: approve() });
  assert.deepEqual([again.status, again.body.code], [409, 'unknown-outcome']);
  assert.equal(creates(h.cp).length, 1);
});

test('"Check with Canada Post" resolves an unclear purchase over HTTP', async (t) => {
  const found = setup(t, { scenario: { create: 'server-error', processedAnyway: true } });
  await call(found.app, 'POST', `${base}/label`, { headers: found.headers, body: approve() });
  const res = await call(found.app, 'POST', `${base}/label/reconcile`, { headers: found.headers });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.found, res.body.label.status, res.body.label.trackingPin], [true, 'created', '123456789012']);
  assert.equal(found.order().trackingNumber, '123456789012');

  const none = setup(t, { scenario: { create: 'server-error', lookup: 'none' } });
  await call(none.app, 'POST', `${base}/label`, { headers: none.headers, body: approve() });
  const missing = await call(none.app, 'POST', `${base}/label/reconcile`, { headers: none.headers });
  assert.deepEqual([missing.status, missing.body.found], [200, false]);
  assert.match(missing.body.message, /nothing was charged/i);

  const nothing = setup(t);
  const idle = await call(nothing.app, 'POST', `${base}/label/reconcile`, { headers: nothing.headers });
  assert.deepEqual([idle.status, idle.body.code], [409, 'nothing-to-check']);
});

test('the label PDF is served inline from Canada Post, never cached, never sniffed', async (t) => {
  const h = setup(t);
  await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body: approve() });
  const res = await call(h.app, 'GET', `${base}/label/pdf`, { headers: h.headers, raw: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'inline; filename="label-RFX-TEST-000001.pdf"');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.bytes.subarray(0, 5).toString('latin1'), '%PDF-');

  const none = setup(t);
  const missing = await call(none.app, 'GET', `${base}/label/pdf`, { headers: none.headers });
  assert.deepEqual([missing.status, missing.body.code], [404, 'no-label']);
});

test('the order screen gets the label view and the eligibility, never the Canada Post link', async (t) => {
  const h = setup(t);
  await call(h.app, 'POST', `${base}/label`, { headers: h.headers, body: approve() });
  const detail = await call(h.app, 'GET', base, { headers: h.headers });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.order.label.status, 'created');
  assert.equal(detail.body.order.label.trackingPin, '123456789012');
  assert.equal(detail.body.order.labelEligibility.canBuy, false);
  assert.equal(detail.body.order.labelEligibility.code, 'already-labelled');
  assert.doesNotMatch(JSON.stringify(detail.body), /artifact|https:\/\/api\.canadapost/i);
  assert.equal(detail.body.order.label.approvedBy, undefined, 'admin ids stay on the server');

  const list = await call(h.app, 'GET', '/api/admin/orders', { headers: h.headers });
  assert.equal(list.status, 200);
  assert.equal(list.body.orders[0].label.trackingPin, '123456789012');
  assert.doesNotMatch(JSON.stringify(list.body), /artifact|https:\/\/api\.canadapost/i);

  const fresh = setup(t); // replaces the stubs: an order nobody has bought a label for
  const open = await call(fresh.app, 'GET', base, { headers: fresh.headers });
  assert.deepEqual([open.body.order.label, open.body.order.labelEligibility.canBuy, open.body.order.labelEligibility.switchedOff], [null, true, false]);
});

test('the SHIPPING base the routes use is the one the fake follows (a guard against a silently different endpoint)', () => {
  assert.equal(SHIPPING, `${canadaPost.BASE}/shipping/v1`);
});
