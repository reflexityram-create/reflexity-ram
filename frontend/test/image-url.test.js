import assert from "node:assert/strict";
import test from "node:test";

import { imageUrl } from "../src/lib/imageUrl.js";

test("imageUrl accepts API image objects and historical string values without rewriting hosts", () => {
  const current = "https://res.cloudinary.com/fike/image/upload/product.jpg";
  const historical = "https://res.cloudinary.com/dfquny0nk/image/upload/product.jpg";

  assert.equal(imageUrl({ url: current }), current);
  assert.equal(imageUrl(historical), historical);
});

test("imageUrl returns null when an image or URL is absent", () => {
  assert.equal(imageUrl(null), null);
  assert.equal(imageUrl({}), null);
  assert.equal(imageUrl(""), null);
});

test("imageUrl requests responsive Cloudinary delivery without changing the asset host", () => {
  const source = "https://res.cloudinary.com/fike/image/upload/v123/product.jpg";
  assert.equal(
    imageUrl(source, { width: 640 }),
    "https://res.cloudinary.com/fike/image/upload/f_auto,q_auto,w_640/v123/product.jpg",
  );
  assert.equal(imageUrl("https://example.com/product.jpg", { width: 640 }), "https://example.com/product.jpg");
  assert.equal(imageUrl(source, { width: 99999 }), source);
});
