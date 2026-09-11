import PolicyPage from "@/components/PolicyPage";

export default function Privacy() {
  return (
    <PolicyPage
      num="03"
      label="Policy"
      title="Privacy"
      intro="Short and honest. We collect what we need to ship your order, and nothing else."
      testId="privacy-page"
      sections={[
        {
          heading: "What we collect",
          body: [
            { list: ["Name, shipping address, email, and phone number for fulfilment", "Order details and billing zip for payment processing", "Basic analytics (page views, referral source) — no personal profiling"] },
          ],
        },
        {
          heading: "What we don't do",
          body: [
            "We do not sell, rent, or share customer data with third parties.",
            "We do not run cross-site behavioral advertising.",
          ],
        },
        {
          heading: "Cookies",
          body: [
            "Essential cookies for the cart and session. Analytics cookies for understanding catalog traffic. No third-party ad cookies.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "Email reflexityram@gmail.com to request access, correction, or deletion of your personal data. We respond within 30 days.",
          ],
        },
        {
          heading: "Updates to this policy",
          body: [
            "If we change anything material, we'll update this page and notify recent customers by email.",
          ],
        },
      ]}
    />
  );
}
