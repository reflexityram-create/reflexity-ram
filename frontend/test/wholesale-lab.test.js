import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLeadPrefill } from "../src/lib/leadPrefill.js";
import { normalizeWholesaleQuantity, publishedWholesaleLots } from "../src/lib/wholesaleLots.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const publishedLot = { id: "lot-samsung-ddr4-001", status: "published", visibility: "public", title: "Samsung 32GB DDR4 RDIMM lot", mpn: "M393A4K40DB3-CWE", quantityAvailable: 38, minimumOrderQuantity: 10, orderIncrement: 4 };

test("only explicitly published wholesale lots can appear", () => {
  const visible = publishedWholesaleLots([publishedLot, { ...publishedLot, id: "local", visibility: "local-demo" }, { ...publishedLot, id: "draft", status: "draft" }, { ...publishedLot, id: "private", visibility: "private" }, { ...publishedLot, id: "sold", quantityAvailable: 0 }, { ...publishedLot, id: "below-moq", quantityAvailable: 8, minimumOrderQuantity: 10 }, { ...publishedLot, id: "" }]);
  assert.deepEqual(visible.map(({ id }) => id), ["lot-samsung-ddr4-001", "local"]);
});

test("a below-MOQ lot cannot render with a generic quote fallback", () => {
  const belowMinimum = { ...publishedLot, id: "lot-below-minimum", quantityAvailable: 8, minimumOrderQuantity: 10 };
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

test("general buyer requirements open the on-site quote form rather than Gmail", () => {
  const url = new URL(buildLeadPrefill({ intent: "buy", productType: "RAM" }), "https://reflexityram.com");
  assert.equal(url.pathname, "/contact");
  assert.equal(url.searchParams.get("intent"), "buy");
  assert.equal(url.searchParams.get("productType"), "RAM");
  assert.doesNotMatch(url.toString(), /mail\.google\.com/);
});

test("a posted lot pre-fills the quote desk with exact identity and bounded quantity", () => {
  const url = new URL(buildLeadPrefill({ intent: "buy", productType: "RAM", partNumber: publishedLot.mpn, specification: "32GB DDR4 RDIMM", quantity: normalizeWholesaleQuantity(publishedLot, 11) }), "https://reflexityram.com");
  assert.equal(url.pathname, "/contact");
  assert.equal(url.searchParams.get("partNumber"), "M393A4K40DB3-CWE");
  assert.equal(url.searchParams.get("specification"), "32GB DDR4 RDIMM");
  assert.equal(url.searchParams.get("quantity"), "11");
});

test("the live route uses the API while the demo adapter remains a development-only alias", async () => {
  const [app, local] = await Promise.all([read("../src/App.jsx"), read("../src/pages/WholesaleLab.jsx")]);
  assert.match(app, /const WholesaleLab = import\.meta\.env\.DEV/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLab"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("@\/pages\/WholesaleLabLot"\)\)/);
  assert.match(app, /path="\/wholesale" element=\{<Wholesale \/>\}/);
  assert.match(app, /path="\/wholesale-lab"/);
  assert.match(app, /path="\/wholesale-lab\/:lotId"/);
  assert.match(local, /import \{ WholesaleMarket \} from "@\/pages\/Wholesale"/);
  assert.match(local, /publishedWholesaleDemoLots\(lots\)/);
  assert.match(local, /detailBasePath="\/wholesale-lab"/);
  assert.match(local, /postedLots=\{error \? \[\] : publishedWholesaleDemoLots\(lots\)\}/);
  assert.match(local, /stockError=\{error\}/);
  assert.doesNotMatch(local, /useStock|productsApi|\/api\/products|stockQuantity|cartApi|checkoutApi/);
});

test("the wholesale buyer page leads with inventory and quote-led sourcing", async () => {
  const page = await read("../src/pages/Wholesale.jsx");
  assert.match(page, /REFLEXITY \/ WHOLESALE BUYERS/);
  assert.match(page, /Bulk hardware for organizations that work in exact parts/);
  assert.match(page, /POSTED LOTS/);
  assert.match(page, /Send purchase requirements/);
  assert.match(page, /No lots are posted right now[\s\S]*Send an exact requirement/);
  assert.match(page, /Memory categories/);
  assert.match(page, /Related hardware/);
  assert.match(page, /Commercial approach/);
  assert.doesNotMatch(page, /Add to cart|Buy now|Checkout|Free shipping|coupon/i);
});

test("wholesale cards open a dedicated public lot route", async () => {
  const [app, page, detail] = await Promise.all([read("../src/App.jsx"), read("../src/pages/Wholesale.jsx"), read("../src/pages/WholesaleLot.jsx")]);
  assert.match(app, /path="\/wholesale\/:lotId" element=\{<WholesaleLot \/>\}/);
  assert.match(page, /detailBasePath = "\/wholesale"/);
  assert.match(page, /to=\{`\$\{detailBasePath\}\/\$\{encodeURIComponent\(lot\.id\)\}`\}/);
  assert.match(page, /lot\.quantityAvailable \? `\$\{lot\.quantityAvailable\}\+ available` : "Confirm availability"/);
  assert.match(detail, /export function WholesaleLotDetail/);
  assert.match(detail, /WholesaleLotDetail(?: key=\{state\.lot\.id\})? lot=\{state\.lot\}/);
  assert.match(detail, />Request \{quantity\}/);
  assert.match(detail, /wholesaleApi\.getById\(lotId, \{ signal: controller\.signal \}\)/);
  assert.match(detail, /let active = true[\s\S]*setState\(\{ lot: null, loading: true \}\)[\s\S]*if \(!active\) return[\s\S]*active = false; controller\.abort\(\)/);
  assert.doesNotMatch(detail, /wholesaleApi\.list\(/);
});

test("the wholesale detail picker caps selection and carries it to a lead prefill", async () => {
  const detail = await read("../src/pages/WholesaleLot.jsx");
  assert.match(detail, /normalizeWholesaleQuantity\(lot, lot\.quantityAvailable\)/);
  assert.match(detail, /const \[quantity, setQuantity\] = useState\(1\)/);
  assert.match(detail, /buildLeadPrefill\(\{ intent: "buy"/);
  assert.match(detail, /htmlFor="wholesale-quantity">Request quantity/);
  assert.match(detail, /max=\{maximum\}/);
  assert.match(detail, /min="1"/);
  assert.match(detail, /disabled=\{quantity >= maximum\}/);
  assert.match(detail, /Request \{quantity\} \{quantity === 1 \? "unit" : "units"\}/);
  assert.doesNotMatch(detail, /buildWholesaleEmailUrl|mail\.google\.com|MOQ:/);
  assert.match(detail, /Quantity is an inquiry only/);
});

test("the local demo detail reuses the production quantity experience without the live API", async () => {
  const detail = await read("../src/pages/WholesaleLabLot.jsx");
  assert.match(detail, /publishedWholesaleDemoLots\(lots\)\.find/);
  assert.match(detail, /<WholesaleLotDetail backTo="\/wholesale-lab" lot=\{lot\} \/>/);
  assert.match(detail, /data-testid="wholesale-lab-detail-page"/);
  assert.doesNotMatch(detail, /wholesaleApi|\/api\/wholesale/);
});

test("the official wholesale shell reads only the fail-closed public API", async () => {
  const [page, local] = await Promise.all([read("../src/pages/Wholesale.jsx"), read("../src/pages/WholesaleLab.jsx")]);
  assert.match(page, /import \{ wholesaleApi \} from "@\/lib\/api"/);
  assert.match(page, /publishedWholesaleLots\(data\?\.lots \|\| \[\]\)\.filter\(\(lot\) => lot\.visibility === "public"\)/);
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /setState\(\{ lots: \[\], loading: false, error:/);
  assert.doesNotMatch(page, /WHOLESALE_LOTS|@\/data\/wholesaleLots|wholesaleDemoStore|useWholesaleDemoLots|localStorage/);
  assert.match(local, /useWholesaleDemoLots/);
  assert.match(local, /LOCAL DEMO/);
  assert.match(local, /never changes production inventory/);
});
