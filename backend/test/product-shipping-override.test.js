// Per-product shipping override: most products ship at the store's standard
// flat rate, a few lots carry their own higher rate. A cart is charged the
// highest rate it contains — never the sum.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_shipping_override_unit_test';

const {
  STANDARD_SHIPPING_PRICE,
  shippingPriceForProduct,
  resolveCartShippingPrice,
  toStripeShippingOptions,
} = require('../src/config/shipping');
const { PUBLIC_PRODUCT_PROJECTION } = require('../src/utils/publicProducts');
const Product = require('../src/models/Product');
const Cart = require('../src/models/Cart');
const stripeRouter = require('../src/routes/stripe');
const feedRouter = require('../src/routes/feed');

const product = (overrides = {}) => ({
  _id: 'product-id',
  slug: 'server-rdimm',
  sku: 'SERVER-RDIMM',
  name: 'Server RDIMM 16GB',
  description: 'Tested server memory module with a full specification listing.',
  price: 135,
  images: [{ url: 'https://cdn.example/module.jpg' }],
  isActive: true,
  stock: 'in',
  stockQuantity: 10,
  line: 'Server',
  generation: 'DDR4',
  formFactor: 'RDIMM',
  condition: 'Open Box — Tested',
  ...overrides,
});
const productQuery = (items) => ({
  lean: async () => items,
  then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
});

async function jsonRequest(app, path, body, method = 'POST') {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a product without an override ships at the standard flat rate', () => {
  assert.equal(STANDARD_SHIPPING_PRICE, 14);
  assert.equal(shippingPriceForProduct(product()), 14);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: null })), 14);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: '' })), 14);
  assert.equal(shippingPriceForProduct(undefined), 14);
});

test('an override sets that product\'s rate, and junk falls back to the flat rate', () => {
  assert.equal(shippingPriceForProduct(product({ shippingPrice: 25 })), 25);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: '25' })), 25);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: 0 })), 0);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: -5 })), 14);
  assert.equal(shippingPriceForProduct(product({ shippingPrice: 'free' })), 14);
});

test('a cart is charged the highest rate it contains, never the sum', () => {
  assert.equal(resolveCartShippingPrice([]), 14);
  assert.equal(resolveCartShippingPrice([product(), product()]), 14);
  // 25 + 14 would be 39; the buyer pays 25.
  assert.equal(resolveCartShippingPrice([product({ shippingPrice: 25 }), product()]), 25);
  assert.equal(resolveCartShippingPrice([product(), product({ shippingPrice: 25 })]), 25);
  assert.equal(
    resolveCartShippingPrice([product({ shippingPrice: 25 }), product({ shippingPrice: 40 })]),
    40
  );
  // A cheaper-than-standard override is honoured when nothing dearer is present.
  assert.equal(resolveCartShippingPrice([product({ shippingPrice: 5 })]), 5);
  assert.equal(resolveCartShippingPrice([product({ shippingPrice: 5 }), product()]), 14);
});

test('Stripe shipping options carry the resolved amount in cents', () => {
  const [standard] = toStripeShippingOptions();
  assert.equal(standard.shipping_rate_data.fixed_amount.amount, 1400);
  const [overridden] = toStripeShippingOptions(25);
  assert.equal(overridden.shipping_rate_data.fixed_amount.amount, 2500);
  const [garbage] = toStripeShippingOptions('not-a-number');
  assert.equal(garbage.shipping_rate_data.fixed_amount.amount, 1400);
});

test('checkout charges the override from the server-side product, not the client', async () => {
  const originalFind = Product.find;
  const originalCartFindOne = Cart.findOne;
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/stripe', stripeRouter);

    const lot = new Product(product({
      _id: undefined,
      slug: 'server-rdimm',
      price: 135,
      shippingPrice: 25,
      capacityLabel: '16GB',
      capacity: 16,
      speed: 3200,
      speedLabel: '3200 MT/s',
      warranty: '30 Days',
    }));
    Product.find = () => productQuery([lot]);
    Cart.findOne = async () => ({
      items: [{ slug: 'server-rdimm', name: 'Server RDIMM 16GB', price: 135, qty: 2, shippingPrice: 1 }],
      save: async () => undefined,
    });

    let payload;
    stripeRouter.setCheckoutDependenciesForTest({
      ensurePrice: async () => 'price_server_rdimm',
      createSession: async (sent) => { payload = sent; return { id: 'cs_test', url: 'https://stripe.test/s' }; },
    });

    const response = await jsonRequest(app, '/api/stripe/create-checkout-session', {});
    assert.equal(response.status, 200);
    assert.equal(payload.shipping_options.length, 1);
    // 2500, not 1400 (the flat rate) and not 100 (the value planted in the cart).
    assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, 2500);
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Product.find = originalFind;
    Cart.findOne = originalCartFindOne;
  }
});

test('the Google feed advertises each product at its own shipping rate', async () => {
  const originalFind = Product.find;
  try {
    Product.find = () => productQuery([
      product({ sku: 'FLAT-RATE', slug: 'flat-rate', name: 'Flat Rate Module' }),
      product({ sku: 'OVERRIDDEN', slug: 'overridden', name: 'Overridden Module', shippingPrice: 25 }),
    ]);
    const app = express();
    app.use('/', feedRouter);
    const response = await jsonRequest(app, '/feed.xml', undefined, 'GET');
    assert.equal(response.status, 200);

    const items = response.text.split('<item>').slice(1);
    assert.equal(items.length, 2);
    assert.match(items[0], /<g:price>14 CAD<\/g:price><\/g:shipping>/);
    assert.match(items[1], /<g:price>25 CAD<\/g:price><\/g:shipping>/);
    assert.equal((items[1].match(/25 CAD<\/g:price><\/g:shipping>/g) || []).length, 2); // CA + US
  } finally {
    Product.find = originalFind;
  }
});

test('the override is exposed to the storefront so the product page can show it', () => {
  assert.equal(PUBLIC_PRODUCT_PROJECTION.shippingPrice, 1);
});
