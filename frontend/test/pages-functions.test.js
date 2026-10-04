import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { proxyCatalogXml } from "../functions-shared/proxyCatalogXml.js";
import { renderProductPage } from "../functions-shared/productMetadata.js";
import { renderStaticPage } from "../functions-shared/staticMetadata.js";
import { STOREFRONT_SECURITY_HEADERS } from "../functions-shared/securityHeaders.js";
import { onRequest as feedHandler } from "../functions/feed.xml.js";
import { onRequest as feedCsvHandler } from "../functions/feed.csv.js";
import { onRequest as staticHandler } from "../functions/[[path]].js";
import { onRequest as legacyProductHandler } from "../functions/inventory/[slug].js";
import { onRequest as productHandler } from "../functions/shop/[slug].js";
import { onRequest as sitemapHandler } from "../functions/sitemap.xml.js";
import { renderWholesaleLotPage } from "../functions-shared/wholesaleLotMetadata.js";

const context = (method = "GET") => ({
  request: new Request("https://reflexityram.com/feed.xml", { method }),
});

const PRODUCT_SHELL = `<!doctype html>
<html><head>
<meta name="description" content="Home description" />
<meta property="og:title" content="Home title" />
<meta property="og:description" content="Home description" />
<meta property="og:type" content="website" />
<meta property="og:image" content="/og-image.svg" />
<meta name="twitter:title" content="Home title" />
<meta name="twitter:description" content="Home description" />
<meta name="twitter:image" content="/og-image.svg" />
<title>Home title</title>
</head><body><div id="root"></div></body></html>`;

const productContext = (slug, { method = "GET", waitUntil } = {}) => ({
  request: new Request(`https://reflexityram.com/shop/${slug}`, { method }),
  params: { slug },
  next: async () =>
    new Response(PRODUCT_SHELL, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ETag: '"shell-v1"',
      },
    }),
  waitUntil,
});

test("Pages Functions expose live XML, redirect, product, and wholesale metadata routes", () => {
  assert.equal(typeof feedHandler, "function");
  assert.equal(typeof feedCsvHandler, "function");
  assert.equal(typeof sitemapHandler, "function");
  assert.equal(typeof staticHandler, "function");
  assert.equal(typeof legacyProductHandler, "function");
  assert.equal(typeof productHandler, "function");
});

test("catalog XML proxy requests the live backend and normalizes safe response headers", async () => {
  const calls = [];
  const response = await proxyCatalogXml(context(), "/feed.xml", {
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return new Response("<rss><channel /></rss>", {
        status: 200,
        headers: { ETag: '"catalog-v1"' },
      });
    },
  });

  assert.deepEqual(calls.map(({ url }) => url), [
    "https://reflexity-ram.onrender.com/feed.xml",
  ]);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<rss><channel /></rss>");
  assert.equal(response.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-reflexity-source"), "live-catalog-api");
  assert.equal(response.headers.get("etag"), '"catalog-v1"');
});

