const { createHash } = require('node:crypto');
const Order = require('../models/Order');
const RateLimitEntry = require('../models/RateLimitEntry');

// A shared write serializes transactions for this buyer, even when their carts
// contain entirely different products. The hash keeps email out of lock keys.
async function prepareEtransferCap({ userId, email }) {
  const identity = userId ? `user:${userId}` : `email:${email}`;
  const key = `etransfer-cap:${createHash('sha256').update(identity).digest('hex')}`;
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  try {
    await RateLimitEntry.updateOne({ _id: key }, { $setOnInsert: { hits: 0, expiresAt } }, { upsert: true });
  } catch (err) {
    // Another first request may have inserted the same lock meanwhile.
    if (err.code !== 11000) throw err;
  }
  return async (session) => {
    const lock = await RateLimitEntry.updateOne({ _id: key }, { $inc: { hits: 1 }, $set: { expiresAt } }, { session });
    if (!lock.matchedCount) throw new Error('e-Transfer buyer lock expired; retry checkout');
    // Includes the new order, which was inserted in this same transaction.
    return Order.countDocuments({ paymentMethod: 'etransfer', paymentStatus: 'pending', status: 'pending',
      ...(userId ? { user: userId } : { guestEmail: email }),
    }).session(session);
  };
}

module.exports = { prepareEtransferCap };
