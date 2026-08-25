const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const {
  cleanWholesaleLotInput,
  isPublicWholesaleLot,
  publicationErrors,
  publicWholesaleLot,
} = require('../src/utils/wholesaleLots');
const { createAdminWholesaleRouter } = require('../src/routes/adminWholesale');
const { createWholesaleRouter } = require('../src/routes/wholesale');
const WholesaleLot = require('../src/models/WholesaleLot');

const objectId = '64b64c66a2d15e51234abcde';
const image = {
  url: 'https://res.cloudinary.com/fike/image/upload/v1/reflexity-ram/wholesale/wholesale-proof.webp',
  publicId: 'reflexity-ram/wholesale/wholesale-proof',
  alt: 'Verified module lot',
};

const completeLot = Object.freeze({
  _id: objectId,
  __v: 4,
  lotCode: 'WS-2026-AB12CD34',
  title: 'Samsung 32GB Server Memory',
  brand: 'Samsung',
  mpn: 'M393A4K40DB3-CWE',
  generation: 'DDR4',
  formFactor: 'RDIMM',
  capacityLabel: '32GB',
  speedLabel: '3200 MT/s',
  rank: '2Rx4',
  condition: 'Used',
  testStatus: 'Individually tested',
  warranty: '30-day warranty',
  quantityAvailable: 12,
  minimumOrderQuantity: 4,
  orderIncrement: 4,
  shipFrom: 'Toronto, Canada',
  notes: 'Pulled from matching systems.',
  image,
  status: 'published',
  visibility: 'public',
  quoteOnly: true,
  publishedAt: new Date('2026-08-25T12:00:00.000Z'),
  archivedAt: null,
});

function listQuery(value, observed = {}) {
  return {
    sort(sort) { observed.sort = sort; return this; },
    skip(skip) { observed.skip = skip; return this; },
    limit(limit) { observed.limit = limit; return this; },
    lean: async () => value,
  };
}

function foundQuery(value) {
  return { select() { return this; }, lean: async () => value };
}

