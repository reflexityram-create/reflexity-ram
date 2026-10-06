// Findings of the 2026-10-06 audit of the live site (axe-core + a headless Chrome at four widths): light-mode contrast, heading order, tap targets on phones,
// and page descriptions. Each check fails against the code as it was.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("the muted greys used in light mode meet WCAG AA (4.5:1) on every light surface, and keep their order", async () => {
  const css = await read("../src/index.css");
  const grab = (selector) => {
    const match = css.match(new RegExp(`html\\.light ${selector}\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `${selector} is defined for light mode`);
    return match[1];
  };
  const c500 = grab("\\.text-neutral-500");
  const c700 = css.match(/html\.light \.text-neutral-600,\s*html\.light \.text-neutral-700\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/)[1];
  for (const surface of ["#fafaf7", "#ffffff", "#f1f1ec", "#ebebe5"]) {
    assert.ok(contrast(c500, surface) >= 4.5, `neutral-500 ${c500} on ${surface}: ${contrast(c500, surface).toFixed(2)}`);
    assert.ok(contrast(c700, surface) >= 4.5, `neutral-600/700 ${c700} on ${surface}: ${contrast(c700, surface).toFixed(2)}`);
  }
  assert.ok(luminance(c500) <= luminance(c700), "the 500 grey stays at least as dark as the 600/700 one");
  assert.ok(contrast("#8a8a92", "#fafaf7") < 4.5, "control: the old value failed (3.3:1), so this test can fail");
});

test("the cart's headings follow the page's h1 instead of skipping a level, with items and when empty", async () => {
  const [cart, empty] = await Promise.all([read("../src/pages/Cart.jsx"), read("../src/components/EmptyState.jsx")]);
  assert.match(cart, /<h2 className="font-semibold tracking-tight mb-5">Order summary<\/h2>/);
  assert.doesNotMatch(cart, /<h3/);
  // the empty-cart message is a shared component whose heading was always an h3 (axe heading-order on /cart with no items)
  assert.match(cart, /testId="cart-empty"\s+as="h2"/);
  assert.match(empty, /as: Heading = "h3"/, "every other screen keeps the h3 it had");
  assert.match(empty, /<Heading className="text-xl font-semibold tracking-tight mb-2">\{title\}<\/Heading>/);
  // the same message on the shop (error / no products) sits under the page's h1; the product "not found" page has no other heading at all
  const [shop, product] = await Promise.all([read("../src/pages/Shop.jsx"), read("../src/pages/Product.jsx")]);
  assert.match(shop, /testId="shop-error-state"\s+as="h2"/);
  assert.match(shop, /testId="shop-empty-state"\s+as="h2"/);
  assert.match(product, /secondaryTo="\/support"\s+as="h1"/);
});

test("phones get a comfortable hit area on the header logo, the back links and the footer lists", async () => {
  const [css, header, footer, product, shop, guides] = await Promise.all([
    read("../src/index.css"), read("../src/components/Header.jsx"), read("../src/components/Footer.jsx"),
    read("../src/pages/Product.jsx"), read("../src/pages/Shop.jsx"), read("../src/pages/Guides.jsx"),
  ]);
  assert.match(css, /@media \(max-width: 767px\) \{[^}]*\.tap-min \{ min-height: 40px; \}[\s\S]*?\.tap-target \{[^}]*min-height: 40px;[\s\S]*?\.tap-list > a \{[^}]*min-height: 40px;/);
  assert.match(header, /className="tap-min flex items-center gap-3 shrink-0 mr-8"\s+data-testid="header-logo-link"/);
  assert.match(footer, /className="tap-list flex flex-col gap-2\.5 text-\[13px\]"/);
  assert.match(product, /className="tap-target inline-flex[^"]*"\s+data-testid="product-back-link"/);
  assert.match(shop, /className="tap-target inline-flex[^"]*"\s+data-testid="shop-back-to-categories"/);
  assert.match(guides, /<Link to="\/guides" className="tap-target inline-flex/);
  assert.doesNotMatch(css, /@media \(min-width[^)]*\)\s*\{[^}]*\.tap-/, "desktop is untouched");
});

test("/shop has one real description, the same in the page and in the HTML the edge serves", async () => {
  const [shop, edge] = await Promise.all([read("../src/pages/Shop.jsx"), read("../functions-shared/staticMetadata.js")]);
  const titleInPage = shop.match(/useSEO\(\{\s*title: "([^"]+)"/)[1];
  const titleInEdge = edge.match(/"\/shop": \{\s*title: "([^"]+)"/)[1];
  assert.equal(titleInPage, titleInEdge, "the rendered page must not replace the edge's title with a weaker one");
  const inPage = shop.match(/useSEO\(\{[^}]*description: "([^"]+)"/)[1];
  const inEdge = edge.match(/"\/shop": \{[^}]*description: "([^"]+)"/)[1];
  assert.equal(inPage, inEdge);
  assert.ok(inPage.length >= 100 && inPage.length <= 175, `${inPage.length}`);        // it was 40 characters in the rendered page
  assert.match(inPage, /DDR4/);
});

test("the account page has its own title instead of inheriting the home page's", async () => {
  const account = await read("../src/pages/Account.jsx");
  assert.match(account, /import \{ useSEO \} from '@\/lib\/seo';/);
  assert.match(account, /export default function Account\(\) \{\s+useSEO\(\{ title: 'Your account'/);
});
