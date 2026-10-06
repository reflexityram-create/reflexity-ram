const test = require('node:test');
const assert = require('node:assert/strict');

// Swap the Resend SDK out before email.js loads so no test can send a real email.
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (message) => {
            sent.push(message);
            return { data: { id: 'email_test' }, error: null };
          },
        };
      }
    },
  },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_order_email_unit_test';

const { CURRENCY } = require('../src/config/shipping');
const { sendOrderConfirmationEmail } = require('../src/utils/email');

const money = (amount) => `$${amount.toFixed(2)} ${CURRENCY.toUpperCase()}`;

const order = (extra = {}) => ({
  orderNumber: 'RFX-TEST',
  items: [{ name: '64GB DDR4', sku: 'SKU-64', qty: 1, price: 585 }],
  subtotal: 585,
  shippingCost: 14,
  total: 489,
  ...extra,
});

// The label/value pairs of the totals block, in the order the customer reads them.
const totalsRows = (html) =>
  [...html.matchAll(/<span[^>]*>(Subtotal|Discount|Shipping|Tax|Total)<\/span>\s*<span[^>]*>([^<]*)<\/span>/g)]
    .map(([, label, value]) => [label, value.trim()]);

const sendFor = async (orderValues) => {
  sent.length = 0;
  await sendOrderConfirmationEmail({ email: 'buyer@example.com', firstName: 'Buyer', order: order(orderValues) });
  assert.equal(sent.length, 1, 'exactly one confirmation email is composed');
  return sent[0];
};

test('confirmation email shows the promotion discount between subtotal and shipping', async () => {
  const message = await sendFor({ discount: 110 });
  assert.deepEqual(totalsRows(message.html), [
    ['Subtotal', money(585)],
    ['Discount', `-${money(110)}`],
    ['Shipping', money(14)],
    ['Total', money(489)],
  ]);
});

test('confirmation email has no discount row when no code was used', async () => {
  for (const values of [{}, { discount: 0 }]) {
    const message = await sendFor(values);
    assert.deepEqual(totalsRows(message.html).map(([label]) => label), ['Subtotal', 'Shipping', 'Total']);
  }
});

test('confirmation email shows the tax between shipping and total', async () => {
  const message = await sendFor({ tax: 63.57, total: 662.57 });
  assert.deepEqual(totalsRows(message.html), [
    ['Subtotal', money(585)],
    ['Shipping', money(14)],
    ['Tax', money(63.57)],
    ['Total', money(662.57)],
  ]);
});

test('confirmation email has no tax row when no tax was charged', async () => {
  for (const values of [{}, { tax: 0 }]) {
    const message = await sendFor(values);
    assert.deepEqual(totalsRows(message.html).map(([label]) => label), ['Subtotal', 'Shipping', 'Total']);
  }
});

// The real paid-order path: fulfillment builds the email from the Stripe session.
// It used to pass only subtotal, shipping and total, so buyers never saw the
// discount or the tax that made up the difference.
test('the email sent for a paid Stripe session shows its discount and tax', async () => {
  const http = require('node:http');
  const express = require('express');
  const Cart = require('../src/models/Cart');
  const Order = require('../src/models/Order');
  const Product = require('../src/models/Product');
  const stripeRouter = require('../src/routes/stripe');
  const originals = [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate];
  try {
    Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-64gb', sku: 'DDR4-64', name: '64GB DDR4', images: [] });
    Order.findOne = async () => null;
    Order.create = async (values) => ({ ...values, _id: 'order-id', orderNumber: 'RFX-EMAIL', stockDecremented: true });
    Cart.findOneAndUpdate = async () => undefined;
    stripeRouter.setCheckoutDependenciesForTest({
      retrieveSession: async () => ({
        id: 'cs_email', payment_status: 'paid', metadata: { userId: 'guest', cartSessionId: 'session_0123456789' },
        line_items: { data: [{ price: { id: 'price_ddr4_64gb', unit_amount: 50000 }, quantity: 1 }] },
        amount_subtotal: 50000, amount_total: 55257,
        total_details: { amount_discount: 2500, amount_shipping: 1400, amount_tax: 6357 },
        shipping_cost: { shipping_rate: { display_name: 'Flat-Rate Shipping' } },
        customer_details: { email: 'buyer@example.com', name: 'Buyer Test',
          address: { line1: '1 Main St', city: 'Toronto', state: 'ON', postal_code: 'M5V 1E3', country: 'CA' } },
        payment_intent: 'pi_email',
      }),
      decrementStock: async () => true,
    });
    const app = express();
    app.use('/api/stripe', stripeRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    sent.length = 0;
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=cs_email`);
      assert.equal(response.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const email = sent.find((message) => message.subject.includes('RFX-EMAIL'));
    assert.ok(email, 'a confirmation email is composed for the paid order');
    assert.deepEqual(totalsRows(email.html), [
      ['Subtotal', money(500)],
      ['Discount', `-${money(25)}`],
      ['Shipping', money(14)],
      ['Tax', money(63.57)],
      ['Total', money(552.57)],
    ]);
  } finally {
    const stripeRouter = require('../src/routes/stripe');
    stripeRouter.setCheckoutDependenciesForTest();
    [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate] = originals;
  }
});

// US orders (2026-10-06): the shipping charge includes the prepaid import duties, and the receipt shows them on their own row.
const rowsOf = (html) =>
  [...html.matchAll(/<span[^>]*>(Subtotal|Discount|Shipping|US import duties and fees \(prepaid\)|Tax|Total)<\/span>\s*<span[^>]*>([^<]*)<\/span>/g)]
    .map(([, label, value]) => [label, value.trim()]);

test('confirmation email splits a US order\'s prepaid import duties out of the shipping charge', async () => {
  const message = await sendFor({ subtotal: 340, shippingCost: 116.2, importDuties: 99.5, total: 456.2 });
  assert.deepEqual(rowsOf(message.html), [
    ['Subtotal', money(340)],
    ['Shipping', money(16.7)],
    ['US import duties and fees (prepaid)', money(99.5)],
    ['Total', money(456.2)],
  ]);
});

test('confirmation email has no duties row for an order without prepaid duties', async () => {
  for (const values of [{}, { importDuties: 0 }, { importDuties: undefined }]) {
    const message = await sendFor(values);
    assert.deepEqual(rowsOf(message.html).map(([label]) => label), ['Subtotal', 'Shipping', 'Total']);
  }
});
