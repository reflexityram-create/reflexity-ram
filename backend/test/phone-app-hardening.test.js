// The properties an independent review (PR #92) proved could be broken without any test noticing. Each test here fails
// when the guard it names is removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MemoryStore } = require('express-rate-limit');

process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET ||= 'phone-app-hardening-unit-test-secret';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_phone_app_hardening';

const { memoryModel } = require('./helpers/memoryModel');
const User = require('../src/models/User');
const AdminEvent = require('../src/models/AdminEvent');
const Order = require('../src/models/Order');
const { createDeviceRouter, hashPairingCode, normalizePairingCode, MAX_ACTIVE_DEVICES } = require('../src/routes/device');
const { createAdminDevicesRouter, MAX_OPEN_CODES } = require('../src/routes/adminDevices');
const { createAuthenticateDevice, hashDeviceToken, STALE_AFTER_MS } = require('../src/middleware/deviceAuth');
const { createOptionalAuth, createAuthenticate } = require('../src/middleware/auth');
const { createPairLimiter, createDeviceLimiter } = require('../src/middleware/phoneLimiters');
const { recordAdminEvent, eventWaiter } = require('../src/utils/adminEvents');

const ADMIN = { _id: new mongoose.Types.ObjectId(), email: 'owner@example.com', firstName: 'Owner', lastName: 'Admin', role: 'admin', isActive: true, authVersion: 3 };
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(app, method, path, { headers = {}, body, raw } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...(body || raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function world({ latencyMs = 0, users = [ADMIN], now = Date.now, record } = {}) {
  const UserModel = memoryModel(users);
  const DeviceModel = memoryModel([], { latencyMs });
  const PairingModel = memoryModel([], { latencyMs });
  const EventModel = memoryModel([], { latencyMs });
  const bus = new EventEmitter();
  const recorded = [];
  const device = createDeviceRouter({
    DeviceModel, PairingModel, UserModel, EventModel, now,
    authenticateDevice: createAuthenticateDevice({ DeviceModel, UserModel, now }),
    makeWaiter: () => eventWaiter(bus),
    record: record || (async (event) => { recorded.push(event); return event; }),
  });
  const app = express();
  app.use('/api/device', device);
  return { app, UserModel, DeviceModel, PairingModel, EventModel, bus, recorded };
}
const seedCode = (w, code, extra = {}) => w.PairingModel.create({
  user: ADMIN._id, codeHash: hashPairingCode(normalizePairingCode(code)), expiresAt: new Date(Date.now() + 600000), ...extra,
});
const pair = (w, code, label = 'Pixel') => call(w.app, 'POST', '/api/device/pair', { body: { code, label } });

// ── pairing ────────────────────────────────────────────────────────────────────
test('a pairing code redeemed twice AT ONCE makes exactly one device', async () => {
  const w = world({ latencyMs: 15 });
  await seedCode(w, 'RACE-2345');
  const results = await Promise.all(Array.from({ length: 6 }, () => pair(w, 'RACE-2345')));
  assert.equal(results.filter((r) => r.status === 201).length, 1, results.map((r) => r.status).join());
  assert.equal(w.DeviceModel.docs.length, 1);
});

test('the five-phone limit holds even when several codes are redeemed at the same moment', async () => {
  const w = world({ latencyMs: 15 });
  for (let i = 0; i < 4; i += 1) {
    await w.DeviceModel.create({ user: ADMIN._id, label: `Old ${i}`, tokenHash: `h${i}`, authVersion: 3 });
  }
  for (let i = 0; i < 4; i += 1) await seedCode(w, `CAPS-000${i + 2}`);
  await Promise.all([0, 1, 2, 3].map((i) => pair(w, `CAPS-000${i + 2}`)));
  const active = w.DeviceModel.docs.filter((d) => !d.revokedAt).length;
  assert.ok(active <= MAX_ACTIVE_DEVICES, `${active} phones are active`);
});

test('a deactivated admin cannot pair, and a deactivated admin\'s phone stops working', async () => {
  const w = world();
  await seedCode(w, 'GONE-2345');
  w.UserModel.docs[0].isActive = false;
  assert.equal((await pair(w, 'GONE-2345')).status, 400);
  w.UserModel.docs[0].isActive = true;
  await seedCode(w, 'BACK-2345');
  const { token } = (await pair(w, 'BACK-2345')).body;
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 200);
  w.UserModel.docs[0].isActive = false;
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 401);
});

