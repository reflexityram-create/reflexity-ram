import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const BACKEND_ORIGIN = "https://reflexity-ram.onrender.com";
const STOREFRONT_ORIGIN = "https://reflexityram.com";
const PRODUCT_FETCH_BUDGET_MS = 2500;
const MAX_HTML_BYTES = 128 * 1024;
const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

// Storefront commitments mirrored in the structured data below. Keep in sync with the saved
// Shipping and Returns policies (src/pages/policies), backend/src/config/shipping.js and the
// Google Merchant Center shipping and return settings.
const STANDARD_SHIPPING_PRICE = 14;
const SHIPPING_COUNTRIES = ["CA"];
// The saved Returns policy has no country limit. These are the countries Google lists the shop in, the same ones the
// Merchant Center return policies cover (created 2026-10-05); keep them in sync with the feed's data source.
const RETURN_POLICY_COUNTRIES = [
  "CA", "AE", "AR", "AU", "BR", "CH", "CL", "CO", "CR", "CY", "DZ", "EC", "EE", "ES", "ET", "GB", "GR", "HK", "HR", "HU",
  "ID", "IE", "IL", "IN", "IT", "JP", "KE", "LB", "LI", "LK", "LT", "LV", "MA", "MT", "MU", "MX", "MY", "NL", "NO", "NZ",
  "PH", "PL", "RO", "SA", "SE", "SG", "SK", "SV", "TH", "TR", "TW", "UA", "VN",
];
const HANDLING_DAYS = { min: 1, max: 3 };
const TRANSIT_DAYS = { min: 3, max: 6 };
const RETURN_WINDOW_DAYS = 30;

function shippingRateFor(product) {
  const raw = product?.shippingPrice;
  if (raw === undefined || raw === null || raw === "") return STANDARD_SHIPPING_PRICE;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : STANDARD_SHIPPING_PRICE;
}

function days(range) {
  return { "@type": "QuantitativeValue", minValue: range.min, maxValue: range.max, unitCode: "DAY" };
}

function offerShippingDetails(product) {
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: shippingRateFor(product), currency: "CAD" },
    shippingDestination: SHIPPING_COUNTRIES.map((addressCountry) => ({ "@type": "DefinedRegion", addressCountry })),
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: days(HANDLING_DAYS), transitTime: days(TRANSIT_DAYS) },
  };
}

const MERCHANT_RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: RETURN_POLICY_COUNTRIES,
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: RETURN_WINDOW_DAYS,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnShippingFees",
  merchantReturnLink: `${STOREFRONT_ORIGIN}/returns`,
};

