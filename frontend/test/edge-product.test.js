import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readEdgeProduct } from "../src/lib/edgeProduct.js";

const docWith = (text) => ({ getElementById: (id) => (id === "edge-product-data" && text !== null ? { textContent: text } : null) });

test("readEdgeProduct returns the embedded product only for the slug on screen", () => {
  const product = { slug: "a", name: "A" };
  const doc = docWith(JSON.stringify({ slug: "a", product }));
  assert.deepEqual(readEdgeProduct("a", doc), product);
  assert.equal(readEdgeProduct("b", doc), null);
  assert.equal(readEdgeProduct("a", docWith(null)), null);
  assert.equal(readEdgeProduct("a", docWith("{not json")), null);
  assert.equal(readEdgeProduct("a", docWith(JSON.stringify({ slug: "a", product: { slug: "x" } }))), null);
  assert.equal(readEdgeProduct("a", undefined), null);
});

test("the product page starts from the edge product and keeps it when the API is slow or down", async () => {
  const src = await readFile(new URL("../src/pages/Product.jsx", import.meta.url), "utf8");
  assert.match(src, /readEdgeProduct\(slug\)/);
  assert.match(src, /useState\(!initialEdge\)/);
  assert.match(src, /setLoading\(!edge\)/);
  assert.match(src, /setP\(edge\)/);
  assert.match(src, /else if \(!edge\) setLoadFailed\(true\)/);
  assert.doesNotMatch(src, /setP\(null\);/);
});
