// A label is a purchase: the card on the Canada Post profile is charged the moment Create Shipment succeeds.
// These tests run the real code against a stand-in for Canada Post (test/helpers/fakeCanadaPost.js) that follows the
// published Shipping/Rating specs and carries the prices Canada Post really quoted for the pending order's parcel.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/utils/canadaPostLabels');
const canadaPost = require('../src/utils/canadaPost');
const { orderStore } = require('./helpers/orderStore');
const { fakeCanadaPost, labelEnv, labelOrder, NUMBER, SHIPPING, BASE } = require('./helpers/fakeCanadaPost');
const Order = require('../src/models/Order');
const { syncShippedOrders } = require('../src/utils/trackingSync');
const { notifyShipment } = require('../src/utils/shippingNotifications');
const { customerOrderResponse } = require('../src/utils/customerOrders');

const NOW = new Date('2026-10-08T15:00:00Z');
const ADDRESS = labelOrder().shippingAddress;
const ADMIN = { _id: 'admin-1' };
const creates = (cp) => cp.calls.filter((c) => c.create);
const ratings = (cp) => cp.calls.filter((c) => c.url === `${BASE}/rating/v1/prices`);

// One order in a store, one fake Canada Post, and a `buy` that approves the standard Expedited Parcel price.
function harness({ order = {}, scenario = {}, env = {}, others = [] } = {}) {
  canadaPost.resetTokenCacheForTest();
  const store = orderStore([labelOrder(order), ...others]);
  const cp = fakeCanadaPost(scenario);
  const deps = { Order: store, fetchImpl: cp.fetchImpl, env: labelEnv(env), now: () => NOW, createTimeoutMs: 150 };
  return {
    store, cp, deps, order: () => store.store[0],
    buy: (args = {}) => L.buyLabel({ orderId: 'order-1', serviceCode: 'DOM.EP', signature: false, approvedDue: 19.16, admin: ADMIN, ...args }, deps),
    reconcile: () => L.reconcileLabel('order-1', deps),
    quote: () => L.quoteLabelOptions(store.store[0], deps),
  };
}
const refuses = async (promise, code, status) => {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof L.LabelError, `expected a LabelError, got ${err?.stack || err}`);
    assert.equal(err.code, code, err.message);
    if (status) assert.equal(err.status, status);
    return true;
  });
};

// ── Who can be priced / bought for ──────────────────────────────────────────────────
test('only a paid, unshipped Canadian order with a usable address can be priced; buying also needs the switch', () => {
  const ok = L.labelEligibility(labelOrder(), labelEnv(), NOW);
  assert.deepEqual([ok.canQuote, ok.canBuy, ok.switchedOff, ok.code], [true, true, false, null]);
  const off = L.labelEligibility(labelOrder(), labelEnv({ CANADA_POST_LABELS_ENABLED: 'false' }), NOW);
  assert.deepEqual([off.canQuote, off.canBuy, off.switchedOff], [true, false, true], 'prices are always allowed, buying is the switch');

  const refused = [
    ['unpaid', { paymentStatus: 'pending' }, 'not-eligible'],
    ['already shipped', { status: 'shipped' }, 'not-eligible'],
    ['cancelled', { status: 'cancelled' }, 'not-eligible'],
    ['going abroad', { shippingAddress: { ...ADDRESS, country: 'US' } }, 'outside-canada'],
    ['tracking saved by hand', { trackingNumber: '7023210039414604' }, 'has-tracking'],
    ['label already bought', { label: { status: 'created' } }, 'already-labelled'],
    ['purchase running now', { label: { status: 'creating', claimedAt: new Date(NOW - 30 * 1000) } }, 'in-progress'],
    ['purchase never reported back', { label: { status: 'creating', claimedAt: new Date(NOW - 10 * 60 * 1000) } }, 'unknown-outcome'],
    ['unclear answer last time', { label: { status: 'unknown' } }, 'unknown-outcome'],
    ['no street', { shippingAddress: { ...ADDRESS, line1: '' } }, 'bad-address'],
    ['US ZIP on a Canadian order', { shippingAddress: { ...ADDRESS, zip: '90210' } }, 'bad-address'],
    ['province spelled out', { shippingAddress: { ...ADDRESS, state: 'Manitoba' } }, 'bad-address'],
    ['no name', { shippingAddress: { ...ADDRESS, firstName: '', lastName: '' } }, 'bad-address'],
    ['no items', { items: [] }, 'odd-parcel'],
    ['41 sticks', { items: [{ name: 'x', qty: 41 }] }, 'odd-parcel'],
  ];
  for (const [name, change, code] of refused) {
    const result = L.labelEligibility(labelOrder(change), labelEnv(), NOW);
    assert.deepEqual([name, result.canQuote, result.canBuy, result.code], [name, false, false, code]);
    assert.ok(result.reason, `${name} says why`);
  }
  const unconfigured = L.labelEligibility(labelOrder(), labelEnv({ CANADA_POST_CUSTOMER_NUMBER: '' }), NOW);
  assert.deepEqual([unconfigured.canQuote, unconfigured.code], [false, 'not-configured']);
  assert.equal(L.labelEligibility(null, labelEnv(), NOW).code, 'not-found');
});

