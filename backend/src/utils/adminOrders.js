// What the admin Orders page can ask for. The page shows EVERY order: nothing is hidden or archived. A "view" only narrows
// the list, and the counts beside the views tell the owner at a glance what needs him.
//
// Each view is a function so every request gets its own filter object (Mongoose may rewrite a filter it is given).

const VIEWS = Object.freeze({
  all: () => ({}),
  // Placed but not paid yet: an e-Transfer to watch for, or a bank debit still clearing.
  awaiting: () => ({ paymentStatus: 'pending', status: 'pending' }),
  // Paid, and waiting for the owner to ship it.
  toship: () => ({ paymentStatus: 'paid', status: { $in: ['pending', 'processing'] } }),
  shipped: () => ({ status: 'shipped' }),
  delivered: () => ({ status: 'delivered' }),
  // Cancelled (by hand, a failed payment or an e-Transfer that never came) or refunded.
  closed: () => ({ status: { $in: ['cancelled', 'refunded'] } }),
});

const VIEW_NAMES = Object.freeze(Object.keys(VIEWS));
const isView = (name) => typeof name === 'string' && Object.hasOwn(VIEWS, name);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `view` is the Orders page's filter. `status` and `payment=awaiting` are the older separate parameters, still honoured
// when no view is given.
function ordersFilter({ view, status, payment, search } = {}) {
  let filter;
  if (isView(view)) {
    filter = VIEWS[view]();
  } else {
    filter = {};
    if (status) filter.status = status;
    if (payment === 'awaiting') Object.assign(filter, VIEWS.awaiting());
  }
  if (search) {
    const escaped = escapeRegex(search);
    filter.$or = [
      { orderNumber: { $regex: escaped, $options: 'i' } },
      { guestEmail: { $regex: escaped, $options: 'i' } },
    ];
  }
  return filter;
}

// How many orders each view holds, whatever view is open.
async function orderCounts(Order) {
  const entries = await Promise.all(VIEW_NAMES.map(async (name) => [name, await Order.countDocuments(VIEWS[name]())]));
  return Object.fromEntries(entries);
}

module.exports = { VIEWS, VIEW_NAMES, isView, ordersFilter, orderCounts };
