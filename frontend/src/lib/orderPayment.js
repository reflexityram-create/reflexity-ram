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
export const showPaymentLabel = (order) => paymentState(order).key !== 'paid' || (order?.paymentMethod && order.paymentMethod !== 'stripe');

export const TONE_CLASS = { ok: 'pill-accent', warn: 'pill-amber', bad: 'text-red-500', muted: 'text-neutral-500' };

// Stripe's dashboard page for a payment, for checking on a clearing bank debit.
export const stripePaymentUrl = (order) => (order?.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${encodeURIComponent(order.stripePaymentIntentId)}` : null);
