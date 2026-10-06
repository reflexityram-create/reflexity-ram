const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShippingPreparation, fulfilmentState, serviceFromOrder } = require('../src/utils/shippingPreparation');

const query = (items) => ({
  select: () => ({ lean: async () => items }),
});

function productModel({ linked = [], legacy = [] } = {}) {
  return { find: (filter) => {
    if (filter._id) return query(linked);
    return query(legacy);
  } };
}

const baseOrder = (overrides = {}) => ({
  paymentStatus: 'paid', status: 'processing', shippingMethod: 'Faster shipping: Xpresspost',
  adminNotes: 'SHIPPING: the buyer paid for "Faster shipping: Xpresspost + signature on delivery". When you make the label, buy Xpresspost and add the Signature option.',
  shippingAddress: { firstName: 'A', lastName: 'Buyer', line1: '1 Main', line2: 'Unit 2', city: 'Toronto', state: 'ON', zip: 'M1P 3T7', country: 'CA' },
  items: [{ sku: 'RAM-1', name: 'Current name', price: 40, qty: 2, productObjectID: 'old-id' }],
  ...overrides,
});

test('uses recorded service and signature without assuming Standard is Express', () => {
  assert.deepEqual(serviceFromOrder({ shippingMethod: 'Standard shipping' }), { name: 'Standard', recordedMethod: 'Standard shipping', signature: false });
  assert.equal(serviceFromOrder({ shippingMethod: 'Faster shipping: Xpresspost', adminNotes: 'signature on delivery' }).signature, false);
  assert.equal(serviceFromOrder({ adminNotes: 'SHIPPING: the buyer paid for "Faster shipping: Xpresspost + signature on delivery". When you make the label, buy Xpresspost and add the Signature option.' }).signature, true);
});

test('keeps historical snapshot fields and reads only origin/HS from current products', async () => {
  const result = await buildShippingPreparation(baseOrder(), productModel({
    linked: [{ _id: '507f1f77bcf86cd799439011', sku: 'RAM-1', countryOfOrigin: 'KR', hsCode: '8473.30', isActive: true }],
  }));
  assert.equal(result.items[0].name, 'Current name');
  assert.equal(result.customs.required, false);
  assert.equal(result.service.signature, true);
  assert.equal(result.recipient.line2, 'Unit 2');
});

test('international customs uses CAD snapshot price and flags missing or deactivated products', async () => {
  const order = baseOrder({ shippingAddress: { ...baseOrder().shippingAddress, country: 'US' }, items: [
    { sku: 'RAM-1', name: 'RAM snapshot', price: 55.5, qty: 2 },
    { sku: 'RAM-2', name: 'Missing product', price: 10, qty: 1 },
  ] });
  const result = await buildShippingPreparation(order, productModel({
    legacy: [{ _id: '507f1f77bcf86cd799439012', sku: 'RAM-1', countryOfOrigin: '', hsCode: '', isActive: false }],
  }));
  assert.equal(result.customs.lines[0].unitValueCAD, 55.5);
  assert.equal(result.customs.lines[0].missingOrigin, true);
  assert.equal(result.customs.lines[0].productActive, false);
  assert.equal(result.customs.lines[1].productFound, false);
  assert.equal(result.fulfillment.state, 'blocked_missing_customs');
  assert.match(result.copyText, /ORIGIN MISSING/);
});

test('uses linked product identity across SKU changes and never falls back to a replacement SKU', async () => {
  const linkedId = '507f1f77bcf86cd799439014';
  const order = baseOrder({ shippingAddress: { ...baseOrder().shippingAddress, country: 'US' }, items: [
    { product: linkedId, sku: 'OLD-SKU', name: 'Historical item', price: 12, qty: 1 },
  ] });
  const stable = await buildShippingPreparation(order, productModel({
    linked: [{ _id: linkedId, sku: 'NEW-SKU', countryOfOrigin: 'KR', hsCode: '8473.30', isActive: true }],
  }));
  assert.equal(stable.customs.lines[0].countryOfOrigin, 'KR');
  assert.equal(stable.customs.lines[0].productId, linkedId);
  const replacement = await buildShippingPreparation(order, productModel({
    legacy: [{ _id: '507f1f77bcf86cd799439015', sku: 'OLD-SKU', countryOfOrigin: 'VN', hsCode: '8473.30', isActive: true }],
  }));
  assert.equal(replacement.customs.lines[0].productFound, false);
  assert.equal(replacement.customs.lines[0].countryOfOrigin, null);
});