test('a failed purchase can be tried again, and a pending order is as good as a processing one', () => {
  assert.equal(L.labelEligibility(labelOrder({ label: { status: 'failed' } }), labelEnv(), NOW).canBuy, true);
  assert.equal(L.labelEligibility(labelOrder({ status: 'pending' }), labelEnv(), NOW).canBuy, true);
});

test('the destination is cleaned for the label: postal code, long street lines, phone', () => {
  const clean = L.destinationFromOrder(labelOrder({ shippingAddress: { ...ADDRESS, zip: ' r3w-1a1 ', phone: '(204) 555-0100 ext. 12' } }));
  assert.equal(clean.ok, true);
  assert.equal(clean.postalCode, 'R3W1A1');
  assert.equal(clean.destination.addressDetails.postalZipCode, 'R3W1A1');
  assert.equal(clean.destination.name, 'Pat Example');
  assert.match(clean.destination.clientVoiceNumber, /^\(204\) 555-0100/);

  const long = L.destinationFromOrder(labelOrder({ shippingAddress: { ...ADDRESS, line1: '1234 Extraordinarily Long Boulevard West Unit 5678, Suite 90' } }));
  assert.equal(long.ok, true, long.problems.join('; '));
  const { addressLine1, addressLine2 } = long.destination.addressDetails;
  assert.ok(addressLine1.length <= 44 && addressLine2.length <= 44);
  assert.equal(`${addressLine1} ${addressLine2}`, '1234 Extraordinarily Long Boulevard West Unit 5678, Suite 90', 'words keep their order and none is cut');

  const unsplittable = L.destinationFromOrder(labelOrder({ shippingAddress: { ...ADDRESS, line1: 'X'.repeat(50) } }));
  assert.equal(unsplittable.ok, false);
  const twoLines = L.destinationFromOrder(labelOrder({ shippingAddress: { ...ADDRESS, line1: `${'Y'.repeat(30)} ${'Z'.repeat(30)}`, line2: 'Apt 2' } }));
  assert.equal(twoLines.ok, false, 'a long line 1 is not squeezed into an already used line 2');
  const noPhone = L.destinationFromOrder(labelOrder({ shippingAddress: { ...ADDRESS, phone: '12' } }));
  assert.equal(noPhone.destination.clientVoiceNumber, undefined, 'a phone number Canada Post would refuse is left off, not sent');
});

test('the parcel follows the stick count and the return address must be complete', () => {
  assert.deepEqual(L.parcelForOrder(labelOrder({ items: [{ qty: 1 }, { qty: 1 }] })).parcel, { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } });
  assert.equal(L.parcelForOrder(labelOrder({ items: [{ qty: 3 }] })).parcel.weight, 0.9);
  assert.equal(L.parcelForOrder(labelOrder({ items: [{ qty: 2.5 }] })).ok, false, 'a fractional quantity is not a parcel');

  const sender = L.senderFromEnv(labelEnv({ CANADA_POST_ORIGIN_POSTAL_CODE: 'm5h 2n2' }));
  assert.equal(sender.ok, true);
  assert.equal(sender.sender.addressDetails.postalZipCode, 'M5H2N2');
  assert.equal(sender.sender.company, 'Reflexity RAM');
  const missing = L.senderFromEnv(labelEnv({ CANADA_POST_SENDER_PHONE: '', CANADA_POST_SENDER_PROVINCE: 'Ontario' }));
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['CANADA_POST_SENDER_PHONE', 'CANADA_POST_SENDER_PROVINCE']);
  assert.equal(L.senderFromEnv(labelEnv({ CANADA_POST_SENDER_ADDRESS1: 'A'.repeat(45) })).ok, false, 'over-long lines are caught before Canada Post refuses them');
});

// ── Prices: read-only ───────────────────────────────────────────────────────────────
test('the picker shows the real commercial prices for every service, with and without a signature, and buys nothing', async () => {
  const h = harness();
  const quote = await h.quote();
  assert.deepEqual(quote.options.map((o) => [o.serviceCode, o.due]), [['DOM.EP', 19.16], ['DOM.RP', 19.16], ['DOM.XP', 24.13], ['DOM.PC', 57.69]]);
  assert.deepEqual(quote.options.map((o) => o.withSignature.due), [21.26, 21.26, 26.23, 57.69], 'the signature costs $2.00 plus tax, and nothing on Priority');
  const ep = quote.options[0];
  assert.deepEqual([ep.preTax, ep.tax, ep.transitDays, ep.guaranteed, ep.expectedDeliveryDate], [18.25, 0.91, 3, true, '2026-10-14']);
  assert.deepEqual(quote.parcel, { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 }, sticks: 1 });
  assert.deepEqual(quote.recommended, { serviceCode: 'DOM.EP', signature: false });
  assert.deepEqual(quote.buyerPaid, { shipping: 14, service: 'Flat-rate shipping', signature: false });
  assert.equal(creates(h.cp).length, 0, 'asking for prices never creates a shipment');
  assert.equal(h.store.writes.length, 0, 'and never touches the order');

  const request = ratings(h.cp).find((c) => !c.body.options).body;
  assert.deepEqual([request.quoteType, request.customerNumber, request.originPostalCode, request.destination], ['commercial', NUMBER, 'M5H2N2', { domestic: { postalCode: 'R3W1A1' } }]);
  assert.deepEqual(request.parcelCharacteristics, { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } });
  assert.ok(ratings(h.cp).some((c) => c.body.options?.[0]?.optionCode === 'SO'), 'the signature prices are asked for too');
});

