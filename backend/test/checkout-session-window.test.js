const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_checkout_window_unit_test';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const stripeRouter = require('../src/routes/stripe');

const productQuery = (items) => ({
  then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
});

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'x-session-id': 'session_0123456789' },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A buyer who has to approve the payment in their banking app can take longer
// than half an hour; a 30-minute window cancelled one mid-verification.
test('checkout sessions stay open for Stripe\'s full 24-hour default', async () => {
  const originalFind = Product.find;
  const originalCartFindOne = Cart.findOne;
  try {
    Product.find = () => productQuery([{
      _id: 'product-id', slug: 'ddr4-16gb', name: '16GB DDR4', price: 135,
      stock: 'in', stockQuantity: 10, isActive: true, line: 'Server',
    }]);
    Cart.findOne = async () => ({ items: [{ slug: 'ddr4-16gb', qty: 4 }] });
    let payload;
    stripeRouter.setCheckoutDependenciesForTest({
      ensurePrice: async () => 'price_ddr4_16gb',
      createSession: async (sent) => { payload = sent; return { id: 'cs_window', url: 'https://stripe.test/window' }; },
    });

    const app = express();
    app.use(express.json());
    app.use('/api/stripe', stripeRouter);
    const response = await request(app, '/api/stripe/create-checkout-session');

    assert.equal(response.status, 200);
    assert.equal('expires_at' in payload, false, 'no custom expiry, so Stripe applies its 24-hour default');
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Product.find = originalFind;
    Cart.findOne = originalCartFindOne;
  }
});
