import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BANK_DEBIT, CARD, ETRANSFER, POSTAL_CODE, discountFor, normalizePostalCode, offeredMethods, savingsLabel, torontoDeadline, validateEtransferForm,
} from '../src/lib/paymentMethods.js';
import { METHOD_NAMES, paymentState, showPaymentLabel, stripePaymentUrl } from '../src/lib/orderPayment.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// ── arithmetic: the same numbers the server (backend/test/payment-methods.test.js) uses ──
test('the preview discount is whole cents, half up, on the goods only: CAD 618 of goods', () => {
  assert.equal(discountFor(618, 1), 6.18);
  assert.equal(discountFor(618, 2), 12.36);
  assert.equal(discountFor(270, 2), 5.4);
  assert.equal(discountFor(9.99, 1), 0.1);
  assert.equal(discountFor(0.5, 1), 0.01);
  assert.equal(discountFor(100, 1.5), 1.5);
  for (const bad of [NaN, undefined, null, -5, 'x']) assert.equal(discountFor(bad, 2), 0);
  assert.equal(discountFor(100, bad(0)), 0);
  function bad(v) { return v; }
});

test('only the methods the server offers appear, card first and always, in a fixed order', () => {
  assert.deepEqual(offeredMethods([]).map((m) => m.id), [CARD]);
  assert.deepEqual(offeredMethods(undefined).map((m) => m.id), [CARD]);
  assert.deepEqual(offeredMethods('nonsense').map((m) => m.id), [CARD]);
  const all = offeredMethods([{ id: ETRANSFER, discountPct: 2 }, { id: BANK_DEBIT, discountPct: 1 }, { id: 'bitcoin', discountPct: 50 }, { id: CARD, discountPct: 0 }]);
  assert.deepEqual(all.map((m) => [m.id, m.discountPct]), [[CARD, 0], [BANK_DEBIT, 1], [ETRANSFER, 2]]);
  assert.ok(all.every((m) => m.title && m.how && m.cta));
  assert.equal(offeredMethods([{ id: CARD, discountPct: 9 }])[0].discountPct, 0, 'a card never gets a discount, whatever the list says');
  const et = (hold) => offeredMethods([{ id: ETRANSFER, discountPct: 2, holdHours: hold }]).find((m) => m.id === ETRANSFER);
  assert.match(et(72).how, /hold your items for 72 hours/);
  assert.equal(et(72).holdHours, 72);
  assert.match(et(undefined).how, /for 48 hours/, 'an older server without the field reads as 48');
});

test('the saving is shown in words and dollars, and not at all when there is none', () => {
  const money = (v) => `$${v.toFixed(2)}`;
  assert.equal(savingsLabel(618, 2, money), 'Save 2% ($12.36)');
  assert.equal(savingsLabel(618, 0, money), '');
});

// ── the address form ───────────────────────────────────────────────────────────
test('Canadian postal codes are accepted in any spacing and case, US ZIPs and look-alikes are not', () => {
  for (const ok of ['M5H 2N2', 'm5h2n2', 'M5H-2N2', 'k1a0b1']) assert.match(ok, POSTAL_CODE, ok);
  for (const no of ['90210', 'D5H 2N2', 'M5H 2N', 'M5H 2N22', '', 'ABC DEF', 'M5H 2U2']) assert.doesNotMatch(no, POSTAL_CODE, no);
  assert.equal(normalizePostalCode(' m5h-2n2 '), 'M5H 2N2');
  assert.equal(normalizePostalCode('M5H2N2'), 'M5H 2N2');
});

