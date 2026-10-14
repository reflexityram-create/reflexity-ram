// ─── Disputes (chargebacks) and bank inquiries ───────────────────────────────────────────────────────────────────────
// When a buyer's bank disputes a payment, Stripe takes the money back at once and gives the owner a deadline to send evidence;
// missing it loses the dispute by default. Stripe emails the owner, but nothing on the site knew: the order stayed "paid" and
// ready to ship, no alert reached the phone, and the deadline lived only in an email. Stripe reports each step through three
// events (charge.dispute.created / .updated / .closed, routes/stripe.js). This keeps the order's `dispute` up to date and
// alerts the owner when something needs them.
//
// It changes nothing else: not the order's status, not its stock, not any money. What to do about a dispute (send evidence,
// refund, accept it) is the owner's call, made in Stripe; the site only makes sure the owner cannot miss it.

const Order = require('../models/Order');
const AdminEvent = require('../models/AdminEvent');
const { recordAdminEvent, describeOrder, money } = require('./adminEvents');
const { cancelReviewRequest } = require('./reviewRequests');

// What the bank said, in words for the owner (Stripe's categories: https://docs.stripe.com/disputes/categories).
const REASON_TEXT = {
  fraudulent: 'the buyer says they did not make this payment',
  unrecognized: 'the buyer does not recognize the charge',
  product_not_received: 'the buyer says the order never arrived',
  product_unacceptable: 'the buyer says the order was not as described',
  duplicate: 'the buyer says they were charged twice',
  credit_not_processed: 'the buyer says a refund they were owed never came',
  debit_not_authorized: 'the buyer says they did not authorize this debit',
  customer_initiated: 'the buyer asked their bank to reverse it',
  general: 'the bank gave no specific reason',
};
const reasonText = (reason) => REASON_TEXT[reason] || (reason ? `the bank's reason code is "${String(reason).slice(0, 40)}"` : 'the bank gave no reason');

// Statuses after which Stripe sends nothing more about that dispute.
const TERMINAL = new Set(['won', 'lost', 'warning_closed', 'prevented']);
// An inquiry (`warning_*`) is the bank asking a question first: no money is taken yet, but unanswered it can become a dispute.
const isInquiry = (status) => String(status || '').startsWith('warning_');

// How far along a dispute is, for events made in the same second (Stripe's clock has no finer grain): a dispute never goes backwards
// through these stages. An inquiry (`warning_*`) and a dispute are different objects with their own ids and their own stages.
const STAGE = { warning_needs_response: 0, needs_response: 0, warning_under_review: 1, under_review: 1, warning_closed: 2, won: 2, lost: 2, prevented: 2 };
const stageOf = (status) => STAGE[status] ?? 0;
const statusesBeyond = (status) => Object.keys(STAGE).filter((name) => STAGE[name] > stageOf(status));

// The order may take this event when nothing newer is stored on it. By time, whatever dispute it is about (a late event about an older
// inquiry must not replace the real dispute that opened after it). In the very same second: a different dispute is just the latest
// to arrive, and the same dispute is taken unless it would move it backwards (an event seen twice is taken again, harmlessly).
const notOlderThanStored = (facts) => ({
  $or: [
    { 'dispute.eventAt': { $exists: false } },
    { 'dispute.eventAt': { $lt: facts.eventAt } },
    { 'dispute.eventAt': facts.eventAt, 'dispute.id': { $ne: facts.id } },
    { 'dispute.eventAt': facts.eventAt, 'dispute.id': facts.id, 'dispute.status': { $nin: statusesBeyond(facts.status) } },
  ],
});

const toDate = (seconds) => {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000) : undefined;
};
// "Oct 28", in the owner's time zone.
const day = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' }).format(date);

// What is kept on the order. `event.created` orders the events: Stripe may deliver them late and out of order.
function disputeFacts(dispute, event = {}) {
  const status = String(dispute.status || '');
  const eventAt = toDate(event.created) || new Date();
  return {
    id: String(dispute.id),
    status,
    reason: String(dispute.reason || ''),
    reasonText: reasonText(dispute.reason),
    amount: Math.round(Number(dispute.amount) || 0) / 100,
    currency: String(dispute.currency || 'cad').toLowerCase(),
    openedAt: toDate(dispute.created),
    evidenceDueBy: toDate(dispute.evidence_details?.due_by),
    ...(TERMINAL.has(status) ? { closedAt: eventAt } : {}),
    eventAt,
  };
}

const idOf = (value) => (value && typeof value === 'object' ? value.id : value) || null;

