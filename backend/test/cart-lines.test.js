// A cart line is found by its product id, so a slug edited in admin cannot make the cart page, checkout and the shipping quotes disagree
// about what is in the cart (the owner's "I removed one and the cart showed nothing" of 2026-10-07).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_cart_lines_unit_test';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const cartRouter = require('../src/routes/cart');
const stripeRouter = require('../src/routes/stripe');
const { resolveCartLines } = require('../src/utils/cartLines');
const { mergeCartItems, mergeGuestCartForUser } = require('../src/utils/guestCartMerge');

const HYNIX = { _id: '64b7f0c2a1b2c3d4e5f60711', slug: 'rfx-sk-hynix-16gb', sku: 'HYNIX-16', name: 'SK hynix 16GB', price: 135, stock: 'in', stockQuantity: 9, isActive: true, line: 'Server' };
const SAMSUNG = { _id: '64b7f0c2a1b2c3d4e5f60712', slug: 'rfx-samsung-64gb', sku: 'SAM-64', name: 'Samsung 64GB', price: 585, stock: 'in', stockQuantity: 1, isActive: true, line: 'Server' };

// Answers Product.find the way Mongo would for the two filter shapes the shared resolver uses ($or of _id/slug, plus isActive and line).
const catalog = (products) => (filter) => {
  const clauses = filter.$or || [filter];
  const docs = products.filter((p) => (filter.isActive === undefined || p.isActive === filter.isActive) && (!filter.line || p.line === filter.line)
    && clauses.some((c) => c._id?.$in?.map(String).includes(String(p._id)) || c.slug?.$in?.includes(p.slug)));
  return { lean: async () => docs, then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject) };
};

const withStubs = async (products, cart, run) => {
  const originals = { find: Product.find, findOne: Product.findOne, cartFindOne: Cart.findOne };
  Product.find = catalog(products);
  Product.findOne = async (filter) => products.find((p) => p.isActive && (String(p._id) === String(filter._id) || p.slug === filter.slug)) || null;
  Cart.findOne = async () => cart;
  try { await run(); } finally { Product.find = originals.find; Product.findOne = originals.findOne; Cart.findOne = originals.cartFindOne; }
};

const call = async (app, method, path, body) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise((resolve) => server.close(resolve)); }
};
const appWith = (path, router) => { const app = express(); app.use(express.json()); app.use(path, router); return app; };

test('a cart line is found by its product id when its slug is stale; the slug only serves legacy lines without an id', async () => {
  const items = [
    { product: HYNIX._id, slug: 'the-old-hynix-slug', qty: 1 },        // renamed since it was added
    { slug: SAMSUNG.slug, qty: 1 },                                      // legacy line saved without a product id
    { product: '64b7f0c2a1b2c3d4e5f60799', slug: HYNIX.slug, qty: 1 },   // an id that matches nothing must NOT borrow another product's slug
  ];
  await withStubs([HYNIX, SAMSUNG], null, async () => {
    for (const lean of [false, true]) {
      const lines = await resolveCartLines(items, { lean });
      assert.deepEqual(lines.map((l) => [l.item.qty, l.product.sku]), [[1, 'HYNIX-16'], [1, 'SAM-64']], `lean=${lean}`);
    }
  });
  await withStubs([{ ...HYNIX, isActive: false }, { ...SAMSUNG, line: 'Wholesale' }], null, async () => {
    assert.deepEqual(await resolveCartLines(items), [], 'inactive and non-Server products are left out');
  });
  assert.deepEqual(await resolveCartLines(undefined), []);
  assert.deepEqual(await resolveCartLines([]), []);
});

