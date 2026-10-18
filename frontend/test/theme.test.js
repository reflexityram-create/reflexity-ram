import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const bootstrap = await readFile(new URL("../public/theme-bootstrap.js", import.meta.url), "utf8");
function paint(saved, dark, blocked = false) {
  const classes = new Set();
  let chrome;
  vm.runInNewContext(bootstrap, {
    localStorage: { getItem() { if (blocked) throw Error("blocked"); return saved; } },
    window: { matchMedia: () => ({ matches: dark }) },
    document: {
      documentElement: { classList: { add: x => classes.add(x), remove: (...xs) => xs.forEach(x => classes.delete(x)) } },
      querySelector: () => ({ setAttribute: (_, value) => { chrome = value; } }),
    },
  });
  return { theme: [...classes][0], chrome };
}
test("first visit follows phone theme before React loads", () => {
  assert.deepEqual(paint(null, true), { theme: "dark", chrome: "#050505" });
  assert.equal(paint(null, false).theme, "light");
});
test("returning visitors retain either existing explicit choice", () => {
  for (const theme of ["light", "dark"]) {
    assert.equal(paint(JSON.stringify({ state: { theme }, version: 0 }), theme !== "dark").theme, theme);
  }
});
test("invalid or unavailable storage falls back to phone theme", () => {
  for (const saved of ["bad json", '{"state":{"theme":"invalid"}}', '{"state":{"theme":"system"}}']) {
    assert.equal(paint(saved, true).theme, "dark");
  }
  assert.equal(paint(null, true, true).theme, "dark");
});
