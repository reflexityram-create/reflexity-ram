// The Stripe lines of a paid order that no product matched are kept on the order as placeholder items, and the order is held until the
// owner has checked the payment. The server names a placeholder's slug with this prefix (and legacy/partial rows use a STRIPE- SKU;
// see UNMATCHED_SLUG_PREFIX in
// backend/src/utils/unmatchedItems.js); frontend/test/admin-blocked-order.test.js keeps the two equal.
// Relative-import friendly and free of React, so the unit tests load it straight from Node.
export const UNMATCHED_SLUG_PREFIX = 'stripe-unmatched-';

export const isUnmatchedItem = (item) => String(item?.slug || '').startsWith(UNMATCHED_SLUG_PREFIX)
  || String(item?.sku || '').startsWith('STRIPE-');

export const unmatchedItems = (order) => (Array.isArray(order?.items) ? order.items : []).filter(isUnmatchedItem);
