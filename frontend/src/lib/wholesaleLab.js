export const WHOLESALE_CONCEPTS = Object.freeze([
  {
    id: "board",
    number: "01",
    label: "Inventory board",
    summary: "Fastest for exact part-number buyers",
    eyebrow: "Reflexity wholesale",
    lead: "Wholesale stock,",
    accent: "ready to move.",
    description:
      "A dense, spec-first view for resellers and IT buyers who already know the part number, quantity, or configuration they need.",
  },
  {
    id: "market",
    number: "02",
    label: "Stock gallery",
    summary: "Most visual and product-led",
    eyebrow: "Browse current stock",
    lead: "See the module,",
    accent: "then the numbers.",
    description:
      "A more visual direction that makes every module feel tangible while keeping the part number and condition easy to verify.",
  },
  {
    id: "workbench",
    number: "03",
    label: "Quote workbench",
    summary: "Best for multi-SKU buying",
    eyebrow: "Build a requirement",
    lead: "Select the stock,",
    accent: "send one brief.",
    description:
      "A buyer workspace for selecting several SKUs, setting requested quantities, and opening one ready-to-review quote draft.",
  },
]);

export const WHOLESALE_FILTERS = Object.freeze(["All stock", "RDIMM", "LRDIMM"]);

export function availableWholesaleReference(products = []) {
  return products.filter((product) => Number(product?.stockQuantity) > 0);
}

export function filterWholesaleReference(products, filter = "All stock", query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return availableWholesaleReference(products).filter((product) => {
    if (filter !== "All stock" && product.formFactor !== filter) return false;
    if (!needle) return true;
    return [
      product.brand,
      product.name,
      product.mpn,
      product.sku,
      product.capacityLabel,
      product.generation,
      product.speedLabel,
      product.formFactor,
      product.condition,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(needle));
  });
}

export function clampQuoteQuantity(value, stockQuantity) {
  const stock = Math.max(0, Math.floor(Number(stockQuantity) || 0));
  if (!stock) return 0;
  const quantity = Math.floor(Number(value) || 1);
  return Math.min(stock, Math.max(1, quantity));
}

export function selectedWholesaleQuoteLines(products = [], quantities = {}) {
  return availableWholesaleReference(products)
    .filter((product) => Number(quantities[product.sku]) > 0)
    .map((product) => ({
      product,
      quantity: clampQuoteQuantity(quantities[product.sku], product.stockQuantity),
    }));
}

export function wholesaleStockState({ loading = false, error = false } = {}) {
  if (loading) {
    return {
      title: "Loading current stock",
      detail: "Connecting to the read-only public catalog…",
    };
  }
  if (error) {
    return {
      title: "Catalog unavailable",
      detail: "Stock totals are not being shown because the public catalog could not be reached.",
    };
  }
  return {
    title: "No matching stock",
    detail: "Try another part number or stock filter.",
  };
}

export function buildWholesaleQuoteUrl(lines = []) {
  const selected = lines
    .filter((line) => line?.product && Number(line.quantity) > 0)
    .map((line) => ({
      product: line.product,
      quantity: clampQuoteQuantity(line.quantity, line.product.stockQuantity),
    }))
    .filter((line) => line.quantity > 0);

  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", "reflexityram@gmail.com");
  url.searchParams.set(
    "su",
    selected.length === 1
      ? `Wholesale quote — ${selected[0].product.mpn || selected[0].product.sku}`
      : `Wholesale quote list — ${selected.length} SKUs`,
  );

  const requirements = selected.map(({ product, quantity }, index) => [
    `${index + 1}. ${product.brand || "Server memory"} ${product.capacityLabel || ""} ${product.generation || ""} ${product.formFactor || ""}`.trim(),
    `   MPN: ${product.mpn || "Not listed"}`,
    `   SKU: ${product.sku || "Not listed"}`,
    `   Requested quantity: ${quantity}`,
  ].join("\n"));

  url.searchParams.set(
    "body",
    [
      "Hi Reflexity,",
      "",
      "Please confirm availability and quote the following current catalog stock:",
      "",
      ...requirements,
      "",
      "Destination:",
      "Needed by:",
      "Company:",
      "",
      "Thank you.",
    ].join("\n"),
  );
  return url.toString();
}
