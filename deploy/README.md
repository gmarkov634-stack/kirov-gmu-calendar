# KGMU same-origin deployment

This directory prepares the KGMU landing for the shared Cloud.ru VM without changing the saved Google Drive visual/content baseline.

## Topology

One HTTPS origin serves both the university landing and the current shared core API:

- `/`, `/assets/*`, `/manage/`, `/catalog/*` — static KGMU landing artifact;
- `POST /trial` — proxied to `medical-calendar-core` on `127.0.0.1:3000`;
- `/management/*` — proxied to the same core runtime;
- `/c/{opaque-token}.ics` — proxied to the same core runtime.

The final hostname is intentionally not committed. Replace `__KGMU_HOST__` only at deployment time after the permanent domain is chosen. The static root placeholder `__KGMU_STATIC_ROOT__` must point to the built artifact, not to the whole repository checkout.

## Build the static artifact

```sh
sh deploy/build-landing.sh /opt/kirov-gmu-calendar/site.next
```

The builder copies the literal landing assets already reviewed in `main`, copies the current versioned KGMU catalog and replaces only `runtime-config.js` with `deploy/runtime-config.production.js`. The source `landing/runtime-config.js` remains fail-closed in Git.

The production runtime config enables trial and management UI, keeps checkout disabled and uses `apiBase=""`, so the browser calls the same HTTPS origin.

## Core runtime contribution

When the final origin is known, the shared `/etc/medical-calendar/core.env` must include that exact HTTPS origin in both allowlists. Do not replace origins belonging to other universities when they are added later.

Example for a host `calendar.example.ru`:

```text
MEDICAL_CALENDAR_TRIAL_ENABLED=true
MEDICAL_CALENDAR_TRIAL_ALLOWED_ORIGINS=https://calendar.example.ru
MEDICAL_CALENDAR_TRIAL_TRUST_PROXY=true
MEDICAL_CALENDAR_MANAGEMENT_ENABLED=true
MEDICAL_CALENDAR_MANAGEMENT_ALLOWED_ORIGINS=https://calendar.example.ru
MEDICAL_CALENDAR_MANAGEMENT_TRUST_PROXY=true
MEDICAL_CALENDAR_MANAGEMENT_LANDING_URL=https://calendar.example.ru/manage/
MEDICAL_CALENDAR_EMAIL_FROM=<verified Resend sender>
RESEND_API_KEY=<runtime secret only>
```

`RESEND_API_KEY` is never committed to this repository or copied into Google Docs. The sending domain must be verified in Resend and click/open tracking must be disabled for authentication/recovery mail.

`*_TRUST_PROXY=true` is safe only with the nginx template in this directory (or an equivalent reviewed config) because it overwrites `X-Forwarded-For` with `$remote_addr`. Do not use `$proxy_add_x_forwarded_for` for this boundary.

## Nginx safety boundary

`deploy/nginx/kirov-gmu-site.conf.template`:

- terminates HTTPS for the university hostname;
- serves only the built static artifact;
- proxies only `/trial`, `/management/*` and `/c/*` to the loopback core runtime;
- sanitizes `X-Forwarded-For` and `X-Real-IP` to the direct client address seen by nginx;
- disables request logging for the site so the credential-bearing ICS path cannot enter nginx access logs;
- adds `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on protected ICS responses.

Before activation, render the placeholders into a new file, run `nginx -t`, keep the current working site config as rollback, then reload nginx. Do not edit the live site in place without a rollback copy.

## Controlled production sequence

This repository change does not perform production deployment. The controlled sequence after a permanent domain is chosen is:

1. create DNS for the KGMU hostname to the shared VM public IP;
2. build the static artifact into a new versioned/staging directory;
3. render the nginx template with the final hostname/static root and validate with `nginx -t`;
4. obtain/deploy the TLS certificate;
5. back up the live SQLite database;
6. deploy the reviewed `medical-calendar-core/main` and run additive migrations;
7. configure the exact Origin allowlists, management landing URL and Resend runtime secret;
8. switch the static symlink/site config atomically and reload nginx;
9. verify `/health/ready`, landing, trial, magic-link, management listing, ICS recovery and the existing protected ICS path;
10. only after the smoke passes consider payment enablement in a later stage.

Source monitoring and payment callbacks are outside this deployment step.
