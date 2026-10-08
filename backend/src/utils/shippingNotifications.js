const Order = require('../models/Order');
const { sendShippingNotificationEmail } = require('./email');

const CLAIM_MS = 15 * 60 * 1000;

// Both an admin and the carrier worker use the same durable claim. A crash can
// be retried after the lease; Resend also deduplicates the stable key for 24h.
async function notifyShipment(order, overrides = {}) {
  const deps = { Order, sendEmail: sendShippingNotificationEmail, now: () => new Date(), ...overrides };
  const now = deps.now();
  const claimed = await deps.Order.findOneAndUpdate({
    _id: order._id, status: 'shipped', paymentStatus: 'paid', trackingNumber: order.trackingNumber,
    $or: [
      { 'shippingNotification.status': { $in: ['pending', 'failed'] } },
      { 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': { $lt: new Date(now - CLAIM_MS) } },
    ],
  }, { $set: { 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': now } });
  if (!claimed) return { status: 'skipped' };
  const email = order.user?.email || order.guestEmail;
  const filter = { _id: order._id, 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': now };
  if (!email) {
    await deps.Order.updateOne(filter, { $set: { 'shippingNotification.status': 'skipped' } });
    return { status: 'skipped', message: 'Order shipped, but no buyer email address is on the order' };
  }
  try {
    await deps.sendEmail({ email, firstName: order.user?.firstName || order.shippingAddress?.firstName,
      order, idempotencyKey: `shipment/${order._id}` });
    await deps.Order.updateOne(filter, { $set: { 'shippingNotification.status': 'sent', 'shippingNotification.sentAt': now } });
    return { status: 'sent' };
  } catch {
    await deps.Order.updateOne(filter, { $set: { 'shippingNotification.status': 'failed' } });
    return { status: 'failed', message: 'Order shipped, but the buyer notification could not be sent' };
  }
}

module.exports = { notifyShipment, CLAIM_MS };
