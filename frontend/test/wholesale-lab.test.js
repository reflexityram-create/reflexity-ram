import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WHOLESALE_LOTS } from "../src/data/wholesaleLots.js";
import {
  buildWholesaleEmailUrl,
  normalizeWholesaleQuantity,
  publishedWholesaleLots,
} from "../src/lib/wholesaleLots.js";

const publishedLot = {
  id: "lot-samsung-ddr4-001",
  status: "published",
  visibility: "public",
  title: "Samsung 32GB DDR4 RDIMM lot",
  mpn: "M393A4K40DB3-CWE",
  quantityAvailable: 38,
  minimumOrderQuantity: 10,
  orderIncrement: 4,
};

test("wholesale inventory starts intentionally empty and is manually maintained", () => {
  assert.equal(Object.isFrozen(WHOLESALE_LOTS), true);
  assert.deepEqual(WHOLESALE_LOTS, []);
});

test("only explicitly published wholesale lots can appear", () => {
  const visible = publishedWholesaleLots([
    publishedLot,
    { ...publishedLot, id: "local", visibility: "local-demo" },
    { ...publishedLot, id: "draft", status: "draft" },
    { ...publishedLot, id: "private", visibility: "private" },
    { ...publishedLot, id: "sold", quantityAvailable: 0 },
    { ...publishedLot, id: "below-moq", quantityAvailable: 8, minimumOrderQuantity: 10 },
    { ...publishedLot, id: "" },
  ]);

  assert.deepEqual(visible.map(({ id }) => id), ["lot-samsung-ddr4-001", "local"]);
});

test("a below-MOQ lot cannot render with a generic quote fallback", () => {
  const belowMinimum = {
    ...publishedLot,
    id: "lot-below-minimum",
    quantityAvailable: 8,
    minimumOrderQuantity: 10,
  };

  assert.deepEqual(publishedWholesaleLots([belowMinimum]), []);
  assert.equal(normalizeWholesaleQuantity(belowMinimum, 10), 0);
});

test("quote quantities honor MOQ, increments, and exact available stock", () => {
  assert.equal(normalizeWholesaleQuantity(publishedLot, 0), 10);
  assert.equal(normalizeWholesaleQuantity(publishedLot, 11), 14);
  assert.equal(normalizeWholesaleQuantity(publishedLot, 99), 38);
  assert.equal(normalizeWholesaleQuantity({ ...publishedLot, quantityAvailable: 19 }, 99), 18);
  assert.equal(normalizeWholesaleQuantity({ ...publishedLot, quantityAvailable: 8 }, 8), 0);
});

test("the general contact action opens a pre-addressed wholesale email draft", () => {
  const url = new URL(buildWholesaleEmailUrl());
  assert.equal(url.origin, "https://mail.google.com");
  assert.equal(url.searchParams.get("to"), "reflexityram@gmail.com");
  assert.equal(url.searchParams.get("su"), "Wholesale RAM volume request");
  assert.match(url.searchParams.get("body"), /SKU \/ part number:/);
  assert.match(url.searchParams.get("body"), /Quantity:/);
  assert.match(url.searchParams.get("body"), /Destination:/);
});

test("a posted lot produces a review-only email with its exact identity and bounded quantity", () => {
  const url = new URL(buildWholesaleEmailUrl([{ lot: publishedLot, quantity: 11 }]));
  assert.equal(url.searchParams.get("su"), "Wholesale lot request — M393A4K40DB3-CWE");
  assert.match(url.searchParams.get("body"), /Lot ID: lot-samsung-ddr4-001/);
  assert.match(url.searchParams.get("body"), /MPN: M393A4K40DB3-CWE/);
  assert.match(url.searchParams.get("body"), /Requested quantity: 14/);
});

test("the local route is development-only and never reads the regular Product API", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../src/data/wholesaleLots.js", import.meta.url), "utf8");

  assert.match(app, /const WholesaleLab = import\.meta\.env\.DEV/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLab"\)\)/);
  assert.match(app, /path="\/wholesale-lab"/);
  assert.doesNotMatch(page, /useStock|productsApi|\/api\/products|stockQuantity|cartApi|checkoutApi/);
  assert.match(page, /Products from the regular shop never\s+show in this section\./);
  assert.match(data, /separate from the retail Product API/);
  assert.match(data, /WHOLESALE_LOTS = Object\.freeze\(\[\]\)/);
});

test("the corrected page uses Reflexity yellow tokens and the requested contact language", async () => {
  const page = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/pages/wholesale-lab.css", import.meta.url), "utf8");

  assert.match(page, /BUYING IN VOLUME\?/);
  assert.match(page, /We do wholesale on server pulls — tell us the SKU and quantity\./);
  assert.match(page, /Get bulk pricing/);
  assert.match(page, /DON&apos;T SEE WHAT YOU NEED\?/);
  assert.match(page, /Contact us/);
  assert.match(css, /var\(--brand-yellow\)/);
  assert.match(css, /var\(--bg-elev\)/);
  assert.doesNotMatch(css, /#b4eb62|--wl-green|current public catalog/i);
});
