// United States checkout (2026-10-06): the page shows the prepaid duties next to shipping and adds them to the total, the country
// picker stops sending US buyers to email once the US is on the list, and the wording everywhere agrees with the server.
// Source checks, like the neighbouring tests: the components need a browser, the strings and wiring do not.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const readBackend = (file) => readFile(new URL(`../../backend/src/${file}`, import.meta.url), "utf8");

test("the checkout page adds the prepaid US duties to the total and shows them as their own row", async () => {
  const source = await read("pages/Checkout.jsx");
  // the amount comes from the server's quote, only for the US, and is part of the total the buyer is shown
  assert.match(source, /const dutiesAmount = international && country === 'US' \? Number\(quote\.duties\?\.amount \|\| 0\) : 0;/);
  assert.match(source, /const totalBeforeTax = Number\(subtotal \|\| 0\) \+ Number\(shippingAmount \|\| 0\) \+ dutiesAmount;/);
  assert.match(source, /\{dutiesAmount > 0 && \(\s*<div[^>]*data-testid="checkout-us-duties">[\s\S]*?US import duties and fees[\s\S]*?formatStorePrice\(dutiesAmount\)/);
  // the quote endpoint's duties are kept, and cleared when the country changes or the quote fails
  assert.match(source, /setQuote\(\{ loading: false, options: data\.options, error: '', duties: data\.duties \|\| null \}\)/);
  assert.equal((source.match(/duties: null/g) || []).length >= 3, true);
  // the browser sends only the country and the service: the server prices shipping and duties itself
  assert.match(source, /international\s*\? \{ country, serviceCode \}/);
  assert.doesNotMatch(source, /createCheckoutSession\([^)]*duties/);
});

test("the US note says nothing is due on delivery and that promotion codes do not apply; other countries keep the old note", async () => {
  const source = await read("pages/Checkout.jsx");
  assert.match(source, /country === 'US'\s*\? \(\s*<p[^>]*data-testid="checkout-us-duties-note">[\s\S]*?prepaid in your total, so nothing is due when the parcel arrives[\s\S]*?Promotion codes cannot be used on US orders/);
  assert.match(source, /Import taxes and duties are charged by your country on delivery\./);
  // the line under the picker no longer promises a US quote by email as the only way
  assert.doesNotMatch(source, /Shipping to the United States or a country not listed\?/);
});

test("typing United States only shows the 'email us' note while the US is not on the list", async () => {
  const source = await read("components/CountryPicker.jsx");
  assert.match(source, /const wantsUnavailable = !countries\.some\(\(c\) => c\.code === 'US'\)\s*&& \(/);
  assert.match(source, /usa: 'US', america: 'US', 'united states': 'US', us: 'US'/, "the aliases still find the US once it is listed");
});

test("the product page opens the US tile only for a product with its country of origin and HS code saved", async () => {
  const source = await read("pages/Product.jsx");
  assert.match(source, /const usOnWebsite = \(p\) => \/\^\[A-Za-z\]\{2\}\$\/\.test\(String\(p\?\.countryOfOrigin \|\| ""\)\) && \/\^\\d\{4\}\/\.test\(String\(p\?\.hsCode \|\| ""\)\);/);
  assert.match(source, /body: usOnWebsite\(p\)\s*\? "Order here: Canada Post Tracked Packet – USA, and US import duties and fees are prepaid in your total/);
  assert.match(source, /Not on the website for this item yet\./);
  assert.doesNotMatch(source, /By quote, because US duties must be prepaid/);
  // the public product API has to carry the HS code for that to work
  const projection = await readBackend("utils/publicProducts.js");
  assert.match(projection, /countryOfOrigin: 1,\s+hsCode: 1,/);
});

test("the policy pages describe US checkout the way the server does, with the same sticks limit", async () => {
  const config = await readBackend("config/shipping.js");
  const limit = Number(config.match(/const US_MAX_STICKS = (\d+);/)[1]);
  const intl = await read("pages/policies/International.jsx");
  assert.match(intl, /<h2>United States<\/h2>/);
  assert.match(intl, /prepaid in your total, so nothing is due when the parcel arrives/);
  assert.match(intl, new RegExp(`Up to ${limit} sticks per order`));
  assert.match(intl, /Promotion codes cannot be used on US orders/);
  assert.doesNotMatch(intl, /so we arrange US orders directly/);
  assert.match(intl, /Outside the United States, prices and shipping do not include your country's import taxes/);
  const shipping = await read("pages/policies/Shipping.jsx");
  assert.match(shipping, /The United States is the exception: its import duties and customs fees are prepaid in your total at checkout/);
  assert.doesNotMatch(shipping, /For the United States, or a country not listed at checkout, email us/);
  const info = await read("pages/policies/BusinessInfo.jsx");
  assert.match(info, /United States orders include prepaid import duties and fees in the total\./);
  assert.doesNotMatch(info, /Orders to the United States and other countries are quoted by email/);
});

test("the admin panel shows the duties the buyer prepaid, from the same field the server sets", async () => {
  const panel = await read("components/admin/ShippingPreparationPanel.jsx");
  assert.match(panel, /\{preparation\.duties && \(\s*<div[^>]*data-testid="shipping-prep-duties">[\s\S]*?money\(preparation\.duties\.prepaidCAD\)/);
  const prep = await readBackend("utils/shippingPreparation.js");
  assert.match(prep, /duties: Number\(order\?\.importDuties\) > 0\s*\? \{ prepaidCAD:/);
});

test("the order page shows a US order's shipping and prepaid duties on separate rows that add up to what was charged", async () => {
  const source = await read("pages/OrderSuccess.jsx");
  assert.match(source, /order\.importDuties > 0 \? order\.shippingMethod\.replace\(\/ \\\+ prepaid US import duties and fees\$\/, ''\) : order\.shippingMethod/);
  assert.match(source, /Math\.round\(\(order\.shippingCost - order\.importDuties\) \* 100\) \/ 100/);
  assert.match(source, /\{order\.importDuties > 0 && \(\s*<div[^>]*data-testid="order-us-duties">[\s\S]*?US import duties and fees[\s\S]*?order\.importDuties\.toFixed\(2\)/);
});
