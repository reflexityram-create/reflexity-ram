export const NEXT_STATUS = Object.freeze({
  pending: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
});

export function statusOptions(order) {
  const current = order?.status;
  if (!current) return [];
  const next = NEXT_STATUS[current] || [];
  const allowed = order.paymentStatus === 'paid'
    ? next.filter((status) => status !== 'cancelled')
    : next.filter((status) => status === 'cancelled');
  return [current, ...allowed.filter((status) => status !== current && status !== 'refunded')];
}
