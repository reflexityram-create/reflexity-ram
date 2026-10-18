import test from "node:test";
import assert from "node:assert/strict";
import { isGuideProduct, selectGuideProducts, guideProductLabel } from "../src/lib/guideProducts.js";
import { renderStaticPage } from "../functions-shared/staticMetadata.js";

const base = { line: "Server", slug: "valid-server-ram", name: "Server RAM", mpn: "EXACT-MPN", stock: "in", stockQuantity: 2 };

test("guide products keep only valid, available Server listings", () => {
  assert.equal(isGuideProduct(base), true);
  assert.equal(isGuideProduct({ ...base, line: "Desktop" }), false);
  assert.equal(isGuideProduct({ ...base, slug: "Bad Slug" }), false);
  assert.equal(isGuideProduct({ ...base, stock: "out" }), false);
  assert.equal(isGuideProduct({ ...base, stockQuantity: 0 }), false);
  assert.equal(isGuideProduct({ ...base, stockQuantity: undefined }), false);
  assert.equal(isGuideProduct({ ...base, stockQuantity: "2" }), false);
  assert.equal(isGuideProduct({ ...base, mpn: " " }), false);
  assert.deepEqual(selectGuideProducts([
    { ...base, slug: "first" },
    { ...base, slug: "sold-out", stock: "out" },
    { ...base, slug: "second", stock: "low", stockQuantity: 1 },
    { ...base, slug: "consumer", line: "Desktop" },
  ]).map((product) => product.slug), ["first", "second"]);
});

test("guide product labels stay useful when optional fields are missing", () => {
  assert.equal(guideProductLabel({ brand: "Samsung", capacityLabel: "32GB", generation: "DDR4", formFactor: "RDIMM" }), "Samsung · 32GB · DDR4 · RDIMM");
  assert.equal(guideProductLabel({}), "Server RAM");
});

test("static guide product links include available Server MPNs and exclude invalid or sold-out rows", async () => {
  const response = await renderStaticPage({
    request: new Request("https://reflexityram.com/guides/how-to-identify-ram"),
    next: async () => new Response('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { headers: { "Content-Type": "text/html" } }),
  }, {
    fetchImpl: async () => Response.json({ products: [
      { slug: "live-server", name: "Live server <RAM>", line: "Server", stock: "in", stockQuantity: 1, mpn: "LIVE-MPN", generation: "DDR4", formFactor: "RDIMM", capacityLabel: "16GB" },
      { slug: "sold-out", name: "Sold out", line: "Server", stock: "out", mpn: "OUT-MPN" },
      { slug: "consumer", name: "Consumer", line: "Desktop", stock: "in", mpn: "CONSUMER-MPN" },
      { slug: "unknown-quantity", name: "Unknown stock", line: "Server", stock: "in", mpn: "UNKNOWN-MPN" },
      { slug: "missing-mpn", name: "Incomplete exact part", line: "Server", stock: "in", stockQuantity: 1 },
    ] }),
    listFetchBudgetMs: 100,
  });
  const html = await response.text();
  assert.match(html, /href="\/shop\/live-server">Live server &lt;RAM&gt;<\/a>/);
  assert.match(html, /DDR4 · RDIMM · 16GB · LIVE-MPN/);
  assert.doesNotMatch(html, /sold-out|consumer|OUT-MPN|CONSUMER-MPN|unknown-quantity|UNKNOWN-MPN|missing-mpn/);
});
