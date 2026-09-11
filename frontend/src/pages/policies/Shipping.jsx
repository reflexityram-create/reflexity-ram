import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>How we pack, process, and dispatch orders.</p>
<h2>Shipping locations</h2>
<p>We ship standard orders to customers in Canada and the United States, with a $14 CAD flat shipping rate shown at checkout.</p>
<p>We also ship internationally as custom orders. If you're located outside Canada or the United States, email us at reflexityram@gmail.com with the product(s) you'd like and your country, and we'll arrange a shipping quote and the details directly. See our International Orders page for how this works.</p>
<h2>Processing & packaging</h2>
<p>Orders are typically processed and shipped within 1–3 business days of purchase.</p>
<p>Memory modules are packaged appropriately to help protect them during transit. Packaging may include anti-static bags, original manufacturer packaging, original manufacturer boxes, or other suitable protective materials at our discretion.</p>
<p>Processing times may occasionally be longer during holidays, severe weather events, carrier disruptions, or periods of unusually high order volume.</p>
<h2>Tracking information</h2>
<p>Tracking information will be provided after dispatch when available through the selected carrier.</p>
<h2>Delays or delivery issues</h2>
<p>Delivery times are estimates only and may vary depending on destination, carrier performance, customs processing, weather conditions, and other factors outside our control.</p>
<p>If your tracking information has not updated for several business days after dispatch, please contact reflexityram@gmail.com. We'll work with the carrier to investigate the shipment status and assist where possible.</p>
<h2>Incorrect shipping information</h2>
<p>Customers are responsible for providing accurate shipping information at checkout. Orders returned due to incorrect or incomplete shipping information may be subject to additional shipping charges before being resent.</p>`;

export default function Shipping() {
  return (
    <EditablePolicyPage
      slug="shipping"
      num="03"
      label="Policy"
      title="Shipping"
      defaultHtml={DEFAULT_HTML}
      testId="shipping-page"
    />
  );
}
