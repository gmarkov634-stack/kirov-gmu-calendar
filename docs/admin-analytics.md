# Admin analytics dashboard

## Purpose

The shared admin analytics dashboard is the product-analytics boundary for every supported university. It combines privacy-safe frontend journey events with authoritative server facts so commercial decisions are not based on click-only conversions.

## Endpoint

`GET /api/v1/admin/funnel`

Authentication: `X-Admin-Token`.

Supported filters:

- `university` — required by the frontend and used to isolate university data;
- `academicYear` and `semester` — scope the sold academic period;
- `days=1|7|30|all` — dashboard time window.

The endpoint remains available to the protected admin surface even when upper-funnel intake is closed. `FUNNEL_ANALYTICS_ENABLED` controls only public event intake and stays fail-closed until the relevant production smoke is approved.

## Dashboard contract

The admin surface must show:

- journey funnel: landing → group selected → trial created → trial first fetch → checkout → payment succeeded → paid first fetch;
- live sales separately from YooKassa test payments;
- live revenue and average order value;
- semester vs year plans;
- direct purchase vs trial-to-paid;
- demand by group, program and course;
- attribution/source including UTM source where present;
- Apple/iPhone vs Google Calendar connect actions;
- collection state so a closed upper-funnel gate cannot be mistaken for zero demand.

`payment.succeeded`, trial creation and first calendar fetches are server facts. Client clicks are supporting journey signals only.

## Privacy contract

Persisted funnel events must not contain raw email addresses, subscription URLs, payment credentials or raw subscription/trial tokens. The browser creates a random session journey id; persistent analytics storage keeps only its SHA-256 hash. Admin responses expose aggregates rather than user-level records.

Analytics is best-effort and must never block catalog, preview, trial, checkout, payment fulfillment or calendar delivery.

## Expansion requirement

For every new university, analytics is an explicit pre-launch stage:

1. The university landing loads the shared funnel tracker and sends the correct `university`, `program`, `course`, `groupCode/groupId`, `purchasePath`, `plan`, `channel` and attribution fields.
2. Server-side linkage is verified for trial creation, trial first fetch, successful payment and paid first fetch.
3. The admin endpoint is tested with the new `university` filter and does not mix data with KGMU or any other university.
4. The admin dashboard renders the new university through shared components; no university-specific copy of the analytics backend is introduced without a documented platform requirement.
5. Live/test payment separation and revenue totals are regression-tested.
6. The public analytics flag remains closed until a production smoke proves event intake, CORS and privacy invariants.
7. Analytics failure is tested as non-blocking for the user journey.

A university is not launch-complete until these analytics checks are included in its Definition of Done.
