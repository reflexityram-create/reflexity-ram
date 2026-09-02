import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const BACKEND_ORIGIN = "https://reflexity-ram.onrender.com";
const STOREFRONT_ORIGIN = "https://reflexityram.com";
const PRODUCT_FETCH_BUDGET_MS = 2500;
const MAX_HTML_BYTES = 128 * 1024;
const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

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
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function upsertTitle(html, title) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, tag)
    : insertBeforeHeadClose(html, tag);
}

function upsertCanonical(html, canonicalUrl) {
  const tag = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;
  const pattern = /<link\b(?=[^>]*\brel=(['"])canonical\1)[^>]*>/i;
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function safeImageUrl(product) {
  const candidate = product?.images?.find((image) =>
    typeof image === "string" ? image : image?.url,
  );
  const value = typeof candidate === "string" ? candidate : candidate?.url;
  if (!value) return `${STOREFRONT_ORIGIN}/og-image.svg`;

  try {
    const url = new URL(value, STOREFRONT_ORIGIN);
    return url.protocol === "https:"
      ? url.toString()
      : `${STOREFRONT_ORIGIN}/og-image.svg`;
  } catch {
    return `${STOREFRONT_ORIGIN}/og-image.svg`;
  }
}

function productMetadata(product, requestedSlug) {
  const title = normalizeText(product.metaTitle || product.name, 120);
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
  const description = normalizeText(
    product.metaDescription || product.description || fallbackDescription,
    180,
  );
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
  const availability = product.stock === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock";
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: metadata.description,
    image: [metadata.imageUrl],
    sku: sku || undefined,
    brand: product.brand ? { "@type": "Brand", name: normalizeText(product.brand, 60) } : undefined,
    offers: {
      "@type": "Offer",
      url: metadata.canonicalUrl,
      priceCurrency: "CAD",
      price: Number(product.price || 0),
      availability,
      itemCondition: product.condition === "New" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
    },
  };
  output = insertBeforeHeadClose(output, `<script type="application/ld+json" data-edge-product>${safeJson(schema)}</script>`);
  const details = [generation, formFactor, normalizeText(product.capacityLabel, 40), normalizeText(product.speedLabel, 40)].filter(Boolean).join(" · ");
  const body = `<div id="root"><main data-edge-content="product"><nav><a href="/">Reflexity RAM</a> · <a href="/shop">Shop tested RAM</a> · <a href="/guides">Compatibility guides</a></nav><article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(metadata.description)}</p>${details ? `<p>${escapeHtml(details)}</p>` : ""}${sku ? `<p>SKU: ${escapeHtml(sku)}</p>` : ""}<p><a href="${escapeHtml(metadata.canonicalUrl)}">View product details</a> · <a href="/support">Ask about compatibility</a></p></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, body);
}

function injectNotFoundMetadata(html) {
  let output = upsertTitle(html, "Product not found | Reflexity RAM");
  output = upsertMeta(output, "name", "robots", "noindex, nofollow");
  return output;
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

  if (method !== "GET") {
    const shell = await shellPromise;
    return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through");
  }

  const slug = typeof context.params?.slug === "string" ? context.params.slug : "";
  if (!VALID_SLUG.test(slug)) {
    const shell = await shellPromise;
    return responseWithHeaders(shell, shell.body, "spa-fallback");
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
    return responseWithHeaders(shell, shell.body, "spa-timeout-fallback");
  }

  if (productResult.kind === "error") {
    logger.warn("Product metadata fetch failed", {
      slug,
      message:
        productResult.error instanceof Error
          ? productResult.error.message
          : "unknown error",
    });
    return responseWithHeaders(shell, shell.body, "spa-error-fallback");
  }

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

  if (productResult.kind === "not-found") {
    return responseWithHeaders(shell, injectNotFoundMetadata(html), "product-not-found", 404);
  }

  const enriched = injectProductMetadata(html, productResult.product, slug);
  if (!enriched) return responseWithHeaders(shell, html, "spa-fallback");
  return responseWithHeaders(shell, enriched, "product-edge");
}
