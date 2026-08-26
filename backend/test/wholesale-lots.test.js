const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  cleanWholesaleLotInput,
  isWholesaleImage,
  isPublicWholesaleLot,
  publicationErrors,
  publicWholesaleLot,
} = require('../src/utils/wholesaleLots');
const {
  claimWholesaleMedia,
  finalizeWholesaleMediaClaim,
  finishWholesaleMediaDeletion,
  reserveWholesaleMediaDeletion,
} = require('../src/utils/wholesaleMedia');
const { createAuthenticate, createOptionalAuth, requireExplicitBearer } = require('../src/middleware/auth');
const { createAdminWholesaleRouter } = require('../src/routes/adminWholesale');
const { createWholesaleRouter, PUBLIC_CANDIDATE_LIMIT } = require('../src/routes/wholesale');
const { createUploadRouter } = require('../src/routes/upload');
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

function idsMatch(left, right) {
  return String(left) === String(right);
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce((value, part) => value?.[part], document);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$in' in expected) return expected.$in.some((value) => idsMatch(actual, value));
      if ('$lte' in expected) return new Date(actual) <= new Date(expected.$lte);
    }
    return idsMatch(actual, expected);
  });
}

function makeMediaModel(initial) {
  const state = { ...initial };
  const clone = (value) => (value ? { ...value } : null);
  return {
    state,
    findOne(filter) {
      const value = matches(state, filter) ? clone(state) : null;
      return { select() { return this; }, lean: async () => value };
    },
    findOneAndUpdate(filter, update) {
      const value = matches(state, filter) ? state : null;
      if (value) Object.assign(value, update.$set || {});
      return { lean: async () => clone(value) };
    },
    create: async (value) => {
      Object.assign(state, value);
      return clone(state);
    },
  };
}

function makeLotReferenceModel(lots) {
  return {
    findOne(filter) {
      const publicId = filter['image.publicId'];
      const value = lots.find((lot) => lot.image?.publicId === publicId) || null;
      return { select() { return this; }, lean: async () => value };
    },
  };
}

function middlewareResult(middleware, req) {
  return new Promise((resolve) => {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, next: false }); },
    };
    middleware(req, res, () => resolve({ status: 200, body: null, next: true, user: req.user }));
  });
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

function makeAdminApp({ authenticate, requireAdmin, Model, MediaModel }) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/wholesale', createAdminWholesaleRouter({
    authenticate,
    requireAdmin,
    WholesaleLot: Model,
    ...(MediaModel ? { WholesaleMediaAsset: MediaModel } : {}),
  }));
  return app;
}

function makeAmbiguousCreateModel({ commit, definiteNoCommit = false, recoveryReadFails = false }) {
  const lots = [];
  let attempted = null;
  return {
    lots,
    exists: async () => false,
    async create(value) {
      attempted = { ...value, __v: 0, createdAt: new Date(), updatedAt: new Date() };
      if (commit) lots.push({ ...value, __v: 0, createdAt: new Date(), updatedAt: new Date() });
      const error = new Error(commit ? 'response lost after create committed' : 'create rejected before commit');
      if (definiteNoCommit) error.name = 'ValidationError';
      throw error;
    },
    commitAttempt() {
      if (attempted && !lots.some((lot) => idsMatch(lot._id, attempted._id))) lots.push(attempted);
      return attempted;
    },
    findOne(filter) {
      const isRecovery = Object.prototype.hasOwnProperty.call(filter, '_id')
        && Object.prototype.hasOwnProperty.call(filter, 'image.url');
      return {
        select() { return this; },
        lean: async () => {
          if (isRecovery && recoveryReadFails) throw new Error('recovery read unavailable');
          return lots.find((lot) => Object.entries(filter).every(([key, value]) => {
            const actual = key.split('.').reduce((current, part) => current?.[part], lot);
            return idsMatch(actual, value);
          })) || null;
        },
      };
    },
  };
}

