# Upper-funnel analytics

## Purpose

This layer measures the browser-visible part of the commercial funnel without replacing authoritative server facts. It answers where a student drops out before trial creation, payment, or actual calendar connection.

Authoritative completion facts remain server-side:

- trial creation comes from stored trial conversions;
- trial connection comes from the first observed request of the trial ICS feed;
- successful payment comes from the stored YooKassa order state;
- paid connection comes from the first observed request of the paid ICS feed.

Browser clicks never redefine those facts.

## Feature gate

`FUNNEL_ANALYTICS_ENABLED=true` enables the public write-only event endpoint.

Any missing value or any value other than exact `true` keeps analytics closed. The product flow remains operational when analytics is disabled.

Endpoint:

`POST /api/v2/analytics`

It is CORS-restricted to configured site origins. There is no public analytics read endpoint. Aggregate reads remain behind the existing admin token at:

`GET /api/v1/admin/funnel`

## Journey identifier

The browser creates 16 random bytes with Web Crypto and represents them as 32 lowercase hexadecimal characters. The value is held in `sessionStorage`, so the default scope is one browser tab/session rather than a durable cross-session user profile.

The raw journey ID is never persisted by the backend. The event service immediately stores only `SHA-256(journeyId)`.

No analytics record contains:

- email;
- subscription token or subscription URL;
- raw conversion ID;
- raw journey ID;
- IP address captured by application analytics;
- User-Agent captured by application analytics;
- browser cookies;
- document referrer.

UTM/referral values are optional, trimmed and limited to 160 characters.

## Browser events

Allowlisted action events:

- `landing_view`
- `university_view`
- `group_selected`
- `trial_cta_clicked`
- `direct_purchase_clicked`
- `trial_connect_clicked`
- `offer_view`
- `checkout_started`
- `paid_link_shown`
- `paid_connect_clicked`

Records are keyed deterministically by hashed journey + event + relevant group/path/plan/channel context. Re-rendering the same UI therefore does not create a second logical event record.

The browser tracker is best-effort. Analytics failures are ignored and never block catalog, preview, trial, checkout, payment polling, or calendar connection.

## Bridge to server facts

Two write-only bridge events are accepted only after server verification.

### Trial bridge

After a successful `POST /api/v2/trials`, the browser sends `trial_linked` with the non-privileged `conversionId`.

The backend loads the real conversion record and stores only:

- hashed journey ID;
- already stored conversion ID hash;
- verified university/program/course/group/period context.

The raw `conversionId` is not stored in analytics.

### Order bridge

After a successful `POST /api/v2/payments`, the browser sends `order_linked` with `orderId` and, for a trial path, the existing `conversionId`.

The backend first loads the real order. For `trial_to_paid`, if the order's stored `trialConversionHash` matches the supplied conversion, the analytics link reuses the journey hash previously verified by the trial bridge. This allows a purchase opened from a calendar link in a new browser tab to remain attributed to the original trial journey without storing a durable user identity.

This bridge is separate from the YooKassa order/subscription runtime; analytics does not mutate payment or entitlement records.

## Admin summary v2

`GET /api/v1/admin/funnel` keeps the existing `trial` and `payments` sections and adds `upper`.

`upper.uniqueJourneys` counts browser steps.

`upper.linkedServerFacts` counts server facts that can be safely joined to a journey:

- trial created;
- trial actually connected;
- payment succeeded;
- trial-to-paid payment succeeded;
- paid calendar actually connected.

`upper.linkCoverage` shows how much of the authoritative trial/payment data has a journey bridge. This is important because analytics is best-effort and may be disabled or blocked by the browser.

`upper.rates` includes:

- landing → group selected;
- group selected → trial created;
- trial created → trial connected;
- connected trial → paid;
- checkout → successful payment;
- successful payment → paid connected;
- landing → paid connected.

Existing payment summaries continue to split test and live payments, so technical YooKassa E2E orders are not mixed with real commercial results.

## Deployment rule

Merging this code does not automatically enable analytics. Backend and frontend should be deployed together first, then `FUNNEL_ANALYTICS_ENABLED=true` can be set explicitly before real traffic is evaluated.

The gate is independent from `TRIALS_ENABLED` and `COMMERCIAL_SALES_ENABLED`.
