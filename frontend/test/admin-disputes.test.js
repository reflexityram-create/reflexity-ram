// How the owner sees a dispute (chargeback) or a bank inquiry on an order. The server keeps it (backend/src/utils/disputes.js);
// this is what the admin shows: one red box at the top of the order, a pill wherever orders are listed, a link to Stripe.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DISPUTE_PILL_CLASS, disputeState, paymentState, showPaymentLabel, stripeDisputeUrl } from '../src/lib/orderPayment.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const order = (dispute, extra = {}) => ({
  paymentMethod: 'stripe', paymentStatus: 'paid', status: 'processing',
  dispute: { id: 'dp_1', status: 'needs_response', reason: 'fraudulent', reasonText: 'the buyer says they did not make this payment', amount: 449, currency: 'cad', evidenceDueBy: '2026-10-28T22:40:00.000Z', ...dispute },
  ...extra,
});

test('an order with no dispute shows nothing', () => {
  assert.equal(disputeState(undefined), null);
  assert.equal(disputeState({}), null);
  assert.equal(disputeState({ dispute: {} }), null);
  assert.equal(disputeState({ dispute: { status: 'lost' } }), null, 'a record without an id is not a dispute');
  assert.equal(stripeDisputeUrl({}), null);
});

test('an open dispute says why, what Stripe took, the deadline, and not to ship what has not gone out', () => {
  const state = disputeState(order());
  assert.deepEqual([state.key, state.label, state.tone, state.needsYou], ['open', 'Disputed', 'bad', true]);
  assert.equal(state.headline, 'Disputed: the buyer says they did not make this payment');
  assert.equal(state.text, 'Stripe took $449.00 CAD back until this is settled. Send your evidence in Stripe by Oct 28. Do not ship this order.');
  assert.equal(disputeState(order({}, { status: 'pending' })).text.endsWith('Do not ship this order.'), true);
});

test('for a parcel that already went, the advice is the evidence to send, not to hold it', () => {
  for (const status of ['shipped', 'delivered']) {
    const text = disputeState(order({}, { status })).text;
    assert.match(text, /Send the tracking number and proof of delivery as evidence\.$/, status);
    assert.doesNotMatch(text, /Do not ship/, status);
  }
  assert.doesNotMatch(disputeState(order({}, { status: 'cancelled' })).text, /Do not ship|tracking/);
});

test('once evidence is in, nothing is asked of the owner but the order is still marked', () => {
  const state = disputeState(order({ status: 'under_review' }));
  assert.deepEqual([state.key, state.label, state.needsYou], ['open', 'Disputed', false]);
  assert.match(state.text, /^Your evidence is with the bank\. Stripe took \$449\.00 CAD back until they decide\./);
});

test('a bank inquiry is amber and says no money has been taken', () => {
  const state = disputeState(order({ status: 'warning_needs_response' }));
  assert.deepEqual([state.key, state.label, state.tone, state.needsYou], ['inquiry', 'Bank inquiry', 'warn', true]);
  assert.match(state.text, /^No money has been taken\. Answer in Stripe by Oct 28 so it does not become a dispute\./);
  assert.equal(disputeState(order({ status: 'warning_under_review' })).needsYou, false);
});

test('how it ended: lost is red and says the money is gone, won is green, a closed inquiry is quiet', () => {
  assert.deepEqual(['lost', 'Dispute lost', 'bad'], (({ key, label, tone }) => [key, label, tone])(disputeState(order({ status: 'lost' }))));
  assert.match(disputeState(order({ status: 'lost' })).text, /\$449\.00 CAD was not returned\./);
  assert.deepEqual(['won', 'Dispute won', 'ok'], (({ key, label, tone }) => [key, label, tone])(disputeState(order({ status: 'won' }))));
  assert.match(disputeState(order({ status: 'won' })).text, /The money stays with you\./);
  for (const [status, key] of [['warning_closed', 'inquiry_closed'], ['prevented', 'prevented']]) {
    const state = disputeState(order({ status }));
    assert.deepEqual([state.key, state.tone, state.needsYou], [key, 'muted', false], status);
  }
  const unknown = disputeState(order({ status: 'brand_new_status' }));
  assert.deepEqual([unknown.key, unknown.label], ['other', 'Dispute']);
  assert.match(unknown.text, /brand_new_status/);
});

