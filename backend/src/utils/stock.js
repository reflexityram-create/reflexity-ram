const Product = require('../models/Product');
const Order = require('../models/Order');
const { recordAdminEvent } = require('./adminEvents');

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
  // Set inside the transaction, read after it commits: the driver may re-run the callback, and the owner's phone
  // must only hear about an oversell that was really saved.
  let oversold = null;
  const decremented = await withStockTransaction(async (session) => {
    oversold = null;
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
      oversold = { order: claimed, items: oversoldItems };
      const note = `OVERSOLD — needs manual review: ${oversoldItems.join('; ')}`;
      console.error(`🚨 Order ${claimed.orderNumber}: ${note}`);
      // Add the flag to the notes the order already carries (which Canada Post service to buy, a disposable-email review); it used to replace them.
      const notes = [claimed.adminNotes, note].filter(Boolean).join('\n');
      await Order.updateOne(
        { _id: claimed._id },
        {
          $set: { adminNotes: notes },
          $push: { statusHistory: { status: 'processing', note, timestamp: new Date() } },
        },
        { session }
      );
    }

    return true;
  });
  if (decremented && oversold) {
    await recordAdminEvent({
      type: 'order.oversold',
      title: 'Oversold: needs you',
      body: `${oversold.order.orderNumber} · ${oversold.items.join('; ')}`,
      priority: 'high',
      order: oversold.order,
      dedupeKey: `order.oversold:${oversold.order._id}`,
    });
  }
  return decremented;
};

// ─── Holding stock for an order that is not paid yet (Interac e-Transfer) ───────
// A paid order that cannot be filled is the owner's problem to fix (decrementStockForOrder clamps and flags it). An
// UNPAID order has no such excuse: it must either get every unit or not exist, so these helpers take stock strictly.
class InsufficientStockError extends Error {
  constructor(item, available) {
    super(`Not enough stock for ${item?.sku || item?.slug || 'an item'}`);
    this.name = 'InsufficientStockError';
    this.status = 409;
    this.available = available;
    this.publicMessage = available > 0
      ? `Only ${available} of "${item?.name}" ${available === 1 ? 'is' : 'are'} left now. Update your cart and try again.`
      : `"${item?.name}" just sold out.`;
  }
}

// Inside a transaction: take every line's quantity or throw (which rolls the whole transaction back).
const takeStockStrict = async (items, session) => {
  for (const item of items) {
    if (!item.product) continue;
    const taken = await Product.findOneAndUpdate(
      { _id: item.product, stockQuantity: { $gte: item.qty } },
      { $inc: { stockQuantity: -item.qty } },
      { new: false, session }
    );
    if (!taken) {
      const current = await Product.findById(item.product).select('stockQuantity').session(session).lean();
      throw new InsufficientStockError(item, Math.max(0, Number(current?.stockQuantity) || 0));
    }
    await syncStockLabels(item.product, session);
  }
};

/**
 * Create an order and take its stock in one transaction: all of it, or neither (throws InsufficientStockError).
 * The order is saved with stockDecremented: true, so cancelling or expiring it gives the stock back exactly
 * (cancelOrderAndRestoreStock).
 */
const createOrderWithReservation = async (data) => {
  let created = null;
  await withStockTransaction(async (session) => {
    created = null;
    const [order] = await Order.create([{
      ...data,
      stockDecremented: true,
      items: data.items.map((item) => ({ ...item, decrementedQty: item.qty })),
    }], { session });
    await takeStockStrict(order.items, session);
    created = order;
    return true;
  });
  return created;
};

/**
 * Apply `updates` to the order that matches `filter` AND take its stock, atomically: if the stock is gone the update is
 * rolled back and InsufficientStockError is thrown. Used to bring back an e-Transfer order whose hold had already
 * expired when the money arrived. Returns the updated order, or null when nothing matched the filter.
 */
const claimOrderWithReservation = async (orderId, filter, updates) => {
  let claimed = null;
  await withStockTransaction(async (session) => {
    claimed = null;
    const order = await Order.findOneAndUpdate(
      { _id: orderId, stockDecremented: { $ne: true }, ...filter },
      updates,
      { returnDocument: 'after', session }
    );
    if (!order) return false;
    await takeStockStrict(order.items, session);
    await Order.updateOne({ _id: order._id }, {
      $set: { stockDecremented: true, items: order.items.map((item) => ({ ...item.toObject(), decrementedQty: item.qty })) },
    }, { session });
    claimed = await Order.findById(order._id).session(session);   // what was just saved, not the copy from before the stock was taken
    return true;
  });
  return claimed;
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
  InsufficientStockError,
  createOrderWithReservation,
  claimOrderWithReservation,
  deriveStockState,
  syncStockLabels,
  decrementStockForOrder,
  restoreStockForOrder,
  cancelOrderAndRestoreStock,
  cancellationClaimFilter,
  shouldDecrementStockForFulfillment,
  stockDecrementClaimFilter,
};