function makeAmbiguousPatchModel({ commit, definiteNoCommit = false, recoveryReadFails = false }) {
  let current = {
    ...completeLot,
    image: null,
    status: 'draft',
    visibility: 'private',
  };
  let attemptedMutation = null;
  return {
    get current() { return current; },
    findOne(filter) {
      const isRecovery = Object.prototype.hasOwnProperty.call(filter, 'image.url');
      return {
        select() { return this; },
        lean: async () => {
          if (isRecovery && recoveryReadFails) throw new Error('recovery read unavailable');
          return Object.entries(filter).every(([key, expected]) => {
            const actual = key.split('.').reduce((value, part) => value?.[part], current);
            return idsMatch(actual, expected);
          }) ? { ...current } : null;
        },
      };
    },
    findOneAndUpdate(_filter, mutation) {
      attemptedMutation = mutation;
      return {
        lean: async () => {
          if (commit) current = { ...current, ...mutation.$set, __v: current.__v + 1 };
          const error = new Error(commit ? 'response lost after patch committed' : 'patch rejected before commit');
          if (definiteNoCommit) error.name = 'ValidationError';
          throw error;
        },
      };
    },
    commitAttempt() {
      if (attemptedMutation) current = { ...current, ...attemptedMutation.$set, __v: current.__v + 1 };
      return current;
    },
    findById() { return foundQuery({ _id: objectId }); },
  };
}

