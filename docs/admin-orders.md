# Admin: Orders on a phone and on a desktop

One screen, `/admin/orders`, for every order. The phone app opens it; so does a notification (`/admin/orders?order=<id>` opens that order).

## The list shows everything

There is no archive. The old Archive button sat next to Manage and hid an order that was paid and still had to be shipped, so it was
removed (the `archived` flag on old orders is ignored; `PATCH /api/admin/orders/:id/archive` no longer exists).

One row of buttons narrows the list. The number on each button is how many orders it holds, whatever button is open:

| Button | Holds |
| --- | --- |
| All | every order, newest first |
| Awaiting payment | placed but not paid: an e-Transfer to watch for, a bank debit still clearing |
| To ship | paid, not shipped yet (the ones that need you) |
| Shipped / Delivered | what it says |
| Cancelled | cancelled by hand, a failed payment, an e-Transfer that never came, or refunded |

Server: `GET /api/admin/orders?view=all|awaiting|toship|shipped|delivered|closed` (`backend/src/utils/adminOrders.js`), answers `orders`,
`pagination` and `counts`. An unpaid order is never in "To ship".

## Opening an order ("Manage order")

On a phone it is a full screen (Back or the arrow closes it); on a desktop it is the centred dialog. Top to bottom: notes the system left,
**what to do next**, customer, where it ships (with Copy address), items and totals, payment details, history, and (folded away) the label
details before shipping or the review email after it.

What to do next, by state, and what the **buyer** is emailed:

| Order is | Button | Buyer is emailed |
| --- | --- | --- |
| e-Transfer, money not seen yet | type the amount, "I received this e-Transfer" | yes: payment confirmation (the order becomes paid) |
| paid, not shipped | tracking number (or "No tracking number"), "Mark as shipped" | **yes, right away**: with the tracking link, or saying it went without tracking; or save the number and the site marks it shipped (and emails) at Canada Post's first scan |
| shipped | "Mark as delivered"; and, when the order carries a tracking number that is not one, "It had no tracking number" | no |
| unpaid (any method) | "Cancel this order" (stock goes back) | no |

Every button asks once, in the page, and says what the buyer gets. (A browser confirm box does not appear inside the phone app's web view
unless the app shows it; the screens do not depend on one.)

Under the buttons, **"Save the number, let Canada Post mark it shipped"** keeps the order where it is. The site follows the parcel: at
Canada Post's first scan the order becomes Shipped and the buyer is emailed (once), then "out for delivery" and "waiting at the post
office" emails go out once each, and the scan "delivered" marks the order Delivered and emails the buyer. You get an alert at the
shipped and delivered steps. "More options" only holds a private note on the order.

How often it looks: the job says every 15 minutes, but GitHub's schedule really fires about four times a day (33 runs in 8 days, gaps
of 3 to 10 hours), so the server runs the same check itself every 15 minutes while it is awake (`backend/src/server.js`, throttled in
`trackingSync.js`; the same timer expires and reminds unpaid e-Transfer orders). The GitHub schedule stays: it wakes a sleeping server.

## Shipping without tracking

The Terms let the shop choose the service, including none with tracking. Ticking **No tracking number** sends
`{ status: 'shipped', noTracking: true }`; the order is stored with `untracked: true` and no number, the shipping email says "This parcel
was sent without a tracking number, so there is nothing to follow online" (reply-to is the shop's address), and the buyer's order page says
the same. A number typed in always wins over the tick. Without either, the server still answers 422. The Canada Post tracking sync ignores
an order that has no number, so mark it delivered by hand.

An order that was already shipped with a placeholder in the tracking box (the word "error" went out on 2026-10-09, before the tick-box existed) can be
corrected: **It had no tracking number** on a shipped order calls `POST /api/admin/orders/:id/sent-without-tracking`. The number, the saved
Canada Post link and the last scan are removed, the order is marked `untracked` and keeps its Shipped status, and a history line records the
number that was removed. **Nobody is emailed** (the buyer already has the shipped email; their order page now says it went without tracking), and
the sync stops asking Canada Post about it. Only a shipped order that carries a number is accepted (409 otherwise); changing a wrong number to a
right one is not built.

## A paid order with an unmatched Stripe item (blocked)

When a paid Stripe line matches no product (for example one removed while the buyer was in checkout), the order keeps that line as a
placeholder item (`STRIPE-<price id>`, the price and quantity Stripe charged), is saved with `fulfillmentBlocked: true`, and the owner gets a
high-priority "needs you" alert that opens the order (a retry repeats it if the first attempt stopped before it, for up to an hour after the order was placed). While it is blocked the
server answers 409 to a tracking number, "shipped" and "delivered", the label panel says why, and the Canada Post sync and the shipping
emails leave it alone. After checking the payment in Stripe, `POST /api/admin/orders/:id/fulfillment-review` (optional `{ note }`, up to 300
characters; the body itself is optional) releases it: the block is cleared only while the order is still blocked, paid and open (pending or
processing; 409 for a cancelled, refunded or unpaid one), a history line names the admin who reviewed it, and the order then ships like any
other. A second call answers 409. The admin page has no button for this yet. If the item cannot be sent, refund the payment in Stripe instead
(a paid order cannot be cancelled here).

## On a phone

Admins get a bottom tab bar (Orders, Products, Users, Security, Settings); everyone else keeps the old header. Products and Users are cards
(tap a product to edit; Deactivate acts at once and offers Undo; Make admin and Deactivate on a user ask first). The tab bar steps aside
while the keyboard is open.
