// The owner's read of the visit log (routes/adminVisits.js): who may ask, what is passed on, what is never shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET ||= 'admin-visits-unit-test-secret';

const { memoryModel } = require('./helpers/memoryModel');
const { createAuthenticate, requireAdmin } = require('../src/middleware/auth');
const { createAdminVisitsRouter } = require('../src/routes/adminVisits');

const ADMIN = { _id: new mongoose.Types.ObjectId(), email: 'owner@example.com', role: 'admin', isActive: true, authVersion: 1 };
const CUSTOMER = { _id: new mongoose.Types.ObjectId(), email: 'buyer@example.com', role: 'customer', isActive: true, authVersion: 0 };
const PHONE = new mongoose.Types.ObjectId();
const sign = (user, extra = {}) => jwt.sign({ id: user._id, av: user.authVersion, ...extra }, process.env.JWT_SECRET, { expiresIn: 300 });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function call(app, path, headers = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function world({ env = { VISITS_API_TOKEN: 'collector-secret-token', VISITS_API_URL: 'https://visits.example' }, upstream } = {}) {
  const UserModel = memoryModel([ADMIN, CUSTOMER]);
  const DeviceModel = memoryModel([{ _id: PHONE, revokedAt: null }]);
  const asked = [];
  const answer = upstream || (async () => ({ ok: true, status: 200, json: async () => ({ visits: [{ ip: '203.0.113.7', path: '/shop' }] }) }));
  const fetchImpl = async (url, init) => { asked.push({ url, init }); return answer(url, init); };
  const router = createAdminVisitsRouter({ fetchImpl, env, guard: [createAuthenticate({ UserModel, DeviceModel }), requireAdmin] });
  const app = express();
  app.use('/api/admin/visits', router);
  return { app, asked };
}

test('only a signed-in admin can read the visit log', async () => {
  const w = world();
  assert.equal((await call(w.app, '/api/admin/visits')).status, 401, 'no token');
  assert.equal((await call(w.app, '/api/admin/visits', bearer('garbage'))).status, 401, 'bad token');
  assert.equal((await call(w.app, '/api/admin/visits', bearer(sign(CUSTOMER)))).status, 403, 'a customer');
  assert.equal((await call(w.app, '/api/admin/visits/summary', bearer(sign(CUSTOMER)))).status, 403);
  assert.equal(w.asked.length, 0, 'nothing was asked of the collector for any of them');
  const ok = await call(w.app, '/api/admin/visits', bearer(sign(ADMIN)));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.visits, [{ ip: '203.0.113.7', path: '/shop' }]);
  assert.match(ok.headers.get('cache-control'), /no-store/);
});

test('the owner\'s phone app (an admin web session minted for a device) can read it too, since it only reads', async () => {
  const w = world();
  const res = await call(w.app, '/api/admin/visits', bearer(sign(ADMIN, { dev: String(PHONE) })));
  assert.equal(res.status, 200);
});

test('only known filters are passed to the collector, with the server-held token, and the token is never returned', async () => {
  const w = world();
  const res = await call(w.app, '/api/admin/visits?hours=72&site=reflexityram.com&ip=203.0.113.7&path=/shop&bots=1&limit=50&token=steal&admin=1&x=%0d%0aEvil:%201', bearer(sign(ADMIN)));
  assert.equal(res.status, 200);
  assert.equal(w.asked.length, 1);
  const url = new URL(w.asked[0].url);
  assert.equal(url.origin + url.pathname, 'https://visits.example/api/visits');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['bots', 'hours', 'ip', 'limit', 'path', 'site']);
  assert.equal(url.searchParams.get('site'), 'reflexityram.com');
  assert.equal(w.asked[0].init.headers.Authorization, 'Bearer collector-secret-token');
  assert.doesNotMatch(JSON.stringify(res.body), /collector-secret-token/);
  await call(w.app, '/api/admin/visits/summary?hours=168', bearer(sign(ADMIN)));
  assert.equal(new URL(w.asked[1].url).pathname, '/api/summary');
});

test('without a token on this server the answer says so, and a collector that fails is a clean 502 that leaks nothing', async () => {
  const none = world({ env: {} });
  assert.equal((await call(none.app, '/api/admin/visits', bearer(sign(ADMIN)))).status, 503);
  assert.equal(none.asked.length, 0);
  const down = world({ upstream: async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom with secrets' }) }) });
  const r1 = await call(down.app, '/api/admin/visits', bearer(sign(ADMIN)));
  assert.equal(r1.status, 502);
  assert.doesNotMatch(JSON.stringify(r1.body), /boom|secret|collector/i);
  const throws = world({ upstream: async () => { throw new Error('socket hang up to visits.example'); } });
  const r2 = await call(throws.app, '/api/admin/visits/summary', bearer(sign(ADMIN)));
  assert.equal(r2.status, 502);
  assert.doesNotMatch(JSON.stringify(r2.body), /socket|visits\.example/);
});

test('the router is mounted before the general admin routes in server.js, behind the admin guard by default', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');
  const visits = server.indexOf("app.use('/api/admin/visits', createAdminVisitsRouter());");
  const general = server.indexOf("app.use('/api/admin', adminRoutes);");
  assert.ok(visits > 0 && general > 0 && visits < general, 'visits is mounted ahead of /api/admin');
  const source = fs.readFileSync(require.resolve('../src/routes/adminVisits.js'), 'utf8');
  assert.match(source, /guard = \[authenticate, requireAdmin\]/, 'the default guard is the admin guard');
});
