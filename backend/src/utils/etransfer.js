// ─── Interac e-Transfer orders ──────────────────────────────────────────────────
// Stripe cannot take an Interac e-Transfer, so this is the shop's own lane:
//   1. The buyer picks e-Transfer at checkout and gives an address. placeEtransferOrder() saves an UNPAID order
//      (status pending, paymentStatus pending) and takes its stock in the same transaction, then emails the buyer
//      what to send, to which address, with which message.
//   2. The owner sees the deposit in the bank and marks it received (markEtransferReceived): only then does the order
//      become paid/processing, which is what allows a label and shipping (utils/orderTransitions.js refuses any
//      fulfilment of an unpaid order). Nothing here ever ships by itself.
//   3. No payment inside the hold (default 48 h): sweepEtransferOrders() cancels the order and gives the stock back,
//      after one reminder. If the money turns up later, marking it received brings the order back when the stock is
//      still there.
// Money is handled in whole cents. The discount is on the goods only.

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const { resolveCartLines } = require('./cartLines');
const { resolveCanadaDelivery, deliveryMetadata, DeliveryChoiceError } = require('./canadaDelivery');
const { shippingChoiceNote } = require('./shippingChoice');
const { removeNoteLines } = require('./orderNotes');
const {
  InsufficientStockError,
  createOrderWithReservation,
  claimOrderWithReservation,
  cancelOrderAndRestoreStock,
} = require('./stock');
const { ETRANSFER, BANK_DEBIT, paymentMethodSettings, discountCents } = require('./paymentMethods');
const { sendPaymentNoticeEmail, sendOrderConfirmationEmail } = require('./email');
const { recordAdminEvent, describeOrder } = require('./adminEvents');
const { estimateDeliveryDate } = require('./deliveryEstimate');
const { reportPaidOrderToGa4 } = require('./purchaseAnalytics');
const { cancelReviewRequest } = require('./reviewRequests');
const { sanitizeAnalyticsIds } = require('./ga4');
const { CURRENCY, FASTER_SHIPPING_LABEL, FASTER_SHIPPING_TRANSIT_DAYS } = require('../config/shipping');

const HOUR_MS = 60 * 60 * 1000;
const MAX_OPEN_ORDERS_PER_BUYER = 3;
// Stripe says a bank debit takes up to 5 business days. A debit still "clearing" after this many calendar days means an event
// was lost or the payment is stuck, and the owner should look (the sweep tells him once; it never cancels by itself).
const STALE_BANK_DEBIT_DAYS = 8;
const AWAITING_NOTE = 'AWAITING e-Transfer: do not ship until you mark the payment received (Payment panel on this order).';

class EtransferError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'EtransferError';
    this.status = status;
    this.publicMessage = message;
    this.code = code;
  }
}

const CA_PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
const normalizePostalCode = (value) => String(value || '').toUpperCase().replace(/[\s-]+/g, '').replace(/^(.{3})(.{3})$/, '$1 $2');
const cents = (dollars) => Math.round(Number(dollars) * 100);
const dollars = (amountCents) => Math.round(amountCents) / 100;
const orderEmailOf = (order) => String(order?.user?.email || order?.guestEmail || '').trim().toLowerCase();
const firstNameOf = (order) => order?.user?.firstName || order?.shippingAddress?.firstName || '';
const withoutAwaitingNote = (adminNotes) => removeNoteLines(adminNotes, 'AWAITING e-Transfer');

// ── 1. place the order ─────────────────────────────────────────────────────────

