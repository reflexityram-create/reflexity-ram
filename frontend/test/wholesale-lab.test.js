import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  assert.equal(normalizeWholesaleQuantity(belowMinimum, 8), 8);
});

test("request quantities allow any whole unit while respecting available stock", () => {
  assert.equal(normalizeWholesaleQuantity(publishedLot, 0), 1);
  assert.equal(normalizeWholesaleQuantity(publishedLot, 11), 11);
  assert.equal(normalizeWholesaleQuantity(publishedLot, 99), 38);
  assert.equal(normalizeWholesaleQuantity({ ...publishedLot, quantityAvailable: 19 }, 99), 19);
  assert.equal(normalizeWholesaleQuantity({ ...publishedLot, quantityAvailable: 8 }, 8), 8);
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
  assert.match(url.searchParams.get("body"), /Requested quantity: 11/);
  assert.match(url.searchParams.get("body"), /confirm what quantity you can accommodate/);
});

test("the live route uses the API while the demo adapter remains on a development-only alias", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const local = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");

  assert.match(app, /const WholesaleLab = import\.meta\.env\.DEV/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLab"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLabLot"\)\)/);
  assert.match(app, /path="\/wholesale"[\s\S]*?element=\{<Wholesale \/>\}/);
  assert.match(app, /path="\/wholesale-lab"/);
  assert.match(app, /path="\/wholesale-lab\/:lotId"/);
  assert.match(local, /import \{ WholesaleMarket \} from "@\/pages\/Wholesale"/);
  assert.match(local, /publishedWholesaleDemoLots\(lots\)/);
  assert.match(local, /badgeLabel="LOCAL DEMO"/);
  assert.match(local, /detailBasePath="\/wholesale-lab"/);
  assert.match(local, /postedLots=\{error \? \[\] : publishedWholesaleDemoLots\(lots\)\}/);
  assert.match(local, /stockError=\{error\}/);
  assert.doesNotMatch(local, /useStock|productsApi|\/api\/products|stockQuantity|cartApi|checkoutApi/);
});

