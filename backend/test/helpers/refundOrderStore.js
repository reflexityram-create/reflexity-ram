// A one-order stand-in for Order.findOne / Order.findOneAndUpdate for the hermetic refund tests. It behaves like MongoDB for exactly the
// two conditions utils/refunds.js writes with, and answers null (no document matched) like MongoDB does when they do not hold:
//   { paymentStatus: { $ne: 'refunded' } }                    a full refund changes an order that is not refunded yet
//   { 'statusHistory.note': { $ne: note } }                   a partial refund adds its line unless a line with that note is there (array semantics)
// The full-refund path tries a stock-taken branch first, then the complement branch; this keeps the route-level tests fast and database-free.
function refundOrderStore(order) {
  const updates = [];
  return {
    updates,
    findOne: async () => order,
    findOneAndUpdate: async (filter, update, options = {}) => {
      updates.push({ filter, update });
      if (filter.paymentStatus?.$ne !== undefined && order.paymentStatus === filter.paymentStatus.$ne) return null;
      if (filter.stockDecremented === true && order.stockDecremented !== true) return null;
      if (filter.status?.$in && !filter.status.$in.includes(order.status)) return null;
      if (filter.$or && !filter.$or.some((branch) => (branch.stockDecremented?.$ne === true && order.stockDecremented !== true) || (branch.status?.$nin && !branch.status.$nin.includes(order.status)))) return null;
      const note = filter['statusHistory.note']?.$ne;
      if (note !== undefined && (order.statusHistory || []).some((line) => line.note === note)) return null;
      const before = { ...order, statusHistory: [...(order.statusHistory || [])] };
      Object.assign(order, update.$set || {});
      if (update.$push?.statusHistory) (order.statusHistory ||= []).push(update.$push.statusHistory);
      return options.returnDocument === 'before' ? before : order;
    },
  };
}

module.exports = { refundOrderStore };
