const Cart = require('../models/Cart');

const CART_OWNER_INDEXES = [
  { field: 'user', name: 'user_1', keyPattern: { user: 1 } },
  { field: 'sessionId', name: 'sessionId_1', keyPattern: { sessionId: 1 } },
];

const sameKeyPattern = (left, right) => (
  left && right
  && Object.keys(left).length === Object.keys(right).length
  && Object.entries(left).every(([key, value]) => right[key] === value)
);

const idText = (value) => String(value ?? '');
const timestamp = (value) => {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cartItemKey = (item, documentId, position) => {
  if (typeof item?.slug === 'string' && item.slug) return `slug:${item.slug}`;
  if (item?.product) return `product:${idText(item.product)}`;
  if (typeof item?.sku === 'string' && item.sku) return `sku:${item.sku}`;
  return `unkeyed:${idText(documentId)}:${position}`;
};

const positiveQuantity = (value) => {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
};

function mergeDuplicateCartDocuments(documents) {
  if (!Array.isArray(documents) || documents.length < 2) {
    throw new Error('At least two cart documents are required for a duplicate merge.');
  }

  const canonical = [...documents].sort((left, right) => idText(left._id).localeCompare(idText(right._id)))[0];
  const newestFirst = [...documents].sort((left, right) => (
    timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || idText(right._id).localeCompare(idText(left._id))
  ));
  const newest = newestFirst[0];
  const mergedItems = new Map();

  for (const document of newestFirst) {
    for (const [position, item] of (document.items || []).entries()) {
      const key = cartItemKey(item, document._id, position);
      const quantity = positiveQuantity(item?.qty);
      const existing = mergedItems.get(key);
      if (existing) {
        existing.qty += quantity;
      } else {
        mergedItems.set(key, { ...item, qty: quantity });
      }
    }
  }

  const validExpiries = documents
    .map((document) => document.expiresAt)
    .filter((value) => timestamp(value) > 0)
    .sort((left, right) => timestamp(right) - timestamp(left));
  const set = {
    items: [...mergedItems.values()],
    discount: Number.isFinite(Number(newest.discount)) ? Number(newest.discount) : 0,
  };
  if (validExpiries[0]) set.expiresAt = validExpiries[0];
  if (newest.updatedAt) set.updatedAt = newest.updatedAt;
  if (newest.couponCode) set.couponCode = newest.couponCode;

  return {
    canonicalId: canonical._id,
    duplicateIds: documents.filter((document) => idText(document._id) !== idText(canonical._id)).map((document) => document._id),
    set,
    unset: newest.couponCode ? {} : { couponCode: '' },
  };
}

async function mergeDuplicateOwners({ CartModel, field }) {
  const collection = CartModel.collection;
  const duplicateGroups = await collection.aggregate([
    { $match: { [field]: { $exists: true, $ne: null } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  let mergedGroups = 0;
  let removedDocuments = 0;

  for (const group of duplicateGroups) {
    const session = await CartModel.db.startSession();
    let committed = { merged: false, removed: 0 };
    try {
      await session.withTransaction(async () => {
        const documents = await collection
          .find({ [field]: group._id }, { session })
          .sort({ _id: 1 })
          .toArray();
        if (documents.length < 2) {
          committed = { merged: false, removed: 0 };
          return;
        }

        const plan = mergeDuplicateCartDocuments(documents);
        const update = { $set: plan.set };
        if (Object.keys(plan.unset).length > 0) update.$unset = plan.unset;
        const updated = await collection.updateOne({ _id: plan.canonicalId }, update, { session });
        if (updated.matchedCount !== 1) throw new Error(`Canonical ${field} cart disappeared during migration.`);
        const deleted = await collection.deleteMany({ _id: { $in: plan.duplicateIds } }, { session });
        if (deleted.deletedCount !== plan.duplicateIds.length) {
          throw new Error(`Duplicate ${field} cart set changed during migration.`);
        }
        committed = { merged: true, removed: deleted.deletedCount };
      });
    } finally {
      await session.endSession();
    }
    if (committed.merged) {
      mergedGroups += 1;
      removedDocuments += committed.removed;
    }
  }

  return { mergedGroups, removedDocuments };
}

async function ensureCartOwnershipIndexes({ CartModel = Cart, logger = console } = {}) {
  const collection = CartModel.collection;
  const database = CartModel.db.db;
  const collectionName = collection.collectionName;
  let indexes = await collection.listIndexes().toArray();
  const toConvert = [];

  for (const specification of CART_OWNER_INDEXES) {
    const sameName = indexes.find((index) => index.name === specification.name);
    const sameKey = indexes.filter((index) => sameKeyPattern(index.key, specification.keyPattern));
    if (sameName && !sameKeyPattern(sameName.key, specification.keyPattern)) {
      throw new Error(`Cart index ${specification.name} has an unexpected key pattern.`);
    }
    if (sameKey.length > 1 || (sameKey[0] && sameKey[0].name !== specification.name)) {
      throw new Error(`Cart ${specification.field} index configuration is ambiguous.`);
    }

    let current = sameName || sameKey[0];
    if (!current) {
      await collection.createIndex(specification.keyPattern, { name: specification.name, sparse: true });
      current = { name: specification.name, key: specification.keyPattern, sparse: true };
    }
    if (current.sparse !== true) {
      throw new Error(`Cart index ${specification.name} must remain sparse.`);
    }
    if (current.unique === true) continue;

    if (current.prepareUnique !== true) {
      await database.command({
        collMod: collectionName,
        index: { keyPattern: specification.keyPattern, prepareUnique: true },
      });
    }
    toConvert.push(specification);
  }

  // Sparse unique indexes still index explicit null values. Normalize legacy
  // rows to the schema's intended absent-field representation. Authenticated
  // ownership wins if an old row somehow retained both owner fields.
  await collection.updateMany({ user: null }, { $unset: { user: '' } });
  await collection.updateMany({ sessionId: null }, { $unset: { sessionId: '' } });
  await collection.updateMany(
    { user: { $exists: true, $ne: null }, sessionId: { $exists: true, $ne: null } },
    { $unset: { sessionId: '' } },
  );

  const userMerge = await mergeDuplicateOwners({ CartModel, field: 'user' });
  const sessionMerge = await mergeDuplicateOwners({ CartModel, field: 'sessionId' });

  for (const specification of toConvert) {
    const conversion = {
      collMod: collectionName,
      index: { keyPattern: specification.keyPattern, unique: true },
    };
    await database.command({ ...conversion, dryRun: true });
    await database.command(conversion);
  }

  indexes = await collection.listIndexes().toArray();
  for (const specification of CART_OWNER_INDEXES) {
    const current = indexes.find((index) => index.name === specification.name);
    if (!current || current.unique !== true || current.sparse !== true
      || !sameKeyPattern(current.key, specification.keyPattern)) {
      throw new Error(`Cart index ${specification.name} was not safely upgraded.`);
    }
  }

  const result = {
    convertedIndexes: toConvert.length,
    mergedGroups: userMerge.mergedGroups + sessionMerge.mergedGroups,
    removedDocuments: userMerge.removedDocuments + sessionMerge.removedDocuments,
  };
  if (result.convertedIndexes || result.mergedGroups) {
    logger.log(
      `Cart ownership migration: ${result.convertedIndexes} index(es) converted, `
      + `${result.mergedGroups} duplicate owner group(s) merged`,
    );
  }
  return result;
}

module.exports = {
  CART_OWNER_INDEXES,
  ensureCartOwnershipIndexes,
  mergeDuplicateCartDocuments,
};
