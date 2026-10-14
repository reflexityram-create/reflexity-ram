const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET ||= 'phone-app-api-unit-test-secret';

const { memoryModel } = require('./helpers/memoryModel');
const { createDeviceRouter, hashPairingCode, normalizePairingCode } = require('../src/routes/device');
const { createAdminDevicesRouter } = require('../src/routes/adminDevices');
const { createAuthenticateDevice, hashDeviceToken } = require('../src/middleware/deviceAuth');
const { createAuthenticate } = require('../src/middleware/auth');
const { recordAdminEvent, eventWaiter, describeOrder, publicEvent } = require('../src/utils/adminEvents');
const { EventEmitter } = require('node:events');

const ADMIN = { _id: new mongoose.Types.ObjectId(), email: 'owner@example.com', firstName: 'Owner', lastName: 'Admin', role: 'admin', isActive: true, authVersion: 3 };

function world({ users = [ADMIN], now = Date.now } = {}) {
  const UserModel = memoryModel(users);
  const DeviceModel = memoryModel();
  const PairingModel = memoryModel();
  const EventModel = memoryModel();
  const bus = new EventEmitter();
  const device = createDeviceRouter({
    DeviceModel, PairingModel, UserModel, EventModel, now,
    authenticateDevice: createAuthenticateDevice({ DeviceModel, UserModel, now }),
    makeWaiter: () => eventWaiter(bus),
  });
  const app = express();
  app.use('/api/device', device);
  return { app, UserModel, DeviceModel, PairingModel, EventModel, bus };
}

async function call(app, method, path, { headers = {}, body } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const seedPairing = async (w, code = 'ABCD-2345', { user = ADMIN, expiresInMs = 10 * 60 * 1000, usedAt } = {}) => w.PairingModel.create({
  user: user._id, codeHash: hashPairingCode(normalizePairingCode(code)), expiresAt: new Date(Date.now() + expiresInMs), ...(usedAt ? { usedAt } : {}),
  authVersion: user.authVersion ?? 0,
});
const pair = (w, code = 'ABCD-2345', label = 'Pixel 8a') => call(w.app, 'POST', '/api/device/pair', { body: { code, label, appVersion: '1.0.0' } });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('a pairing code is exchanged once for a device token, and only the hash of that token is stored', async () => {
  const w = world();
  await seedPairing(w);

  const first = await pair(w, 'abcd 2345');                      // typed by hand: case and spacing do not matter
  assert.equal(first.status, 201);
  assert.match(first.body.token, /^rfxd_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.body.user.email, 'owner@example.com');
  assert.equal(w.DeviceModel.docs.length, 1);
  const stored = w.DeviceModel.docs[0];
  assert.equal(stored.tokenHash, hashDeviceToken(first.body.token));
  assert.ok(!JSON.stringify(stored).includes(first.body.token), 'the plain token is never stored');
  assert.equal(stored.authVersion, 3);
  assert.equal(stored.label, 'Pixel 8a');

  const second = await pair(w, 'ABCD-2345');
  assert.equal(second.status, 400, 'a code works once');
  assert.equal(w.DeviceModel.docs.length, 1);
});

test('wrong, short, expired and not-an-admin codes are all refused the same way', async () => {
  const w = world({ users: [ADMIN, { _id: new mongoose.Types.ObjectId(), email: 'buyer@example.com', role: 'customer', isActive: true }] });
  await seedPairing(w, 'EXPR-2345', { expiresInMs: -1000 });
  await seedPairing(w, 'CUST-2345', { user: w.UserModel.docs[1] });
  const answers = [];
  for (const code of ['WXYZ-2345', 'AB', '', 'EXPR-2345', 'CUST-2345']) {
    const r = await pair(w, code);
    assert.equal(r.status, 400, `code "${code}" must be refused`);
    answers.push(r.body.error);
  }
  assert.equal(new Set(answers).size, 1, 'one message for every refusal, so nothing can be probed');
  assert.equal(w.DeviceModel.docs.length, 0);
});

test('five paired phones is the limit', async () => {
  const w = world();
  for (let i = 0; i < 5; i += 1) {
    await seedPairing(w, `AAAA-000${i + 2}`);
    assert.equal((await pair(w, `AAAA-000${i + 2}`)).status, 201);
  }
  await seedPairing(w, 'ZZZZ-2345');
  const sixth = await pair(w, 'ZZZZ-2345');
  assert.equal(sixth.status, 409);
});

async function pairedPhone(w) {
  await seedPairing(w, 'PAIR-2345');
  return (await pair(w, 'PAIR-2345')).body;
}

test('a device token buys a 24 hour admin session tied to that device', async () => {
  const w = world();
  const { token, deviceId } = await pairedPhone(w);
  const r = await call(w.app, 'POST', '/api/device/session', { headers: bearer(token) });
  assert.equal(r.status, 200);
  const decoded = jwt.verify(r.body.accessToken, process.env.JWT_SECRET);
  assert.equal(String(decoded.id), String(ADMIN._id));
  assert.equal(decoded.av, 3);
  assert.equal(decoded.dev, deviceId);
  assert.ok(decoded.exp - decoded.iat === 24 * 60 * 60);
  assert.equal(r.body.user.role, 'admin');
});

test('no token, a wrong token, a revoked device and a changed admin password are all turned away', async () => {
  const w = world();
  const { token } = await pairedPhone(w);
  assert.equal((await call(w.app, 'POST', '/api/device/session')).status, 401);
  assert.equal((await call(w.app, 'POST', '/api/device/session', { headers: bearer('rfxd_' + 'x'.repeat(43)) })).status, 401);
  assert.equal((await call(w.app, 'POST', '/api/device/session', { headers: bearer(jwt.sign({ id: ADMIN._id }, process.env.JWT_SECRET)) })).status, 401, 'an ordinary login token is not a device token');
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 200);

  w.UserModel.docs[0].authVersion = 4;                            // password changed
  assert.equal((await call(w.app, 'POST', '/api/device/session', { headers: bearer(token) })).status, 401);
  w.UserModel.docs[0].authVersion = 3;
  assert.equal((await call(w.app, 'POST', '/api/device/session', { headers: bearer(token) })).status, 200);

  w.UserModel.docs[0].role = 'customer';                          // no longer an admin
  assert.equal((await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).status, 401);
  w.UserModel.docs[0].role = 'admin';

  w.DeviceModel.docs[0].revokedAt = new Date();
  assert.equal((await call(w.app, 'POST', '/api/device/session', { headers: bearer(token) })).status, 401);
});

