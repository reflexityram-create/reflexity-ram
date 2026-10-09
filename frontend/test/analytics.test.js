import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_OPTOUT_KEY,
  ANALYTICS_OWNER_KEY,
  ANALYTICS_QA_KEY,
  applyAnalyticsPreference,
  applyAnalyticsRuntimeGuards,
  ecommerceItem,
  markAnalyticsOwner,
  pageContext,
  pageViewParameters,
  readGaIdentifiers,
  safePageTitle,
  shouldTrackLocation,
  trackPageExit,
  trackEvent,
  trackPurchaseOnce,
} from "../src/lib/analytics.js";

test("analytics only tracks canonical public storefront traffic", () => {
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop")), true);
  assert.equal(shouldTrackLocation(new URL("https://www.reflexityram.com/shop")), false);
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/admin/orders")), false);
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop?qa=1")), false);
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop?utm_source=google")), true);
  // The review page holds a private review link; it never reports to GA4.
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/review#t=r1.token")), false);
});

test("owner exclusion persists until the explicit reversible opt-in", () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    markAnalyticsOwner();
    assert.equal(values.get(ANALYTICS_OWNER_KEY), "1");
    assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop")), false);
    assert.equal(applyAnalyticsPreference(new URL("https://reflexityram.com/shop?analytics=on")), "on");
    assert.equal(values.has(ANALYTICS_OWNER_KEY), false);
    assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop")), true);
    applyAnalyticsPreference(new URL("https://reflexityram.com/shop?analytics=off"));
    assert.equal(values.get(ANALYTICS_OPTOUT_KEY), "1");
    assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/shop")), false);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("page metadata and exits contain safe paths only", () => {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  const originalDocument = globalThis.document;
  const calls = [];
  globalThis.location = new URL("https://reflexityram.com/shop?email=buyer@example.com#token");
  globalThis.document = { title: "Shop", referrer: "https://search.example/?q=buyer@example.com" };
  globalThis.gtag = (...args) => calls.push(args);
  try {
    assert.deepEqual(pageContext("/checkout"), { page_type: "checkout", funnel_stage: "checkout" });
    const params = pageViewParameters("/shop");
    assert.equal(params.page_location, "https://reflexityram.com/shop");
    assert.equal(params.page_referrer, "https://search.example");
    assert.equal(safePageTitle("/order/RFX-SECRET"), "Order status — Reflexity RAM");
    assert.equal(safePageTitle("/shop/hynix-16gb"), "Memory product — Reflexity RAM");
    assert.equal(trackPageExit({ pathname: "/shop?email=buyer@example.com", engagedMs: 1600, reason: "hidden" }), true);
    assert.equal(calls[0][2].page_path, "/shop");
    assert.equal(calls[0][2].engaged_seconds, 2);
    assert.equal(JSON.stringify(calls).includes("buyer@example.com"), false);
  } finally {
    globalThis.location = originalLocation;
    globalThis.gtag = originalGtag;
    globalThis.document = originalDocument;
  }
});

test("qa is session-scoped, campaigns are validated, and order ids are canonicalized", () => {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  const originalSession = globalThis.sessionStorage;
  const values = new Map();
  const calls = [];
  globalThis.sessionStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  globalThis.location = new URL("https://reflexityram.com/shop?qa=1&utm_source=google&utm_campaign=spring_sale&utm_term=buyer%40example.com");
  globalThis.gtag = (...args) => calls.push(args);
  try {
    assert.equal(applyAnalyticsRuntimeGuards(globalThis.location), true);
    assert.equal(values.get(ANALYTICS_QA_KEY), "1");
    globalThis.location = new URL("https://reflexityram.com/order/RFX-SECRET?utm_source=google&utm_campaign=spring_sale");
    assert.equal(shouldTrackLocation(globalThis.location), false);
    values.delete(ANALYTICS_QA_KEY);
    assert.equal(trackEvent("page_exit", { page_path: "/order/RFX-SECRET", engaged_seconds: 2 }), true);
    const page = pageViewParameters("/shop");
    assert.equal(page.utm_source, "google");
    assert.equal(page.utm_campaign, "spring_sale");
    assert.equal(page.utm_term, undefined);
    assert.equal(calls[0][2].page_path, "/order/success");
    assert.equal(calls[0][2].page_location, "https://reflexityram.com/order/success");
    assert.equal(JSON.stringify(calls).includes("RFX-SECRET"), false);
  } finally {
    globalThis.location = originalLocation;
    globalThis.gtag = originalGtag;
    globalThis.sessionStorage = originalSession;
  }
});

