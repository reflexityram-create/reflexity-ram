const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProductPagination,
  buildProductSort,
} = require('../src/utils/pagination');
const { orderBelongsToUser } = require('../src/utils/orderAccess');
const { mergeCartItems } = require('../src/utils/guestCartMerge');
const { isFullyRefundedCharge } = require('../src/utils/refunds');
const {
  shouldDecrementStockForFulfillment,
  stockDecrementClaimFilter,
  cancellationClaimFilter,
} = require('../src/utils/stock');
const { STATIC_PAGES } = require('../src/config/sitemap');
const { canTransitionOrder } = require('../src/utils/orderTransitions');
const { isValidGuestSessionId } = require('../src/utils/guestSession');
const { escapeHtml } = require('../src/utils/htmlEscape');
const { sanitizeHtml } = require('../src/utils/sanitizeHtml');
const { CartMutationError, createCartMutation } = require('../src/utils/cartConcurrency');
const Cart = require('../src/models/Cart');
const {
  PUBLIC_PRODUCT_PROJECTION,
  ProductQueryError,
  parseProductQuery,
} = require('../src/utils/publicProducts');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { MongoRateLimitStore } = require('../src/utils/mongoRateLimitStore');
const { orderAccessUrl } = require('../src/utils/orderAccessLink');

const product = (overrides = {}) => ({
  _id: 'product-id',
  slug: 'ddr5-32',
  sku: 'DDR5-32',
  name: 'Current DDR5 32GB',
  price: 129.99,
  images: [{ url: 'https://cdn.example/current.jpg' }],
  isActive: true,
  stock: 'in',
  stockQuantity: 50,
  ...overrides,
});

test('product pagination caps before calculating skip', () => {
  assert.deepEqual(normalizeProductPagination('2', '500'), {
    page: 2,
    limit: 100,
    skip: 100,
  });
  assert.deepEqual(normalizeProductPagination('not-a-page', '0'), {
    page: 1,
    limit: 24,
    skip: 0,
  });
});

test('product sorting has a deterministic _id tie-breaker', () => {
  assert.deepEqual(buildProductSort('createdAt', 'desc'), { createdAt: -1, _id: 1 });
  assert.deepEqual(buildProductSort('price', 'asc'), { price: 1, _id: 1 });
});

test('public product filters reject malformed numeric and repeated values', () => {
  assert.throws(() => parseProductQuery({ capacity: 'abc' }), ProductQueryError);
  assert.throws(() => parseProductQuery({ minPrice: 'wat' }), ProductQueryError);
  assert.throws(() => parseProductQuery({ minPrice: '20', maxPrice: '10' }), ProductQueryError);
  assert.throws(() => parseProductQuery({ generation: ['DDR4', 'DDR5'] }), ProductQueryError);
  assert.deepEqual(parseProductQuery({
    generation: 'DDR4,DDR5',
    capacity: '32,64',
    minPrice: '25',
    maxPrice: '200',
    featured: 'true',
    sort: 'price',
    order: 'asc',
  }), {
    filter: {
      isActive: true,
      generation: { $in: ['DDR4', 'DDR5'] },
      capacity: { $in: [32, 64] },
      price: { $gte: 25, $lte: 200 },
      isFeatured: true,
    },
    sort: 'price',
    order: 'asc',
  });
});

test('public product projection excludes provider and media-management metadata', () => {
  for (const field of [
    'stripeProductId',
    'stripePriceId',
    'stripePriceAmount',
    'stripePriceCurrency',
    'images.publicId',
    'stockQuantity',
    'updatedAt',
    '__v',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(PUBLIC_PRODUCT_PROJECTION, field), false, field);
  }
  assert.equal(PUBLIC_PRODUCT_PROJECTION['images.url'], 1);
  assert.equal(PUBLIC_PRODUCT_PROJECTION.slug, 1);
});

test('order ownership accepts both raw and populated ObjectIds', () => {
  const id = { toString: () => 'user-1' };
  assert.equal(orderBelongsToUser(id, 'user-1'), true);
  assert.equal(orderBelongsToUser({ _id: id, email: 'owner@example.com' }, 'user-1'), true);
  assert.equal(orderBelongsToUser({ _id: id }, 'user-2'), false);
});

