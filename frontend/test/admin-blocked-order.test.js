// A paid Stripe order with a line no product matched is held by the server (backend/src/routes/admin.js, docs/admin-orders.md "A paid order
// with an unmatched Stripe item"): no tracking number, no "shipped", no label until the owner has checked the payment. The owner must be
// able to release it from the Orders screen, not only with a raw API call.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { nextStep, unmatchedItems } from '../src/lib/adminOrders.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const order = (extra = {}) => ({ _id: 'o1', orderNumber: 'RFX-1', status: 'processing', paymentStatus: 'paid', paymentMethod: 'stripe', total: 100, ...extra });

test('a blocked paid order is held for a payment check instead of being offered "ship", and a released one ships normally', () => {
  const step = (extra) => nextStep(order(extra)).key;
  assert.equal(step({ fulfillmentBlocked: true }), 'review');
  assert.equal(step({ status: 'pending', fulfillmentBlocked: true }), 'review');
  assert.equal(step({ fulfillmentBlocked: false }), 'ship', 'released');
  assert.equal(step({}), 'ship', 'an order that never had the flag');
  // the flag only matters while the order is paid and open: the other steps keep their meaning
  assert.equal(step({ status: 'pending', paymentStatus: 'pending', fulfillmentBlocked: true }), 'unpaid');
  assert.equal(step({ status: 'cancelled', fulfillmentBlocked: true }), 'closed');
  assert.equal(step({ status: 'refunded', paymentStatus: 'refunded', fulfillmentBlocked: true }), 'closed');
  assert.equal(step({ status: 'shipped', fulfillmentBlocked: true }), 'deliver');
});

test('the card names the Stripe lines that matched no product, by the prefix the server gives them', async () => {
  const [server, here] = await Promise.all([read('../../backend/src/utils/unmatchedItems.js'), read('../src/lib/orderItems.js')]);
  const prefix = server.match(/const UNMATCHED_SLUG_PREFIX = '([^']+)';/)?.[1];
  assert.ok(prefix, 'the server names its placeholder items with one prefix');
  assert.equal(here.match(/export const UNMATCHED_SLUG_PREFIX = '([^']+)';/)?.[1], prefix, 'and the front end uses the same one');
  const items = [{ slug: `${prefix}price_ABC`, name: 'Mystery module', qty: 1, price: 50 }, { slug: 'hynix-32gb', name: 'SK Hynix 32GB', qty: 1, price: 60 }, null, {}];
  assert.deepEqual(unmatchedItems({ items }).map((item) => item.name), ['Mystery module']);
  assert.deepEqual(unmatchedItems({ items: [{ slug: 'hynix-32gb' }] }), []);
  for (const junk of [null, undefined, {}, { items: 'x' }]) assert.deepEqual(unmatchedItems(junk), [], String(junk));
});

test('the review card calls the route the server has, with a note no longer than the server accepts', async () => {
  const [api, route, actions] = await Promise.all([read('../src/lib/api.js'), read('../../backend/src/routes/admin.js'), read('../src/components/admin/OrderActions.jsx')]);
  assert.match(api, /reviewBlockedOrder: \(id, note\) => api\.post\(`\/admin\/orders\/\$\{id\}\/fulfillment-review`, note \? \{ note \} : \{\}\)/);
  const start = route.indexOf("router.post('/orders/:id/fulfillment-review'");
  assert.ok(start > 0, 'the route the button calls exists on the server');
  const max = Number(route.slice(start, route.indexOf('async (req, res)', start)).match(/isLength\(\{ max: (\d+) \}\)/)?.[1]);
  assert.ok(max > 0, 'the server limits the note');
  assert.equal(Number(actions.match(/maxLength=\{(\d+)\} data-testid="order-review-note"/)?.[1]), max, 'the field stops at the length the server accepts');
});

test('a blocked order shows the review card in place of the ship card, and releasing asks once and changes nothing else', async () => {
  const [actions, orders] = await Promise.all([read('../src/components/admin/OrderActions.jsx'), read('../src/pages/admin/Orders.jsx')]);
  assert.match(actions, /if \(step\.key === 'review'\) return <ReviewCard order=\{order\} onChanged=\{onChanged\} \/>;/);
  assert.ok(actions.indexOf("step.key === 'review'") < actions.indexOf("step.key === 'ship'"), 'the hold is checked before the ship card');
  const card = actions.slice(actions.indexOf('function ReviewCard'), actions.indexOf('// Ship it:'));
  assert.match(card, /adminApi\.reviewBlockedOrder\(order\._id, note\.trim\(\)\);\s*await onChanged\(data\.order\);/, 'the order is read again after the release');
  assert.match(card, /<ConfirmButton[\s\S]*?onConfirm=\{release\}[\s\S]*?testId="order-review-release"/, 'one confirmation before anything is changed');
  assert.doesNotMatch(card, /changeStatus|updateOrderStatus|updateOrderTracking|markOrderUntracked/, 'releasing neither ships the order nor saves a number');
  assert.match(card, /stripePaymentUrl\(order\)/, 'the owner can open the payment from the card');
  assert.match(card, /unmatchedItems\(order\)[\s\S]*?data-testid="order-review-items"/, 'the card lists the item that matched no product');
  // the list says so too, and counts it among the orders that wait for the owner
  assert.match(orders, /\['collect', 'ship', 'review'\]\.includes\(nextStep\(order\)\.key\)/);
  assert.match(orders, /nextStep\(order\)\.key === 'review' && <span[^>]*>Check the payment first<\/span>/);
});