test('missing facts read sensibly: no deadline, no reason words, a reason code that is only a code', () => {
  assert.match(disputeState(order({ evidenceDueBy: undefined })).text, /Send your evidence in Stripe\. Do not ship/);
  assert.match(disputeState(order({ evidenceDueBy: 'not a date' })).text, /Send your evidence in Stripe\. Do not ship/);
  assert.equal(disputeState(order({ reasonText: undefined })).headline, 'Disputed: fraudulent');
  assert.equal(disputeState(order({ reasonText: undefined, reason: undefined })).headline, 'Disputed: the bank gave no reason');
  assert.equal(disputeState(order({ amount: undefined })).text.startsWith('Stripe took $0.00 CAD'), true);
});

test('a dispute pill is red because it uses a pill class: a text colour utility loses to .pill\'s own colour', async () => {
  assert.deepEqual(DISPUTE_PILL_CLASS, { bad: 'pill-red', warn: 'pill-amber', ok: 'pill-accent', muted: '' });
  const css = await read('../src/index.css');
  assert.match(css, /\.pill-red \{[^}]*color: #b3261e;/);
  assert.match(css, /html\.dark \.pill-red \{[^}]*color: #ff9c94;/);
  const pill = await read('../src/components/admin/DisputePill.jsx');
  assert.match(pill, /DISPUTE_PILL_CLASS\[dispute\.tone\]/);
  assert.doesNotMatch(pill, /TONE_CLASS/, 'TONE_CLASS puts a text colour class on a .pill, which .pill overrides');
});

test('the dispute opens in Stripe, where evidence is sent', () => {
  assert.equal(stripeDisputeUrl(order()), 'https://dashboard.stripe.com/disputes/dp_1');
  assert.equal(stripeDisputeUrl(order({ id: 'dp_a/b' })), 'https://dashboard.stripe.com/disputes/dp_a%2Fb');
});

test('a dispute does not change how the payment itself reads: the order is still paid, and a plain card order still has no payment panel', () => {
  const disputed = order();
  assert.equal(paymentState(disputed).key, 'paid');
  assert.equal(showPaymentLabel(disputed), false, 'the card order\'s own label stays hidden; the dispute pill is separate');
});

test('the order sheet shows the box first, and the order lists show the dispute pill too', async () => {
  const orders = await read('../src/pages/admin/Orders.jsx');
  assert.match(orders, /import DisputeBox from '@\/components\/admin\/DisputeBox';/);
  assert.match(orders, /import DisputePill from '@\/components\/admin\/DisputePill';/);
  const body = orders.slice(orders.indexOf('<DisputeBox order={order} />'));
  assert.ok(body.indexOf('data-testid="order-admin-notes"') > 0, 'the box is above the system notes');
  assert.ok(orders.indexOf('<DisputeBox order={order} />') < orders.indexOf('data-testid="order-admin-notes"'));
  assert.equal(orders.split('<DisputePill order={order} />').length - 1, 2, 'the order sheet badges and the phone card');
  assert.match(orders, /<DisputePill order=\{o\} className="ml-1\.5" \/>/, 'and the desktop table');
  assert.match(orders, /const underDispute = \['open', 'inquiry', 'lost'\]\.includes\(disputeState\(order\)\?\.key\);/);
  assert.match(orders, /nextStep\(order\)\.key === 'ship' && !underDispute && <span[^>]*>Ready to ship<\/span>/, 'a disputed order is not labelled "Ready to ship"');
  const box = await read('../src/components/admin/DisputeBox.jsx');
  assert.match(box, /data-testid="order-dispute"/);
  assert.match(box, /href=\{link\} target="_blank" rel="noopener noreferrer"/);
  assert.match(box, /role=\{dispute\.needsYou \? 'alert' : 'note'\}/);
});
