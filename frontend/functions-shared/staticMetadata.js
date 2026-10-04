import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const ORIGIN = "https://reflexityram.com";
const BACKEND_ORIGIN = "https://reflexity-ram.onrender.com";
// Social previews need an absolute raster image; Facebook, LinkedIn and WhatsApp do not render SVG.
const OG_IMAGE = `${ORIGIN}/og-image.jpg`;
const MAX_HTML_BYTES = 128 * 1024;
const LIST_FETCH_BUDGET_MS = 2000;
const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;
const EMPTY_ROOT = /<div\s+id=(['"])root\1\s*><\/div>/i;

const PAGES = {
  "/": {
    title: "Tested Server RAM in Canada — Reflexity RAM",
    description: "Shop individually tested Server RAM across DDR generations and form factors, shipped from Toronto.",
    heading: "Tested Server RAM, shipped from Toronto",
    links: [["Shop tested RAM", "/shop"], ["Find the right memory", "/guides/how-to-identify-ram"]],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Reflexity RAM",
        url: ORIGIN,
        logo: `${ORIGIN}/favicon.svg`,
        address: { "@type": "PostalAddress", addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" },
      },
      { "@context": "https://schema.org", "@type": "WebSite", name: "Reflexity RAM", url: ORIGIN },
    ],
  },
  "/shop": {
    title: "Shop Tested Server RAM in Canada — Reflexity RAM",
    description: "Browse tested Server RAM with clear compatibility details and warranty coverage.",
    heading: "Shop tested Server RAM",
    links: [["Browse RAM categories", "/categories"], ["RAM compatibility guides", "/guides"]],
    productList: true,
  },
  "/categories": {
    title: "Server RAM Categories — Reflexity RAM",
    description: "Browse tested Server RAM by DDR generation, form factor, and capacity.",
    heading: "Browse Server RAM",
    links: [["Shop all tested RAM", "/shop"], ["How to identify RAM", "/guides/how-to-identify-ram"]],
  },
  "/guides": {
    title: "RAM Compatibility & Buying Guides — Reflexity RAM",
    description: "Practical guides to DDR4, DDR5, ECC, RDIMM, LRDIMM, laptop, desktop, server memory, and capacity.",
    heading: "RAM compatibility and buying guides",
    links: [["How to identify RAM", "/guides/how-to-identify-ram"], ["DDR4 vs DDR5", "/guides/ddr4-vs-ddr5"], ["ECC and RDIMM explained", "/guides/ecc-rdimm-udimm-explained"]],
  },
  "/guides/ddr4-vs-ddr5": {
    title: "DDR4 or DDR5? Compatibility, Speed & Upgrade Guide — Reflexity RAM",
    description: "Compare DDR4 and DDR5 compatibility, speed, price, and upgrade value before buying desktop or laptop memory.",
    heading: "DDR4 or DDR5: which memory should you buy?",
    body: "DDR4 and DDR5 are not interchangeable. Your motherboard and processor determine which generation fits; capacity usually matters more than a small speed increase.",
    links: [["Browse RAM categories", "/categories"], ["Shop tested RAM", "/shop"]],
  },
  "/guides/ecc-rdimm-udimm-explained": {
    title: "RDIMM vs UDIMM: ECC, LRDIMM & Server RAM Explained — Reflexity RAM",
    description: "Understand ECC, RDIMM, LRDIMM, and UDIMM differences before choosing compatible server or workstation memory.",
    heading: "RDIMM vs UDIMM, ECC, and LRDIMM explained",
    body: "Registered, load-reduced, and unbuffered DIMMs serve different platforms and are usually not interchangeable. Check the server or motherboard memory rules before ordering.",
    links: [["Shop tested server RAM", "/shop"], ["Ask about compatibility", "/support"]],
  },
  "/guides/how-to-identify-ram": {
    title: "How to Identify RAM: Labels & Part Numbers — Reflexity RAM",
    description: "Read a RAM label and part number to identify capacity, DDR generation, speed, form factor, ECC type, and rank.",
    heading: "How to identify RAM from its label and part number",
    body: "Use the complete manufacturer part number, then verify capacity, DDR generation, speed, form factor, ECC type, and rank against the computer or server manual.",
    links: [["Search the RAM catalog", "/shop"], ["Ask us to identify a module", "/support"]],
  },
  "/guides/how-much-ram-do-i-need": {
    title: "How Much RAM Do I Need? Capacity Guide — Reflexity RAM",
    description: "Choose RAM capacity for office work, gaming, content creation, virtual machines, workstations, and servers.",
    heading: "How much RAM do you need?",
    body: "Sixteen gigabytes is a practical everyday baseline, 32GB adds headroom, and professional or server workloads may need 64GB or more.",
    links: [["Browse RAM categories", "/categories"], ["Shop tested RAM", "/shop"]],
  },
  "/wholesale": {
    title: "Wholesale Tested RAM Lots in Canada — Reflexity RAM",
    description: "Browse posted wholesale lots of tested server and computer memory, with quantities and inquiry details.",
    heading: "Wholesale tested RAM lots",
    links: [["View retail RAM", "/shop"], ["Contact Reflexity RAM", "/support"]],
  },
  "/liquidators": {
    title: "IT Asset Liquidation in Toronto — Reflexity Liquidators",
    description: "Sell decommissioned servers, RAM, drives, and networking gear in bulk with one quote and GTA pickup or prepaid shipping.",
    heading: "Sell retired servers, RAM, drives, and networking gear",
    links: [["See what we buy", "/liquidators#what-we-take"], ["View wholesale stock", "/wholesale"]],
  },
  "/support": {
    title: "RAM Compatibility & Order Support — Reflexity RAM",
    description: "Get help with RAM compatibility, orders, shipping, returns, and warranty from Reflexity RAM.",
    heading: "Reflexity RAM support",
    links: [["Frequently asked questions", "/faq"], ["Shipping information", "/shipping"], ["Shop tested RAM", "/shop"]],
  },
  "/business-info": {
    title: "Business Information — Reflexity RAM",
    description: "Business identity, contact, and operating information for Reflexity RAM, an independent online memory retailer in Toronto.",
    heading: "Reflexity RAM business information",
    links: [["Contact support", "/support"], ["Shop tested RAM", "/shop"]],
  },
  "/shipping": {
    title: "Shipping Information — Reflexity RAM",
    description: "Shipping rates, destinations, handling, tracking, and delivery information for Reflexity RAM orders.",
    heading: "Shipping information",
    links: [["International orders", "/international"], ["Contact support", "/support"]],
  },
  "/international": {
    title: "International RAM Orders — Reflexity RAM",
    description: "How to request custom shipping for Reflexity RAM orders outside Canada, including the United States.",
    heading: "International RAM orders",
    links: [["Contact support", "/support"], ["Shop tested RAM", "/shop"]],
  },
  "/returns": {
    title: "Returns Policy — Reflexity RAM",
    description: "Return eligibility, time limits, condition requirements, and the return process for Reflexity RAM purchases.",
    heading: "Returns policy",
    links: [["Warranty coverage", "/warranty"], ["Contact support", "/support"]],
  },
  "/warranty": {
    title: "RAM Warranty Coverage — Reflexity RAM",
    description: "Warranty coverage and claim steps for tested memory purchased from Reflexity RAM.",
    heading: "RAM warranty coverage",
    links: [["Returns policy", "/returns"], ["Contact support", "/support"]],
  },
  "/faq": {
    title: "Frequently Asked RAM Questions — Reflexity RAM",
    description: "Answers about RAM compatibility, testing, orders, shipping, returns, warranty, and wholesale purchases.",
    heading: "Frequently asked questions",
    links: [["RAM buying guides", "/guides"], ["Contact support", "/support"]],
  },
  "/privacy": {
    title: "Privacy Policy — Reflexity RAM",
    description: "How Reflexity RAM collects, uses, protects, and retains customer and website information.",
    heading: "Privacy policy",
    links: [["Terms of service", "/terms"], ["Contact support", "/support"]],
  },
  "/terms": {
    title: "Terms of Service — Reflexity RAM",
    description: "Terms governing purchases and use of the Reflexity RAM website and services.",
    heading: "Terms of service",
    links: [["Privacy policy", "/privacy"], ["Contact support", "/support"]],
  },
};

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function insertBeforeHeadClose(html, tag) {
  return html.replace(/([ \t]*)<\/head>/i, (_match, indent) => `${indent}${tag}\n${indent}</head>`);
}

function upsertTitle(html, title) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => tag) : insertBeforeHeadClose(html, tag);
}

