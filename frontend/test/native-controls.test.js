// Dark mode: the dropdown list of a <select> (admin products, orders, wholesale) was drawn browser-light, so light text sat on a white list.
// Native controls now follow the theme (color-scheme) and the options take the theme's own surface and text.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block exists`);
  return css.slice(start, css.indexOf("\n}", start));
};
const token = (selector, name) => block(selector).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("native controls follow the theme: dark by default, light under html.light", () => {
  assert.match(block(":root"), /color-scheme:\s*dark;/);
  assert.match(block("html.light"), /color-scheme:\s*light;/);
});

test("the options of a select use the theme's surface and text, and both themes read at WCAG AA", () => {
  assert.match(css, /select option,\s*select optgroup\s*\{\s*background-color:\s*var\(--bg-elev\);\s*color:\s*var\(--fg\);\s*\}/);
  for (const [selector, scheme] of [[":root", "dark"], ["html.light", "light"]]) {
    const surface = token(selector, "--bg-elev"), text = token(selector, "--fg");
    assert.ok(surface && text, `${scheme}: --bg-elev and --fg are plain hex colours`);
    assert.ok(contrast(surface, text) >= 4.5, `${scheme}: ${text} on ${surface} is ${contrast(surface, text).toFixed(2)}:1`);
  }
  assert.ok(luminance(token(":root", "--bg-elev")) < 0.1, "the dark list surface is dark, not whitish");
});
