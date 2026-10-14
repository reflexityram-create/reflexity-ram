# Ways to pay: card, bank debit, Interac e-Transfer

Card and wallets stay exactly as they were (Stripe Checkout, no discount). Two cheaper methods sit beside them and pass part
of the saving on as a discount **on the goods only** (never shipping):

| Method | Cost to the shop | Default discount | Clears | Who confirms it |
| --- | --- | --- | --- | --- |
| Card, Apple Pay, Google Pay (`paymentMethod: "stripe"`) | 2.9% + 30¢ | 0 | at once | Stripe |
| Bank debit (`bank_debit`, Stripe pre-authorized debit) | 1% + 40¢ (5.00 cap) + 1.00 per instant verification | 1% | up to 5 business days | Stripe webhook |
| Interac e-Transfer (`etransfer`) | none from the shop | 2% | when the owner sees the deposit | the owner, by hand |

Everything is **off by default** and switched by environment variables on the host (set in Render's Environment tab; `backend/render.yaml` does not list them):

| Variable | Meaning |
| --- | --- |
| `BANK_DEBIT_ENABLED=true` | offer bank debit |
| `BANK_DEBIT_DISCOUNT_PCT` | percent off the goods, default 1 (0 to 5) |
| `ETRANSFER_ENABLED=true` | offer e-Transfer (also needs the address below) |
| `ETRANSFER_RECIPIENT_EMAIL` | the address that receives the transfers (auto-deposit on). Never guessed: without it e-Transfer is not offered |
| `ETRANSFER_DISCOUNT_PCT` | default 2 (0 to 5) |
| `STRIPE_AUTOMATIC_TAX=true` | OFF by default: card and bank-debit sessions carry no tax calculation, so Stripe's page shows no "Tax" line. Set it the day a GST/HST registration is added in Stripe, and make e-Transfer charge the tax too (see "Tax" below); forgetting it after registering would silently under-collect |
| `ETRANSFER_HOLD_HOURS` | how long an unpaid order keeps its stock, default 48 (6 to 168). The checkout pages and emails follow it; the Terms page says "48 hours" in plain text, so change both together |
| `ETRANSFER_REMINDER_HOURS` | when the "not received yet" email goes out, default 24 |
| `ETRANSFER_MAX_UNITS` | most items one e-Transfer order may hold, default 16 (1 to 200) |
| `ETRANSFER_MAX_TOTAL_CAD` | most one e-Transfer order may come to, default 3000 (50 to 20000). An unpaid order holds real stock for the whole hold and most banks cap a single transfer; a bigger order pays by card (no hold, no cap) or by arrangement. The checkout page greys the option out with the reason |

`GET /api/payments/methods` tells the checkout page which are on. The e-Transfer address is never NAMED in that answer (it only says
whether it differs from the contact address); a buyer is shown it inside their own order.

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
   left out (`contactDiffers` in `GET /api/payments/methods` tells the page, without naming the address). **Since 2026-10-13 the owner receives
   e-Transfers at the contact address itself** (`reflexityram@gmail.com`, registered as a second Autodeposit address in his TD app; Render
   `ETRANSFER_RECIPIENT_EMAIL`), so today those sentences are NOT shown and `contactDiffers` is false. One order is limited to
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

## One order per payment (database indexes)

The database itself refuses a second order for the same Stripe payment: `orders` has a unique index on the Checkout Session
(`stripeCheckoutSessionId_1`) and one on the PaymentIntent (`stripePaymentIntentId_unique`, partial: it only holds orders that have a
PaymentIntent, so e-Transfer orders are not in it). The webhook and the success page can both try to make the order; the one that loses
gets a duplicate-key error and uses the winner's order. The server does not let Mongoose build these two (a plain `stripePaymentIntentId_1`
left by an old schema made a unique index of that name fail a deploy on 2026-08-26). `migrations/ensureOrderPaymentIndexes.js` adds a
missing one at startup: only when no two orders share the value, never dropping or rewriting an index, never stopping the server. The
startup log says `Order payment-id unique indexes present`, or names what is missing and why. Production has the plain
`stripePaymentIntentId_1` beside the new unique one; the plain one is harmless and was left in place on purpose.

## Stock is set aside while a buyer pays by card (`utils/stockHolds.js`)

A paid order takes its stock when the payment is confirmed, which used to leave a gap: two buyers could both pay for the last unit, and
the second payment found nothing left. Now, when a buyer is sent to Stripe, the quantities in their cart are **held** for 30 minutes (60
for a bank debit; `CHECKOUT_STOCK_HOLD_MINUTES` changes the first, 5 to 240). A second buyer who asks for the same unit meanwhile is told
it is being checked out by someone else and how many minutes until it frees up if they do not finish. They are given no link to pay.

