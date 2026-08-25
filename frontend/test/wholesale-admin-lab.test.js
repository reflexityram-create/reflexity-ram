import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WHOLESALE_DEMO_SCHEMA_VERSION,
  WHOLESALE_DEMO_STORAGE_KEY,
  mergeWholesaleDemoExamples,
  publishedWholesaleDemoLots,
  readWholesaleDemoState,
  removeWholesaleDemoLot,
  restoreWholesaleDemoExamples,
  sanitizeWholesaleDemoLot,
  upsertWholesaleDemoLot,
  validateWholesaleDemoLot,
  writeWholesaleDemoLots,
} from "../src/lib/wholesaleDemoStore.js";

function fakeStorage(initial = new Map()) {
  const values = new Map(initial);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    snapshot() { return new Map(values); },
  };
}

const completeLot = {
  id: "demo-lot-test-a",
  status: "draft",
  title: "Example OEM 32GB DDR4 ECC RDIMM",
  brand: "Example OEM",
  mpn: "DEMO-TEST-A",
  generation: "DDR4",
  formFactor: "RDIMM",
  capacityLabel: "32GB",
  speedLabel: "3200 MT/s",
  rank: "2Rx4",
  condition: "Server Pull — Tested",
  testStatus: "MemTest verified",
  warranty: "90 Days",
  quantityAvailable: 20,
  minimumOrderQuantity: 4,
  orderIncrement: 2,
  shipFrom: "Toronto, Canada",
};

test("missing local state seeds two published examples and one private draft", () => {
  const storage = fakeStorage();
  const state = readWholesaleDemoState(storage);
  assert.equal(state.error, null);
  assert.equal(state.seeded, true);
  assert.equal(state.lots.length, 3);
  assert.equal(publishedWholesaleDemoLots(state.lots).length, 2);
  assert.ok(state.lots.every((lot) => lot.isDemo && lot.visibility === "local-demo" && lot.quoteOnly));

  const persisted = JSON.parse(storage.getItem?.(WHOLESALE_DEMO_STORAGE_KEY)
    || storage.snapshot().get(WHOLESALE_DEMO_STORAGE_KEY));
  assert.equal(persisted.schemaVersion, WHOLESALE_DEMO_SCHEMA_VERSION);
});

test("invalid or unsupported local state fails closed with no customer-visible lots", () => {
  const invalid = fakeStorage([[WHOLESALE_DEMO_STORAGE_KEY, "not-json"]]);
  const wrongVersion = fakeStorage([[WHOLESALE_DEMO_STORAGE_KEY, JSON.stringify({ schemaVersion: 99, lots: [completeLot] })]]);
  for (const storage of [invalid, wrongVersion]) {
    const state = readWholesaleDemoState(storage);
    assert.deepEqual(state.lots, []);
    assert.match(state.error, /could not be read/i);
    assert.deepEqual(publishedWholesaleDemoLots(state.lots), []);
  }
});

test("valid-schema but incomplete published data remains hidden from customers", () => {
  const storage = fakeStorage([[WHOLESALE_DEMO_STORAGE_KEY, JSON.stringify({
    schemaVersion: WHOLESALE_DEMO_SCHEMA_VERSION,
    lots: [{
      id: "demo-lot-tampered",
      status: "published",
      quantityAvailable: 12,
      minimumOrderQuantity: 4,
    }],
  })]]);
  const state = readWholesaleDemoState(storage);
  assert.equal(state.error, null);
  assert.equal(state.lots.length, 1);
  assert.deepEqual(publishedWholesaleDemoLots(state.lots), []);
});

test("the demo sanitizer strips retail fields and forces local quote-only identity", () => {
  const lot = sanitizeWholesaleDemoLot({
    ...completeLot,
    price: 99,
    stockQuantity: 500,
    stripePriceId: "price_forbidden",
    visibility: "public",
    isDemo: false,
    quoteOnly: false,
  });
  assert.equal(lot.visibility, "local-demo");
  assert.equal(lot.isDemo, true);
  assert.equal(lot.quoteOnly, true);
  assert.equal("price" in lot, false);
  assert.equal("stockQuantity" in lot, false);
  assert.equal("stripePriceId" in lot, false);
});

