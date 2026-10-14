// How an order's payment reads in the admin: one label and a "needs you" flag, from the order's own fields. The server's
// rules (utils/orderTransitions.js) are what actually stop an unpaid order from shipping; this only tells the owner which
// orders are waiting on money and what kind.

export const METHOD_NAMES = { stripe: 'Card (Stripe)', bank_debit: 'Bank debit (Stripe)', etransfer: 'Interac e-Transfer' };

export function paymentState(order) {
  const method = order?.paymentMethod || 'stripe';
  const paid = order?.paymentStatus === 'paid';
  const expired = method === 'etransfer' && order?.status === 'cancelled' && Boolean(order?.etransfer?.expiredAt) && order?.paymentStatus === 'pending';
  if (order?.paymentStatus === 'refunded' || order?.status === 'refunded') return { key: 'refunded', label: 'Refunded', tone: 'muted', needsYou: false };
  if (paid) return { key: 'paid', label: 'Paid', tone: 'ok', needsYou: false };
  if (order?.paymentStatus === 'failed') return { key: 'failed', label: 'Payment failed', tone: 'bad', needsYou: false };
  if (expired) return { key: 'etransfer_expired', label: 'e-Transfer hold ended', tone: 'muted', needsYou: false };
  if (method === 'etransfer' && order?.status === 'pending') return { key: 'etransfer_waiting', label: 'Waiting for e-Transfer', tone: 'warn', needsYou: true };
  if (method === 'bank_debit' && order?.status === 'pending') return { key: 'bank_debit_clearing', label: 'Bank debit clearing', tone: 'warn', needsYou: false };
  if (order?.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'muted', needsYou: false };
  return { key: 'unpaid', label: 'Not paid', tone: 'warn', needsYou: false };
}

// The same order may be shown in a list: only the states that are not a plain paid card order need a second label there.
// (An unpaid order that was cancelled already says "cancelled" as its status: a second "Cancelled" beside it adds nothing.)
export const showPaymentLabel = (order) => {
  const key = paymentState(order).key;
  if (key === 'cancelled') return false;
  return key !== 'paid' || Boolean(order?.paymentMethod && order.paymentMethod !== 'stripe');
};

export const TONE_CLASS = { ok: 'pill-accent', warn: 'pill-amber', bad: 'text-red-500', muted: 'text-neutral-500' };

// Stripe's dashboard page for a payment, for checking on a clearing bank debit.
export const stripePaymentUrl = (order) => (order?.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${encodeURIComponent(order.stripePaymentIntentId)}` : null);

// ── Disputes ─────────────────────────────────────────────────────────────────────────────────────────────────
// A dispute (chargeback) or a bank inquiry on this order's payment, as the server keeps it (backend/src/utils/disputes.js). It is
// a second fact beside paymentState, not a replacement: the order is still paid and its status is the owner's to change.
const DISPUTE_SHORT_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' });
const disputeMoney = (value) => `$${Number(value || 0).toFixed(2)} CAD`;

export function disputeState(order) {
  const dispute = order?.dispute;
  if (!dispute?.id) return null;
  const status = String(dispute.status || '');
  const amount = disputeMoney(dispute.amount);
  const reason = dispute.reasonText || dispute.reason || 'the bank gave no reason';
  const dueDate = dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null;
  const due = dueDate && Number.isFinite(dueDate.getTime()) ? DISPUTE_SHORT_DATE.format(dueDate) : null;
  // What to do with the order itself, which depends on whether the parcel has gone.
  const advice = ['shipped', 'delivered'].includes(order.status)
    ? 'Send the tracking number and proof of delivery as evidence.'
    : (['pending', 'processing'].includes(order.status) ? 'Do not ship this order.' : '');
  const join = (...parts) => parts.filter(Boolean).join(' ');
  switch (status) {
    case 'needs_response':
      return { key: 'open', label: 'Disputed', tone: 'bad', needsYou: true, headline: `Disputed: ${reason}`, text: join(`Stripe took ${amount} back until this is settled.`, due ? `Send your evidence in Stripe by ${due}.` : 'Send your evidence in Stripe.', advice) };
    case 'under_review':
      return { key: 'open', label: 'Disputed', tone: 'bad', needsYou: false, headline: `Disputed: ${reason}`, text: join(`Your evidence is with the bank. Stripe took ${amount} back until they decide.`, advice) };
    case 'warning_needs_response':
      return { key: 'inquiry', label: 'Bank inquiry', tone: 'warn', needsYou: true, headline: `The bank is asking about this payment: ${reason}`, text: join('No money has been taken.', due ? `Answer in Stripe by ${due} so it does not become a dispute.` : 'Answer in Stripe so it does not become a dispute.', advice) };
    case 'warning_under_review':
      return { key: 'inquiry', label: 'Bank inquiry', tone: 'warn', needsYou: false, headline: `The bank is asking about this payment: ${reason}`, text: 'Your answer is with the bank. No money has been taken.' };
    case 'lost':
      return { key: 'lost', label: 'Dispute lost', tone: 'bad', needsYou: false, headline: `Dispute lost: ${reason}`, text: `The bank decided against you. ${amount} was not returned.` };
    case 'won':
      return { key: 'won', label: 'Dispute won', tone: 'ok', needsYou: false, headline: 'Dispute won', text: 'The bank decided in your favour. The money stays with you.' };
    case 'warning_closed':
      return { key: 'inquiry_closed', label: 'Inquiry closed', tone: 'muted', needsYou: false, headline: 'Bank inquiry closed', text: 'The bank closed its question. No money was taken.' };
    case 'prevented':
      return { key: 'prevented', label: 'Dispute prevented', tone: 'muted', needsYou: false, headline: 'Dispute prevented', text: 'It was stopped before it began.' };
    default:
      return { key: 'other', label: 'Dispute', tone: 'warn', needsYou: false, headline: `Dispute: ${reason}`, text: `Status in Stripe: ${status || 'unknown'}.` };
  }
}

// `.pill` sets its own colour, which wins over a text colour utility: a pill needs a pill class (pill-red is for bad news).
export const DISPUTE_PILL_CLASS = { bad: 'pill-red', warn: 'pill-amber', ok: 'pill-accent', muted: '' };

// The dispute in Stripe's dashboard, where evidence is sent.
export const stripeDisputeUrl = (order) => (order?.dispute?.id ? `https://dashboard.stripe.com/disputes/${encodeURIComponent(order.dispute.id)}` : null);
