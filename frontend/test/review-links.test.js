import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the privacy policy discloses every field the Google Customer Reviews opt-in hands to Google", async () => {
  const [optIn, privacy] = await Promise.all([
    read("../src/components/GoogleCustomerReviewsOptIn.jsx"),
    read("../src/pages/policies/Privacy.jsx"),
  ]);
  const disclosed = {
    email: /email address/,
    order_id: /order number/,
    delivery_country: /delivery country/,
    estimated_delivery_date: /estimated delivery date/,
  };
  const renderCall = optIn.match(/surveyoptin\.render\(\{([\s\S]*?)\}\);/);
  assert.ok(renderCall, "the opt-in still calls gapi.surveyoptin.render");
  const sentFields = [...renderCall[1].matchAll(/^\s+(\w+)\s*[:,]/gm)].map(([, key]) => key)
    .filter((key) => key !== "merchant_id" && key !== "opt_in_style");
  assert.deepEqual(sentFields.sort(), Object.keys(disclosed).sort(), "a new opt-in field needs a privacy-policy line");
  assert.match(privacy, /Google Customer Reviews/);
  for (const [field, wording] of Object.entries(disclosed)) assert.match(privacy, wording, field);
  assert.doesNotMatch(privacy, /share customer data with third parties/, "the store does share data with its processors");
});

test("the privacy policy describes review emails, unsubscribing and what a review publishes", async () => {
  const privacy = await read("../src/pages/policies/Privacy.jsx");
  assert.match(privacy, /about 10 days after it ships, one email asking how the order went/);
  assert.match(privacy, /unsubscribe link/);
  assert.match(privacy, /first name, the date, and a \\"Verified purchase\\" label/);
  assert.match(privacy, /never publish your last name, email address, or order details/);
});

test("review links stay out of URLs sent to servers, analytics and search engines", async () => {
  const [api, app, bootstrap, robots] = await Promise.all([
    read("../src/lib/api.js"),
    read("../src/App.jsx"),
    read("../public/analytics-bootstrap.js"),
    read("../public/robots.txt"),
  ]);
  assert.match(app, /<Route path="\/review" element={<ReviewOrder \/>} \/>/);
  for (const call of ["lookup", "submit", "unsubscribe"]) {
    assert.match(api, new RegExp(`${call}: \\(token(?:, data)?\\) => publicApi\\.post\\('/reviews/request/\\w+', \\{ token`), call);
  }
  assert.match(bootstrap, /\|review\|/);
  assert.match(robots, /^Disallow: \/review$/m);
});