test('the cart page shows the product\'s current price and heals the stored line (slug, name and price), without ever failing the page', async () => {
  const stale = () => ({ product: HYNIX._id, slug: 'the-old-hynix-slug', sku: 'OLD', name: 'Old name', price: 99, qty: 2 });
  const cart = { _id: 'cart-1', items: [stale()], discount: 0, couponCode: undefined, saves: 0, async save() { this.saves += 1; } };
  await withStubs([HYNIX], cart, async () => {
    const response = await call(appWith('/api/cart', cartRouter), 'GET', '/api/cart');
    assert.equal(response.status, 200);
    const [line] = response.body.cart.items;
    assert.deepEqual([line.slug, line.price, line.qty], [HYNIX.slug, 135, 2]);
    assert.equal(response.body.cart.subtotal, 270, 'the subtotal uses the current price, not the one stored at add time');
    assert.deepEqual([cart.items[0].slug, cart.items[0].sku, cart.items[0].name, cart.items[0].price], [HYNIX.slug, 'HYNIX-16', 'SK hynix 16GB', 135]);
    assert.equal(cart.saves, 1);
  });
  const conflicting = { _id: 'cart-2', items: [stale()], async save() { throw new Error('VersionError: concurrent change'); } };
  await withStubs([HYNIX], conflicting, async () => {
    const response = await call(appWith('/api/cart', cartRouter), 'GET', '/api/cart');
    assert.equal(response.status, 200, 'a lost save race never turns a cart view into an error');
    assert.equal(response.body.cart.items.length, 1);
  });
});

test('removing one line keeps the other whatever its stored slug says, and the response agrees with the next GET', async () => {
  const cart = {
    _id: 'cart-3', async save() {},
    items: [
      { product: HYNIX._id, slug: 'the-old-hynix-slug', sku: 'HYNIX-16', name: 'x', price: 135, qty: 1 },
      { product: SAMSUNG._id, slug: SAMSUNG.slug, sku: 'SAM-64', name: 'y', price: 585, qty: 1 },
    ],
  };
  await withStubs([HYNIX, SAMSUNG], cart, async () => {
    // the cart page sends the line's own stored slug; the stand-in for mutateCartWithRetry is the real one over this plain cart
    const { createCartMutation } = require('../src/utils/cartConcurrency');
    assert.equal(typeof createCartMutation, 'function');
    const removed = await call(appWith('/api/cart', cartRouter), 'DELETE', `/api/cart/remove/${SAMSUNG.slug}`);
    assert.equal(removed.status, 200);
    const afterRemove = removed.body.cart.items.map((i) => i.sku);
    assert.deepEqual(afterRemove, ['HYNIX-16']);
    const reloaded = await call(appWith('/api/cart', cartRouter), 'GET', '/api/cart');
    assert.deepEqual(reloaded.body.cart.items.map((i) => i.sku), afterRemove, 'what the mutation answers is what a reload shows');
  });
});

test('checkout charges the line a stale slug used to hide, and counts it like the cart page does', async () => {
  const cart = { items: [{ product: HYNIX._id, slug: 'the-old-hynix-slug', qty: 3 }] };
  await withStubs([HYNIX], cart, async () => {
    let payload;
    stripeRouter.setCheckoutDependenciesForTest({
      ensurePrice: async () => 'price_hynix',
      createSession: async (sent) => { payload = sent; return { id: 'cs_stale', url: 'https://stripe.test/stale' }; },
    });
    try {
      const response = await call(appWith('/api/stripe', stripeRouter), 'POST', '/api/stripe/create-checkout-session', {});
      assert.equal(response.status, 200);
      assert.deepEqual(payload.line_items, [{ price: 'price_hynix', quantity: 3 }], 'the buyer is charged for the line the cart page shows');
      // 3 sticks cost the 3-or-more flat rate: the shipping was worked out from the same line
      assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, 2500);
    } finally { stripeRouter.setCheckoutDependenciesForTest(); }
  });
});

test('adding a stick whose line carries an old slug joins that line instead of starting a second one, and refreshes its stored price', async () => {
  const cart = { _id: 'cart-4', async save() {}, items: [{ product: HYNIX._id, slug: 'the-old-hynix-slug', sku: 'HYNIX-16', name: 'x', price: 99, qty: 1 }] };
  await withStubs([HYNIX], cart, async () => {
    const added = await call(appWith('/api/cart', cartRouter), 'POST', '/api/cart/add', { slug: HYNIX.slug, qty: 2 });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.cart.items.map((i) => [i.sku, i.qty]), [['HYNIX-16', 3]], 'one line for one product');
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].price, HYNIX.price, 'the stored price follows the product');
  });
});

