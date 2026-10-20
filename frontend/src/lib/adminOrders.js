// The rules behind the admin Orders screen, kept free of React so they can be tested without a browser.
//
// The Orders list shows EVERY order. There is no archive: the old Archive button hid a paid order that still had to be
// shipped. A "view" only narrows the list, and the server says how many orders each view holds.
// Relative imports on purpose: the unit tests load this file straight from Node, which does not know the '@/' alias.
import { paymentState } from './orderPayment.js';
import { statusOptions } from './adminOrderStatus.js';
import { unmatchedItems } from './orderItems.js';

// Same names as the server's views (backend/src/utils/adminOrders.js).
export const ORDER_VIEWS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'awaiting', label: 'Awaiting payment', needsYou: true },
  { key: 'toship', label: 'To ship', needsYou: true },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'closed', label: 'Cancelled' },
]);

export const isViewKey = (key) => ORDER_VIEWS.some((view) => view.key === key);
export const countFor = (counts, key) => (counts && Number.isFinite(counts[key]) ? counts[key] : null);

// What the owner does next with an order, in one word. `ship` is only for a PAID order: the server refuses to ship an unpaid one.
export function nextStep(order) {
  if (!order) return { key: 'none' };
  const payment = paymentState(order);
  if (payment.key === 'etransfer_waiting' || payment.key === 'etransfer_expired') return { key: 'collect', payment };
  if (payment.key === 'bank_debit_clearing') return { key: 'clearing', payment };
  const paid = order.paymentStatus === 'paid';
  // A paid order holding a Stripe line no product matched is blocked by the server until the owner has checked the payment in Stripe.
  if (paid && order.fulfillmentBlocked === true && ['pending', 'processing'].includes(order.status)) return { key: 'review', payment };
  if (paid && ['pending', 'processing'].includes(order.status)) return { key: 'ship', payment };
  if (paid && order.status === 'shipped') return { key: 'deliver', payment };
  if (order.status === 'delivered') return { key: 'done', payment };
  if (['cancelled', 'refunded'].includes(order.status)) return { key: 'closed', payment };
  return { key: 'unpaid', payment };
}

// The Stripe lines of a paid order that no product matched are kept as placeholder items (lib/orderItems.js).
export { unmatchedItems };

// An unpaid order can be cancelled by hand (its stock goes back); a paid one only through a refund.
// (statusOptions lists the order's own status first, so an already cancelled order must not count itself.)
export const canCancel = (order) => statusOptions(order).some((status) => status === 'cancelled' && status !== order?.status);

// What the buyer is emailed when the owner does each thing, so the owner never has to guess.
export const BUYER_EMAIL = Object.freeze({
  ship: 'The buyer is emailed right away.',
  shipTracked: 'The buyer is emailed right away, with the tracking link.',
  shipUntracked: 'The buyer is emailed right away, saying it went without tracking.',
  deliver: 'No email is sent.',
  cancel: 'No email is sent.',
  untrack: 'No email is sent. Their order page will say it went without tracking.',
  received: 'The buyer is emailed a payment confirmation.',
});

// The request that marks an order shipped. A number is needed unless the owner ticked "no tracking number"; a number always wins.
export function shipRequest({ trackingNumber = '', noTracking = false, note = '' } = {}) {
  const number = String(trackingNumber ?? '').trim();
  const text = String(note ?? '').trim();
  if (!number && noTracking !== true) return { ok: false, error: 'Enter the tracking number, or tick "No tracking number".' };
  const payload = { status: 'shipped' };
  if (number) payload.trackingNumber = number;
  else payload.noTracking = true;
  if (text) payload.note = text;
  return { ok: true, payload };
}

// How the buyer's email line reads for the ship form as it is filled in.
export const shipEmailLine = ({ trackingNumber = '', noTracking = false } = {}) => {
  if (String(trackingNumber ?? '').trim()) return BUYER_EMAIL.shipTracked;
  return noTracking === true ? BUYER_EMAIL.shipUntracked : BUYER_EMAIL.ship;
};

// Who the order is for: the account name, else the name it ships to, else the guest's email.
export function customerName(order) {
  if (order?.user && (order.user.firstName || order.user.lastName)) return `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim();
  const ship = order?.shippingAddress;
  const shipName = ship ? `${ship.firstName || ''} ${ship.lastName || ''}`.trim() : '';
  return shipName || order?.user?.email || order?.guestEmail || 'Guest';
}

// "today", "yesterday", "3 days ago", then the date: how long an order has been waiting is what matters on a phone.
export function ageLabel(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const days = Math.floor((now - time) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 8) return `${days} days ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const orderMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