async function request(app, path, options = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    return { status: response.status, headers: response.headers, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeAdminApp({ authenticate, requireAdmin, Model }) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/wholesale', createAdminWholesaleRouter({ authenticate, requireAdmin, WholesaleLot: Model }));
  return app;
}

test('wholesale helper strips retail fields and rejects images outside the wholesale Cloudinary prefix', () => {
  const result = cleanWholesaleLotInput({
    title: '  Server pull  ',
    mpn: ' m393a4k40db3-cwe ',
    stockQuantity: 999,
    price: 1,
    stripePriceId: 'price_forbidden',
    status: 'published',
    image: { ...image, publicId: 'reflexity-ram/products/not-wholesale' },
  });
  assert.equal(result.data.title, 'Server pull');
  assert.equal(result.data.mpn, 'M393A4K40DB3-CWE');
  assert.equal(result.data.price, undefined);
  assert.equal(result.data.status, undefined);
  assert.match(result.errors[0], /wholesale image/i);
});

test('publication requires a complete quote-only wholesale lot and public output is projected', () => {
  assert.equal(publicationErrors(completeLot).length, 0);
  assert.equal(isPublicWholesaleLot(completeLot), true);
  const projected = publicWholesaleLot(completeLot);
  assert.deepEqual(Object.keys(projected).sort(), [
    'brand', 'capacityLabel', 'condition', 'formFactor', 'generation', 'id', 'imageAlt', 'imageUrl',
    'lotCode', 'minimumOrderQuantity', 'mpn', 'notes', 'orderIncrement', 'publishedAt', 'quantityAvailable',
    'quoteOnly', 'rank', 'shipFrom', 'speedLabel', 'status', 'testStatus', 'title', 'visibility', 'warranty',
  ].sort());
  assert.equal(projected.imageUrl, image.url);
  assert.equal(projected.status, 'published');
  assert.equal(projected.visibility, 'public');
  assert.equal('createdBy' in projected, false);
  assert.equal(isPublicWholesaleLot({ ...completeLot, quantityAvailable: 2 }), false);
  assert.equal(isPublicWholesaleLot({ ...completeLot, generation: 'DDR6' }), false);
  assert.equal(isPublicWholesaleLot({ ...completeLot, quantityAvailable: 1_000_001 }), false);
});

test('the model rejects an incomplete document marked published even outside the route transition', async () => {
  const lot = new WholesaleLot({
    lotCode: 'WS-2026-INVALID1',
    status: 'published',
    visibility: 'public',
    quoteOnly: true,
    createdBy: objectId,
    updatedBy: objectId,
  });
  await assert.rejects(lot.validate(), /required before publishing|valid wholesale image/i);
});

test('draft model validation still rejects fractional quantities and foreign media', async () => {
  const lot = new WholesaleLot({
    lotCode: 'WS-2026-INVALID2',
    title: 'Invalid draft',
    quantityAvailable: 1.5,
    image: {
      url: 'https://res.cloudinary.com/fike/image/upload/v1/reflexity-ram/products/not-wholesale.webp',
      publicId: 'reflexity-ram/products/not-wholesale',
    },
    createdBy: objectId,
    updatedBy: objectId,
  });
  await assert.rejects(lot.validate(), /validation failed|whole|wholesale media folder/i);
});

test('admin wholesale routes require an explicit bearer before authentication', async () => {
  const Model = { find: () => listQuery([]), countDocuments: async () => 0 };
  const app = makeAdminApp({
    Model,
    authenticate: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
  });
  const absent = await request(app, '/api/admin/wholesale');
  assert.equal(absent.status, 401);
  assert.match(absent.body.error, /bearer/i);
  const cookieOnly = await request(app, '/api/admin/wholesale', { headers: { cookie: 'accessToken=legacy-cookie' } });
  assert.equal(cookieOnly.status, 401);
});

test('admin wholesale route retains inactive/non-admin rejection and returns versioned admin lots', async () => {
  const Model = { find: () => listQuery([completeLot]), countDocuments: async () => 1 };
  const inactive = makeAdminApp({
    Model,
    authenticate: (_req, res) => res.status(401).json({ error: 'User not found or deactivated' }),
    requireAdmin: (_req, _res, next) => next(),
  });
  const inactiveResponse = await request(inactive, '/api/admin/wholesale', { headers: { authorization: 'Bearer valid-token' } });
  assert.equal(inactiveResponse.status, 401);

  const nonAdmin = makeAdminApp({
    Model,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'customer' }; next(); },
    requireAdmin: (_req, res) => res.status(403).json({ error: 'Admin access required' }),
  });
  const denied = await request(nonAdmin, '/api/admin/wholesale', { headers: { authorization: 'Bearer valid-token' } });
  assert.equal(denied.status, 403);

  const admin = makeAdminApp({
    Model,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const success = await request(admin, '/api/admin/wholesale', { headers: { authorization: 'Bearer valid-token' } });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(success.body.lots[0].id, objectId);
  assert.equal(success.body.lots[0].version, 4);
});

test('admin wholesale list applies deterministic pagination and reports the full count', async () => {
  const observed = {};
  const Model = {
    find: (filter) => {
      observed.filter = filter;
      return listQuery([completeLot], observed);
    },
    countDocuments: async (filter) => {
      observed.countFilter = filter;
      return 23;
    },
  };
  const app = makeAdminApp({
    Model,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, '/api/admin/wholesale?page=3&limit=10&status=draft&q=WS-2026', {
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.pagination, { page: 3, limit: 10, total: 23, pages: 3 });
  assert.equal(observed.skip, 20);
  assert.equal(observed.limit, 10);
  assert.deepEqual(observed.sort, { updatedAt: -1, _id: -1 });
  assert.equal(observed.filter.status, 'draft');
  assert.deepEqual(observed.countFilter, observed.filter);
  assert.equal(observed.filter.$or.length, 4);
});

test('transitions with no JSON body fail cleanly before a model mutation', async () => {
  const app = makeAdminApp({
    Model: {},
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}/publish`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /refresh.*before changing/i);
  assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
});

test('public wholesale endpoint filters tampered records and exposes no admin fields', async () => {
  const Model = { find: () => listQuery([
    completeLot,
    { ...completeLot, _id: '65b64c66a2d15e51234abcde', quantityAvailable: 1 },
    { ...completeLot, _id: '66b64c66a2d15e51234abcde', visibility: 'private' },
    { ...completeLot, _id: '67b64c66a2d15e51234abcde', archivedAt: new Date() },
  ]) };
  const app = express();
  app.use('/api/wholesale', createWholesaleRouter(Model));
  const response = await request(app, '/api/wholesale');
  assert.equal(response.status, 200);
  assert.equal(response.body.lots.length, 1);
  assert.equal(response.body.lots[0].lotCode, completeLot.lotCode);
  assert.equal(response.body.lots[0].status, 'published');
  assert.equal(response.body.lots[0].visibility, 'public');
  assert.equal('image' in response.body.lots[0], false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('DELETE archives an exact version instead of hard deleting it', async () => {
  let update;
  const Model = {
    findOne: () => ({ lean: async () => ({ ...completeLot, status: 'draft', visibility: 'private' }) }),
    findOneAndUpdate: (filter, mutation, options) => {
      update = { filter, mutation, options };
      return { lean: async () => ({
        ...completeLot,
        __v: 5,
        status: 'archived',
        visibility: 'private',
        archivedAt: new Date(),
      }) };
    },
    findById: () => foundQuery({ _id: objectId }),
  };
  const app = makeAdminApp({
    Model,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4 }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.lot.status, 'archived');
  assert.equal(update.mutation.$set.status, 'archived');
  assert.equal(update.mutation.$set.visibility, 'private');
  assert.equal(update.options.returnDocument, 'after');
  assert.equal(typeof Model.deleteOne, 'undefined');
});

test('a stale wholesale update returns 409 and cannot resurrect an archived lot', async () => {
  const Model = {
    findOne: () => ({ lean: async () => ({ ...completeLot, status: 'draft', visibility: 'private' }) }),
    findOneAndUpdate: () => ({ lean: async () => null }),
    findById: () => foundQuery({ _id: objectId }),
  };
  const app = makeAdminApp({
    Model,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, title: 'Attempt to overwrite archived lot', status: 'published' }),
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /changed/i);
});

test('wholesale image deletion checks the WholesaleLot reference before Cloudinary deletion', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/upload.js'), 'utf8');
  const referenceCheck = source.indexOf("WholesaleLot.exists({ 'image.publicId': publicId })");
  const cloudinaryDelete = source.indexOf('await deleteImage(publicId);', referenceCheck);
  assert.notEqual(referenceCheck, -1);
  assert.ok(cloudinaryDelete > referenceCheck);
  assert.match(source.slice(referenceCheck, cloudinaryDelete), /return res\.status\(409\)/);
});
