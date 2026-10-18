import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const bootstrap = readFileSync(new URL("../public/analytics-bootstrap.js", import.meta.url), "utf8");

function run(url, stored = {}) {
  const values = new Map(Object.entries(stored));
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const calls = [];
  const window = { location: new URL(url), localStorage: storage, sessionStorage: storage, gtag: (...args) => calls.push(args) };
  const document = { createElement: () => ({}), head: { appendChild() {} } };
  vm.runInNewContext(bootstrap, { window, document, URLSearchParams, Date });
  return calls.find(args => args[0] === "config")?.[2];
}

test("tagged arrivals configure GA campaign attribution despite query-free page locations", () => {
  const config = run("https://reflexityram.com/shop/example?utm_source=repair_shops&utm_medium=referral&utm_campaign=buyer_outreach&utm_term=ddr4&utm_content=mpn_link");
  assert.equal(config.send_page_view, false);
  assert.equal(config.campaign_source, "repair_shops");
  assert.equal(config.campaign_medium, "referral");
  assert.equal(config.campaign_name, "buyer_outreach");
  assert.equal(config.campaign_term, "ddr4");
  assert.equal(config.campaign_content, "mpn_link");
});

test("campaign configuration rejects private or malformed values and respects exclusion gates", () => {
  const url = "https://reflexityram.com/?utm_source=buyer%40example.com&utm_medium=referral&utm_campaign=" + "x".repeat(101);
  const config = run(url);
  assert.equal(config.campaign_source, undefined);
  assert.equal(config.campaign_name, undefined);
  assert.equal(config.campaign_medium, "referral");
  assert.equal(run(url + "&qa=check"), undefined);
  assert.equal(run(url, { reflexity_analytics_owner: "1" }), undefined);
  assert.equal(run("https://reflexityram.com/admin?utm_source=repair_shops"), undefined);
  assert.equal(run("https://preview.pages.dev/?utm_source=repair_shops"), undefined);
});