test('events: no cursor gives a cursor from now, a cursor gives what is newer, oldest first', async () => {
  const w = world();
  const { token } = await pairedPhone(w);
  const old = await w.EventModel.create({ type: 'order.paid', title: 'old', body: '' });

  const start = await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) });
  assert.deepEqual(start.body.events, [], 'a new phone is not flooded with history');
  assert.equal(start.body.cursor, String(old._id));

  const a = await w.EventModel.create({ type: 'order.paid', title: 'A', body: 'a', priority: 'high', path: '/admin/orders?order=1' });
  const b = await w.EventModel.create({ type: 'lead.new', title: 'B', body: '' });
  const next = await call(w.app, 'GET', `/api/device/events?after=${start.body.cursor}`, { headers: bearer(token) });
  assert.deepEqual(next.body.events.map((e) => e.title), ['A', 'B']);
  assert.equal(next.body.cursor, String(b._id));
  assert.equal(next.body.events[0].priority, 'high');
  assert.equal(next.body.events[0].path, '/admin/orders?order=1');

  const empty = await call(w.app, 'GET', `/api/device/events?after=${next.body.cursor}`, { headers: bearer(token) });
  assert.deepEqual(empty.body.events, []);
  assert.equal(empty.body.cursor, String(b._id), 'the cursor does not move when nothing is new');
  assert.ok(a);
});