test('the service the buyer paid for is preselected', async () => {
  const faster = await harness({ order: { shippingMethod: 'Faster shipping: Xpresspost, typically 1–3 business days after dispatch', shippingCost: 26 } }).quote();
  assert.deepEqual(faster.recommended, { serviceCode: 'DOM.XP', signature: false });
  const signed = await harness({ order: { shippingMethod: 'Xpresspost + Signature on delivery' } }).quote();
  assert.deepEqual(signed.recommended, { serviceCode: 'DOM.XP', signature: true });
  assert.deepEqual(signed.buyerPaid.signature, true);
});

test('a signature price that Canada Post will not give does not hide the plain prices', async () => {
  const quote = await harness({ scenario: { rating: 'signature-error' } }).quote();
  assert.equal(quote.options.length, 4);
  assert.deepEqual(quote.options.map((o) => o.withSignature), [null, null, null, null]);
});

test('prices fail loudly and clearly, not with an empty picker', async () => {
  await refuses(harness({ scenario: { rating: 'error' } }).quote(), 'rating-failed', 502);
  await refuses(harness({ scenario: { rating: 'empty' } }).quote(), 'no-services', 502);
  await refuses(harness({ order: { paymentStatus: 'pending' } }).quote(), 'not-eligible', 409);
  await refuses(harness({ env: { CANADA_POST_CUSTOMER_NUMBER: '' } }).quote(), 'not-configured', 409);
});

// ── Buying ────────────────────────────────────────────────────────────────────────────
test('buying re-prices, claims the order, makes ONE Create Shipment call that matches what was approved, and stores the label', async () => {
  const h = harness();
  const result = await h.buy();

  const posts = creates(h.cp);
  assert.equal(posts.length, 1, 'exactly one purchase');
  const sent = posts[0].body;
  assert.equal(posts[0].url, `${SHIPPING}/${NUMBER}/${NUMBER}/shipments`);
  assert.equal(posts[0].headers.Authorization, 'Bearer test-token');
  assert.deepEqual(
    [sent.customerRequestId, sent.transmitShipment, sent.groupId, sent.requestedShippingPoint, sent.providePricingInfo, sent.provideReceiptInfo],
    ['RFX-TEST-000001', true, undefined, 'M5H2N2', true, true],
    'the order number is the request id; transmitShipment excludes groupId',
  );
  const spec = sent.deliverySpec;
  assert.equal(spec.serviceCode, 'DOM.EP');
  assert.equal(spec.options, undefined, 'no signature unless asked for');
  assert.deepEqual(spec.parcelCharacteristics, { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } });
  assert.deepEqual(spec.destination.addressDetails, { addressLine1: '123 Example Avenue', city: 'Winnipeg', provState: 'MB', countryCode: 'CA', postalZipCode: 'R3W1A1' });
  assert.equal(spec.destination.name, 'Pat Example');
  assert.deepEqual(spec.sender.addressDetails, { addressLine1: '1 Example Street', city: 'Toronto', provState: 'ON', countryCode: 'CA', postalZipCode: 'M5H2N2' });
  assert.deepEqual([spec.sender.company, spec.sender.contactPhone], ['Reflexity RAM', '416-555-0100']);
  assert.deepEqual(spec.settlementInfo, { intendedMethodOfPayment: 'CreditCard' });
  assert.equal(spec.references.customerRef1, 'RFX-TEST-000001');
  assert.equal(spec.notification, undefined, 'Canada Post sends the buyer nothing: the shop emails them itself');

  // The live price was checked first, and only then was the shipment created.
  const order = h.cp.calls.map((c) => (c.create ? 'create' : c.url === `${BASE}/rating/v1/prices` ? 'rate' : 'other'));
  assert.ok(order.indexOf('rate') >= 0 && order.indexOf('rate') < order.indexOf('create'), order.join(','));
  assert.deepEqual(ratings(h.cp)[0].body.services, ['DOM.EP'], 'the re-quote is for the one service being bought');

  const doc = h.order();
  assert.equal(doc.label.status, 'created');
  assert.equal(doc.trackingNumber, '123456789012', 'the number lands where the tracking sync and the buyer pages read it');
  assert.equal(doc.status, 'processing', 'buying a label is not shipping');
  assert.equal(doc.shippingNotification, undefined, 'nothing is emailed until Canada Post scans the parcel');
  assert.deepEqual(doc.label.price, { preTax: 18.25, tax: 0.91, due: 19.16, charged: 19.16 });
  assert.deepEqual([doc.label.serviceCode, doc.label.serviceName, doc.label.signature, doc.label.approvedDue, doc.label.approvedBy], ['DOM.EP', 'Expedited Parcel', false, 19.16, 'admin-1']);
  assert.equal(doc.label.shipmentId, 'ship-001');
  assert.equal(doc.label.cardType, 'VI');
  assert.match(doc.label.artifactUrl, /\/shipping\/v1\/artifacts\//);
  assert.equal(doc.statusHistory.at(-1).note, 'Shipping label bought (Expedited Parcel, CA$19.16)');
  assert.equal(doc.statusHistory.at(-1).status, 'processing');

  assert.equal(result.mismatch, null);
  assert.equal(result.label.status, 'created');
  assert.equal(result.label.trackingPin, '123456789012');
  assert.doesNotMatch(JSON.stringify(result), /https?:|artifact/i, 'what goes back to the browser carries no Canada Post link');
});

