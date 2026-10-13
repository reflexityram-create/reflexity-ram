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
| shipped | "Mark as delivered" | no |
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

## On a phone

Admins get a bottom tab bar (Orders, Products, Users, Security, Settings); everyone else keeps the old header. Products and Users are cards
(tap a product to edit; Deactivate acts at once and offers Undo; Make admin and Deactivate on a user ask first). The tab bar steps aside
while the keyboard is open.