test('events: a held-open request answers the moment an event is written, and gives up quietly after the wait', async () => {
  const w = world();
  const { token } = await pairedPhone(w);
  const cursor = (await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).body.cursor;

  const started = Date.now();
  const pending = call(w.app, 'GET', `/api/device/events?after=${cursor}&wait=5`, { headers: bearer(token) });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const event = await w.EventModel.create({ type: 'order.paid', title: 'Fresh', body: '' });
  w.bus.emit('event', event);
  const answer = await pending;
  assert.deepEqual(answer.body.events.map((e) => e.title), ['Fresh']);
  assert.ok(Date.now() - started < 3000, 'it did not sit out the whole wait');

  const quiet = await call(w.app, 'GET', `/api/device/events?after=${answer.body.cursor}&wait=1`, { headers: bearer(token) });
  assert.deepEqual(quiet.body.events, []);
  assert.equal(w.bus.listenerCount('event'), 0, 'no listener is left behind');
});

test('events: a malformed cursor starts from now instead of failing, and a huge wait is capped', async () => {
  const w = world();
  const { token } = await pairedPhone(w);
  const r = await call(w.app, 'GET', '/api/device/events?after=%24gt&wait=999999', { headers: bearer(token) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events, []);
  assert.match(r.body.cursor, /^[a-f0-9]{24}$/);
});

test('events: the wait is capped at 30 seconds and a negative or non-numeric wait does not wait at all', async () => {
  const asked = [];
  const w = world();
  w.app = express().use('/api/device', createDeviceRouter({
    DeviceModel: w.DeviceModel, PairingModel: w.PairingModel, UserModel: w.UserModel, EventModel: w.EventModel,
    authenticateDevice: createAuthenticateDevice({ DeviceModel: w.DeviceModel, UserModel: w.UserModel }),
    makeWaiter: () => ({ wait: async (ms) => { asked.push(ms); return false; }, cancel() {} }),
  }));
  const { token } = await pairedPhone(w);
  const cursor = (await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).body.cursor;
  for (const wait of ['999999', '-5', 'abc', '', '12']) {
    await call(w.app, 'GET', `/api/device/events?after=${cursor}&wait=${wait}`, { headers: bearer(token) });
  }
  assert.deepEqual(asked, [30000, 12000]);
});

test('events: an event written between the read and the wait still wakes the request at once', async () => {
  const w = world();
  const { token } = await pairedPhone(w);
  const cursor = (await call(w.app, 'GET', '/api/device/events', { headers: bearer(token) })).body.cursor;
  const realFind = w.EventModel.find;
  let first = true;
  w.EventModel.find = (filter) => {
    const answer = realFind(filter);
    if (!first) return answer;
    first = false;
    const then = answer.then.bind(answer);
    answer.then = (resolve, reject) => then((value) => {
      // the read has its answer (nothing yet) - and now an order lands
      const doc = { _id: new mongoose.Types.ObjectId(), type: 'order.paid', title: 'Raced', body: '', createdAt: new Date() };
      w.EventModel.docs.push(doc);
      w.bus.emit('event', doc);
      return resolve(value);
    }, reject);
    return answer;
  };
  const started = Date.now();
  const r = await call(w.app, 'GET', `/api/device/events?after=${cursor}&wait=3`, { headers: bearer(token) });
  assert.deepEqual(r.body.events.map((e) => e.title), ['Raced']);
  assert.ok(Date.now() - started < 1500, `it answered in ${Date.now() - started} ms, not after the full wait`);
});

// ── the owner-side routes ──
function adminWorld() {
  const w = world();
  const recorded = [];
  const admin = createAdminDevicesRouter({
    DeviceModel: w.DeviceModel, PairingModel: w.PairingModel,
    guard: [(req, res, next) => { req.user = ADMIN; next(); }],
    record: async (event) => { recorded.push(event); return event; },
  });
  const app = express();
  app.use('/api/admin/devices', admin);
  return { ...w, app, recorded };
}

test('the Security page makes a pairing code that is stored only as a hash and can pair a phone', async () => {
  const w = adminWorld();
  const made = await call(w.app, 'POST', '/api/admin/devices/pairing');
  assert.equal(made.status, 201);
  assert.match(made.body.code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.ok(Date.parse(made.body.expiresAt) - Date.now() <= 10 * 60 * 1000 + 1000);
  assert.ok(!JSON.stringify(w.PairingModel.docs).includes(made.body.code.replace('-', '')));
  const paired = await pair({ ...w, app: express().use('/api/device', createDeviceRouter({
    DeviceModel: w.DeviceModel, PairingModel: w.PairingModel, UserModel: w.UserModel, EventModel: w.EventModel,
    authenticateDevice: createAuthenticateDevice({ DeviceModel: w.DeviceModel, UserModel: w.UserModel }),
  })) }, made.body.code);
  assert.equal(paired.status, 201);
});

test('an admin cannot stack up more than five open pairing codes', async () => {
  const w = adminWorld();
  for (let i = 0; i < 5; i += 1) assert.equal((await call(w.app, 'POST', '/api/admin/devices/pairing')).status, 201);
  assert.equal((await call(w.app, 'POST', '/api/admin/devices/pairing')).status, 429);
});

test('the device list never shows tokens, and removing a phone is permanent', async () => {
  const w = adminWorld();
  const mine = await w.DeviceModel.create({ user: ADMIN._id, label: 'Pixel 8a', tokenHash: 'h1', authVersion: 3 });
  await w.DeviceModel.create({ user: ADMIN._id, label: 'Old', tokenHash: 'h2', authVersion: 3, revokedAt: new Date() });
  await w.DeviceModel.create({ user: new mongoose.Types.ObjectId(), label: 'Someone else', tokenHash: 'h3', authVersion: 0 });

  const list = await call(w.app, 'GET', '/api/admin/devices');
  assert.deepEqual(list.body.devices.map((d) => d.label), ['Pixel 8a']);
  assert.ok(!JSON.stringify(list.body).includes('tokenHash'));

  assert.equal((await call(w.app, 'DELETE', '/api/admin/devices/not-an-id')).status, 400);
  assert.equal((await call(w.app, 'DELETE', `/api/admin/devices/${w.DeviceModel.docs[2]._id}`)).status, 404, 'another admin\'s phone is not mine to remove');
  assert.equal((await call(w.app, 'DELETE', `/api/admin/devices/${mine._id}`)).status, 200);
  assert.ok(mine.revokedAt, 'the device is marked revoked');
  assert.equal((await call(w.app, 'DELETE', `/api/admin/devices/${mine._id}`)).status, 404);
  assert.deepEqual((await call(w.app, 'GET', '/api/admin/devices')).body.devices, []);
});

test('the test alert is an ordinary event the phones pick up', async () => {
  const w = adminWorld();
  assert.equal((await call(w.app, 'POST', '/api/admin/devices/test-event')).status, 201);
  assert.equal(w.recorded[0].type, 'test');
});

// ── a revoked phone's website session dies with it ──
test('a session the phone minted stops working the moment the phone is removed', async () => {
  const w = world();
  const device = await w.DeviceModel.create({ user: ADMIN._id, label: 'Pixel', tokenHash: 'x', authVersion: 3 });
  const authenticate = createAuthenticate({ UserModel: w.UserModel, DeviceModel: w.DeviceModel });
  const app = express();
  app.get('/ping', authenticate, (req, res) => res.json({ ok: true }));
  const token = jwt.sign({ id: ADMIN._id, av: 3, dev: device._id }, process.env.JWT_SECRET, { expiresIn: 3600 });
  const ordinary = jwt.sign({ id: ADMIN._id, av: 3 }, process.env.JWT_SECRET, { expiresIn: 3600 });

  assert.equal((await call(app, 'GET', '/ping', { headers: bearer(token) })).status, 200);
  device.revokedAt = new Date();
  const refused = await call(app, 'GET', '/ping', { headers: bearer(token) });
  assert.equal(refused.status, 401);
  assert.equal(refused.body.code, 'SESSION_REVOKED');
  assert.equal((await call(app, 'GET', '/ping', { headers: bearer(ordinary) })).status, 200, 'normal logins are unaffected');
});

// ── the alert helper itself ──
test('alerts are clipped, bounded to admin pages, and never throw', async () => {
  const saved = [];
  const model = { create: async (doc) => { saved.push(doc); return { ...doc, _id: new mongoose.Types.ObjectId() }; } };
  const emitter = new EventEmitter();
  let heard = 0;
  emitter.on('event', () => { heard += 1; });

  await recordAdminEvent({ type: 'order.paid', title: 'T'.repeat(500), body: 'b'.repeat(900), priority: 'urgent', path: 'https://evil.example/x' }, { Model: model, emitter });
  assert.equal(saved[0].title.length, 120);
  assert.equal(saved[0].body.length, 300);
  assert.equal(saved[0].priority, 'normal', 'unknown priorities fall back');
  assert.equal(saved[0].path, '/admin/orders', 'only paths on our admin pages are allowed');
  assert.equal(heard, 1);

  await recordAdminEvent({ type: 'x', title: 'y', path: '/admin/orders?order=0123456789abcdef01234567' }, { Model: model, emitter });
  assert.equal(saved[1].path, '/admin/orders?order=0123456789abcdef01234567');
  await recordAdminEvent({ type: 'x', title: 'y', path: '/admin/../../etc?x=<script>' }, { Model: model, emitter });
  assert.equal(saved[2].path, '/admin/orders');
  for (const sneaky of ['/admin/..', '/admin/../evil', '/admin/./orders', '//evil.example/admin', '/admin//orders', '/administrator']) {
    await recordAdminEvent({ type: 'x', title: 'y', path: sneaky }, { Model: model, emitter });
    assert.equal(saved.at(-1).path, '/admin/orders', `${sneaky} is not a plain admin page`);
  }

  const quiet = { error() {} };
  const failed = await recordAdminEvent({ type: 'x', title: 'y' }, { Model: { create: async () => { throw new Error('db down'); } }, emitter, logger: quiet });
  assert.equal(failed, null, 'a broken alert does not break the caller');
  assert.equal(heard, saved.length, 'and nobody is told about an event that was not saved');
});

test('with no database connection an alert is skipped at once instead of queueing for ten seconds', async () => {
  assert.notEqual(mongoose.connection.readyState, 1);
  const started = Date.now();
  assert.equal(await recordAdminEvent({ type: 'x', title: 'y' }), null);
  assert.ok(Date.now() - started < 500);
});

test('alert text carries order facts and no customer details', () => {
  const text = describeOrder({
    orderNumber: 'RFX-1', total: 643, paymentMethod: 'etransfer', guestEmail: 'buyer@example.com',
    shippingAddress: { firstName: 'Sam', line1: '100 Queen St W', city: 'Toronto' },
    items: [{ qty: 2, name: '16GB DDR4' }, { qty: 1, name: '32GB DDR4' }, { qty: 3, name: '64GB DDR4' }],
  });
  assert.equal(text, 'RFX-1 · $643.00 CAD · 2× 16GB DDR4, 1× 32GB DDR4, +1 more · e-Transfer');
  for (const secret of ['buyer@example.com', 'Sam', 'Queen', 'Toronto']) assert.ok(!text.includes(secret));
  const shown = publicEvent({ _id: new mongoose.Types.ObjectId(), type: 't', title: 'x', path: 'javascript:alert(1)', createdAt: new Date() });
  assert.equal(shown.path, '/admin/orders');
});

test('the waiter wakes on an event, times out, and sees an event that came before it started waiting', async () => {
  const bus = new EventEmitter();
  const a = eventWaiter(bus);
  setTimeout(() => bus.emit('event'), 20);
  assert.equal(await a.wait(2000), true);

  const b = eventWaiter(bus);
  assert.equal(await b.wait(30), false);

  const c = eventWaiter(bus);
  bus.emit('event');                                              // before wait() is called
  assert.equal(await c.wait(2000), true);
  assert.equal(bus.listenerCount('event'), 0);
});

test('the phone routes are mounted ahead of the site-wide rate limit and the admin routes follow the wholesale pattern', () => {
  const server = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  assert.ok(server.indexOf("app.use('/api/device'") < server.indexOf('app.use(globalLimiter)'));
  assert.ok(server.indexOf("app.use('/api/admin/devices'") < server.indexOf("app.use('/api/admin', adminRoutes)"));
  for (const model of ['AdminEvent', 'AdminDevice', 'DevicePairing']) assert.match(server, new RegExp(`${model},\\n`), `${model} gets its indexes at startup`);
});
