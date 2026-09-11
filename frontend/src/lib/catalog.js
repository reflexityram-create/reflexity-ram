export const RAM_CATEGORIES = Object.freeze({
  desktop: Object.freeze({
    line: "Desktop",
    href: "/inventory?line=Desktop",
  }),
  laptop: Object.freeze({
    line: "Laptop",
    href: "/inventory?line=Laptop",
  }),
  server: Object.freeze({
    line: "Server",
    href: "/inventory?line=Server",
  }),
});

export const PRODUCT_PAGE_SIZE = 100;

export function getCatalogCategoryLabel(generation, formFactors, lines, eccOnly) {
  const serverForms = ["RDIMM", "LRDIMM"];
  const allServerForms = serverForms.every((form) => formFactors.includes(form))
    && formFactors.length === serverForms.length;

  if (lines.length === 1 && generation.length === 0 && formFactors.length === 0) {
    return `${lines[0]} RAM`;
  }

  if ((formFactors.length === 1 || allServerForms) && generation.length === 0 && lines.length === 0) {
    const formLabels = {
      UDIMM: "Desktop RAM",
      "SO-DIMM": "Laptop RAM",
      RDIMM: "Server RAM",
      LRDIMM: "Server RAM",
    };
    if (allServerForms) return "Server RAM";
    if (formLabels[formFactors[0]]) return formLabels[formFactors[0]];
  }

  const parts = [];
  if (lines.length === 1) parts.push(lines[0]);
  else if (generation.length === 1) parts.push(generation[0]);
  if (generation.length === 1 && lines.length === 1) parts.push(generation[0]);
  if (formFactors.length === 1) {
    const formLabels = { UDIMM: "Desktop", "SO-DIMM": "Laptop", RDIMM: "Server", LRDIMM: "Server" };
    if (!lines.length) parts.unshift(formLabels[formFactors[0]] || formFactors[0]);
  } else if (allServerForms && !lines.length) {
    parts.unshift("Server");
  }
  if (eccOnly) parts.push("ECC");
  return parts.length ? parts.join(" ") : "All Memory";
}

export function matchesCatalogLines(product, lines) {
  return lines.length === 0 || lines.includes(product.line);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;

  const error = new Error("Catalog request was cancelled");
  error.name = "AbortError";
  throw error;
}

function catalogProductOrder(left, right) {
  const leftDate = Date.parse(left?.createdAt || 0) || 0;
  const rightDate = Date.parse(right?.createdAt || 0) || 0;
  if (leftDate !== rightDate) return rightDate - leftDate;

  return String(right?._id || right?.slug || "").localeCompare(
    String(left?._id || left?.slug || ""),
  );
}

/**
 * Requests every page from the catalog API. The public endpoint limits each
 * response to 100 records, so requesting a larger limit alone drops stock.
 */
export async function fetchAllCatalogProducts(fetchPage, {
  signal,
  pageSize = PRODUCT_PAGE_SIZE,
} = {}) {
  throwIfAborted(signal);
  const firstResponse = await fetchPage({ page: 1, limit: pageSize, signal });
  throwIfAborted(signal);

  const firstData = firstResponse?.data || firstResponse || {};
  const products = [...(firstData.products || [])];
  const pages = Number(firstData.pagination?.pages);
  const pageCount = Number.isSafeInteger(pages) && pages > 0 ? pages : 1;

  for (let page = 2; page <= pageCount; page += 1) {
    throwIfAborted(signal);
    const response = await fetchPage({ page, limit: pageSize, signal });
    throwIfAborted(signal);
    const data = response?.data || response || {};
    products.push(...(data.products || []));
  }

  return products.sort(catalogProductOrder);
}
