export function buildLeadPrefill({
  intent = "buy", productType = "RAM", partNumber = "", specification = "", quantity = "",
  sourceType = "", sourceId = "", sourceCode = "", sku = "", itemTitle = "",
} = {}) {
  const params = new URLSearchParams({ intent, productType });
  for (const [key, value] of Object.entries({ sourceType, sourceId, sourceCode, sku, itemTitle, partNumber, specification, quantity })) {
    if (value) params.set(key, String(value));
  }
  return `/contact?${params.toString()}`;
}
