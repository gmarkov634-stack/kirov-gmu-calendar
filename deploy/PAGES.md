# KGMU GitHub Pages deployment

The KGMU product landing is published as the repository GitHub Pages project site. The expected public page URL is:

`https://gmarkov634-stack.github.io/kirov-gmu-calendar/`

The browser Origin sent to the shared core API is therefore exactly:

`https://gmarkov634-stack.github.io`

The path `/kirov-gmu-calendar/` is part of the landing URL, not part of the Origin allowlist.

## Topology

- Static landing and `/manage/`: GitHub Pages.
- Shared Calendar API, `/trial`, `/management/*`, `/c/*`: shared Cloud.ru VM.
- Current Technical-MVP API base: `https://176-123-165-120.sslip.io`.
- GitHub Pages never receives or proxies the protected ICS token.

Because the landing and API are different sites, the management flow must not depend on a `SameSite=Strict` API cookie. The Pages runtime uses the explicit core `bearer` ManagementSession transport. The short-lived management token is returned only after proof verification, kept only in JavaScript memory for the current page lifetime, sent in `Authorization: Bearer ...`, and is never written to URL, localStorage or sessionStorage. Reloading the management page intentionally discards the token and requires a new magic link.

## Fail-closed publication

`deploy/runtime-config.pages.js` intentionally keeps `trialEnabled=false`, `managementEnabled=false` and `checkoutEnabled=false`. Merging this code therefore does not activate public onboarding. The manual `Deploy KGMU GitHub Pages` workflow publishes only after an explicit workflow dispatch.

Before activation of trial/management:

1. core bearer-session PR must be merged and deployed;
2. live SQLite must be backed up and additive migrations applied;
3. exact allowed Origin must include `https://gmarkov634-stack.github.io`;
4. `MEDICAL_CALENDAR_MANAGEMENT_SESSION_TRANSPORT=bearer` must be set;
5. `MEDICAL_CALENDAR_MANAGEMENT_LANDING_URL` must be `https://gmarkov634-stack.github.io/kirov-gmu-calendar/manage/`;
6. a real transactional email sender must be configured separately; `github.io` cannot be used as the project's sending domain because its DNS is not controlled by this project;
7. only then may a coordinated activation change set `trialEnabled=true` and `managementEnabled=true` in the Pages runtime config.

The Resend/API secret remains only in the protected VM runtime environment and is never stored in this repository or Google Docs.
