// Quantity rules shared by the product page and the cart.

// The cart API's own ceiling for one line.
export const MAX_QTY_PER_LINE = 99;

const knownCount = (stockQuantity) => stockQuantity != null && stockQuantity !== "" && Number.isFinite(Number(stockQuantity));

// How many a buyer can pick: the stock on hand, never more than the cart accepts. A product that
// arrives without a stock count is limited by the server instead.
export function quantityLimit(stockQuantity) {
  if (!knownCount(stockQuantity)) return MAX_QTY_PER_LINE;
  return Math.max(0, Math.min(MAX_QTY_PER_LINE, Math.floor(Number(stockQuantity))));
}

// Turn what the buyer tapped or typed into a quantity from 1 to `limit`. `capped` says they asked
// for more than the limit, so the screen can say why it stopped. Nothing to pick (limit 0) gives 0.
export function clampQuantity(requested, limit) {
  if (!(limit >= 1)) return { qty: 0, capped: false };
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n) || n < 1) return { qty: 1, capped: false };
  if (n > limit) return { qty: limit, capped: true };
  return { qty: n, capped: false };
}

// What to tell a buyer who has reached the limit.
export function limitNote(stockQuantity) {
  const limit = quantityLimit(stockQuantity);
  if (knownCount(stockQuantity) && limit < MAX_QTY_PER_LINE) {
    return limit < 1 ? "Out of stock" : `Only ${limit} available`;
  }
  return `Maximum ${MAX_QTY_PER_LINE} per order`;
}
