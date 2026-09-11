import assert from "node:assert/strict";
import test from "node:test";
import { shouldTrackLocation, trackEvent } from "../src/lib/analytics.js";

test("analytics tracks public canonical B2B pages and excludes administrative paths", () => {
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/inventory")), true);
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/contact?intent=buy")), true);
  assert.equal(shouldTrackLocation(new URL("https://reflexityram.com/admin/orders")), false);
  assert.equal(shouldTrackLocation(new URL("https://www.reflexityram.com/inventory")), false);
});

test("lead analytics emits only valid event names on the canonical site", () => {
  const originalLocation = globalThis.location; const originalGtag = globalThis.gtag; const calls = [];
  globalThis.location = new URL("https://reflexityram.com/contact"); globalThis.gtag = (...args) => calls.push(args);
  try { assert.equal(trackEvent("generate_lead", { lead_type: "buy" }), true); assert.equal(trackEvent("bad event", {}), false); assert.deepEqual(calls, [["event", "generate_lead", { lead_type: "buy" }]]); } finally { globalThis.location = originalLocation; globalThis.gtag = originalGtag; }
});