// `buyer` is the already-validated form: { firstName, lastName, email, phone }, `address` { line1, line2, city, state, zip }.
async function placeEtransferOrder({ user, sessionId, buyer, address, shipping, analytics, now = new Date() }, deps = {}) {
  const d = {
    Cart, Order, resolveLines: resolveCartLines, createOrder: createOrderWithReservation,
    sendNotice: sendPaymentNoticeEmail, record: recordAdminEvent, settings: paymentMethodSettings(), ...deps,
  };
  const settings = d.settings[ETRANSFER];
  if (!settings.enabled) throw new EtransferError(503, 'Interac e-Transfer is not available right now. Please pay by card.', 'ETRANSFER_OFF');

  if (!user && !sessionId) throw new EtransferError(400, 'Session ID required for guest checkout');
  const cartFilter = user ? { user: user._id } : { sessionId };
  const cart = await d.Cart.findOne(cartFilter);
  if (!cart || !cart.items?.length) throw new EtransferError(400, 'Cart is empty');
  const lines = await d.resolveLines(cart.items);
  if (!lines.length) throw new EtransferError(400, 'Cart has no purchasable Server RAM');

  // Same stock rules as the card checkout, checked early for a clear message; the transaction below is the real guard.
  for (const { item, product } of lines) {
    if (product.stockQuantity <= 0 || product.stock === 'out') throw new EtransferError(400, `"${product.name}" is out of stock`);
    if (item.qty > product.stockQuantity) throw new EtransferError(400, `Only ${product.stockQuantity} units of "${product.name}" available`);
  }

  let delivery;
  try {
    delivery = resolveCanadaDelivery(lines.map(({ item, product }) => ({ product, qty: item.qty })), shipping || {});
  } catch (err) {
    if (err instanceof DeliveryChoiceError) throw new EtransferError(err.status, err.publicMessage);
    throw err;
  }

  const email = (user?.email || buyer.email).trim().toLowerCase();
  const open = await d.Order.countDocuments({
    paymentMethod: ETRANSFER, paymentStatus: 'pending', status: 'pending',
    ...(user ? { user: user._id } : { guestEmail: email }),
  });
  if (open >= MAX_OPEN_ORDERS_PER_BUYER) {
    throw new EtransferError(429, `You already have ${open} orders waiting for an e-Transfer. Send those payments first, or email us.`);
  }

  const goodsCents = lines.reduce((sum, { item, product }) => sum + cents(product.price) * item.qty, 0);
  const discount = discountCents(goodsCents, settings.discountPct);
  const shippingCents = cents(delivery.amount);
  const totalCents = goodsCents - discount + shippingCents;

  // An unpaid order holds real stock for the whole hold, for anyone who types an email address, and one Interac transfer
  // has a limit at most banks: so one order may only be so big. Bigger orders pay by card (no hold, no cap) or by arrangement.
  const units = lines.reduce((sum, { item }) => sum + item.qty, 0);
  if (units > settings.maxUnits || totalCents > Math.round(settings.maxTotal * 100)) {
    throw new EtransferError(
      400,
      `Interac e-Transfer orders are limited to ${settings.maxUnits} items and $${settings.maxTotal.toLocaleString('en-CA')} CAD. Please pay this one by card, or email us and we will arrange it.`,
      'ETRANSFER_TOO_LARGE',
    );
  }
  const expiresAt = new Date(now.getTime() + settings.holdHours * HOUR_MS);
  const gaIds = sanitizeAnalyticsIds(analytics);
  const fullAddress = {
    firstName: buyer.firstName, lastName: buyer.lastName, line1: address.line1, line2: address.line2 || undefined,
    city: address.city, state: address.state, zip: address.zip, country: 'CA', phone: buyer.phone || undefined,
  };

  // The cart is emptied INSIDE the transaction that creates the order, and only if it still holds what was priced above.
  // A second request for the same cart (a double click in two tabs, a retry, a script) finds it already empty and is turned
  // away instead of becoming a second order that holds a second lot of stock and sends a second set of instructions.
  const consumeCart = async (session) => {
    const used = await d.Cart.updateOne(
      { _id: cart._id, 'items.0': { $exists: true }, ...(cart.updatedAt ? { updatedAt: cart.updatedAt } : {}) },
      { $set: { items: [], discount: 0 }, $unset: { couponCode: '' } },
      { session },
    );
    if (!used?.modifiedCount) {
      throw new EtransferError(409, 'Your cart changed, or was already turned into an order. Check your email for the e-Transfer instructions, or review your cart and try again.', 'CART_CHANGED');
    }
  };

  let order;
  try {
    order = await d.createOrder({
      user: user?._id,
      guestEmail: user ? undefined : email,
      items: lines.map(({ item, product }) => ({
        product: product._id, slug: product.slug, sku: product.sku, name: product.name,
        price: product.price, image: product.images?.[0]?.url || '', qty: item.qty,
      })),
      shippingAddress: fullAddress,
      billingAddress: fullAddress,
      shippingMethod: delivery.label,
      shippingCost: dollars(shippingCents),
      subtotal: dollars(goodsCents),
      discount: dollars(discount),
      // The shop charges no sales tax today (no GST/HST registration), so this lane carries none. The day a registration is
      // added in Stripe (card and bank debit then charge it through automatic_tax), this lane must charge it too: docs/payments.md.
      tax: 0,
      total: dollars(totalCents),
      paymentMethod: ETRANSFER,
      paymentStatus: 'pending',
      status: 'pending',
      paymentDiscountPct: settings.discountPct,
      etransfer: { recipientEmail: settings.recipientEmail, amountDue: dollars(totalCents), expiresAt },
      analyticsClientId: gaIds.clientId,
      analyticsSessionId: gaIds.sessionId,
      adminNotes: [AWAITING_NOTE, shippingChoiceNote(deliveryMetadata(delivery), delivery.label)].filter(Boolean).join('\n'),
      statusHistory: [{ status: 'pending', note: 'Order placed; waiting for the Interac e-Transfer', timestamp: now }],
    }, { beforeCommit: consumeCart });
  } catch (err) {
    if (err instanceof InsufficientStockError) throw new EtransferError(409, err.publicMessage, 'OUT_OF_STOCK');
    throw err;
  }

  // The order exists, holds its stock and has used up the cart: everything below is best effort and cannot undo that.
  try {
    await d.sendNotice({ email, firstName: buyer.firstName, order, kind: 'etransferInstructions' });
  } catch (err) {
    console.error(`e-Transfer instructions email failed for ${order.orderNumber}:`, err.message);
  }
  await d.record({
    type: 'order.etransfer_pending',
    title: 'e-Transfer order: waiting for payment',
    body: `${describeOrder(order)} · watch your bank for it`,
    priority: 'high',
    order,
    dedupeKey: `order.etransfer_pending:${order._id}`,
  });
  return order;
}

