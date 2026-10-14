const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Order = require('../src/models/Order');
const { ORDER_PAYMENT_INDEXES, ensureOrderPaymentIndexes } = require('../src/migrations/ensureOrderPaymentIndexes');

const PI = ORDER_PAYMENT_INDEXES.find((spec) => spec.field === 'stripePaymentIntentId');
const SESSION = ORDER_PAYMENT_INDEXES.find((spec) => spec.field === 'stripeCheckoutSessionId');

// What production has today (read 2026-10-14): a PLAIN index on the PaymentIntent and the unique sparse one on the session.
const productionIndexes = () => [
  { name: '_id_', key: { _id: 1 } },
  { name: 'orderNumber_1', key: { orderNumber: 1 }, unique: true },
  { name: 'stripePaymentIntentId_1', key: { stripePaymentIntentId: 1 } },
  { name: 'stripeCheckoutSessionId_1', key: { stripeCheckoutSessionId: 1 }, unique: true, sparse: true },
];

// A collection that behaves like the three calls the migration makes. `duplicates` is what the duplicate scan answers per field.
function fakeOrders({ indexes = productionIndexes(), duplicates = {}, createFails = {} } = {}) {
  const calls = { created: [], scans: [] };
  const collection = {
    listIndexes: () => ({ toArray: async () => indexes.map((index) => ({ ...index })) }),
    aggregate: (pipeline) => {
      const field = Object.keys(pipeline[0].$match)[0];
      calls.scans.push(field);
      return { toArray: async () => (duplicates[field] || []).map((value) => ({ _id: value, orders: 2 })) };
    },
    createIndex: async (key, options) => {
      const field = Object.keys(key)[0];
      if (createFails[field]) throw new Error(createFails[field]);
      calls.created.push({ key, options });
      indexes.push({ name: options.name, key, unique: options.unique, partialFilterExpression: options.partialFilterExpression, sparse: options.sparse });
      return options.name;
    },
  };
  return { OrderModel: { collection }, calls, indexes };
}
const quiet = () => {
  const lines = { log: [], error: [] };
  return { logger: { log: (m) => lines.log.push(m), error: (m) => lines.error.push(m) }, lines };
};

test('production today: the PaymentIntent index is built beside the plain one, the session index is left alone, nothing is dropped', async () => {
  const fake = fakeOrders();
  const { logger, lines } = quiet();
  const result = await ensureOrderPaymentIndexes({ ...fake, logger });

  assert.deepEqual(result, { present: ['stripeCheckoutSessionId'], created: ['stripePaymentIntentId_unique'], skipped: [], failed: [] });
  assert.equal(fake.calls.created.length, 1);
  assert.deepEqual(fake.calls.created[0].key, { stripePaymentIntentId: 1 });
  assert.equal(fake.calls.created[0].options.name, 'stripePaymentIntentId_unique', 'its own name: the plain stripePaymentIntentId_1 is not touched');
  assert.equal(fake.calls.created[0].options.unique, true);
  assert.deepEqual(fake.calls.created[0].options.partialFilterExpression, { stripePaymentIntentId: { $type: 'string' } });
  assert.equal('sparse' in fake.calls.created[0].options, false, 'partial and sparse cannot be combined');
  assert.ok(fake.indexes.some((index) => index.name === 'stripePaymentIntentId_1' && !index.unique), 'the legacy plain index is still there');
  assert.equal(lines.error.length, 0);
  assert.match(lines.log.join('\n'), /stripePaymentIntentId_unique built/);
});

test('a second start builds nothing and scans nothing (a unique index on the field counts, whatever it is called)', async () => {
  const fake = fakeOrders();
  await ensureOrderPaymentIndexes({ ...fake, logger: quiet().logger });
  fake.calls.created.length = 0;
  fake.calls.scans.length = 0;
  const again = await ensureOrderPaymentIndexes({ ...fake, logger: quiet().logger });
  assert.deepEqual(again, { present: ['stripePaymentIntentId', 'stripeCheckoutSessionId'], created: [], skipped: [], failed: [] });
  assert.deepEqual(fake.calls.created, []);
  assert.deepEqual(fake.calls.scans, [], 'no duplicate scan when the guard is already there');
});

