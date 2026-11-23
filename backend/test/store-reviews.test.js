const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// No test here may reach Resend; the reviews router loads the email helpers.
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } } },
};
process.env.JWT_SECRET ||= 'store-reviews-test-secret';
process.env.RESEND_API_KEY ||= ['re', 'test_store_reviews'].join('_');

const Product = require('../src/models/Product');
const Review = require('../src/models/Review');
const reviewsRouter = require('../src/routes/reviews');

const LISTED = '64b7f0c2a1b2c3d4e5f60719';
const DELISTED = '64b7f0c2a1b2c3d4e5f6071a';

const query = (value) => {
  const chain = {
    select: () => chain,
    lean: () => chain,
    sort: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return chain;
};

function stub(t, model, methods) {
  for (const [name, impl] of Object.entries(methods)) {
    const original = model[name];
    model[name] = impl;
    t.after(() => { model[name] = original; });
  }
}

async function get(path) {
  const app = express();
  app.use('/api/reviews', reviewsRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const review = (n, product, rating) => ({
  _id: `r${n}`,
  product,
  displayName: `Buyer${n}`,
  rating,
  title: `Title ${n}`,
  body: `Review body number ${n}`,
  verifiedPurchase: true,
  createdAt: new Date(Date.UTC(2026, 10, 20 - n)),
});

test('the store endpoint rates every approved review and shows the newest six with their module', async (t) => {
  const filters = [];
  const reviews = Array.from({ length: 8 }, (_, i) => review(i, i === 1 ? DELISTED : LISTED, i === 7 ? 1 : 5));
  stub(t, Review, { find: (filter) => { filters.push(filter); return query(reviews); } });
  stub(t, Product, {
    find: () => query([
      { _id: LISTED, slug: 'sk-hynix-16gb', name: 'SK hynix 16GB DDR4', isActive: true },
      { _id: DELISTED, slug: 'old-module', name: 'Old Module', isActive: false },
    ]),
  });

  const response = await get('/api/reviews/store');

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [{ status: 'approved' }], 'rejected reviews never reach the page');
  assert.deepEqual(response.body.summary, { count: 8, average: 4.5 });
  assert.equal(response.body.reviews.length, 6);
  assert.deepEqual(response.body.reviews[0].product, { name: 'SK hynix 16GB DDR4', slug: 'sk-hynix-16gb' });
  assert.deepEqual(response.body.reviews[1].product, { name: 'Old Module', slug: null }, 'a delisted module is named, not linked');
  assert.equal(response.body.reviews[0].displayName, 'Buyer0');
  assert.match(response.cache, /max-age=300/);
});

test('the store endpoint answers an empty rating when nobody has reviewed yet', async (t) => {
  stub(t, Review, { find: () => query([]) });
  stub(t, Product, { find: () => { throw new Error('no product lookup without reviews'); } });

  const response = await get('/api/reviews/store');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { summary: { count: 0, average: 0 }, reviews: [] });
});
