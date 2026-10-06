// The product page, the edge function and the Merchant Center feed describe a stick from the same fields. Before 2026-10-06 the page removed the edge's
// JSON-LD and put in a poorer one (no shipping details, no return policy, "Used" for a stick the feed calls refurbished), and the titles ran 80-98 characters.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildProductSchema, injectProductMetadata, productSeoDescription, productSeoTitle, withSiteName } from "../functions-shared/productMetadata.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// The four live products, as the public API returns them (2026-10-06).
const LIVE = [
  { slug: "lenovo", sku: "RFX-L", name: "Lenovo 16GB DDR4-3200 ECC RDIMM Server Memory 2Rx8 4X71B67860 — Factory Sealed", brand: "Lenovo", mpn: "4X71B67860", capacityLabel: "16GB", generation: "DDR4", speed: 3200, speedLabel: "3200 MT/s", formFactor: "RDIMM", ecc: true, cas: "CL22", condition: "New", warranty: "30 Days", price: 170, stock: "in",
    description: "Genuine Lenovo OEM 16GB DDR4-3200 ECC Registered DIMM memory, factory sealed in original Lenovo packaging. Part number 4X71B67860." },
  { slug: "hynix16", sku: "RFX-H16", name: "SK hynix 16GB DDR4-3200 ECC RDIMM Server Memory PC4-3200AA 2Rx8 HMA82GR7DJR8N-XN", brand: "SK hynix", mpn: "HMA82GR7DJR8N-XN", capacityLabel: "16GB", generation: "DDR4", speed: 3200, speedLabel: "3200 MT/s", formFactor: "RDIMM", ecc: true, cas: "CL22", condition: "Open Box — Tested", warranty: "30 Days", price: 135, stock: "in",
    description: "SK hynix 16GB DDR4-3200 ECC Registered DIMM server memory. 2Rx8, PC4-3200AA, 288-pin RDIMM. Manufacturer part number HMA82GR7DJR8N-XN. Line Server Generation DDR4." },
  { slug: "samsung64", sku: "RFX-S64", name: "Samsung 64GB DDR4-3200 ECC LRDIMM Server Memory PC4-3200AA 4Rx4 M386A8K40DM2-CWEZY", brand: "Samsung", mpn: "M386A8K40DM2-CWEZY", capacityLabel: "64GB", generation: "DDR4", speed: 3200, speedLabel: "3200 MT/s", formFactor: "LRDIMM", ecc: true, cas: "CL22", condition: "Used", warranty: "30 Days", price: 585, stock: "low",
    description: "Samsung 64GB DDR4-3200 ECC load-reduced server memory (LRDIMM), 4Rx4, 1.2V. Manufacturer part number M386A8K40DM2-CWEZY. Used." },
  { slug: "hynix64", sku: "RFX-H64", name: "SK hynix 64GB DDR4-2666 ECC LRDIMM Server Memory 4Rx4 HMAA8GL7CPR4N-VK", brand: "SK hynix", mpn: "HMAA8GL7CPR4N-VK", capacityLabel: "64GB", generation: "DDR4", speed: 2666, speedLabel: "2666 MT/s", formFactor: "LRDIMM", ecc: true, cas: "CL19", condition: "Used", warranty: "30 Days", price: 500, stock: "low",
    description: "SK hynix 64GB DDR4-2666 ECC load-reduced server memory (LRDIMM), 4Rx4, 1.2V. Manufacturer part number HMAA8GL7CPR4N-VK. Used." },
];

test("titles lead with what a buyer searches for and fit a search result", () => {
  const titles = LIVE.map((p) => withSiteName(productSeoTitle(p)));
  assert.deepEqual(titles, [
    "Lenovo 16GB DDR4-3200 ECC RDIMM 4X71B67860 — Reflexity RAM",
    "SK hynix 16GB DDR4-3200 ECC RDIMM HMA82GR7DJR8N-XN — Reflexity RAM",
    "Samsung 64GB DDR4-3200 ECC LRDIMM M386A8K40DM2-CWEZY — Reflexity RAM",
    "SK hynix 64GB DDR4-2666 ECC LRDIMM HMAA8GL7CPR4N-VK — Reflexity RAM",
  ]);
  for (const t of titles) assert.ok(t.length <= 70, `${t.length}: ${t}`);          // they were 86-98 characters
});

test("a stored metaTitle always wins, a sparse product keeps its name, and the site name is never added twice", () => {
  assert.equal(productSeoTitle({ ...LIVE[0], metaTitle: "Custom title" }), "Custom title");
  assert.equal(productSeoTitle({ name: "Some module", brand: "X" }), "Some module");
  assert.equal(withSiteName("Custom title"), "Custom title — Reflexity RAM");
  assert.equal(withSiteName("Custom — Reflexity RAM"), "Custom — Reflexity RAM");
  assert.equal(withSiteName(""), "");
  assert.equal(productSeoTitle({ ...LIVE[0], mpn: "X".repeat(80) }), LIVE[0].name, "a composed title that would run long falls back to the name");
});

