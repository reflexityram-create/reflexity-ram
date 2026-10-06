// The shipping panel comes from GET /admin/orders/:id only. The status and review-email responses are plain orders, so replacing the order with them
// made the panel disappear after any action until the page was reloaded (found in the 2026-10-06 review). These source checks keep the reload in place.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

test("the order detail reads the order again after a status change instead of dropping the shipping panel", async () => {
  const source = await read("pages/admin/Orders.jsx");
  const handler = source.slice(source.indexOf("const handleStatusUpdate"), source.indexOf("return (", source.indexOf("const handleStatusUpdate")));
  assert.match(source, /const reloadOrder = async \(fallback\) => \{[\s\S]*?adminApi\.getOrder\(orderId\)[\s\S]*?setOrder\(data\.order\)/);
  assert.match(handler, /updateOrderStatus\(orderId, statusForm\)[\s\S]*?await reloadOrder\(data\.order\)/);
  assert.doesNotMatch(handler, /setOrder\(data\.order\)/, "the status response has no shippingPreparation");
});

test("a review request or any other order update goes through the same reload", async () => {
  const source = await read("pages/admin/Orders.jsx");
  assert.match(source, /<ReviewEmailPanel order=\{order\} onUpdated=\{\(next\) => reloadOrder\(next\)\} \/>/);
  assert.doesNotMatch(source, /onUpdated=\{setOrder\}/);
});

test("the panel shows what was recorded at checkout when it differs from the service it names", async () => {
  const source = await read("components/admin/ShippingPreparationPanel.jsx");
  assert.match(source, /Recorded at checkout: \{service\.recordedMethod\}/);
  assert.match(source, /service\.recordedMethod\.toLowerCase\(\) !== String\(service\.name/);
});

test("the order detail shows the notes the system left on the order, and marks the ones that need action", async () => {
  const source = await read("pages/admin/Orders.jsx");
  assert.match(source, /\{order\.adminNotes && \(\s*<div[^>]*role="note" data-testid="order-admin-notes">/);
  assert.match(source, /order\.adminNotes\.split\('\\n'\)\.filter\(Boolean\)\.map/);
  assert.match(source, /\/\^\(OVERSOLD\|REVIEW\)\/\.test\(line\)/);
  // the notes come before the items, so "which service to buy" and "oversold" are seen first
  assert.ok(source.indexOf('data-testid="order-admin-notes"') < source.indexOf("{/* Items */}"));
});

test("the product form sends stock only when it was changed, with the stock it was opened with, so a stale form cannot put an old number back", async () => {
  const source = await read("pages/admin/Products.jsx");
  assert.match(source, /const openedStock = useRef\(isEdit && Number\.isInteger\(Number\(product\.stockQuantity\)\) \? Number\(product\.stockQuantity\) : null\);/);
  const literal = source.slice(source.indexOf("const data = {"), source.indexOf("if (!isEdit) {", source.indexOf("const data = {")));
  assert.doesNotMatch(literal, /stockQuantity/, "stock is not part of the always-sent fields");
  assert.match(source, /data\.stockQuantity = Number\(form\.stockQuantity\);\s*\} else if \(openedStock\.current === null \|\| Number\(form\.stockQuantity\) !== openedStock\.current\) \{/);
  assert.match(source, /if \(openedStock\.current !== null\) data\.expectedStockQuantity = openedStock\.current;/);
});

test("amber and yellow text in the order modal has a dark-on-light and a light-on-dark colour, so it reads in both themes", async () => {
  const [orders, panel] = await Promise.all([read("pages/admin/Orders.jsx"), read("components/admin/ShippingPreparationPanel.jsx")]);
  assert.match(orders, /text-amber-800 dark:text-amber-200 font-medium/);
  assert.match(orders, /text-amber-700 dark:text-amber-300 text-\[11px\] uppercase/);
  assert.doesNotMatch(orders, /(?<!dark:)\btext-amber-(200|300)\b/, "no bare pale amber text (the dark: pair is fine)");
  assert.doesNotMatch(panel, /(?<!dark:)\btext-amber-(200|300)\b/, "no bare pale amber text in the panel either");
  assert.doesNotMatch(panel, /text-amber-300\/90/);
  assert.doesNotMatch(panel, /(?<!dark:)text-\[#ffcf24\] hover/, "a bare yellow link is about 1.5:1 on white");
  assert.match(panel, /text-\[#8a5a00\] dark:text-\[#ffcf24\] hover:underline/);
  assert.match(panel, /text-amber-700 dark:text-amber-300/);
});

test("a refused stock save (409) takes the current stock as the form's new baseline, so a form opened from the list can be saved again", async () => {
  const source = await read("pages/admin/Products.jsx");
  assert.match(source, /err\.response\?\.status === 409 && Number\.isInteger\(err\.response\.data\?\.currentStock\)/);
  assert.match(source, /openedStock\.current = err\.response\.data\.currentStock;\s+toast\.error\(err\.response\.data\.error\);/);
});