function itemConditionFor(condition) {
  if (condition === "New") return "https://schema.org/NewCondition";
  if (condition === "Open Box — Tested" || condition === "Refurbished — Tested") return "https://schema.org/RefurbishedCondition";
  return "https://schema.org/UsedCondition";
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  const plain = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const SITE_NAME = "Reflexity RAM";

// Brand for a product that has none stored: the guess the product page has always made.
function manufacturerOf(product) {
  if (product?.brand) return normalizeText(product.brand, 60);
  const name = String(product?.name || "");
  if (/^sk[ -]?hynix\b/i.test(name)) return "SK hynix";
  return name.split(" ")[0] || "";
}

// The same rule the page's useSEO applies, so the HTML a crawler fetches and the page it renders carry one title.
export function withSiteName(title) {
  const text = String(title || "").trim();
  if (!text) return "";
  return text.endsWith(SITE_NAME) ? text : `${text} — ${SITE_NAME}`;
}

const speedLabelFor = (product) => {
  const speed = Number(product?.speed);
  return product?.generation ? (speed > 0 ? `${product.generation}-${speed}` : product.generation) : "";
};

// What a buyer types into a search box: "SK hynix 16GB DDR4-3200 ECC RDIMM HMA82GR7DJR8N-XN". The long product name stays the page heading
// and the Merchant Center title; a stored metaTitle always wins, and a product without the full set of spec fields keeps its name.
export function productSeoTitle(product) {
  const stored = normalizeText(product?.metaTitle, 120);
  if (stored) return stored;
  const complete = product?.brand && product?.capacityLabel && product?.generation && product?.formFactor && product?.mpn;
  if (complete) {
    const composed = [manufacturerOf(product), product.capacityLabel, speedLabelFor(product), product.ecc ? "ECC" : "", product.formFactor, product.mpn]
      .map((part) => normalizeText(String(part || ""), 60)).filter(Boolean).join(" ");
    if (composed.length <= 75) return composed;
  }
  return normalizeText(product?.name, 120);
}

// A stored metaDescription wins, then the written description; both are cut at a word boundary so a snippet never ends mid-word.
// Without either, a complete sentence is composed from the spec fields.
export function productSeoDescription(product, maxLength = 160) {
  const written = normalizeText(product?.metaDescription, 400) || normalizeText(product?.description, 400);
  if (written) {
    if (written.length <= maxLength) return written;
    // Prefer ending on a whole sentence; otherwise cut at a word and say so.
    const window = written.slice(0, maxLength + 1);
    const sentenceEnd = window.lastIndexOf(". ");
    if (sentenceEnd >= maxLength * 0.5) return window.slice(0, sentenceEnd + 1);
    const cut = written.slice(0, maxLength - 1);
    const at = cut.lastIndexOf(" ");
    return `${(at > maxLength * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.—-]+$/, "")}…`;
  }
  const spec = [product?.capacityLabel, speedLabelFor(product), product?.ecc ? "ECC" : "", product?.formFactor].filter(Boolean).join(" ");
  if (!spec) return "";
  return normalizeText([
    `${manufacturerOf(product)} ${spec} server memory${product?.mpn ? `, part number ${product.mpn}` : ""}.`,
    product?.condition ? `${product.condition}.` : "",
    product?.warranty ? `${product.warranty} warranty.` : "",
    "Tracked shipping from Toronto, Canada.",
  ].filter(Boolean).join(" "), maxLength);
}

// ONE Product schema for the HTML the edge serves and for the page after React renders. The page used to remove the edge's block and put in a
// poorer one (no shipping details, no return policy, and "Used" where the Merchant Center feed says refurbished), and Google reads the rendered page.
export function buildProductSchema(product, { url, description, images, now = Date.now() } = {}) {
  const canonical = url || `${STOREFRONT_ORIGIN}/shop/${encodeURIComponent(product?.slug || "")}`;
  const imageList = Array.isArray(images) && images.length ? images : [safeImageUrl(product)];
  const manufacturer = manufacturerOf(product);
  const properties = [
    ["Generation", product?.generation], ["Form Factor", product?.formFactor], ["Capacity", product?.capacityLabel],
    ["Speed", product?.speedLabel], ["CAS Latency", product?.cas], ["ECC", product?.ecc ? "Yes" : "No"],
  ].filter(([, value]) => value).map(([name, value]) => ({ "@type": "PropertyValue", name, value: normalizeText(String(value), 60) }));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: normalizeText(product?.name, 160),
    description: description || productSeoDescription(product, 180),
    image: imageList,
    sku: normalizeText(product?.sku, 80) || undefined,
    mpn: normalizeText(product?.mpn, 80) || undefined,
    brand: manufacturer ? { "@type": "Brand", name: manufacturer } : undefined,
    offers: {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "CAD",
      price: Number(product?.price || 0),
      priceValidUntil: new Date(now + 30 * 86400000).toISOString().slice(0, 10),
      availability: product?.stock === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition: itemConditionFor(product?.condition),
      seller: { "@type": "Organization", name: SITE_NAME, url: STOREFRONT_ORIGIN },
      shippingDetails: offerShippingDetails(product),
      hasMerchantReturnPolicy: MERCHANT_RETURN_POLICY,
    },
    additionalProperty: properties.length ? properties : undefined,
  };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertBeforeHeadClose(html, tag) {
  return html.replace(/([ \t]*)<\/head>/i, (_match, indent) => `${indent}${tag}\n${indent}</head>`);
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function upsertMeta(html, attribute, key, content) {
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(
    `<meta\\b[^>]*\\b${attribute}=(['"])${escapeRegExp(key)}\\1[^>]*>`,
    "i",
  );
  return pattern.test(html) ? html.replace(pattern, () => tag) : insertBeforeHeadClose(html, tag);
}

function upsertTitle(html, title) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => tag)
    : insertBeforeHeadClose(html, tag);
}

