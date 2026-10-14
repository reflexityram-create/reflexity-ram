// Checkout fixes of 2026-10-13 (owner's asks):
//  - going Back from Stripe's page must not leave the pay button stuck on "Opening secure checkout…" (the browser's back/forward
//    cache brings the page back exactly as it was left; the real-browser proof is e2e/walk-checkout-fixes.cjs);
//  - the e-Transfer address is NOT the shop's contact email, and the message with the order number is optional but helps.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SUPPORT_EMAIL, differsFromContact, sameAddress } from '../src/lib/contact.js';
import { ETRANSFER, offeredMethods } from '../src/lib/paymentMethods.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the contact address is told apart from the e-Transfer address, ignoring case and spaces', () => {
  assert.equal(SUPPORT_EMAIL, 'reflexityram@gmail.com');
  assert.equal(sameAddress(' ReflexityRAM@Gmail.com ', SUPPORT_EMAIL), true);
  assert.equal(differsFromContact('pay@example.com'), true);
  assert.equal(differsFromContact('reflexityram@gmail.com'), false);
  assert.equal(differsFromContact('  REFLEXITYRAM@gmail.com'), false, 'the same mailbox in other capitals is not a different address');
  assert.equal(differsFromContact(''), false, 'no address, nothing to warn about');
  assert.equal(differsFromContact(undefined), false);
});

test('the server\'s "not our contact email" flag reaches only the e-Transfer entry, and only when it is exactly true', () => {
  const listed = (flag) => offeredMethods([{ id: 'etransfer', discountPct: 2, holdHours: 48, contactDiffers: flag }]).find((m) => m.id === ETRANSFER);
  assert.equal(listed(true).contactDiffers, true);
  for (const silly of [false, undefined, 'true', 1, null]) assert.equal('contactDiffers' in listed(silly), false, `contactDiffers=${JSON.stringify(silly)}`);
  const withFlagOnEverything = offeredMethods([
    { id: 'bank_debit', discountPct: 1, contactDiffers: true },
    { id: 'etransfer', discountPct: 2, contactDiffers: true },
  ]);
  assert.deepEqual(withFlagOnEverything.map((m) => [m.id, 'contactDiffers' in m]), [['card', false], ['bank_debit', false], ['etransfer', true]]);
});

test('Back from Stripe: a page shown again from the cache clears "Opening secure checkout…", and the listener is removed with the page', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  assert.match(checkout, /const onPageShow = \(event\) => \{ if \(event\.persisted\) setRedirecting\(false\); \};/);
  assert.match(checkout, /window\.addEventListener\('pageshow', onPageShow\);/);
  assert.match(checkout, /return \(\) => window\.removeEventListener\('pageshow', onPageShow\);/);
  // the button is still the thing that says it is opening Stripe, and it is only disabled while that is true
  assert.match(checkout, /disabled=\{redirecting \|\| \(international && !chosen\)\}/);
  assert.match(checkout, /Opening secure checkout…/);
  // Stripe is only ever opened from this one place: another page that leaves for Stripe would need the same reset
  const pages = ['Cart', 'CheckoutEtransfer', 'CheckoutReturn', 'OrderSuccess', 'Product'];
  for (const name of pages) assert.doesNotMatch(await read(`../src/pages/${name}.jsx`), /window\.location\.href\s*=/, `${name} does not leave the site by assigning location`);
});

test('the e-Transfer wording: not our contact email, and the message is optional but helps (checkout, e-Transfer page, order page, Terms)', async () => {
  const [checkout, etransfer, order, terms] = await Promise.all([
    read('../src/pages/Checkout.jsx'), read('../src/pages/CheckoutEtransfer.jsx'), read('../src/pages/OrderSuccess.jsx'), read('../src/pages/policies/Terms.jsx'),
  ]);
  // checkout page, when e-Transfer is chosen
  assert.match(checkout, /\$\{method\.contactDiffers \? ' \(it is not our contact email\)' : ''\}/);
  assert.match(checkout, /A message with your order number is optional, but it helps us match your payment\./);
  assert.doesNotMatch(checkout, /the address and the message to use/, 'the old wording sounded required');
  // the e-Transfer page names the contact email and only says "not" when the server said so
  assert.match(etransfer, /\{offer\?\.contactDiffers \? ` It is not our contact email \(\$\{SUPPORT_EMAIL\}\): please send the e-Transfer only to the address we show\.` : ''\}/);
  assert.match(etransfer, /A message with your order number is optional, but it helps us match your payment\./);
  // the order page: the notice sits right under "Send to" and only when the addresses really differ; the message row is labelled optional
  assert.match(order, /\{differsFromContact\(order\.etransfer\.recipientEmail\) && \(/);
  assert.match(order, /data-testid="et-not-contact"/);
  assert.match(order, /not to \{SUPPORT_EMAIL\}: that inbox is for questions\./);
  assert.match(order, /label="Message \(optional, helps us match it\)"/);
  assert.ok(order.indexOf('testId="et-recipient"') < order.indexOf('data-testid="et-not-contact"') && order.indexOf('data-testid="et-not-contact"') < order.indexOf('testId="et-amount"'), 'the warning is between the address and the amount');
  assert.doesNotMatch(order, /Message \(so we can match it\)/);
  // the Terms stay true whichever address receives the money: they say the message is optional and do not say the address differs
  assert.match(terms, /the address to pay and an order number you can put in the message, which is optional but helps us match your payment/);
  assert.doesNotMatch(terms, /not our contact email/, 'static text cannot know which address the owner uses');
});
