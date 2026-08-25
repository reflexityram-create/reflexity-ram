import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WHOLESALE_CONCEPTS,
  availableWholesaleReference,
  buildWholesaleQuoteUrl,
  clampQuoteQuantity,
  filterWholesaleReference,
  selectedWholesaleQuoteLines,
  wholesaleStockState,
} from "../src/lib/wholesaleLab.js";

const products = [
  {
    _id: "one",
    brand: "Samsung",
    capacityLabel: "16GB",
    condition: "Open Box — Tested",
    formFactor: "RDIMM",
    generation: "DDR4",
    mpn: "M393A2K43DB3-CWE",
    name: "Samsung 16GB DDR4 server memory",
    sku: "RFX-SAMSUNG-16GB",
    speedLabel: "3200 MT/s",
    stockQuantity: 8,
  },
  {
    _id: "two",
    brand: "SK hynix",
    capacityLabel: "64GB",
    condition: "Used",
    formFactor: "LRDIMM",
    generation: "DDR4",
    mpn: "HMAA8GL7CPR4N-VK",
    name: "SK hynix 64GB DDR4 server memory",
    sku: "RFX-SK-HYNIX-64GB",
    speedLabel: "2666 MT/s",
    stockQuantity: 2,
  },
  { _id: "sold", brand: "Sold out", formFactor: "RDIMM", sku: "SOLD", stockQuantity: 0 },
];

test("the local wholesale lab exposes three distinct decision-ready concepts", () => {
  assert.deepEqual(WHOLESALE_CONCEPTS.map(({ id }) => id), ["board", "market", "workbench"]);
  assert.equal(new Set(WHOLESALE_CONCEPTS.map(({ label }) => label)).size, 3);
});

test("the wholesale reference excludes unavailable products and filters exact stock fields", () => {
  assert.deepEqual(availableWholesaleReference(products).map(({ _id }) => _id), ["one", "two"]);
  assert.deepEqual(filterWholesaleReference(products, "RDIMM").map(({ _id }) => _id), ["one"]);
  assert.deepEqual(filterWholesaleReference(products, "All stock", "hmaa8").map(({ _id }) => _id), ["two"]);
  assert.deepEqual(filterWholesaleReference(products, "All stock", "samsung").map(({ _id }) => _id), ["one"]);
});

test("quote quantities are bounded by the visible stock ceiling", () => {
  assert.equal(clampQuoteQuantity(-5, 8), 1);
  assert.equal(clampQuoteQuantity("3", 8), 3);
  assert.equal(clampQuoteQuantity(99, 8), 8);
  assert.equal(clampQuoteQuantity(1, 0), 0);
});

test("quote selections remain complete when the visible filter hides a selected SKU", () => {
  const quantities = {
    "RFX-SAMSUNG-16GB": 3,
    "RFX-SK-HYNIX-64GB": 2,
  };
  const visible = filterWholesaleReference(products, "LRDIMM");
  assert.deepEqual(visible.map(({ sku }) => sku), ["RFX-SK-HYNIX-64GB"]);
  assert.deepEqual(
    selectedWholesaleQuoteLines(products, quantities).map(({ product, quantity }) => [product.sku, quantity]),
    [["RFX-SAMSUNG-16GB", 3], ["RFX-SK-HYNIX-64GB", 2]],
  );
});

test("catalog failure never claims that real stock is empty", () => {
  assert.deepEqual(wholesaleStockState({ loading: true }), {
    title: "Loading current stock",
    detail: "Connecting to the read-only public catalog…",
  });
  assert.deepEqual(wholesaleStockState({ error: true }), {
    title: "Catalog unavailable",
    detail: "Stock totals are not being shown because the public catalog could not be reached.",
  });
  assert.equal(wholesaleStockState().title, "No matching stock");
});

test("the quote workbench opens one reviewable Gmail draft without submitting an order", () => {
  const url = new URL(buildWholesaleQuoteUrl([
    { product: products[0], quantity: 3 },
    { product: products[1], quantity: 99 },
  ]));
  assert.equal(url.origin, "https://mail.google.com");
  assert.equal(url.searchParams.get("to"), "reflexityram@gmail.com");
  assert.equal(url.searchParams.get("su"), "Wholesale quote list — 2 SKUs");
  assert.match(url.searchParams.get("body"), /M393A2K43DB3-CWE/);
  assert.match(url.searchParams.get("body"), /Requested quantity: 3/);
  assert.match(url.searchParams.get("body"), /Requested quantity: 2/);
  assert.match(url.searchParams.get("body"), /Please confirm availability/);
});

test("the design route remains development-only and has no catalog write or cart path", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");
  const stockHook = await readFile(new URL("../src/lib/useStock.js", import.meta.url), "utf8");
  assert.match(app, /const WholesaleLab = import\.meta\.env\.DEV/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLab"\)\)/);
  assert.match(app, /path="\/wholesale-lab"/);
  assert.doesNotMatch(page, /productsApi\.(create|update|remove)|addToCart|checkoutApi|ordersApi/);
  assert.match(page, /Read-only public catalog reference · not a wholesale offer/);
  assert.match(page, /Nothing is submitted from this page/);
  assert.match(page, /selectedWholesaleQuoteLines\(allProducts, quantities\)/);
  assert.match(stockHook, /setError\(true\)/);
  assert.match(stockHook, /return \{\s*error,/);
});
