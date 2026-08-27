import { matchesCatalogLines } from "./catalog.js";

export function readShopFilters(params) {
  return {
    query: params.get("q") || "",
    generations: params.getAll("gen"),
    formFactors: params.getAll("form"),
    lines: params.getAll("line"),
    capacities: params.getAll("cap").map(Number).filter(Number.isFinite),
    conditions: params.getAll("cond"),
    eccOnly: params.get("ecc") === "true",
    sort: params.get("sort") || "featured",
  };
}

export function productMatchesShopFilters(product, filters) {
  const {
    query,
    generations,
    formFactors,
    lines,
    capacities,
    conditions,
    eccOnly,
  } = filters;

  if (generations.length && !generations.includes(product.generation)) return false;
  if (formFactors.length && !formFactors.includes(product.formFactor)) return false;
  if (!matchesCatalogLines(product, lines)) return false;
  if (capacities.length && !capacities.includes(product.capacity)) return false;
  if (conditions.length && !conditions.includes(product.condition)) return false;
  if (eccOnly && product.ecc !== true) return false;

  if (query) {
    const haystack = [
      product.sku,
      product.name,
      product.line,
      product.generation,
      product.formFactor,
      product.speedLabel,
      product.cas,
      product.timings,
      product.capacityLabel,
      product.ecc ? "ECC" : "",
      ...(product.tags || []),
    ].join(" ").toLowerCase();

    if (!haystack.includes(query.toLowerCase())) return false;
  }

  return true;
}

export function setShopFilterParam(params, key, value) {
  const next = new URLSearchParams(params);
  if (value === null || value === undefined || value === "") next.delete(key);
  else next.set(key, String(value));
  return next;
}

export function toggleShopFilterParam(params, key, value) {
  const next = new URLSearchParams(params);
  const stringValue = String(value);
  const existing = next.getAll(key);

  next.delete(key);
  if (existing.includes(stringValue)) {
    existing.filter((item) => item !== stringValue).forEach((item) => next.append(key, item));
  } else {
    existing.forEach((item) => next.append(key, item));
    next.append(key, stringValue);
  }

  return next;
}
