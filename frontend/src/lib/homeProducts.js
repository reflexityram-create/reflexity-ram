import { isAvailableServerPart } from "./availableServerPart.js";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isExactPart(product) {
  return isAvailableServerPart(product)
    && [product.brand, product.capacityLabel, product.generation, product.formFactor, product.mpn]
      .every(hasText);
}

/** Pick up to three direct links, spreading the visible choices by capacity and form factor. */
export function pickHomeExactParts(products, max = 3) {
  const candidates = (Array.isArray(products) ? products : []).filter(isExactPart);
  const selected = [];
  const capacities = new Set();
  const formFactors = new Set();

  for (const product of candidates) {
    if (selected.length >= max) break;
    if (!capacities.has(product.capacityLabel) || !formFactors.has(product.formFactor)) {
      selected.push(product);
      capacities.add(product.capacityLabel);
      formFactors.add(product.formFactor);
    }
  }
  for (const product of candidates) {
    if (selected.length >= max) break;
    if (!selected.includes(product)) selected.push(product);
  }
  return selected;
}
