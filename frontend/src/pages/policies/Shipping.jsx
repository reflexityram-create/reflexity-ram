import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>How we pack, process, and dispatch orders.</p>
<h2>Shipping locations</h2>
<p>We ship from Toronto with Canada Post, tracked, across Canada and to many countries abroad. Within Canada, shipping is a flat $14 CAD for 1–2 sticks and $25 CAD for 3 or more sticks, shown at checkout. A small number of listings ship at their own flat rate, which is shown on the product page and at checkout before you pay.</p>
<p>We also ship to many countries outside Canada with Canada Post, tracked. Choose "Another country" at checkout to see Canada Post's current price and delivery time for your parcel. Import taxes and duties are not included; if your country charges them, they are collected when the parcel arrives. For the United States, or a country not listed at checkout, email us at reflexityram@gmail.com with the product(s) you'd like and your country, and we'll send a shipping quote. See our International Orders page for details.</p>
<h2>Processing & packaging</h2>
<p>Orders are typically processed and shipped within 1–3 business days of purchase.</p>
<p>Memory modules are packaged appropriately to help protect them during transit. Packaging may include anti-static bags, original manufacturer packaging, original manufacturer boxes, or other suitable protective materials at our discretion.</p>
<p>Processing times may occasionally be longer during holidays, severe weather events, carrier disruptions, or periods of unusually high order volume.</p>
<h2>Estimated delivery</h2>
<p>Standard delivery is estimated within 3–6 business days after dispatch. This is in addition to the 1–3 business day processing time. Business days exclude weekends and public holidays. Delivery estimates are not guaranteed.</p>
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
