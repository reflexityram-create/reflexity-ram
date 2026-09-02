const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsOrder } = require('../src/utils/analyticsOrder');

test('analyticsOrder returns the verified paid-order values GA4 needs', () => {
  assert.deepEqual(analyticsOrder({
    total: 37.5,
    tax: 3.5,
    shippingCost: 14,
    items: [{ sku: 'SKU-1', slug: 'fallback', name: 'Test RAM', price: 20, qty: 1 }],
  }, 'cad'), {
    currency: 'CAD',
    value: 37.5,
    tax: 3.5,
    shipping: 14,
    items: [{ item_id: 'SKU-1', item_name: 'Test RAM', price: 20, quantity: 1 }],
  });
});