test('two orders with the same PaymentIntent: the index is NOT built, the values are named, no order is touched, the server is not stopped', async () => {
  const fake = fakeOrders({ duplicates: { stripePaymentIntentId: ['pi_twice'] } });
  const { logger, lines } = quiet();
  const result = await ensureOrderPaymentIndexes({ ...fake, logger });

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped, [{ field: 'stripePaymentIntentId', reason: 'duplicates', values: ['pi_twice'] }]);
  assert.deepEqual(fake.calls.created, []);
  assert.match(lines.error.join('\n'), /NOT built.*stripePaymentIntentId \(pi_twice\)/);
});

test('a fresh database gets both unique indexes, under the names the model uses', async () => {
  const fake = fakeOrders({ indexes: [{ name: '_id_', key: { _id: 1 } }] });
  const result = await ensureOrderPaymentIndexes({ ...fake, logger: quiet().logger });
  assert.deepEqual(result.created, ['stripePaymentIntentId_unique', 'stripeCheckoutSessionId_1']);
  assert.deepEqual(fake.calls.created[1].options, { name: 'stripeCheckoutSessionId_1', unique: true, sparse: true });
});

test('a name already used by a non-unique index is reported and left alone, never overwritten', async () => {
  const fake = fakeOrders({ indexes: [...productionIndexes(), { name: 'stripePaymentIntentId_unique', key: { stripePaymentIntentId: 1, createdAt: 1 } }] });
  const { logger, lines } = quiet();
  const result = await ensureOrderPaymentIndexes({ ...fake, logger });
  assert.deepEqual(result.skipped, [{ field: 'stripePaymentIntentId', reason: 'name-taken' }]);
  assert.deepEqual(fake.calls.created, []);
  assert.match(lines.error.join('\n'), /stripePaymentIntentId_unique exists but is not a unique index/);
});

test('a database error is logged and returned, never thrown, and the next index is still tried', async () => {
  const fake = fakeOrders({ indexes: [{ name: '_id_', key: { _id: 1 } }], createFails: { stripePaymentIntentId: 'not authorized' } });
  const { logger, lines } = quiet();
  const result = await ensureOrderPaymentIndexes({ ...fake, logger });
  assert.deepEqual(result.failed, [{ field: 'stripePaymentIntentId', error: 'not authorized' }]);
  assert.deepEqual(result.created, ['stripeCheckoutSessionId_1']);
  assert.match(lines.error.join('\n'), /stripePaymentIntentId_unique could not be built: not authorized/);
});

test('the model declares exactly what the migration builds, so a fresh database and production end up the same', () => {
  const declared = Order.schema.indexes();
  for (const spec of ORDER_PAYMENT_INDEXES) {
    const entry = declared.find(([key]) => Object.keys(key).length === 1 && key[spec.field] === 1);
    assert.ok(entry, `Order.js declares an index on ${spec.field}`);
    const [key, options] = entry;
    assert.deepEqual(key, { [spec.field]: 1 });
    const { name = `${spec.field}_1`, ...rest } = options;
    const { background, ...specRest } = rest;
    assert.equal(name, spec.name);
    assert.deepEqual(specRest, spec.options);
  }
});

test('startup builds them through the migration only: the general index pass still skips the payment indexes and the check stays read-only', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /const \{ ensureOrderPaymentIndexes \} = require\('\.\/migrations\/ensureOrderPaymentIndexes'\)/);
  assert.match(server, /toCreate: startupIndexDeclarations\(model\)[\s\S]*?await ensureOrderPaymentIndexes\(\);[\s\S]*?Order\.collection\.indexes\(\)[\s\S]*?app\.listen/);
  assert.match(server, /paymentProviderOrderIndexFields = new Set\(\[\s*'stripePaymentIntentId',\s*'stripeCheckoutSessionId',?\s*\]\)/);
  const migration = fs.readFileSync(path.join(__dirname, '../src/migrations/ensureOrderPaymentIndexes.js'), 'utf8');
  assert.doesNotMatch(migration, /dropIndex|dropIndexes|deleteOne|deleteMany|updateOne|updateMany|collMod/, 'it only ever adds an index');
});

test('a PaymentIntent that shows up twice is answered with the existing order, and anything else that collides is not swallowed', () => {
  const stripe = fs.readFileSync(path.join(__dirname, '../src/routes/stripe.js'), 'utf8');
  assert.match(stripe, /\$or: \[\{ stripeCheckoutSessionId: session\.id \}, \.\.\.\(intentId \? \[\{ stripePaymentIntentId: intentId \}\] : \[\]\)\]/);
  assert.match(stripe, /if \(!existingAfterRace\) throw createErr;/);
});
