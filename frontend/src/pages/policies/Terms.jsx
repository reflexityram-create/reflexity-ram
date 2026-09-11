import PolicyPage from "@/components/PolicyPage";

export default function Terms() {
  return (
    <PolicyPage
      num="03"
      label="Legal"
      title="Terms of service"
      intro="The ground rules for buying from Reflexity RAM."
      testId="terms-page"
      sections={[
        {
          heading: "Acceptance",
          body: [
            "By placing an order with Reflexity RAM, you agree to these terms.",
          ],
        },
        {
          heading: "Product information",
          body: [
            "We make every effort to keep specs, prices, and stock accurate. If we discover an error after you order, we'll contact you to confirm or cancel before fulfilling.",
          ],
        },
        {
          heading: "Orders & payment",
          body: [
            "We reserve the right to refuse or cancel orders for any reason, including suspected fraud or stocking errors.",
            "Prices are in Canadian dollars (CAD) unless otherwise noted.",
          ],
        },
        {
          heading: "Intellectual property",
          body: [
            "All site content (logo, copy, photography, layout) is owned by Reflexity RAM. Don't republish without permission.",
          ],
        },
        {
          heading: "Limitation of liability",
          body: [
            "Reflexity RAM is not liable for indirect or consequential damages arising from the use of our products beyond the purchase price of the affected module.",
          ],
        },
        {
          heading: "Governing law",
          body: [
            "These terms are governed by applicable laws within Canada.",
          ],
        },
      ]}
    />
  );
}
