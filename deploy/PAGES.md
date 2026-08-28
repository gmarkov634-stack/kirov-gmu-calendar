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

## Coordinated activation state

`deploy/runtime-config.pages.js` enables only management. `managementEnabled=true`, while `trialEnabled=false` and `checkoutEnabled=false`. Public trial onboarding therefore remains closed while proof-of-email management is verified end-to-end. The manual `Deploy KGMU GitHub Pages` workflow publishes only after an explicit workflow dispatch.

The management activation prerequisites are now satisfied and verified:

1. core bearer-session support is merged and deployed;
2. live SQLite backup and additive management tables are present;
3. exact allowed Origin is `https://gmarkov634-stack.github.io`;
4. `MEDICAL_CALENDAR_MANAGEMENT_SESSION_TRANSPORT=bearer` is active;
5. `MEDICAL_CALENDAR_MANAGEMENT_LANDING_URL` is `https://gmarkov634-stack.github.io/kirov-gmu-calendar/manage/`;
6. Yandex SMTP transactional delivery is configured in the protected VM runtime and live delivery has been smoke-tested;
7. external CORS preflight and unauthenticated management boundary checks from a client have passed.

Trial remains a separate gate. Set `trialEnabled=true` only after a successful end-to-end magic-link → bearer ManagementSession → subscription listing/recovery smoke. Checkout remains disabled until the payment layer is implemented and verified.

`github.io` cannot be used as the project's sending domain because its DNS is not controlled by this project. Yandex SMTP credentials and the application password remain only in the protected VM runtime environment and are never stored in this repository or Google Docs.
