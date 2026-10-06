const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// No test may send a real email.
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email_test' }, error: null }) }; } } },
};
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_delivery_estimate_unit_test';

const { addBusinessDays, estimateDeliveryDate } = require('../src/utils/deliveryEstimate');

const day = (date) => date.toISOString().slice(0, 10);

test('business days skip weekends', () => {
  assert.equal(day(addBusinessDays(new Date('2026-10-02T15:00:00Z'), 1)), '2026-10-05'); // Friday -> Monday
  assert.equal(day(addBusinessDays(new Date('2026-10-03T15:00:00Z'), 1)), '2026-10-05'); // Saturday -> Monday
  assert.equal(day(addBusinessDays(new Date('2026-10-05T15:00:00Z'), 5)), '2026-10-12');
  assert.equal(day(addBusinessDays(new Date('2026-10-05T15:00:00Z'), 0)), '2026-10-05');
});

test('Canada is promised 3 business days to dispatch plus 6 in transit', () => {
  const monday = new Date('2026-10-05T15:00:00Z');
  assert.equal(day(estimateDeliveryDate({ placedAt: monday, country: 'CA' })), '2026-10-16');
  assert.equal(day(estimateDeliveryDate({ placedAt: monday })), '2026-10-16', 'Canada is the default');
});

test('abroad uses the transit days quoted at checkout plus a customs buffer, and a long guess when unknown', () => {
  const monday = new Date('2026-10-05T15:00:00Z');
  // 3 dispatch + 7 quoted + 3 buffer = 13 business days
  assert.equal(day(estimateDeliveryDate({ placedAt: monday, country: 'GB', transitDays: 7 })), '2026-10-22');
  assert.equal(day(estimateDeliveryDate({ placedAt: monday, country: 'gb', transitDays: '7' })), '2026-10-22');
  // 3 + 15 + 3 = 21 business days
  for (const unknown of [undefined, '', 0, 'soon']) {
    assert.equal(day(estimateDeliveryDate({ placedAt: monday, country: 'JP', transitDays: unknown })), '2026-11-03', String(unknown));
  }
});

// The survey Google emails goes out after this date, so a paid order must carry it.
test('a paid order records when Google should survey the buyer', async () => {
  const Cart = require('../src/models/Cart');
  const Order = require('../src/models/Order');
  const Product = require('../src/models/Product');
  const stripeRouter = require('../src/routes/stripe');
  const originals = [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate];
  const created = [];
  const session = (id, metadata, country) => ({
    id,
    payment_status: 'paid',
    metadata: { userId: 'guest', cartSessionId: 'session_0123456789', ...metadata },
    line_items: { data: [{ price: { id: 'price_ddr4_64gb', unit_amount: 50000 }, quantity: 1 }] },
    amount_subtotal: 50000,
    amount_total: 51400,
    total_details: { amount_discount: 0, amount_shipping: 1400, amount_tax: 0 },
    shipping_cost: { shipping_rate: { display_name: 'Shipping' } },
    customer_details: { email: 'buyer@example.com', name: 'Buyer Test', address: { line1: '1 Main St', city: 'Somewhere', postal_code: 'X1X 1X1', country } },
    payment_intent: `pi_${id}`,
  });
  try {
    Product.findOne = async () => ({ _id: 'product-id', slug: 'ddr4-64gb', sku: 'DDR4-64', name: '64GB DDR4', images: [] });
    Order.findOne = async () => null;
    Order.create = async (values) => { created.push(values); return { ...values, _id: 'order-id', orderNumber: `RFX-${created.length}`, stockDecremented: true }; };
    Cart.findOneAndUpdate = async () => undefined;
    const sessions = {
      cs_ca: session('cs_ca', {}, 'CA'),
      cs_gb: session('cs_gb', { shippingCountry: 'GB', canadaPostService: 'INT.TP', canadaPostTransitDays: '7' }, 'GB'),
    };
    stripeRouter.setCheckoutDependenciesForTest({ retrieveSession: async (id) => sessions[id], decrementStock: async () => true });
    const app = express();
    app.use('/api/stripe', stripeRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      for (const id of ['cs_ca', 'cs_gb']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/session-status?session_id=${id}`);
        assert.equal(response.status, 200, id);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(created.length, 2);
    const daysAway = (order) => Math.round((order.estimatedDelivery - Date.now()) / 86400000);
    assert.ok(created[0].estimatedDelivery instanceof Date);
    assert.ok(daysAway(created[0]) >= 10 && daysAway(created[0]) <= 13, `Canada: ${daysAway(created[0])} days`); // 9 business days
    assert.ok(daysAway(created[1]) >= 16 && daysAway(created[1]) <= 19, `GB: ${daysAway(created[1])} days`); // 13 business days
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    [Product.findOne, Order.findOne, Order.create, Cart.findOneAndUpdate] = originals;
  }
});
