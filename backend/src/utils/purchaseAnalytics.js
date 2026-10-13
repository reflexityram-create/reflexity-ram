const Order = require('../models/Order');
const {
  MAX_EVENT_AGE_MS,
  isServerPurchaseTrackingEnabled,
  sendPurchaseEvent,
  purchaseTimeMs,
} = require('./ga4');

// Reports one paid order to GA4, exactly once, without ever throwing.
//
// analyticsPurchaseSentAt is the claim: it is set atomically BEFORE sending, so
// the webhook and the success-page fallback (which both run fulfilment) cannot
// double-report. A failed send releases the claim so the next fulfilment call
// retries, until the order is too old for Measurement Protocol to accept.
async function reportPaidOrderToGa4(order, {
  OrderModel = Order,
  send = sendPurchaseEvent,
  isEnabled = isServerPurchaseTrackingEnabled,
  currency,
  now = () => Date.now(),
  logger = console,
} = {}) {
  try {
    if (!order?._id || order.paymentStatus !== 'paid' || !isEnabled()) return false;

    // Measured from when it was PAID (a bank debit clears days after it was placed), else from when it was created.
    const eventAtMs = purchaseTimeMs(order, now());
    if (Number.isFinite(eventAtMs) && now() - eventAtMs > MAX_EVENT_AGE_MS) return false;

    const claimed = await OrderModel.findOneAndUpdate(
      { _id: order._id, analyticsPurchaseSentAt: null },
      { $set: { analyticsPurchaseSentAt: new Date(now()) } },
      { new: false },
    ).select('+analyticsClientId +analyticsSessionId');
    if (!claimed) return false;

    const result = await send(order, {
      clientId: claimed.analyticsClientId,
      sessionId: claimed.analyticsSessionId,
    }, { currency, now: now(), logger });
    if (result.sent) return true;

    await OrderModel.updateOne({ _id: order._id }, { $set: { analyticsPurchaseSentAt: null } });
    return false;
  } catch (err) {
    logger.warn(`GA4 purchase reporting skipped for ${order?.orderNumber || 'unknown order'}: ${err?.name || 'error'}`);
    return false;
  }
}

module.exports = { reportPaidOrderToGa4 };