function completeInput(overrides = {}) {
  return {
    title: completeLot.title,
    brand: completeLot.brand,
    mpn: completeLot.mpn,
    generation: completeLot.generation,
    formFactor: completeLot.formFactor,
    capacityLabel: completeLot.capacityLabel,
    speedLabel: completeLot.speedLabel,
    rank: completeLot.rank,
    condition: completeLot.condition,
    testStatus: completeLot.testStatus,
    warranty: completeLot.warranty,
    quantityAvailable: completeLot.quantityAvailable,
    minimumOrderQuantity: completeLot.minimumOrderQuantity,
    orderIncrement: completeLot.orderIncrement,
    shipFrom: completeLot.shipFrom,
    notes: completeLot.notes,
    image,
    ...overrides,
  };
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

test('a wholesale image URL must deliver the exact supplied Cloudinary public ID', () => {
  assert.equal(isWholesaleImage(image), true);
  assert.equal(isWholesaleImage({
    ...image,
    url: 'https://res.cloudinary.com/fike/image/upload/c_limit,w_320/v1/reflexity-ram/wholesale/another-asset.webp',
  }), false);
  assert.equal(isWholesaleImage({
    ...image,
    url: 'https://res.cloudinary.com/fike/image/upload/v1/reflexity-ram/wholesale/wholesale-proof.webp?spoof=1',
  }), false);
});

test('an Authorization header never falls back to a valid cookie and lowercase bearer remains a bearer', async () => {
  const seenTokens = [];
  const authenticate = createAuthenticate({
    jwtImpl: {
      verify(token) {
        seenTokens.push(token);
        if (token === 'header-token') return { id: objectId };
        throw new Error('bad header token');
      },
    },
    UserModel: {
      findById() { return { select: async () => ({ _id: objectId, isActive: true, role: 'admin' }) }; },
    },
  });
  const rejected = await middlewareResult(authenticate, {
    headers: { authorization: 'bearer invalid-header-token' },
    cookies: { accessToken: 'header-token' },
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error, 'Invalid token');
  assert.deepEqual(seenTokens, ['invalid-header-token']);

  const accepted = await middlewareResult(authenticate, {
    headers: { authorization: 'bEaReR header-token' },
    cookies: { accessToken: 'invalid-cookie-token' },
  });
  assert.equal(accepted.next, true);
  assert.deepEqual(seenTokens, ['invalid-header-token', 'header-token']);

  const wholesaleGate = await middlewareResult(requireExplicitBearer, {
    headers: { authorization: 'bearer header-token' },
    cookies: { accessToken: 'header-token' },
  });
  assert.equal(wholesaleGate.next, true);
  const malformed = await middlewareResult(requireExplicitBearer, {
    headers: { authorization: 'Basic header-token' },
    cookies: { accessToken: 'header-token' },
  });
  assert.equal(malformed.status, 401);
});

test('legacy JWTs are accepted only while the user remains on auth version zero', async () => {
  const authenticate = createAuthenticate({
    jwtImpl: { verify: () => ({ id: objectId }) },
    UserModel: { findById: () => ({ select: async () => ({ _id: objectId, isActive: true, authVersion: 1 }) }) },
  });
  const rejected = await middlewareResult(authenticate, {
    headers: { authorization: 'Bearer legacy-token' },
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.code, 'SESSION_REVOKED');

  const optional = await middlewareResult(createOptionalAuth({
    jwtImpl: { verify: () => ({ id: objectId }) },
    UserModel: { findById: () => ({ select: async () => ({ _id: objectId, isActive: true, authVersion: 1 }) }) },
  }), {
    headers: { authorization: 'Bearer legacy-token' },
  });
  assert.equal(optional.status, 401);

  const legacyCompatible = await middlewareResult(createAuthenticate({
    jwtImpl: { verify: () => ({ id: objectId }) },
    UserModel: { findById: () => ({ select: async () => ({ _id: objectId, isActive: true, authVersion: 0 }) }) },
  }), { headers: { authorization: 'Bearer legacy-token' } });
  assert.equal(legacyCompatible.next, true);
});

test('optional auth rejects explicit malformed or invalid credentials but preserves anonymous cookies', async () => {
  const optional = createOptionalAuth({ jwtImpl: { verify: () => { throw new Error('invalid'); } } });
  const malformed = await middlewareResult(optional, { headers: { authorization: 'Basic not-a-bearer' } });
  assert.equal(malformed.status, 401);
  const invalid = await middlewareResult(optional, { headers: { authorization: 'Bearer invalid' } });
  assert.equal(invalid.status, 401);
  const anonymous = await middlewareResult(optional, { cookies: { accessToken: 'invalid-cookie' } });
  assert.equal(anonymous.next, true);
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

test('Mongo indexes and startup enforce one wholesale image owner before traffic', async () => {
  const ownershipIndex = WholesaleLot.schema.indexes()
    .find(([fields]) => fields['image.publicId'] === 1);
  assert.ok(ownershipIndex, 'WholesaleLot must declare an image ownership index');
  assert.equal(ownershipIndex[1].unique, true);
  assert.deepEqual(ownershipIndex[1].partialFilterExpression, {
    'image.publicId': { $type: 'string' },
  });

  const [server, cloudinary] = await Promise.all([
    readFile(new URL('../src/server.js', `file://${__filename}`), 'utf8'),
    readFile(new URL('../src/config/cloudinary.js', `file://${__filename}`), 'utf8'),
  ]);
  assert.match(server, /const startupModels = \[[\s\S]*?WholesaleLot,[\s\S]*?WholesaleMediaAsset,[\s\S]*?\];[\s\S]*?await Promise\.all\(startupModels\.map\(\(model\) => model\.init\(\)\)\);[\s\S]*?app\.listen/);
  assert.match(cloudinary, /public_id: `wholesale-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(cloudinary, /overwrite: false/);
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

test('public wholesale endpoint keeps scanning malformed candidates until it fills the valid limit', async () => {
  let reads = 0;
  const candidates = [
    ...Array.from({ length: 100 }, (_, index) => ({
      ...completeLot,
      _id: `65b64c66a2d15e51234ab${String(index).padStart(3, '0')}`,
      lotCode: `WS-2026-BAD${String(index).padStart(4, '0')}`,
      quantityAvailable: 1,
    })),
    { ...completeLot, _id: '75b64c66a2d15e51234abcde', lotCode: 'WS-2026-VALIDSCAN' },
  ];
  const Model = {
    find() {
      let skip = 0;
      let limit = 0;
      return {
        sort() { return this; },
        skip(value) { skip = value; return this; },
        limit(value) { limit = value; return this; },
        lean: async () => { reads += 1; return candidates.slice(skip, skip + limit); },
      };
    },
  };
  const app = express();
  app.use('/api/wholesale', createWholesaleRouter(Model));
  const response = await request(app, '/api/wholesale');
  assert.equal(response.status, 200);
  assert.equal(response.body.lots.length, 1);
  assert.equal(response.body.lots[0].lotCode, 'WS-2026-VALIDSCAN');
  assert.equal(reads, 2);
});

test('public wholesale defensive scanning has a fixed candidate-work ceiling', async () => {
  let reads = 0;
  let requested = 0;
  const candidates = Array.from({ length: PUBLIC_CANDIDATE_LIMIT + 500 }, (_, index) => ({
    ...completeLot,
    _id: `85b64c66a2d15e5${String(index).padStart(8, '0')}`,
    lotCode: `WS-2026-BOUNDED${String(index).padStart(4, '0')}`,
    quantityAvailable: 1,
  }));
  const Model = {
    find() {
      let skip = 0;
      let limit = 0;
      return {
        sort() { return this; },
        skip(value) { skip = value; return this; },
        limit(value) { limit = value; return this; },
        lean: async () => {
          reads += 1;
          requested += limit;
          return candidates.slice(skip, skip + limit);
        },
      };
    },
  };
  const app = express();
  app.use('/api/wholesale', createWholesaleRouter(Model));
  const response = await request(app, '/api/wholesale');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lots, []);
  assert.equal(requested, PUBLIC_CANDIDATE_LIMIT);
  assert.equal(reads, PUBLIC_CANDIDATE_LIMIT / 100);
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

test('editing an attached lot without changing its asset does not reclaim its media lease', async () => {
  const current = { ...completeLot, status: 'draft', visibility: 'private' };
  const Model = {
    findOne: () => ({ lean: async () => current }),
    findOneAndUpdate: (_filter, mutation) => ({
      lean: async () => ({ ...current, ...mutation.$set, __v: current.__v + 1 }),
    }),
  };
  const MediaModel = {
    findOneAndUpdate() { throw new Error('same image must not be reclaimed'); },
    findOne() { throw new Error('same image must not be reconciled'); },
  };
  const app = makeAdminApp({
    Model,
    MediaModel,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, image: { ...image, alt: 'Updated accessible description' } }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.lot.image.alt, 'Updated accessible description');
});

test('a committed create with a lost response keeps its media owned by the exact lot', async () => {
  const media = makeMediaModel({
    _id: 'media-create-ambiguous', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  const Model = makeAmbiguousCreateModel({ commit: true });
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, '/api/admin/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Ambiguous committed create', image }),
  });
  assert.equal(response.status, 201);
  assert.equal(Model.lots.length, 1);
  assert.equal(media.state.state, 'attached');
  assert.equal(String(media.state.lotId), String(Model.lots[0]._id));
  assert.equal(await claimWholesaleMedia({
    MediaModel: media,
    WholesaleLotModel: Model,
    image,
    lotId: new (require('mongoose').Types.ObjectId)(),
  }), null);
  const deletion = await reserveWholesaleMediaDeletion({
    MediaModel: media, WholesaleLotModel: Model, publicId: image.publicId,
  });
  assert.equal(deletion.state, 'attached');
});

test('only a provably rejected create releases its claim', async () => {
  const cases = [
    { definiteNoCommit: true, recoveryReadFails: false, status: 400, mediaState: 'available' },
    { definiteNoCommit: false, recoveryReadFails: false, status: 503, mediaState: 'claiming' },
    { definiteNoCommit: false, recoveryReadFails: true, status: 503, mediaState: 'claiming' },
  ];
  for (const scenario of cases) {
    const media = makeMediaModel({
      _id: `media-create-${scenario.status}-${scenario.recoveryReadFails}`,
      publicId: image.publicId,
      url: image.url,
      state: 'available',
      lotId: null,
    });
    const Model = makeAmbiguousCreateModel({ commit: false, ...scenario });
    const app = makeAdminApp({
      Model,
      MediaModel: media,
      authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
      requireAdmin: (_req, _res, next) => next(),
    });
    const response = await request(app, '/api/admin/wholesale', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Failed create', image }),
    });
    assert.equal(response.status, scenario.status);
    assert.equal(media.state.state, scenario.mediaState);
  }
});

test('an unknown create failure keeps the lease through a delayed commit', async () => {
  const media = makeMediaModel({
    _id: 'media-create-delayed', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  const Model = makeAmbiguousCreateModel({ commit: false });
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, '/api/admin/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Delayed create', image }),
  });
  assert.equal(response.status, 503);
  assert.equal((await reserveWholesaleMediaDeletion({
    MediaModel: media, WholesaleLotModel: Model, publicId: image.publicId,
  })).state, 'busy');
  const committed = Model.commitAttempt();
  assert.ok(committed);
  assert.equal(await claimWholesaleMedia({
    MediaModel: media,
    WholesaleLotModel: Model,
    image,
    lotId: new (require('mongoose').Types.ObjectId)(),
  }), null);
  assert.equal(media.state.state, 'attached');
  assert.equal(String(media.state.lotId), String(committed._id));
});

test('a write resuming after claim expiry and deletion stays private and cannot publish', async () => {
  const media = makeMediaModel({
    _id: 'media-expired-before-create', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  const lots = [];
  let releaseCreate;
  let markCreateStarted;
  let transitionWrites = 0;
  const createStarted = new Promise((resolve) => { markCreateStarted = resolve; });
  const Model = {
    exists: async () => false,
    create(value) {
      markCreateStarted();
      return new Promise((resolve) => {
        releaseCreate = () => {
          const lot = { ...value, __v: 0, createdAt: new Date(), updatedAt: new Date() };
          lots.push(lot);
          resolve(lot);
        };
      });
    },
    findOne(filter) {
      return {
        select() { return this; },
        lean: async () => lots.find((lot) => Object.entries(filter).every(([key, expected]) => {
          const actual = key.split('.').reduce((value, part) => value?.[part], lot);
          return idsMatch(actual, expected);
        })) || null,
      };
    },
    findOneAndUpdate() {
      transitionWrites += 1;
      return { lean: async () => { throw new Error('publish must be blocked before mutation'); } };
    },
    findById() { return foundQuery(lots[0] || null); },
  };
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });

  const saving = request(app, '/api/admin/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify(completeInput()),
  });
  await createStarted;
  assert.equal(media.state.state, 'claiming');
  const afterExpiry = new Date(Date.now() + 10 * 60 * 1000);
  media.state.claimExpiresAt = new Date(afterExpiry.getTime() - 1);
  const deletion = await reserveWholesaleMediaDeletion({
    MediaModel: media,
    WholesaleLotModel: Model,
    publicId: image.publicId,
    now: afterExpiry,
  });
  assert.equal(deletion.state, 'reserved');
  assert.equal(await finishWholesaleMediaDeletion({
    MediaModel: media, publicId: image.publicId, deleteId: deletion.deleteId,
  }), true);
  releaseCreate();

  const saveResponse = await saving;
  assert.equal(saveResponse.status, 503);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].status, 'draft');
  assert.equal(lots[0].visibility, 'private');
  assert.equal(media.state.state, 'deleted');

  const publishResponse = await request(app, `/api/admin/wholesale/${lots[0]._id}/publish`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 0 }),
  });
  assert.equal(publishResponse.status, 409);
  assert.match(publishResponse.body.error, /replace.*image/i);
  assert.equal(transitionWrites, 0);
});

test('a committed patch with a lost response keeps replacement media owned by that lot', async () => {
  const media = makeMediaModel({
    _id: 'media-patch-ambiguous', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  const Model = makeAmbiguousPatchModel({ commit: true });
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, image }),
  });
  assert.equal(response.status, 200);
  assert.equal(Model.current.image.publicId, image.publicId);
  assert.equal(media.state.state, 'attached');
  assert.equal(String(media.state.lotId), objectId);
  assert.equal(await claimWholesaleMedia({
    MediaModel: media,
    WholesaleLotModel: Model,
    image,
    lotId: new (require('mongoose').Types.ObjectId)(),
  }), null);
});

test('only a provably rejected patch releases its claim', async () => {
  const cases = [
    { definiteNoCommit: true, recoveryReadFails: false, status: 400, mediaState: 'available' },
    { definiteNoCommit: false, recoveryReadFails: false, status: 503, mediaState: 'claiming' },
    { definiteNoCommit: false, recoveryReadFails: true, status: 503, mediaState: 'claiming' },
  ];
  for (const scenario of cases) {
    const media = makeMediaModel({
      _id: `media-patch-${scenario.status}-${scenario.recoveryReadFails}`,
      publicId: image.publicId,
      url: image.url,
      state: 'available',
      lotId: null,
    });
    const Model = makeAmbiguousPatchModel({ commit: false, ...scenario });
    const app = makeAdminApp({
      Model,
      MediaModel: media,
      authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
      requireAdmin: (_req, _res, next) => next(),
    });
    const response = await request(app, `/api/admin/wholesale/${objectId}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 4, image }),
    });
    assert.equal(response.status, scenario.status);
    assert.equal(media.state.state, scenario.mediaState);
  }
});

test('an unknown patch failure keeps the lease through a delayed commit', async () => {
  const media = makeMediaModel({
    _id: 'media-patch-delayed', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  const Model = makeAmbiguousPatchModel({ commit: false });
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, image }),
  });
  assert.equal(response.status, 503);
  assert.equal((await reserveWholesaleMediaDeletion({
    MediaModel: media, WholesaleLotModel: Model, publicId: image.publicId,
  })).state, 'busy');
  Model.commitAttempt();
  assert.equal(await claimWholesaleMedia({
    MediaModel: media,
    WholesaleLotModel: Model,
    image,
    lotId: new (require('mongoose').Types.ObjectId)(),
  }), null);
  assert.equal(media.state.state, 'attached');
  assert.equal(String(media.state.lotId), objectId);
});