test('order ownership handles the self-referencing _id getter on Mongoose ObjectIds', () => {
  const id = { toString: () => 'user-1' };
  id._id = id;
  assert.equal(orderBelongsToUser(id, 'user-1'), true);
  assert.equal(orderBelongsToUser({ _id: id }, 'user-1'), true);
});

test('customer order responses omit payment-provider and inventory bookkeeping fields', () => {
  const response = customerOrderResponse({
    _id: 'order-id',
    orderNumber: 'RFX-TEST',
    user: { _id: 'user-id', email: 'buyer@example.com' },
    guestEmail: null,
    items: [{ product: 'product-id', slug: 'ram', sku: 'RAM', name: 'RAM', price: 50, image: '', qty: 1, decrementedQty: 1 }],
    shippingAddress: { firstName: 'Buyer', lastName: 'One', line1: '1 Main', city: 'Toronto', state: 'ON', zip: 'A1A1A1', country: 'CA' },
    status: 'processing',
    paymentStatus: 'paid',
    subtotal: 50,
    shippingCost: 10,
    tax: 0,
    discount: 0,
    total: 60,
    stripePaymentIntentId: 'pi_internal',
    stripeCheckoutSessionId: 'cs_internal',
    stripeChargeId: 'ch_internal',
    stockDecremented: true,
    archived: true,
    adminNotes: 'internal',
    statusHistory: [{ status: 'processing', timestamp: 'now', note: 'internal note' }],
  });

  assert.deepEqual(response.user, { email: 'buyer@example.com' });
  assert.equal(response.items[0].product, undefined);
  assert.equal(response.items[0].decrementedQty, undefined);
  assert.deepEqual(response.statusHistory, [{ status: 'processing', timestamp: 'now' }]);
  for (const field of ['stripePaymentIntentId', 'stripeCheckoutSessionId', 'stripeChargeId', 'stockDecremented', 'archived', 'adminNotes']) {
    assert.equal(response[field], undefined, field);
  }
});

test('guest order links keep email proof in the client-only fragment', () => {
  const guest = orderAccessUrl(
    'https://reflexityram.com',
    { orderNumber: 'RFX-ABC-123' },
    'Buyer+One@Example.com',
  );
  assert.equal(guest, 'https://reflexityram.com/order/RFX-ABC-123#email=buyer%2Bone%40example.com');
  assert.equal(new URL(guest).search, '');
  assert.equal(orderAccessUrl(
    'https://reflexityram.com',
    { orderNumber: 'RFX-ABC-123', user: 'user-id' },
    'buyer@example.com',
  ), 'https://reflexityram.com/order/RFX-ABC-123');
});

test('Mongo rate-limit store shares hashed fixed-window counters without retaining client identifiers', async () => {
  const rows = new Map();
  const Model = {
    async findOneAndUpdate(filter, update) {
      const current = rows.get(filter._id) || { _id: filter._id, hits: 0, expiresAt: update.$setOnInsert.expiresAt };
      current.hits += update.$inc.hits;
      rows.set(filter._id, current);
      return current;
    },
    async updateOne(filter, update) {
      const current = rows.get(filter._id);
      if (current?.hits > 0) current.hits += update.$inc.hits;
    },
    async deleteOne(filter) { rows.delete(filter._id); },
  };
  const store = new MongoRateLimitStore({ prefix: 'auth', Model, now: () => 900_001 });
  store.init({ windowMs: 900_000 });
  assert.deepEqual(await store.increment('203.0.113.4'), {
    totalHits: 1,
    resetTime: new Date(1_800_000),
  });
  assert.equal((await store.increment('203.0.113.4')).totalHits, 2);
  assert.equal([...rows.keys()][0].includes('203.0.113.4'), false);
  await store.decrement('203.0.113.4');
  assert.equal((await store.increment('203.0.113.4')).totalHits, 2);
  await store.resetKey('203.0.113.4');
  assert.equal(rows.size, 0);
});