test('a signature purchase asks for the signature option in both the quote and the shipment', async () => {
  const h = harness();
  await h.buy({ signature: true, approvedDue: 21.26 });
  assert.deepEqual(creates(h.cp)[0].body.deliverySpec.options, [{ optionCode: 'SO' }]);
  assert.deepEqual(ratings(h.cp)[0].body.options, [{ optionCode: 'SO' }]);
  assert.equal(h.order().label.signature, true);
  assert.equal(h.order().label.price.due, 21.26);
});

test('Xpresspost and Priority can be bought at exactly the prices that were shown', async () => {
  for (const [serviceCode, approvedDue, name] of [['DOM.XP', 24.13, 'Xpresspost'], ['DOM.PC', 57.69, 'Priority'], ['DOM.RP', 19.16, 'Regular Parcel']]) {
    const h = harness();
    await h.buy({ serviceCode, approvedDue });
    assert.equal(creates(h.cp)[0].body.deliverySpec.serviceCode, serviceCode);
    assert.equal(h.order().label.serviceName, name);
  }
});

test('if Canada Post charges something other than the approved price the purchase still stands and the difference is reported', async () => {
  const h = harness({ scenario: { charged: 20.5 } });
  const result = await h.buy();
  assert.deepEqual(result.mismatch, { approved: 19.16, charged: 20.5 });
  assert.equal(h.order().label.status, 'created');
  assert.equal(h.order().label.price.charged, 20.5);
});

// ── Nothing is bought unless every check passes ────────────────────────────────────────
const untouched = (h, why) => {
  assert.equal(creates(h.cp).length, 0, `${why}: no shipment was created`);
  assert.equal(h.store.writes.length, 0, `${why}: the order was not even claimed`);
  assert.equal(h.order().label, undefined, why);
};

test('a price that moved since it was shown is refused, with the new price, before anything is claimed or bought', async () => {
  const h = harness();
  await assert.rejects(h.buy({ approvedDue: 18.0 }), (err) => {
    assert.equal(err.code, 'price-changed');
    assert.equal(err.status, 409);
    assert.equal(err.extra.quote.due, 19.16);
    assert.match(err.message, /\$18\.00 to \$19\.16/);
    return true;
  });
  untouched(h, 'price moved');
  // Rounding cannot slip through: one cent off is a different price.
  await refuses(h.buy({ approvedDue: 19.17 }), 'price-changed');
  await refuses(h.buy({ approvedDue: 19.15 }), 'price-changed');
  untouched(h, 'one cent off');
});

test('the approved price for one service cannot be spent on another or on a signature that was not approved', async () => {
  const h = harness();
  await refuses(h.buy({ serviceCode: 'DOM.PC', approvedDue: 19.16 }), 'price-changed');
  await refuses(h.buy({ signature: true, approvedDue: 19.16 }), 'price-changed');
  untouched(h, 'wrong price for the choice');
});

test('the limit applies to the live price, and the owner can raise or lower it', async () => {
  const low = harness({ env: { CANADA_POST_LABEL_MAX_DUE: '15' } });
  await refuses(low.buy(), 'over-cap', 409);
  untouched(low, 'limit 15');
  const high = harness({ env: { CANADA_POST_LABEL_MAX_DUE: '100' } });
  const priority = await high.buy({ serviceCode: 'DOM.PC', approvedDue: 57.69 });
  assert.equal(priority.label.status, 'created');
  const fallback = harness({ env: { CANADA_POST_LABEL_MAX_DUE: 'not a number' } });
  await fallback.buy();
  assert.equal(creates(fallback.cp).length, 1, 'an unreadable limit falls back to the default instead of blocking or opening everything');
});

test('a day of purchases is capped', async () => {
  const bought = (n) => labelOrder({ _id: `other-${n}`, orderNumber: `RFX-OTHER-${n}`, label: { status: 'created', createdAt: new Date(NOW - n * 60 * 1000) } });
  const h = harness({ env: { CANADA_POST_LABEL_DAILY_LIMIT: '2' }, others: [bought(1), bought(2)] });
  await refuses(h.buy(), 'daily-limit', 429);
  untouched(h, 'daily limit');
  const older = harness({ env: { CANADA_POST_LABEL_DAILY_LIMIT: '2' }, others: [bought(1), labelOrder({ _id: 'old', orderNumber: 'RFX-OLD', label: { status: 'created', createdAt: new Date(NOW - 25 * 60 * 60 * 1000) } })] });
  await older.buy();
  assert.equal(creates(older.cp).length, 1, 'purchases from more than 24 hours ago do not count');
});

