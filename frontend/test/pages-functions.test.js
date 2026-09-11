import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { proxyCatalogXml } from "../functions-shared/proxyCatalogXml.js";
import { renderProductPage } from "../functions-shared/productMetadata.js";
import { renderWholesaleLotPage } from "../functions-shared/wholesaleLotMetadata.js";
import { renderStaticPage } from "../functions-shared/staticMetadata.js";
import { STOREFRONT_SECURITY_HEADERS } from "../functions-shared/securityHeaders.js";
import { onRequest as feedHandler } from "../functions/feed.xml.js";
import { onRequest as csvFeedHandler } from "../functions/feed.csv.js";
import { onRequest as legacyProductHandler } from "../functions/shop/[slug].js";
import { onRequest as productHandler } from "../functions/inventory/[slug].js";
import { onRequest as wholesaleLotHandler } from "../functions/wholesale/[lotId].js";
import { onRequest as sitemapHandler } from "../functions/sitemap.xml.js";
import { onRequest as staticHandler } from "../functions/[[path]].js";

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
  request: new Request(`https://reflexityram.com/inventory/${slug}`, { method }),
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

test("Pages Functions expose inventory metadata, XML, and legacy redirect routes", () => {
  assert.equal(typeof feedHandler, "function");
  assert.equal(typeof csvFeedHandler, "function");
  assert.equal(typeof sitemapHandler, "function");
  assert.equal(typeof productHandler, "function");
  assert.equal(typeof wholesaleLotHandler, "function");
  assert.equal(typeof legacyProductHandler, "function");
  assert.equal(typeof staticHandler, "function");
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

test("catalog XML proxy preserves an intentionally retired retail feed", async () => {
  const response = await proxyCatalogXml(context(), "/feed.xml", {
    fetchImpl: async () => new Response("Retail product feeds are no longer available.", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
  });

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-reflexity-source"), "retired-retail-feed");
  assert.match(await response.text(), /no longer available/i);
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
    include: ["/", "/inventory", "/inventory/*", "/guides", "/guides/*", "/wholesale", "/wholesale/*", "/sell-to-us", "/contact", "/about", "/shipping", "/international", "/returns", "/warranty", "/faq", "/privacy", "/terms", "/feed.xml", "/feed.csv", "/sitemap.xml", "/shop", "/shop/*", "/categories", "/liquidators", "/support", "/business-info"],
    exclude: [],
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
  assert.match(html, /<title>Tested &quot;64GB&quot; — Bulk Memory Inventory \| Reflexity<\/title>/);
  assert.doesNotMatch(html, /&lt;RAM&gt;|<RAM>/);
  assert.match(html, /content="Wholesale availability for Tested &quot;64GB&quot;\. Request a quote for bulk supply and exact part-number confirmation\."/);
  assert.match(html, /property="og:type" content="product"/);
  assert.match(html, new RegExp(`property="og:url" content="https://reflexityram\\.com/inventory/${slug}"`));
  assert.match(html, new RegExp(`rel="canonical" href="https://reflexityram\\.com/inventory/${slug}"`));
  assert.match(html, /name="twitter:image" content="https:\/\/images\.example\.test\/product\.jpg"/);
  assert.match(html, /data-edge-content="product"/);
  assert.match(html, /<h1>Tested &quot;64GB&quot;<\/h1>/);
  assert.match(html, /type="application\/ld\+json" data-edge-product/);
  assert.match(html, /"@type":"Product"/);
  assert.doesNotMatch(html, /"offers"|"price"|"availability"/);
  assert.doesNotMatch(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /<title>Home title<\/title>/);
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
  assert.match(html, /<title>Identify RAM by Part Number — Reflexity<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/reflexityram\.com\/guides\/how-to-identify-ram"/);
  assert.match(html, /data-edge-content="static"/);
  assert.match(html, /<h1>Identify RAM from its label and part number<\/h1>/);
  assert.match(html, /href="\/inventory"/);
  assert.doesNotMatch(html, /<div id="root"><\/div>/);

  const head = await renderStaticPage(pageContext("/shop", "HEAD"));
  assert.equal(await head.text(), "");
});

test("legacy shop and support paths redirect to their B2B replacements", async () => {
  const productRedirect = legacyProductHandler({
    request: new Request("https://reflexityram.com/shop/rfx-ddr4?source=legacy"),
    params: { slug: "rfx-ddr4" },
  });
  assert.equal(productRedirect.status, 308);
  assert.equal(productRedirect.headers.get("location"), "https://reflexityram.com/inventory/rfx-ddr4?source=legacy");

  for (const [from, to] of [["/shop", "/inventory"], ["/categories", "/inventory"], ["/liquidators", "/sell-to-us"], ["/support", "/contact"], ["/business-info", "/about"]]) {
    const response = await staticHandler({
      request: new Request(`https://reflexityram.com${from}?legacy=1`),
      next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html" } }),
    });
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), `https://reflexityram.com${to}?legacy=1`);
  }
});

test("wholesale lot edge metadata is quote-only and fails closed for missing lots", async () => {
  const lotId = "64b64c66a2d15e51234abcde";
  const lotContext = (id) => ({
    request: new Request(`https://reflexityram.com/wholesale/${id}`), params: { lotId: id },
    next: async () => new Response(PRODUCT_SHELL, { status: 200, headers: { "Content-Type": "text/html" } }),
  });
  const response = await renderWholesaleLotPage(lotContext(lotId), {
    fetchImpl: async () => Response.json({ lot: {
      id: lotId, title: "Samsung 32GB RDIMM", lotCode: "WS-DETAIL", brand: "Samsung", mpn: "M393A4K40DB3", imageUrl: "https://images.example.test/lot.jpg",
    } }),
  });
  const html = await response.text();
  assert.equal(response.headers.get("x-reflexity-seo"), "wholesale-lot-edge");
  assert.match(html, new RegExp(`rel="canonical" href="https://reflexityram\\.com/wholesale/${lotId}"`));
  assert.match(html, /name="twitter:title" content="Samsung 32GB RDIMM"/);
  assert.match(html, /name="twitter:description" content="Wholesale availability for Samsung 32GB RDIMM/);
  assert.match(html, /name="twitter:image" content="https:\/\/images\.example\.test\/lot\.jpg"/);
  assert.match(html, /data-edge-wholesale-lot/);
  assert.doesNotMatch(html, /"offers"|"price"|"availability"/);

  const missing = await renderWholesaleLotPage(lotContext(lotId), { fetchImpl: async () => new Response("missing", { status: 404 }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-reflexity-seo"), "wholesale-lot-not-found");
  assert.match(await missing.text(), /noindex, nofollow/);

  const transient = await renderWholesaleLotPage(lotContext(lotId), { fetchImpl: async () => new Response("temporary", { status: 503 }) });
  assert.equal(transient.status, 200);
  assert.equal(transient.headers.get("x-reflexity-seo"), "spa-error-fallback");
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
