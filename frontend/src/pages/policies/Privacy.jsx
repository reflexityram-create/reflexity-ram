import PolicyPage from "@/components/PolicyPage";

export default function Privacy() {
  return (
    <PolicyPage
      num="03"
      label="Policy"
      title="Privacy"
      intro="Short and honest. We collect what we need to fill your order and run the store, and we never sell it."
      testId="privacy-page"
      sections={[
        {
          heading: "What we collect",
          body: [
            { list: [
              "Name, shipping address, email, and phone number for fulfilment",
              "Order details and billing zip for payment processing",
              "Store analytics: pages viewed, product and cart interactions, checkout steps, technical error categories, and time spent on a page — no personal profiling, session recordings, or form-field contents",
              "Visit log: your IP address, the country, region, city, time zone, and network (your internet provider or company) that Cloudflare works out from it, your browser, device type, language, time zone, and screen size, the pages you open, the website that sent you, any campaign tags (utm_) in the link you used, and the time. See \"Visit log\" below",
              "Reviews you choose to post: your star rating, title, review text, and first name",
            ] },
          ],
        },
        {
          heading: "Visit log",
          body: [
            "To keep the store secure, spot fraud and abuse, and see which products interest visitors, our own server records each page you open on this site: the details listed above, plus a random number that ties together the pages of one visit. It sets no cookie and no lasting identifier on your device. We keep it for 180 days, then delete it. We do not sell it, share it for advertising, or use it to build a profile of you, and it never includes your name, email address, order details, or what you type into a form.",
            "To opt out, add ?analytics=off to the end of any page address once (this browser then stops sending it), or turn on Do Not Track or Global Privacy Control in your browser (that stops the visit log; adding ?analytics=off also switches off our Google Analytics measurement). You can ask us to delete the log entries for your IP address using the email address below.",
          ],
        },
        {
          heading: "Address suggestions",
          body: [
            "When address suggestions are on, what you type in the street address box on the Interac e-Transfer page is sent through our server to an address search service that suggests Canadian addresses: either Canada Post's AddressComplete service, or Photon, a free open-source service run by Komoot on OpenStreetMap data. Only the text you typed is sent (never your name, email or connection address), and we do not keep those searches. Canada Post already receives your address from us when we ship your order. You can ignore the suggestions and type your address yourself.",
          ],
        },
        {
          heading: "Emails we send",
          body: [
            "We email you about your order: a confirmation, a shipping notice, and, about 10 days after it ships, one email asking how the order went, with a link to review what you bought. The review link works without an account.",
            "Every review email has an unsubscribe link. Unsubscribing stops review emails only; order and shipping emails still arrive.",
          ],
        },
        {
          heading: "Reviews",
          body: [
            "When you post a review, we publish your star rating, title, review text, first name, the date, and a \"Verified purchase\" label on the product page. We never publish your last name, email address, or order details.",
            "Reviews are published as written, including low ratings. Email us to correct or remove a review you posted.",
          ],
        },
        {
          heading: "Google Customer Reviews",
          body: [
            "After checkout, the order confirmation page may show a Google Customer Reviews box asking whether Google can email you a short survey about your purchase. To show that box, we pass Google your email address, order number, delivery country, and estimated delivery date.",
            "Google only emails you the survey if you agree. Your answers are handled under Google's privacy policy at policies.google.com/privacy.",
            "Our pages may also show Google's store rating badge. It loads from Google, so Google receives the usual request details (such as your IP address and the page you are on) when it appears; we send it nothing else.",
          ],
        },
        {
          heading: "Who we share it with",
          body: [
            "We do not sell or rent customer data. We share it only with the services that run the store, and only what each one needs:",
            { list: [
              "Stripe — processes your payment. We never see or store full card numbers.",
              "The shipping carrier — delivers your order.",
              "Resend — sends our order and review emails.",
              "Google Analytics — measures site traffic and shopping steps so we can find where visits end or checkout fails. A hidden tab or the last recorded step does not tell us why someone left. We do not send names, email addresses, shipping addresses, or payment details in these events.",
              "Google Customer Reviews and its store rating badge — as described above.",
              "Canada Post's AddressComplete or Photon (Komoot, on OpenStreetMap data) — suggest addresses as you type on the Interac e-Transfer page, when suggestions are on. They receive only the text you typed.",
              "Cloudflare, Render, and MongoDB Atlas — host the website and store order records. Cloudflare also stores the visit log.",
            ] },
            "We do not run cross-site behavioral advertising.",
          ],
        },
        {
          heading: "Cookies",
          body: [
            "Essential cookies for the cart and session. Analytics cookies for understanding catalog traffic. No third-party ad cookies. The visit log sets no cookie.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "Email reflexityram@gmail.com to request access, correction, or deletion of your personal data, including reviews you've posted. We respond within 30 days.",
          ],
        },
        {
          heading: "Updates to this policy",
          body: [
            "If we change anything material, we'll update this page and notify recent customers by email.",
            "Last updated: October 14, 2026.",
          ],
        },
      ]}
    />
  );
}