test("analytics emits valid events and normalized ecommerce items", () => {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  const calls = [];
  globalThis.location = new URL("https://reflexityram.com/shop/test");
  globalThis.gtag = (...args) => calls.push(args);
  try {
    assert.equal(trackEvent("add_to_cart", { value: 20 }), true);
    assert.equal(trackEvent("Invalid Event", {}), false);
    assert.equal(calls[0][0], "event");
    assert.equal(calls[0][1], "add_to_cart");
    assert.equal(calls[0][2].value, 20);
    assert.equal(calls[0][2].page_path, "/shop/test");
    assert.equal(calls[0][2].page_location, "https://reflexityram.com/shop/test");
    assert.deepEqual(ecommerceItem({ sku: "SKU-1", name: "RAM", generation: "DDR4", formFactor: "RDIMM", price: "20" }, 2), {
      item_id: "SKU-1",
      item_name: "RAM",
      item_category: "DDR4",
      item_variant: "RDIMM",
      price: 20,
      quantity: 2,
    });
  } finally {
    globalThis.location = originalLocation;
    globalThis.gtag = originalGtag;
  }
});

test("purchase tracking deduplicates a transaction in session storage", () => {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  const originalStorage = globalThis.sessionStorage;
  const values = new Map();
  const calls = [];
  globalThis.location = new URL("https://reflexityram.com/order/success");
  globalThis.gtag = (...args) => calls.push(args);
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const order = { orderNumber: "RFX-1", currency: "cad", value: 42, items: [] };
    assert.equal(trackPurchaseOnce(order), true);
    assert.equal(trackPurchaseOnce(order), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "purchase");
    assert.equal(calls[0][2].currency, "CAD");
  } finally {
    globalThis.location = originalLocation;
    globalThis.gtag = originalGtag;
    globalThis.sessionStorage = originalStorage;
  }
});

function withBrowser(url, gtag, run) {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  globalThis.location = new URL(url);
  globalThis.gtag = gtag;
  const restore = () => {
    globalThis.location = originalLocation;
    globalThis.gtag = originalGtag;
  };
  return Promise.resolve(run()).finally(restore);
}

test("GA identifiers are read from gtag so the server can attribute the purchase", async () => {
  const requested = [];
  const gtag = (command, measurementId, key, callback) => {
    requested.push([command, measurementId, key]);
    queueMicrotask(() => callback({ client_id: "1234567890.1700000000", session_id: 1789737000 }[key]));
  };
  const ids = await withBrowser("https://reflexityram.com/checkout", gtag, () => readGaIdentifiers());
  assert.deepEqual(ids, { clientId: "1234567890.1700000000", sessionId: "1789737000" });
  assert.deepEqual(requested, [
    ["get", "G-LHK5KZSYG6", "client_id"],
    ["get", "G-LHK5KZSYG6", "session_id"],
  ]);
});

test("GA identifiers resolve empty off the production host or without gtag, without waiting", async () => {
  const started = Date.now();
  assert.deepEqual(await withBrowser("http://localhost:5173/checkout", () => { throw new Error("must not be called"); }, () => readGaIdentifiers()), {});
  assert.deepEqual(await withBrowser("https://reflexityram.com/checkout", undefined, () => readGaIdentifiers()), {});
  assert.deepEqual(await withBrowser("https://reflexityram.com/admin/orders", () => { throw new Error("must not be called"); }, () => readGaIdentifiers()), {});
  assert.ok(Date.now() - started < 200);
});

test("a blocked or silent gtag can never hold checkout up past the timeout", async () => {
  const started = Date.now();
  const ids = await withBrowser("https://reflexityram.com/checkout", () => {}, () => readGaIdentifiers({ timeoutMs: 30 }));
  assert.deepEqual(ids, {});
  assert.ok(Date.now() - started < 1000);

  const partial = await withBrowser(
    "https://reflexityram.com/checkout",
    (_command, _id, key, callback) => { if (key === "client_id") callback("111.222"); },
    () => readGaIdentifiers({ timeoutMs: 30 }),
  );
  assert.deepEqual(partial, { clientId: "111.222" });
});

test("a throwing gtag and empty values yield no identifiers instead of an error", async () => {
  assert.deepEqual(await withBrowser("https://reflexityram.com/checkout", () => { throw new Error("gtag broke"); }, () => readGaIdentifiers()), {});
  const empty = await withBrowser(
    "https://reflexityram.com/checkout",
    (_command, _id, _key, callback) => callback(undefined),
    () => readGaIdentifiers({ timeoutMs: 30 }),
  );
  assert.deepEqual(empty, {});
});