test('labels and codes that are not strings are refused or ignored, never stored as "[object Object]"', async () => {
  const w = world();
  await seedCode(w, 'FFFF-2222');
  assert.equal((await call(w.app, 'POST', '/api/device/pair', { body: { code: ['FFFF', '2222'], label: 'x' } })).status, 400, 'an array is not a code');
  assert.equal((await call(w.app, 'POST', '/api/device/pair', { body: { code: { $ne: null }, label: 'x' } })).status, 400);
  const ok = await call(w.app, 'POST', '/api/device/pair', { body: { code: 'FFFF-2222', label: { $ne: 1 }, appVersion: { a: 1 } } });
  assert.equal(ok.status, 201);
  assert.equal(w.DeviceModel.docs[0].label, 'Phone', 'a non-text label falls back');
  assert.equal(w.DeviceModel.docs[0].appVersion, undefined);
});

test('the owner\'s phones are told when a new phone is paired', async () => {
  const w = world();
  await seedCode(w, 'NEWB-2345');
  assert.equal((await pair(w, 'NEWB-2345', 'Pixel 8a')).status, 201);
  assert.equal(w.recorded.length, 1);
  assert.equal(w.recorded[0].type, 'device.paired');
  assert.equal(w.recorded[0].priority, 'high');
  assert.match(w.recorded[0].body, /"Pixel 8a"/);
  assert.equal((await pair(w, 'NEWB-2345')).status, 400);
  assert.equal(w.recorded.length, 1, 'a refused pairing tells nobody');
});

test('a body that is not JSON gets a plain 400 and never reaches the site-wide error handler (which logs the body\'s first characters)', async () => {
  const w = world();
  const logged = [];
  w.app.use((err, req, res, next) => { logged.push(String(err.stack || err)); res.status(500).json({ error: 'handled globally' }); });
  const r = await call(w.app, 'POST', '/api/device/pair', { raw: '{"code": K7QM-2XVD, "label": "x"}' });
  assert.equal(r.status, 400);
  assert.deepEqual(logged, [], 'nothing was handed to the global handler');
  assert.ok(!JSON.stringify(r.body).includes('K7QM'));
  const big = await call(w.app, 'POST', '/api/device/pair', { raw: JSON.stringify({ code: 'A'.repeat(10000) }) });
  assert.equal(big.status, 413);
});

test('pairing codes are stored under a keyed hash, not a bare SHA-256 anyone could recompute', () => {
  const bare = require('node:crypto').createHash('sha256').update('ABCD2345').digest('hex');
  assert.notEqual(hashPairingCode('ABCD2345'), bare);
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a different secret';
  try { assert.notEqual(hashPairingCode('ABCD2345'), (process.env.JWT_SECRET = previous, hashPairingCode('ABCD2345'))); } finally { process.env.JWT_SECRET = previous; }
});

// ── the device token and its session ───────────────────────────────────────────
test('a phone that has not been seen for 60 days must be paired again', async () => {
  let clock = Date.now();
  const w = world({ now: () => clock });
  await seedCode(w, 'IDLE-2345');
  const { token } = (await pair(w, 'IDLE-2345')).body;
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 200);
  clock += STALE_AFTER_MS - 60_000;
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 200, 'still fine just inside the limit (and that poll counts as seen)');
  clock += STALE_AFTER_MS + 60_000;
  const refused = await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) });
  assert.equal(refused.status, 401);
  assert.equal(refused.body.code, 'DEVICE_REVOKED');
});

