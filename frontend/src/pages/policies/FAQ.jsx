import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>Can't find what you're looking for? Email reflexityram@gmail.com — we're happy to help.</p>
<h2>Compatibility</h2>
<h3>Will this RAM work in my motherboard?</h3>
<p>Every product page lists known-compatible platforms. For DDR5 above 6000 MT/s, always cross-reference your motherboard's official QVL — compatibility is board-and-CPU-dependent at high speeds.</p>
<h3>Can I mix kits?</h3>
<p>We don't recommend mixing different kits even if specs match. Even modules from the same SKU pulled separately can have different binning. For best stability, buy a single kit at the capacity you need.</p>
<h3>Will DDR5-6000 boot if my CPU is rated for DDR5-4800?</h3>
<p>Yes. All EXPO/XMP kits boot at the JEDEC base speed without the profile enabled. You enable the rated speed in BIOS.</p>
<h2>Orders &amp; shipping</h2>
<h3>How fast do orders ship?</h3>
<p>Orders are typically processed within 1–2 business days after purchase. Exact timing depends on inventory and order type.</p>
<h3>Do you ship internationally?</h3>
<p>International shipping availability may vary by region. Any duties, taxes, or import fees are the responsibility of the customer.</p>
<h3>Can I change my order after placing it?</h3>
<p>Contact us as soon as possible after placing your order and we'll do our best to help. After dispatch, you'll need to return and re-order.</p>
<h2>Returns &amp; warranty</h2>
<h3>What if my module is dead on arrival?</h3>
<p>Contact reflexityram@gmail.com with your order details and a description of the issue. We'll help troubleshoot and work toward a resolution.</p>
<h3>How long is the warranty?</h3>
<p>Warranty coverage varies by product and condition. Details are listed on each product page.</p>
<h3>Does overclocking void the warranty?</h3>
<p>Running modules at their rated XMP/EXPO speed is generally covered. Damage from improper installation, unsupported voltage, or extreme overclocking is not covered.</p>
<h2>Wholesale</h2>
<h3>Do you offer wholesale pricing?</h3>
<p>Yes — we work with bulk orders. Email reflexityram@gmail.com with the SKUs and quantities you need and we'll provide a quote.</p>
<h3>Can you source SKUs not in your catalog?</h3>
<p>We may be able to help. Send us the part number and we'll let you know about availability and pricing.</p>
<h3>Do you offer NET-30 terms?</h3>
<p>For wholesale inquiries, contact reflexityram@gmail.com to discuss your specific needs.</p>`;

export default function FAQ() {
  return (
    <EditablePolicyPage
      slug="faq"
      num="03"
      label="FAQ"
      title="Common questions."
      defaultHtml={DEFAULT_HTML}
      testId="faq-page"
    />
  );
}
