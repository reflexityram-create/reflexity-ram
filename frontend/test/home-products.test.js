import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pickHomeExactParts } from "../src/lib/homeProducts.js";
import { publicServerStock } from "../src/lib/catalog.js";

const product = (overrides = {}) => ({
  line: "Server", stock: "in", slug: "module", brand: "Samsung", capacityLabel: "32GB",
  name: "Samsung RAM", stockQuantity: 2,
  generation: "DDR4", formFactor: "RDIMM", mpn: "M393A4K40DB3-CWE", ...overrides,
});

test("home exact parts spreads choices by capacity and form factor", () => {
  assert.deepEqual(
    pickHomeExactParts([
      product(),
      product({ slug: "large", capacityLabel: "64GB", formFactor: "LRDIMM" }),
      product({ slug: "small", capacityLabel: "16GB" }),
    ]).map(({ slug }) => slug),
    ["module", "large", "small"],
  );
});

test("home exact parts excludes sold out, non-server, and incomplete products", () => {
  assert.deepEqual(pickHomeExactParts([
    product({ slug: "out", stock: "out" }),
    product({ slug: "zero", stockQuantity: 0 }),
    product({ slug: "unknown", stock: "pending" }),
    product({ slug: "missing-quantity", stockQuantity: undefined }),
    product({ slug: "negative", stockQuantity: -1 }),
    product({ slug: "string-zero", stockQuantity: "0" }),
    product({ slug: "desktop", line: "Desktop" }),
    product({ slug: "missing", mpn: "" }),
    product({ slug: "bad slug" }),
  ]), []);
});

test("home exact parts requires trimmed exact fields and accepts only valid slugs", () => {
  assert.deepEqual(
    pickHomeExactParts([
      product({ slug: "valid-part", brand: "  Samsung  " }),
      product({ slug: "UPPERCASE" }),
      product({ slug: "-starts-with-dash" }),
      product({ slug: "valid-part-2", formFactor: "   " }),
    ]).map(({ slug }) => slug),
    ["valid-part"],
  );
});

test("home exact parts are chosen from the whole catalog, not only the few newest listings the page displays", () => {
  const soldOut = (n) => product({ slug: `sold-out-${n}`, stock: "out", stockQuantity: 0 });
  const listings = [1, 2, 3, 4, 5, 6].map(soldOut).concat([
    product({ slug: "older-a" }),
    product({ slug: "older-b", capacityLabel: "64GB", formFactor: "LRDIMM" }),
    product({ slug: "desktop-stick", line: "Desktop" }),
  ]);
  const { catalog, products } = publicServerStock(listings, 6);
  assert.deepEqual(products.map(({ slug }) => slug), ["sold-out-1", "sold-out-2", "sold-out-3", "sold-out-4", "sold-out-5", "sold-out-6"]);
  assert.deepEqual(catalog.map(({ slug }) => slug), [...products.map(({ slug }) => slug), "older-a", "older-b"]);
  // Choosing from the displayed few finds nothing although two modules are in stock.
  assert.deepEqual(pickHomeExactParts(products), []);
  assert.deepEqual(pickHomeExactParts(catalog).map(({ slug }) => slug), ["older-a", "older-b"]);
  assert.deepEqual(publicServerStock(null, 6), { catalog: [], products: [] });
});

test("home reserves the exact-parts section's height while the catalog loads so the rest of the page does not jump", async () => {
  const home = await readFile(new URL("../src/pages/Home.jsx", import.meta.url), "utf8");
  // Heights measured from the loaded section: 481px stacked on a 390px phone, 228px at md, 188px from lg (CLS 0.028 -> 0.097 on a 1440px home page).
  assert.match(home, /loading \? \(\s*<div className="mt-12 skeleton rounded-xl h-\[481px\] md:h-\[228px\] lg:h-\[188px\]" aria-hidden="true" data-testid="home-exact-parts-loading" \/>\s*\) : exactParts\.length > 0 && \(/);
});
