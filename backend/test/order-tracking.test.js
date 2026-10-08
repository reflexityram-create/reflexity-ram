const test = require('node:test');
const assert = require('node:assert/strict');

// Swap the Resend SDK out before email.js loads so no test can send a real email.
const sent = [];
const sendOptions = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = { send: async (message, options) => { sent.push(message); sendOptions.push(options); return { data: { id: 'email_test' }, error: null }; } };
      }
    },
  },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';

const { trackingUrlFor, CANADA_POST_TRACKING_PAGE } = require('../src/utils/tracking');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { sendShippingNotificationEmail } = require('../src/utils/email');

const hrefs = (html) => [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, text]) => [text.trim(), href]);

test('tracking links go to Canada Post unless the order stores its own https link', () => {
  assert.equal(trackingUrlFor({ trackingNumber: '7023 2100 3941 4604' }), `${CANADA_POST_TRACKING_PAGE}7023210039414604`);
  assert.equal(trackingUrlFor({ trackingNumber: 'LM123456789CA', trackingUrl: 'https://carrier.example/t/1' }), 'https://carrier.example/t/1');
  assert.equal(trackingUrlFor({ trackingNumber: 'LM123456789CA', trackingUrl: 'javascript:alert(1)' }), `${CANADA_POST_TRACKING_PAGE}LM123456789CA`);
  assert.equal(trackingUrlFor({}), undefined);
});

// The order page showed the number as plain text and the shipping email's
// "Track Order" button led back to that page, so nobody could follow the parcel.
test('the customer order API hands the page a Canada Post tracking link', () => {
  const order = customerOrderResponse({ orderNumber: 'RFX-T', status: 'shipped', trackingNumber: 'LM123456789CA', items: [] });
  assert.equal(order.trackingUrl, `${CANADA_POST_TRACKING_PAGE}LM123456789CA`);
  assert.equal(customerOrderResponse({ orderNumber: 'RFX-N', status: 'processing', items: [] }).trackingUrl, undefined);
});

test('the shipping email links the tracking number and its main button to Canada Post', async () => {
  sent.length = 0;
  await sendShippingNotificationEmail({
    email: 'buyer@example.com', firstName: 'Buyer',
    order: { _id: '6ac2d644ce61cd9a8fb13b51', orderNumber: 'RFX-SHIP', trackingNumber: 'LM123456789CA', guestEmail: 'buyer@example.com' },
  });
  const links = hrefs(sent[0].html);
  const canadaPost = `${CANADA_POST_TRACKING_PAGE}LM123456789CA`;
  assert.deepEqual(links.find(([text]) => text === 'LM123456789CA'), ['LM123456789CA', canadaPost]);
  assert.deepEqual(links.find(([text]) => text === 'Track your package'), ['Track your package', canadaPost]);
  const orderLink = links.find(([text]) => text === 'View your order');
  assert.ok(orderLink && orderLink[1].startsWith('https://reflexityram.com/order/RFX-SHIP'), 'the email still links to the order page');
});

test('a shipping email without a tracking number offers the order page only', async () => {
  sent.length = 0;
  await sendShippingNotificationEmail({
    email: 'buyer@example.com', firstName: 'Buyer',
    order: { _id: '6ac2d644ce61cd9a8fb13b52', orderNumber: 'RFX-NOTRACK', guestEmail: 'buyer@example.com' },
  });
  const links = hrefs(sent[0].html);
  assert.deepEqual(links.map(([text]) => text), ['View your order']);
  assert.ok(!sent[0].html.includes('canadapost'), 'no Canada Post link without a tracking number');
});

 test('shipping retry keys reach Resend instead of being discarded by the email wrapper', async () => {
  await sendShippingNotificationEmail({ email: 'buyer@example.com', firstName: 'Buyer',
    order: { _id: '6ac2d644ce61cd9a8fb13b53', orderNumber: 'RFX-RETRY', trackingNumber: 'CP123' },
    idempotencyKey: 'shipment/6ac2d644ce61cd9a8fb13b53' });
  assert.deepEqual(sendOptions.at(-1), { idempotencyKey: 'shipment/6ac2d644ce61cd9a8fb13b53' });
});
