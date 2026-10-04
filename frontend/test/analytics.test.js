import assert from "node:assert/strict";
import test from "node:test";
import {
  ecommerceItem,
  readGaIdentifiers,
  shouldTrackLocation,
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

test("analytics emits valid events and normalized ecommerce items", () => {
  const originalLocation = globalThis.location;
  const originalGtag = globalThis.gtag;
  const calls = [];
  globalThis.location = new URL("https://reflexityram.com/shop/test");
  globalThis.gtag = (...args) => calls.push(args);
  try {
    assert.equal(trackEvent("add_to_cart", { value: 20 }), true);
    assert.equal(trackEvent("Invalid Event", {}), false);
    assert.deepEqual(calls, [["event", "add_to_cart", { value: 20 }]]);
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