test('each poll marks the phone as seen, at most once a minute', async () => {
  let clock = Date.now();
  const w = world({ now: () => clock });
  await seedCode(w, 'SEEN-2345');
  const { token } = (await pair(w, 'SEEN-2345')).body;
  const stamp = () => new Date(w.DeviceModel.docs[0].lastSeenAt).getTime();
  const first = stamp();
  clock += 30_000;
  await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) });
  assert.equal(stamp(), first, 'not rewritten within a minute');
  clock += 120_000;
  await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) });
  assert.equal(stamp(), clock, 'rewritten after a minute');
});

// ── the event feed ─────────────────────────────────────────────────────────────
async function pairedFeed(extra) {
  const w = world(extra);
  await seedCode(w, 'FEED-2345');
  const { token } = (await pair(w, 'FEED-2345')).body;
  return { w, token };
}

test('a poll returns at most 50 events, oldest first, and says no-store', async () => {
  const { w, token } = await pairedFeed();
  const cursor = (await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).body.cursor;
  for (let i = 0; i < 60; i += 1) await w.EventModel.create({ type: 'x', title: `e${i}`, body: '' });
  const r = await call(w.app, 'GET', `/api/device/events?after=${cursor}`, { headers: bearer(token) });
  assert.equal(r.body.events.length, 50);
  assert.equal(r.body.events[0].title, 'e0');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const rest = await call(w.app, 'GET', `/api/device/events?after=${r.body.cursor}`, { headers: bearer(token) });
  assert.equal(rest.body.events.length, 10, 'the next poll continues where the first stopped');
});

