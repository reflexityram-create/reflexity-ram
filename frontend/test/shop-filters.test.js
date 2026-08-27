import assert from "node:assert/strict";
import test from "node:test";
import {
  productMatchesShopFilters,
  readShopFilters,
  setShopFilterParam,
  toggleShopFilterParam,
} from "../src/lib/shopFilters.js";

const products = [
  {
    sku: "ECC-16",
    name: "Server ECC 16GB",
    line: "Server",
    generation: "DDR4",
    formFactor: "RDIMM",
    capacity: 16,
    capacityLabel: "16GB",
    condition: "New",
    ecc: true,
  },
  {
    sku: "ECC-64",
    name: "Server ECC 64GB",
    line: "Server",
    generation: "DDR4",
    formFactor: "LRDIMM",
    capacity: 64,
    capacityLabel: "64GB",
    condition: "Used",
    ecc: true,
  },
  {
    sku: "DESKTOP-16",
    name: "Desktop 16GB",
    line: "Desktop",
    generation: "DDR4",
    formFactor: "UDIMM",
    capacity: 16,
    capacityLabel: "16GB",
    condition: "Used",
    ecc: false,
  },
];

test("combined ECC, capacity, form factor, and line filters narrow the catalog", () => {
  const params = new URLSearchParams("ecc=true&cap=64&form=LRDIMM&line=Server");
  const filters = readShopFilters(params);

  assert.deepEqual(
    products.filter((product) => productMatchesShopFilters(product, filters)).map(({ sku }) => sku),
    ["ECC-64"],
  );
});

test("ECC-only excludes truthy non-boolean values and non-ECC products", () => {
  const filters = readShopFilters(new URLSearchParams("ecc=true"));
  assert.equal(productMatchesShopFilters(products[0], filters), true);
  assert.equal(productMatchesShopFilters(products[2], filters), false);
  assert.equal(productMatchesShopFilters({ ...products[2], ecc: "true" }, filters), false);
});

test("consecutive filter changes preserve earlier selections", () => {
  let params = new URLSearchParams("line=Server");
  params = toggleShopFilterParam(params, "form", "RDIMM");
  params = toggleShopFilterParam(params, "cap", 16);
  params = setShopFilterParam(params, "ecc", "true");

  assert.equal(params.toString(), "line=Server&form=RDIMM&cap=16&ecc=true");
  assert.deepEqual(readShopFilters(params), {
    query: "",
    generations: [],
    formFactors: ["RDIMM"],
    lines: ["Server"],
    capacities: [16],
    conditions: [],
    eccOnly: true,
    sort: "featured",
  });
});

test("toggling one repeated filter leaves unrelated selections intact", () => {
  const params = toggleShopFilterParam(
    new URLSearchParams("gen=DDR4&form=RDIMM&form=LRDIMM&ecc=true"),
    "form",
    "RDIMM",
  );

  assert.deepEqual(params.getAll("form"), ["LRDIMM"]);
  assert.equal(params.get("gen"), "DDR4");
  assert.equal(params.get("ecc"), "true");
});
