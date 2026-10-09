const PRODUCTION_HOST = "reflexityram.com";
const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/account",
  "/reset-password",
  "/verify-email",
  "/review",
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

export const ANALYTICS_OPTOUT_KEY = "reflexity_analytics_optout";
export const ANALYTICS_OWNER_KEY = "reflexity_analytics_owner";
export const ANALYTICS_QA_KEY = "reflexity_analytics_qa";

function storageValue(key) {
  try { return globalThis.localStorage?.getItem(key) || ""; } catch { return ""; }
}

function setStorageValue(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* privacy mode / blocked storage */ }
}

function removeStorageValue(key) {
  try { globalThis.localStorage?.removeItem(key); } catch { /* privacy mode / blocked storage */ }
}

function sessionStorageValue(key) {
  try { return globalThis.sessionStorage?.getItem(key) || ""; } catch { return ""; }
}

function setSessionStorageValue(key, value) {
  try { globalThis.sessionStorage?.setItem(key, value); } catch { /* blocked storage */ }
}

export function applyAnalyticsPreference(location = globalThis.location) {
  const params = new URLSearchParams(location?.search || "");
  const preference = params.get("analytics")?.toLowerCase();
  if (preference === "off") setStorageValue(ANALYTICS_OPTOUT_KEY, "1");
  if (preference === "on") {
    removeStorageValue(ANALYTICS_OPTOUT_KEY);
    removeStorageValue(ANALYTICS_OWNER_KEY);
  }
  return preference === "off" ? "off" : preference === "on" ? "on" : (storageValue(ANALYTICS_OPTOUT_KEY) ? "off" : "on");
}

export function markAnalyticsOwner() {
  setStorageValue(ANALYTICS_OWNER_KEY, "1");
}

export function analyticsDisabled(location = globalThis.location) {
  return applyAnalyticsPreference(location) === "off" || Boolean(storageValue(ANALYTICS_OWNER_KEY));
}

function canonicalPath(pathname = "/") {
  const path = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  return /^\/order\/[^/]+$/.test(path) && path !== "/order/success" ? "/order/success" : path;
}

function validCampaignValue(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{1,100}$/.test(value) ? value : undefined;
}

export function applyAnalyticsRuntimeGuards(location = globalThis.location) {
  const params = new URLSearchParams(location?.search || "");
  if ([...params.keys()].some((key) => key.toLowerCase() === "qa")) setSessionStorageValue(ANALYTICS_QA_KEY, "1");
  const path = canonicalPath(location?.pathname);
  const privatePath = PRIVATE_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const disabled = analyticsDisabled(location) || Boolean(sessionStorageValue(ANALYTICS_QA_KEY)) || privatePath;
  try { if (globalThis.window) globalThis.window[`ga-disable-${GA_MEASUREMENT_ID}`] = disabled; } catch { /* no-op */ }
  return disabled;
}

export function shouldTrackLocation(location = globalThis.location) {
  if (!location || location.hostname !== PRODUCTION_HOST) return false;
  if (applyAnalyticsRuntimeGuards(location)) return false;
  const pathname = canonicalPath(location.pathname || "/");
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  const params = new URLSearchParams(location.search || "");
  return ![...params.keys()].some((key) => INTERNAL_QUERY_KEYS.has(key.toLowerCase()));
}

const PAGE_CONTEXTS = [
  [/^\/$/, ["home", "discovery"]],
  [/^\/shop\/[^/]+(?:\/|$)/, ["product", "consideration"]],
  [/^\/shop$/, ["shop", "discovery"]],
  [/^\/guides(?:\/|$)/, ["guide", "consideration"]],
  [/^\/cart$/, ["cart", "cart"]],
  [/^\/checkout$/, ["checkout", "checkout"]],
  [/^\/order\/(?:success|[^/]+)$/, ["order", "post_purchase"]],
  [/^\/wholesale(?:\/|$)/, ["wholesale", "lead"]],
  [/^\/liquidators$/, ["liquidation", "lead"]],
  [/^\/(?:shipping|returns|warranty|privacy|terms|support|faq|international|business-info)$/, ["policy", "support"]],
];

export function pageContext(pathname = globalThis.location?.pathname || "/") {
  const match = PAGE_CONTEXTS.find(([pattern]) => pattern.test(pathname));
  return match ? { page_type: match[1][0], funnel_stage: match[1][1] } : { page_type: "other", funnel_stage: "discovery" };
}

export function safeReferrer(referrer = globalThis.document?.referrer) {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    // Keep only the origin. A path can contain an order id or other private
    // value, while the origin still answers whether traffic came from a site.
    return url.origin;
  } catch { return undefined; }
}

export function safePageTitle(pathname = "/") {
  const safePath = canonicalPath(pathname);
  if (safePath === "/order/success") return "Order status — Reflexity RAM";
  if (/^\/shop\/[^/]+(?:\/|$)/.test(safePath)) return "Memory product — Reflexity RAM";
  return String(globalThis.document?.title || "Reflexity RAM").slice(0, 120);
}

export function pageViewParameters(pathname = globalThis.location?.pathname || "/") {
  const safePath = canonicalPath(pathname);
  const urlParams = new URLSearchParams(globalThis.location?.search || "");
  const campaign = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = validCampaignValue(urlParams.get(key));
    if (value) campaign[key] = value;
  }
  return {
    page_title: safePageTitle(safePath),
    page_location: globalThis.location ? `${globalThis.location.origin}${safePath}` : safePath,
    page_path: safePath,
    ...pageContext(safePath),
    ...campaign,
    ...(safeReferrer() ? { page_referrer: safeReferrer() } : {}),
  };
}

export function trackPageView(pathname = globalThis.location?.pathname || "/") {
  return trackEvent("page_view", pageViewParameters(pathname));
}

export function trackPageExit({ pathname, startedAt, engagedMs = 0, reason = "route_change" } = {}) {
  if (!pathname) return false;
  const safePath = canonicalPath(pathname);
  return trackEvent("page_exit", {
    page_path: safePath,
    ...pageContext(safePath),
    engaged_seconds: Math.max(0, Math.round(Number(engagedMs || (startedAt ? Date.now() - startedAt : 0)) / 1000)),
    exit_reason: String(reason).slice(0, 32),
    transport: "beacon",
  });
}

export function trackPageEngagement({ pathname, engagedMs = 0 } = {}) {
  if (!pathname) return false;
  const safePath = canonicalPath(pathname);
  return trackEvent("page_engagement", {
    page_path: safePath,
    ...pageContext(safePath),
    engaged_seconds: Math.max(0, Math.round(Number(engagedMs) / 1000)),
  });
}

export function trackEvent(eventName, parameters = {}) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(eventName)) return false;
  if (!shouldTrackLocation(globalThis.location) || typeof globalThis.gtag !== "function") return false;
  const safePath = canonicalPath(parameters.page_path || globalThis.location?.pathname || "/");
  const { page_location: ignoredLocation, page_title: ignoredTitle, page_referrer: ignoredReferrer, page_type: ignoredType, funnel_stage: ignoredStage, ...eventParameters } = parameters;
  const safeParameters = {
    ...eventParameters,
    page_location: `${globalThis.location?.origin || ""}${safePath}`,
    page_path: safePath,
    page_title: safePageTitle(safePath),
    ...pageContext(safePath),
  };
  const referrer = safeReferrer();
  if (referrer) safeParameters.page_referrer = referrer;
  globalThis.gtag("event", eventName, safeParameters);
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
