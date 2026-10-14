// A buyer who answers any email from the shop must reach the shop. The mail is SENT from noreply@reflexityram.com, and that domain has NO
// mail server (no MX record, checked 2026-10-13), so a reply to the sender address bounces and nobody ever reads it: the owner asked
// "what did she say in the email?" and the honest answer was that nothing could have arrived. Every email to a customer therefore
// carries Reply-To: the shop's contact mailbox. (The owner's own alerts and the wholesale lead mail are not customer emails.)
const test = require('node:test');
const assert = require('node:assert/strict');

const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { sent.push(message); return { data: { id: 'email_test' }, error: null }; }, cancel: async () => ({ data: {}, error: null }) }; } } },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.NODE_ENV ||= 'test';

const email = require('../src/utils/email');
const { SUPPORT_EMAIL } = require('../src/utils/contact');

const order = (extra = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60719', orderNumber: 'RFX-REPLY-TEST', total: 163, subtotal: 149, shippingCost: 14,
  items: [{ name: 'SK hynix 16GB DDR4', sku: 'SKU-16', qty: 1, price: 149 }],
  etransfer: { recipientEmail: 'reflexityram@gmail.com', amountDue: 163, expiresAt: new Date('2026-10-16T20:00:00Z') },
  ...extra,
});
const to = { email: 'buyer@example.com', firstName: 'Sam' };

const EVERY_CUSTOMER_EMAIL = [
  ['verification', () => email.sendVerificationEmail({ ...to, token: 'tok' })],
  ['password reset', () => email.sendPasswordResetEmail({ ...to, token: 'tok' })],
  ['order confirmation', () => email.sendOrderConfirmationEmail({ ...to, order: order() })],
  ['shipped, with a tracking number', () => email.sendShippingNotificationEmail({ ...to, order: order({ trackingNumber: 'GD546149174CA' }) })],
  ['shipped, without tracking', () => email.sendShippingNotificationEmail({ ...to, order: order() })],
  ['review request', () => email.sendReviewRequestEmail({ ...to, order: order(), reviewUrl: 'https://reflexityram.com/review?t=1', unsubscribeUrl: 'https://reflexityram.com/u?t=1' })],
  ...['outForDelivery', 'pickup', 'delivered'].map((kind) => [`tracking update: ${kind}`, () => email.sendTrackingUpdateEmail({ ...to, order: order({ trackingNumber: 'GD546149174CA' }), kind })]),
  ...Object.keys(email.PAYMENT_NOTICES).map((kind) => [`payment notice: ${kind}`, () => email.sendPaymentNoticeEmail({ ...to, order: order(), kind })]),
];

test('the contact mailbox is the one in the footer', () => {
  assert.equal(SUPPORT_EMAIL, 'reflexityram@gmail.com');
});

for (const [name, send] of EVERY_CUSTOMER_EMAIL) {
  test(`${name}: a reply reaches the shop, and the sender stays the no-reply address`, async () => {
    sent.length = 0;
    await send();
    assert.equal(sent.length, 1, 'exactly one email');
    assert.equal(sent[0].to, 'buyer@example.com');
    assert.equal(sent[0].replyTo, 'reflexityram@gmail.com');
    assert.match(String(sent[0].from), /^Reflexity RAM <.+@.+>$|<onboarding@resend\.dev>/, 'the From address is unchanged');
  });
}

test('every kind of e-Transfer, bank debit and tracking email in the module is covered by this test', () => {
  const covered = EVERY_CUSTOMER_EMAIL.map(([name]) => name).join('|');
  for (const kind of Object.keys(email.PAYMENT_NOTICES)) assert.ok(covered.includes(`payment notice: ${kind}`), kind);
  const source = require('node:fs').readFileSync(require.resolve('../src/utils/email.js'), 'utf8');
  const sends = (source.match(/emails\.send\(/g) || []).length;
  const withReply = (source.match(/replyTo: SUPPORT_EMAIL/g) || []).length;
  assert.equal(sends, withReply, `a new email was added without a Reply-To (${sends} sends, ${withReply} reply addresses)`);
});