// ── 2. the owner confirms the money arrived ────────────────────────────────────

async function markEtransferReceived(orderId, { amount, confirmation, note, acceptDifferentAmount = false, admin, now = new Date() }, deps = {}) {
  const d = {
    Order, claimWithStock: claimOrderWithReservation, sendConfirmation: sendOrderConfirmationEmail,
    reportGa4: reportPaidOrderToGa4, record: recordAdminEvent, ...deps,
  };
  const order = await d.Order.findById(orderId).populate('user', 'firstName email');
  if (!order) throw new EtransferError(404, 'Order not found');
  if (order.paymentMethod !== ETRANSFER) throw new EtransferError(409, 'This order was not an e-Transfer order.');
  if (order.paymentStatus === 'paid') throw new EtransferError(409, 'This order is already marked paid.', 'ALREADY_PAID');
  if (order.paymentStatus !== 'pending') throw new EtransferError(409, 'This order cannot be marked paid.');
  const expired = order.status === 'cancelled' && Boolean(order.etransfer?.expiredAt);
  if (order.status !== 'pending' && !expired) throw new EtransferError(409, `This order is ${order.status}, so it cannot be marked paid.`);

  const due = cents(order.etransfer?.amountDue ?? order.total);
  const received = cents(amount);
  if (!Number.isFinite(received) || received <= 0) throw new EtransferError(400, 'Enter the amount you received.');
  if (received !== due && !acceptDifferentAmount) {
    throw new EtransferError(409, `This order is for $${dollars(due).toFixed(2)} CAD, not $${dollars(received).toFixed(2)}. If you really did receive that amount and want to accept it, say so and add a note.`, 'AMOUNT_MISMATCH');
  }
  if (received !== due && !String(note || '').trim()) throw new EtransferError(400, 'Add a note explaining the different amount.');

  const who = admin?.firstName || 'the owner';
  const history = `Payment received by Interac e-Transfer${received !== due ? ` ($${dollars(received).toFixed(2)} instead of $${dollars(due).toFixed(2)})` : ''}, confirmed by ${who}${confirmation ? `, ref ${confirmation}` : ''}${note ? `: ${String(note).trim()}` : ''}`;
  const kept = withoutAwaitingNote(order.adminNotes);
  const set = {
    paymentStatus: 'paid',
    status: 'processing',
    paidAt: now,
    'etransfer.receivedAt': now,
    'etransfer.receivedAmount': dollars(received),
    // The estimate runs from the day the money arrived, not the day the order was placed.
    estimatedDelivery: estimateDeliveryDate({
      placedAt: now,
      country: 'CA',
      transitDays: String(order.shippingMethod || '').startsWith(FASTER_SHIPPING_LABEL) ? FASTER_SHIPPING_TRANSIT_DAYS : undefined,
    }),
    ...(admin?._id ? { 'etransfer.confirmedBy': admin._id } : {}),
    ...(confirmation ? { 'etransfer.confirmation': String(confirmation).trim().slice(0, 60) } : {}),
    ...(kept ? { adminNotes: kept } : {}),
  };
  const updates = {
    $set: set,
    $unset: { ...(kept ? {} : { adminNotes: '' }), cancelledAt: '', 'etransfer.expiredAt': '' },
    $push: { statusHistory: { status: 'processing', note: history.slice(0, 480), timestamp: now } },
  };

  let paid;
  if (expired) {
    // The hold had lapsed and the stock went back on sale: take it again, or leave the order cancelled.
    try {
      paid = await d.claimWithStock(order._id, { paymentMethod: ETRANSFER, paymentStatus: 'pending', status: 'cancelled', 'etransfer.expiredAt': { $exists: true } }, updates);
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        throw new EtransferError(409, `The 48-hour hold had ended and ${err.publicMessage} Send the money back by e-Transfer instead.`, 'OUT_OF_STOCK');
      }
      throw err;
    }
  } else {
    paid = await d.Order.findOneAndUpdate(
      { _id: order._id, paymentMethod: ETRANSFER, paymentStatus: 'pending', status: 'pending' },
      updates,
      { returnDocument: 'after' }
    );
  }
  if (!paid) throw new EtransferError(409, 'This order changed while you were marking it paid. Reload and check it.');

  const plain = typeof paid.toObject === 'function' ? paid.toObject() : paid;
  const email = orderEmailOf(order);
  if (email) {
    try {
      await d.sendConfirmation({ email, firstName: firstNameOf(order), order: { ...plain, items: plain.items } });
    } catch (err) {
      console.error(`e-Transfer confirmation email failed for ${plain.orderNumber}:`, err.message);
    }
  }
  await d.reportGa4({ ...plain, _id: paid._id }, { currency: CURRENCY });
  return paid;
}

