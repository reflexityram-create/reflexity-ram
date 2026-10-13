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
          heading: "Payment methods",
          body: [
            "We accept the payment methods shown at checkout: cards and wallets through Stripe, bank debit through Stripe (Canadian bank accounts only), and Interac e-Transfer. Some methods take a percentage off the price of the goods (never the shipping). A discount applies only to the method it is shown for and cannot be combined with a promotion code. We may change or withdraw a payment method or its discount at any time; the total you see when you place your order is the total you pay.",
            "Bank debit (pre-authorized debit). By choosing bank debit you authorize Reflexity RAM, through Stripe, to debit your Canadian bank account once for the total shown, under the pre-authorized debit agreement shown at checkout. A debit can take up to 5 business days to clear, and we ship only after it has cleared. If it fails or is reversed, we may cancel the order. Your rights to dispute a debit are set out in that agreement and in Payments Canada's rules for pre-authorized debits (Rule H1).",
            "Interac e-Transfer. After you place an e-Transfer order we show and email you the address to pay and the order number to put in the message. Send exactly the total shown within 48 hours. We hold your items for that time, confirm e-Transfers by hand, and ship only after we have received and confirmed your payment. If we do not receive it in time, the order is cancelled and the items go back on sale; if your payment arrives after that, we will reinstate the order if the items are still available, or send your money back. Any fee your bank charges you for sending the transfer is yours. Only pay the address in your order confirmation email from us: we will never ask you to send money anywhere else.",
            "Refunds go back the way you paid: to your card or bank account for Stripe payments, and by Interac e-Transfer to the sender for e-Transfer orders.",
          ],
        },
        {
          heading: "Shipping & delivery",
          body: [
            "We do our best to ship every order quickly and within the times shown in our Shipping policy, but those times are estimates, not guarantees. We reserve the right to extend shipping and delivery times when needed, for example because of stock checks, supplier or carrier delays, customs, weather, holidays, or high order volume.",
            "If your order is delayed, we'll do our best to keep you informed by email. Nothing in this section limits any rights you have under applicable consumer protection laws.",
          ],
        },
        {
          heading: "Carrier, tracking & service level",
          body: [
            "We choose the carrier and the service level for every order, including whether it ships with tracking. We aim to send every order with a tracking number, but we may ship without tracking when we decide it makes sense, even if tracking was mentioned on our site or is part of the shipping charge you paid.",
            "If you paid for a specific tracked or faster service and we ship by a different one, we'll refund the difference in the shipping charge if you ask. A tracking number, when we send one, tracks the parcel; it is not a promise of a delivery date.",
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
