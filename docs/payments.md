# Ways to pay: card, bank debit, Interac e-Transfer

Card and wallets stay exactly as they were (Stripe Checkout, no discount). Two cheaper methods sit beside them and pass part
of the saving on as a discount **on the goods only** (never shipping):

| Method | Cost to the shop | Default discount | Clears | Who confirms it |
| --- | --- | --- | --- | --- |
| Card, Apple Pay, Google Pay (`paymentMethod: "stripe"`) | 2.9% + 30¢ | 0 | at once | Stripe |
| Bank debit (`bank_debit`, Stripe pre-authorized debit) | 1% + 40¢ (5.00 cap) + 1.00 per instant verification | 1% | up to 5 business days | Stripe webhook |
| Interac e-Transfer (`etransfer`) | none from the shop | 2% | when the owner sees the deposit | the owner, by hand |

Everything is **off by default** and switched by environment variables on the host (`backend/render.yaml` lists them):

| Variable | Meaning |
| --- | --- |
| `BANK_DEBIT_ENABLED=true` | offer bank debit |
| `BANK_DEBIT_DISCOUNT_PCT` | percent off the goods, default 1 (0 to 5) |
| `ETRANSFER_ENABLED=true` | offer e-Transfer (also needs the address below) |
| `ETRANSFER_RECIPIENT_EMAIL` | the address that receives the transfers (auto-deposit on). Never guessed: without it e-Transfer is not offered |
| `ETRANSFER_DISCOUNT_PCT` | default 2 (0 to 5) |
| `ETRANSFER_HOLD_HOURS` | how long an unpaid order keeps its stock, default 48 (6 to 168). The checkout pages and emails follow it; the Terms page says "48 hours" in plain text, so change both together |
| `ETRANSFER_REMINDER_HOURS` | when the "not received yet" email goes out, default 24 |

`GET /api/payments/methods` tells the checkout page which are on. The e-Transfer address is never in that answer; a buyer sees it
only inside their own order.

## Bank debit (Stripe)

A separate Checkout session per button (`POST /api/stripe/create-checkout-session` with `paymentMethod: "bank_debit"`): only
`acss_debit`, a `sporadic` mandate (`transaction_type: personal`: the consumer category, with the 90-day window to dispute), a reusable
percent coupon (`rfx-bank-debit-<pct>pct`, created on first use), no promotion-code box (Stripe will not take both), Canada only. The
dashboard's payment-method list is left alone, so card sessions never show bank debit.

1. The buyer authorizes the debit; Stripe sends `checkout.session.completed` with `payment_status: "unpaid"`. The shop creates a
   **pending** order (`paymentStatus: pending`, `status: pending`), holds the stock, emails the buyer "received, processing", alerts
   the owner. `utils/orderTransitions.js` refuses to process or ship an unpaid order.
2. `checkout.session.async_payment_succeeded` (up to 5 business days later): the order becomes `paid` / `processing`, the buyer gets the
   confirmation, the owner an alert, GA4 the purchase.
3. `checkout.session.async_payment_failed`: the order is cancelled (`paymentStatus: failed`), the stock goes back, the buyer is told.
   A debit that clears on an order cancelled by hand is flagged `REVIEW` in the order's notes and alerted: refund it in Stripe.

## Interac e-Transfer (the shop's own lane: `utils/etransfer.js`)

1. Checkout > "Interac e-Transfer" > `/checkout/e-transfer` (Canadian address, email, phone, agreement) >
   `POST /api/payments/etransfer/orders`. The order is saved **unpaid** and its stock is taken in the same transaction (all or nothing;
   the last unit goes to exactly one buyer). The buyer sees, and is emailed, the address, the exact amount, and the order number to
   use as the message. At most 3 open orders per buyer and 8 orders an hour per IP.
2. The owner sees the deposit in the bank and, in the order's **Payment** panel, enters the amount received and presses "I received this
   e-Transfer". Only an exact match is accepted unless the owner explicitly accepts a different amount with a note. This makes the order
   `paid` / `processing`, emails the confirmation and reports the purchase. Nothing ships before.
3. No payment inside the hold: `sweepEtransferOrders()` (run by the 15-minute GitHub cron through `POST /api/tracking/sync`, and also when
   the phone app polls or the owner opens the orders list) sends one reminder at 24 h, then at the deadline cancels the order, returns the
   stock and tells the buyer. If the money arrives later, "I received this e-Transfer" brings the order back when the stock is still
   there; if it is not, nothing changes and the owner sends the money back.
4. A paid e-Transfer order is refunded by sending the money back by e-Transfer, then "Record a refund" (no stock change, like a Stripe refund).

## Alerts

`order.etransfer_pending`, `order.etransfer_expired`, `order.bank_debit_pending`, `order.bank_debit_paid`, `order.payment_failed`,
`order.payment_after_cancel` join the events in `docs/phone-app.md`.

## Tests

- `backend/test/payment-methods.test.js`: discount arithmetic, settings, delivery choices, the Stripe session payload.
- `backend/test/payments-mongo.integration.test.js`: the whole flow on a **real MongoDB replica set** (transactions and races). Skipped
  unless `MONGODB_TEST_URI` is set; it drops that database. See the file's header for the Docker one-liner; run with
  `MONGODB_TEST_URI=... npm --prefix backend run test:payments`.
