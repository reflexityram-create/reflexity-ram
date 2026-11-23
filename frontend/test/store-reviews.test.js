import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeStoreReviews, ratingLabel, reviewCountLabel, reviewDate } from "../src/lib/reviews.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("rating labels read naturally for one and many reviews", () => {
  assert.equal(reviewCountLabel(1), "1 verified review");
  assert.equal(reviewCountLabel(12), "12 verified reviews");
  assert.equal(ratingLabel({ count: 1, average: 5 }), "5.0 · 1 verified review");
  assert.equal(ratingLabel({ count: 3, average: 4.7 }), "4.7 · 3 verified reviews");
  assert.equal(ratingLabel({ count: 0, average: 0 }), "");
  assert.equal(reviewDate("2026-11-19T15:00:00Z"), "Nov 19, 2026");
  assert.equal(reviewDate("not a date"), "");
});

test("a broken or empty store answer shows no review section instead of a broken one", () => {
  const empty = { reviews: [], summary: { count: 0, average: 0 } };
  assert.deepEqual(normalizeStoreReviews(undefined), empty);
  assert.deepEqual(normalizeStoreReviews({ summary: { count: 2, average: 5 } }), empty);
  assert.deepEqual(normalizeStoreReviews({ reviews: [], summary: { count: 0, average: 0 } }), empty);
  const review = { displayName: "Richard", rating: 5, body: "Worked first time in my server." };
  assert.deepEqual(
    normalizeStoreReviews({ summary: { count: 1, average: 5 }, reviews: [review, null, { rating: 5 }] }),
    { summary: { count: 1, average: 5 }, reviews: [review] },
  );
});

test("the home page shows the store rating up top and the reviews section, and the product page shows its rating under the name", async () => {
  const [home, product, api] = await Promise.all([
    read("../src/pages/Home.jsx"),
    read("../src/pages/Product.jsx"),
    read("../src/lib/api.js"),
  ]);
  assert.match(api, /store: \(config = \{\}\) => publicApi\.get\('\/reviews\/store', config\)/);
  assert.match(home, /reviewsApi\.store\(/);
  assert.match(home, /<StoreReviewsSection data=\{storeReviews\}/);
  assert.match(home, /href="#reviews"[\s\S]*?<RatingSummary summary=\{storeReviews\.summary\}/);
  assert.match(product, /openTab\("reviews"\)[\s\S]*?<RatingSummary summary=\{reviewData\.summary\}/);
});
