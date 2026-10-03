// Payment methods the hosted Stripe Checkout accepts for this store (Stripe Dashboard > Payment
// methods). Google Merchant Center reads this wording on the guest checkout pages to rate wallet
// support, so list only wallets that are switched on, and keep the lists in step with Stripe.
export const ACCEPTED_CARD_BRANDS = ["Visa", "Mastercard", "American Express"];
export const ACCEPTED_WALLETS = ["Apple Pay", "Google Pay", "Link"];

export function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const ACCEPTED_PAYMENTS_LIST = joinList([...ACCEPTED_CARD_BRANDS, ...ACCEPTED_WALLETS]);
export const ACCEPTED_PAYMENTS_SENTENCE = `Pay with ${ACCEPTED_PAYMENTS_LIST}. Guest checkout, no account needed.`;