test('with the switch off nothing at all is sent to Canada Post', async () => {
  const h = harness({ env: { CANADA_POST_LABELS_ENABLED: '' } });
  await refuses(h.buy(), 'not-enabled', 403);
  assert.equal(h.cp.calls.length, 0);
  untouched(h, 'switched off');
});

test('bad input is refused before any call', async () => {
  const h = harness();
  await refuses(h.buy({ serviceCode: 'DOM.XX' }), 'bad-service', 400);
  await refuses(h.buy({ serviceCode: undefined }), 'bad-service', 400);
  await refuses(h.buy({ approvedDue: undefined }), 'bad-amount', 400);
  await refuses(h.buy({ approvedDue: 0 }), 'bad-amount', 400);
  await refuses(h.buy({ approvedDue: '19.16abc' }), 'bad-amount', 400);
  assert.equal(h.cp.calls.length, 0);
  untouched(h, 'bad input');
});

test('orders that must not get a label are refused before any call', async () => {
  for (const [change, code] of [
    [{ paymentStatus: 'pending' }, 'not-eligible'], [{ status: 'shipped' }, 'not-eligible'],
    [{ shippingAddress: { ...ADDRESS, country: 'GB' } }, 'outside-canada'], [{ trackingNumber: 'ABC123456789' }, 'has-tracking'],
    [{ label: { status: 'created' } }, 'already-labelled'], [{ label: { status: 'unknown' } }, 'unknown-outcome'],
  ]) {
    const h = harness({ order: change });
    await refuses(h.buy(), code, 409);
    assert.equal(h.cp.calls.length, 0, code);
    assert.equal(creates(h.cp).length, 0);
  }
  const h = harness();
  await refuses(L.buyLabel({ orderId: 'nope', serviceCode: 'DOM.EP', approvedDue: 19.16, admin: ADMIN }, h.deps), 'not-found', 409);
  assert.equal(h.cp.calls.length, 0);
});

test('without a complete return address nothing is bought', async () => {
  const h = harness({ env: { CANADA_POST_SENDER_ADDRESS1: '' } });
  await assert.rejects(h.buy(), (err) => err.code === 'sender-missing' && err.status === 503 && /CANADA_POST_SENDER_ADDRESS1/.test(err.message));
  untouched(h, 'no return address');
});

test('Canada Post not offering the service, or not pricing it, stops the purchase', async () => {
  const unavailable = harness({ scenario: { rating: 'empty' } });
  await refuses(unavailable.buy(), 'service-unavailable', 409);
  untouched(unavailable, 'service unavailable');
  const broken = harness({ scenario: { rating: 'error' } });
  await refuses(broken.buy(), 'rating-failed', 502);
  untouched(broken, 'rating failed');
});

test('a second purchase for a bought order is refused, even if the screen is stale', async () => {
  const h = harness();
  await h.buy();
  await refuses(h.buy(), 'already-labelled', 409);
  assert.equal(creates(h.cp).length, 1);
});

test('two clicks at once buy one label', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.buy(), h.buy(), h.buy()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(creates(h.cp).length, 1, 'only the winner of the claim reached Canada Post');
  for (const loser of results.filter((r) => r.status === 'rejected')) assert.equal(loser.reason.code, 'in-progress');
  assert.equal(h.order().label.status, 'created');
});

test('even if every local guard were bypassed, Canada Post itself refuses a second shipment for the same order', async () => {
  const h = harness();
  await h.buy();
  // Put the order back as if nothing had happened and try again: the request id is the order number.
  delete h.order().label;
  delete h.order().trackingNumber;
  await assert.rejects(h.buy(), (err) => err.code === 'unknown-outcome', 'a duplicate-id refusal is "check first", not "nothing was charged"');
  assert.equal(h.cp.seenRequestIds.size, 1);
  assert.equal(h.order().label.status, 'unknown');
});

// ── When Canada Post does not simply say yes ──────────────────────────────────────────
test('a clean refusal charges nothing, is recorded, and the purchase can be tried again', async () => {
  const h = harness({ scenario: { create: 'reject' } });
  await assert.rejects(h.buy(), (err) => err.code === 'canada-post-rejected' && err.status === 502 && /Service not available/.test(err.message) && /Nothing was charged/.test(err.message));
  assert.equal(h.order().label.status, 'failed');
  assert.deepEqual([h.order().label.error.code, h.order().label.error.message], ['9111', 'Service not available']);
  assert.equal(h.order().trackingNumber, undefined);
  assert.equal(L.labelEligibility(h.order(), h.deps.env, NOW).canBuy, true, 'a refused attempt does not lock the order');

  h.cp.scenario.create = 'ok';
  const retry = await h.buy();
  assert.equal(retry.label.status, 'created');
  assert.equal(h.order().label.error, undefined, 'the old refusal is cleared by the successful purchase');
  assert.equal(creates(h.cp).length, 2, 'one refused, one bought');
});

