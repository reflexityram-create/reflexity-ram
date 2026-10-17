const Order = require('../models/Order');
const { sendShippingNotificationEmail } = require('./email');

const CLAIM_MS = 15 * 60 * 1000;

// Both an admin and the carrier worker use the same durable claim. A crash can
// be retried after the lease; Resend also deduplicates the stable key for 24h.
async function notifyShipment(order, overrides = {}) {
  if (order?.fulfillmentBlocked) return { status: 'blocked', message: 'Shipment notification is blocked until unmatched paid items are reviewed' };
  const deps = { Order, sendEmail: sendShippingNotificationEmail, now: () => new Date(), ...overrides };
  const now = deps.now();
  const claimed = await deps.Order.findOneAndUpdate({
    // An untracked shipment has no number: null matches a missing field, so it can be claimed like any other.
    _id: order._id, status: 'shipped', paymentStatus: 'paid', trackingNumber: order.trackingNumber ?? null,
    $or: [
      { 'shippingNotification.status': { $in: ['pending', 'failed'] } },
      { 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': { $lt: new Date(now - CLAIM_MS) } },
    ],
  }, { $set: { 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': now } });
  if (!claimed) return { status: 'unchanged' }; // another worker owns it, or it was already handled
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

// A shipment sent without a tracking number has no parcel to follow, so the tracking worker (which retries a failed "shipped"
// email for tracked parcels) never looks at it: an email that failed, or a server that stopped after the claim, left the buyer
// without the news for good. This retries those on the same claim. Only for a week: after that the news is stale, and an
// address that keeps failing is not tried forever.
const UNTRACKED_RETRY_DAYS = 7;
async function retryUntrackedShipmentNotices(overrides = {}) {
  const deps = { Order, notify: notifyShipment, now: () => new Date(), limit: 20, ...overrides };
  const now = deps.now();
  const orders = await deps.Order.find({
    status: 'shipped',
    paymentStatus: 'paid',
    trackingNumber: { $in: [null, ''] },
    shippedAt: { $gte: new Date(now.getTime() - UNTRACKED_RETRY_DAYS * 24 * 60 * 60 * 1000) },
    $or: [
      { 'shippingNotification.status': { $in: ['pending', 'failed'] } },
      { 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': { $lt: new Date(now.getTime() - CLAIM_MS) } },
    ],
  })
    // Least recently tried first (never tried sorts first): each attempt stamps claimedAt, so when more than `limit` keep failing
    // the next run moves on to the others instead of trying the same ones again.
    .sort({ 'shippingNotification.claimedAt': 1, _id: 1 })
    .populate('user', 'firstName email').limit(deps.limit);
  const summary = { checked: 0, sent: 0, failed: 0 };
  for (const order of orders) {
    const result = await deps.notify(order, { now: deps.now });
    summary.checked += 1;
    if (result.status === 'sent') summary.sent += 1;
    if (result.status === 'failed') summary.failed += 1;
  }
  return summary;
}

// The server runs it on its own timer (as it does the e-Transfer sweep), at most once an hour, and never throws.
const RETRY_EVERY_MS = 60 * 60 * 1000;
let lastRetryAt = 0;
let retrying = false;
async function retryUntrackedShipmentNoticesThrottled({ now = Date.now(), run = retryUntrackedShipmentNotices } = {}) {
  if (retrying || now - lastRetryAt < RETRY_EVERY_MS) return null;
  retrying = true;
  lastRetryAt = now;
  try {
    const summary = await run();
    if (summary && (summary.sent || summary.failed)) console.log(`Untracked shipment emails: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    console.error('Untracked shipment email retry failed:', err.message);
    return null;
  } finally {
    retrying = false;
  }
}
const resetRetryThrottleForTest = () => { lastRetryAt = 0; retrying = false; };

module.exports = {
  notifyShipment, retryUntrackedShipmentNotices, retryUntrackedShipmentNoticesThrottled, resetRetryThrottleForTest,
  CLAIM_MS, UNTRACKED_RETRY_DAYS,
};