test('a replacement patch resuming after lease deletion stays private and cannot publish', async () => {
  const media = makeMediaModel({
    _id: 'media-expired-before-patch', publicId: image.publicId, url: image.url, state: 'available', lotId: null,
  });
  let current = { ...completeLot, image: null, status: 'draft', visibility: 'private' };
  let releasePatch;
  let markPatchStarted;
  let updateCalls = 0;
  const patchStarted = new Promise((resolve) => { markPatchStarted = resolve; });
  const Model = {
    findOne(filter) {
      return {
        select() { return this; },
        lean: async () => Object.entries(filter).every(([key, expected]) => {
          const actual = key.split('.').reduce((value, part) => value?.[part], current);
          return idsMatch(actual, expected);
        }) ? { ...current } : null,
      };
    },
    findOneAndUpdate(_filter, mutation) {
      updateCalls += 1;
      if (updateCalls > 1) return { lean: async () => { throw new Error('publish must be blocked before mutation'); } };
      markPatchStarted();
      return {
        lean: () => new Promise((resolve) => {
          releasePatch = () => {
            current = { ...current, ...mutation.$set, __v: current.__v + 1 };
            resolve({ ...current });
          };
        }),
      };
    },
    findById() { return foundQuery({ _id: objectId }); },
  };
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const saving = request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, image }),
  });
  await patchStarted;
  const afterExpiry = new Date(Date.now() + 10 * 60 * 1000);
  media.state.claimExpiresAt = new Date(afterExpiry.getTime() - 1);
  const deletion = await reserveWholesaleMediaDeletion({
    MediaModel: media,
    WholesaleLotModel: Model,
    publicId: image.publicId,
    now: afterExpiry,
  });
  assert.equal(deletion.state, 'reserved');
  await finishWholesaleMediaDeletion({ MediaModel: media, publicId: image.publicId, deleteId: deletion.deleteId });
  releasePatch();

  const saveResponse = await saving;
  assert.equal(saveResponse.status, 503);
  assert.equal(current.status, 'draft');
  assert.equal(current.visibility, 'private');
  assert.equal(current.image.publicId, image.publicId);
  assert.equal(media.state.state, 'deleted');

  const publishResponse = await request(app, `/api/admin/wholesale/${objectId}/publish`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 5 }),
  });
  assert.equal(publishResponse.status, 409);
  assert.equal(updateCalls, 1);
});