// ── 3. a paid e-Transfer order is refunded ─────────────────────────────────────
// The owner sends the money back by e-Transfer himself, then records it here so the order, the review email and the
// books agree. Like a Stripe refund it does not touch stock: returned items are inspected first.
async function recordEtransferRefund(orderId, { note, admin, now = new Date() }, deps = {}) {
  const d = { Order, cancelReview: cancelReviewRequest, ...deps };
  const order = await d.Order.findOneAndUpdate(
    { _id: orderId, paymentMethod: ETRANSFER, paymentStatus: 'paid', status: { $in: ['pending', 'processing', 'shipped', 'delivered'] } },
    {
      $set: { paymentStatus: 'refunded', status: 'refunded' },
      $push: { statusHistory: { status: 'refunded', note: `Refunded by e-Transfer, recorded by ${admin?.firstName || 'the owner'}${note ? `: ${String(note).trim()}` : ''}; inventory unchanged pending return inspection`.slice(0, 480), timestamp: now } },
    },
    { returnDocument: 'after' }
  );
  if (!order) throw new EtransferError(409, 'Only a paid e-Transfer order that is not already refunded can be refunded here.');
  try { await d.cancelReview(order); } catch (err) { console.error('Review email cancel failed:', err.message); }
  return order;
}

// ── 4. expire, and remind ──────────────────────────────────────────────────────

