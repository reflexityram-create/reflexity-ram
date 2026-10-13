// An order the owner ships WITHOUT a tracking number (the Terms let the shop choose the service) must say so plainly in the
// buyer's shipping email and on the buyer's order page, never show an invented number, and let a reply reach the shop.
const test = require('node:test');
const assert = require('node:assert/strict');

const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { sent.push(message); return { data: { id: 'email_test' }, error: null }; } }; } } },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.NODE_ENV ||= 'test';

const { sendShippingNotificationEmail } = require('../src/utils/email');
const { customerOrderResponse } = require('../src/utils/customerOrders');
const { notifyShipment } = require('../src/utils/shippingNotifications');

const baseOrder = (extra = {}) => ({ _id: '64b7f0c2a1b2c3d4e5f60719', orderNumber: 'RFX-SHIP-EMAIL', items: [], ...extra });
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('a tracked shipping email shows the number and its link, and does not claim the parcel is untracked', async () => {
  sent.length = 0;
  await sendShippingNotificationEmail({ email: 'buyer@example.com', firstName: 'Sam', order: baseOrder({ trackingNumber: 'GD546149174CA' }) });
  const message = sent[0];
  assert.equal(message.to, 'buyer@example.com');
  assert.match(message.html, /Canada Post tracking number/);
  assert.match(message.html, /GD546149174CA/);
  assert.match(message.html, /Track your package/);
  assert.doesNotMatch(textOf(message.html), /without a tracking number/);
  assert.equal(message.replyTo, undefined, 'the tracked email is unchanged');
});

test('an untracked shipping email says it plainly, shows no number, links to the order and can be answered', async () => {
  sent.length = 0;
  await sendShippingNotificationEmail({ email: 'buyer@example.com', firstName: 'Sam', order: baseOrder() });
  const message = sent[0];
  const text = textOf(message.html);
  assert.match(text, /Your order is on its way/);
  assert.match(text, /This parcel was sent without a tracking number, so there is nothing to follow online/);
  assert.match(text, /Delivery usually takes 3–6 business days after dispatch/);
  assert.match(text, /reply to this email and we will look into it/);
  assert.doesNotMatch(text, /Canada Post tracking number/);
  assert.doesNotMatch(message.html, /canadapost-postescanada\.ca\/track/, 'no tracking link is invented');
  assert.match(message.html, /View your order/);
  assert.doesNotMatch(message.html, /Track your package/);
  assert.equal(message.replyTo, 'reflexityram@gmail.com', 'a reply reaches the shop');
  assert.equal(message.subject, 'Your order has shipped — RFX-SHIP-EMAIL');
});

test('a blank or whitespace tracking value counts as no number (it never prints an empty "tracking number")', async () => {
  for (const trackingNumber of ['', undefined, null]) {
    sent.length = 0;
    await sendShippingNotificationEmail({ email: 'buyer@example.com', firstName: 'Sam', order: baseOrder({ trackingNumber }) });
    assert.match(textOf(sent[0].html), /without a tracking number/, String(trackingNumber));
    assert.doesNotMatch(sent[0].html, /Canada Post tracking number/);
  }
});

test('the buyer-facing order says untracked only for an order shipped on purpose without tracking, and leaks no admin field', () => {
  const untracked = customerOrderResponse({ ...baseOrder({ status: 'shipped', untracked: true, archived: true, adminNotes: 'secret' }), shippingAddress: { firstName: 'A', lastName: 'B' } });
  assert.equal(untracked.untracked, true);
  assert.equal(untracked.trackingNumber, undefined);
  assert.equal(untracked.trackingUrl, undefined);
  assert.equal('archived' in untracked, false);
  assert.equal('adminNotes' in untracked, false);

  const tracked = customerOrderResponse({ ...baseOrder({ status: 'shipped', trackingNumber: 'CP1' }), shippingAddress: { firstName: 'A', lastName: 'B' } });
  assert.equal('untracked' in tracked, false);
  assert.equal(tracked.trackingNumber, 'CP1');

  const never = customerOrderResponse({ ...baseOrder({ status: 'processing', untracked: false }), shippingAddress: { firstName: 'A', lastName: 'B' } });
  assert.equal('untracked' in never, false);
});

test('the claim for the shipping email asks for "no number" outright when the order has none, and for the exact number when it has one', async () => {
  const filters = [];
  const Order = { findOneAndUpdate: async (filter) => { filters.push(filter); return null; }, updateOne: async () => ({}) };
  await notifyShipment({ _id: 'o1', status: 'shipped' }, { Order, sendEmail: async () => {} });
  assert.equal(filters[0].trackingNumber, null, 'null matches an order whose number field is missing, and nothing else');
  await notifyShipment({ _id: 'o1', status: 'shipped', trackingNumber: 'CP1' }, { Order, sendEmail: async () => {} });
  assert.equal(filters[1].trackingNumber, 'CP1');
  await notifyShipment({ _id: 'o1', status: 'shipped', trackingNumber: '' }, { Order, sendEmail: async () => {} });
  assert.equal(filters[2].trackingNumber, '', 'a blank legacy number is matched as blank, not widened to null');
});
