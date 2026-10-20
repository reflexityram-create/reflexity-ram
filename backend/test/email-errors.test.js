// Every sender normalizes Resend failures to generic thrown errors and safe allowlisted diagnostics.
// Provider messages, arbitrary fields and recipient data must never appear in logs or thrown errors.
const test = require('node:test');
const assert = require('node:assert/strict');

// Swap the Resend SDK out before email.js loads: its send answers with whatever the test sets.
let answer = { data: { id: 'email_test' }, error: null };
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async () => answer, cancel: async () => answer }; } } } };
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_email_errors_unit_test';

const email = require('../src/utils/email');

const ORDER = { orderNumber: 'RFX-ERR', items: [{ name: '64GB DDR4', sku: 'SKU-64', qty: 1, price: 585 }], subtotal: 585, shippingCost: 14, total: 599, trackingNumber: 'CP123' };
const TO = { email: 'alex.buyer@gmail.com', firstName: 'Alex' };
const SENDERS = {
  verification: () => email.sendVerificationEmail({ ...TO, token: 'tok' }),
  passwordReset: () => email.sendPasswordResetEmail({ ...TO, token: 'tok' }),
  confirmation: () => email.sendOrderConfirmationEmail({ ...TO, order: ORDER }),
  shipping: () => email.sendShippingNotificationEmail({ ...TO, order: ORDER }),
  reviewRequest: () => email.sendReviewRequestEmail({ ...TO, order: ORDER, reviewUrl: 'https://reflexityram.com/review/x', unsubscribeUrl: 'https://reflexityram.com/unsub/x' }),
  trackingUpdate: () => email.sendTrackingUpdateEmail({ ...TO, order: ORDER, kind: 'outForDelivery' }),
  paymentNotice: () => email.sendPaymentNoticeEmail({ ...TO, order: ORDER, kind: 'bankDebitFailed' }),
};

async function failWith(error, sender) {
  answer = error && typeof error.then === 'function' ? error : { data: null, error };
  const logged = [];
  const real = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const thrown = await sender().then(() => null, (err) => err);
    return { thrown, logged };
  } finally { console.error = real; answer = { data: { id: 'email_test' }, error: null }; }
}

test('all seven senders log and throw a generic provider failure without recipient data', async () => {
  assert.equal(Object.keys(SENDERS).length, 7);
  for (const [name, sender] of Object.entries(SENDERS)) {
    const { thrown, logged } = await failWith({ name: 'validation_error', statusCode: 422, message: 'The recipient alex.buyer@gmail.com is on the suppression list' }, sender);
    assert.equal(thrown?.message, 'Email send failed: provider rejected the message', name);
    assert.deepEqual(logged, ['Resend send error detail: {"name":"validation_error","statusCode":422}'], name);
    assert.equal(`${thrown.message} ${logged.join(' ')}`.includes('alex.buyer'), false, `${name} leaks the address`);
  }
});

test('untrusted provider body, name, status and recipient data never enter diagnostics', async () => {
  const help = 'Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.';
  const helpFailure = await failWith({ name: 'validation_error', statusCode: 422, message: help, phone: '+1 416 555 0199' }, SENDERS.confirmation);
  assert.equal(helpFailure.thrown.message, 'Email send failed: provider rejected the message');
  assert.equal(helpFailure.logged.join(' ').includes('416'), false);

  const noMessage = await failWith({ statusCode: 500, to: 'Sam.O+tag@mail.example.co.uk' }, SENDERS.shipping);
  assert.equal(noMessage.thrown.message, 'Email send failed: provider rejected the message');
  assert.deepEqual(noMessage.logged, ['Resend send error detail: {"name":"unknown","statusCode":500}']);

  const long = await failWith({ name: 'x'.repeat(100), message: `${'y'.repeat(150)} bounced for sam@gmail.com ${'z'.repeat(300)}` }, SENDERS.paymentNotice);
  assert.equal(long.thrown.message, 'Email send failed: provider rejected the message');
  assert.deepEqual(long.logged, ['Resend send error detail: {"name":"unknown"}']);
});

test('a send that works is returned untouched, and a failure of unexpected shape still throws', async () => {
  answer = { data: { id: 'email_ok' }, error: null };
  assert.deepEqual(await SENDERS.passwordReset(), { id: 'email_ok' });
  const { thrown } = await failWith('plain string error', SENDERS.verification);
  assert.equal(thrown.message, 'Email send failed: provider rejected the message');
});

test('a rejected provider promise and a malformed circular error are still redacted and normalized', async () => {
  const rejected = await failWith(Promise.reject(new Error('delivery failed for alex.buyer@gmail.com')), SENDERS.shipping);
  assert.equal(rejected.thrown.message, 'Email send failed: provider rejected the message');
  assert.equal(rejected.logged.join(' ').includes('alex.buyer'), false);

  const circular = {};
  circular.self = circular;
  const malformed = await failWith(circular, SENDERS.shipping);
  assert.equal(malformed.thrown.message, 'Email send failed: provider rejected the message');
  assert.equal(malformed.logged.join(' ').includes('[object Object]'), false);
});

test('scheduled-email cancellation uses the same safe normalization for resolved, rejected and circular failures', async () => {
  const real = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    answer = { data: null, error: { name: 'validation_error', statusCode: 422, message: 'cancel alex.buyer@gmail.com' } };
    await assert.rejects(email.cancelScheduledEmail('email_1'), { message: 'Email cancel failed: provider rejected the message' });
    answer = Promise.reject(new Error('cancel failed for alex.buyer@gmail.com'));
    await assert.rejects(email.cancelScheduledEmail('email_2'), { message: 'Email cancel failed: provider rejected the message' });
    const circular = {};
    circular.self = circular;
    answer = Promise.reject(circular);
    await assert.rejects(email.cancelScheduledEmail('email_3'), { message: 'Email cancel failed: provider rejected the message' });
    assert.equal(logged.length, 3);
    assert.equal(logged.join(' ').includes('alex.buyer'), false);
    assert.equal(logged.join(' ').includes('[object Object]'), false);
    assert.ok(logged.every((line) => line.startsWith('Resend cancel error detail:')));
  } finally {
    console.error = real;
    answer = { data: { id: 'email_test' }, error: null };
  }
});
