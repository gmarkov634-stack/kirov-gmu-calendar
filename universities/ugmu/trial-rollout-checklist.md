# UGMU trial rollout checklist

Status: **prepared, not activated**.

Scope is fixed to UGMU / medicine / course 1 / stream 1 / groups ОЛД 101–112 / academic year 2026/2027 / semester 1.

## 0. Non-negotiable invariants

- `TRIALS_ENABLED` stays closed. UGMU must never depend on the legacy global trial gate.
- `UGMU_TRIALS_ENABLED` stays closed until the explicit activation workflow is intentionally dispatched.
- `COMMERCIAL_SALES_ENABLED` and UGMU paid-sales controls are not changed by the trial rollout.
- No public schedule endpoint or public ICS is opened.
- Trial entitlement is a tokenized personal ICS with a fixed seven-calendar-day window.
- Raw client addresses, User-Agent values, and the HMAC trial fingerprint are not persisted by the anti-abuse claim store.

## 1. Merge/deploy the implementation with trials still closed

Only after PR checks are green and the PR is intentionally approved for deployment:

1. merge the implementation to `main`;
2. allow the normal Cloud.ru API deploy to run;
3. the deploy guard must reject a template where `TRIALS_ENABLED=true` or `UGMU_TRIALS_ENABLED=true`;
4. `/api/v2/meta` must report:
   - `trials: closed`;
   - `universityTrials.ugmu: closed`.

Do not activate trial in this step.

## 2. Verify the Cloud.ru ingress proxy contract

Run the manual workflow `UGMU proxy contract probe`.

The probe:

- requires the existing admin token;
- calls the admin-only `/api/v1/admin/proxy-contract` endpoint;
- compares ingress values to the externally observed runner address and a documentation-range sentinel;
- returns/logs structural booleans only, not raw addresses;
- succeeds only when the current anti-abuse policy can identify a trusted client address as either:
  - ingress-overwritten `X-Real-IP`, or
  - a single ingress-overwritten `X-Forwarded-For` value.

If the probe fails, keep `UGMU_TRIALS_ENABLED` closed and revise the address policy before proceeding.

## 3. Provision the trial identity HMAC secret

Run the manual workflow `UGMU trial identity secret provision` with the exact confirmation:

`PROVISION_UGMU_TRIAL_SECRET`

The workflow must:

- confirm both trial gates are still closed;
- generate a random secret of at least 32 characters;
- set `TRIAL_IDENTITY_HMAC_SECRET` in the Cloud.ru container environment;
- verify both trial gates remain closed after the revision becomes active.

This step provisions identity hashing only; it does not make a trial available to students.

## 4. Explicit activation decision

Do not infer activation from completed technical preparation. Activation requires a separate intentional decision.

When that decision is given, run `UGMU trial activate` with the exact confirmation:

`ACTIVATE_UGMU_TRIAL`

The activation workflow performs its own preflight again before changing the gate.

## 5. Activation workflow verification

The activation workflow must:

1. verify `TRIALS_ENABLED` is still closed;
2. verify `UGMU_TRIALS_ENABLED` starts closed;
3. verify `TRIAL_IDENTITY_HMAC_SECRET` exists;
4. re-run the privacy-safe proxy contract check;
5. enable only `UGMU_TRIALS_ENABLED`;
6. wait until `/api/v2/meta` reports legacy trials closed and UGMU trials open;
7. create one production trial for `ОЛД 101`;
8. verify the returned trial window is exactly seven calendar days;
9. fetch the tokenized ICS and verify active trial entitlement headers and VCALENDAR content;
10. verify the `conversionId` continuation context resolves to the same UGMU group.

Any error after the UGMU gate is opened triggers a best-effort automatic rollback that writes `UGMU_TRIALS_ENABLED=false`.

## 6. Emergency/manual deactivation

Run `UGMU trial deactivate` with the exact confirmation:

`DEACTIVATE_UGMU_TRIAL`

It changes only the dedicated UGMU trial gate to false and verifies `/api/v2/meta` returns `universityTrials.ugmu: closed` while legacy trials remain closed.

## Current blockers before activation

- Cloud.ru ingress proxy contract has not yet been verified in production.
- `TRIAL_IDENTITY_HMAC_SECRET` has not yet been provisioned in production.
- UGMU production trial E2E has not yet been completed.
- No explicit activation decision has been recorded.
