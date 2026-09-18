// A page that renders an undefined module constant throws at render time and
// React unmounts the whole tree — the admin sees a white screen, not an error.
// Vite never catches it: `STATUS_OPTIONS` shipped undefined in Orders.jsx and
// the Orders page was blank in production until 2026-09-18.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SRC = new URL("../src/", import.meta.url).pathname;
// Screaming-snake identifiers only (they must contain an underscore), so
// uppercase words inside JSX text are not mistaken for identifiers.
const IDENTIFIER = /(?<![.\w$])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

function withoutStringsAndComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

async function jsxFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsxFiles(full)));
    else if (entry.name.endsWith(".jsx")) found.push(full);
  }
  return found;
}

test("every module constant a page renders is declared or imported", async () => {
  const files = await jsxFiles(SRC);
  assert.ok(files.length > 20, "expected to scan the storefront and admin pages");

  const undefinedRefs = [];
  for (const file of files) {
    const source = withoutStringsAndComments(await readFile(file, "utf8"));
    const declared = new Set(
      [...source.matchAll(/\b(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]+)\b/g)].map((m) => m[1])
    );
    for (const statement of source.matchAll(/\bimport\s+[\w*\s{},]+\s+from/g)) {
      for (const name of statement[0].matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)) declared.add(name[1]);
    }
    for (const used of source.matchAll(IDENTIFIER)) {
      if (!declared.has(used[1])) undefinedRefs.push(`${path.relative(SRC, file)}: ${used[1]}`);
    }
  }

  assert.deepEqual(undefinedRefs, []);
});