test("descriptions end on a whole sentence, fit a snippet, and prefer what the owner stored", () => {
  for (const p of LIVE) {
    const d = productSeoDescription(p);
    assert.ok(d.length <= 160, `${p.slug}: ${d.length}`);
    assert.ok(/[.…]$/.test(d), `${p.slug}: ends mid-phrase: ${d}`);
  }
  assert.equal(productSeoDescription(LIVE[1]), "SK hynix 16GB DDR4-3200 ECC Registered DIMM server memory. 2Rx8, PC4-3200AA, 288-pin RDIMM. Manufacturer part number HMA82GR7DJR8N-XN.");
  assert.equal(productSeoDescription({ ...LIVE[1], metaDescription: "Stored text." }), "Stored text.");
  assert.equal(
    productSeoDescription({ ...LIVE[2], description: "", metaDescription: "" }),
    "Samsung 64GB DDR4-3200 ECC LRDIMM server memory, part number M386A8K40DM2-CWEZY. Used. 30 Days warranty. Tracked shipping from Toronto, Canada.",
  );
  assert.equal(productSeoDescription({}), "", "nothing to say, nothing invented");
});

test("the Product schema carries shipping, returns, price validity, the item condition the feed uses, and the specs", () => {
  const now = Date.UTC(2026, 9, 6);
  const schema = buildProductSchema(LIVE[1], { now });
  assert.equal(schema["@type"], "Product");
  const offer = schema.offers;
  assert.equal(offer.priceValidUntil, "2026-11-05");
  assert.equal(offer.itemCondition, "https://schema.org/RefurbishedCondition");     // the feed says refurbished; the page used to say Used
  assert.equal(offer.shippingDetails["@type"], "OfferShippingDetails");
  assert.equal(offer.shippingDetails.shippingRate.value, 14);
  assert.equal(offer.hasMerchantReturnPolicy["@type"], "MerchantReturnPolicy");
  assert.equal(offer.hasMerchantReturnPolicy.merchantReturnDays, 30);
  assert.equal(offer.availability, "https://schema.org/InStock");
  assert.deepEqual(schema.additionalProperty.map((x) => x.name), ["Generation", "Form Factor", "Capacity", "Speed", "CAS Latency", "ECC"]);
  assert.equal(schema.brand.name, "SK hynix");
  assert.equal(schema.mpn, "HMA82GR7DJR8N-XN");
  assert.equal(JSON.stringify(schema).includes("<"), false, "no raw < in the JSON the page embeds");
});

test("item condition, stock, brand guess and image list behave", () => {
  const cond = (condition) => buildProductSchema({ ...LIVE[0], condition }).offers.itemCondition;
  assert.equal(cond("New"), "https://schema.org/NewCondition");
  assert.equal(cond("Open Box — Tested"), "https://schema.org/RefurbishedCondition");
  assert.equal(cond("Refurbished — Tested"), "https://schema.org/RefurbishedCondition");
  assert.equal(cond("Used"), "https://schema.org/UsedCondition");
  assert.equal(buildProductSchema({ ...LIVE[0], stock: "out" }).offers.availability, "https://schema.org/OutOfStock");
  assert.equal(buildProductSchema({ name: "SK hynix 8GB DDR4", price: 1 }).brand.name, "SK hynix", "no stored brand: the page's old guess");
  assert.deepEqual(buildProductSchema(LIVE[0], { images: ["https://x.test/a.jpg", "https://x.test/b.jpg"] }).image, ["https://x.test/a.jpg", "https://x.test/b.jpg"]);
  assert.equal(buildProductSchema({ ...LIVE[0], shippingPrice: 20 }).offers.shippingDetails.shippingRate.value, 20, "a product's own shipping rate carries into the schema");
});

test("the HTML the edge serves contains the same schema the page builds, and the same title", () => {
  const shell = `<!doctype html><html><head><title>old</title></head><body><div id="root"></div></body></html>`;
  const html = injectProductMetadata(shell, LIVE[1], "hynix16");
  assert.match(html, /<title>SK hynix 16GB DDR4-3200 ECC RDIMM HMA82GR7DJR8N-XN — Reflexity RAM<\/title>/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json" data-edge-product>(.*?)<\/script>/)[1]);
  assert.ok(ld.offers.shippingDetails && ld.offers.hasMerchantReturnPolicy && ld.offers.priceValidUntil && ld.additionalProperty);
  const page = buildProductSchema(LIVE[1], { url: ld.offers.url, description: ld.description, images: ld.image });
  assert.deepEqual(Object.keys(page), Object.keys(ld), "same keys in the same order");
  assert.deepEqual(page.offers, ld.offers);
});

test("the page uses the shared builders and no longer carries its own copy of the schema or the title rule", async () => {
  const source = await read("../src/pages/Product.jsx");
  assert.match(source, /from "\.\.\/\.\.\/functions-shared\/productMetadata\.js"/);
  assert.match(source, /buildProductSchema\(p, \{/);
  assert.match(source, /title: p \? productSeoTitle\(p\) : undefined/);
  assert.match(source, /description: p \? productSeoDescription\(p\) : null/);
  assert.doesNotMatch(source, /"@type": "Offer"/, "the offer is built in one place");
  assert.doesNotMatch(source, /priceValidUntil/);
  assert.doesNotMatch(source, /schema\.org\/UsedCondition/);
});
