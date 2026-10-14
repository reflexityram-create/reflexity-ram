// Review of 2026-10-14: a sign-in whose body was not valid JSON (a password sent without quotes) put the start of that body,
// password included, into the server log: the site-wide error handler logged err.stack, and V8's JSON message quotes the input.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createErrorHandler } = require('../src/middleware/errorHandler');

function appWith(logger, { production = true } = {}) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
  app.get('/api/boom', () => { throw new Error('database exploded'); });
  app.get('/api/refused', (req, res, next) => next(Object.assign(new Error('Request origin not allowed'), { status: 403, publicMessage: 'Request origin not allowed' })));
  app.use(createErrorHandler({ logger, production: () => production }));
  return app;
}

async function send(app, method, path, raw) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: raw === undefined ? {} : { 'content-type': 'application/json' }, body: raw,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const recorder = () => {
  const lines = [];
  return { lines, logger: { warn: (...a) => lines.push(['warn', a.join(' ')]), error: (...a) => lines.push(['error', a.join(' ')]) } };
};

test('a body that is not JSON is answered 400 and nothing of the body reaches the log', async () => {
  const { lines, logger } = recorder();
  const response = await send(appWith(logger), 'POST', '/api/auth/login?next=%2Faccount', '{"email":"a@b.c","password":Hunter2-SECRET}');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'That request could not be read.');
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], ['warn', 'POST /api/auth/login → 400 (entity.parse.failed)']);
  assert.ok(!JSON.stringify(lines).includes('Hunter2'), 'the password is not logged');
});

test('a body over the limit is a 413 with one line, and a refused origin keeps its public message', async () => {
  const { lines, logger } = recorder();
  const big = await send(appWith(logger), 'POST', '/api/auth/login', JSON.stringify({ password: 'x'.repeat(2048) }));
  assert.equal(big.status, 413);
  const refused = await send(appWith(logger), 'GET', '/api/refused');
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'Request origin not allowed');
  assert.deepEqual(lines.map(([level]) => level), ['warn', 'warn'], 'client mistakes are one warning each, no stack');
  assert.match(lines[1][1], /^GET \/api\/refused → 403: Request origin not allowed$/);
});

test('a real server error still logs its stack and says nothing of it to the client in production', async () => {
  const { lines, logger } = recorder();
  const response = await send(appWith(logger), 'GET', '/api/boom');
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Internal server error');
  assert.equal(lines[0][0], 'error');
  assert.match(lines[0][1], /database exploded[\s\S]*at /, 'the stack is logged');
  const dev = await send(appWith(recorder().logger, { production: false }), 'GET', '/api/boom');
  assert.equal(dev.body.error, 'database exploded', 'outside production the message helps the developer');
});

test('server.js uses this handler and no longer logs every error with its stack', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  assert.match(source, /app\.use\(createErrorHandler\(\)\);/);
  assert.doesNotMatch(source, /app\.use\(\(err, req, res, next\) => \{\s*console\.error\(err\.stack\);/);
});
