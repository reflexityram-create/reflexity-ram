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
    exclude: ["/assets/*", "/.well-known/*", "/LICENSE.txt", "/analytics-bootstrap.js", "/error-bootstrap.js", "/favicon.svg", "/font-bootstrap.js", "/og-image.svg", "/robots.txt", "/security.txt", "/theme-bootstrap.js"],
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
  for (const path of ["/cart", "/checkout", "/order/success", "/order/ORD-123", "/account", "/verify-email", "/admin/orders", "/auth/callback", "/guides/how-to-identify-ram"]) {
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