test('the form names every field that is missing or wrong, and asks for an email only from guests', () => {
  const empty = { firstName: '', lastName: '', email: '', phone: '', line1: '', line2: '', city: '', state: 'ON', zip: '' };
  assert.deepEqual(Object.keys(validateEtransferForm(empty, { needsEmail: true })).sort(), ['city', 'email', 'firstName', 'lastName', 'line1', 'phone', 'zip']);
  assert.ok(!('email' in validateEtransferForm(empty, { needsEmail: false })), 'a signed-in buyer\'s email comes from the account');
  const good = { firstName: 'Sam', lastName: 'Buyer', email: 'sam@example.com', phone: '(416) 555-0123', line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };
  assert.deepEqual(validateEtransferForm(good, { needsEmail: true }), {});
  assert.ok('phone' in validateEtransferForm({ ...good, phone: 'call me' }, { needsEmail: true }));
  assert.ok('email' in validateEtransferForm({ ...good, email: 'sam@' }, { needsEmail: true }));
});

test('the deadline is spelled out in Toronto time', () => {
  const text = torontoDeadline('2026-10-15T19:40:00Z');
  assert.match(text, /Toronto time/);
  assert.match(text, /Oct/);
  assert.equal(torontoDeadline('garbage'), '');
});

// ── what the owner sees ────────────────────────────────────────────────────────
test('an order\'s payment reads as one clear state, and only an e-Transfer being waited for needs the owner', () => {
  const state = (o) => paymentState(o);
  assert.equal(state({ paymentMethod: 'stripe', paymentStatus: 'paid', status: 'processing' }).key, 'paid');
  assert.equal(state({ paymentStatus: 'paid', status: 'shipped' }).key, 'paid', 'orders from before payment methods existed have no method');
  assert.deepEqual(
    [state({ paymentMethod: 'etransfer', paymentStatus: 'pending', status: 'pending' }).key, state({ paymentMethod: 'etransfer', paymentStatus: 'pending', status: 'pending' }).needsYou],
    ['etransfer_waiting', true],
  );
  assert.equal(state({ paymentMethod: 'etransfer', paymentStatus: 'pending', status: 'cancelled', etransfer: { expiredAt: '2026-10-15' } }).key, 'etransfer_expired');
  assert.equal(state({ paymentMethod: 'etransfer', paymentStatus: 'pending', status: 'cancelled' }).key, 'cancelled', 'cancelled by hand is not "expired"');
  assert.equal(state({ paymentMethod: 'bank_debit', paymentStatus: 'pending', status: 'pending' }).key, 'bank_debit_clearing');
  assert.equal(state({ paymentMethod: 'bank_debit', paymentStatus: 'pending', status: 'pending' }).needsYou, false, 'it clears by itself');
  assert.equal(state({ paymentMethod: 'bank_debit', paymentStatus: 'failed', status: 'cancelled' }).key, 'failed');
  assert.equal(state({ paymentMethod: 'etransfer', paymentStatus: 'refunded', status: 'refunded' }).key, 'refunded');
  assert.equal(showPaymentLabel({ paymentMethod: 'stripe', paymentStatus: 'paid' }), false, 'a plain paid card order needs no second label');
  assert.equal(showPaymentLabel({ paymentMethod: 'etransfer', paymentStatus: 'paid' }), true);
  assert.equal(showPaymentLabel({ paymentMethod: 'stripe', paymentStatus: 'pending', status: 'pending' }), true);
  assert.equal(METHOD_NAMES.etransfer, 'Interac e-Transfer');
  assert.equal(stripePaymentUrl({ stripePaymentIntentId: 'pi_123' }), 'https://dashboard.stripe.com/payments/pi_123');
  assert.equal(stripePaymentUrl({}), null);
});

// ── the pages: what they send and what they never do ───────────────────────────
test('checkout shows the payment choice only inside Canada, and every discount comes from the server\'s list', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /paymentsApi\.methods\(\)/);
  assert.match(checkout, /const method = international \? methods\[0\] : \(methods\.find\(\(m\) => m\.id === methodId\) \|\| methods\[0\]\);/);
  assert.match(checkout, /\{!international && methods\.length > 1 && \(/);
  assert.match(checkout, /const total = totalBeforeTax - paymentDiscount;/);
  assert.match(checkout, /method\.id === BANK_DEBIT \? BANK_DEBIT : undefined,/);
  assert.match(checkout, /if \(method\.id === ETRANSFER\) \{ startEtransfer\(\); return; \}/);
  assert.match(checkout, /navigate\('\/checkout\/e-transfer', \{ state: delivery \}\)/);
  assert.match(checkout, /Promotion codes cannot be combined with it/);
  assert.doesNotMatch(checkout, /discountPct\s*=\s*\d/, 'no percentage is hard-coded in the page');
});

