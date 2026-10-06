import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>We ship Reflexity RAM from Toronto to many countries with Canada Post, and every parcel is tracked.</p>
<h2>Checking out from outside Canada</h2>
<p>At checkout, choose "Another country" and type your country. You'll see Canada Post's current price and delivery time for your parcel: Tracked Packet – International and, where available, Xpresspost – International (guaranteed). You pay what Canada Post charges for your parcel, at checkout with your order.</p>
<p>Checkout lists every country where Canada Post offers tracked delivery, including the United Kingdom, Australia, Japan, Mexico and many European countries.</p>
<h2>Import taxes and duties</h2>
<p>Outside the United States, prices and shipping do not include your country's import taxes or duties. If your country charges them, they are collected when the parcel arrives.</p>
<h2>United States</h2>
<p>US parcels need their import duties paid before they cross the border. When "United States" is on the list under "Another country" at checkout, we do that for you: you'll see Canada Post Tracked Packet – USA plus the US import duties and customs fees, worked out for your order. Both are prepaid in your total, so nothing is due when the parcel arrives. US customs sets the duties and we pass them on at cost; they depend on what you buy, so they are shown before you pay. Promotion codes cannot be used on US orders. Up to 11 sticks per order. If the United States is not on the list for your order, or you want more than that, email us at reflexityram@gmail.com and we'll send a quote.</p>
<h2>Countries not listed</h2>
<p>For a country not listed at checkout, email us at reflexityram@gmail.com with the product(s) you want and your country, and we'll reply with a shipping quote.</p>
<h2>Customers in Canada</h2>
<p>If you're in Canada, there's nothing extra to do: shipping is a flat $14 CAD for 1–2 sticks and $25 CAD for 3 or more (a few listings ship at their own flat rate, shown on the product page and at checkout).</p>
<h2>Questions</h2>
<p>Reach us anytime at reflexityram@gmail.com and we'll be happy to help.</p>`;

export default function International() {
  return (
    <EditablePolicyPage
      slug="international"
      num="03"
      label="Shipping"
      title="International orders."
      defaultHtml={DEFAULT_HTML}
      testId="international-page"
    />
  );
}
