const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_payment_methods_unit_test';

const Cart = require('../src/models/Cart');
const Product = require('../src/models/Product');
const stripeRouter = require('../src/routes/stripe');
const {
  discountCents, paymentMethodSettings, publicPaymentMethods, bankDebitEnabled, etransferEnabled, orderPaymentLabel,
} = require('../src/utils/paymentMethods');
const { resolveCanadaDelivery, DeliveryChoiceError } = require('../src/utils/canadaDelivery');
const { bankDebitCouponId } = require('../src/utils/stripeSync');
const { removeNoteLines } = require('../src/utils/orderNotes');
const { shippingChoiceNote } = require('../src/utils/shippingChoice');

// ── discount arithmetic ────────────────────────────────────────────────────────
test('the discount is a percent of the goods in whole cents, rounded half up', () => {
  assert.equal(discountCents(61800, 1), 618, 'CAD 618.00 of goods at 1%');
  assert.equal(discountCents(61800, 2), 1236, 'and at 2%');
  assert.equal(discountCents(54000, 2), 1080);
  assert.equal(discountCents(999, 1), 10, '9.99 cents rounds up');
  assert.equal(discountCents(50, 1), 1, '0.5 cent rounds up');
  assert.equal(discountCents(49, 1), 0);
  assert.equal(discountCents(10000, 1.5), 150, 'a fractional percent');
  assert.equal(discountCents(10000, 0), 0);
  for (const bad of [NaN, undefined, null, -5, 'x']) {
    assert.equal(discountCents(bad, 2), 0, `goods ${bad}`);
    assert.equal(discountCents(10000, bad), 0, `pct ${bad}`);
  }
});

test('the break-even numbers behind the defaults: both discounts leave the owner ahead of a card sale on a CAD 618 order', () => {
  const goods = 61800, shipping = 2500;
  const cardFee = Math.round((goods + shipping) * 0.029) + 30;                         // 2.9% + 30 cents
  const bankFee = Math.min(500, Math.round((goods + shipping) * 0.01) + 40) + 100;      // 1% + 40c, 5.00 cap, +1.00 verification
  const bankNet = goods + shipping - discountCents(goods, 1) - bankFee;
  const etransferNet = goods + shipping - discountCents(goods, 2);
  const cardNet = goods + shipping - cardFee;
  assert.ok(bankNet > cardNet, `bank debit keeps ${(bankNet - cardNet) / 100} more than a card sale`);
  assert.ok(etransferNet > cardNet, `e-Transfer keeps ${(etransferNet - cardNet) / 100} more than a card sale`);
});

// ── settings come from the environment, and nothing is on by default ─────────────
test('with no settings only the card is offered', () => {
  const s = paymentMethodSettings({});
  assert.equal(s.bank_debit.enabled, false);
  assert.equal(s.etransfer.enabled, false);
  assert.deepEqual(publicPaymentMethods({}).map((m) => m.id), ['card']);
  assert.equal(bankDebitEnabled({}), false);
  assert.equal(etransferEnabled({}), false);
});

test('bank debit turns on with its flag; its percent defaults to 1 and a silly value falls back', () => {
  assert.equal(bankDebitEnabled({ BANK_DEBIT_ENABLED: 'true' }), true);
  assert.equal(bankDebitEnabled({ BANK_DEBIT_ENABLED: 'yes' }), false, 'only the word true counts');
  assert.equal(paymentMethodSettings({ BANK_DEBIT_ENABLED: 'true' }).bank_debit.discountPct, 1);
  assert.equal(paymentMethodSettings({ BANK_DEBIT_DISCOUNT_PCT: '1.5' }).bank_debit.discountPct, 1.5);
  for (const silly of ['50', '-1', 'abc', '99']) assert.equal(paymentMethodSettings({ BANK_DEBIT_DISCOUNT_PCT: silly }).bank_debit.discountPct, 1, silly);
});