test('an unclear answer (server error, dropped connection, unreadable reply, silence) locks the order until Canada Post is asked', async () => {
  for (const scenario of [{ create: 'server-error' }, { create: 'network' }, { create: 'unreadable' }, { create: 'hang' }]) {
    const h = harness({ scenario });
    await assert.rejects(h.buy(), (err) => err.code === 'unknown-outcome' && err.status === 502 && /Check with Canada Post/.test(err.message), JSON.stringify(scenario));
    assert.equal(h.order().label.status, 'unknown', JSON.stringify(scenario));
    assert.equal(h.order().trackingNumber, undefined, 'no number is invented');
    await refuses(h.buy(), 'unknown-outcome', 409);
    assert.equal(creates(h.cp).length, 1, `${JSON.stringify(scenario)}: a second click did not buy a second label`);
  }
});

test('a request id Canada Post says it already holds is "check first", never "nothing was charged"', async () => {
  const h = harness({ scenario: { create: 'duplicate' } });
  await refuses(h.buy(), 'unknown-outcome', 502);
  assert.equal(h.order().label.status, 'unknown');
});

test('a reply without a tracking number keeps the order locked and says the label was bought', async () => {
  const h = harness({ scenario: { create: 'no-pin' } });
  await assert.rejects(h.buy(), (err) => err.code === 'no-tracking-number' && /was bought/.test(err.message));
  assert.equal(h.order().label.status, 'unknown');
  assert.equal(h.order().label.shipmentId, 'ship-001', 'what Canada Post did return is kept');
  assert.equal(h.order().trackingNumber, undefined);
});

test('a suspended shipment is not a usable label: its number is not put on the order', async () => {
  const h = harness({ scenario: { create: 'suspended' } });
  await assert.rejects(h.buy(), (err) => err.code === 'shipment-suspended' && /suspended/.test(err.message));
  assert.equal(h.order().label.status, 'unknown');
  assert.equal(h.order().label.shipmentStatus, 'suspended');
  assert.equal(h.order().trackingNumber, undefined, 'the tracking sync must not watch a parcel that cannot ship');
});

test('if the purchase succeeds but the order cannot be saved, the error carries the tracking number', async () => {
  const h = harness();
  const real = h.store.findOneAndUpdate;
  let calls = 0;
  h.deps.Order = { ...h.store, findOneAndUpdate: (...args) => (++calls === 1 ? real(...args) : { then: (resolve) => resolve(null) }) };
  await assert.rejects(h.buy(), (err) => err.code === 'save-failed' && /123456789012/.test(err.message) && /ship-001/.test(err.message));
  assert.equal(calls, 3, 'claim, save, one more try');
  assert.equal(creates(h.cp).length, 1);
});

test('an order that changes while the price is being looked up is not bought: the claim re-checks it atomically', async () => {
  for (const [name, change] of [
    ['tracking saved by hand', (doc) => { doc.trackingNumber = 'SAVED-BY-HAND-1'; }],
    ['order shipped', (doc) => { doc.status = 'shipped'; }],
    ['order cancelled', (doc) => { doc.status = 'cancelled'; }],
    ['payment refunded', (doc) => { doc.paymentStatus = 'refunded'; }],
  ]) {
    const h = harness();
    const realFetch = h.cp.fetchImpl;
    h.deps.fetchImpl = async (url, init) => {
      const answer = await realFetch(url, init);
      if (String(url).endsWith('/rating/v1/prices')) change(h.order()); // between the check and the claim
      return answer;
    };
    await refuses(h.buy(), 'in-progress', 409);
    assert.equal(creates(h.cp).length, 0, name);
    assert.equal(h.order().label, undefined, name);
  }
});

// ── Asking Canada Post what happened ───────────────────────────────────────────────────
async function unknownOrder(scenario = {}) {
  const h = harness({ scenario: { create: 'server-error', processedAnyway: true, ...scenario } });
  await assert.rejects(h.buy(), (err) => err.code === 'unknown-outcome');
  h.cp.calls.length = 0;
  return h;
}

test('after an unclear answer, "Check with Canada Post" finds the shipment and completes the order', async () => {
  for (const lookup of ['found', 'wrapped']) {
    const h = await unknownOrder({ lookup });
    const result = await h.reconcile();
    assert.equal(result.found, true, lookup);
    assert.equal(h.order().label.status, 'created');
    assert.equal(h.order().trackingNumber, '123456789012');
    assert.equal(h.order().label.shipmentId, 'ship-001');
    assert.equal(h.order().label.price.due, 19.16, 'the approved price is kept for the record');
    assert.equal(h.order().label.error, undefined);
    assert.equal(creates(h.cp).length, 0, 'asking never buys');
    const search = h.cp.calls.find((c) => c.lookup);
    const query = new URL(search.url).searchParams;
    assert.deepEqual([query.get('request-id'), query.get('no-manifest'), query.get('date')], ['RFX-TEST-000001', 'true', '20261007'], 'searches from the day before the claim');
    assert.equal(search.headers.Authorization, 'Bearer test-token');
  }
});

