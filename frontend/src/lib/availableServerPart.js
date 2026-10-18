const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

// Exact-part recommendations make a stock claim, so incomplete inventory is omitted.
export function isAvailableServerPart(product) {
  return product?.line === "Server"
    && (product.stock === "in" || product.stock === "low")
    && typeof product.stockQuantity === "number"
    && Number.isFinite(product.stockQuantity)
    && product.stockQuantity > 0
    && typeof product.slug === "string"
    && VALID_SLUG.test(product.slug)
    && typeof product.name === "string" && product.name.trim().length > 0
    && typeof product.mpn === "string" && product.mpn.trim().length > 0;
}
