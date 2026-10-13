import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

let viteServer;

async function loadProductModule() {
  viteServer ??= await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  return viteServer.ssrLoadModule("/src/pages/Product.jsx");
}

test("stored product copy is readable as paragraphs and remains text instead of executable markup", async (t) => {
  t.after(async () => viteServer?.close());
  const { ProductDescription } = await loadProductModule();
  const storedDescription = [
    "Buy direct from Reflexity RAM and save CAD50 per module: CAD299 here vs CAD349 on our eBay listing. Item prices checked 13 Oct 2026; shipping and taxes excluded.",
    "Samsung M393A4G43AB3-CWE 32GB DDR4-3200 ECC RDIMM, one module per purchase.",
    "Open Box — Tested. 30-day warranty. RDIMM only; confirm server compatibility before ordering.",
  ].join("\n\n");
  const unsafeDescription = `${storedDescription}\n\n<img src=x onerror=alert(1)>`;
  const markup = renderToStaticMarkup(createElement(ProductDescription, { description: unsafeDescription }));

  assert.match(markup, /Buy direct from Reflexity RAM and save CAD50 per module/);
  assert.match(markup, /Samsung M393A4G43AB3-CWE 32GB DDR4-3200 ECC RDIMM/);
  assert.match(markup, /30-day warranty\. RDIMM only/);
  assert.equal((markup.match(/<p/g) || []).length, 4, "blank lines create readable paragraphs");
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/, "stored HTML is rendered as text");
  assert.doesNotMatch(markup, /<img\s+src=x/, "stored HTML never becomes an element");
  assert.equal(renderToStaticMarkup(createElement(ProductDescription, { description: "   " })), "", "missing copy leaves no empty space");
});
