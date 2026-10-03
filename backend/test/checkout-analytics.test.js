const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_checkout_analytics_unit_test';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const stripeRouter = require('../src/routes/stripe');

const productQuery = (items) => ({
  lean: async () => items,
  then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
});

async function postCheckout(app, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Runs the real checkout route against stubbed models and returns the payload sent to Stripe.
async function checkoutPayloadFor(requestBody) {
  const originalFind = Product.find;
  const originalCartFindOne = Cart.findOne;
  let payload;
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/stripe', stripeRouter);
    const lot = new Product({
      slug: 'server-rdimm', sku: 'RDIMM-16', name: 'Server RDIMM 16GB', price: 135,
      isActive: true, stock: 'in', stockQuantity: 5, line: 'Server', formFactor: 'RDIMM',
      capacity: 16, capacityLabel: '16GB', speed: 3200, speedLabel: '3200 MT/s', warranty: '30 Days',
    });
    Product.find = () => productQuery([lot]);
    Cart.findOne = async () => ({ items: [{ slug: 'server-rdimm', name: 'Server RDIMM 16GB', price: 135, qty: 1 }], save: async () => undefined });
    stripeRouter.setCheckoutDependenciesForTest({
      ensurePrice: async () => 'price_server_rdimm',
      createSession: async (sent) => { payload = sent; return { id: 'cs_test', url: 'https://stripe.test/s' }; },
    });
    const response = await postCheckout(app, requestBody);
    assert.equal(response.status, 200, 'analytics input must never block checkout');
    return payload;
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Product.find = originalFind;
    Cart.findOne = originalCartFindOne;
  }
}

test('checkout hands the buyer\'s GA ids to Stripe so the webhook can attribute the purchase', async () => {
  const payload = await checkoutPayloadFor({ analytics: { clientId: '1234567890.1700000000', sessionId: '1789737000' } });
  assert.equal(payload.metadata.gaClientId, '1234567890.1700000000');
  assert.equal(payload.metadata.gaSessionId, '1789737000');
  assert.equal(payload.metadata.cartSessionId, 'session_0123456789', 'existing metadata is preserved');
});

test('checkout without analytics input behaves exactly as before', async () => {
  const payload = await checkoutPayloadFor({});
  assert.deepEqual(Object.keys(payload.metadata).sort(), ['cartSessionId', 'userId']);
});

test('malformed or hostile analytics input is dropped, never forwarded to Stripe', async () => {
  const payload = await checkoutPayloadFor({
    analytics: { clientId: '<img src=x onerror=alert(1)>', sessionId: 'not-a-number' },
  });
  assert.equal('gaClientId' in payload.metadata, false);
  assert.equal('gaSessionId' in payload.metadata, false);

  const wrongType = await checkoutPayloadFor({ analytics: 'x'.repeat(1000) });
  assert.equal('gaClientId' in wrongType.metadata, false);
});