test('guest cart merge refreshes details and caps the merged quantity to stock', () => {
  const items = mergeCartItems(
    [{ slug: 'ddr5-32', qty: 40, price: 1, sku: 'OLD', name: 'Old', image: 'old' }],
    [{ slug: 'ddr5-32', qty: 30, price: 2, sku: 'OLD-GUEST', name: 'Old guest', image: 'old' }],
    [product({ stockQuantity: 50 })],
  );

  assert.deepEqual(items, [{
    product: 'product-id',
    slug: 'ddr5-32',
    sku: 'DDR5-32',
    name: 'Current DDR5 32GB',
    price: 129.99,
    image: 'https://cdn.example/current.jpg',
    qty: 50,
  }]);
});

test('guest cart merge never adds inactive or out-of-stock guest items', () => {
  const items = mergeCartItems(
    [],
    [{ slug: 'out', qty: 1 }, { slug: 'inactive', qty: 1 }],
    [
      product({ slug: 'out', stock: 'out', stockQuantity: 4 }),
      product({ slug: 'inactive', isActive: false }),
    ],
  );

  assert.deepEqual(items, []);
});

test('guest cart merge preserves unavailable Mongoose subdocuments as plain items', () => {
  const unavailableItem = {
    slug: 'retired',
    toObject: () => ({
      product: 'retired-id',
      slug: 'retired',
      sku: 'RETIRED',
      name: 'Retired module',
      price: 10,
      image: '',
      qty: 1,
    }),
  };

  assert.deepEqual(mergeCartItems([unavailableItem], [], []), [{
    product: 'retired-id',
    slug: 'retired',
    sku: 'RETIRED',
    name: 'Retired module',
    price: 10,
    image: '',
    qty: 1,
  }]);
});

test('guest-only transfer obeys the cart maximum of 99', () => {
  const items = mergeCartItems([], [{ slug: 'ddr5-32', qty: 140 }], [product({ stockQuantity: 200 })]);
  assert.equal(items[0].qty, 99);
});

test('only a fully refunded Stripe charge is treated as a full refund', () => {
  assert.equal(isFullyRefundedCharge({ refunded: true, amount_refunded: 1000 }), true);
  assert.equal(isFullyRefundedCharge({ refunded: false, amount_refunded: 500 }), false);
  assert.equal(isFullyRefundedCharge(null), false);
});

test('Stripe recovery never re-decrements stock released by a terminal order', () => {
  assert.equal(shouldDecrementStockForFulfillment({ status: 'processing', stockDecremented: false }), true);
  assert.equal(shouldDecrementStockForFulfillment({ status: 'processing', stockDecremented: true }), false);
  assert.equal(shouldDecrementStockForFulfillment({ status: 'cancelled', stockDecremented: false }), false);
  assert.equal(shouldDecrementStockForFulfillment({ status: 'refunded', stockDecremented: false }), false);
  assert.deepEqual(stockDecrementClaimFilter('order-1'), {
    _id: 'order-1',
    stockDecremented: { $ne: true },
    status: { $nin: ['cancelled', 'refunded'] },
  });
});

test('admin cancellation claims the exact previously observed order state', () => {
  assert.deepEqual(cancellationClaimFilter('order-1', {
    status: 'pending',
    paymentStatus: 'pending',
  }), {
    _id: 'order-1',
    status: 'pending',
    paymentStatus: 'pending',
  });
  assert.throws(
    () => cancellationClaimFilter('order-1'),
    /exact expected order state/i,
  );
});

test('sitemap includes every indexable public storefront route', () => {
  const paths = new Set(STATIC_PAGES.map(({ path }) => path));
  const expectedPaths = [
    '/',
    '/shop',
    '/categories',
    '/guides',
    '/guides/ddr4-vs-ddr5',
    '/guides/ecc-rdimm-udimm-explained',
    '/guides/how-to-identify-ram',
    '/guides/how-much-ram-do-i-need',
    '/wholesale',
    '/liquidators',
    '/support',
    '/business-info',
    '/shipping',
    '/international',
    '/returns',
    '/warranty',
    '/faq',
    '/privacy',
    '/terms',
  ];

  for (const path of expectedPaths) {
    assert.equal(paths.has(path), true, `${path} must be present in the sitemap`);
  }
  assert.equal(paths.size, expectedPaths.length, 'sitemap paths must remain complete and unique');
});

