import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStorePrice,
  formatStorePriceWithCode,
  shippingPriceFor,
  STANDARD_SHIPPING_PRICE,
  STORE_CURRENCY_CODE,
  STORE_CURRENCY_NAME,
} from "../src/lib/currency.js";

test("storefront prices default to CAD", () => {
  assert.equal(STORE_CURRENCY_CODE, "CAD");
  assert.equal(STORE_CURRENCY_NAME, "Canadian dollars (CAD)");
  assert.equal(STANDARD_SHIPPING_PRICE, 14);
  assert.equal(formatStorePrice(1299.5), "$1,299.50");
  assert.equal(formatStorePriceWithCode(14, 0), "$14 CAD");
});

test("a product's displayed shipping rate falls back to the standard flat rate", () => {
  assert.equal(shippingPriceFor({ price: 135 }), 14);
  assert.equal(shippingPriceFor({ shippingPrice: null }), 14);
  assert.equal(shippingPriceFor({ shippingPrice: "" }), 14);
  assert.equal(shippingPriceFor({ shippingPrice: -1 }), 14);
  assert.equal(shippingPriceFor(undefined), 14);
  assert.equal(shippingPriceFor({ shippingPrice: 25 }), 25);
  assert.equal(shippingPriceFor({ shippingPrice: "25" }), 25);
  assert.equal(formatStorePriceWithCode(shippingPriceFor({ shippingPrice: 25 }), 0), "$25 CAD");
});