test('the e-Transfer page sends the buyer and the address, never a price, and asks for an email only of guests', async () => {
  const page = await read('../src/pages/CheckoutEtransfer.jsx');
  const call = page.slice(page.indexOf('createEtransferOrder({'), page.indexOf('trackEvent(\'etransfer_order_placed\''));
  assert.match(call, /buyer: \{ firstName: form\.firstName\.trim\(\), lastName: form\.lastName\.trim\(\), phone: form\.phone\.trim\(\), \.\.\.\(user \? \{\} : \{ email: form\.email\.trim\(\) \}\) \}/);
  assert.match(call, /shipping: \{ faster, signature: delivery\.signature \}/);
  assert.match(call, /acceptTerms: true/);
  assert.doesNotMatch(call, /total|discount|price|amount|subtotal/i, 'the browser never tells the server what anything costs');
  assert.match(page, /\{user \? \(/);
  assert.match(page, /if \(!agreed\)/);
  assert.match(page, /navigate\(\{ pathname: `\/order\/\$\{data\.orderNumber\}`, hash: data\.email \? `#email=\$\{encodeURIComponent\(data\.email\)\}` : '' \}, \{ replace: true \}\);/);
  assert.match(page, /clearCartLocal\(\);/);
  const app = await read('../src/App.jsx');
  assert.match(app, /<Route path="\/checkout\/e-transfer" element=\{<CheckoutEtransfer \/>\} \/>/);
});

test('the order page shows the e-Transfer instructions only while they apply, and the review survey only for paid orders', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /\{order\.etransfer && \(/);
  assert.match(page, /\{order\.paymentStatus === 'paid' && <GoogleCustomerReviewsOptIn order=\{order\} \/>\}/);
  assert.match(page, /order\.paymentStatus === 'pending' && order\.status === 'pending'/);
  assert.match(page, /Order placed: now send your e-Transfer/);
  assert.match(page, /Order received: your bank is processing the payment/);
  for (const row of ['et-recipient', 'et-amount', 'et-message']) assert.match(page, new RegExp(`testId="${row}"`));
});

test('coming back from a bank debit reports no purchase, and the owner confirms before an e-Transfer is marked paid', async () => {
  const returned = await read('../src/pages/CheckoutReturn.jsx');
  const processing = returned.slice(returned.indexOf("data.status === 'processing'"), returned.indexOf("data.status === 'complete'"));
  assert.match(processing, /trackEvent\('checkout_return', \{ outcome: 'processing' \}\)/);
  assert.doesNotMatch(processing, /trackPurchaseOnce/);
  const panel = await read('../src/components/admin/PaymentPanel.jsx');
  assert.match(panel, /window\.confirm\(text\)/);
  assert.match(panel, /adminApi\.markEtransferReceived\(order\._id, \{/);
  assert.match(panel, /if \(method === 'stripe' && state\.key === 'paid'\) return null;/);
  assert.match(panel, /data\?\.code === 'AMOUNT_MISMATCH'/);
  const orders = await read('../src/pages/admin/Orders.jsx');
  assert.match(orders, /<PaymentPanel order=\{order\} onChanged=\{\(\) => reloadOrder\(\)\} \/>/);
  assert.match(orders, /payment: awaiting \? 'awaiting' : undefined,/);
});

test('the terms name each way to pay, the 5-day bank debit, and the 48-hour e-Transfer', async () => {
  const terms = await read('../src/pages/policies/Terms.jsx');
  for (const phrase of ['heading: "Payment methods"', 'pre-authorized debit agreement', 'up to 5 business days', 'within 48 hours', 'Rule H1', 'ship only after we have received and confirmed your payment', 'cannot be combined with a promotion code']) {
    assert.ok(terms.includes(phrase), `terms say "${phrase}"`);
  }
});
