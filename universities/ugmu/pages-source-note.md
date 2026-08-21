# UGMU Pages source authority

The canonical public UGMU landing source is `ugmu/`.

Controlled GitHub Pages deployment must copy UGMU assets from the exact reviewed commit's `ugmu/` directory. The older `site/ugmu/` copy is not an allowed deployment source for trial UX because it can lag behind the canonical landing.

`ugmu-controlled-pages-main-v2.yml` is the push-capable Pages workflow. On pushes that change `ugmu/**` or the workflow itself, it deploys the exact current `GITHUB_SHA` in launch mode.

The older `ugmu-controlled-pages-main.yml` remains manual-only for compatibility and uses the same canonical `ugmu/` source, preventing concurrent push deploys from racing each other.

Trial authorization remains fail-closed and server-authoritative through `meta.universityTrials.ugmu` and `/api/v2/trials`; publishing the landing does not enable `UGMU_TRIALS_ENABLED`.
