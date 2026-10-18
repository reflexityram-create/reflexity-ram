import { isAvailableServerPart } from "./availableServerPart.js";

export function isGuideProduct(product) {
  return isAvailableServerPart(product);
}

export function selectGuideProducts(products, limit = 6) {
  if (!Array.isArray(products)) return [];
  return products.filter(isGuideProduct).slice(0, limit);
}

export function guideProductLabel(product) {
  const parts = [product.brand, product.capacityLabel, product.generation, product.formFactor].filter(Boolean);
  return parts.join(" · ") || "Server RAM";
}