test('inactive product with complete customs data remains prepareable', async () => {
  const order = baseOrder({ shippingAddress: { ...baseOrder().shippingAddress, country: 'US' }, items: [
    { sku: 'LEGACY', name: 'RAM', price: 10, qty: 1 },
  ] });
  const result = await buildShippingPreparation(order, productModel({
    legacy: [{ _id: '507f1f77bcf86cd799439016', sku: 'LEGACY', countryOfOrigin: 'KR', hsCode: '8473.30', isActive: false }],
  }));
  assert.equal(result.fulfillment.canCreateLabel, true);
  assert.equal(result.customs.lines[0].productActive, false);
});

test('an order whose stored label says Standard still shows the service the checkout note says to buy', () => {
  // Before 2026-10-06 the stored label read "Standard Shipping" on every order (Stripe's shipping rate was never expanded); the note comes from the checkout metadata.
  const mislabelled = serviceFromOrder({
    shippingMethod: 'Standard Shipping',
    adminNotes: 'SHIPPING: the buyer paid for "Standard Shipping". When you make the label, buy Xpresspost and add the Signature option.',
  });
  assert.deepEqual(mislabelled, { name: 'Xpresspost', recordedMethod: 'Standard Shipping', signature: true });
  assert.equal(serviceFromOrder({
    shippingMethod: 'Standard Shipping',
    adminNotes: 'SHIPPING: the buyer paid for "Standard Shipping". When you make the label, add the Signature option.',
  }).name, 'Standard', 'a note that names no service leaves the recorded one alone');
  assert.equal(serviceFromOrder({ shippingMethod: 'Standard Shipping', adminNotes: 'buy Xpresspost, someone typed this' }).name, 'Standard', 'only the generated note counts');
});

test('the checkout\'s own flat-rate label reads as a service, not as a sentence with the signature said twice', () => {
  const flat = 'Flat-Rate Shipping (delivery 3–6 business days after dispatch)';
  assert.deepEqual(serviceFromOrder({ shippingMethod: flat }), { name: 'Flat-rate shipping', recordedMethod: flat, signature: false });
  assert.deepEqual(serviceFromOrder({ shippingMethod: `${flat} + signature on delivery` }), { name: 'Flat-rate shipping', recordedMethod: `${flat} + signature on delivery`, signature: true });
  assert.equal(serviceFromOrder({ shippingMethod: 'Some other service + signature on delivery' }).name, 'Some other service', 'an unknown label keeps its words but not the signature suffix');
});

test('missing or null pieces of an order never throw', async () => {
  const result = await buildShippingPreparation({
    paymentStatus: 'paid', status: 'processing', shippingAddress: null,
    items: [null, { sku: 'RAM-1', name: 'RAM', price: 5, qty: 1 }],
  }, productModel());
  assert.equal(result.recipient.line1, '');
  assert.equal(result.items.length, 1);
});

test('an international order with no items cannot be marked ready', async () => {
  const result = await buildShippingPreparation(baseOrder({ shippingAddress: { ...baseOrder().shippingAddress, country: 'US' }, items: [] }), productModel());
  assert.equal(result.fulfillment.canCreateLabel, false);
  assert.equal(result.fulfillment.state, 'blocked_missing_customs');
  assert.match(result.fulfillment.reason, /no items/);
});

test('non-fulfillable states are explicit', () => {
  assert.equal(fulfilmentState({ paymentStatus: 'pending', status: 'processing' }).canCreateLabel, false);
  assert.equal(fulfilmentState({ paymentStatus: 'paid', status: 'shipped' }).canCreateLabel, false);
  assert.equal(fulfilmentState({ paymentStatus: 'paid', status: 'processing' }).canCreateLabel, true);
});
