// CI's dependency audit may only wave through high/critical advisories that are on the allowlist with a
// reason and an unexpired date. Anything else, or any expired entry, must fail the build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advisoryId, collectAdvisories, evaluateAudit } from "../../scripts/audit-gate.mjs";

const BRACES_URL = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const report = (...vias) => ({
  vulnerabilities: {
    pkg: { name: "pkg", severity: "high", via: vias },
    parent: { name: "parent", severity: "high", via: ["pkg"] },
  },
});
const advisory = (overrides = {}) => ({ source: 1, name: "braces", severity: "high", title: "ReDoS", url: BRACES_URL, ...overrides });
const entry = (overrides = {}) => ({ id: "GHSA-vfj7-8cjw-p6xm", package: "braces", expires: "2026-11-03", reason: "dev tooling only", ...overrides });
const NOW = new Date("2026-10-03T12:00:00Z");

test("advisory ids are read from the GitHub advisory URL, string via entries are ignored", () => {
  assert.equal(advisoryId(BRACES_URL), "ghsa-vfj7-8cjw-p6xm");
  assert.equal(advisoryId("https://example.test/nothing"), "");
  assert.deepEqual(collectAdvisories(report(advisory(), "chokidar")).map((item) => item.id), ["ghsa-vfj7-8cjw-p6xm"]);
});

test("a listed, unexpired advisory is allowed and nothing else is blocked", () => {
  const result = evaluateAudit(report(advisory()), { entries: [entry()] }, NOW);
  assert.deepEqual(result.blocking, []);
  assert.equal(result.allowed.length, 1);
  assert.equal(result.allowed[0].expires, "2026-11-03");
});

test("an advisory that is not on the allowlist blocks, including with an empty allowlist", () => {
  const other = advisory({ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", name: "other-pkg" });
  const result = evaluateAudit(report(advisory(), other), { entries: [entry()] }, NOW);
  assert.deepEqual(result.blocking.map((item) => item.name), ["other-pkg"]);
  assert.equal(evaluateAudit(report(advisory()), { entries: [] }, NOW).blocking.length, 1);
  assert.equal(evaluateAudit(report(advisory()), undefined, NOW).blocking.length, 1);
});

test("an expired allowlist entry blocks again (the exception cannot become permanent)", () => {
  const result = evaluateAudit(report(advisory()), { entries: [entry()] }, new Date("2026-11-04T00:00:00Z"));
  assert.equal(result.blocking.length, 1);
  assert.match(result.blocking[0].why, /expired 2026-11-03/);
  // The last day itself still counts.
  assert.equal(evaluateAudit(report(advisory()), { entries: [entry()] }, new Date("2026-11-03T20:00:00Z")).blocking.length, 0);
});

test("an entry without a reason or an expiry grants nothing, and it must match the package", () => {
  assert.equal(evaluateAudit(report(advisory()), { entries: [entry({ reason: "" })] }, NOW).blocking.length, 1);
  assert.equal(evaluateAudit(report(advisory()), { entries: [entry({ expires: undefined })] }, NOW).blocking.length, 1);
  const wrongPackage = evaluateAudit(report(advisory()), { entries: [entry({ package: "something-else" })] }, NOW);
  assert.match(wrongPackage.blocking[0].why, /allowlist entry is for something-else/);
});

test("moderate and low advisories never block, critical ones do", () => {
  assert.equal(evaluateAudit(report(advisory({ severity: "moderate" })), { entries: [] }, NOW).blocking.length, 0);
  assert.equal(evaluateAudit(report(advisory({ severity: "low" })), { entries: [] }, NOW).blocking.length, 0);
  assert.equal(evaluateAudit(report(advisory({ severity: "critical" })), { entries: [] }, NOW).blocking.length, 1);
});

test("the shipped allowlist entry carries a reason and an expiry", () => {
  const file = JSON.parse(readFileSync(new URL("../../.github/audit-allowlist.json", import.meta.url), "utf8"));
  assert.equal(file.entries.length, 1);
  assert.equal(file.entries[0].id, "GHSA-vfj7-8cjw-p6xm");
  assert.match(file.entries[0].expires, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(file.entries[0].reason.length > 40);
});
