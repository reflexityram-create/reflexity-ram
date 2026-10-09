# Analytics reporting

`scripts/analytics-report.py` reads aggregate GA4 Data API reports for property
`546945877`. It is read-only, uses the service-account credential selected by
`GOOGLE_APPLICATION_CREDENTIALS` (default: `~/.config/ga-mcp/key.json`), and
never prints credentials, client IDs, session IDs, customer data, or raw event
parameters.

Run the default report (the last 28 complete calendar days):

```bash
python3 scripts/analytics-report.py
```

Choose a bounded window:

```bash
python3 scripts/analytics-report.py --start 2026-09-11 --end 2026-10-08
```

The JSON separates exact `reflexityram.com` visitor totals, channels, events,
and `page_exit` pages from the all-host `purchase` report. Server-side historic
purchases can have hostname `(not set)`, so these sections must not be read as
one user funnel. Counts are anonymous aggregates, the sample is incomplete,
and low volumes should not be treated as stable conversion rates.

Checkout-error/custom-dimension reporting is marked `pending` unless GA4
metadata confirms registered event dimensions. Unregistered event parameters
are not queried. A missing credential, dependency, date range, or API access
returns a short JSON error and a non-zero exit without exposing secret values.

The site supports the owner opt-out query (`?analytics=off`) and marks admin
visits as owner traffic. Use that on testing sessions and do not infer clean
buyer totals until the operator visits have been excluded or separately
identified.

For a manual UI check, open Google Analytics → Reports → Acquisition →
Traffic acquisition for exact production-host visitor channels. For event
counts, use Reports → Engagement → Events. Use Explore only for aggregate
path analysis and keep purchases separate from the visitor-host filter.

Suggested tagged outreach links (prepare only; do not send automatically):

```text
https://reflexityram.com/shop?utm_source=repair_shops&utm_medium=referral&utm_campaign=buyer_outreach
https://reflexityram.com/shop?utm_source=refurbishers&utm_medium=referral&utm_campaign=buyer_outreach
https://reflexityram.com/shop?utm_source=homelab&utm_medium=community&utm_campaign=buyer_outreach
```
