import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { subscribeSystemTheme, systemTheme } from "../src/lib/systemTheme.js";
import { THEME_COLOR } from "../src/lib/themeColors.js";

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
  assert.deepEqual(paint(null, true), { theme: "dark", chrome: THEME_COLOR.dark });
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

function paintWith(windowStub, saved = null) {
  const classes = new Set();
  vm.runInNewContext(bootstrap, {
    localStorage: { getItem: () => saved },
    window: windowStub,
    document: {
      documentElement: { classList: { add: x => classes.add(x), remove: (...xs) => xs.forEach(x => classes.delete(x)) } },
      querySelector: () => ({ setAttribute() {} }),
    },
  });
  return [...classes][0];
}
function withWindow(stub, run) {
  const had = "window" in globalThis;
  const previous = globalThis.window;
  globalThis.window = stub;
  try { return run(); } finally { if (had) globalThis.window = previous; else delete globalThis.window; }
}

test("a browser with no media queries, or whose matchMedia throws, still gets a theme before first paint", () => {
  assert.equal(paintWith({}), "light");
  assert.equal(paintWith({ matchMedia() { throw new Error("blocked"); } }), "light");
  assert.equal(paintWith({}, JSON.stringify({ state: { theme: "dark" } })), "dark");
});

test("the phone's appearance resolves to light when matchMedia is missing or throws", () => {
  assert.equal(withWindow({}, () => systemTheme()), "light");
  assert.equal(withWindow({ matchMedia() { throw new Error("blocked"); } }, () => systemTheme()), "light");
  assert.equal(withWindow({ matchMedia: () => ({ matches: true }) }, () => systemTheme()), "dark");
});

test("subscribing to the phone's appearance never throws, whatever the browser offers", () => {
  assert.equal(typeof withWindow({}, () => subscribeSystemTheme(() => {})), "function");
  const notify = () => {};
  const events = [];
  const modern = { matchMedia: () => ({ addEventListener: (type, fn) => events.push(["add", type, fn]), removeEventListener: (type, fn) => events.push(["remove", type, fn]) }) };
  withWindow(modern, () => subscribeSystemTheme(notify))();
  assert.deepEqual(events, [["add", "change", notify], ["remove", "change", notify]]);
  // Safari before 14 has addListener/removeListener on a MediaQueryList and no addEventListener.
  const legacyEvents = [];
  const legacy = { matchMedia: () => ({ addListener: fn => legacyEvents.push(["add", fn]), removeListener: fn => legacyEvents.push(["remove", fn]) }) };
  withWindow(legacy, () => subscribeSystemTheme(notify))();
  assert.deepEqual(legacyEvents, [["add", notify], ["remove", notify]]);
});

test("the browser chrome colour is the page background of the active theme", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const dark = css.match(/:root\s*\{[^}]*?--bg:\s*(#[0-9a-fA-F]{6})/)?.[1].toLowerCase();
  const light = css.match(/html\.light\s*\{[^}]*?--bg:\s*(#[0-9a-fA-F]{6})/)?.[1].toLowerCase();
  assert.ok(dark && light, "both themes define --bg");
  assert.equal(paint(null, true).chrome, dark, "bootstrap, dark");
  assert.equal(paint(null, false).chrome, light, "bootstrap, light");
  assert.deepEqual({ ...THEME_COLOR }, { light, dark }, "theme.jsx colours");
  assert.equal(indexHtml.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/)?.[1].toLowerCase(), light, "index.html default");
});

test("the theme toggle states its action in its name and does not also claim a pressed state", async () => {
  const source = await readFile(new URL("../src/components/ThemeToggle.jsx", import.meta.url), "utf8");
  // The name already says which theme is active and what a press does ("Theme: dark. Switch to light mode"). With aria-pressed as well,
  // screen readers announce "Switch to light mode, pressed", which reads as the opposite of what happens.
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /Switch to \$\{isDark \? "light" : "dark"\} mode/);
  assert.doesNotMatch(source, /aria-pressed/);
});