test('published lots require unpublish before image replacement', async () => {
  const replacement = {
    url: 'https://res.cloudinary.com/fike/image/upload/v2/reflexity-ram/wholesale/wholesale-replacement.webp',
    publicId: 'reflexity-ram/wholesale/wholesale-replacement',
    alt: 'Replacement image',
  };
  const Model = {
    findOne: () => ({ lean: async () => ({ ...completeLot }) }),
    findOneAndUpdate() { throw new Error('published image replacement must not mutate'); },
  };
  const MediaModel = {
    findOne() { throw new Error('published image replacement must not claim media'); },
    findOneAndUpdate() { throw new Error('published image replacement must not claim media'); },
  };
  const app = makeAdminApp({
    Model,
    MediaModel,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4, image: replacement }),
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /unpublish.*image/i);
});

test('publish succeeds only with exact attached media ownership', async () => {
  const current = { ...completeLot, status: 'draft', visibility: 'private' };
  const media = makeMediaModel({
    _id: 'media-publish-ready', publicId: image.publicId, url: image.url, state: 'attached', lotId: objectId,
  });
  let transition;
  const Model = {
    findOne: () => ({ select() { return this; }, lean: async () => ({ ...current }) }),
    findOneAndUpdate(filter, mutation) {
      transition = { filter, mutation };
      return { lean: async () => ({ ...current, ...mutation.$set, __v: 5 }) };
    },
    findById() { return foundQuery({ _id: objectId }); },
  };
  const app = makeAdminApp({
    Model,
    MediaModel: media,
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  });
  const response = await request(app, `/api/admin/wholesale/${objectId}/publish`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ version: 4 }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.lot.status, 'published');
  assert.equal(transition.mutation.$set.visibility, 'public');
});

