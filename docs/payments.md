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
| `ETRANSFER_MAX_UNITS` | most items one e-Transfer order may hold, default 16 (1 to 200) |
| `ETRANSFER_MAX_TOTAL_CAD` | most one e-Transfer order may come to, default 3000 (50 to 20000). An unpaid order holds real stock for the whole hold and most banks cap a single transfer; a bigger order pays by card (no hold, no cap) or by arrangement. The checkout page greys the option out with the reason |

`GET /api/payments/methods` tells the checkout page which are on. The e-Transfer address is never in that answer; a buyer sees it
only inside their own order.

## Bank debit (Stripe)

A separate Checkout session per button (`POST /api/stripe/create-checkout-session` with `paymentMethod: "bank_debit"`): only
`acss_debit`, a `sporadic` mandate (`transaction_type: personal`: the consumer category, with the 90-day window to dispute), a reusable
percent coupon (`rfx-bank-debit-<pct>pct`, created on first use), no promotion-code box (Stripe will not take both), Canada only. The
dashboard's payment-method list is left alone, so card sessions never show bank debit.

1. The buyer authorizes the debit; Stripe sends `checkout.session.completed` with `payment_status: "unpaid"`. The shop creates a
   **pending** order (`paymentStatus: pending`, `status: pending`), holds the stock, emails the buyer "received, processing", alerts
   the owner. `utils/orderTransitions.js` refuses to process or ship an unpaid order. **Not when no debit is under way**, judged from
   the session's PaymentIntent: `requires_payment_method` is how Stripe leaves a session after the bank refused the debit (so a
   retried `completed` cannot create an order for a debit that already failed), `requires_action` is a buyer who typed their account
   numbers by hand and must still verify two micro-deposits, and `canceled` is cancelled. For the first two the order appears,
   already paid, when the money clears (step 2). Any other state, including one Stripe adds later, counts as a debit under way:
   leaving out a real debit would give a paying buyer no order, which is worse than the rare order for a debit that never started.
2. `checkout.session.async_payment_succeeded` (up to 5 business days later): the order becomes `paid` / `processing`, the buyer gets the
   confirmation, the owner an alert, GA4 the purchase.
3. `checkout.session.async_payment_failed`: the order is cancelled (`paymentStatus: failed`), the stock goes back, the buyer is told.
   A debit that clears on an order cancelled by hand is flagged `REVIEW` in the order's notes (once, however often Stripe redelivers
   the event) and alerted: refund it in Stripe.
4. A debit still pending **8 days** after it was placed (Stripe's own limit is 5 business days) means an event was lost or the payment
   is stuck: the sweep alerts the owner once (`order.bank_debit_stale`) and never cancels it by itself. Look it up in Stripe, then
   cancel the order or wait.

Both the e-Transfer "received" and the bank-debit "cleared" steps record `paidAt` on the order. GA4 gets the purchase dated and aged
from that moment (Measurement Protocol drops events older than 72 hours, so measuring from the day the order was placed lost most
bank debits). A card order has no `paidAt` and is judged by its creation, exactly as before.

## Interac e-Transfer (the shop's own lane: `utils/etransfer.js`)

1. Checkout > "Interac e-Transfer" > `/checkout/e-transfer` (Canadian address, email, phone, agreement) >
   `POST /api/payments/etransfer/orders`. The order is saved **unpaid** and its stock is taken in the same transaction (all or nothing;
   the last unit goes to exactly one buyer). The buyer's cart is emptied **inside that same transaction**, so one cart can only ever
   become one order (a double click in two tabs, a retry or a script gets "your cart changed or was already ordered"). The buyer sees,
   and is emailed, the address, the exact amount, and the order number to use as the message (optional, but it helps the owner match the
   transfer). The page and both emails say plainly that this address is **not** the shop's contact email (`reflexityram@gmail.com`, see
   `utils/contact.js`), and only when that is true: if the owner ever receives e-Transfers at the contact address itself, the sentence is
   left out (`contactDiffers` in `GET /api/payments/methods` tells the page, without naming the address). One order is limited to
   `ETRANSFER_MAX_UNITS` items and `ETRANSFER_MAX_TOTAL_CAD` dollars; at most 3 open orders per buyer and 8 orders an hour per IP.
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
`order.payment_after_cancel`, `order.bank_debit_stale` join the events in `docs/phone-app.md`.

## Known limits (decided, not forgotten)

An independent review of this change fixed what could be fixed cheaply (everything above); these remain, on purpose:

- **Unverified e-Transfer buyers.** The email a guest types is not confirmed before their items are held and the instructions go out.
  So anyone can make the shop email "send $X" to an address that is not theirs, and can hold up to the size limit of stock for the hold.
  Mitigations in place: the size limits, 3 open orders per address, 8 orders an hour per IP, an alert on the owner's phone for every
  order (cancel one by hand in a tap), the instructions say "if you did not place this order, ignore this email", and the Payment panel
  tells the owner whose name the transfer should come from (check it before shipping). The open-order cap is checked before the order
  is written, so a burst of requests from *different* carts with one address can exceed it by a few; the size limits still hold.
- **One transfer per order.** Most Canadian banks cap a single Interac transfer, which is why an order is limited to
  `ETRANSFER_MAX_TOTAL_CAD`. A buyer who does send two transfers can be accepted with "accept a different amount" and a note; there is
  no split-payment record.
- **Tax.** The shop charges no sales tax today, so no order carries any. Card and bank-debit sessions are created WITHOUT `automatic_tax`,
  so Stripe's page shows no "Tax: Enter address to calculate" line (with it on, the line showed even though the answer was always $0).
  The day a GST/HST registration is added in Stripe, do both: set `STRIPE_AUTOMATIC_TAX=true` on the host (card and bank debit then
  charge it through `automatic_tax`) AND make `utils/etransfer.js` charge it too, or e-Transfer orders will silently under-collect.
- **Real bank debit.** Stripe accepted the session shape on the live account, but a real debit through a real bank has not been run
  end to end. The first one is the live test: it alerts the owner at each step, and the 8-day check above catches a lost event.

## Tests

- `backend/test/payment-methods.test.js`: discount arithmetic, settings, delivery choices, the Stripe session payload.
- `backend/test/payments-mongo.integration.test.js`: the whole flow on a **real MongoDB replica set** (transactions and races). Skipped
  unless `MONGODB_TEST_URI` is set; it drops that database. See the file's header for the Docker one-liner; run with
  `MONGODB_TEST_URI=... npm --prefix backend run test:payments`.
