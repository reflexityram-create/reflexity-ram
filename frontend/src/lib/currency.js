export const STORE_CURRENCY_CODE = "CAD";
export const STORE_CURRENCY_NAME = "Canadian dollars (CAD)";
export const STANDARD_SHIPPING_PRICE = 14;

// A product may carry its own shipping rate (`shippingPrice`) when it costs more
// to ship than the standard flat rate; everything else ships at the flat rate.
// Display only — the server resolves the rate it actually charges.
export function shippingPriceFor(product) {
  const raw = product?.shippingPrice;
  if (raw === undefined || raw === null || raw === "") return STANDARD_SHIPPING_PRICE;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : STANDARD_SHIPPING_PRICE;
}

export function formatStorePrice(value, fractionDigits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";

  return `$${amount.toLocaleString("en-CA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatStorePriceWithCode(value, fractionDigits = 2) {
  const formatted = formatStorePrice(value, fractionDigits);
  return formatted === "—" ? formatted : `${formatted} ${STORE_CURRENCY_CODE}`;
}
