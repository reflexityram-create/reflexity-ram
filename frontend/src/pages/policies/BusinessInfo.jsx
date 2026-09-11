import PolicyPage from "@/components/PolicyPage";

export default function BusinessInfo() {
  return (
    <PolicyPage
      num="03"
      label="Store information"
      title="About Reflexity RAM"
      intro="Clear information about who operates this store, how orders are fulfilled, and how to reach us."
      testId="business-info-page"
      sections={[
        {
          heading: "Business identity",
          body: [
            "Reflexity RAM is an independent online Server RAM retailer based in Toronto, Ontario, Canada. We sell tested new and used Server RAM through reflexityram.com.",
            "Store and operating name: Reflexity RAM.",
          ],
        },
        {
          heading: "Contact",
          body: [
            "Customer support email: reflexityram@gmail.com.",
            "We aim to respond to order, return, and product questions within 2 business days. Include your order number when contacting us about an existing purchase.",
          ],
        },
        {
          heading: "Prices and payment",
          body: [
            "Store prices are displayed and charged in Canadian dollars (CAD). Shipping charges and any applicable taxes are shown before payment is confirmed.",
            "Online payments are processed securely by Stripe. Reflexity RAM does not store full payment-card numbers.",
          ],
        },
        {
          heading: "Order fulfilment",
          body: [
            "Orders ship from Toronto. Standard website checkout is available for Canada and the United States at the shipping rate shown during checkout.",
            "Product condition, stock status, warranty coverage, and key specifications are shown on each product page. Used memory may have normal cosmetic wear that does not affect operation.",
          ],
        },
        {
          heading: "Policies",
          body: [
            "Standard retail returns are accepted within 30 calendar days after delivery, subject to the conditions on our Returns page. Product-specific warranty coverage is shown on the product page.",
            "Last updated: August 7, 2026.",
          ],
        },
      ]}
    />
  );
}
