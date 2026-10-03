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
  [...html.matchAll(/<span[^>]*>(Subtotal|Discount|Shipping|Total)<\/span>\s*<span[^>]*>([^<]*)<\/span>/g)]
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
