// A paid Stripe line that no product matched is kept on the order as a placeholder item (fulfillCheckoutSession in routes/stripe.js)
// and the order is held until the owner has checked the payment. The placeholder's slug starts with this prefix (and legacy/partial rows
// can be identified by their STRIPE- SKU); everything that has to tell it from a real product uses this one definition. The admin front end keeps its own copy (frontend/src/lib/orderItems.js)
// and a test (frontend/test/admin-blocked-order.test.js) keeps the two equal.
const UNMATCHED_SLUG_PREFIX = 'stripe-unmatched-';

const isUnmatchedItem = (item) => String(item?.slug || '').startsWith(UNMATCHED_SLUG_PREFIX)
  || String(item?.sku || '').startsWith('STRIPE-');

module.exports = { UNMATCHED_SLUG_PREFIX, isUnmatchedItem };
