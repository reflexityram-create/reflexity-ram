const Order = require('../models/Order');
const User = require('../models/User');
const ReviewEmailOptOut = require('../models/ReviewEmailOptOut');
const { sendReviewRequestEmail, cancelScheduledEmail } = require('./email');
const { createReviewToken, reviewPageUrl } = require('./reviewLinks');

const DAY_MS = 24 * 60 * 60 * 1000;
// Orders arrive 3-6 business days after dispatch (config/shipping.js), so ten
// days after shipping the buyer has had the parts for a few days.
const DEFAULT_DELAY_DAYS = 10;
// Resend holds a scheduled email for at most 30 days.
const MAX_SCHEDULE_DAYS = 29;
const REVIEWABLE_STATUSES = new Set(['shipped', 'delivered']);

function delayDays() {
  const raw = process.env.REVIEW_REQUEST_DELAY_DAYS;
  const value = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_DAYS
    ? value
    : DEFAULT_DELAY_DAYS;
}

const orderEmail = (order) => String(order?.user?.email || order?.guestEmail || '').trim().toLowerCase();
const orderFirstName = (order) => order?.user?.firstName || order?.shippingAddress?.firstName || '';
const isReviewableOrder = (order) => order?.paymentStatus === 'paid' && REVIEWABLE_STATUSES.has(order?.status);

/**
 * Send the order's single "how was your order?" email. By default Resend holds
 * it until REVIEW_REQUEST_DELAY_DAYS after shipping; pass `sendAt: now` to send
 * it straight away. Returns { status: 'scheduled' | 'sent' | 'skipped', ... }.
 */
async function scheduleReviewRequest(order, {
  sendAt,
  now = new Date(),
  frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173',
} = {}) {
  if (!isReviewableOrder(order)) return { status: 'skipped', reason: 'not-reviewable' };
  const email = orderEmail(order);
  if (!email) return { status: 'skipped', reason: 'no-email' };
  if (await ReviewEmailOptOut.exists({ email })) return { status: 'skipped', reason: 'opted-out' };

  const target = sendAt
    ? new Date(sendAt)
    : new Date(new Date(order.shippedAt || now).getTime() + delayDays() * DAY_MS);
  const latest = new Date(now.getTime() + MAX_SCHEDULE_DAYS * DAY_MS);
  const deliverAt = target > latest ? latest : target;
  // Anything due within the next minute simply goes out now.
  const scheduled = deliverAt.getTime() > now.getTime() + 60 * 1000;

  // Exactly-once claim: only the request that sets claimedAt sends the email.
  const claim = await Order.updateOne(
    { _id: order._id, 'reviewRequest.claimedAt': null },
    { $set: { 'reviewRequest.claimedAt': now }, $unset: { 'reviewRequest.lastError': '' } },
  );
  if (claim.modifiedCount !== 1) return { status: 'skipped', reason: 'already-requested' };

  const token = createReviewToken(order._id, { now: now.getTime() });
  try {
    const sent = await sendReviewRequestEmail({
      email,
      firstName: orderFirstName(order),
      order,
      reviewUrl: reviewPageUrl(frontendUrl, token),
      unsubscribeUrl: reviewPageUrl(frontendUrl, token, { unsubscribe: true }),
      scheduledAt: scheduled ? deliverAt : undefined,
    });
    const scheduledFor = scheduled ? deliverAt : now;
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          'reviewRequest.scheduledFor': scheduledFor,
          ...(sent?.id ? { 'reviewRequest.emailId': sent.id } : {}),
        },
      },
    );
    return { status: scheduled ? 'scheduled' : 'sent', scheduledFor };
  } catch (err) {
    // Release the claim so the order screen can retry it.
    await Order.updateOne(
      { _id: order._id },
      {
        $unset: { 'reviewRequest.claimedAt': '' },
        $set: { 'reviewRequest.lastError': String(err.message || err).slice(0, 300) },
      },
    );
    throw err;
  }
}

/** Cancel a review email Resend is still holding. Returns true if one was cancelled. */
async function cancelReviewRequest(order, { now = new Date() } = {}) {
  const request = order?.reviewRequest;
  if (!request?.emailId || request.cancelledAt || !request.scheduledFor) return false;
  if (new Date(request.scheduledFor) <= now) return false;
  await cancelScheduledEmail(request.emailId);
  await Order.updateOne({ _id: order._id }, { $set: { 'reviewRequest.cancelledAt': now } });
  return true;
}

/** After an unsubscribe, stop any review email still waiting to go to that address. */
async function cancelPendingReviewRequestsFor(email, { now = new Date() } = {}) {
  const users = await User.find({ email }).select('_id').lean();
  const pending = await Order.find({
    $or: [{ guestEmail: email }, { user: { $in: users.map((user) => user._id) } }],
    'reviewRequest.emailId': { $exists: true },
    'reviewRequest.cancelledAt': null,
    'reviewRequest.scheduledFor': { $gt: now },
  }).select('reviewRequest').lean();

  let cancelled = 0;
  for (const order of pending) {
    try {
      if (await cancelReviewRequest(order, { now })) cancelled += 1;
    } catch (err) {
      console.error(`Could not cancel the review email for order ${order._id}:`, err.message);
    }
  }
  return cancelled;
}

module.exports = {
  DEFAULT_DELAY_DAYS,
  isReviewableOrder,
  orderEmail,
  orderFirstName,
  scheduleReviewRequest,
  cancelReviewRequest,
  cancelPendingReviewRequestsFor,
};
