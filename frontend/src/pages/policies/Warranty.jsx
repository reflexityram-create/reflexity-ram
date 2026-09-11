import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>Reflexity RAM provides reliable, individually tested memory backed by clear, straightforward warranty support.</p>
<h2>Coverage</h2>
<p>Warranty coverage may vary depending on the specific product, condition, and manufacturer warranty status.</p>
<p>Where applicable, warranty details will be listed directly on the product page.</p>
<h2>What's generally covered</h2>
<ul><li>Products that fail under normal operating conditions</li><li>Verified defective modules</li><li>Issues identified during standard diagnostic testing</li></ul>
<h2>What's generally not covered</h2>
<ul><li>Physical damage</li><li>Damage caused by improper installation</li><li>Damage caused by unsupported voltage or extreme overclocking</li><li>Modified or tampered products</li></ul>
<h2>Warranty claims</h2>
<p>To begin a warranty request, contact reflexityram@gmail.com with:</p>
<ul><li>order information</li><li>product SKU or part number</li><li>a brief description of the issue</li><li>any relevant diagnostic or compatibility information</li></ul>
<h2>Replacement availability</h2>
<p>Replacement availability depends on inventory and product availability at the time of the claim. If an identical replacement is unavailable, a similar replacement or alternative resolution may be offered.</p>`;

export default function Warranty() {
  return (
    <EditablePolicyPage
      slug="warranty"
      num="03"
      label="Policy"
      title="Warranty"
      defaultHtml={DEFAULT_HTML}
      testId="warranty-page"
    />
  );
}
