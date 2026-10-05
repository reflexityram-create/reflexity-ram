// ─── Canada Post tracking sync ─────────────────────────────────────────────────
// POST /api/tracking/sync runs this every few hours (GitHub Actions schedule,
// because the Render free plan sleeps). For each shipped order it stores the
// latest scan, marks the order delivered when Canada Post says so, and emails
// the buyer once each for "out for delivery", "waiting at the post office" and
// "delivered".

const Order = require('../models/Order');
const { trackParcel } = require('./canadaPost');
const { sendTrackingUpdateEmail } = require('./email');
const { canTransitionOrder } = require('./orderTransitions');

const RECHECK_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Canada Post dates are yyyy-mm-dd in the parcel's local time; noon UTC keeps
// the calendar day right in every Canadian time zone.
const dayToDate = (day) => (day ? new Date(`${day}T12:00:00Z`) : null);
// No late emails: the scheduler can miss runs, and a parcel delivered a week
// ago should not produce a "delivered" email today.
const isRecent = (day, now, days) => {
  const date = dayToDate(day);
  return Boolean(date) && now - date < days * DAY_MS;
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
  const claimed = await Order.findOneAndUpdate({ _id: order._id, [flag]: null }, { $set: { [flag]: now } });
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
  const tracking = await deps.trackParcel(order.trackingNumber);
  const now = deps.now();
  await Order.updateOne({ _id: order._id }, {
    $set: {
      trackingLatest: {
        ...(tracking.latest || {}),
        expectedDeliveryDate: tracking.expectedDeliveryDate || '',
        checkedAt: now,
      },
    },
  });

  const result = { delivered: false, emails: [] };
  if (tracking.delivered) {
    if (canTransitionOrder(order.status, 'delivered', order.paymentStatus)) {
      const moved = await Order.updateOne({ _id: order._id, status: order.status }, {
        $set: { status: 'delivered', deliveredAt: dayToDate(tracking.deliveredOn) || now },
        $push: { statusHistory: { status: 'delivered', note: 'Delivered (Canada Post tracking)', timestamp: now } },
      });
      result.delivered = moved.modifiedCount === 1;
    }
    if (isRecent(tracking.deliveredOn, now, 3) && await sendOnce(order, 'deliveredEmailAt', 'delivered', deps)) {
      result.emails.push('delivered');
    }
  } else if (tracking.outForDelivery && isRecent(tracking.latest?.date, now, 1)) {
    if (await sendOnce(order, 'outForDeliveryEmailAt', 'outForDelivery', deps)) result.emails.push('outForDelivery');
  } else if (tracking.readyForPickup && isRecent(tracking.latest?.date, now, 3)) {
    if (await sendOnce(order, 'pickupNoticeEmailAt', 'pickup', deps)) result.emails.push('pickup');
  }
  return result;
};

const syncShippedOrders = async (overrides = {}) => {
  const deps = { trackParcel, sendEmail: sendTrackingUpdateEmail, now: () => new Date(), ...overrides };
  const recheckBefore = new Date(deps.now().getTime() - RECHECK_MS);
  const orders = await Order.find({
    status: 'shipped',
    trackingNumber: { $nin: [null, ''] },
    $or: [
      { 'trackingLatest.checkedAt': { $exists: false } },
      { 'trackingLatest.checkedAt': { $lt: recheckBefore } },
    ],
  }).populate('user', 'firstName email').limit(50);

  const summary = { checked: 0, delivered: 0, emails: 0, errors: 0 };
  for (const order of orders) {
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