test('admin order transitions are one-way and paid orders cannot be manually cancelled', () => {
  assert.equal(canTransitionOrder('pending', 'processing', 'pending'), false);
  assert.equal(canTransitionOrder('pending', 'processing', 'paid'), true);
  assert.equal(canTransitionOrder('processing', 'shipped', 'paid'), true);
  assert.equal(canTransitionOrder('processing', 'shipped', 'pending'), false);
  assert.equal(canTransitionOrder('shipped', 'delivered', 'pending'), false);
  assert.equal(canTransitionOrder('shipped', 'delivered', 'paid'), true);
  assert.equal(canTransitionOrder('shipped', 'processing', 'paid'), false);
  assert.equal(canTransitionOrder('pending', 'refunded', 'paid'), false);
  assert.equal(canTransitionOrder('pending', 'cancelled', 'paid'), false);
  assert.equal(canTransitionOrder('pending', 'cancelled', 'pending'), true);
});

test('guest session IDs are bounded opaque strings', () => {
  assert.equal(isValidGuestSessionId('session_0123456789'), true);
  assert.equal(isValidGuestSessionId({ $ne: null }), false);
  assert.equal(isValidGuestSessionId('too-short'), false);
  assert.equal(isValidGuestSessionId('x'.repeat(129)), false);
});

test('HTML email escaping and entity-encoded URL schemes are safe', () => {
  assert.equal(escapeHtml(`<img src="x">`), '&lt;img src=&quot;x&quot;&gt;');
  const sanitized = sanitizeHtml('<a href="java&#x73;cript:alert(1)">bad</a><a href="https://example.com">ok</a>');
  assert.equal(sanitized.includes('javascript:'), false);
  assert.match(sanitized, /https:\/\/example\.com/);
});

test('cart mutation retries a stale write against the latest cart instead of losing the other tab update', async () => {
  let reads = 0;
  const latest = { items: [{ slug: 'ddr5-32', qty: 2 }], expiresAt: null, save: async () => undefined };
  const stale = { items: [{ slug: 'ddr5-32', qty: 1 }], expiresAt: null, save: async () => { const error = new Error('stale'); error.name = 'VersionError'; throw error; } };
  class FakeCart {
    constructor(filter) { Object.assign(this, filter, { items: [] }); }
    async save() { this.saved = true; }
  }
  const mutate = createCartMutation({ CartModel: {
    async findOne() { reads += 1; return reads === 1 ? stale : latest; },
  } });
  const result = await mutate({ sessionId: 'session_0123456789' }, async (cart) => {
    cart.items[0].qty += 1;
  });
  assert.equal(reads, 2);
  assert.equal(result.items[0].qty, 3);
});

test('cart ownership indexes enforce one user cart and one guest cart per session', () => {
  const indexes = Cart.schema.indexes();
  assert.deepEqual(indexes.find(([keys]) => keys.user === 1)?.[1].unique, true);
  assert.deepEqual(indexes.find(([keys]) => keys.sessionId === 1)?.[1].unique, true);
});

test('exhausted cart write conflicts become a bounded 409 error', async () => {
  class AlwaysStaleCart {
    async save() { const error = new Error('stale'); error.name = 'VersionError'; throw error; }
  }
  const mutate = createCartMutation({ CartModel: { findOne: async () => new AlwaysStaleCart() } });
  await assert.rejects(
    () => mutate({ user: 'user-1' }, async () => undefined, { attempts: 2 }),
    (error) => error instanceof CartMutationError && error.status === 409,
  );
});

test('cart mutation reports a concurrent disappearance as not found', async () => {
  let called = false;
  const mutate = createCartMutation({ CartModel: { findOne: async () => null } });
  const result = await mutate({ sessionId: 'session_0123456789' }, async () => { called = true; });
  assert.equal(result, null);
  assert.equal(called, false);
});