- A hold changes no stock number. What a buyer can have is the stock minus the live holds of everyone *else*, so a buyer's own retry never
  blocks them. Holds live in `Product.stockHolds` (never returned by any query that does not ask for it): checking "enough left?" and
  writing the hold is one atomic update, which is what makes simultaneous buyers come out one winner and the rest refused.
- A buyer has one hold per product, and it remembers the Stripe page it was made for (`sessionId`). Paying on a page gives back exactly
  that page's hold, so a newer page of the same buyer keeps its own. A cart's holds are taken in ONE database transaction: all of them
  or none, so a refused try leaves everything as it was (an earlier page stays protected, nothing is ever "put back" by hand) and nobody
  sees a half-made hold. A new hold gives up, in the same transaction, what the buyer held on products they have taken out of the cart.
- Order of steps in `POST /create-checkout-session`: the Stripe page is made first, the hold second. A Stripe failure therefore never
  touches a hold, and a refusal costs only a page nobody was given the link to, which is closed again as tidiness.
- The hold is given back when the order is made (after the stock is taken, never before), when the e-Transfer lane makes an order for the
  same buyer, when a guest signs in and their cart becomes the account's, or by running out. A retry of an order whose first attempt
  stopped before its last steps (Stripe redelivers the event, the buyer reopens the success page) finishes them: the order carries
  `postOrderPending` until the hold is given back and the cart is emptied, and keeps it if either step fails, so the next retry tries
  again. The cart is emptied only if nobody touched it since the buyer *started that checkout* (Stripe's session time, five seconds of
  slack for clocks): items added in another tab afterwards were not paid for and stay. (Opening the cart page can also touch it, when a
  price or name changed meanwhile: then it is left as it is and the buyer sees what remains.)
- The e-Transfer lane respects other buyers' holds. It still takes the stock for an e-Transfer whose money has already arrived (marking
  it received after the 48-hour hold lapsed), whatever is held.
- It is advisory and fails open: if a hold cannot be written the sale goes ahead as before. A payment that arrives after its hold lapsed
  and finds the stock gone is still clamped at zero, flagged `OVERSOLD` on the order and alerted to the owner's phone.
- A hold never keeps a buyer waiting for long. Its transaction has a deadline (`CHECKOUT_HOLD_TIMEOUT_MS`, default 5000): when two carts
  after the same products collide, the database turns the second writer away and the driver retries it, and without a deadline that could
  go on for the driver's default two minutes. The deadline is the driver's own `timeoutMS`, which cancels the transaction (a
  `Promise.race` would leave it running). Past it the buyer is sent to pay without a hold, like after any other failure to hold. Each retry
  of the transaction works from the time it runs at, so a rival hold that lapsed meanwhile does not wrongly refuse the buyer.
- The clamp itself used to crash on a real database (Mongoose refuses an array update without `updatePipeline`, and every test stubbed that
  call), so an oversold payment became a 500 and a retry loop instead of a flagged order. Fixed in the same change; the real-database
  test `stock-holds.integration.test.js` covers it.
- **Limits, on purpose.** A checkout that is abandoned keeps the unit set aside until the hold runs out (30 minutes), so a curious visitor
  can block the last unit for that long, and a script could keep doing it (every request is rate limited); shorten
  `CHECKOUT_STOCK_HOLD_MINUTES` if it ever matters. There is one hold per buyer, not one per Stripe page: a buyer who opens two checkout
  pages for the same cart (two tabs) has one hold and both pages stay payable, so paying in both makes two orders (the old double-payment
  case; the second ends in the oversold alert if the stock is gone). A signed-in buyer who signs out and checks out as a guest is a
  different buyer for holds until theirs runs out.

## A checkout that costs nothing

A discount code that covers the whole order (and shipping that is free) leaves a Stripe session with nothing to pay: its `payment_status`
is `no_payment_required`, with no PaymentIntent and no charge. A *completed* such session with a zero total now becomes an ordinary order
(paid, stock taken, confirmation email, a note on the order and an owner alert titled "New order: $0, a discount code covered it").
Before, it was ignored: no order, no stock taken, nothing for the buyer. No such code exists today.

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

## Customer emails and replies

Every email to a customer is sent from `noreply@reflexityram.com`, and that domain has **no mail server** (no MX record, checked 2026-10-13): a
reply to the sender address bounces to the buyer and never reaches anyone. So every customer email sets `Reply-To: reflexityram@gmail.com`
(verification, password reset, order confirmation, shipped with or without tracking, review request, tracking updates, every payment notice).
`backend/test/customer-email-replies.test.js` fails if a new email is added without one. Before 2026-10-14 the order confirmation, the tracked
shipped email, verification and password-reset emails had none, so a buyer's answer to them was lost.