test("the combined wholesale page makes inventory primary and exact sourcing secondary", async () => {
  const page = await readFile(new URL("../src/pages/Wholesale.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/pages/wholesale-concepts.css", import.meta.url), "utf8");

  const stockIndex = page.indexOf("<WholesaleInventory");
  const sourcingIndex = page.indexOf('<aside className="ws-coming"');
  assert.ok(stockIndex >= 0 && sourcingIndex > stockIndex);
  assert.match(page, /Wholesale RAM\.<br \/><em>Ready stock or sourced\.<\/em>/);
  assert.match(page, /<h2 id="wholesale-stock-title">Posted wholesale stock<\/h2>/);
  assert.match(page, /NEED A SPECIFIC SKU\?/);
  assert.match(page, /Tell us the SKU and quantity\./);
  assert.match(page, /Get bulk pricing/);
  assert.match(page, /Selling stock to Reflexity\?/);
  assert.doesNotMatch(page, /DON&apos;T SEE WHAT YOU NEED\?|Send the requirement\./);
  assert.match(css, /grid-template-columns: minmax\(0,1\.65fr\) minmax\(350px,\.72fr\)/);
  assert.match(css, /\.ws-coming \{[^}]*position: sticky/s);
  assert.match(page, /grid sm:grid-cols-2 gap-4/);
  assert.doesNotMatch(css, /#b4eb62|--wl-green|current public catalog/i);
});

test("wholesale cards open a dedicated detail route like regular shop products", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/pages/Wholesale.jsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../src/pages/WholesaleLot.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/pages/wholesale-concepts.css", import.meta.url), "utf8");

  assert.match(app, /path="\/wholesale\/:lotId" element=\{<WholesaleLot \/>\}/);
  assert.match(page, /detailBasePath = "\/wholesale"/);
  assert.match(page, /to=\{`\$\{detailBasePath\}\/\$\{encodeURIComponent\(lot\.id\)\}`\}/);
  assert.match(page, /View details/);
  assert.match(page, /formatStorePrice\(lot\.unitPriceCad\)/);
  assert.match(page, /STORE_CURRENCY_CODE/);
  assert.doesNotMatch(page, /<p className="ws-lot-note">/);
  assert.match(page, /className="glass card-hover rounded-xl overflow-hidden flex flex-col fade-up"/);
  assert.match(page, /className="relative aspect-\[5\/4\] bg-gradient-to-b from-white\/\[0\.03\] to-transparent overflow-hidden"/);
  assert.match(page, /className="p-5 flex flex-col flex-1"/);
  assert.match(detail, /export function WholesaleLotDetail/);
  assert.match(detail, /WholesaleLotDetail lot=\{state\.lot\}/);
  assert.match(detail, /className="grid lg:grid-cols-\[1\.1fr_1fr\] gap-10 lg:gap-14"/);
  assert.match(detail, /className="block w-full glass rounded-2xl overflow-hidden aspect-\[5\/4\] mb-3"/);
  assert.match(detail, /className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3"/);
  assert.match(detail, /className="glass rounded-2xl p-6 md:p-8"/);
  assert.match(detail, />Specifications</);
  assert.match(detail, /Request \{quantity\}/);
  assert.match(detail, /formatStorePrice\(lot\.unitPriceCad\)/);
  assert.match(detail, /lots\.find\(\(lot\) => lot\.id === lotId\)/);
  assert.doesNotMatch(detail, /wholesale-concepts\.css|ws-detail-/);
});

test("the wholesale detail quantity picker caps selection and carries it into the email", async () => {
  const detail = await readFile(new URL("../src/pages/WholesaleLot.jsx", import.meta.url), "utf8");

  assert.match(detail, /normalizeWholesaleQuantity\(lot, lot\.quantityAvailable\)/);
  assert.match(detail, /const \[quantity, setQuantity\] = useState\(1\)/);
  assert.match(detail, /buildWholesaleEmailUrl\(\[\{ lot, quantity \}\]\)/);
  assert.match(detail, /htmlFor="wholesale-quantity"[^>]*>Request how many you need/);
  assert.match(detail, /max=\{maximum\}/);
  assert.match(detail, /min="1"/);
  assert.match(detail, /disabled=\{quantity >= maximum\}/);
  assert.match(detail, /Request \{quantity\} \{quantity === 1 \? "unit" : "units"\}/);
  assert.doesNotMatch(detail, /buildWholesaleEmailUrl\(\[\{ lot, quantity: minimum \}\]\)/);
  assert.doesNotMatch(detail, /MOQ:/);
  assert.match(detail, /Each wholesale order is custom/);
  assert.match(detail, /Choose your total and inquire/);
  assert.match(detail, /Custom per order/);
  assert.match(detail, /Inquire with your total quantity for details/);
  assert.doesNotMatch(detail, /lot\.warranty|warranty|defect|replacement|30 Days/i);
});

test("the local demo detail reuses the production quantity experience without the live API", async () => {
  const detail = await readFile(new URL("../src/pages/WholesaleLabLot.jsx", import.meta.url), "utf8");

  assert.match(detail, /publishedWholesaleDemoLots\(lots\)\.find/);
  assert.match(detail, /<WholesaleLotDetail backTo="\/wholesale-lab" lot=\{lot\} \/>/);
  assert.match(detail, /data-testid="wholesale-lab-detail-page"/);
  assert.doesNotMatch(detail, /wholesaleApi|\/api\/wholesale/);
});

test("the official wholesale shell reads only the fail-closed public API", async () => {
  const page = await readFile(new URL("../src/pages/Wholesale.jsx", import.meta.url), "utf8");
  const local = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/pages/wholesale-concepts.css", import.meta.url), "utf8");

  assert.match(page, /import \{ wholesaleApi \} from "@\/lib\/api"/);
  assert.match(page, /import \{ buildWholesaleEmailUrl, publishedWholesaleLots \} from "@\/lib\/wholesaleLots"/);
  assert.match(page, /const WHOLESALE_GMAIL_URL = buildWholesaleEmailUrl\(\)/);
  assert.match(page, /wholesaleApi\.list\(\{ signal: controller\.signal \}\)/);
  assert.match(page, /publishedWholesaleLots\(received\)\.filter\(\(lot\) => lot\.visibility === "public"\)/);
  assert.match(page, /setInventory\(\{\s*lots: \[\],\s*loading: false,\s*error:/s);
  assert.match(page, /lot\.visibility === "public"/);
  assert.match(page, /export function WholesaleMarket/);
  assert.doesNotMatch(page, /WHOLESALE_LOTS|@\/data\/wholesaleLots/);
  assert.doesNotMatch(page, /LOCAL DEMO|LOCAL CUSTOMER PREVIEW|LOCAL DEMO DATA UNAVAILABLE|localPreview|wholesaleDemoStore|useWholesaleDemoLots|localStorage/);
  assert.match(local, /useWholesaleDemoLots/);
  assert.match(local, /publishedWholesaleDemoLots/);
  assert.match(local, /LOCAL CUSTOMER PREVIEW/);
  assert.match(local, /LOCAL DEMO DATA UNAVAILABLE/);
  assert.match(local, /badgeLabel="LOCAL DEMO"/);
  assert.match(page, /aria-label=\{`View wholesale lot \$\{lot\.title\}`\}/);
  assert.match(page, /user\?\.role === "admin"/);
  assert.match(page, /to="\/admin\/wholesale\?new=1"/);
  assert.match(css, /\.ws-coming \{[^}]*border-radius: 14px/s);
  assert.match(css, /\.ws-contact-link \{[^}]*width: 100%/s);
  assert.match(css, /\.ws-coming-top > span \{ color: #7a5f00; \}/);
  assert.match(css, /html\.dark \.ws-coming-top > span \{ color: #f0d36f; \}/);
  assert.match(css, /\.ws-coming-top > div \{ color: var\(--ws-muted\)/);
});
