import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { proxyCatalogXml } from "../functions-shared/proxyCatalogXml.js";
import { renderProductPage } from "../functions-shared/productMetadata.js";
import { STOREFRONT_SECURITY_HEADERS } from "../functions-shared/securityHeaders.js";
import { onRequest as feedHandler } from "../functions/feed.xml.js";
import { onRequest as productHandler } from "../functions/shop/[slug].js";
import { onRequest as sitemapHandler } from "../functions/sitemap.xml.js";

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

test("Pages Functions expose live XML and product metadata routes", () => {
  assert.equal(typeof feedHandler, "function");
  assert.equal(typeof sitemapHandler, "function");
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

test("Pages route manifest invokes Functions only for live XML and product pages", async () => {
  const routes = JSON.parse(
    await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(routes, {
    version: 1,
    include: ["/feed.xml", "/sitemap.xml", "/shop/*"],
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
  for (const script of ["theme", "analytics", "error"]) {
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
  assert.match(html, /<title>Tested &quot;64GB&quot;<\/title>/);
  assert.doesNotMatch(html, /&lt;RAM&gt;|<RAM>/);
  assert.match(html, /content="Fast &amp; individually tested server memory\."/);
  assert.match(html, /property="og:type" content="product"/);
  assert.match(html, new RegExp(`property="og:url" content="https://reflexityram\\.com/shop/${slug}"`));
  assert.match(html, new RegExp(`rel="canonical" href="https://reflexityram\\.com/shop/${slug}"`));
  assert.match(html, /name="twitter:image" content="https:\/\/images\.example\.test\/product\.jpg"/);
  assert.doesNotMatch(html, /<title>Home title<\/title>/);
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