function upsertMeta(html, attribute, key, content) {
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=(['"])${key}\\1[^>]*>`, "i");
  return pattern.test(html) ? html.replace(pattern, () => tag) : insertBeforeHeadClose(html, tag);
}

function upsertCanonical(html, canonicalUrl) {
  const tag = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;
  const pattern = /<link\b(?=[^>]*\brel=(['"])canonical\1)[^>]*>/i;
  return pattern.test(html) ? html.replace(pattern, () => tag) : insertBeforeHeadClose(html, tag);
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const AVAILABILITY_TEXT = { in: "In stock", low: "Low stock", out: "Out of stock" };
const AVAILABILITY_SCHEMA = {
  in: "https://schema.org/InStock",
  low: "https://schema.org/LimitedAvailability",
  out: "https://schema.org/OutOfStock",
};

// Only products with a valid slug and a name are listed; anything else is dropped rather than trusted.
function listableProducts(products) {
  if (!Array.isArray(products)) return [];
  return products
    .filter((product) => product && VALID_SLUG.test(product.slug || "") && typeof product.name === "string" && product.name.trim())
    .slice(0, 100);
}

function productListHtml(products) {
  const items = products.map((product) => {
    const details = [product.generation, product.formFactor, product.capacityLabel, product.speedLabel]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" · ");
    const price = Number.isFinite(Number(product.price)) ? `CA$${Number(product.price).toFixed(2)}` : "";
    const availability = AVAILABILITY_TEXT[product.stock] || "";
    const meta = [details, price, availability].filter(Boolean).join(" — ");
    return `<li><a href="/shop/${encodeURIComponent(product.slug)}">${escapeHtml(product.name.trim())}</a>${meta ? ` — ${escapeHtml(meta)}` : ""}</li>`;
  });
  return `<ul data-edge-products>${items.join("")}</ul>`;
}

function itemListJsonLd(products) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Tested Server RAM",
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${ORIGIN}/shop/${encodeURIComponent(product.slug)}`,
      name: product.name.trim(),
    })),
  };
}

export function injectStaticPage(html, page, pathname, { products = null } = {}) {
  const canonicalUrl = `${ORIGIN}${pathname === "/" ? "" : pathname}`;
  const listed = page.productList ? listableProducts(products) : [];
  let output = upsertTitle(html, page.title);
  output = upsertMeta(output, "name", "description", page.description);
  output = upsertMeta(output, "property", "og:title", page.title);
  output = upsertMeta(output, "property", "og:description", page.description);
  output = upsertMeta(output, "property", "og:url", canonicalUrl);
  output = upsertMeta(output, "property", "og:image", OG_IMAGE);
  output = upsertMeta(output, "name", "twitter:title", page.title);
  output = upsertMeta(output, "name", "twitter:description", page.description);
  output = upsertMeta(output, "name", "twitter:image", OG_IMAGE);
  output = upsertCanonical(output, canonicalUrl);
  const structuredData = [...(page.jsonLd || []), ...(listed.length ? [itemListJsonLd(listed)] : [])];
  for (const schema of structuredData) {
    output = insertBeforeHeadClose(output, `<script type="application/ld+json" data-edge-schema>${safeJson(schema)}</script>`);
  }
  const links = page.links.map(([label, href]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("");
  const body = `<div id="root"><main data-edge-content="static"><nav><a href="/">Reflexity RAM</a> · <a href="/shop">Shop</a> · <a href="/guides">Guides</a></nav><article><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.body || page.description)}</p>${listed.length ? productListHtml(listed) : ""}<ul>${links}</ul></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, () => body);
}

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve({ kind: "timeout" });
    }, timeoutMs);
    promise.then(
      (value) => { if (!settled) { clearTimeout(timer); settled = true; resolve({ kind: "products", products: value }); } },
      (error) => { if (!settled) { clearTimeout(timer); settled = true; resolve({ kind: "error", error }); } },
    );
  });
}