test('the stock limit counts the whole line even when it carries an old slug, so splitting a quantity across two lines is impossible', async () => {
  const cart = { _id: 'cart-5', async save() {}, items: [{ product: HYNIX._id, slug: 'the-old-hynix-slug', sku: 'HYNIX-16', name: 'x', price: 135, qty: 8 }] };
  await withStubs([HYNIX], cart, async () => {
    const refused = await call(appWith('/api/cart', cartRouter), 'POST', '/api/cart/add', { slug: HYNIX.slug, qty: 2 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Only 9 units available \(8 already in your cart\)/);
    assert.deepEqual(cart.items.map((i) => i.qty), [8]);
  });
});

test('the login merge keeps one line per stick when one of the carts holds an old slug for it, capped by stock like any merge', () => {
  const stale = (qty) => [{ product: HYNIX._id, slug: 'the-old-hynix-slug', sku: 'OLD', name: 'old', price: 99, qty }];
  const guest = [{ product: HYNIX._id, slug: HYNIX.slug, sku: 'HYNIX-16', name: 'x', price: 135, qty: 2 }];
  assert.deepEqual(mergeCartItems(stale(1), guest, [HYNIX]).map((l) => [l.slug, l.qty, l.price]), [[HYNIX.slug, 3, 135]]);
  assert.equal(mergeCartItems(stale(8), guest, [HYNIX])[0].qty, 9, 'stock is 9');
  const staleGuest = [{ product: HYNIX._id, slug: 'the-old-hynix-slug', qty: 4 }];   // the guest's own line is the old one
  assert.deepEqual(mergeCartItems([{ product: HYNIX._id, slug: HYNIX.slug, qty: 1 }], staleGuest, [HYNIX]).map((l) => [l.slug, l.qty]), [[HYNIX.slug, 5]]);
});

test('a line whose product is gone is kept as it is and never merges into a different product that now has its slug', () => {
  const GONE = '64b7f0c2a1b2c3d4e5f60799';
  const newcomer = { ...SAMSUNG, slug: 'reused-slug' };
  const merged = mergeCartItems(
    [{ product: GONE, slug: 'reused-slug', sku: 'GONE', name: 'gone', price: 1, qty: 1 }],
    [{ product: SAMSUNG._id, slug: 'reused-slug', qty: 1 }],
    [newcomer],
  );
  assert.deepEqual(merged.map((l) => [String(l.product), l.qty]), [[GONE, 1], [SAMSUNG._id, 1]]);
  assert.equal(mergeCartItems([{ product: GONE, slug: 'x', qty: 1 }, { product: GONE, slug: 'x', qty: 1 }], [], []).length, 1, 'the same kept line is not repeated');
});

test('logging in merges the guest cart by product id: the lookup asks for ids, one line results, the guest cart is removed', async () => {
  const guestCart = { _id: 'g1', items: [{ product: HYNIX._id, slug: HYNIX.slug, qty: 2 }] };
  const userCart = { _id: 'u1', saved: 0, async save() { this.saved += 1; }, items: [{ product: HYNIX._id, slug: 'the-old-hynix-slug', qty: 1 }] };
  const original = { find: Product.find, findOne: Cart.findOne, deleteOne: Cart.deleteOne };
  const filters = [];
  let deleted;
  Product.find = (filter) => { filters.push(filter); return catalog([HYNIX])(filter); };
  Cart.findOne = async (filter) => (filter.sessionId ? guestCart : userCart);
  Cart.deleteOne = async (filter) => { deleted = filter; };
  try {
    await mergeGuestCartForUser('user-1', 'session_0123456789');
  } finally { Product.find = original.find; Cart.findOne = original.findOne; Cart.deleteOne = original.deleteOne; }
  assert.deepEqual(userCart.items.map((l) => [l.slug, l.qty]), [[HYNIX.slug, 3]]);
  assert.equal(userCart.saved, 1);
  assert.deepEqual(deleted, { _id: 'g1' });
  assert.deepEqual(filters.map((f) => [f.$or, f.isActive]), [[[{ _id: { $in: [HYNIX._id] } }], true]], 'products are asked for by id, not by the slugs that may be stale');
});
