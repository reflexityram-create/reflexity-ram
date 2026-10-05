const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET = 'featured-product-test-secret';

const Product = require('../src/models/Product');
const User = require('../src/models/User');
const adminRouter = require('../src/routes/admin');
const { PUBLIC_PRODUCT_PROJECTION } = require('../src/utils/publicProducts');

const PRODUCT_ID = '64b7f0c2a1b2c3d4e5f60719';

const query = (value) => {
  const chain = { select: () => chain, populate: () => chain, lean: () => chain, sort: () => chain, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  return chain;
};

function stub(t, model, methods) {
  for (const [name, impl] of Object.entries(methods)) {
    const original = model[name];
    model[name] = impl;
    t.after(() => { model[name] = original; });
  }
}

async function request(app, method, path, body, headers = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
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

// The home page shows one featured stick; ticking it on one product clears it on the rest.
test('featuring a product on the home page clears it on every other product', async (t) => {
  const { app, headers } = adminApp(t);
  const calls = [];
  stub(t, Product, {
    findByIdAndUpdate: (id, update) => { calls.push(['update', update.$set]); return query({ _id: id, slug: 'samsung-64gb', ...update.$set }); },
    updateMany: async (filter, update) => { calls.push(['updateMany', filter, update]); return { modifiedCount: 1 }; },
  });

  const on = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { featured: true }, headers);
  assert.equal(on.status, 200);
  assert.deepEqual(calls.find(([kind]) => kind === 'updateMany'), ['updateMany', { _id: { $ne: PRODUCT_ID }, featured: true }, { $set: { featured: false } }]);

  calls.length = 0;
  const off = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { featured: false }, headers);
  assert.equal(off.status, 200);
  assert.equal(calls.some(([kind]) => kind === 'updateMany'), false, 'unticking does not touch other products');

  const bad = await request(app, 'PATCH', `/api/admin/products/${PRODUCT_ID}`, { featured: 'yes' }, headers);
  assert.equal(bad.status, 400);
  assert.equal(PUBLIC_PRODUCT_PROJECTION.featured, 1, 'the store front can see which stick is featured');
  assert.equal(new Product({}).featured, false);
});
