import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fetchAllCatalogProducts,
  getCatalogCategoryLabel,
  isPublicServerRam,
  matchesCatalogLines,
  RAM_CATEGORIES,
} from "../src/lib/catalog.js";

test("RAM category URLs use line as the top-level category authority", () => {
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.desktop.href.split("?")[1]).getAll("form"),
    [],
  );
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.desktop.href.split("?")[1]).getAll("line"),
    ["Desktop"],
  );
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.laptop.href.split("?")[1]).getAll("form"),
    [],
  );
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.laptop.href.split("?")[1]).getAll("line"),
    ["Laptop"],
  );
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.server.href.split("?")[1]).getAll("form"),
    [],
  );
  assert.deepEqual(
    new URLSearchParams(RAM_CATEGORIES.server.href.split("?")[1]).getAll("line"),
    ["Server"],
  );
});

test("catalog labels support line links and the legacy repeated Server form URL", () => {
  assert.equal(getCatalogCategoryLabel([], [], ["Desktop"], false), "Desktop RAM");
  assert.equal(getCatalogCategoryLabel([], [], ["Laptop"], false), "Laptop RAM");
  assert.equal(getCatalogCategoryLabel([], [], ["Server"], false), "Server RAM");
  assert.equal(getCatalogCategoryLabel([], ["RDIMM", "LRDIMM"], [], false), "Server RAM");
});

test("line filters retain Server products regardless of form factor", () => {
  assert.equal(matchesCatalogLines({ line: "Server", formFactor: "UDIMM" }, ["Server"]), true);
  assert.equal(matchesCatalogLines({ line: "Server", formFactor: "SO-DIMM" }, ["Server"]), true);
  assert.equal(matchesCatalogLines({ line: "Desktop", formFactor: "UDIMM" }, ["Server"]), false);
  assert.equal(matchesCatalogLines({ line: "Server" }, ["Desktop", "Server"]), true);
});

test("the public catalog authority is the exact Server line, not a form-factor heuristic", () => {
  assert.equal(isPublicServerRam({ line: "Server", formFactor: "UDIMM" }), true);
  assert.equal(isPublicServerRam({ line: "Server", formFactor: "SO-DIMM" }), true);
  assert.equal(isPublicServerRam({ line: "Desktop", formFactor: "RDIMM" }), false);
  assert.equal(isPublicServerRam({ line: "Laptop", formFactor: "LRDIMM" }), false);
});

test("the restored storefront applies the Server-only authority at every public catalog surface", async () => {
  const source = await Promise.all(["Home", "Categories", "Shop", "Product"].map(
    (page) => readFile(new URL(`../src/pages/${page}.jsx`, import.meta.url), "utf8"),
  ));
  const [home, categories, shop, product] = source;

  assert.match(home, /isPublicServerRam/);
  assert.match(categories, /const CATEGORIES = \[\s*\{[\s\S]*id: "server"/);
  assert.doesNotMatch(categories, /id: "desktop"|id: "laptop"/);
  assert.match(shop, /products\.filter\(isPublicServerRam\)/);
  assert.doesNotMatch(shop, /@\/lib\/shopFilters/);
  assert.match(product, /if \(!isPublicServerRam\(product\)\)/);
  assert.match(product, /\.filter\(isPublicServerRam\)/);
  assert.match(product, /setItems\(results\.filter\(Boolean\)\.filter\(isPublicServerRam\)\)/);
});

test("the restored navigation and account flow retain the original ITAD, commerce, and Google sign-in paths", async () => {
  const [header, authModal, app] = await Promise.all([
    readFile(new URL("../src/components/Header.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuthModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);

  for (const label of ["Shop RAM", "Wholesale", "Liquidation", "Support", "Guides"]) {
    assert.match(header, new RegExp(label));
  }
  assert.match(authModal, /Continue with Google/);
  for (const route of ["/liquidators", "/cart", "/checkout", "/account", "/shop", "/wholesale", "/wholesale/:lotId"]) {
    assert.match(app, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the public server catalog is a full-width inventory grid without redundant discovery controls", async () => {
  const [shop, productCard, home] = await Promise.all([
    readFile(new URL("../src/pages/Shop.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ProductCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Home.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(shop, /const publicProducts = products\.filter\(isPublicServerRam\);/);
  assert.match(shop, /publicProducts\.map\(\(p, i\) =>/);
  assert.match(shop, /grid sm:grid-cols-2 xl:grid-cols-3 gap-4/);
  assert.doesNotMatch(shop, /@\/lib\/shopFilters|productsApi\.filters|useSearchParams|<select|<input|<aside|shop-search-input|shop-sort-select|shop-filters-sidebar|shop-mobile-filter-btn|mobile-filters-overlay|filter-ecc-only/);
  assert.doesNotMatch(productCard, /p\.ecc|>ECC</);
  assert.match(productCard, /formatStorePrice\(p\.price\)/);
  assert.match(productCard, /p\.compareAt > p\.price/);
  assert.match(home, /AVAILABLE INVENTORY/);
  assert.doesNotMatch(home, /FEATURED STOCK|featured stock/i);
});

test("fetchAllCatalogProducts requests every backend page and orders ties consistently", async () => {
  const requestedPages = [];
  const pageResponses = {
    1: {
      products: [
        { _id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
        { _id: "c", createdAt: "2026-02-01T00:00:00.000Z" },
      ],
      pagination: { pages: 3 },
    },
    2: {
      products: [{ _id: "b", createdAt: "2026-01-01T00:00:00.000Z" }],
    },
    3: {
      products: [{ _id: "d", createdAt: "2025-01-01T00:00:00.000Z" }],
    },
  };

  const products = await fetchAllCatalogProducts(async ({ page, limit }) => {
    requestedPages.push({ page, limit });
    return { data: pageResponses[page] };
  });

  assert.deepEqual(requestedPages, [
    { page: 1, limit: 100 },
    { page: 2, limit: 100 },
    { page: 3, limit: 100 },
  ]);
  assert.deepEqual(products.map((product) => product._id), ["c", "b", "a", "d"]);
});

test("fetchAllCatalogProducts stops before requesting a later page when cancelled", async () => {
  const controller = new AbortController();
  const requestedPages = [];

  await assert.rejects(
    fetchAllCatalogProducts(async ({ page }) => {
      requestedPages.push(page);
      controller.abort();
      return { data: { products: [], pagination: { pages: 2 } } };
    }, { signal: controller.signal }),
    { name: "AbortError" },
  );

  assert.deepEqual(requestedPages, [1]);
});