function upsertCanonical(html, canonicalUrl) {
  const tag = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;
  const pattern = /<link\b(?=[^>]*\brel=(['"])canonical\1)[^>]*>/i;
  return pattern.test(html) ? html.replace(pattern, () => tag) : insertBeforeHeadClose(html, tag);
}

function safeImageUrl(product) {
  const candidate = product?.images?.find((image) =>
    typeof image === "string" ? image : image?.url,
  );
  const value = typeof candidate === "string" ? candidate : candidate?.url;
  if (!value) return `${STOREFRONT_ORIGIN}/og-image.jpg`;

  try {
    const url = new URL(value, STOREFRONT_ORIGIN);
    return url.protocol === "https:"
      ? url.toString()
      : `${STOREFRONT_ORIGIN}/og-image.jpg`;
  } catch {
    return `${STOREFRONT_ORIGIN}/og-image.jpg`;
  }
}

function productMetadata(product, requestedSlug) {
  const title = withSiteName(productSeoTitle(product));
  const fallbackDescription = [
    product.name,
    product.generation,
    product.formFactor,
    product.speedLabel,
    product.condition,
    product.warranty ? `${product.warranty} warranty` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const description = productSeoDescription(product) || normalizeText(fallbackDescription, 160);
  const canonicalSlug = VALID_SLUG.test(product.slug || "") ? product.slug : requestedSlug;

  return {
    title,
    description,
    canonicalUrl: `${STOREFRONT_ORIGIN}/shop/${encodeURIComponent(canonicalSlug)}`,
    imageUrl: safeImageUrl(product),
  };
}

export function injectProductMetadata(html, product, requestedSlug) {
  const metadata = productMetadata(product, requestedSlug);
  if (!metadata.title || !metadata.description) return null;

  let output = upsertTitle(html, metadata.title);
  output = upsertMeta(output, "name", "description", metadata.description);
  output = upsertMeta(output, "property", "og:title", metadata.title);
  output = upsertMeta(output, "property", "og:description", metadata.description);
  output = upsertMeta(output, "property", "og:type", "product");
  output = upsertMeta(output, "property", "og:url", metadata.canonicalUrl);
  output = upsertMeta(output, "property", "og:image", metadata.imageUrl);
  output = upsertMeta(output, "name", "twitter:title", metadata.title);
  output = upsertMeta(output, "name", "twitter:description", metadata.description);
  output = upsertMeta(output, "name", "twitter:image", metadata.imageUrl);
  output = upsertCanonical(output, metadata.canonicalUrl);

  const name = normalizeText(product.name, 160);
  const sku = normalizeText(product.sku, 80);
  const generation = normalizeText(product.generation, 30);
  const formFactor = normalizeText(product.formFactor, 40);
  const schema = buildProductSchema(product, { url: metadata.canonicalUrl, description: metadata.description, images: [metadata.imageUrl] });
  output = insertBeforeHeadClose(output, `<script type="application/ld+json" data-edge-product>${safeJson(schema)}</script>`);
  const details = [generation, formFactor, normalizeText(product.capacityLabel, 40), normalizeText(product.speedLabel, 40)].filter(Boolean).join(" · ");
  const body = `<div id="root"><main data-edge-content="product"><nav><a href="/">Reflexity RAM</a> · <a href="/shop">Shop tested RAM</a> · <a href="/guides">Compatibility guides</a></nav><article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(metadata.description)}</p>${details ? `<p>${escapeHtml(details)}</p>` : ""}${sku ? `<p>SKU: ${escapeHtml(sku)}</p>` : ""}<p><a href="${escapeHtml(metadata.canonicalUrl)}">View product details</a> · <a href="/support">Ask about compatibility</a></p></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, () => body);
}

function injectNotFoundMetadata(html) {
  let output = upsertTitle(html, "Product not found | Reflexity RAM");
  output = upsertMeta(output, "name", "robots", "noindex, nofollow");
  return output;
}

async function productNotFound(shell, method) {
  if (method === "HEAD") return responseWithHeaders(shell, null, "product-not-found", 404);
  const html = await shell.text();
  const body = new TextEncoder().encode(html).byteLength <= MAX_HTML_BYTES && /<\/head>/i.test(html)
    ? injectNotFoundMetadata(html)
    : '<!doctype html><html lang="en"><head><meta name="robots" content="noindex, nofollow" /><title>Product not found | Reflexity RAM</title></head><body><main><h1>Product not found</h1></main></body></html>';
  return responseWithHeaders(shell, body, "product-not-found", 404);
}

function responseWithHeaders(response, body, source, status = response.status) {
  const headers = applyStorefrontSecurityHeaders(new Headers(response.headers));
  if (typeof body === "string") {
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.delete("ETag");
    headers.delete("Last-Modified");
  }
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Reflexity-SEO", source);
  return new Response(body, {
    status,
    statusText: status === response.status ? response.statusText : undefined,
    headers,
  });
}

async function loadProduct(slug, fetchImpl) {
  const url = new URL(`/api/products/${encodeURIComponent(slug)}`, BACKEND_ORIGIN);
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });

  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) throw new Error(`product API returned ${response.status}`);

  const payload = await response.json();
  if (!payload?.product || typeof payload.product !== "object") {
    throw new Error("product API response did not contain a product");
  }
  return { kind: "product", product: payload.product };
}

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve({ kind: "timeout" });
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve(value);
      },
      (error) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve({ kind: "error", error });
      },
    );
  });
}

export async function renderProductPage(
  context,
  {
    fetchImpl = fetch,
    logger = console,
    productFetchBudgetMs = PRODUCT_FETCH_BUDGET_MS,
  } = {},
) {
  const method = context.request.method.toUpperCase();
  const shellPromise = context.next();

  if (method !== "GET" && method !== "HEAD") {
    const shell = await shellPromise;
    return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through");
  }

  const slug = typeof context.params?.slug === "string" ? context.params.slug : "";
  if (!VALID_SLUG.test(slug)) {
    const shell = await shellPromise;
    return productNotFound(shell, method);
  }

  const productPromise = loadProduct(slug, fetchImpl);
  const [shell, productResult] = await Promise.all([
    shellPromise,
    settleWithin(productPromise, productFetchBudgetMs),
  ]);

  if (productResult.kind === "timeout") {
    const completion = productPromise.catch((error) => {
      logger.warn("Deferred product metadata fetch failed", {
        slug,
        message: error instanceof Error ? error.message : "unknown error",
      });
    });
    if (typeof context.waitUntil === "function") context.waitUntil(completion);
    return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-timeout-fallback");
  }

  if (productResult.kind === "error") {
    logger.warn("Product metadata fetch failed", {
      slug,
      message:
        productResult.error instanceof Error
          ? productResult.error.message
          : "unknown error",
    });
    return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-error-fallback");
  }

  if (productResult.kind === "not-found") return productNotFound(shell, method);
  if (method === "HEAD") return responseWithHeaders(shell, null, "product-edge");

  const contentType = shell.headers.get("Content-Type") || "";
  const declaredLength = Number(shell.headers.get("Content-Length") || 0);
  if (!shell.ok || !contentType.toLowerCase().includes("text/html") || declaredLength > MAX_HTML_BYTES) {
    return responseWithHeaders(shell, shell.body, "spa-pass-through");
  }

  const html = await shell.text();
  if (
    new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES ||
    !/<head[\s>]/i.test(html) ||
    !/<\/head>/i.test(html)
  ) {
    return responseWithHeaders(shell, html, "spa-pass-through");
  }

  if (productResult.product.line !== "Server") {
    return productNotFound(new Response(html, { status: shell.status, headers: shell.headers }), method);
  }

  const enriched = injectProductMetadata(html, productResult.product, slug);
  if (!enriched) return responseWithHeaders(shell, html, "spa-fallback");
  return responseWithHeaders(shell, enriched, "product-edge");
}
