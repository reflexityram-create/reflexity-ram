const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsOrder } = require('../src/utils/analyticsOrder');

// Google's rule (GA4 event reference, purchase): value = Σ price × quantity over the items, without shipping or tax; a
// discounted item carries its discounted unit price. Until 2026-10-14 value was the order total (shipping counted as revenue).
test('the purchase value is the goods only: no shipping, no tax', () => {
  assert.deepEqual(analyticsOrder({
    total: 37.5,
    tax: 3.5,
    shippingCost: 14,
    items: [{ sku: 'SKU-1', slug: 'fallback', name: 'Test RAM', price: 20, qty: 1 }],
  }, 'cad'), {
    currency: 'CAD',
    value: 20,
    tax: 3.5,
    shipping: 14,
    items: [{ item_id: 'SKU-1', item_name: 'Test RAM', price: 20, quantity: 1 }],
  });
});

test('the order\'s discount is spread over the items, and value is the sum of the discounted prices', () => {
  // an e-Transfer order: 2% off goods of 435 + 2 × 170 = 775 → 15.50 off; shipping 14 is not revenue
  const result = analyticsOrder({
    total: 773.5, discount: 15.5, shippingCost: 14, tax: 0,
    items: [{ sku: 'S32', name: 'Samsung 32GB', price: 435, qty: 1 }, { sku: 'L16', name: 'Lenovo 16GB', price: 170, qty: 2 }],
  });
  assert.deepEqual(result.items, [
    { item_id: 'S32', item_name: 'Samsung 32GB', price: 426.3, discount: 8.7, quantity: 1 },
    { item_id: 'L16', item_name: 'Lenovo 16GB', price: 166.6, discount: 3.4, quantity: 2 },
  ]);
  assert.equal(result.value, 759.5, '775 of goods less the 15.50 discount');
  assert.equal(result.value, result.items.reduce((sum, i) => sum + i.price * i.quantity, 0));
});

test('the value keeps the exact discount when it does not divide into unit prices; it never goes below zero', () => {
  const odd = analyticsOrder({ discount: 1, items: [{ sku: 'A', name: 'A', price: 0.99, qty: 3 }] });
  assert.equal(odd.items[0].price, 0.66, 'the unit price is rounded to the cent');
  assert.equal(odd.value, 1.97, '2.97 of goods less the 1.00 discount, exactly');
  const many = analyticsOrder({ discount: 134.15, items: [{ sku: 'M', name: 'M', price: 135.5, qty: 99 }] });
  assert.equal(many.value, 13280.35, '13,414.50 less 134.15: rounding per unit does not add up over 99 units');
  const all = analyticsOrder({ discount: 500, items: [{ sku: 'B', name: 'B', price: 100, qty: 1 }] });
  assert.equal(all.value, 0);
  assert.equal(all.items[0].price, 0);
  assert.equal(analyticsOrder({ items: [] }).value, 0);
  assert.equal(analyticsOrder({ discount: -5, items: [{ sku: 'C', name: 'C', price: 10, qty: 1 }] }).value, 10, 'a negative discount is ignored');
});
