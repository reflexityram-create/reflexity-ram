export const STORE_CURRENCY_CODE = "CAD";
export const STORE_CURRENCY_NAME = "Canadian dollars (CAD)";
export const STANDARD_SHIPPING_PRICE = 14;
// 3 or more sticks in one order ship for the higher flat rate (backend/src/config/shipping.js).
export const LARGE_ORDER_MIN_STICKS = 3;
export const LARGE_ORDER_SHIPPING_PRICE = 25;
// Optional Faster shipping (Xpresspost) is a flat extra on orders of up to 6 sticks; a signature on delivery is $2.
// The cart API returns the exact Faster price (`shippingFaster`, null when not offered); these are for wording and the
// signature line. Mirrors backend/src/config/shipping.js (a test keeps them equal).
export const FASTER_SHIPPING_UPCHARGE = 12;
export const FASTER_SHIPPING_MAX_STICKS = 6;
export const SIGNATURE_PRICE = 2;

export function hasOwnShippingPrice(product) {
  const raw = product?.shippingPrice;
  return !(raw === undefined || raw === null || raw === "") && Number.isFinite(Number(raw)) && Number(raw) >= 0;
}

// A product may carry its own shipping rate (`shippingPrice`); everything else
// ships at the stick-count rate ($14, or $25 for 3+ sticks).
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