test('"Check with Canada Post" only says nothing was charged when Canada Post says there is no shipment', async () => {
  for (const lookup of ['none', 'not-found']) {
    const h = await unknownOrder({ lookup, processedAnyway: false });
    const result = await h.reconcile();
    assert.equal(result.found, false, lookup);
    assert.match(result.message, /no shipment.*nothing was charged/i);
    assert.equal(h.order().label.status, 'failed', 'and the order can be bought again');
    assert.equal(L.labelEligibility(h.order(), h.deps.env, NOW).canBuy, true);
  }
});

test('an answer that is not an answer leaves the order exactly as it was', async () => {
  for (const lookup of ['error', 'accepted', 'garbled']) {
    const h = await unknownOrder({ lookup });
    const before = structuredClone(h.order());
    await refuses(h.reconcile(), 'lookup-failed', 502);
    assert.deepEqual(h.order(), before, lookup);
    assert.equal(h.order().label.status, 'unknown');
  }
});

test('a wrongly negative lookup still cannot cause a second label, because Canada Post refuses the repeated request id', async () => {
  const h = await unknownOrder({ lookup: 'none' }); // the shipment exists (processedAnyway) but the search misses it
  assert.equal((await h.reconcile()).found, false);
  await assert.rejects(h.buy(), (err) => err.code === 'unknown-outcome');
  assert.equal(h.cp.seenRequestIds.size, 1, 'Canada Post holds exactly one shipment for the order');
});

test('there is nothing to check unless a purchase is unfinished, and a stale claim counts as unfinished', async () => {
  const fresh = harness();
  await refuses(fresh.reconcile(), 'nothing-to-check', 409);
  const done = harness();
  await done.buy();
  await refuses(done.reconcile(), 'nothing-to-check', 409);
  const running = harness({ order: { label: { status: 'creating', requestId: 'RFX-TEST-000001', claimedAt: new Date(NOW - 20 * 1000) } } });
  await refuses(running.reconcile(), 'nothing-to-check', 409);
  const stale = harness({ order: { label: { status: 'creating', requestId: 'RFX-TEST-000001', claimedAt: new Date(NOW - 10 * 60 * 1000), approvedDue: 19.16, serviceName: 'Expedited Parcel' } } });
  assert.equal((await stale.reconcile()).found, true);
  await refuses(harness({ env: { CANADA_POST_CUSTOMER_NUMBER: '' }, order: { label: { status: 'unknown' } } }).reconcile(), 'not-configured', 503);
  await refuses(L.reconcileLabel('missing', fresh.deps), 'not-found', 404);
});

// ── The label itself ───────────────────────────────────────────────────────────────────
test('the label PDF is downloaded from Canada Post on request, with the token, and nothing is stored here', async () => {
  const h = harness();
  await h.buy();
  h.cp.calls.length = 0;
  const { bytes, filename } = await L.fetchLabelPdf(h.order(), { fetchImpl: h.cp.fetchImpl, env: h.deps.env });
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(filename, 'label-RFX-TEST-000001.pdf');
  assert.equal(h.cp.calls.length, 1);
  assert.equal(h.cp.calls[0].headers.Accept, 'application/pdf');
  assert.equal(h.cp.calls[0].headers.Authorization, 'Bearer test-token');
});

test('the label link is only followed on the Shipping API host, never wherever a stored or returned link points', async () => {
  const h = harness();
  await h.buy();
  for (const evil of ['https://evil.example/shipping/v1/artifacts/x/0', 'http://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/shipping/v1/artifacts/x/0',
    `${BASE}/tracking/v1/pins/1/details`, 'https://api.canadapost-postescanada.ca.evil.example/prod/devportal-portaildesdeveloppeurs/shipping/v1/a', 'javascript:alert(1)']) {
    h.cp.calls.length = 0;
    const order = { ...h.order(), label: { ...h.order().label, artifactUrl: evil } };
    const { bytes } = await L.fetchLabelPdf(order, { fetchImpl: h.cp.fetchImpl, env: h.deps.env });
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', evil);
    assert.ok(h.cp.calls.every((c) => c.url.startsWith(`${SHIPPING}/`)), `${evil} -> ${h.cp.calls.map((c) => c.url).join(' ')}`);
  }
  assert.equal(L.trustedShippingLink(`${SHIPPING}/artifacts/1/shipping/2/0`), `${SHIPPING}/artifacts/1/shipping/2/0`);
  assert.equal(L.pickLabelLink([{ rel: 'label', href: 'https://evil.example/x', mediaType: 'application/pdf' }]), null);
  const links = [{ rel: 'returnLabel', href: `${SHIPPING}/artifacts/1/shipping/ret/0`, mediaType: 'application/pdf' }, { rel: 'label', href: `${SHIPPING}/artifacts/1/shipping/lab/0`, mediaType: 'application/pdf' }];
  assert.match(L.pickLabelLink(links), /\/lab\/0$/, 'the return label is never mistaken for the label');
});