test('a phone that hangs up leaves no listener behind, whether it hangs up while waiting or during the first read', async () => {
  const { w, token } = await pairedFeed({ latencyMs: 0 });
  const cursor = (await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).body.cursor;

  const abortAfter = async (ms, latency) => {
    const slow = world({ latencyMs: latency });
    slow.DeviceModel.docs.push(...w.DeviceModel.docs);
    slow.UserModel.docs.push(...w.UserModel.docs.filter((u) => !slow.UserModel.docs.some((x) => String(x._id) === String(u._id))));
    const server = http.createServer(slow.app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${server.address().port}/api/device/events?after=${cursor}&wait=20`, { headers: bearer(token), signal: controller.signal }).catch(() => null);
    await sleep(ms);
    controller.abort();
    await pending;
    await sleep(60);
    const left = slow.bus.listenerCount('event');
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    return left;
  };
  assert.equal(await abortAfter(150, 0), 0, 'hung up while waiting');
  assert.equal(await abortAfter(60, 250), 0, 'hung up during the first database read');
});

// ── the owner-side routes with their REAL guard ────────────────────────────────
function guarded() {
  const DeviceModel = memoryModel();
  const PairingModel = memoryModel();
  const customer = { _id: new mongoose.Types.ObjectId(), email: 'buyer@example.com', role: 'customer', isActive: true, authVersion: 0 };
  const users = new Map([[String(ADMIN._id), ADMIN], [String(customer._id), customer]]);
  const realFind = User.findById;
  User.findById = (id) => ({ select: async () => users.get(String(id)) || null });
  const app = express();
  app.use(require('cookie-parser')());                  // as in the real server: a cookie really can carry the login
  app.use('/api/admin/devices', createAdminDevicesRouter({ DeviceModel, PairingModel, record: async () => null }));
  // device-minted sessions are checked against AdminDevice through the real authenticate(): stub its model
  const AdminDevice = require('../src/models/AdminDevice');
  const realExists = AdminDevice.exists;
  AdminDevice.exists = (filter) => DeviceModel.exists(filter);
  return { app, DeviceModel, PairingModel, customer, restore: () => { User.findById = realFind; AdminDevice.exists = realExists; } };
}
const login = (user, extra = {}) => jwt.sign({ id: user._id, av: user.authVersion || 0, ...extra }, process.env.JWT_SECRET, { expiresIn: 3600 });

test('the real guard on /api/admin/devices: no token 401, a customer 403, the cookie alone 401, an admin through', async () => {
  const g = guarded();
  try {
    assert.equal((await call(g.app, 'POST', '/api/admin/devices/pairing')).status, 401);
    assert.equal((await call(g.app, 'POST', '/api/admin/devices/pairing', { headers: bearer(login(g.customer)) })).status, 403);
    assert.equal((await call(g.app, 'POST', '/api/admin/devices/pairing', { headers: { cookie: `accessToken=${login(ADMIN)}` } })).status, 401, 'an ambient cookie is not enough to mint a credential');
    assert.equal((await call(g.app, 'POST', '/api/admin/devices/pairing', { headers: bearer(login(ADMIN)) })).status, 201);
    assert.equal((await call(g.app, 'GET', '/api/admin/devices', { headers: bearer(login(ADMIN)) })).status, 200);
    assert.equal((await call(g.app, 'GET', '/api/admin/devices', { headers: bearer(login(g.customer)) })).status, 403);
  } finally { g.restore(); }
});

test('a session minted by a phone cannot pair another phone or remove one, but can still look', async () => {
  const g = guarded();
  try {
    const phone = await g.DeviceModel.create({ user: ADMIN._id, label: 'Pixel', tokenHash: 'h', authVersion: 3 });
    const minted = login(ADMIN, { av: 3, dev: phone._id });
    assert.equal((await call(g.app, 'POST', '/api/admin/devices/pairing', { headers: bearer(minted) })).status, 403);
    assert.equal((await call(g.app, 'DELETE', `/api/admin/devices/${phone._id}`, { headers: bearer(minted) })).status, 403);
    assert.equal((await call(g.app, 'GET', '/api/admin/devices', { headers: bearer(minted) })).status, 200);
    assert.equal(g.PairingModel.docs.length, 0, 'no code was made');
    assert.equal(phone.revokedAt, undefined);
    const normal = await call(g.app, 'DELETE', `/api/admin/devices/${phone._id}`, { headers: bearer(login(ADMIN, { av: 3 })) });
    assert.equal(normal.status, 200, 'the owner\'s normal sign-in still can');
  } finally { g.restore(); }
});

test('promoting or demoting accounts is refused to a phone-minted session too', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/routes/admin.js'), 'utf8');
  assert.match(source, /router\.patch\(\s*'\/users\/:id',\s*denyDeviceSession,/);
});

test('twelve pairing-code requests at once never leave more than five codes open', async () => {
  const DeviceModel = memoryModel();
  const PairingModel = memoryModel([], { latencyMs: 15 });
  const app = express();
  app.use('/api/admin/devices', createAdminDevicesRouter({ DeviceModel, PairingModel, guard: [(req, res, next) => { req.user = ADMIN; next(); }] }));
  await Promise.all(Array.from({ length: 12 }, () => call(app, 'POST', '/api/admin/devices/pairing')));
  const open = PairingModel.docs.filter((d) => !d.usedAt).length;
  assert.ok(open <= MAX_OPEN_CODES, `${open} codes open`);
});

// ── a phone-minted session and optionalAuth ────────────────────────────────────
test('optionalAuth also drops a session whose phone was removed', async () => {
  const UserModel = memoryModel([ADMIN]);
  const DeviceModel = memoryModel();
  const phone = await DeviceModel.create({ user: ADMIN._id, label: 'p', tokenHash: 'h', authVersion: 3 });
  const optional = createOptionalAuth({ UserModel, DeviceModel });
  const app = express();
  app.get('/who', optional, (req, res) => res.json({ user: req.user ? String(req.user.email) : null }));
  const minted = login(ADMIN, { av: 3, dev: phone._id });
  assert.equal((await call(app, 'GET', '/who', { headers: bearer(minted) })).body.user, 'owner@example.com');
  phone.revokedAt = new Date();
  const after = await call(app, 'GET', '/who', { headers: bearer(minted) });
  assert.equal(after.status, 401, 'a bad token in a header is an error, never silently anonymous');
  assert.equal(after.body.user, undefined);
  const stillAuth = createAuthenticate({ UserModel, DeviceModel });
  assert.ok(stillAuth, 'authenticate is covered in phone-app-api.test.js');
});

// ── the limiters ───────────────────────────────────────────────────────────────
test('the pairing limiter allows ten tries per window and then answers 429; the poll limiter is much wider', async () => {
  const app = express();
  app.use('/pair', createPairLimiter({ store: new MemoryStore() }), (req, res) => res.json({ ok: true }));
  app.use('/poll', createDeviceLimiter({ store: new MemoryStore() }), (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await fetch(`${base}/pair`)).status);
    assert.deepEqual(statuses, [...Array(10).fill(200), 429, 429]);
    let polled = 0;
    for (let i = 0; i < 100; i += 1) if ((await fetch(`${base}/poll`)).status === 200) polled += 1;
    assert.equal(polled, 100, 'a phone that polls twice a minute never gets near the poll limit');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('server.js uses those limiters for the right paths, ahead of the site-wide one', () => {
  const server = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  assert.match(server, /const devicePairLimiter = createPairLimiter\(\);/);
  assert.match(server, /const deviceLimiter = createDeviceLimiter\(\);/);
  assert.match(server, /app\.use\('\/api\/device\/pair', devicePairLimiter\);/);
  assert.ok(server.indexOf("app.use('/api/device/pair', devicePairLimiter)") < server.indexOf("app.use('/api/device', deviceLimiter"));
  assert.ok(server.indexOf("app.use('/api/device', deviceLimiter") < server.indexOf('app.use(globalLimiter)'));
});

// ── alerts: once each, in order, and private ───────────────────────────────────
test('the same alert key is recorded once; a repeat is silent and wakes nobody', async () => {
  const keys = new Set();
  const model = { create: async (doc) => {
    if (doc.dedupeKey) { if (keys.has(doc.dedupeKey)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; } keys.add(doc.dedupeKey); }
    return { ...doc, _id: new mongoose.Types.ObjectId() };
  } };
  const emitter = new EventEmitter();
  let woke = 0; emitter.on('event', () => { woke += 1; });
  const errors = [];
  const logger = { error: (m) => errors.push(m) };
  assert.ok(await recordAdminEvent({ type: 'order.paid', title: 'x', dedupeKey: 'order.paid:1' }, { Model: model, emitter, logger }));
  assert.equal(await recordAdminEvent({ type: 'order.paid', title: 'x', dedupeKey: 'order.paid:1' }, { Model: model, emitter, logger }), null);
  assert.ok(await recordAdminEvent({ type: 'order.paid', title: 'x', dedupeKey: 'order.paid:2' }, { Model: model, emitter, logger }));
  assert.equal(woke, 2);
  assert.deepEqual(errors, [], 'a duplicate is not an error');
  assert.ok(AdminEvent.schema.path('dedupeKey'));
  assert.ok(AdminEvent.schema.indexes().some(([keysSpec, opts]) => keysSpec.dedupeKey === 1 && opts.unique && opts.sparse), 'unique and sparse in the database');
});

test('alerts written at the same moment keep the order they were asked for', async () => {
  let n = 0;
  const finished = [];
  const model = { create: async (doc) => {
    const id = ++n;                                    // the id is made when the insert starts...
    await sleep(doc.title === 'first' ? 40 : 1);        // ...and the first one is the slow one
    finished.push([id, doc.title]);
    return { ...doc, _id: id };
  } };
  await Promise.all([
    recordAdminEvent({ type: 'a', title: 'first' }, { Model: model, emitter: new EventEmitter() }),
    recordAdminEvent({ type: 'a', title: 'second' }, { Model: model, emitter: new EventEmitter() }),
  ]);
  assert.deepEqual(finished, [[1, 'first'], [2, 'second']], 'ids and commit order agree, so a phone\'s cursor never skips one');
});

// ── the call sites: what each alert says, and that it says nothing private ──────
function captureEvents() {
  const saved = [];
  const keys = new Set();
  const realCreate = AdminEvent.create;
  const realState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  AdminEvent.create = async (doc) => {
    if (doc.dedupeKey) { if (keys.has(doc.dedupeKey)) { const e = new Error('dup'); e.code = 11000; throw e; } keys.add(doc.dedupeKey); }
    saved.push(doc);
    return { ...doc, _id: new mongoose.Types.ObjectId() };
  };
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
  return { saved, restore: () => { AdminEvent.create = realCreate; if (realState) Object.defineProperty(mongoose.connection, 'readyState', realState); else delete mongoose.connection.readyState; } };
}
const PRIVATE = ['buyer@example.com', 'Sam', 'Queen St', '416', 'Toronto', 'M5H'];
const assertPrivate = (event) => { for (const secret of PRIVATE) assert.ok(!JSON.stringify(event).includes(secret), `${event.type} leaks "${secret}"`); };
const paidOrder = (extra = {}) => ({
  _id: new mongoose.Types.ObjectId(), orderNumber: 'RFX-TEST-1', total: 281.3, paymentMethod: 'stripe', paymentStatus: 'paid', status: 'processing',
  guestEmail: 'buyer@example.com', createdAt: new Date(), items: [{ qty: 2, name: '16GB DDR4' }],
  shippingAddress: { firstName: 'Sam', lastName: 'Buyer', line1: '100 Queen St W', city: 'Toronto', zip: 'M5H 2N2', phone: '+14165550123' },
  ...extra,
});

test('a lead alert says only what kind of request and how many, whatever the stranger typed, and is announced once per request id', async () => {
  const { createLeadRouter } = require('../src/routes/leads');
  const cap = captureEvents();
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/leads', createLeadRouter({ sendLead: async () => undefined }));
    const lead = {
      intent: 'buy', requestId: '123e4567-e89b-42d3-a456-426614174000', name: 'Sam Buyer', email: 'buyer@example.com', phone: '416-555-0123',
      productType: 'URGENT: call 416 555 0100 Sam, Queen St', itemTitle: 'Sam at 100 Queen St W', quantity: 12,
    };
    assert.equal((await call(app, 'POST', '/api/leads', { body: lead })).status, 202);
    assert.equal((await call(app, 'POST', '/api/leads', { body: lead })).status, 202, 'a resubmitted form');
    assert.equal(cap.saved.length, 1, 'announced once');
    assert.equal(cap.saved[0].type, 'lead.new');
    assert.equal(cap.saved[0].dedupeKey, 'lead.new:123e4567-e89b-42d3-a456-426614174000');
    assert.equal(cap.saved[0].body, 'Wants to buy · qty 12 · details in your email');
    assertPrivate(cap.saved[0]);
  } finally { cap.restore(); }
});

test('shipping and delivery alerts come from the carrier sync, once each, with no customer details', async () => {
  const { syncOrder } = require('../src/utils/trackingSync');
  const cap = captureEvents();
  const order = paidOrder({ status: 'processing', trackingNumber: 'CP1', shippingAddress: paidOrder().shippingAddress });
  const recorded = [];
  const deps = {
    trackParcel: async () => ({ hasShipped: true, shippedOn: '2026-10-13', delivered: false, latest: {}, expectedDeliveryDate: '' }),
    sendEmail: async () => undefined, notifyShipment: async () => ({ status: 'sent' }), scheduleReview: async () => undefined,
    recordEvent: async (event) => { recorded.push(event); return recordAdminEvent(event); }, now: () => new Date(),
  };
  const realUpdate = Order.updateOne;
  Order.updateOne = async () => ({ matchedCount: 1, modifiedCount: 1 });
  try {
    await syncOrder(order, deps);
    assert.deepEqual(recorded.map((e) => e.type), ['order.shipped']);
    assert.equal(recorded[0].dedupeKey, `order.shipped:${order._id}`);
    assert.equal(recorded[0].priority, 'low');
    assertPrivate(cap.saved[0]);
  } finally { Order.updateOne = realUpdate; cap.restore(); }
});

test('a Stripe refund alert is sent once even when Stripe delivers the event again, and says nothing private', async () => {
  const stripeRouter = require('../src/routes/stripe');
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phone_hardening';
  const cap = captureEvents();
  const refunded = (id) => paidOrder({ _id: id, statusHistory: [], reviewRequest: {}, save: async () => undefined });
  const realFindOne = Order.findOne; const realUpdate = Order.updateOne;
  const order = refunded(new mongoose.Types.ObjectId());
  Order.findOne = async () => order;
  Order.updateOne = async () => ({ modifiedCount: 1 });
  const app = express();
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/stripe', stripeRouter);
  const deliver = async (eventId, charge) => {
    const payload = JSON.stringify({ id: eventId, object: 'event', type: 'charge.refunded', data: { object: charge } });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      return (await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) },
        body: payload,
      })).status;
    } finally { await new Promise((resolve) => server.close(resolve)); }
  };
  try {
    const full = { id: 'ch_1', object: 'charge', refunded: true, payment_intent: 'pi_1', amount_refunded: 28130 };
    assert.equal(await deliver('evt_full', full), 200);
    assert.equal(await deliver('evt_full', full), 200, 'redelivered');
    assert.deepEqual(cap.saved.map((e) => e.type), ['order.refunded'], 'one alert');
    assertPrivate(cap.saved[0]);
    const partial = { id: 'ch_1', object: 'charge', refunded: false, payment_intent: 'pi_1', amount_refunded: 5000 };
    assert.equal(await deliver('evt_partial', partial), 200);
    assert.equal(await deliver('evt_partial', partial), 200);
    assert.deepEqual(cap.saved.map((e) => e.type), ['order.refunded', 'order.partial_refund']);
  } finally { Order.findOne = realFindOne; Order.updateOne = realUpdate; cap.restore(); }
});

test('the success page poll re-announces a fresh paid order whose first alert was lost, once, and never an old one', async () => {
  const stripeRouter = require('../src/routes/stripe');
  const cap = captureEvents();
  const realFindOne = Order.findOne;
  let current;
  Order.findOne = async () => current;
  stripeRouter.setCheckoutDependenciesForTest({ decrementStock: async () => false, retrieveSession: async () => { throw new Error('not needed: the order exists'); } });
  const app = express();
  app.use('/api/stripe', stripeRouter);
  const poll = async () => (await call(app, 'GET', '/api/stripe/session-status?session_id=cs_test_abc')).status;
  try {
    current = paidOrder({ stockDecremented: true, items: [{ qty: 2, name: '16GB DDR4', price: 135 }] });
    assert.equal(await poll(), 200);
    assert.equal(await poll(), 200);
    assert.deepEqual(cap.saved.map((e) => [e.type, e.dedupeKey]), [['order.paid', `order.paid:${current._id}`]], 'announced once across repeats');
    assertPrivate(cap.saved[0]);

    cap.saved.length = 0;
    current = paidOrder({ stockDecremented: true, createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) });
    assert.equal(await poll(), 200);
    assert.deepEqual(cap.saved, [], 'an old order reopened from a bookmark does not alert');
  } finally { stripeRouter.setCheckoutDependenciesForTest(); Order.findOne = realFindOne; cap.restore(); }
});
