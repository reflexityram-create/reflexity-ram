const Order = require('../models/Order');

// The duplicate-order guard: one order per Stripe PaymentIntent and one per Checkout Session. Order.js declares the same
// indexes (a test pins that the two agree), but the server starts with autoIndex off and keeps these two out of its general
// index pass: production once had a plain, non-unique `stripePaymentIntentId_1` left by an old schema, and asking Mongoose for
// a unique index of that NAME failed the whole startup (a deploy failed on it, 2026-08-26). This is the one place that adds them.
//
// What it does, per index: if a unique index on that field already exists (whatever it is called) it leaves everything alone;
// otherwise it checks that no two orders share a value and builds a partial unique index under its OWN name, beside whatever
// plain index is there. It never drops, renames or rewrites an index, never touches an order, and never throws: a failure is
// logged and the server still starts (the guard is then as missing as it was before, and the startup check says so).
//
// The PaymentIntent index is partial rather than sparse: a sparse index still indexes an explicit null, so a second order saved
// with a null PaymentIntent (an e-Transfer order or a zero-total checkout written some other way) would collide with the first.
// A partial one only holds orders whose PaymentIntent is a string.
const ORDER_PAYMENT_INDEXES = Object.freeze([
  // One order per PaymentIntent. Production has a plain `stripePaymentIntentId_1` (same key, not unique) from an old schema, so this
  // one has its own name and sits beside it (checked on MongoDB 7: a second index on the same key is accepted when its options differ).
  Object.freeze({
    field: 'stripePaymentIntentId',
    name: 'stripePaymentIntentId_unique',
    options: Object.freeze({ unique: true, partialFilterExpression: Object.freeze({ stripePaymentIntentId: Object.freeze({ $type: 'string' }) }) }),
  }),
  // One order per Checkout Session. Production already has this one (unique, sparse, under this name); a fresh database gets it here.
  Object.freeze({
    field: 'stripeCheckoutSessionId',
    name: 'stripeCheckoutSessionId_1',
    options: Object.freeze({ unique: true, sparse: true }),
  }),
]);

const isSingleKey = (key, field) => key && Object.keys(key).length === 1 && key[field] === 1;
const DUPLICATE_SAMPLE = 5;

async function ensureOrderPaymentIndexes({ OrderModel = Order, logger = console } = {}) {
  const result = { present: [], created: [], skipped: [], failed: [] };
  const collection = OrderModel.collection;
  for (const spec of ORDER_PAYMENT_INDEXES) {
    try {
      const indexes = await collection.listIndexes().toArray();
      if (indexes.some((index) => index.unique === true && isSingleKey(index.key, spec.field))) {
        result.present.push(spec.field);
        continue;
      }
      const nameTaken = indexes.find((index) => index.name === spec.name);
      if (nameTaken) {
        // Something else already uses the name: do not guess what it is.
        result.skipped.push({ field: spec.field, reason: 'name-taken' });
        logger.error(`🚨 Order index ${spec.name} exists but is not a unique index on ${spec.field}; left alone.`);
        continue;
      }
      // A unique index cannot be built over duplicates. Never "fix" the orders: say which values and stop.
      const duplicates = await collection.aggregate([
        { $match: { [spec.field]: { $type: 'string' } } },
        { $group: { _id: `$${spec.field}`, orders: { $sum: 1 } } },
        { $match: { orders: { $gt: 1 } } },
        { $limit: DUPLICATE_SAMPLE },
      ]).toArray();
      if (duplicates.length) {
        result.skipped.push({ field: spec.field, reason: 'duplicates', values: duplicates.map((group) => group._id) });
        logger.error(`🚨 Order index ${spec.name} NOT built: more than one order has the same ${spec.field} (${duplicates.map((group) => group._id).join(', ')}). Fix those orders by hand; the index is added at the next start.`);
        continue;
      }
      await collection.createIndex({ [spec.field]: 1 }, { name: spec.name, ...spec.options });
      result.created.push(spec.name);
      logger.log(`✅ Order index ${spec.name} built (one order per ${spec.field}).`);
    } catch (err) {
      result.failed.push({ field: spec.field, error: err.message });
      logger.error(`🚨 Order index ${spec.name} could not be built: ${err.message}`);
    }
  }
  return result;
}

module.exports = { ORDER_PAYMENT_INDEXES, ensureOrderPaymentIndexes };
