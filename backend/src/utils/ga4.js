// Server-side GA4 purchase reporting (Measurement Protocol).
//
// The browser-side purchase event needs the buyer to reach the return page with
// analytics unblocked. A real paid order (2026-09-18) never reached GA4 that way.
// The server sees every paid order, so when GA4_API_SECRET is configured the
// server owns purchase reporting. Everything here is fail-open: analytics must
// never break fulfilment.
const crypto = require('crypto');
const { analyticsOrder } = require('./analyticsOrder');

const GA4_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
const DEFAULT_MEASUREMENT_ID = 'G-LHK5KZSYG6';
const SEND_TIMEOUT_MS = 4000;
// GA4 drops Measurement Protocol events older than 72 hours.
const MAX_EVENT_AGE_MS = 60 * 60 * 60 * 1000;

const CLIENT_ID_PATTERN = /^\d{1,15}\.\d{1,15}$/;
const SESSION_ID_PATTERN = /^\d{6,15}$/;
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;

function ga4Config(env = process.env) {
  const apiSecret = String(env.GA4_API_SECRET || '').trim();
  const measurementId = String(env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID).trim();
  if (!apiSecret || !MEASUREMENT_ID_PATTERN.test(measurementId)) return null;
  return { apiSecret, measurementId };
}

const isServerPurchaseTrackingEnabled = (env = process.env) => ga4Config(env) !== null;

// Browser-supplied GA identifiers are untrusted input: accept only the exact
// shapes gtag produces, drop everything else.
function sanitizeAnalyticsIds(input) {
  const clientId = typeof input?.clientId === 'string' && CLIENT_ID_PATTERN.test(input.clientId)
    ? input.clientId
    : undefined;
  const sessionId = typeof input?.sessionId === 'string' && SESSION_ID_PATTERN.test(input.sessionId)
    ? input.sessionId
    : undefined;
  return { clientId, sessionId };
}

// When the browser never shared a GA client id (blocked, or checkout started
// elsewhere) the sale is still recorded under a stable per-order id.
function fallbackClientId(orderNumber) {
  const digest = crypto.createHash('sha256').update(String(orderNumber)).digest();
  return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`;
}

function buildPurchasePayload(order, { clientId, sessionId } = {}, { currency, now = Date.now() } = {}) {
  const analytics = analyticsOrder(order, currency);
  const createdAtMs = order.createdAt ? new Date(order.createdAt).getTime() : now;
  const eventTimeMs = Number.isFinite(createdAtMs) ? Math.min(createdAtMs, now) : now;
  return {
    client_id: clientId || fallbackClientId(order.orderNumber),
    timestamp_micros: eventTimeMs * 1000,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: order.orderNumber,
        currency: analytics.currency,
        value: analytics.value,
        tax: analytics.tax,
        shipping: analytics.shipping,
        items: analytics.items,
        // Fixed public context: never send Stripe return tokens or customer URLs.
        // Server events otherwise have no hostname and disappear from site reports.
        page_location: 'https://reflexityram.com/order/success',
        page_title: 'Order confirmed',
        ...(sessionId ? { session_id: sessionId } : {}),
        engagement_time_msec: 1,
      },
    }],
  };
}

// Never throws. Resolves { sent, reason? }.
async function sendPurchaseEvent(order, ids, {
  fetchImpl = fetch,
  env = process.env,
  logger = console,
  currency,
  now = Date.now(),
  timeoutMs = SEND_TIMEOUT_MS,
} = {}) {
  const config = ga4Config(env);
  if (!config) return { sent: false, reason: 'not-configured' };
  if (!order?.orderNumber) return { sent: false, reason: 'no-order-number' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${GA4_COLLECT_URL}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(config.apiSecret)}`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPurchasePayload(order, ids, { currency, now })),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(`GA4 purchase event rejected for ${order.orderNumber}: HTTP ${response.status}`);
      return { sent: false, reason: `http-${response.status}` };
    }
    return { sent: true };
  } catch (err) {
    // The URL carries the API secret, so only the error name is logged.
    logger.warn(`GA4 purchase event failed for ${order.orderNumber}: ${err?.name || 'error'}`);
    return { sent: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAX_EVENT_AGE_MS,
  buildPurchasePayload,
  fallbackClientId,
  ga4Config,
  isServerPurchaseTrackingEnabled,
  sanitizeAnalyticsIds,
  sendPurchaseEvent,
};
