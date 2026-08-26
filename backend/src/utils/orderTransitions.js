const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

const ALLOWED_ORDER_TRANSITIONS = Object.freeze({
  pending: new Set(['processing', 'cancelled']),
  processing: new Set(['shipped', 'cancelled']),
  shipped: new Set(['delivered']),
  delivered: new Set(),
  cancelled: new Set(),
  refunded: new Set(),
});

const canTransitionOrder = (from, to, paymentStatus) => {
  if (!ALLOWED_ORDER_TRANSITIONS[from] || !ORDER_STATUSES.includes(to)) return false;
  if (from === to) return false;
  // Paid cancellations require the payment-provider refund path.
  if (to === 'cancelled' && paymentStatus === 'paid') return false;
  // Manual fulfillment cannot advance an unpaid order. Payment webhooks must
  // establish the paid state before staff can process or ship it.
  if (['processing', 'shipped', 'delivered'].includes(to) && paymentStatus !== 'paid') return false;
  return ALLOWED_ORDER_TRANSITIONS[from].has(to);
};

module.exports = { ORDER_STATUSES, ALLOWED_ORDER_TRANSITIONS, canTransitionOrder };
