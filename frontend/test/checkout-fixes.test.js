// Checkout fixes of 2026-10-13 (owner's asks):
//  - going Back from Stripe's page must not leave the pay button stuck on "Opening secure checkout…" (the browser's back/forward
//    cache brings the page back exactly as it was left; the real-browser proof is walk-checkout-fixes.cjs and walk-review-followups.cjs,
//    kept in the owner's project notes (.ai/artifacts/payments-2026-10-13/e2e/), NOT in this repository: see docs/testing-notes.md);
//  - the e-Transfer address is NOT the shop's contact email, and the message with the order number is optional but helps.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SUPPORT_EMAIL, differsFromContact, sameAddress } from '../src/lib/contact.js';
import { ETRANSFER, offeredMethods } from '../src/lib/paymentMethods.js';
import { HANDOFF_PATIENCE_MS, onRestoredFromCache } from '../src/lib/pageShow.js';

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

test('onRestoredFromCache runs its callback only when the page comes back from the cache, and stops when asked', () => {
  const target = new EventTarget();
  const shown = (persisted) => { const event = new Event('pageshow'); Object.defineProperty(event, 'persisted', { value: persisted }); target.dispatchEvent(event); };
  let calls = 0;
  const stop = onRestoredFromCache(() => { calls += 1; }, target);
  shown(false);
  assert.equal(calls, 0, 'a first load (persisted false) is not a restore');
  shown(undefined);
  assert.equal(calls, 0, 'an event without the flag is not a restore');
  target.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 0, 'only pageshow counts');
  shown(true);
  assert.equal(calls, 1, 'a restore from the cache runs it');
  shown(true);
  assert.equal(calls, 2, 'and again for the next restore');
  stop();
  shown(true);
  assert.equal(calls, 2, 'after stopping it never runs again');
  assert.equal(typeof onRestoredFromCache(() => {}, undefined), 'function', 'with no window (server rendering) it still returns something callable');
  assert.ok(HANDOFF_PATIENCE_MS >= 10_000 && HANDOFF_PATIENCE_MS <= 60_000, 'long enough for a slow connection, short enough not to feel stuck');
});

test('Back from Stripe: the checkout page resets itself on a restore, asks again for the cart and the methods, and gives the button back after a hand-off that never completes', async () => {
  const checkout = await read('../src/pages/Checkout.jsx');
  // the one effect that listens, and what it does
  assert.match(checkout, /useEffect\(\(\) => onRestoredFromCache\(\(\) => \{\s*window\.clearTimeout\(handoffTimer\.current\);\s*setRedirecting\(false\);\s*fetchCart\(\);\s*loadMethods\(\);\s*\}\), \[\]\);/);
  assert.match(checkout, /useEffect\(loadMethods, \[\]\);/, 'the methods load on a first visit too');
  // the safety net starts right after the hand-off and is cleared on unmount
  assert.match(checkout, /window\.location\.href = data\.url;[^\n]*\n[^\n]*\n\s*window\.clearTimeout\(handoffTimer\.current\);\s*handoffTimer\.current = window\.setTimeout\(\(\) => setRedirecting\(false\), HANDOFF_PATIENCE_MS\);/);
  assert.match(checkout, /useEffect\(\(\) => \(\) => window\.clearTimeout\(handoffTimer\.current\), \[\]\);/);
  // the button is still the thing that says it is opening Stripe, and it is only disabled while that is true
  assert.match(checkout, /disabled=\{redirecting \|\| \(international && !chosen\)\}/);
  assert.match(checkout, /Opening secure checkout…/);
  assert.match(checkout, /setRedirecting\(false\);\s*\}\s*\};\s*\n\s*return \(/, 'a failed session request still gives the button back');
});

test('Stripe is only ever opened from the checkout page: no other place in the app leaves by assigning location or opening a window', async () => {
  const { readdir } = await import('node:fs/promises');
  const found = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (/\.(jsx?|mjs)$/.test(entry.name)) {
        const text = await read(path);
        for (const match of text.matchAll(/(?:window\.)?location\.(?:href\s*=(?!=)|assign\(|replace\()|window\.open\(/g)) found.push(`${path.replace('../src/', 'src/')}: ${match[0]}`);
      }
    }
  };
  await walk('../src/');
  assert.deepEqual(found.map((line) => line.split(':')[0]), ['src/pages/Checkout.jsx'], `only the checkout page may leave the site this way (found: ${found.join(' | ')}); any other page that does needs the same reset`);
  assert.equal(found.length, 1);
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
  const paragraph = terms.split('\n').find((line) => line.includes('Interac e-Transfer. After you place'));
  assert.ok(paragraph, 'the e-Transfer paragraph of the Terms is there');
  assert.doesNotMatch(paragraph, /contact (e-?mail|address)|different (from|address)|differs/i, 'the Terms never claim the payee does or does not equal the contact address');
  assert.doesNotMatch(paragraph, /order confirmation email/i, 'the address is NOT in the order confirmation email (that one is only sent once the money is received)');
  assert.match(paragraph, /Only pay the address shown on your order page and in the e-Transfer instructions email we send when you order/);
});
