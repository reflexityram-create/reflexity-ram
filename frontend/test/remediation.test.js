import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLeadPrefill } from "../src/lib/leadPrefill.js";
import { serializeJsonLd } from "../src/lib/safeJsonLd.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("policy and analytics defaults remain safe across themes and paths", async () => {
  const [css, html, analytics, app] = await Promise.all([
    read("../src/index.css"), read("../index.html"), read("../public/analytics-bootstrap.js"), read("../src/App.jsx"),
  ]);
  for (const token of ["--policy-heading: #ffffff", "--policy-heading: #171717", "--policy-link: #93b4ff", "--policy-link: #1557a6"]) assert.match(css, new RegExp(token));
  assert.match(css, /\.policy-content a[^\n]*color: var\(--policy-link\)/);
  assert.match(html, /<script defer src="\/analytics-bootstrap\.js"><\/script>/);
  assert.match(html, /<script defer src="\/font-bootstrap\.js"><\/script>/);
  assert.match(html, /rel="preconnect" href="https:\/\/reflexity-ram\.onrender\.com" crossorigin/);
  assert.match(html, /rel="preconnect" href="https:\/\/res\.cloudinary\.com" crossorigin/);
  assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/);
  assert.match(analytics, /window\.location\.hostname === "reflexityram\.com"/);
  assert.match(analytics, /send_page_view: false/);
  assert.match(app, /page_location: `\$\{window\.location\.origin\}\$\{location\.pathname\}`/);
  assert.match(app, /page_path: location\.pathname/);
  assert.doesNotMatch(app, /page_location:[^\n]*location\.hash|page_location:[^\n]*location\.search/);
});

test("public inventory reads are header-free and item images retain responsive priority", async () => {
  const [api, product] = await Promise.all([read("../src/lib/api.js"), read("../src/pages/Product.jsx")]);
  assert.match(api, /const publicApi = axios\.create/);
  assert.match(api, /list: \(params, config = \{\}\) => publicApi\.get\('\/products'/);
  assert.match(api, /getBySlug: \(slug, config = \{\}\) => publicApi\.get/);
  assert.doesNotMatch(api.match(/const publicApi = axios\.create\([\s\S]*?\n\}\);/)?.[0] || "", /withCredentials|Content-Type|x-session-id/);
  assert.match(product, /srcSet=\{imageSrcSet/);
  assert.match(product, /fetchPriority="high"/);
  assert.match(product, /loading="eager"/);
});

test("inventory detail and wholesale reads cancel stale work and do not publish stale results", async () => {
  const [product, wholesale, lot] = await Promise.all([
    read("../src/pages/Product.jsx"), read("../src/pages/Wholesale.jsx"), read("../src/pages/WholesaleLot.jsx"),
  ]);
  for (const source of [product, wholesale, lot]) {
    assert.match(source, /new AbortController\(\)/);
    assert.match(source, /controller\.abort\(\)/);
  }
  assert.match(product, /let active = true[\s\S]*if \(!active\) return[\s\S]*active = false/);
  assert.match(wholesale, /error\?\.code !== "ERR_CANCELED"/);
  assert.match(lot, /wholesaleApi\.getById\(lotId, \{ signal: controller\.signal \}\)/);
  assert.match(lot, /let active = true[\s\S]*setState\(\{ lot: null, loading: true \}\)[\s\S]*if \(!active\) return[\s\S]*active = false; controller\.abort\(\)/);
  assert.doesNotMatch(lot, /wholesaleApi\.list\(/);
});

test("quote forms keep labels, error semantics, honeypot, and no retail purchase controls", async () => {
  const [lead, product, wholesaleLot] = await Promise.all([
    read("../src/components/LeadForm.jsx"), read("../src/pages/Product.jsx"), read("../src/pages/WholesaleLot.jsx"),
  ]);
  assert.match(lead, /htmlFor=\{id\}/);
  assert.match(lead, /cloneElement\(children, \{ id:/);
  assert.match(lead, /lead-honeypot/);
  assert.match(lead, /response\?\.data\?\.error/);
  assert.match(lead, /role="alert"/);
  for (const source of [product, wholesaleLot]) {
    assert.match(source, /buildLeadPrefill/);
    assert.doesNotMatch(source, /Add to cart|Buy now|Checkout|cartApi|checkoutApi/i);
  }
});

test("NotFound sets noindex and normal SEO cleanup restores robots metadata", async () => {
  const [seo, notFound] = await Promise.all([read("../src/lib/seo.jsx"), read("../src/pages/NotFound.jsx")]);
  assert.match(notFound, /useSEO\(\{ title: "Page not found", noindex: true \}\)/);
  assert.match(seo, /noindex = false/);
  assert.match(seo, /noindex, nofollow/);
  assert.match(seo, /data-reflexity-seo/);
  assert.match(seo, /return \(\) => \{/);
});

test("deactivated and replaced sessions are cleared or revalidated across tabs", async () => {
  const [api, app] = await Promise.all([read("../src/lib/api.js"), read("../src/App.jsx")]);
  assert.match(api, /authError\.includes\('deactivated'\)/);
  assert.match(app, /const nextToken = event\.newValue/);
  assert.match(app, /void current\.initialize\(\)/);
});

test("the public site publishes one canonical security contact", async () => {
  const [wellKnown, rootCopy] = await Promise.all([
    read("../public/.well-known/security.txt"), read("../public/security.txt"),
  ]);
  assert.equal(rootCopy, wellKnown);
  assert.match(wellKnown, /^Contact: mailto:reflexityram@gmail\.com$/m);
  assert.match(wellKnown, /^Canonical: https:\/\/reflexityram\.com\/\.well-known\/security\.txt$/m);
  assert.match(wellKnown, /^Expires: 2027-08-26T00:00:00Z$/m);
});

test("dynamic JSON-LD cannot break out of its data script", () => {
  const serialized = serializeJsonLd({ name: "</script><img src=x>" });
  assert.doesNotMatch(serialized, /</);
  assert.deepEqual(JSON.parse(serialized), { name: "</script><img src=x>" });
});

test("quote links prefill the site form instead of generating a Gmail consumer-order draft", async () => {
  const url = new URL(buildLeadPrefill({ intent: "buy", productType: "RAM", partNumber: "M393A4K40DB3-CWE", specification: "32GB DDR4 ECC RDIMM", quantity: 11 }), "https://reflexityram.com");
  assert.equal(url.pathname, "/contact");
  assert.equal(url.searchParams.get("intent"), "buy");
  assert.equal(url.searchParams.get("partNumber"), "M393A4K40DB3-CWE");
  assert.equal(url.searchParams.get("quantity"), "11");
  const [contact, lead] = await Promise.all([read("../src/pages/Contact.jsx"), read("../src/components/LeadForm.jsx")]);
  assert.match(contact, /do not create an accepted purchase agreement/);
  assert.match(lead, /leadsApi\.create/);
  assert.doesNotMatch(lead, /mail\.google\.com|buildWholesaleEmailUrl/);
});
