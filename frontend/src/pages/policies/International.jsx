import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>We ship Reflexity RAM from Toronto to many countries with Canada Post, and every parcel is tracked.</p>
<h2>Checking out from outside Canada</h2>
<p>At checkout, choose "Another country" and type your country. You'll see Canada Post's current price and delivery time for your parcel: Tracked Packet – International and, where available, Xpresspost – International (guaranteed). You pay what Canada Post charges for your parcel, at checkout with your order.</p>
<p>Checkout lists every country where Canada Post offers tracked delivery, including the United Kingdom, Australia, Japan, Mexico and many European countries.</p>
<h2>Import taxes and duties</h2>
<p>Prices and shipping do not include your country's import taxes or duties. If your country charges them, they are collected when the parcel arrives.</p>
<h2>United States and countries not listed</h2>
<p>Parcels to the United States currently need duties paid before they ship, so we arrange US orders directly. For the United States, or a country not listed at checkout, email us at reflexityram@gmail.com with the product(s) you want and your country, and we'll reply with a shipping quote.</p>
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
