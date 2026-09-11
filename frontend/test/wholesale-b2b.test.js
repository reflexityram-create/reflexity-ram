import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLeadPrefill } from "../src/lib/leadPrefill.js";
import { createLeadRequestId } from "../src/lib/leadRequest.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("quote prefill carries exact item identity, part number, and selected lot quantity", () => {
  const url = new URL(buildLeadPrefill({ intent: "buy", productType: "RAM", sourceType: "catalog-product", sourceId: "product-123", sourceCode: "samsung-32gb-ddr4", sku: "SKU-32ECC", itemTitle: "Samsung 32GB DDR4 ECC RDIMM", partNumber: "M393A4K40CB2-CTD7Q", specification: "32GB DDR4 ECC RDIMM", quantity: 37 }), "https://reflexityram.com");
  assert.equal(url.pathname, "/contact");
  assert.equal(url.searchParams.get("partNumber"), "M393A4K40CB2-CTD7Q");
  assert.equal(url.searchParams.get("quantity"), "37");
  assert.equal(url.searchParams.get("specification"), "32GB DDR4 ECC RDIMM");
  assert.equal(url.searchParams.get("sourceType"), "catalog-product");
  assert.equal(url.searchParams.get("sourceId"), "product-123");
  assert.equal(url.searchParams.get("sourceCode"), "samsung-32gb-ddr4");
  assert.equal(url.searchParams.get("sku"), "SKU-32ECC");
  assert.equal(url.searchParams.get("itemTitle"), "Samsung 32GB DDR4 ECC RDIMM");
});