test('the PDF route refuses non-PDF answers and orders without a label', async () => {
  const h = harness();
  await h.buy();
  const html = fakeCanadaPost({ pdf: Buffer.from('<html>login</html>') });
  await refuses(L.fetchLabelPdf(h.order(), { fetchImpl: html.fetchImpl, env: h.deps.env }), 'pdf-failed', 502);
  await refuses(L.fetchLabelPdf(labelOrder(), { fetchImpl: h.cp.fetchImpl, env: h.deps.env }), 'no-label', 404);
  await refuses(L.fetchLabelPdf(labelOrder({ label: { status: 'unknown' } }), { fetchImpl: h.cp.fetchImpl, env: h.deps.env }), 'no-label', 404);
});

test('the label link is found again from the shipment when it was not stored', async () => {
  const h = harness();
  await h.buy();
  const order = { ...h.order(), label: { ...h.order().label, artifactUrl: undefined } };
  h.cp.calls.length = 0;
  const { bytes } = await L.fetchLabelPdf(order, { fetchImpl: h.cp.fetchImpl, env: h.deps.env });
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(h.cp.calls.length, 2, 'shipment, then artifact');
});

test('what the admin screens may see of a label has no links and no internals', () => {
  const view = L.labelView({
    status: 'created', serviceName: 'Expedited Parcel', serviceCode: 'DOM.EP', signature: false, trackingPin: '123456789012', shipmentId: 's1',
    artifactUrl: 'https://x.example/a', approvedBy: 'admin-1', requestId: 'RFX', price: { due: 19.16 }, cardType: 'VI', error: { code: '1', message: 'm', at: new Date() },
  });
  assert.deepEqual(Object.keys(view).sort(), ['cardType', 'claimedAt', 'createdAt', 'error', 'price', 'serviceCode', 'serviceName', 'shipmentId', 'signature', 'status', 'trackingPin']);
  assert.deepEqual(view.error, { code: '1', message: 'm' });
  assert.equal(L.labelView(undefined), null);
  assert.equal(L.labelView({}), null);
});

// ── What happens after the purchase: the tracking system the shop already has ───────────
async function withOrderStatics(store, run) {
  const originals = { find: Order.find, updateOne: Order.updateOne, findOneAndUpdate: Order.findOneAndUpdate };
  Object.assign(Order, { find: store.find, updateOne: store.updateOne, findOneAndUpdate: store.findOneAndUpdate });
  try { await run(); } finally { Object.assign(Order, originals); }
}

test('a bought label hands the order to the tracking system: the buyer hears nothing until Canada Post scans the parcel, then exactly once', async () => {
  const h = harness({ order: { guestEmail: 'buyer@example.com' } });
  await h.buy();
  const labelOnly = canadaPost.normalizeTracking({}, { significantEvents: [{ eventDescription: 'Electronic information submitted by shipper', eventDate: '2026-10-08' }] });
  const accepted = canadaPost.normalizeTracking({}, { significantEvents: [{ eventIdentifier: '1302', eventDescription: 'Item accepted at the Post Office', eventDate: '2026-10-08' }] });
  const mails = [];
  let later = 0;
  const sync = (tracking) => syncShippedOrders({
    trackParcel: async (pin) => { assert.equal(pin, '123456789012', 'the sync watches the number the label gave'); return tracking; },
    now: () => new Date(NOW.getTime() + (later += 20 * 60 * 1000)),
    scheduleReview: async () => {},
    sendEmail: async (m) => mails.push(m.kind),
    notifyShipment: (order, opts) => notifyShipment(order, { ...opts, sendEmail: async (m) => mails.push({ shipped: m.order.trackingNumber }) }),
  });

  await withOrderStatics(h.store, async () => {
    assert.equal((await sync(labelOnly)).checked, 1);
    assert.equal(h.order().status, 'processing', 'a label is not a shipment');
    assert.deepEqual(mails, [], 'no email for a parcel nobody has handed over');

    assert.equal((await sync(accepted)).checked, 1);
    assert.equal(h.order().status, 'shipped', 'Canada Post accepted the parcel');
    assert.deepEqual(mails, [{ shipped: '123456789012' }], 'the buyer is told once, with the number from the label');

    await sync(accepted);
    await sync(accepted);
    assert.equal(mails.length, 1, 'later runs do not repeat it');
    assert.equal(h.order().shippingNotification.status, 'sent');
  });
});

test('nothing about the label is visible to the buyer except the tracking number', async () => {
  const h = harness({ order: { guestEmail: 'buyer@example.com' } });
  await h.buy({ signature: true, approvedDue: 21.26 });
  const view = customerOrderResponse(h.order());
  assert.equal(view.trackingNumber, '123456789012');
  assert.equal('label' in view, false);
  assert.deepEqual(view.statusHistory.map((entry) => Object.keys(entry).sort()), [['status', 'timestamp']], 'the internal note with the postage price stays private');
  assert.doesNotMatch(JSON.stringify(view), /19\.16|21\.26|artifact|ship-001|approved/i);
});