async function sweepEtransferOrders({ now = new Date(), limit = 50 } = {}, deps = {}) {
  const d = {
    Order, cancelAndRestore: cancelOrderAndRestoreStock, sendNotice: sendPaymentNoticeEmail,
    record: recordAdminEvent, settings: paymentMethodSettings(), ...deps,
  };
  const summary = { expired: 0, reminded: 0, staleBankDebit: 0, errors: 0 };
  const unpaid = { paymentMethod: ETRANSFER, paymentStatus: 'pending', status: 'pending' };

  const lapsed = await d.Order.find({ ...unpaid, 'etransfer.expiresAt': { $lte: now } }).sort({ 'etransfer.expiresAt': 1 }).limit(limit).populate('user', 'firstName email');
  for (const order of lapsed) {
    try {
      const cancelled = await d.cancelAndRestore(order._id, {
        status: 'cancelled',
        cancelledAt: now,
        'etransfer.expiredAt': now,
        $push: { statusHistory: { status: 'cancelled', note: 'No e-Transfer received in time; order released and stock returned', timestamp: now } },
      }, { status: 'pending', paymentStatus: 'pending' });
      if (!cancelled) continue;               // paid, or cancelled by hand, between the read and the write
      summary.expired += 1;
      const email = orderEmailOf(order);
      if (email) await d.sendNotice({ email, firstName: firstNameOf(order), order, kind: 'etransferExpired' }).catch((err) => console.error(`Expired-order email failed for ${order.orderNumber}:`, err.message));
      await d.record({ type: 'order.etransfer_expired', title: 'e-Transfer never arrived: order released', body: describeOrder(order), priority: 'normal', order, dedupeKey: `order.etransfer_expired:${order._id}` });
    } catch (err) {
      summary.errors += 1;
      console.error(`e-Transfer expiry failed for ${order.orderNumber}:`, err.message);
    }
  }

  const remindBefore = new Date(now.getTime() - d.settings[ETRANSFER].reminderHours * HOUR_MS);
  const quiet = await d.Order.find({
    ...unpaid, 'etransfer.reminderSentAt': null, 'etransfer.expiresAt': { $gt: now }, createdAt: { $lte: remindBefore },
  }).sort({ createdAt: 1 }).limit(limit).populate('user', 'firstName email');
  for (const order of quiet) {
    try {
      // Exactly-once claim; a failed send gives it back so the next sweep tries again.
      const claimed = await d.Order.findOneAndUpdate({ _id: order._id, ...unpaid, 'etransfer.reminderSentAt': null }, { $set: { 'etransfer.reminderSentAt': now } });
      if (!claimed) continue;
      const email = orderEmailOf(order);
      if (!email) continue;
      try {
        await d.sendNotice({ email, firstName: firstNameOf(order), order, kind: 'etransferReminder' });
        summary.reminded += 1;
      } catch (err) {
        await d.Order.updateOne({ _id: order._id, 'etransfer.reminderSentAt': now }, { $unset: { 'etransfer.reminderSentAt': '' } });
        throw err;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`e-Transfer reminder failed for ${order.orderNumber}:`, err.message);
    }
  }

  // A bank debit still "clearing" far longer than Stripe allows. The alert is keyed by the order, so every later sweep stays quiet.
  const staleBefore = new Date(now.getTime() - STALE_BANK_DEBIT_DAYS * 24 * HOUR_MS);
  const stale = await d.Order.find({
    paymentMethod: BANK_DEBIT, paymentStatus: 'pending', status: 'pending', createdAt: { $lte: staleBefore },
  }).sort({ createdAt: 1 }).limit(limit);
  for (const order of stale) {
    try {
      const saved = await d.record({
        type: 'order.bank_debit_stale',
        title: 'Bank debit still not cleared: check Stripe',
        body: `${describeOrder(order)} · placed over ${STALE_BANK_DEBIT_DAYS} days ago, still not cleared`,
        priority: 'high',
        order,
        dedupeKey: `order.bank_debit_stale:${order._id}`,
      });
      if (saved) summary.staleBankDebit += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`Stale bank-debit alert failed for ${order.orderNumber}:`, err.message);
    }
  }
  return summary;
}

// The sweep is also run opportunistically (the phone's poll, the admin pages), so it must be cheap to ask for often.
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 5 * 60 * 1000;
async function sweepEtransferOrdersThrottled(deps = {}, { now = Date.now() } = {}) {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return null;
  lastSweepAt = now;
  try {
    return await sweepEtransferOrders({ now: new Date(now) }, deps);
  } catch (err) {
    console.error('e-Transfer sweep failed:', err.message);
    return null;
  }
}
const resetSweepThrottleForTest = () => { lastSweepAt = 0; };

module.exports = {
  EtransferError,
  CA_PROVINCES,
  POSTAL_CODE,
  normalizePostalCode,
  MAX_OPEN_ORDERS_PER_BUYER,
  AWAITING_NOTE,
  placeEtransferOrder,
  markEtransferReceived,
  recordEtransferRefund,
  sweepEtransferOrders,
  sweepEtransferOrdersThrottled,
  resetSweepThrottleForTest,
};
