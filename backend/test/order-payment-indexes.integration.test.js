// Runs against a REAL MongoDB (skipped unless MONGODB_TEST_URI is set, like payments-mongo.integration.test.js; the recipe for a
// throw-away replica set is in that file's header). It drops the two databases it makes, named rfx_order_indexes_*.
// What it proves that the unit test cannot: MongoDB really lets the partial unique index sit beside production's plain index of
// the same key, really refuses a second order with the same PaymentIntent, and still takes any number of orders without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_TEST_URI;
const skip = URI ? false : 'set MONGODB_TEST_URI to a throw-away MongoDB to run this';

const Order = require('../src/models/Order');
const { ensureOrderPaymentIndexes } = require('../src/migrations/ensureOrderPaymentIndexes');

const silent = { log() {}, error() {} };
const line = (n, extra = {}) => ({
  orderNumber: `RFX-T-${n}`, items: [], shippingAddress: { firstName: 'A', lastName: 'B', line1: '1 St', country: 'CA' }, subtotal: 1, total: 1, ...extra,
});

async function withDatabase(name, work) {
  const connection = await mongoose.createConnection(URI, { dbName: `rfx_order_indexes_${name}`, autoIndex: false }).asPromise();
  try {
    await connection.dropDatabase();
    const OrderModel = connection.model('Order', Order.schema, 'orders');
    await OrderModel.createCollection();
    await work(OrderModel, connection);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
}
const names = async (OrderModel) => (await OrderModel.collection.listIndexes().toArray()).map((index) => index.name).sort();
const raw = (OrderModel, doc) => OrderModel.collection.insertOne(doc);

test('production as it is today: the unique PaymentIntent index is added beside the plain one and enforces one order per payment', { skip }, async () => {
  await withDatabase('prod_like', async (OrderModel) => {
    const orders = OrderModel.collection;
    await orders.createIndex({ orderNumber: 1 }, { unique: true });
    await orders.createIndex({ stripePaymentIntentId: 1 });                                       // the legacy plain index
    await orders.createIndex({ stripeCheckoutSessionId: 1 }, { unique: true, sparse: true });
    for (let n = 1; n <= 3; n += 1) await raw(OrderModel, line(n, { stripePaymentIntentId: `pi_${n}`, stripeCheckoutSessionId: `cs_${n}`, paymentMethod: 'stripe' }));

    const first = await ensureOrderPaymentIndexes({ OrderModel, logger: silent });
    assert.deepEqual(first, { present: ['stripeCheckoutSessionId'], created: ['stripePaymentIntentId_unique'], skipped: [], failed: [] });
    assert.deepEqual(await names(OrderModel), ['_id_', 'orderNumber_1', 'stripeCheckoutSessionId_1', 'stripePaymentIntentId_1', 'stripePaymentIntentId_unique']);

    // One order per payment: a fourth order for pi_2 is refused by the database itself.
    await assert.rejects(() => raw(OrderModel, line(4, { stripePaymentIntentId: 'pi_2' })), (err) => err.code === 11000 && /stripePaymentIntentId_unique/.test(err.message));
    assert.equal(await orders.countDocuments({}), 3);

    // Orders made without a PaymentIntent (e-Transfer, zero-total) are not in the index: any number of them is fine, with or without an explicit null.
    await raw(OrderModel, line(5, { paymentMethod: 'etransfer' }));
    await raw(OrderModel, line(6, { paymentMethod: 'etransfer' }));
    await raw(OrderModel, line(7, { stripePaymentIntentId: null }));
    await raw(OrderModel, line(8, { stripePaymentIntentId: null }));
    assert.equal(await orders.countDocuments({}), 7);

    // The legacy plain index is untouched, and a second start is a no-op.
    const plain = (await orders.listIndexes().toArray()).find((index) => index.name === 'stripePaymentIntentId_1');
    assert.ok(plain && !plain.unique && !plain.sparse);
    const second = await ensureOrderPaymentIndexes({ OrderModel, logger: silent });
    assert.deepEqual(second, { present: ['stripePaymentIntentId', 'stripeCheckoutSessionId'], created: [], skipped: [], failed: [] });
  });
});

test('two orders already share a PaymentIntent: nothing is built, nothing is deleted, and the value is named', { skip }, async () => {
  await withDatabase('duplicates', async (OrderModel) => {
    const orders = OrderModel.collection;
    await orders.createIndex({ stripePaymentIntentId: 1 });
    await raw(OrderModel, line(1, { stripePaymentIntentId: 'pi_twice', stripeCheckoutSessionId: 'cs_1' }));
    await raw(OrderModel, line(2, { stripePaymentIntentId: 'pi_twice', stripeCheckoutSessionId: 'cs_2' }));
    const errors = [];
    const result = await ensureOrderPaymentIndexes({ OrderModel, logger: { log() {}, error: (m) => errors.push(m) } });
    assert.deepEqual(result.skipped, [{ field: 'stripePaymentIntentId', reason: 'duplicates', values: ['pi_twice'] }]);
    assert.deepEqual(result.created, ['stripeCheckoutSessionId_1'], 'the other index is not held up by it');
    assert.equal(await orders.countDocuments({}), 2, 'no order was changed or removed');
    assert.ok(!(await names(OrderModel)).includes('stripePaymentIntentId_unique'));
    assert.match(errors.join('\n'), /pi_twice/);
  });
});

test('a database with no payment indexes at all gets both, and the model\'s own declarations are the same indexes', { skip }, async () => {
  await withDatabase('fresh', async (OrderModel) => {
    const result = await ensureOrderPaymentIndexes({ OrderModel, logger: silent });
    assert.deepEqual(result.created.sort(), ['stripeCheckoutSessionId_1', 'stripePaymentIntentId_unique']);
    const built = (await OrderModel.collection.listIndexes().toArray()).filter((index) => /^stripe/.test(index.name));
    // Mongoose building the declared indexes on top is a no-op: same names, same options (this is what tests with autoIndex rely on).
    await OrderModel.init();
    await OrderModel.ensureIndexes();
    const after = (await OrderModel.collection.listIndexes().toArray()).filter((index) => /^stripe/.test(index.name));
    assert.deepEqual(after.map((index) => index.name).sort(), built.map((index) => index.name).sort());
  });
});
