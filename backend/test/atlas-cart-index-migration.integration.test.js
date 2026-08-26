const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Cart = require('../src/models/Cart');
const { ensureCartOwnershipIndexes } = require('../src/migrations/ensureCartOwnershipIndexes');

const ATLAS_OPT_IN = process.env.RUN_ATLAS_CART_INDEX_TESTS === '1';
const ATLAS_URI = process.env.ATLAS_TEST_URI;
const ATLAS_DATABASE = process.env.ATLAS_TEST_DATABASE;
const SAFE_DATABASE = /^rfx_atlas_txn_test_[a-z0-9_]+$/;

const requireSafeTarget = () => {
  if (typeof ATLAS_URI !== 'string' || !ATLAS_URI) throw new Error('ATLAS_TEST_URI is required');
  const parsed = new URL(ATLAS_URI);
  if (parsed.protocol !== 'mongodb+srv:' || !parsed.hostname.toLowerCase().endsWith('.mongodb.net')) {
    throw new Error('ATLAS_TEST_URI must use mongodb+srv on an Atlas mongodb.net host');
  }
  if (!SAFE_DATABASE.test(ATLAS_DATABASE || '')) {
    throw new Error('ATLAS_TEST_DATABASE must be an explicitly disposable rfx_atlas_txn_test_ database');
  }
};

test('Atlas upgrades populated legacy cart indexes without losing owner data', {
  skip: ATLAS_OPT_IN
    ? false
    : 'Set RUN_ATLAS_CART_INDEX_TESTS=1 with an explicitly disposable Atlas target to run this test',
  timeout: 60000,
}, async () => {
  requireSafeTarget();
  let connection;
  try {
    connection = await mongoose.createConnection(ATLAS_URI, {
      dbName: ATLAS_DATABASE,
      autoIndex: false,
      serverSelectionTimeoutMS: 15000,
    }).asPromise();
    assert.equal(connection.name, ATLAS_DATABASE);
    assert.match(connection.name, SAFE_DATABASE);

    const TestCart = connection.model('CartMigrationFixture', Cart.schema.clone(), 'carts');
    await TestCart.init();
    const carts = TestCart.collection;
    await carts.createIndex({ user: 1 }, { name: 'user_1', sparse: true });
    await carts.createIndex({ sessionId: 1 }, { name: 'sessionId_1', sparse: true });

    const user = new mongoose.Types.ObjectId();
    const otherUser = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();
    await carts.insertMany([
      {
        user,
        sessionId: null,
        items: [{ product, slug: 'ram-a', sku: 'RAM-A', name: 'old', price: 10, qty: 2 }],
        couponCode: 'OLD',
        discount: 5,
        updatedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-02-01'),
      },
      {
        user,
        sessionId: null,
        items: [{ product, slug: 'ram-a', sku: 'RAM-A', name: 'new', price: 12, qty: 3 }],
        discount: 0,
        updatedAt: new Date('2026-01-02'),
        expiresAt: new Date('2026-03-01'),
      },
      {
        user: null,
        sessionId: 'session_0123456789',
        items: [{ product, slug: 'ram-b', sku: 'RAM-B', name: 'guest old', price: 8, qty: 1 }],
        updatedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-02-01'),
      },
      {
        user: null,
        sessionId: 'session_0123456789',
        items: [{ product, slug: 'ram-b', sku: 'RAM-B', name: 'guest new', price: 9, qty: 4 }],
        updatedAt: new Date('2026-01-03'),
        expiresAt: new Date('2026-04-01'),
      },
      {
        user: otherUser,
        sessionId: 'session_dualowner_0123',
        items: [],
        updatedAt: new Date('2026-01-04'),
        expiresAt: new Date('2026-05-01'),
      },
    ]);

    assert.deepEqual(
      await ensureCartOwnershipIndexes({ CartModel: TestCart, logger: { log() {} } }),
      { convertedIndexes: 2, mergedGroups: 2, removedDocuments: 2 },
    );
    assert.deepEqual(
      await ensureCartOwnershipIndexes({ CartModel: TestCart, logger: { log() {} } }),
      { convertedIndexes: 0, mergedGroups: 0, removedDocuments: 0 },
    );

    assert.equal(await carts.countDocuments({}), 3);
    assert.equal(await carts.countDocuments({ user: { $type: 'null' } }), 0);
    assert.equal(await carts.countDocuments({ sessionId: { $type: 'null' } }), 0);
    assert.equal(await carts.countDocuments({ user: otherUser, sessionId: { $exists: true } }), 0);
    assert.equal((await carts.findOne({ user })).items[0].qty, 5);
    assert.equal((await carts.findOne({ sessionId: 'session_0123456789' })).items[0].qty, 5);

    const indexes = await carts.listIndexes().toArray();
    for (const name of ['user_1', 'sessionId_1']) {
      const index = indexes.find((candidate) => candidate.name === name);
      assert.equal(index.unique, true);
      assert.equal(index.sparse, true);
    }
    await assert.rejects(() => carts.insertOne({ user, items: [] }), (error) => error?.code === 11000);
  } finally {
    if (connection) {
      assert.equal(connection.name, ATLAS_DATABASE);
      assert.match(connection.name, SAFE_DATABASE);
      await connection.dropDatabase();
      await connection.close();
    }
  }
});
