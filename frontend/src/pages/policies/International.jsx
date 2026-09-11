import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>We ship Reflexity RAM worldwide — international orders just work a little differently than domestic ones.</p>
<h2>Why international orders are handled directly</h2>
<p>We're a small, independent shop based in Toronto. Rather than bake inflated worldwide shipping into our prices or run a complicated multi-carrier checkout system, we handle international orders personally. That keeps our domestic pricing honest and lets us give you an accurate shipping quote for your exact location instead of a rough guess.</p>
<h2>How it works</h2>
<p>1. Email us at reflexityram@gmail.com with the product(s) you want and your country.</p>
<p>2. We'll reply to arrange the details, including a shipping quote and your contact number so we can stay in touch.</p>
<p>3. Once everything's confirmed, we pack and ship directly to you with tracking.</p>
<h2>Canada & US customers</h2>
<p>If you're in Canada or the United States, there's nothing extra to do — just check out normally on the site with our $14 CAD flat-rate shipping.</p>
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