test('durable wholesale media claims make concurrent attach and deletion mutually exclusive', async () => {
  const now = new Date('2026-08-25T16:00:00.000Z');
  const media = makeMediaModel({
    _id: 'media-one',
    publicId: image.publicId,
    url: image.url,
    state: 'available',
    lotId: null,
  });
  const lots = [];
  const LotModel = makeLotReferenceModel(lots);
  const [claim, deletion] = await Promise.all([
    claimWholesaleMedia({ MediaModel: media, WholesaleLotModel: LotModel, image, lotId: objectId, now }),
    reserveWholesaleMediaDeletion({ MediaModel: media, WholesaleLotModel: LotModel, publicId: image.publicId, now }),
  ]);
  assert.equal(Boolean(claim) + Number(deletion.state === 'reserved'), 1);
  assert.ok(['claiming', 'deleting'].includes(media.state.state));

  if (claim) {
    lots.push({ _id: objectId, image: { publicId: image.publicId } });
    assert.equal(await finalizeWholesaleMediaClaim({
      MediaModel: media, publicId: image.publicId, claimId: claim.claimId, lotId: objectId,
    }), true);
    const attachedDelete = await reserveWholesaleMediaDeletion({
      MediaModel: media, WholesaleLotModel: LotModel, publicId: image.publicId, now,
    });
    assert.equal(attachedDelete.state, 'attached');
  }
});

