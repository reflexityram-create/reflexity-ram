// The product the edge function already put in the page (functions-shared/productMetadata.js, #edge-product-data).
// Returns it only for the slug being shown, so a later client-side visit to another product never shows the wrong one.
export function readEdgeProduct(slug, doc = globalThis.document) {
  try {
    const raw = doc?.getElementById?.("edge-product-data")?.textContent;
    if (!raw || !slug) return null;
    const data = JSON.parse(raw);
    const product = data?.product;
    if (!product || typeof product !== "object" || data.slug !== slug || product.slug !== slug) return null;
    return product;
  } catch {
    return null;
  }
}
