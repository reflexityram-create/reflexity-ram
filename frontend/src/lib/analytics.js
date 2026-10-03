const PRODUCTION_HOST = "reflexityram.com";
const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/account",
  "/reset-password",
  "/verify-email",
  "/wholesale-lab",
  "/wholesale-admin-lab",
];
const INTERNAL_QUERY_KEYS = new Set([
  "qa",
  "verify",
  "deploy",
  "release",
  "diagnose",
  "demo",
  "image-hotfix",
]);

export function shouldTrackLocation(location = globalThis.location) {
  if (!location || location.hostname !== PRODUCTION_HOST) return false;
  const pathname = location.pathname || "/";
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  const params = new URLSearchParams(location.search || "");
  return ![...params.keys()].some((key) => INTERNAL_QUERY_KEYS.has(key.toLowerCase()));
}

export function trackEvent(eventName, parameters = {}) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(eventName)) return false;
  if (!shouldTrackLocation(globalThis.location) || typeof globalThis.gtag !== "function") return false;
  globalThis.gtag("event", eventName, parameters);
  return true;
}

const GA_MEASUREMENT_ID = "G-LHK5KZSYG6";

// The server reports the purchase to GA4 (Measurement Protocol), and only the browser knows
// which GA client/session the buyer belongs to. Resolves {} immediately off the production
// host, and after `timeoutMs` when gtag.js never answers (blocked), so it can never hold
// checkout up for longer than that.
export function readGaIdentifiers({ measurementId = GA_MEASUREMENT_ID, timeoutMs = 600 } = {}) {
  return new Promise((resolve) => {
    if (!shouldTrackLocation(globalThis.location) || typeof globalThis.gtag !== "function") {
      resolve({});
      return;
    }
    const ids = {};
    let pending = 2;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ids);
    };
    const timer = setTimeout(finish, timeoutMs);
    const read = (key, field) => globalThis.gtag("get", measurementId, key, (value) => {
      if (value !== undefined && value !== null && value !== "") ids[field] = String(value);
      pending -= 1;
      if (pending === 0) finish();
    });
    try {
      read("client_id", "clientId");
      read("session_id", "sessionId");
    } catch {
      finish();
    }
  });
}

export function ecommerceItem(product, quantity = 1) {
  return {
    item_id: product?.sku || product?.slug,
    item_name: product?.name,
    item_category: product?.generation,
    item_variant: product?.formFactor,
    price: Number(product?.price || 0),
    quantity: Number(quantity || 1),
  };
}

export function trackPurchaseOnce(order) {
  if (!order?.orderNumber) return false;
  const storageKey = `reflexity_purchase_${order.orderNumber}`;
  try {
    if (sessionStorage.getItem(storageKey)) return false;
  } catch {
    // Analytics still works when storage is unavailable.
  }

  const tracked = trackEvent("purchase", {
    transaction_id: order.orderNumber,
    currency: String(order.currency || "CAD").toUpperCase(),
    value: Number(order.value || 0),
    tax: Number(order.tax || 0),
    shipping: Number(order.shipping || 0),
    items: Array.isArray(order.items) ? order.items : [],
  });
  if (tracked) {
    try { sessionStorage.setItem(storageKey, "1"); } catch { /* no-op */ }
  }
  return tracked;
}
