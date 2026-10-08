// ─── Canada Post tracking sync ─────────────────────────────────────────────────
// POST /api/tracking/sync runs this every 15 minutes (GitHub Actions schedule,
// because the Render free plan sleeps). For each paid tracked order it stores the
// latest scan, marks accepted parcels shipped and the order delivered when Canada Post says so, and emails
// the buyer once each for "out for delivery", "waiting at the post office" and
// "delivered".

const Order = require('../models/Order');
const { trackParcel } = require('./canadaPost');
const { sendTrackingUpdateEmail } = require('./email');
const { canTransitionOrder } = require('./orderTransitions');
const { notifyShipment } = require('./shippingNotifications');
const { scheduleReviewRequest } = require('./reviewRequests');

const RECHECK_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Canada Post dates are yyyy-mm-dd in the parcel's local time; noon UTC keeps
// the calendar day right in every Canadian time zone.
const dayToDate = (day) => (day ? new Date(`${day}T12:00:00Z`) : null);
// No late emails: the scheduler can miss runs, and a parcel delivered a week
// ago should not produce a "delivered" email today.
const isRecent = (day, now, days) => {
  const date = dayToDate(day);
  return Boolean(date) && now - date >= -DAY_MS && now - date < days * DAY_MS;
};

const recipientFor = (order) => ({
  email: order.user?.email || order.guestEmail,
  firstName: order.user?.firstName || order.shippingAddress?.firstName,
});

// Claim the order's once-only flag, then send. A failed send releases the
// claim so the next run tries again.
const sendOnce = async (order, flag, kind, deps) => {
  const { email, firstName } = recipientFor(order);
  if (!email) return false;
  const now = deps.now();
  const claimed = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'paid', status: { $in: ['shipped', 'delivered'] }, [flag]: null }, { $set: { [flag]: now } });
  if (!claimed) return false;
  try {
    await deps.sendEmail({ email, firstName, order, kind });
    return true;
  } catch (err) {
    await Order.updateOne({ _id: order._id, [flag]: now }, { $unset: { [flag]: '' } });
    console.error(`Tracking email (${kind}) failed for ${order.orderNumber}:`, err.message);
    return false;
  }
};

const syncOrder = async (order, deps) => {
  const result = { delivered: false, emails: [] };
  if (order.paymentStatus !== 'paid' || !['pending', 'processing', 'shipped', 'delivered'].includes(order.status)) return result;
  const tracking = await deps.trackParcel(order.trackingNumber);
  const now = deps.now();
  const saved = await Order.updateOne({ _id: order._id, status: order.status, paymentStatus: 'paid', trackingNumber: order.trackingNumber }, {
    $set: {
      trackingLatest: {
        ...(tracking.latest || {}),
        expectedDeliveryDate: tracking.expectedDeliveryDate || '',
        checkedAt: now,
      },
    },
  });
  if (saved.matchedCount === 0) return result; // tracking/status changed during the lookup

  if (tracking.hasShipped && canTransitionOrder(order.status, 'shipped', order.paymentStatus)) {
    const moved = await Order.updateOne({ _id: order._id, status: order.status, paymentStatus: 'paid', trackingNumber: order.trackingNumber }, {
      $set: { status: 'shipped', shippedAt: dayToDate(tracking.shippedOn) || now,
        'shippingNotification.status': tracking.delivered ? 'skipped' : 'pending' },
      $push: { statusHistory: { status: 'shipped', note: 'Shipped (Canada Post acceptance scan)', timestamp: now } },
    });
    if (moved.modifiedCount !== 1) return result;
    order.status = 'shipped';
    order.shippedAt = dayToDate(tracking.shippedOn) || now;
    order.trackingLatest = { ...(tracking.latest || {}), expectedDeliveryDate: tracking.expectedDeliveryDate || '', checkedAt: now };
    if (!tracking.delivered) {
      try { await deps.scheduleReview(order); } catch { console.error(`Review scheduling failed for ${order.orderNumber}`); }
    }
  }
  if (!['shipped', 'delivered'].includes(order.status)) return result;
  if (tracking.delivered) {
    if (canTransitionOrder(order.status, 'delivered', order.paymentStatus)) {
      const moved = await Order.updateOne({ _id: order._id, status: order.status, paymentStatus: 'paid', trackingNumber: order.trackingNumber }, {
        $set: { status: 'delivered', deliveredAt: dayToDate(tracking.deliveredOn) || now },
        $push: { statusHistory: { status: 'delivered', note: 'Delivered (Canada Post tracking)', timestamp: now } },
      });
      result.delivered = moved.modifiedCount === 1;
      if (!result.delivered) return result;
    }
    if (isRecent(tracking.deliveredOn, now, 3) && await sendOnce(order, 'deliveredEmailAt', 'delivered', deps)) {
      result.emails.push('delivered');
    }
  } else if (order.status === 'shipped') {
    const notice = await deps.notifyShipment(order, { now: deps.now });
    if (notice.status === 'sent') result.emails.push('shipped');
    if (tracking.outForDelivery && isRecent(tracking.latest?.date, now, 1)) {
      if (await sendOnce(order, 'outForDeliveryEmailAt', 'outForDelivery', deps)) result.emails.push('outForDelivery');
    } else if (tracking.readyForPickup && isRecent(tracking.latest?.date, now, 3)) {
      if (await sendOnce(order, 'pickupNoticeEmailAt', 'pickup', deps)) result.emails.push('pickup');
    }
  }
  return result;
};

const syncShippedOrders = async (overrides = {}) => {
  const deps = { trackParcel, sendEmail: sendTrackingUpdateEmail, notifyShipment, scheduleReview: scheduleReviewRequest, now: () => new Date(), ...overrides };
  const recheckBefore = new Date(deps.now().getTime() - RECHECK_MS);
  const orders = await Order.find({
    paymentStatus: 'paid',
    trackingNumber: { $exists: true, $nin: [null, ''] },
    $and: [{ $or: [
      { status: { $in: ['pending', 'processing', 'shipped'] } },
      { status: 'delivered', deliveredEmailAt: null, deliveredAt: { $gte: new Date(deps.now() - 3 * DAY_MS) } },
    ] }],
    $or: [
      { 'trackingLatest.checkedAt': { $exists: false } },
      { 'trackingLatest.checkedAt': { $lt: recheckBefore } },
      { status: 'shipped', 'shippingNotification.status': { $in: ['pending', 'failed'] } },
      { status: 'shipped', 'shippingNotification.status': 'sending', 'shippingNotification.claimedAt': { $lt: recheckBefore } },
    ],
  }).sort({ 'trackingLatest.checkedAt': 1 }).populate('user', 'firstName email').limit(50);

  const summary = { checked: 0, delivered: 0, emails: 0, errors: 0 };
  const startedAt = Date.now();
  for (const order of orders) {
    if (Date.now() - startedAt > 110000) break; // leave time for a slow carrier response within the caller deadline
    try {
      const result = await syncOrder(order, deps);
      summary.checked += 1;
      if (result.delivered) summary.delivered += 1;
      summary.emails += result.emails.length;
    } catch (err) {
      summary.errors += 1;
      console.error(`Tracking sync failed for ${order.orderNumber}:`, err.message);
    }
  }
  return summary;
};

module.exports = { syncShippedOrders, syncOrder, RECHECK_MS };
