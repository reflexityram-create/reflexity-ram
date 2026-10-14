# Testing notes

- `npm run verify` (what CI runs) = frontend tests + backend tests + a production build + a secrets scan.
- **Backend file concurrency is capped at 3** (`backend/package.json`). On a laptop with 8 threads Node's test runner defaults to 7 files at once, and
  about one run in three then fails ONE random file with `Unable to deserialize cloned data due to invalid or unsupported version` (a framing error
  inside Node's runner, seen in `integrity-fixes`, `review-requests` and `phone-app-hardening`; each passes alone). Measured 2026-10-14: 2 failing runs
  out of 6 at the default, 0 out of 6 at 3. CI's own runners have fewer cores, so the cap changes nothing there.
- **Not run in CI**: `backend/test/payments-mongo.integration.test.js` and `admin-orders.integration.test.js` need a replica-set MongoDB
  (`MONGODB_TEST_URI=mongodb://127.0.0.1:27019/x?directConnection=true`, a `mongo:7 --replSet rs0` container). Run them after touching orders, stock or payments.
- **Not in this repository**: the real-browser walkthroughs (Playwright against the isolated local stack with a stand-in for Stripe, Resend and Canada Post).
  They live in the owner's project notes (`.ai/artifacts/payments-2026-10-13/e2e/`) and are the only proof of behaviour that needs a browser: the
  back/forward-cache restore of the checkout page (`walk-checkout-fixes.cjs`; Playwright turns that cache OFF by default, the script turns it on),
  the address box (`walk-address-suggest.cjs`, `walk-review-followups.cjs`) and a hand-off to Stripe that never completes (`walk-handoff-hang.cjs`).
  Unit tests here pin the rules and the wiring, not that a list opens or a button comes back.