// The alert for a dispute in this state, or null when this state is not worth one. It goes on a lock screen: order number, amount,
// items and the bank's reason only, never the buyer's name, email, phone or address. A key makes it once per dispute and kind.
function alertFor(facts, order) {
  const due = facts.evidenceDueBy ? ` Send evidence in Stripe by ${day(facts.evidenceDueBy)}.` : '';
  const withOrder = (text) => `${describeOrder(order)} · ${text}`;
  const shipped = ['shipped', 'delivered'].includes(order.status);
  const toDo = shipped ? ' Send the tracking and proof of delivery.' : (['pending', 'processing'].includes(order.status) ? ' Do not ship it.' : '');
  switch (facts.status) {
    case 'needs_response':
    case 'under_review':
      return {
        type: 'order.dispute_opened', priority: 'high', dedupeKey: `order.dispute_opened:${facts.id}`,
        title: 'Dispute opened on an order',
        body: withOrder(`${facts.reasonText}. Stripe took ${money(facts.amount)} back until it is settled.${due}${toDo}`),
      };
    case 'warning_needs_response':
    case 'warning_under_review':
      return {
        type: 'order.dispute_inquiry', priority: 'high', dedupeKey: `order.dispute_inquiry:${facts.id}`,
        title: 'The buyer\'s bank is asking about an order',
        body: withOrder(`${facts.reasonText}. No money is taken yet, but unanswered it can become a dispute.${due}${toDo}`),
      };
    case 'won':
      return { type: 'order.dispute_won', priority: 'normal', dedupeKey: `order.dispute_closed:${facts.id}`, title: 'Dispute won', body: withOrder('the money stays with you.') };
    case 'lost':
      return { type: 'order.dispute_lost', priority: 'high', dedupeKey: `order.dispute_closed:${facts.id}`, title: 'Dispute lost', body: withOrder(`${money(facts.amount)} was not returned.`) };
    case 'warning_closed':
      return { type: 'order.dispute_inquiry_closed', priority: 'low', dedupeKey: `order.dispute_closed:${facts.id}`, title: 'Bank inquiry closed', body: withOrder('no money was taken.') };
    case 'prevented':
      return { type: 'order.dispute_prevented', priority: 'low', dedupeKey: `order.dispute_closed:${facts.id}`, title: 'Dispute prevented', body: withOrder('it was stopped before it began.') };
    default:
      return null;
  }
}

/**
 * Apply one charge.dispute.created / .updated / .closed event. Safe to run again for the same event (the write sets the same
 * values, the alert has a key) and for events that arrive late or out of order (an older one never overwrites a newer one,
 * even when it is about a different dispute on the same order).
 * Returns { matched, applied }. A database error, or an alert that could not be written, throws: the webhook answers 500 and Stripe
 * sends the event again (an event that is by then out of date is simply ignored; the newer one has its own alert).
 */
async function recordDisputeEvent(event, {
  OrderModel = Order, record = recordAdminEvent, cancelReview = cancelReviewRequest, alertExists = (key) => AdminEvent.exists({ dedupeKey: key }), logger = console,
} = {}) {
  // recordAdminEvent never throws and answers null both when the owner was already told and when the alert could not be written.
  // For this message (it has a deadline) the second must not pass for the first: the webhook fails, and Stripe sends the event again.
  const announce = async (alert) => {
    if (await record(alert)) return;
    if (!(await alertExists(alert.dedupeKey))) throw new Error(`The "${alert.type}" alert for ${alert.dedupeKey} could not be recorded`);
  };
  const dispute = event?.data?.object;
  if (!dispute?.id) {
    logger.warn?.(`Dispute event ${event?.id || ''} has no dispute: ignored`);
    return { matched: false, applied: false };
  }
  const facts = disputeFacts(dispute, event);
  const chargeId = idOf(dispute.charge);
  const intentId = idOf(dispute.payment_intent);
  const lookups = [...(chargeId ? [{ stripeChargeId: chargeId }] : []), ...(intentId ? [{ stripePaymentIntentId: intentId }] : [])];
  const order = lookups.length ? await OrderModel.findOne({ $or: lookups }).lean() : null;

  if (!order) {
    // Money was taken back for a payment the shop has no order for: the owner must hear about it all the same.
    logger.warn?.(`⚠️  Dispute ${facts.id} matches no order (charge ${chargeId || '-'}, payment ${intentId || '-'})`);
    await announce({
      type: 'payment.dispute_unmatched', priority: 'high', dedupeKey: `payment.dispute_unmatched:${facts.id}`,
      title: 'Dispute on a payment with no order',
      body: `Stripe dispute ${facts.id} · ${money(facts.amount)} ${facts.currency.toUpperCase()} · ${facts.reasonText}.${facts.evidenceDueBy ? ` Send evidence in Stripe by ${day(facts.evidenceDueBy)}.` : ''}`,
      path: '/admin/orders',
    });
    return { matched: false, applied: false };
  }

  // One atomic write that only goes ahead if nothing newer is stored.
  const applied = await OrderModel.findOneAndUpdate(
    { _id: order._id, ...notOlderThanStored(facts) },
    { $set: { dispute: facts } },
    { returnDocument: 'after', timestamps: false },
  );
  if (!applied) {
    logger.log?.(`Dispute ${facts.id} (${facts.status}) on order ${order.orderNumber}: a newer event is already recorded, this one is ignored`);
    return { matched: true, applied: false };
  }
  logger.log?.(`⚖️  Dispute ${facts.id} on order ${order.orderNumber}: ${facts.status} (${facts.reason})`);

  // Don't ask a buyer who is disputing the payment how the order went (the email is only scheduled, so it can still be cancelled).
  // A dispute won, or an inquiry that closed without one, leaves it as it was.
  if (!['won', 'warning_closed', 'prevented'].includes(facts.status)) {
    // (Read from the order as the write left it, so an email scheduled a moment ago is seen.)
    try { await cancelReview(applied); } catch (err) { logger.error?.(`Review email cancel failed for order ${order.orderNumber}:`, err.message); }
  }

  const alert = alertFor(facts, order);
  if (alert) await announce({ ...alert, order });
  return { matched: true, applied: true };
}

module.exports = { recordDisputeEvent, disputeFacts, alertFor, reasonText, isInquiry, notOlderThanStored, TERMINAL, REASON_TEXT };
