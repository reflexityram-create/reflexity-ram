const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureCartOwnershipIndexes,
  mergeDuplicateCartDocuments,
} = require('../src/migrations/ensureCartOwnershipIndexes');

test('duplicate cart merge is deterministic and preserves the newest metadata', () => {
  const older = {
    _id: '0001',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    couponCode: 'OLD',
    discount: 5,
    items: [
      { slug: 'ram-a', sku: 'RAM-A', name: 'Older name', price: 10, qty: 2 },
      { slug: 'ram-b', sku: 'RAM-B', name: 'Only older', price: 20, qty: 1 },
    ],
  };
  const newer = {
    _id: '0002',
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    expiresAt: new Date('2026-03-01T00:00:00Z'),
    discount: 0,
    items: [{ slug: 'ram-a', sku: 'RAM-A', name: 'Newest name', price: 12, qty: 3 }],
  };

  const forward = mergeDuplicateCartDocuments([older, newer]);
  const reverse = mergeDuplicateCartDocuments([newer, older]);

  assert.deepEqual(reverse, forward);
  assert.equal(forward.canonicalId, '0001');
  assert.deepEqual(forward.duplicateIds, ['0002']);
  assert.deepEqual(forward.set.items, [
    { slug: 'ram-a', sku: 'RAM-A', name: 'Newest name', price: 12, qty: 5 },
    { slug: 'ram-b', sku: 'RAM-B', name: 'Only older', price: 20, qty: 1 },
  ]);
  assert.equal(forward.set.discount, 0);
  assert.equal(forward.set.expiresAt.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.deepEqual(forward.unset, { couponCode: '' });
});

test('legacy sparse cart indexes are converted in place and a second run is idempotent', async () => {
  const indexes = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'user_1', key: { user: 1 }, sparse: true },
    { name: 'sessionId_1', key: { sessionId: 1 }, sparse: true },
  ];
  const commands = [];
  const updates = [];
  const collection = {
    collectionName: 'carts',
    listIndexes: () => ({ toArray: async () => indexes.map((index) => ({ ...index })) }),
    createIndex: async () => { throw new Error('fixture indexes already exist'); },
    updateMany: async (filter, update) => { updates.push({ filter, update }); return { modifiedCount: 0 }; },
    aggregate: () => ({ toArray: async () => [] }),
  };
  const database = {
    command: async (command) => {
      commands.push(command);
      const field = Object.keys(command.index.keyPattern)[0];
      const index = indexes.find((candidate) => candidate.name === `${field}_1`);
      if (command.index.prepareUnique === true) index.prepareUnique = true;
      if (command.index.unique === true && command.dryRun !== true) {
        index.unique = true;
        delete index.prepareUnique;
      }
      return { ok: 1 };
    },
  };
  const CartModel = { collection, db: { db: database } };

  const first = await ensureCartOwnershipIndexes({ CartModel, logger: { log() {} } });
  const second = await ensureCartOwnershipIndexes({ CartModel, logger: { log() {} } });

  assert.deepEqual(first, { convertedIndexes: 2, mergedGroups: 0, removedDocuments: 0 });
  assert.deepEqual(second, { convertedIndexes: 0, mergedGroups: 0, removedDocuments: 0 });
  assert.equal(commands.length, 6);
  assert.deepEqual(commands.map((command) => ({
    field: Object.keys(command.index.keyPattern)[0],
    prepareUnique: command.index.prepareUnique === true,
    unique: command.index.unique === true,
    dryRun: command.dryRun === true,
  })), [
    { field: 'user', prepareUnique: true, unique: false, dryRun: false },
    { field: 'sessionId', prepareUnique: true, unique: false, dryRun: false },
    { field: 'user', prepareUnique: false, unique: true, dryRun: true },
    { field: 'user', prepareUnique: false, unique: true, dryRun: false },
    { field: 'sessionId', prepareUnique: false, unique: true, dryRun: true },
    { field: 'sessionId', prepareUnique: false, unique: true, dryRun: false },
  ]);
  assert.equal(updates.length, 6, 'each run must normalize both null owners and dual ownership');
  assert.equal(indexes.find((index) => index.name === 'user_1').unique, true);
  assert.equal(indexes.find((index) => index.name === 'sessionId_1').unique, true);
});
