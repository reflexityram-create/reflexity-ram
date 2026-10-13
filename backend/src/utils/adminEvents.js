// ─── Owner alerts: the events the phone app turns into notifications ───────────
// recordAdminEvent() is called from the places where something happens that the shop owner should hear about
// (a paid order, an e-Transfer to watch for, a failed payment ...). It NEVER throws or delays the caller's own
// work: a failed alert must not fail an order. The phone long-polls GET /api/device/events; eventWaiter() lets
// that request answer the moment a new event is written instead of on its next poll.
//
// Alert text is shown on a lock screen, so it carries order numbers, amounts and item names only: never a
// customer's name, email, phone or address.

const { EventEmitter } = require('events');
const mongoose = require('mongoose');
const AdminEvent = require('../models/AdminEvent');

const bus = new EventEmitter();
bus.setMaxListeners(0);

const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// The app opens `<site>/<path>` when the notification is tapped, so only admin pages are allowed.
const SAFE_ADMIN_PATH = /^\/admin(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*(?:\?[A-Za-z0-9._=&-]*)?$/;
const adminPath = (path) => (typeof path === 'string' && SAFE_ADMIN_PATH.test(path) ? path : '/admin/orders');

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const PAYMENT_LABELS = { stripe: 'Card', bank_debit: 'Bank debit', etransfer: 'e-Transfer' };
const paymentLabel = (order) => PAYMENT_LABELS[order?.paymentMethod || 'stripe'] || 'Card';

// "RFX-ABC · $643.00 CAD · 2× 16GB DDR4, 1× 32GB DDR4 · Card" - what an order looks like in a notification.
function describeOrder(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const names = items.slice(0, 2).map((item) => `${item.qty}× ${clip(item.name, 40)}`);
  if (items.length > 2) names.push(`+${items.length - 2} more`);
  return [
    order?.orderNumber,
    `${money(order?.total)} CAD`,
    names.join(', ') || null,
    paymentLabel(order),
  ].filter(Boolean).join(' · ');
}

const orderPath = (order) => (order?._id ? `/admin/orders?order=${order._id}` : '/admin/orders');

async function recordAdminEvent(input, { Model = AdminEvent, emitter = bus, logger = console } = {}) {
  try {
    // Mongoose would queue this write for 10 s while the database is unreachable: an alert is not worth that wait.
    if (Model === AdminEvent && mongoose.connection.readyState !== 1) return null;
    const event = {
      type: clip(input.type, 40),
      title: clip(input.title, 120),
      body: clip(input.body, 300),
      priority: ['high', 'normal', 'low'].includes(input.priority) ? input.priority : 'normal',
      path: adminPath(input.path || (input.order ? orderPath(input.order) : undefined)),
    };
    if (input.order?._id) {
      event.orderId = input.order._id;
      event.orderNumber = clip(input.order.orderNumber, 80) || undefined;
    }
    const saved = await Model.create(event);
    emitter.emit('event', saved);
    return saved;
  } catch (err) {
    logger.error(`Admin event "${input?.type}" was not recorded: ${err.message}`);
    return null;
  }
}

// Registers for the next event right away (so nothing written between the caller's query and its wait is
// missed), then waits up to `ms`. Resolves true when an event arrived, false on timeout or cancel().
function eventWaiter(emitter = bus) {
  let settled = false;
  let timer = null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const settle = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    emitter.off('event', onEvent);
    finish(value);
  };
  const onEvent = () => settle(true);
  emitter.on('event', onEvent);
  return {
    wait(ms) {
      if (!settled) timer = setTimeout(() => settle(false), ms);
      return done;
    },
    cancel: () => settle(false),
  };
}

const publicEvent = (event) => ({
  id: String(event._id),
  type: event.type,
  title: event.title,
  body: event.body || '',
  priority: event.priority || 'normal',
  path: adminPath(event.path),
  orderNumber: event.orderNumber || undefined,
  createdAt: event.createdAt,
});

module.exports = { recordAdminEvent, eventWaiter, publicEvent, describeOrder, orderPath, adminPath, clip, money, bus };
