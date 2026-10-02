const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_promotion_code_unit_test';

const Cart = require('../src/models/Cart');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const stripeRouter = require('../src/routes/stripe');

const productQuery = (items) => ({
  then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
});

async function request(app, path, method = 'POST') {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'x-session-id': 'session_0123456789' },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const app = () => {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/stripe', stripeRouter);
  return instance;
};

test('ordinary Checkout sessions enable Stripe promotion-code entry', async () => {
  const originalFind = Product.find;
  const originalCartFindOne = Cart.findOne;
  try {
    Product.find = () => productQuery([{
      _id: 'product-id', slug: 'ddr4-64gb', name: '64GB DDR4', price: 500,
      stock: 'in', stockQuantity: 1, isActive: true, line: 'Server',
    }]);
    Cart.findOne = async () => ({ items: [{ slug: 'ddr4-64gb', qty: 1 }] });
    let payload;
    stripeRouter.setCheckoutDependenciesForTest({
      ensurePrice: async () => 'price_ddr4_64gb',
      createSession: async (sent) => { payload = sent; return { id: 'cs_promo', url: 'https://stripe.test/promo' }; },
    });

    const response = await request(app(), '/api/stripe/create-checkout-session');
    assert.equal(response.status, 200);
    assert.equal(payload.allow_promotion_codes, true);
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Product.find = originalFind;
    Cart.findOne = originalCartFindOne;
  }
});

test('fulfillment persists the Stripe promotion discount in dollars', async () => {
  const originalProductFindOne = Product.findOne;
  const originalOrderFindOne = Order.findOne;
  const originalOrderCreate = Order.create;
  const originalCartFindOneAndUpdate = Cart.findOneAndUpdate;
  try {
    Product.findOne = async () => ({
      _id: 'product-id', slug: 'ddr4-64gb', sku: 'DDR4-64', name: '64GB DDR4', images: [],
    });
    Order.findOne = async () => null;
    let created;
    Order.create = async (values) => {
      created = values;
      return { ...values, _id: 'order-id', orderNumber: 'RFX-PROMO', stockDecremented: true };
    };
    Cart.findOneAndUpdate = async () => undefined;
    stripeRouter.setCheckoutDependenciesForTest({
      retrieveSession: async () => ({
        id: 'cs_discount', payment_status: 'paid', metadata: { userId: 'guest', cartSessionId: 'session_0123456789' },
        line_items: { data: [{ price: { id: 'price_ddr4_64gb', unit_amount: 50000 }, quantity: 1 }] },
        amount_subtotal: 50000, amount_total: 48900,
        total_details: { amount_discount: 2500, amount_shipping: 1400, amount_tax: 0 },
        shipping_cost: { shipping_rate: { display_name: 'Standard Shipping' } },
        customer_details: { name: 'Buyer Test', address: { line1: '1 Main St', city: 'Toronto', state: 'ON', postal_code: 'M5V 1E3', country: 'CA' } },
        payment_intent: 'pi_discount',
      }),
      decrementStock: async () => true,
    });

    const response = await request(app(), '/api/stripe/session-status?session_id=cs_discount', 'GET');
    assert.equal(response.status, 200);
    assert.equal(created.discount, 25);
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Product.findOne = originalProductFindOne;
    Order.findOne = originalOrderFindOne;
    Order.create = originalOrderCreate;
    Cart.findOneAndUpdate = originalCartFindOneAndUpdate;
  }
});
