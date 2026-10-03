// The footer and the guest checkout page tell Google (Merchant Center reads them) and shoppers which
// payment methods Stripe Checkout accepts. The wording must come from one list, and only wallets that
// are switched on in Stripe may be named.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCEPTED_CARD_BRANDS,
  ACCEPTED_PAYMENTS_LIST,
  ACCEPTED_PAYMENTS_SENTENCE,
  ACCEPTED_WALLETS,
  joinList,
} from "../src/lib/payments.js";

test("joinList reads naturally for any length", () => {
  assert.equal(joinList([]), "");
  assert.equal(joinList(["Visa"]), "Visa");
  assert.equal(joinList(["Visa", "Link"]), "Visa and Link");
  assert.equal(joinList(["Visa", "Apple Pay", "Link"]), "Visa, Apple Pay and Link");
});

test("the accepted payment list names the cards and the three wallets", () => {
  assert.deepEqual(ACCEPTED_CARD_BRANDS, ["Visa", "Mastercard", "American Express"]);
  assert.deepEqual(ACCEPTED_WALLETS, ["Apple Pay", "Google Pay", "Link"]);
  assert.equal(ACCEPTED_PAYMENTS_LIST, "Visa, Mastercard, American Express, Apple Pay, Google Pay and Link");
  assert.equal(
    ACCEPTED_PAYMENTS_SENTENCE,
    "Pay with Visa, Mastercard, American Express, Apple Pay, Google Pay and Link. Guest checkout, no account needed.",
  );
});

test("the footer and the checkout page render the shared wording", () => {
  const footer = readFileSync(new URL("../src/components/Footer.jsx", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../src/pages/Checkout.jsx", import.meta.url), "utf8");
  for (const source of [footer, checkout]) {
    assert.match(source, /import \{ ACCEPTED_PAYMENTS_SENTENCE \} from "@\/lib\/payments";|import \{ ACCEPTED_PAYMENTS_SENTENCE \} from '@\/lib\/payments';/);
    assert.match(source, /\{ACCEPTED_PAYMENTS_SENTENCE\}/);
  }
  assert.match(footer, /data-testid="footer-payments"/);
  assert.match(checkout, /data-testid="checkout-payments"/);
});
