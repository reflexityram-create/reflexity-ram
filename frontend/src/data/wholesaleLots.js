/**
 * Manually published wholesale-only inventory.
 *
 * This source is deliberately separate from the retail Product API. Add a lot
 * here only after Reflexity has verified that exact wholesale stock. Never copy
 * the regular shop catalog into this list.
 *
 * Lot shape:
 * {
 *   id, status: "published", visibility: "local-demo" | "public",
 *   title, brand, mpn, generation, formFactor, capacityLabel, speedLabel,
 *   rank, condition, testStatus, warranty, quantityAvailable,
 *   minimumOrderQuantity, orderIncrement, shipFrom, imageUrl, notes, postedAt
 * }
 */
export const WHOLESALE_LOTS = Object.freeze([]);