test("public routes are a B2B catalog with legacy redirects and no retail checkout shell", async () => {
  const [app, header, home, card, product] = await Promise.all([
    read("../src/App.jsx"), read("../src/components/Header.jsx"), read("../src/pages/Home.jsx"), read("../src/components/ProductCard.jsx"), read("../src/pages/Product.jsx"),
  ]);
  for (const route of ["/inventory", "/inventory/:slug", "/sell-to-us", "/wholesale", "/about", "/contact"]) assert.match(app, new RegExp(`path="${route.replace(/[/?]/g, "\\$&")}"`));
  assert.match(app, /path="\/shop" element=\{<LegacyInventoryRedirect/);
  assert.match(app, /path="\/shop\/:slug" element=\{<LegacyProductRedirect/);
  assert.match(app, /path="\/liquidators" element=\{<Navigate replace to="\/sell-to-us"/);
  assert.match(app, /path="\/business-info" element=\{<Navigate replace to="\/about"/);
  assert.match(app, /path="\/categories" element=\{<LegacyCategoriesRedirect/);
  assert.match(app, /function LegacyCategoriesRedirect\(\).*location\.search/s);
  assert.doesNotMatch(app, /pages\/(Cart|Checkout|OrderSuccess|CheckoutReturn|Account)/);
  assert.doesNotMatch(app, /path="\/(cart|checkout|order|account)/);
  assert.doesNotMatch(header, /ShoppingCart|cartStore|Account/);
  assert.match(header, /Home.*Inventory.*Sell to Us.*Wholesale.*About.*Contact/s);
  assert.match(home, /Wholesale memory/);
  assert.match(home, /View inventory/);
  assert.match(home, /Request a quote/);
  assert.match(home, /Sell us hardware/);
  assert.match(card, /to=\{`\/inventory\/\$\{p\.slug\}`\}/);
  assert.doesNotMatch(card, /formatStorePrice|compareAt|price/);
  assert.match(product, /Request bulk quote/);
  assert.doesNotMatch(product, /Add to cart|Buy now|checkout/i);
});

test("lead form posts the B2B contract with required labels, hidden honeypot, and idempotent request ID", async () => {
  const [lead, api, sell, contact] = await Promise.all([read("../src/components/LeadForm.jsx"), read("../src/lib/api.js"), read("../src/pages/SellToUs.jsx"), read("../src/pages/Contact.jsx")]);
  assert.match(api, /export const leadsApi = \{[\s\S]*?publicApi\.post\('\/leads', data\)/);
  for (const label of ["Inquiry type", "Product type", "Name", "Business email", "Part number", "Quantity", "Location", "Notes"]) assert.match(lead, new RegExp(label));
  assert.match(lead, /name="website"/);
  assert.match(lead, /lead-honeypot/);
  assert.match(lead, /role="alert"/);
  assert.match(lead, /Inquiry received/);
  assert.match(lead, /const \[requestId, setRequestId\] = useState\(null\)/);
  assert.match(lead, /const activeRequestId = requestId \|\| createLeadRequestId\(\)/);
  assert.match(lead, /setRequestId\(null\)/);
  assert.match(lead, /requestId: activeRequestId/);
  for (const field of ["sourceType", "sourceId", "sourceCode", "sku", "itemTitle"]) assert.match(lead, new RegExp(`${field}: params\\.get`));
  assert.match(lead, /form\.intent === "sell" \? "Send hardware details"/);
  assert.match(sell, /defaultIntent="sell"/);
  assert.match(contact, /LeadForm/);
});

test("lead request ID is a UUID and uses a browser-safe fallback", async () => {
  const id = createLeadRequestId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const source = await read("../src/lib/leadRequest.js");
  assert.match(source, /crypto\?\.randomUUID/);
  assert.match(source, /crypto\?\.getRandomValues/);
  assert.match(source, /Math\.random/);
});

test("wholesale lots preserve exact quantity selection but route into the quote form", async () => {
  const [wholesale, lot, product] = await Promise.all([read("../src/pages/Wholesale.jsx"), read("../src/pages/WholesaleLot.jsx"), read("../src/pages/Product.jsx")]);
  for (const buyer of ["IT asset resellers", "Computer refurbishers", "MSPs", "Data-centre and server operators", "System integrators", "Electronics recyclers"]) assert.match(wholesale, new RegExp(buyer));
  assert.match(wholesale, /publishedWholesaleLots/);
  assert.match(lot, /normalizeWholesaleQuantity\(lot, lot\.quantityAvailable\)/);
  assert.match(lot, /buildLeadPrefill\(\{ intent: "buy"/);
  assert.match(lot, /quantity \}/);
  assert.match(lot, /max=\{maximum\}/);
  assert.match(lot, /sourceType: "wholesale-lot"/);
  assert.match(lot, /sourceId: lot\.id/);
  assert.match(lot, /sourceCode: lot\.lotCode/);
  assert.match(lot, /partNumber: lot\.mpn/);
  assert.match(lot, /itemTitle: lot\.title/);
  assert.match(lot, /key=\{state\.lot\.id\}/);
  assert.match(product, /sourceType: "catalog-product"/);
  assert.match(product, /sourceId: product\.id \|\| product\._id \|\| product\.slug/);
  assert.match(product, /sourceCode: product\.slug/);
  assert.match(product, /sku: product\.sku/);
  assert.match(product, /partNumber: product\.mpn/);
  assert.doesNotMatch(lot, /buildWholesaleEmailUrl|unitPriceCad|formatStorePrice/);
});

test("detail routes clear old data and ignore stale requests, and the lab is visibly local", async () => {
  const [product, lot, lab] = await Promise.all([read("../src/pages/Product.jsx"), read("../src/pages/WholesaleLot.jsx"), read("../src/pages/WholesaleLab.jsx")]);
  for (const source of [product, lot]) {
    assert.match(source, /let active = true/);
    assert.match(source, /active = false; controller\.abort\(\)/);
    assert.match(source, /if \(!active\) return/);
  }
  assert.match(product, /setProduct\(null\); setLoading\(true\); setMissing\(false\)/);
  assert.match(lot, /setState\(\{ lot: null, loading: true \}\)/);
  assert.match(lab, /<Header \/>/);
  assert.match(lab, /<Footer \/>/);
  assert.match(lab, /LOCAL DEMO/);
  assert.doesNotMatch(lab, /badgeLabel=|errorEyebrow=|errorTitle=|inventoryEyebrow=|inventoryNote=|seoTitle=/);
});

test("production lot details use an exact public endpoint and inventory honors canonical URL filters", async () => {
  const [api, lot, shop] = await Promise.all([read("../src/lib/api.js"), read("../src/pages/WholesaleLot.jsx"), read("../src/pages/Shop.jsx")]);
  assert.match(api, /getById: \(id, config = \{\}\) => publicApi\.get\(`\/wholesale\/\$\{id\}`, config\)/);
  assert.match(lot, /wholesaleApi\.getById\(lotId, \{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(lot, /wholesaleApi\.list\(/);
  assert.match(shop, /readShopFilters\(params\)/);
  assert.match(shop, /products\.filter\(\(product\) => productMatchesShopFilters\(product, filters\)\)/);
  assert.match(shop, /setParams\(\(current\) => setShopFilterParam\(current, "q", event\.target\.value\)\)/);
  assert.match(shop, /FILTERED BY/);
});

test("catalog loading ignores canceled StrictMode passes without masking real request errors", async () => {
  const shop = await read("../src/pages/Shop.jsx");
  assert.match(shop, /let active = true/);
  assert.match(shop, /setLoading\(true\); setFailed\(false\)/);
  assert.match(shop, /if \(!active \|\| controller\.signal\.aborted \|\| error\?\.code === "ERR_CANCELED" \|\| error\?\.name === "CanceledError" \|\| error\?\.name === "AbortError"\) return;/);
  assert.match(shop, /setFailed\(true\);/);
  assert.match(shop, /finally\(\(\) => \{ if \(!active\) return; setLoading\(false\); \}\)/);
  assert.match(shop, /return \(\) => \{ active = false; controller\.abort\(\); \}/);
});

test("legal defaults are conservative and isolated from retired retail policy overrides", async () => {
  const [terms, shipping, returns, warranty, faq, international] = await Promise.all(["Terms", "Shipping", "Returns", "Warranty", "FAQ", "International"].map((name) => read(`../src/pages/policies/${name}.jsx`)));
  assert.match(terms, /inquir/);
  assert.match(terms, /not automatically create an accepted purchase agreement/);
  assert.match(shipping, /slug="shipping-b2b"/);
  assert.match(returns, /slug="returns-b2b"/);
  assert.match(warranty, /slug="warranty-b2b"/);
  assert.match(faq, /slug="faq-b2b"/);
  assert.match(international, /slug="international-b2b"/);
  for (const source of [shipping, returns, warranty, international]) assert.match(source, /Marketplace purchases|Marketplace/);
});

test("graphite panels retain accessible foregrounds when the outer page uses light theme tokens", async () => {
  const css = await read("../src/index.css");
  assert.match(css, /\.lead-form, \.lead-success, \.inventory-card, \.site-footer \{ color: #f3f6f8; \}/);
  assert.match(css, /\.lead-form-heading span, \.lead-field, \.lead-success p, \.footer-grid p, \.footer-grid a, \.footer-bottom, \.site-footer \.brand-sub \{ color: #aebdcc; \}/);
  assert.match(css, /\.lead-field input::placeholder, \.lead-field textarea::placeholder \{ color: #aebdcc; opacity: 1; \}/);
  assert.match(css, /\.lead-field select option \{ background: #0b1016; color: #f3f6f8; \}/);
  assert.match(css, /\.catalog-status \{ flex-wrap: wrap; line-height: 1\.55; overflow-wrap: anywhere; \}/);
});
