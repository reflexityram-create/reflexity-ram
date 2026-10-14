// "It had no tracking number": the owner can take a placeholder off an order that already went out (2026-10-09: the word "error").
// The button must say nobody is emailed, call the route the server really has, and appear only where there is a number to remove.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUYER_EMAIL } from "../src/lib/adminOrders.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("the owner is told that nobody is emailed when a tracking number is taken off", () => {
  assert.match(BUYER_EMAIL.untrack, /^No email is sent\./);
  assert.match(BUYER_EMAIL.untrack, /without tracking/);
});

test("the api client calls a route the server has, as a POST", async () => {
  const [api, server] = await Promise.all([read("../src/lib/api.js"), read("../../backend/src/routes/admin.js")]);
  const call = api.match(/markOrderUntracked: \(id\) => api\.post\(`\/admin\/orders\/\$\{id\}\/([a-z-]+)`\)/);
  assert.ok(call, "markOrderUntracked posts to /admin/orders/:id/<action>");
  assert.match(server, new RegExp(`router\\.post\\('/orders/:id/${call[1]}'`), "the server has that exact POST route");
});

test("the button is offered only for a shipped order that carries a number, and the order is read again afterwards", async () => {
  const actions = await read("../src/components/admin/OrderActions.jsx");
  const deliver = actions.slice(actions.indexOf("step.key === 'deliver'"), actions.indexOf("step.key === 'unpaid'"));
  const withNumber = deliver.slice(deliver.indexOf("tracked ? ("), deliver.indexOf(") : ("));
  const withoutNumber = deliver.slice(deliver.indexOf(") : ("));
  assert.match(withNumber, /testId="order-untrack"/);
  assert.doesNotMatch(withoutNumber, /order-untrack/, "an order without a number has nothing to remove");
  const handler = actions.slice(actions.indexOf("const removeTracking"), actions.indexOf("const cancelButton"));
  assert.match(handler, /adminApi\.markOrderUntracked\(order\._id\)[\s\S]*?await onChanged\(data\.order\)/);
  assert.doesNotMatch(handler, /setOrder\(/, "the answer is a plain order without the shipping panel, so the page reads it again");
});