test('wholesale image deletion reserves durable ownership before Cloudinary deletion', async () => {
  const deleted = [];
  const media = makeMediaModel({
    _id: 'media-delete',
    publicId: image.publicId,
    url: image.url,
    state: 'available',
    lotId: null,
  });
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    WholesaleMediaAsset: media,
    WholesaleLot: makeLotReferenceModel([]),
    deleteImage: async (publicId) => { deleted.push(publicId); },
  }));
  const response = await request(app, `/api/upload/wholesale/${encodeURIComponent(image.publicId)}`, {
    method: 'DELETE',
    headers: { authorization: 'bearer valid-token' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(deleted, [image.publicId]);
  assert.equal(media.state.state, 'deleted');

  const attachedMedia = makeMediaModel({
    _id: 'media-attached', publicId: image.publicId, url: image.url, state: 'attached', lotId: objectId,
  });
  const attachedApp = express();
  attachedApp.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    WholesaleMediaAsset: attachedMedia,
    WholesaleLot: makeLotReferenceModel([{ _id: objectId, image: { publicId: image.publicId } }]),
    deleteImage: async () => { throw new Error('must not delete an attached image'); },
  }));
  const attachedResponse = await request(attachedApp, `/api/upload/wholesale/${encodeURIComponent(image.publicId)}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(attachedResponse.status, 409);
});

test('an ambiguous Cloudinary deletion keeps its durable lease and blocks attachment', async () => {
  let deletionAttempts = 0;
  const media = makeMediaModel({
    _id: 'media-ambiguous',
    publicId: image.publicId,
    url: image.url,
    state: 'available',
    lotId: null,
  });
  const LotModel = makeLotReferenceModel([]);
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    WholesaleMediaAsset: media,
    WholesaleLot: LotModel,
    deleteImage: async () => {
      deletionAttempts += 1;
      if (deletionAttempts === 1) throw new Error('response lost after remote completion');
    },
  }));

  const first = await request(app, `/api/upload/wholesale/${encodeURIComponent(image.publicId)}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(first.status, 503);
  assert.equal(media.state.state, 'deleting');
  assert.equal(await claimWholesaleMedia({
    MediaModel: media,
    WholesaleLotModel: LotModel,
    image,
    lotId: objectId,
    now: new Date(),
  }), null);

  media.state.deleteExpiresAt = new Date(Date.now() - 1000);
  const retry = await request(app, `/api/upload/wholesale/${encodeURIComponent(image.publicId)}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(retry.status, 200);
  assert.equal(deletionAttempts, 2);
  assert.equal(media.state.state, 'deleted');
});

test('a failed wholesale media registration removes its fresh Cloudinary upload', async () => {
  const deleted = [];
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    uploadWholesaleImageFile: { single: () => (req, _res, next) => {
      req.file = { originalname: 'fresh.webp', buffer: Buffer.from('image') };
      next();
    } },
    uploadWholesaleImage: async () => ({ secure_url: image.url, public_id: image.publicId }),
    WholesaleMediaAsset: {
      findOneAndUpdate: () => ({ lean: async () => {
        const error = new Error('registry document rejected before commit');
        error.name = 'ValidationError';
        throw error;
      } }),
      findOne: () => ({ lean: async () => null }),
    },
    deleteImage: async (publicId) => { deleted.push(publicId); },
  }));
  const response = await request(app, '/api/upload/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /registered/i);
  assert.deepEqual(deleted, [image.publicId]);
});

test('a registry upsert that commits before a lost response never deletes its Cloudinary asset', async () => {
  const deleted = [];
  let registered = null;
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    uploadWholesaleImageFile: { single: () => (req, _res, next) => {
      req.file = { originalname: 'committed.webp', buffer: Buffer.from('image') };
      next();
    } },
    uploadWholesaleImage: async () => ({ secure_url: image.url, public_id: image.publicId }),
    WholesaleMediaAsset: {
      findOneAndUpdate: (_filter, update) => ({
        lean: async () => {
          registered = { _id: 'registered-media', ...update.$setOnInsert };
          throw new Error('response lost after registry commit');
        },
      }),
      findOne: () => ({ lean: async () => registered }),
    },
    deleteImage: async (publicId) => { deleted.push(publicId); },
  }));
  const response = await request(app, '/api/upload/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 201);
  assert.equal(registered.publicId, image.publicId);
  assert.deepEqual(deleted, []);
});

test('an unknown registry failure with an immediate null read preserves a delayed commit asset', async () => {
  const deleted = [];
  let attempted = null;
  let registered = null;
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    uploadWholesaleImageFile: { single: () => (req, _res, next) => {
      req.file = { originalname: 'delayed-registry.webp', buffer: Buffer.from('image') };
      next();
    } },
    uploadWholesaleImage: async () => ({ secure_url: image.url, public_id: image.publicId }),
    WholesaleMediaAsset: {
      findOneAndUpdate: (_filter, update) => ({
        lean: async () => {
          attempted = { _id: 'delayed-media', ...update.$setOnInsert };
          throw new Error('registry response lost while server write continues');
        },
      }),
      findOne: () => ({ lean: async () => registered }),
    },
    deleteImage: async (publicId) => { deleted.push(publicId); },
  }));
  const response = await request(app, '/api/upload/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(deleted, []);
  registered = attempted;
  assert.equal(registered.publicId, image.publicId);
  assert.equal(registered.state, 'available');
});

test('an unavailable registry outcome check preserves the remote asset and returns pending', async () => {
  const deleted = [];
  const app = express();
  app.use('/api/upload', createUploadRouter({
    authenticate: (req, _res, next) => { req.user = { _id: objectId, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    uploadWholesaleImageFile: { single: () => (req, _res, next) => {
      req.file = { originalname: 'uncertain.webp', buffer: Buffer.from('image') };
      next();
    } },
    uploadWholesaleImage: async () => ({ secure_url: image.url, public_id: image.publicId }),
    WholesaleMediaAsset: {
      findOneAndUpdate: () => ({ lean: async () => { throw new Error('registry response lost'); } }),
      findOne: () => ({ lean: async () => { throw new Error('registry read unavailable'); } }),
    },
    deleteImage: async (publicId) => { deleted.push(publicId); },
  }));
  const response = await request(app, '/api/upload/wholesale', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(response.status, 503);
  assert.match(response.body.error, /confirmed/i);
  assert.deepEqual(deleted, []);
});
