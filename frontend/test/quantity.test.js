import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MAX_QTY_PER_LINE, clampQuantity, limitNote, quantityLimit } from '../src/lib/quantity.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the limit is the stock on hand, never above what the cart accepts', () => {
  assert.equal(quantityLimit(2), 2);
  assert.equal(quantityLimit('7'), 7);
  assert.equal(quantityLimit(0), 0);
  assert.equal(quantityLimit(-3), 0);
  assert.equal(quantityLimit(250), MAX_QTY_PER_LINE);
  assert.equal(quantityLimit(4.9), 4);
});

test('a product without a stock count is limited by the server, not guessed at', () => {
  for (const unknown of [undefined, null, '', 'many', NaN]) {
    assert.equal(quantityLimit(unknown), MAX_QTY_PER_LINE, String(unknown));
  }
});

test('tapping or typing past the limit stops at it and says so', () => {
  assert.deepEqual(clampQuantity(3, 2), { qty: 2, capped: true });
  assert.deepEqual(clampQuantity(2, 2), { qty: 2, capped: false });
  assert.deepEqual(clampQuantity(99, 2), { qty: 2, capped: true });
  assert.deepEqual(clampQuantity('12', 5), { qty: 5, capped: true });
});

test('quantities below one or that are not numbers fall back to one', () => {
  for (const bad of [0, -4, '', 'abc', NaN, undefined]) {
    assert.deepEqual(clampQuantity(bad, 5), { qty: 1, capped: false }, String(bad));
  }
  assert.deepEqual(clampQuantity(2.9, 5), { qty: 2, capped: false });
});

test('with nothing in stock there is nothing to pick', () => {
  assert.deepEqual(clampQuantity(1, 0), { qty: 0, capped: false });
});

test('the limit message names the stock, or the order maximum when the stock is unknown or large', () => {
  assert.equal(limitNote(2), 'Only 2 available');
  assert.equal(limitNote(1), 'Only 1 available');
  assert.equal(limitNote(0), 'Out of stock');
  assert.equal(limitNote(150), 'Maximum 99 per order');
  assert.equal(limitNote(undefined), 'Maximum 99 per order');
});

test('the product page and the cart both use the stock-limited quantity picker', async () => {
  const [product, cart, stepper] = await Promise.all([
    read('../src/pages/Product.jsx'),
    read('../src/pages/Cart.jsx'),
    read('../src/components/QuantityStepper.jsx'),
  ]);
  // The old pickers went up without limit.
  assert.doesNotMatch(product, /setQty\(\(q\) => q \+ 1\)/);
  assert.doesNotMatch(cart, /updateItem\(item\.slug, item\.qty \+ 1\)/);
  assert.match(product, /<QuantityStepper/);
  assert.match(cart, /<QuantityStepper/);
  assert.match(product, /quantityLimit\(p\?\.stockQuantity\)/);
  assert.match(cart, /quantityLimit\(item\.available\)/);
  // The picker types as well as taps, and the over-limit message is announced and red.
  assert.match(stepper, /inputMode="numeric"/);
  assert.match(stepper, /role="status"/);
  assert.match(stepper, /text-red-/);
});
