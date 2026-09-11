import assert from "node:assert/strict";
import test from "node:test";
import {
  ecommerceItem,
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