test('e-Transfer needs BOTH its flag and a valid recipient address: the shop never guesses where money goes', () => {
  const on = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: ' Pay@Example.com ' };
  assert.equal(etransferEnabled(on), true);
  assert.equal(paymentMethodSettings(on).etransfer.recipientEmail, 'pay@example.com');
  assert.equal(etransferEnabled({ ETRANSFER_ENABLED: 'true' }), false, 'no address');
  assert.equal(etransferEnabled({ ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'not-an-email' }), false);
  assert.equal(etransferEnabled({ ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' }), false, 'address alone is not enough');
  assert.equal(paymentMethodSettings(on).etransfer.discountPct, 2);
  assert.equal(paymentMethodSettings(on).etransfer.holdHours, 48);
  assert.equal(paymentMethodSettings({ ...on, ETRANSFER_HOLD_HOURS: '72' }).etransfer.holdHours, 72);
  assert.equal(paymentMethodSettings({ ...on, ETRANSFER_HOLD_HOURS: '2' }).etransfer.holdHours, 48, 'under six hours is refused');
  assert.equal(paymentMethodSettings({ ...on, ETRANSFER_HOLD_HOURS: '9999' }).etransfer.holdHours, 48);
});

test('one e-Transfer order is capped in items and in dollars, with sane defaults and bounds (review F2/F11)', () => {
  const on = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' };
  const settings = (extra = {}) => paymentMethodSettings({ ...on, ...extra }).etransfer;
  assert.equal(settings().maxUnits, 16);
  assert.equal(settings().maxTotal, 3000);
  assert.equal(settings({ ETRANSFER_MAX_UNITS: '8' }).maxUnits, 8);
  assert.equal(settings({ ETRANSFER_MAX_TOTAL_CAD: '1500.50' }).maxTotal, 1500.5);
  for (const silly of ['0', '-3', '201', 'many', '']) assert.equal(settings({ ETRANSFER_MAX_UNITS: silly }).maxUnits, 16, `units ${JSON.stringify(silly)}`);
  for (const silly of ['0', '49', '20001', 'lots', '-5']) assert.equal(settings({ ETRANSFER_MAX_TOTAL_CAD: silly }).maxTotal, 3000, `total ${JSON.stringify(silly)}`);
  const listed = publicPaymentMethods(on).find((m) => m.id === 'etransfer');
  assert.equal(listed.maxUnits, 16, 'the checkout page can tell a buyer an order is too big before they fill in the form');
  assert.equal(listed.maxTotal, 3000);
});

test('the public list names the methods and discounts but never the e-Transfer address', () => {
  const env = { BANK_DEBIT_ENABLED: 'true', ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' };
  const list = publicPaymentMethods(env);
  assert.deepEqual(list.map((m) => [m.id, m.discountPct]), [['card', 0], ['bank_debit', 1], ['etransfer', 2]]);
  assert.equal(list.find((m) => m.id === 'etransfer').holdHours, 48, 'the pages quote the real hold');
  assert.ok(!JSON.stringify(list).includes('pay@example.com'));
  assert.equal(orderPaymentLabel('etransfer'), 'Interac e-Transfer');
  assert.equal(orderPaymentLabel('bank_debit'), 'Bank debit');
  assert.equal(orderPaymentLabel('stripe'), 'Card');
  assert.equal(orderPaymentLabel(undefined), 'Card');
});

// ── Canada delivery is one function for every payment method ─────────────────────
test('delivery choices: the flat rate, Faster, signature, and what is refused', () => {
  const lines = (qty) => [{ product: { _id: 'p', price: 100 }, qty }];
  assert.deepEqual(
    { ...resolveCanadaDelivery(lines(1)), label: undefined },
    { amount: 14, label: undefined, faster: false, signature: false, choice: false, transitDays: null },
  );
  assert.equal(resolveCanadaDelivery(lines(3)).amount, 25);
  assert.equal(resolveCanadaDelivery(lines(2), { faster: true }).amount, 26);
  assert.equal(resolveCanadaDelivery(lines(2), { signature: true }).amount, 16);
  const both = resolveCanadaDelivery(lines(2), { faster: true, signature: true });
  assert.equal(both.amount, 28);
  assert.match(both.label, /Faster shipping.*\+ signature on delivery$/);
  assert.equal(both.transitDays, 3);
  assert.throws(() => resolveCanadaDelivery(lines(7), { faster: true }), (e) => e instanceof DeliveryChoiceError && /not offered on an order this size/.test(e.message));
  assert.throws(() => resolveCanadaDelivery(lines(1), { serviceCode: 'DOM.EP' }), DeliveryChoiceError);
  assert.throws(() => resolveCanadaDelivery(lines(1), { postalCode: 'M5H2N2' }), DeliveryChoiceError);
  assert.equal(resolveCanadaDelivery(lines(2), { faster: 'true' }).faster, false, 'only a real boolean true counts');
});

test('shipping notes and order-note lines are shared helpers', () => {
  assert.equal(shippingChoiceNote({}, 'x'), null);
  assert.match(shippingChoiceNote({ canadaPostService: 'DOM.XP', signature: 'yes' }, 'Faster'), /buy Xpresspost and add the Signature option/);
  assert.equal(removeNoteLines('AWAITING e-Transfer: x\nSHIPPING: y', 'AWAITING e-Transfer'), 'SHIPPING: y');
  assert.equal(removeNoteLines('AWAITING e-Transfer: x', 'AWAITING e-Transfer'), null);
  assert.equal(removeNoteLines(undefined, 'AWAITING'), null);
  assert.equal(bankDebitCouponId(1), 'rfx-bank-debit-1pct');
  assert.equal(bankDebitCouponId(2.5), 'rfx-bank-debit-2p5pct');
});

// ── the bank-debit Stripe session ────────────────────────────────────────────────
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/stripe', stripeRouter);
  return a;
};
const post = async (body) => {
  const server = http.createServer(app());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/create-checkout-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': 'session_0123456789' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
async function checkout(body, env = {}) {
  const originals = { cart: Cart.findOne, find: Product.find };
  const previous = {};
  for (const [k, v] of Object.entries(env)) { previous[k] = process.env[k]; process.env[k] = v; }
  const doc = { _id: 'p1', slug: 'ddr4-16gb', name: '16GB DDR4', price: 170, stock: 'in', stockQuantity: 50, isActive: true, line: 'Server' };
  Cart.findOne = () => Promise.resolve({ items: [{ slug: 'ddr4-16gb', qty: 2, product: doc }] });
  Product.find = () => ({ then: (resolve, reject) => Promise.resolve([doc]).then(resolve, reject), lean: async () => [doc], select: () => Promise.resolve([doc]) });
  let payload; let couponAsked = [];
  stripeRouter.setCheckoutDependenciesForTest({
    ensurePrice: async () => 'price_ddr4_16gb',
    ensureCoupon: async (pct) => { couponAsked.push(pct); return `coupon_${pct}`; },
    createSession: async (sent) => { payload = sent; return { id: 'cs_bd', url: 'https://stripe.test/bd' }; },
  });
  try {
    return { response: await post(body), payload, couponAsked };
  } finally {
    stripeRouter.setCheckoutDependenciesForTest();
    Cart.findOne = originals.cart; Product.find = originals.find;
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const ON = { BANK_DEBIT_ENABLED: 'true' };

test('a bank-debit session offers only pre-authorized debit, with the mandate Stripe needs and the percent coupon', async () => {
  const { response, payload, couponAsked } = await checkout({ paymentMethod: 'bank_debit' }, ON);
  assert.equal(response.status, 200);
  assert.deepEqual(payload.payment_method_types, ['acss_debit']);
  assert.deepEqual(payload.payment_method_options.acss_debit.mandate_options, { payment_schedule: 'sporadic', transaction_type: 'personal' });
  assert.equal(payload.payment_method_options.acss_debit.verification_method, 'automatic');
  assert.deepEqual(payload.discounts, [{ coupon: 'coupon_1' }]);
  assert.deepEqual(couponAsked, [1]);
  // Proved against the live Stripe API: "You may only specify one of these parameters: allow_promotion_codes, discounts."
  // The key must be ABSENT, not false.
  assert.equal('allow_promotion_codes' in payload, false, 'Stripe refuses allow_promotion_codes of any value next to discounts');
  assert.equal(payload.metadata.paymentMethod, 'bank_debit');
  assert.equal(payload.metadata.paymentDiscountPct, '1');
  assert.equal(payload.mode, 'payment');
  assert.deepEqual(payload.shipping_address_collection, { allowed_countries: ['CA'] });
  assert.equal(payload.shipping_options[0].shipping_rate_data.fixed_amount.currency, 'cad');
  assert.equal('automatic_tax' in payload, false, 'the shop charges no tax, so Stripe\'s page must not show a "Tax: enter address to calculate" line');
});

test('automatic tax is OFF on every card and bank-debit session unless the owner switches it on, and then it is on for both', async () => {
  for (const body of [{}, { paymentMethod: 'bank_debit' }]) {
    const off = await checkout(body, ON);
    assert.equal(off.response.status, 200);
    assert.equal('automatic_tax' in off.payload, false, `default: ${JSON.stringify(body)}`);
    for (const silly of ['false', '', '1', 'yes', 'TRUE ']) {
      const still = await checkout(body, { ...ON, STRIPE_AUTOMATIC_TAX: silly });
      assert.equal('automatic_tax' in still.payload, silly.trim().toLowerCase() === 'true', `STRIPE_AUTOMATIC_TAX=${JSON.stringify(silly)}`);
    }
    const on = await checkout(body, { ...ON, STRIPE_AUTOMATIC_TAX: 'true' });
    assert.deepEqual(on.payload.automatic_tax, { enabled: true }, `switched on: ${JSON.stringify(body)}`);
  }
});

test('bank debit keeps the buyer\'s delivery choices, and the percent follows the setting', async () => {
  const { payload, couponAsked } = await checkout({ paymentMethod: 'bank_debit', shipping: { country: 'CA', faster: true, signature: true } }, { ...ON, BANK_DEBIT_DISCOUNT_PCT: '1.5' });
  const rate = payload.shipping_options[0].shipping_rate_data;
  assert.equal(rate.fixed_amount.amount, 2800);
  assert.equal(rate.metadata.canadaPostService, 'DOM.XP');
  assert.deepEqual(couponAsked, [1.5]);
  assert.equal(payload.metadata.canadaPostService, 'DOM.XP');
  assert.equal(payload.metadata.signature, 'yes');
});

test('at 0 percent there is no coupon and no coupon lookup', async () => {
  const { payload, couponAsked } = await checkout({ paymentMethod: 'bank_debit' }, { ...ON, BANK_DEBIT_DISCOUNT_PCT: '0' });
  assert.equal('discounts' in payload, false);
  assert.equal(payload.allow_promotion_codes, true, 'with no coupon on the session a promotion code is fine');
  assert.deepEqual(couponAsked, []);
  assert.deepEqual(payload.payment_method_types, ['acss_debit']);
});

test('bank debit is refused when switched off, outside Canada, or for an unknown method', async () => {
  const off = await checkout({ paymentMethod: 'bank_debit' });
  assert.equal(off.response.status, 400);
  assert.match(off.response.body.error, /not available right now/);
  assert.equal(off.payload, undefined, 'no Stripe session was created');
  const abroad = await checkout({ paymentMethod: 'bank_debit', shipping: { country: 'GB', serviceCode: 'INT.TP' } }, ON);
  assert.equal(abroad.response.status, 400);
  assert.match(abroad.response.body.error, /only available for orders shipped within Canada/);
  const us = await checkout({ paymentMethod: 'bank_debit', shipping: { country: 'US', serviceCode: 'USA.TP' } }, ON);
  assert.equal(us.response.status, 400);
  const unknown = await checkout({ paymentMethod: 'bitcoin' }, ON);
  assert.equal(unknown.response.status, 400);
  assert.match(unknown.response.body.error, /Unknown payment method/);
  const injected = await checkout({ paymentMethod: { $ne: 'card' } }, ON);
  assert.equal(injected.response.status, 400);
});

test('a card session is exactly what it was: no payment_method_types, promotion codes on, no coupon', async () => {
  for (const body of [{}, { paymentMethod: 'card' }]) {
    const { response, payload, couponAsked } = await checkout(body, ON);
    assert.equal(response.status, 200);
    assert.equal('payment_method_types' in payload, false, 'the dashboard\'s list (card, wallets) still decides');
    assert.equal('payment_method_options' in payload, false);
    assert.equal('discounts' in payload, false);
    assert.equal(payload.allow_promotion_codes, true);
    assert.equal(payload.metadata.paymentMethod, undefined);
    assert.deepEqual(couponAsked, []);
  }
});

// ── the 15-minute cron also sweeps unpaid e-Transfer orders, without changing its own answer ─────────────────────
test('a failing e-Transfer sweep never stops the tracking sync and never changes what the cron is told', async () => {
  const Order = require('../src/models/Order');
  const trackingRouter = require('../src/routes/tracking');
  const originalFind = Order.find;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  const saved = { key: process.env.CANADA_POST_API_KEY, secret: process.env.CANADA_POST_API_SECRET, token: process.env.TRACKING_SYNC_TOKEN };
  process.env.CANADA_POST_API_KEY = 'test-key';
  process.env.CANADA_POST_API_SECRET = 'test-secret';
  process.env.TRACKING_SYNC_TOKEN = 'sync-secret';
  // The sync's query chain ends in limit(); the sweep's ends in populate(): this stub breaks only the sweep.
  Order.find = () => ({ sort() { return this; }, populate() { return this; }, limit: async () => [] });
  const app = express();
  app.use('/api/tracking', trackingRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/tracking/sync`, { method: 'POST', headers: { Authorization: 'Bearer sync-secret' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { checked: 0, delivered: 0, emails: 0, errors: 0 }, 'exactly the tracking summary, nothing else in it');
    assert.ok(logged.some((line) => /e-Transfer sweep error/.test(line)), 'the sweep failure is logged');
  } finally {
    console.error = originalError;
    Order.find = originalFind;
    for (const [name, value] of [['CANADA_POST_API_KEY', saved.key], ['CANADA_POST_API_SECRET', saved.secret], ['TRACKING_SYNC_TOKEN', saved.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

// The limiter that stops one connection from reserving stock again and again lives only in server.js, where the router tests
// cannot see it: deleting or reordering its line would pass every other test (review F12).
test('the e-Transfer order limiter is mounted, and before the router it protects', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  const limiter = source.indexOf("app.use('/api/payments/etransfer', etransferLimiter);");
  const router = source.indexOf("app.use('/api/payments', createPaymentsRouter());");
  assert.ok(limiter > 0, 'the limiter is mounted on the e-Transfer order route');
  assert.ok(router > 0);
  assert.ok(limiter < router, 'and it runs before the router does');
  assert.match(source, /const etransferLimiter = rateLimit\(\{[\s\S]*?max: 8,/, 'eight orders an hour per connection');
});

test('the sweep runs before the carrier check, so an unconfigured Canada Post never stops it', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/routes/tracking.js'), 'utf8');
  assert.ok(source.indexOf('sweepEtransferOrders()') < source.indexOf('if (!isConfigured())'));
});
