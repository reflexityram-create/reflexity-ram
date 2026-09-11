import EditablePolicyPage from "@/components/EditablePolicyPage";

// Default content below is the built-in copy. Admins can override it inline via
// the Edit button (persisted server-side); this stays as the fallback.
const DEFAULT_HTML = `<p>We want customers to feel confident when purchasing memory products from Reflexity RAM.</p>
<h2>Return eligibility</h2>
<p>Standard retail purchases may be returned within 30 calendar days after delivery, provided the item is returned in its original condition and protective packaging. Contact us before sending anything back so we can provide return instructions.</p>
<p>Wholesale, specially sourced, or custom international orders are final sale unless the quote or product listing says otherwise. Items damaged through misuse, improper installation, modification, or incompatible operation are not eligible for a change-of-mind return.</p>
<h2>Dead-on-arrival (DOA) items</h2>
<p>If a product arrives defective or fails initial testing, contact reflexityram@gmail.com with your order details and a brief description of the issue.</p>
<p>Compatibility information such as motherboard model, CPU, BIOS version, or memory test results may help speed up troubleshooting.</p>
<h2>Return condition</h2>
<p>Returned products should be packaged safely in anti-static protection where possible. Products with physical damage, severe misuse, or modification may not qualify for return or replacement.</p>
<h2>Refund timing</h2>
<p>Approved refunds are issued to the original payment method after the returned item has been received and inspected. Please allow up to 5 business days for our inspection and processing; your bank may require additional time to post the credit.</p>
<p>Original shipping charges are not refundable for change-of-mind returns. If we sent an incorrect or defective item, Reflexity RAM will cover reasonable return shipping costs.</p>
<h2>Questions</h2>
<p>For any return-related questions, contact reflexityram@gmail.com before shipping products back.</p>`;

export default function Returns() {
  return (
    <EditablePolicyPage
      slug="returns"
      num="03"
      label="Policy"
      title="Returns"
      defaultHtml={DEFAULT_HTML}
      testId="returns-page"
    />
  );
}
