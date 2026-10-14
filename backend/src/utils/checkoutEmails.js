const Order = require('../models/Order');
const { sendOrderConfirmationEmail, sendPaymentNoticeEmail } = require('./email');

const LEASE_MS = 5 * 60 * 1000;
// Resend deduplicates for 24 hours. Stop automatic retries before that window
// ends: an ambiguous accepted send must never become a second email days later.
const RETRY_MS = 23 * 60 * 60 * 1000;
const SLOTS = ['checkoutEmail', 'bankDebitClearedEmail'];
const pendingCheckoutEmail = (email, kind, now = new Date()) => email ? {
  email, kind, status: 'pending', queuedAt: now,
} : undefined;

async function deliverCheckoutEmail(order, slot = 'checkoutEmail', overrides = {}) {
  if (!SLOTS.includes(slot)) throw new Error('Unknown checkout email slot');
  if (!order?.[slot]?.email || order[slot].status === 'sent') return { status: 'unchanged' };
  const d = { Order, confirm: sendOrderConfirmationEmail, notice: sendPaymentNoticeEmail, now: () => new Date(), ready: false, ...overrides };
  const now = d.now();
  const claimed = await d.Order.findOneAndUpdate({
    _id: order._id, ...(d.ready ? {} : { [`${slot}.ready`]: true }),
    paymentStatus: { $in: slot === 'bankDebitClearedEmail' || order[slot].kind === 'confirmation' ? ['paid'] : ['pending'] },
    status: { $in: ['pending', 'processing', 'shipped', 'delivered'] },
    [`${slot}.queuedAt`]: { $gt: new Date(now - RETRY_MS) },
    $or: [
      { [`${slot}.status`]: { $in: ['pending', 'failed'] } },
      { [`${slot}.status`]: 'sending', [`${slot}.claimedAt`]: { $lt: new Date(now - LEASE_MS) } },
    ],
  }, { $set: { [`${slot}.ready`]: true, [`${slot}.status`]: 'sending', [`${slot}.claimedAt`]: now } }, { returnDocument: 'after', timestamps: false });
  if (!claimed) return { status: 'unchanged' };
  const receipt = claimed[slot];
  const filter = { _id: order._id, [`${slot}.status`]: 'sending', [`${slot}.claimedAt`]: now };
  try {
    const args = { email: receipt.email, firstName: claimed.shippingAddress?.firstName, order: claimed,
      idempotencyKey: `checkout-email:${order._id}:${slot}` };
    if (receipt.kind === 'confirmation') await d.confirm(args);
    else await d.notice({ ...args, kind: receipt.kind });
    await d.Order.updateOne(filter, { $set: { [`${slot}.status`]: 'sent', [`${slot}.sentAt`]: now } }, { timestamps: false });
    return { status: 'sent' };
  } catch (err) {
    await d.Order.updateOne(filter, { $set: { [`${slot}.status`]: 'failed' } }, { timestamps: false });
    // Do not log provider response bodies, recipient addresses or access links.
    console.error(`Checkout email ${slot} for order ${order.orderNumber} needs retry`);
    return { status: 'failed' };
  }
}

async function retryCheckoutEmails({ recover } = {}) {
  const now = new Date();
  for (const slot of SLOTS) {
    const orders = await Order.find({
      [`${slot}.queuedAt`]: { $gt: new Date(now - RETRY_MS) },
      [`${slot}.status`]: { $in: ['pending', 'failed', 'sending'] },
      $or: [{ [`${slot}.claimedAt`]: { $exists: false } }, { [`${slot}.claimedAt`]: { $lt: new Date(now - LEASE_MS) } }],
    }).sort({ [`${slot}.claimedAt`]: 1, _id: 1 }).limit(25);
    for (const order of orders) {
      if (!order[slot].ready && recover) await recover(order.stripeCheckoutSessionId);
      else await deliverCheckoutEmail(order, slot);
    }
  }
}

module.exports = { pendingCheckoutEmail, deliverCheckoutEmail, retryCheckoutEmails, LEASE_MS, RETRY_MS };