test("publishing rejects incomplete, zero-quantity, and below-MOQ lots", () => {
  assert.match(validateWholesaleDemoLot({ ...completeLot, title: "" }, { forPublish: true }).join(" "), /title/i);
  assert.match(validateWholesaleDemoLot({ ...completeLot, quantityAvailable: 0 }, { forPublish: true }).join(" "), /minimum order/i);
  assert.match(validateWholesaleDemoLot({ ...completeLot, quantityAvailable: 3, minimumOrderQuantity: 4 }, { forPublish: true }).join(" "), /minimum order/i);
  assert.deepEqual(validateWholesaleDemoLot(completeLot, { forPublish: true }), []);
});

test("exact upsert, publish visibility, round-trip, and removal remain provider-separated", () => {
  const storage = fakeStorage();
  const initial = readWholesaleDemoState(storage).lots;
  const published = sanitizeWholesaleDemoLot({ ...completeLot, status: "published" });
  const withNew = upsertWholesaleDemoLot(initial, published);
  assert.equal(withNew[0].id, completeLot.id);
  assert.equal(publishedWholesaleDemoLots(withNew).length, 3);

  writeWholesaleDemoLots(withNew, storage);
  const roundTrip = readWholesaleDemoState(storage).lots;
  assert.equal(roundTrip.find((lot) => lot.id === completeLot.id)?.status, "published");
  assert.equal(removeWholesaleDemoLot(roundTrip, completeLot.id).some((lot) => lot.id === completeLot.id), false);
});

test("a failed browser-local write cannot replace the previous serialized state", () => {
  const original = JSON.stringify({ schemaVersion: 1, lots: [sanitizeWholesaleDemoLot(completeLot)] });
  const storage = {
    getItem() { return original; },
    setItem() { throw new Error("quota exceeded"); },
  };
  assert.throws(() => writeWholesaleDemoLots([], storage), /quota exceeded/);
  assert.equal(storage.getItem(WHOLESALE_DEMO_STORAGE_KEY), original);
});

test("restoring examples replaces only seeded IDs and preserves custom lots", () => {
  const storage = fakeStorage();
  const seeded = readWholesaleDemoState(storage).lots;
  const custom = sanitizeWholesaleDemoLot({ ...completeLot, id: "demo-lot-owner-custom" });
  writeWholesaleDemoLots([custom, { ...seeded[0], title: "Changed example" }], storage);

  const merged = mergeWholesaleDemoExamples(readWholesaleDemoState(storage).lots);
  assert.equal(merged.find((lot) => lot.id === seeded[0].id)?.title, seeded[0].title);
  assert.equal(merged.some((lot) => lot.id === custom.id), true);

  const restored = restoreWholesaleDemoExamples(storage);
  assert.equal(restored.length, 4);
  assert.equal(restored.some((lot) => lot.id === custom.id), true);
});

test("both local views are development-only and contain no retail or production mutation path", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../src/pages/WholesaleAdminLab.jsx", import.meta.url), "utf8");
  const customer = await readFile(new URL("../src/pages/WholesaleLab.jsx", import.meta.url), "utf8");
  const adminCss = await readFile(new URL("../src/pages/wholesale-admin-lab.css", import.meta.url), "utf8");

  assert.match(app, /const WholesaleAdminLab = import\.meta\.env\.DEV/);
  assert.match(app, /path="\/wholesale-admin-lab"/);
  assert.match(customer, /postedLots=\{error \? \[\] : publishedWholesaleDemoLots\(lots\)\}/);
  assert.match(admin, /LOCAL ADMIN STUDIO · BROWSER-LOCAL ONLY/);
  assert.match(admin, /Open combined wholesale preview/);
  assert.match(admin, /target="_blank" to="\/wholesale"/);
  assert.match(admin, /storageError && <div className="wla-error" role="alert">/);
  assert.doesNotMatch(admin, /storageError \|\| formError/);
  for (const source of [admin, customer]) {
    assert.doesNotMatch(source, /productsApi|adminApi|\/api\/products|stockQuantity|cartApi|checkoutApi|stripePrice/i);
  }
  assert.match(adminCss, /var\(--brand-yellow\)/);
  assert.doesNotMatch(adminCss, /#b4eb62|--wl-green/i);
});