async function loadShopProducts(fetchImpl) {
  const url = new URL("/api/products", BACKEND_ORIGIN);
  url.searchParams.set("limit", "100");
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!response.ok) throw new Error(`products API returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.products)) throw new Error("products API response did not contain a product list");
  return payload.products;
}

function responseWithHeaders(response, body, source, status = response.status) {
  const headers = applyStorefrontSecurityHeaders(new Headers(response.headers));
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Reflexity-SEO", source);
  return new Response(body, { status, statusText: status === response.status ? response.statusText : "Not Found", headers });
}

const CLIENT_ROUTE_PATTERNS = [
  /^\/shop\/[^/]+$/, /^\/wholesale\/[^/]+$/,
  /^\/(?:cart|checkout|order\/success|account|reset-password|verify-email|auth\/callback|review)$/, /^\/order\/[^/]+$/,
  /^\/(?:shipping|returns|warranty|privacy|terms|support|faq|international|business-info)$/,
  /^\/admin(?:\/(?:products|wholesale|orders|users|security))?$/,
];

function isKnownClientRoute(pathname) {
  return Boolean(PAGES[pathname]) || CLIENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function canRewriteShell(html) {
  return new TextEncoder().encode(html).byteLength <= MAX_HTML_BYTES && EMPTY_ROOT.test(html);
}

function injectNotFoundPage(html) {
  let output = upsertTitle(html, "Page not found | Reflexity");
  output = upsertMeta(output, "name", "robots", "noindex, nofollow");
  output = upsertMeta(output, "name", "description", "The requested Reflexity page was not found.");
  return output.replace(EMPTY_ROOT, '<div id="root"><main data-edge-content="not-found"><h1>Page not found</h1><p>The requested page is unavailable.</p><a href="/">Return to Reflexity</a></main></div>');
}

function standaloneNotFoundPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex, nofollow" /><title>Page not found | Reflexity</title></head><body><main data-edge-content="not-found"><h1>Page not found</h1><p>The requested page is unavailable.</p><a href="/">Return to Reflexity</a></main></body></html>';
}

// `fetchImpl` is injected by the Pages Function ([[path]].js). It is off by default so unit tests
// and other callers never touch the network. A failed or slow product fetch only means the page
// is served with the plain static shell it always had.
export async function renderStaticPage(context, { fetchImpl = null, logger = console, listFetchBudgetMs = LIST_FETCH_BUDGET_MS } = {}) {
  const method = context.request.method.toUpperCase();
  const pathname = new URL(context.request.url).pathname.replace(/\/$/, "") || "/";
  // Started before the shell is awaited so both requests run concurrently.
  const listRequest = method === "GET" && fetchImpl && PAGES[pathname]?.productList ? loadShopProducts(fetchImpl) : null;
  const listResult = listRequest ? settleWithin(listRequest, listFetchBudgetMs) : null;
  const shell = await context.next();
  const knownClientRoute = isKnownClientRoute(pathname);
  if (method === "HEAD" && !knownClientRoute && shell.ok) return responseWithHeaders(shell, null, "static-not-found", 404);
  if (method !== "GET") return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through");
  if (!knownClientRoute && shell.ok && (shell.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    const html = await shell.text();
    return responseWithHeaders(shell, canRewriteShell(html) ? injectNotFoundPage(html) : standaloneNotFoundPage(), "static-not-found", 404);
  }
  const page = PAGES[pathname];
  if (!page || !shell.ok || !(shell.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    return responseWithHeaders(shell, shell.body, "spa-pass-through");
  }
  const html = await shell.text();
  if (!canRewriteShell(html)) {
    return responseWithHeaders(shell, html, "spa-pass-through");
  }
  let products = null;
  if (listResult) {
    const settled = await listResult;
    if (settled.kind === "products") {
      products = settled.products;
    } else {
      logger.warn("Shop product list unavailable for static metadata", {
        kind: settled.kind,
        message: settled.error instanceof Error ? settled.error.message : undefined,
      });
      // Let a slow fetch finish so the edge cache is warm for the next request.
      if (settled.kind === "timeout" && typeof context.waitUntil === "function") context.waitUntil(listRequest.catch(() => {}));
    }
  }
  return responseWithHeaders(shell, injectStaticPage(html, page, pathname, { products }), "static-edge");
}
