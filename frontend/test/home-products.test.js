import assert from "node:assert/strict";
import test from "node:test";
import { pickHomeExactParts } from "../src/lib/homeProducts.js";

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
