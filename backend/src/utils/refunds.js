// ─── Refunds made in Stripe ─────────────────────────────────────────────────────────────────────────────────────────────
// Stripe sends charge.refunded for a full refund AND for every partial one (routes/stripe.js); only `refunded: true` means all of it.
// A refund is made by the owner in Stripe, so the site only has to keep the order in step and tell the owner's phone: a full refund
// makes the order `refunded` (stock is NOT put back: it waits for the return to be inspected), a partial one adds a line to the history.
//
// Stripe sends an event again after a timeout or a 5xx, so each step must be safe to run twice, and two deliveries may overlap:
// every write is one conditional update (the same event cannot add its history line twice), and the alert and the review-email
// cancel behind it have their own keys. A refund for a charge the shop has no order for is the owner's to hear about (like a dispute
// on one, utils/disputes.js), not a log line; a refund that arrives before its order exists is handled when that order is made
// (fulfillCheckoutSession reads the charge and creates it already refunded).

const Order = require('../models/Order');
const { recordAdminEvent, recordRequiredAdminEvent, describeOrder, money } = require('./adminEvents');
const { cancelReviewRequest } = require('./reviewRequests');

/** Stripe emits charge.refunded for partial refunds too; only this flag means full. */
const isFullyRefundedCharge = (charge) => charge?.refunded === true;

const FULL_REFUND_NOTE = 'Fully refunded via Stripe; inventory unchanged pending return inspection';
// The amount is the total refunded on the charge so far, so the note of a second partial refund differs from the first one's,
// while a redelivery of the same event writes the same note again (and is recognised by it).
const partialRefundNote = (charge) => `Partial Stripe refund recorded (${charge.amount_refunded || 0} minor currency units); inventory unchanged`;

const idOf = (value) => (value && typeof value === 'object' ? value.id : value) || null;

/**
 * Apply one charge.refunded event. Safe to run again for the same event and for two deliveries at once.
 * Returns { matched, applied }: whether an order was found, and whether THIS call changed it.
 * A database error, or an alert about a refund with no order that could not be written, throws: the webhook answers 500 and Stripe
 * sends the event again.
 */
async function recordRefundEvent(event, {
  OrderModel = Order, record = recordAdminEvent, announce = recordRequiredAdminEvent, cancelReview = cancelReviewRequest,
  logger = console, now = () => new Date(),
} = {}) {
  const charge = event?.data?.object;
  if (!charge?.id) {
    logger.warn?.(`Refund event ${event?.id || ''} has no charge: ignored`);
    return { matched: false, applied: false };
  }
  const intentId = idOf(charge.payment_intent);
  const order = await OrderModel.findOne({ $or: [{ stripeChargeId: charge.id }, ...(intentId ? [{ stripePaymentIntentId: intentId }] : [])] });

  if (!order) {
    logger.warn?.(`⚠️  Refund on charge ${charge.id} matches no order (payment ${intentId || '-'})`);
    await announce({
      type: 'payment.refund_unmatched', priority: 'normal', dedupeKey: `payment.refund_unmatched:${charge.id}`,
      title: 'Refund on a payment with no order',
      body: `Stripe refunded ${money((Number(charge.amount_refunded) || 0) / 100)} ${String(charge.currency || 'cad').toUpperCase()} on charge ${charge.id}, but the shop has no order for it. If that checkout is still being recorded, its order will appear already refunded; otherwise check the payment in Stripe.`,
      path: '/admin/orders',
    });
    return { matched: false, applied: false };
  }

  if (isFullyRefundedCharge(charge)) {
    // Only an order that is not refunded yet changes, so a redelivery (or an order that was born refunded) adds no second line.
    const applied = await OrderModel.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'refunded' } },
      { $set: { paymentStatus: 'refunded', status: 'refunded' }, $push: { statusHistory: { status: 'refunded', note: FULL_REFUND_NOTE, timestamp: now() } } },
      { returnDocument: 'after' },
    );
    const refunded = applied || order;
    logger.log?.(applied ? `💸 Full refund processed for order ${order.orderNumber}` : `Full refund for order ${order.orderNumber} was already recorded`);
    // These two repeat harmlessly (the alert has a key, a cancelled email is skipped), so a delivery that stopped after the write above
    // still finishes them when Stripe sends it again.
    await record({ type: 'order.refunded', title: 'Order refunded', body: describeOrder(refunded), priority: 'normal', order: refunded, dedupeKey: `order.refunded:${refunded._id}` });
    // Don't ask a refunded buyer how the order went.
    try {
      if (await cancelReview(refunded)) logger.log?.(`Cancelled the scheduled review email for order ${order.orderNumber}`);
    } catch (reviewErr) {
      logger.error?.('Review email cancel failed:', reviewErr.message);
    }
    return { matched: true, applied: Boolean(applied) };
  }

  // A partial refund: the money moved but the refunded amount does not say which item came back, so the order and its stock stay as they are.
  const note = partialRefundNote(charge);
  const applied = await OrderModel.findOneAndUpdate(
    { _id: order._id, 'statusHistory.note': { $ne: note } },
    { $push: { statusHistory: { status: order.status, note, timestamp: now() } } },
    { returnDocument: 'after' },
  );
  logger.log?.(applied ? `💸 Partial refund recorded for order ${order.orderNumber}` : `Partial refund for order ${order.orderNumber} was already recorded`);
  await record({ type: 'order.partial_refund', title: 'Partial refund recorded', body: describeOrder(order), priority: 'normal', order, dedupeKey: `order.partial_refund:${event.id}` });
  return { matched: true, applied: Boolean(applied) };
}

module.exports = { isFullyRefundedCharge, recordRefundEvent, FULL_REFUND_NOTE, partialRefundNote };