test("catalog XML proxy supports HEAD without returning a body", async () => {
  const response = await proxyCatalogXml(context("HEAD"), "/sitemap.xml", {
    fetchImpl: async (_url, init) => {
      assert.equal(init.method, "HEAD");
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("catalog CSV proxy forwards GET and HEAD with the CSV contract", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url.toString(), init });
    return new Response(init.method === "HEAD" ? null : "id,title\nserver-1,Server RAM\n", { status: 200, headers: { ETag: '"csv-v1"' } });
  };
  const get = await proxyCatalogXml(context(), "/feed.csv", { fetchImpl });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(get.headers.get("x-reflexity-source"), "live-catalog-api");
  assert.equal(await get.text(), "id,title\nserver-1,Server RAM\n");
  const head = await proxyCatalogXml(context("HEAD"), "/feed.csv", { fetchImpl });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.deepEqual(calls.map(({ url, init }) => [url, init.method, init.headers.Accept]), [
    ["https://reflexity-ram.onrender.com/feed.csv", "GET", "text/csv"],
    ["https://reflexity-ram.onrender.com/feed.csv", "HEAD", "text/csv"],
  ]);
  assert.equal((await proxyCatalogXml(context("POST"), "/feed.csv")).status, 405);
  assert.equal((await proxyCatalogXml(context(), "/feed.csv", { fetchImpl: async () => new Response("failure", { status: 503 }), logger: { error() {} } })).status, 502);
});

test("catalog XML proxy rejects writes and fails closed on upstream errors", async () => {
  const writeResponse = await proxyCatalogXml(context("POST"), "/feed.xml");
  assert.equal(writeResponse.status, 405);
  assert.equal(writeResponse.headers.get("allow"), "GET, HEAD");

  const upstreamResponse = await proxyCatalogXml(context(), "/feed.xml", {
    fetchImpl: async () => new Response("failure", { status: 503 }),
    logger: { error() {} },
  });
  assert.equal(upstreamResponse.status, 502);
  assert.equal(upstreamResponse.headers.get("cache-control"), "no-store");
});

test("Pages route manifest invokes Functions for public crawlable routes", async () => {
  const routes = JSON.parse(
    await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(routes, {
    version: 1,
    include: ["/*"],
    exclude: ["/assets/*", "/.well-known/*", "/LICENSE.txt", "/analytics-bootstrap.js", "/error-bootstrap.js", "/favicon.svg", "/feed-images/*", "/font-bootstrap.js", "/og-image.jpg", "/og-image.svg", "/robots.txt", "/security.txt", "/theme-bootstrap.js"],
  });
});

test("static and edge storefront responses enforce the same CSP", async () => {
  const policy = STOREFRONT_SECURITY_HEADERS["Content-Security-Policy"];
  const staticHeaders = await readFile(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );

  assert.ok(policy);
  assert.match(policy, /https:\/\/static\.cloudflareinsights\.com/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.equal(
    STOREFRONT_SECURITY_HEADERS["Strict-Transport-Security"],
    "max-age=63072000; includeSubDomains",
  );
  assert.equal(STOREFRONT_SECURITY_HEADERS["Referrer-Policy"], "no-referrer");
  assert.doesNotMatch(staticHeaders, /Content-Security-Policy-Report-Only/i);
  assert.match(staticHeaders, new RegExp(`Content-Security-Policy: ${policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=63072000; includeSubDomains/);
  assert.match(staticHeaders, /Referrer-Policy: no-referrer/);
  for (const script of ["theme", "analytics", "font", "error"]) {
    assert.match(staticHeaders, new RegExp(`/${script}-bootstrap\\.js[\\s\\S]*?max-age=0, must-revalidate`));
  }
});

test("product edge metadata uses the exact live API contract and escapes values", async () => {
  const calls = [];
  const slug = "rfx-test-product";
  const response = await renderProductPage(productContext(slug), {
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return Response.json({
        product: {
          name: 'Tested "64GB" <RAM>',
          slug,
          line: "Server",
          formFactor: "UDIMM",
          description: "Fast & individually tested server memory.",
          images: [{ url: "https://images.example.test/product.jpg" }],
        },
        related: [],
      });
    },
  });

  const html = await response.text();
  assert.equal(calls[0].url, `https://reflexity-ram.onrender.com/api/products/${slug}`);
  assert.equal(calls[0].init.headers.Accept, "application/json");
  assert.deepEqual(calls[0].init.cf, { cacheEverything: true, cacheTtl: 300 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-reflexity-seo"), "product-edge");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
  assert.equal(
    response.headers.get("content-security-policy"),
    STOREFRONT_SECURITY_HEADERS["Content-Security-Policy"],
  );
  assert.equal(response.headers.get("content-security-policy-report-only"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.match(html, /<title>Tested &quot;64GB&quot;<\/title>/);
  assert.doesNotMatch(html, /&lt;RAM&gt;|<RAM>/);
  assert.match(html, /content="Fast &amp; individually tested server memory\."/);
  assert.match(html, /property="og:type" content="product"/);
  assert.match(html, new RegExp(`property="og:url" content="https://reflexityram\\.com/shop/${slug}"`));
  assert.match(html, new RegExp(`rel="canonical" href="https://reflexityram\\.com/shop/${slug}"`));
  assert.match(html, /name="twitter:image" content="https:\/\/images\.example\.test\/product\.jpg"/);
  assert.match(html, /data-edge-content="product"/);
  assert.match(html, /<h1>Tested &quot;64GB&quot;<\/h1>/);
  assert.match(html, /type="application\/ld\+json" data-edge-product/);
  assert.match(html, /"priceCurrency":"CAD"/);
  assert.doesNotMatch(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /<title>Home title<\/title>/);
});

test("the labeled Google feed images are served as plain static files, bypassing Functions", async () => {
  const { readFileSync } = await import("node:fs");
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.ok(routes.exclude.includes("/feed-images/*"));
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /\/feed-images\/\*\n  Cache-Control: public, max-age=86400/);
});

test("product edge structured data carries the real shipping and return commitments", async () => {
  const jsonLd = async (product) => {
    const response = await renderProductPage(productContext(product.slug), {
      fetchImpl: async () => Response.json({ product }),
    });
    const html = await response.text();
    const match = html.match(/<script type="application\/ld\+json" data-edge-product>([\s\S]*?)<\/script>/);
    assert.ok(match, "product JSON-LD present");
    return JSON.parse(match[1]);
  };

  const standard = await jsonLd({
    name: "SK hynix 16GB DDR4-3200", slug: "sk-hynix-16gb", line: "Server", formFactor: "RDIMM", mpn: "HMA82GR7DJR8N-XN",
    brand: "SK hynix", price: 135, condition: "Refurbished — Tested", stock: "in", description: "Tested server memory module.",
  });
  assert.equal(standard.mpn, "HMA82GR7DJR8N-XN");
  assert.equal(standard.offers.itemCondition, "https://schema.org/RefurbishedCondition");
  assert.equal(standard.offers.seller.name, "Reflexity RAM");
  const shipping = standard.offers.shippingDetails;
  assert.equal(shipping["@type"], "OfferShippingDetails");
  assert.deepEqual(shipping.shippingRate, { "@type": "MonetaryAmount", value: 14, currency: "CAD" });
  assert.deepEqual(shipping.shippingDestination.map((region) => region.addressCountry), ["CA"]);
  assert.deepEqual([shipping.deliveryTime.handlingTime.minValue, shipping.deliveryTime.handlingTime.maxValue], [1, 3]);
  assert.deepEqual([shipping.deliveryTime.transitTime.minValue, shipping.deliveryTime.transitTime.maxValue], [3, 6]);
  const returns = standard.offers.hasMerchantReturnPolicy;
  assert.equal(returns.merchantReturnDays, 30);
  assert.equal(returns.returnPolicyCategory, "https://schema.org/MerchantReturnFiniteReturnWindow");
  assert.equal(returns.merchantReturnLink, "https://reflexityram.com/returns");

  const overridden = await jsonLd({ name: "Heavy lot", slug: "heavy-lot", line: "Server", price: 900, shippingPrice: 25, condition: "Used", description: "Lot of tested modules." });
  assert.equal(overridden.offers.shippingDetails.shippingRate.value, 25);
  assert.equal(overridden.offers.itemCondition, "https://schema.org/UsedCondition");
  assert.equal(overridden.mpn, undefined);
});

test("product edge hides non-Server inventory but retains Server UDIMM metadata", async () => {
  const hidden = await renderProductPage(productContext("desktop-module"), {
    fetchImpl: async () => Response.json({
      product: { name: "Desktop module", slug: "desktop-module", line: "Desktop" },
    }),
  });
  const hiddenHtml = await hidden.text();
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("x-reflexity-seo"), "product-not-found");
  assert.match(hiddenHtml, /noindex, nofollow/);
  assert.doesNotMatch(hiddenHtml, /data-edge-product/);

  const visible = await renderProductPage(productContext("server-udimm"), {
    fetchImpl: async () => Response.json({
      product: { name: "Server UDIMM", slug: "server-udimm", line: "Server", formFactor: "UDIMM", description: "Tested server module." },
    }),
  });
  assert.equal(visible.status, 200);
  assert.equal(visible.headers.get("x-reflexity-seo"), "product-edge");
  assert.match(await visible.text(), /data-edge-product/);
});

test("static edge pages provide unique metadata and meaningful initial HTML", async () => {
  const pageContext = (path, method = "GET") => ({
    request: new Request(`https://reflexityram.com${path}`, { method }),
    next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"shell-v1"' } }),
  });
  const response = await renderStaticPage(pageContext("/guides/how-to-identify-ram"));
  const html = await response.text();
  assert.equal(response.headers.get("x-reflexity-seo"), "static-edge");
  assert.equal(response.headers.get("etag"), null);
  assert.match(html, /<title>How to Identify RAM: Labels &amp; Part Numbers — Reflexity RAM<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/reflexityram\.com\/guides\/how-to-identify-ram"/);
  assert.match(html, /data-edge-content="static"/);
  assert.match(html, /<h1>How to identify RAM from its label and part number<\/h1>/);
  assert.match(html, /href="\/shop"/);
  assert.doesNotMatch(html, /<div id="root"><\/div>/);

  const head = await renderStaticPage(pageContext("/shop", "HEAD"));
  assert.equal(await head.text(), "");
});

test("static edge rejects unknown routes while retaining restored client routes", async () => {
  const pageContext = (path, method = "GET") => ({
    request: new Request(`https://reflexityram.com${path}`, { method }),
    next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  for (const path of ["/__missing_20260911", "/unknown/deep/path"]) {
    const response = await renderStaticPage(pageContext(path));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("x-reflexity-seo"), "static-not-found", path);
    assert.match(await response.text(), /name="robots" content="noindex, nofollow"/, path);
  }
  for (const path of ["/cart", "/checkout", "/order/success", "/order/ORD-123", "/review", "/account", "/verify-email", "/admin/orders", "/auth/callback", "/guides/how-to-identify-ram"]) {
    const response = await renderStaticPage(pageContext(path));
    assert.equal(response.status, 200, path);
    assert.notEqual(response.headers.get("x-reflexity-seo"), "static-not-found", path);
  }
  for (const method of ["GET", "HEAD"]) {
    const response = await renderStaticPage(pageContext("/guides/no-such-guide", method));
    assert.equal(response.status, 404, method);
    assert.equal(response.headers.get("x-reflexity-seo"), "static-not-found", method);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.match(await response.text(), /name="robots" content="noindex, nofollow"/);
  }
  const head = await renderStaticPage(pageContext("/__missing_20260911", "HEAD"));
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
});

test("static unknown routes use a standalone 404 for malformed or oversized shells", async () => {
  for (const shell of [`${PRODUCT_SHELL}${"x".repeat(128 * 1024)}`, "<html><head><title>old</title></head><body>old</body></html>"]) {
    const response = await renderStaticPage({ request: new Request("https://reflexityram.com/no-such-page"), next: async () => new Response(shell, { headers: { "Content-Type": "text/html" } }) });
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /data-edge-content="not-found"/);
    assert.match(html, /noindex, nofollow/);
    assert.doesNotMatch(html, /old<\/title>|old<\/body>/);
  }
});

test("legacy wholesale-era URLs redirect into restored routes without losing queries", async () => {
  for (const [from, to] of [["/inventory", "/shop"], ["/sell-to-us", "/liquidators"], ["/contact", "/support"], ["/about", "/business-info"]]) {
    const response = await staticHandler({ request: new Request(`https://reflexityram.com${from}?legacy=1`), next: async () => new Response(PRODUCT_SHELL) });
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), `https://reflexityram.com${to}?legacy=1`);
  }
  const product = legacyProductHandler({ request: new Request("https://reflexityram.com/inventory/rfx-ddr4?legacy=1"), params: { slug: "rfx-ddr4" } });
  assert.equal(product.headers.get("location"), "https://reflexityram.com/shop/rfx-ddr4?legacy=1");
});

test("wholesale lot edge fails closed for invalid or absent lots and supports HEAD", async () => {
  const lotId = "64b64c66a2d15e51234abcde";
  const context = (id, method = "GET") => ({ request: new Request(`https://reflexityram.com/wholesale/${id}`, { method }), params: { lotId: id }, next: async () => new Response(PRODUCT_SHELL, { headers: { "Content-Type": "text/html" } }) });
  for (const [id, method] of [["not-a-lot", "GET"], ["not-a-lot", "HEAD"], [lotId, "GET"], [lotId, "HEAD"]]) {
    const response = await renderWholesaleLotPage(context(id, method), { fetchImpl: async () => new Response("missing", { status: 404 }) });
    assert.equal(response.status, 404);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.match(await response.text(), /noindex, nofollow/);
  }
  const head = await renderWholesaleLotPage(context(lotId, "HEAD"), { fetchImpl: async () => Response.json({ lot: { id: lotId, title: "Server RAM lot" } }) });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("storefront edge metadata presents Server RAM only while guides remain separate", async () => {
  const pageContext = (path) => ({
    request: new Request(`https://reflexityram.com${path}`),
    next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  for (const path of ["/", "/shop", "/categories"]) {
    const html = await (await renderStaticPage(pageContext(path))).text();
    assert.match(html, /Server RAM/);
    assert.doesNotMatch(html, /desktop|laptop/i);
  }
});

test("product edge returns a crawl-safe 404 only when the API confirms it", async () => {
  const response = await renderProductPage(productContext("missing-product"), {
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });

  const html = await response.text();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-reflexity-seo"), "product-not-found");
  assert.match(html, /<title>Product not found \| Reflexity RAM<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test("product edge resolves Server and invalid identifiers for GET and HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const invalid = await renderProductPage(productContext("INVALID", { method }));
    assert.equal(invalid.status, 404);
    assert.equal(invalid.headers.get("x-reflexity-seo"), "product-not-found");
    if (method === "HEAD") assert.equal(await invalid.text(), "");
  }
  const head = await renderProductPage(productContext("server-udimm", { method: "HEAD" }), { fetchImpl: async () => Response.json({ product: { name: "Server UDIMM", slug: "server-udimm", line: "Server", formFactor: "UDIMM" } }) });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("product edge preserves the storefront shell on upstream errors", async () => {
  const response = await renderProductPage(productContext("rfx-live-product"), {
    fetchImpl: async () => new Response("failure", { status: 503 }),
    logger: { warn() {} },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-reflexity-seo"), "spa-error-fallback");
  assert.equal(response.headers.get("etag"), '"shell-v1"');
  assert.equal(await response.text(), PRODUCT_SHELL);
});

test("product edge returns quickly and defers a slow metadata fetch", async () => {
  const deferred = [];
  const response = await renderProductPage(
    productContext("rfx-slow-product", {
      waitUntil(promise) {
        deferred.push(promise);
      },
    }),
    {
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return Response.json({ product: { name: "Slow product", description: "Slow" } });
      },
      productFetchBudgetMs: 1,
      logger: { warn() {} },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-reflexity-seo"), "spa-timeout-fallback");
  assert.equal(deferred.length, 1);
  await Promise.all(deferred);
});

// ── Shop product list, structured data, social image, and pages.dev noindex ──────────────────────

const edgeContext = (path, { method = "GET", waitUntil } = {}) => ({
  request: new Request(`https://reflexityram.com${path}`, { method }),
  next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  waitUntil,
});
const productsFetch = (products, calls = []) => async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ products }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const quietLogger = { warn: () => {}, error: () => {}, log: () => {} };

test("/shop static HTML lists the live products and carries ItemList structured data", async () => {
  const calls = [];
  const response = await renderStaticPage(edgeContext("/shop"), {
    fetchImpl: productsFetch([
      { slug: "samsung-64gb", name: "Samsung 64GB DDR4 <ECC> LRDIMM", price: 585, stock: "in", generation: "DDR4", formFactor: "LRDIMM", capacityLabel: "64GB" },
      { slug: "sk-hynix-16gb", name: "SK hynix 16GB", price: 135, stock: "out" },
      { slug: "Bad Slug!", name: "Dropped: invalid slug", price: 1, stock: "in" },
      { slug: "no-name", name: "   ", price: 1, stock: "in" },
    ], calls),
    logger: quietLogger,
  });
  const html = await response.text();
  assert.equal(response.headers.get("x-reflexity-seo"), "static-edge");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/api/products");

  assert.match(html, /<ul data-edge-products>/);
  assert.match(html, /<a href="\/shop\/samsung-64gb">Samsung 64GB DDR4 &lt;ECC&gt; LRDIMM<\/a> — DDR4 · LRDIMM · 64GB — CA\$585\.00 — In stock/);
  assert.match(html, /<a href="\/shop\/sk-hynix-16gb">SK hynix 16GB<\/a> — CA\$135\.00 — Out of stock/);
  assert.doesNotMatch(html, /CA"35\.00/, "a $1 in injected text must never be read as a replace() capture reference");
  assert.doesNotMatch(html, /Dropped: invalid slug|no-name/);

  const schema = JSON.parse(/<script type="application\/ld\+json" data-edge-schema>(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(schema["@type"], "ItemList");
  assert.equal(schema.numberOfItems, 2);
  assert.deepEqual(schema.itemListElement.map((item) => [item.position, item.url]), [
    [1, "https://reflexityram.com/shop/samsung-64gb"],
    [2, "https://reflexityram.com/shop/sk-hynix-16gb"],
  ]);
  assert.doesNotMatch(html, /<script[^>]*ld\+json[^>]*>[^<]*<ECC>/, "JSON-LD must never emit a raw <");
});

test("/shop falls back to the plain static shell when the product API fails or is slow", async () => {
  const failing = await renderStaticPage(edgeContext("/shop"), {
    fetchImpl: async () => new Response("down", { status: 503 }),
    logger: quietLogger,
  });
  const failingHtml = await failing.text();
  assert.equal(failing.status, 200);
  assert.equal(failing.headers.get("x-reflexity-seo"), "static-edge");
  assert.doesNotMatch(failingHtml, /data-edge-products|ld\+json/);
  assert.match(failingHtml, /<h1>Shop tested Server RAM<\/h1>/);

  let deferred = 0;
  const started = Date.now();
  const slow = await renderStaticPage(edgeContext("/shop", { waitUntil: () => { deferred += 1; } }), {
    fetchImpl: () => new Promise(() => {}),
    listFetchBudgetMs: 25,
    logger: quietLogger,
  });
  assert.ok(Date.now() - started < 1500, "a hung product API must not hold the page up");
  assert.doesNotMatch(await slow.text(), /data-edge-products/);
  assert.equal(deferred, 1, "the slow fetch is handed to waitUntil so the edge cache warms");
});

test("only GET /shop fetches products, and other pages never do", async () => {
  const calls = [];
  const fetchImpl = productsFetch([{ slug: "a", name: "A", price: 1, stock: "in" }], calls);
  await renderStaticPage(edgeContext("/shop", { method: "HEAD" }), { fetchImpl, logger: quietLogger });
  await renderStaticPage(edgeContext("/guides"), { fetchImpl, logger: quietLogger });
  await renderStaticPage(edgeContext("/"), { fetchImpl, logger: quietLogger });
  assert.equal(calls.length, 0);
  await renderStaticPage(edgeContext("/shop"), { logger: quietLogger });
  assert.equal(calls.length, 0, "no fetchImpl means no network");
});

test("home page declares Organization and WebSite structured data; every static page has an absolute social image", async () => {
  const home = await (await renderStaticPage(edgeContext("/"), { logger: quietLogger })).text();
  const types = [...home.matchAll(/<script type="application\/ld\+json" data-edge-schema>(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1])["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite"]);

  for (const path of ["/", "/shop", "/guides/ddr4-vs-ddr5", "/support", "/liquidators", "/business-info"]) {
    const html = await (await renderStaticPage(edgeContext(path), { logger: quietLogger })).text();
    assert.match(html, /<meta property="og:image" content="https:\/\/reflexityram\.com\/og-image\.jpg" \/>/, path);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/reflexityram\.com\/og-image\.jpg" \/>/, path);
  }
});

test("the shipped social image is a real 1200x630 JPEG and the shell references it absolutely", async () => {
  const image = await readFile(new URL("../public/og-image.jpg", import.meta.url));
  assert.deepEqual([...image.subarray(0, 3)], [0xff, 0xd8, 0xff], "og-image.jpg must be a JPEG");
  assert.ok(image.length < 300 * 1024, "keep it under WhatsApp's thumbnail ceiling");
  // Baseline JPEG: the SOF0 segment stores height then width.
  const sof = image.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  assert.deepEqual([image.readUInt16BE(sof + 5), image.readUInt16BE(sof + 7)], [630, 1200]);

  const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(shell, /og:image" content="https:\/\/reflexityram\.com\/og-image\.jpg"/);
  assert.match(shell, /twitter:image" content="https:\/\/reflexityram\.com\/og-image\.jpg"/);
});

test("pages.dev aliases are marked noindex without touching the custom domain rules", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /^https:\/\/:project\.pages\.dev\/\*\n {2}X-Robots-Tag: noindex$/m);
  // The catch-all block must not carry the directive, or reflexityram.com itself would be deindexed.
  const catchAll = headers.split(/\n(?=\S)/).find((block) => block.startsWith("/*"));
  assert.doesNotMatch(catchAll, /X-Robots-Tag/);
});

test("product edge text containing $ sequences is injected verbatim (String.replace pitfalls)", async () => {
  // "$1", "$&" and "$$" are special in a String.replace replacement string; product titles and
  // descriptions mention prices, so they must be inserted literally.
  const slug = "rfx-dollar-product";
  const response = await renderProductPage(productContext(slug), {
    fetchImpl: async () => Response.json({
      product: {
        name: "Kit costs $1 less than $2",
        slug,
        line: "Server",
        formFactor: "UDIMM",
        description: "Only $135 each — save $1 on a pair, $& more, $$ total",
        price: 135,
        images: [],
      },
    }),
  });
  const html = await response.text();
  assert.match(html, /<title>Kit costs \$1 less than \$2<\/title>/);
  assert.match(html, /content="Only \$135 each — save \$1 on a pair, \$&amp; more, \$\$ total"/);
  assert.match(html, /<h1>Kit costs \$1 less than \$2<\/h1>/);
});
