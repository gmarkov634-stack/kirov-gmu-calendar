# Server-side funnel analytics

This layer intentionally derives high-value funnel metrics from existing operational records instead of trusting browser clicks for commercial completion.

Authoritative facts:
- `trial.created`: persisted `trial-conversions/*` record.
- `trial.connected`: the trial token hash has `subscription-access.firstSeenAt`.
- `payment.succeeded`: persisted order status is `succeeded`.
- `paid.connected`: the paid order id has a subscription-access record with `firstSeenAt`.
- `trial_to_paid` vs `direct_purchase`: existing order `purchasePath`.

Admin endpoint:

`GET /api/v1/admin/funnel`

Requires `X-Admin-Token`. Optional query filters: `university`, `academicYear`, `semester`. Defaults to the configured offer academic year and semester. The response is aggregate-only and does not expose email, subscription tokens, conversion ids, IP addresses, User-Agent strings, or access fingerprints.

The summary reports trial created/connected/upgraded counts and rates, plus payment and paid-calendar connection counts split into `all`, `test`, and `live` payment modes.

This is the authoritative lower funnel. A later client-side layer may add upper-funnel events such as landing view and group selection, but it must not replace the server facts above for successful payment or actual ICS connection.
