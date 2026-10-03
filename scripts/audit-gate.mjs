#!/usr/bin/env node
// Dependency-audit gate for CI. Fails on any high or critical npm advisory unless that advisory is listed in
// .github/audit-allowlist.json with a reason and a future expiry. An expired or unlisted advisory fails the build,
// so an exception can never become permanent by accident. Fails closed when npm cannot produce an audit report.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);
const DIRECTORIES = [".", "frontend", "backend"];
const ALLOWLIST_PATH = new URL("../.github/audit-allowlist.json", import.meta.url);

export function advisoryId(url = "") {
  const match = String(url).match(/GHSA(?:-[a-z0-9]{4}){3}/i);
  return match ? match[0].toLowerCase() : "";
}

export function collectAdvisories(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (typeof via !== "object" || !via) continue;
      const id = advisoryId(via.url) || `npm-${via.source}`;
      found.set(id, { id, name: via.name, severity: via.severity, title: via.title || "", url: via.url || "" });
    }
  }
  return [...found.values()];
}

// Returns { blocking: [...], allowed: [...] } for one audit report.
export function evaluateAudit(report, allowlist, now = new Date()) {
  const entries = new Map();
  for (const entry of allowlist?.entries || []) {
    if (!entry?.id || !entry.reason || !entry.expires) continue; // an entry without a reason or expiry grants nothing
    entries.set(String(entry.id).toLowerCase(), entry);
  }
  const blocking = [];
  const allowed = [];
  for (const advisory of collectAdvisories(report)) {
    if (!BLOCKING.has(advisory.severity)) continue;
    const entry = entries.get(advisory.id);
    if (!entry) { blocking.push({ ...advisory, why: "not on the allowlist" }); continue; }
    if (entry.package && advisory.name && entry.package !== advisory.name) { blocking.push({ ...advisory, why: `allowlist entry is for ${entry.package}` }); continue; }
    if (!(new Date(`${entry.expires}T23:59:59Z`) > now)) { blocking.push({ ...advisory, why: `allowlist entry expired ${entry.expires}` }); continue; }
    allowed.push({ ...advisory, expires: entry.expires });
  }
  return { blocking, allowed };
}

function auditReport(directory) {
  let stdout;
  try {
    stdout = execFileSync("npm", ["audit", "--json"], { cwd: new URL(`../${directory === "." ? "" : directory}`, import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    stdout = error.stdout; // npm exits 1 whenever it finds anything
  }
  try {
    const report = JSON.parse(stdout);
    if (report.error || !report.vulnerabilities) throw new Error(report.error?.summary || "no vulnerabilities section");
    return report;
  } catch (error) {
    throw new Error(`npm audit produced no usable report in ${directory}: ${error.message}`);
  }
}

function main() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  let failed = false;
  for (const directory of DIRECTORIES) {
    const { blocking, allowed } = evaluateAudit(auditReport(directory), allowlist);
    for (const item of allowed) console.log(`[audit-gate] ${directory}: allowed ${item.id} (${item.name}, ${item.severity}) until ${item.expires}`);
    for (const item of blocking) { failed = true; console.error(`[audit-gate] ${directory}: BLOCKED ${item.id} ${item.name} ${item.severity}: ${item.title} (${item.why}) ${item.url}`); }
    if (!blocking.length) console.log(`[audit-gate] ${directory}: no blocking advisories`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`[audit-gate] ${error.message}`); process.exit(1); }
}
