const Product = require('../models/Product');
const Order = require('../models/Order');

const NON_FULFILLABLE_STATUSES = new Set(['cancelled', 'refunded']);
const cancellationClaimFilter = (orderId, expected) => {
  if (!expected || typeof expected.status !== 'string' || typeof expected.paymentStatus !== 'string') {
    throw new Error('Cancellation requires an exact expected order state');
  }
  return {
    _id: orderId,
    status: expected.status,
    paymentStatus: expected.paymentStatus,
  };
};
const stockDecrementClaimFilter = (orderId) => ({
  _id: orderId,
  stockDecremented: { $ne: true },
  status: { $nin: [...NON_FULFILLABLE_STATUSES] },
});

// A terminal order must never be decremented again by a delayed Stripe webhook
// or a repeated session-status recovery call.
const shouldDecrementStockForFulfillment = (order) => (
  Boolean(order)
  && order.stockDecremented !== true
  && !NON_FULFILLABLE_STATUSES.has(order.status)
);

// Keep the human-readable stock fields in sync with stockQuantity.
const deriveStockState = (stockQuantity) => {
  const quantity = Number(stockQuantity);
  if (quantity <= 0) return { stock: 'out', stockLabel: 'Out of stock' };
  if (quantity <= 5) return { stock: 'low', stockLabel: 'Low stock' };
  return { stock: 'in', stockLabel: 'In stock' };
};

// Re-derive stock/stockLabel for a product after any quantity change.
const syncStockLabels = async (productId, session = null) => {
  const productQuery = Product.findById(productId).select('stockQuantity');
  if (session) productQuery.session(session);
  const product = await productQuery;
  if (!product) return;
  await Product.findByIdAndUpdate(productId, {
    $set: deriveStockState(product.stockQuantity),
  }, session ? { session } : {});
};

const withStockTransaction = async (work) => {
  const session = await Order.startSession();
  let result = false;
  try {
    await session.withTransaction(async () => {
      // The driver may retry this callback after a transient write conflict.
      result = false;
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Decrement stock for an order's items exactly once.
 *
 * Idempotent: uses the order's `stockDecremented` flag as a guard, flipped
 * atomically so a webhook + fallback-fulfillment race can't double-decrement.
 *
 * Race-safe against overselling: each item is decremented with a conditional
 * update (`stockQuantity >= qty`). If two paid orders race for the last
 * units, the loser's decrement is clamped at zero instead of driving stock
 * negative, the actual amount taken is recorded on the order item
 * (`decrementedQty`), and the order is flagged for admin review — the
 * customer has already paid, so this must be resolved manually
 * (restock, partial refund, or substitute).
 */
const decrementStockForOrder = async (order) => {
  return withStockTransaction(async (session) => {
    // Claim, product updates, and per-item decrement records commit together.
    const claimed = await Order.findOneAndUpdate(
      stockDecrementClaimFilter(order._id),
      { $set: { stockDecremented: true } },
      { returnDocument: 'after', session }
    );
    if (!claimed) return false; // already decremented or terminal

    const oversoldItems = [];

    for (const item of claimed.items) {
      if (!item.product) continue;

      // Fast path: enough stock — take the full quantity atomically.
      const full = await Product.findOneAndUpdate(
        { _id: item.product, stockQuantity: { $gte: item.qty } },
        { $inc: { stockQuantity: -item.qty } },
        { new: false, session }
      );

      if (full) {
        item.decrementedQty = item.qty;
      } else {
        // Oversold: clamp at zero and record the quantity actually available.
        const pre = await Product.findOneAndUpdate(
          { _id: item.product },
          [{ $set: { stockQuantity: { $max: [0, { $subtract: ['$stockQuantity', item.qty] }] } } }],
          { new: false, session }
        );
        const available = Math.max(0, pre?.stockQuantity ?? 0);
        item.decrementedQty = Math.min(available, item.qty);
        oversoldItems.push(`${item.sku} (wanted ${item.qty}, got ${item.decrementedQty})`);
      }

      await syncStockLabels(item.product, session);
    }

    // Persist per-item decrementedQty so restores are exact.
    await Order.updateOne(
      { _id: claimed._id },
      { $set: { items: claimed.items } },
      { session }
    );

    if (oversoldItems.length > 0) {
      const note = `OVERSOLD — needs manual review: ${oversoldItems.join('; ')}`;
      console.error(`🚨 Order ${claimed.orderNumber}: ${note}`);
      await Order.updateOne(
        { _id: claimed._id },
        {
          $set: { adminNotes: note },
          $push: { statusHistory: { status: 'processing', note, timestamp: new Date() } },
        },
        { session }
      );
    }

    return true;
  });
};

const restoreStockInSession = async (orderId, session) => {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, stockDecremented: true },
    { $set: { stockDecremented: false } },
    { returnDocument: 'after', session }
  );
  if (!claimed) return false; // never decremented — nothing to restore

  for (const item of claimed.items) {
    if (!item.product) continue;
    const restoreQty = item.decrementedQty ?? item.qty;
    if (restoreQty <= 0) continue;
    await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stockQuantity: restoreQty } },
      { session }
    );
    await syncStockLabels(item.product, session);
  }

  return true;
};

/** Restore a previously decremented order atomically. */
const restoreStockForOrder = async (order) => (
  withStockTransaction((session) => restoreStockInSession(order._id, session))
);

/**
 * Commit cancellation status/history and inventory restoration together. A
 * crash can therefore leave neither side applied, never a cancelled order
 * whose stock is still missing.
 */
const cancelOrderAndRestoreStock = async (orderId, updates, expected) => {
  return withStockTransaction(async (session) => {
    const filter = cancellationClaimFilter(orderId, expected);
    const cancelled = await Order.findOneAndUpdate(
      filter,
      updates,
      { returnDocument: 'after', session }
    );
    if (!cancelled) return null;
    await restoreStockInSession(cancelled._id, session);
    return cancelled._id;
  });
};

module.exports = {
  deriveStockState,
  syncStockLabels,
  decrementStockForOrder,
  restoreStockForOrder,
  cancelOrderAndRestoreStock,
  cancellationClaimFilter,
  shouldDecrementStockForFulfillment,
  stockDecrementClaimFilter,
};
