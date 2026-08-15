import { discoverIzhgmuSources, IZH_GMU_SOURCE } from "./discover.mjs";

export async function runIzhgmuSourceAdapter({
  sourceUrl = IZH_GMU_SOURCE,
  fetchFn = fetch,
} = {}) {
  let manifest;
  try {
    manifest = await discoverIzhgmuSources({ sourceUrl, fetchFn });
  } catch (error) {
    return {
      version: 1,
      university: "izhgmu",
      status: "source-error",
      sourcePage: sourceUrl,
      active: false,
      publishable: false,
      parserDispatchReady: false,
      diagnostics: [{ stage: "discover", error: error.message }],
      manifest: null,
    };
  }

  if (manifest.validation?.status !== "ok" || manifest.sourceCount === 0) {
    const errors = [...(manifest.validation?.errors || [])];
    if (manifest.sourceCount === 0) errors.push("no schedule sources discovered");
    return {
      version: 1,
      university: "izhgmu",
      status: "needs-source-review",
      sourcePage: sourceUrl,
      active: false,
      publishable: false,
      parserDispatchReady: false,
      diagnostics: errors.map((error) => ({ stage: "discover", error })),
      manifest,
    };
  }

  return {
    version: 1,
    university: "izhgmu",
    status: "discovered",
    sourcePage: sourceUrl,
    active: false,
    publishable: false,
    parserDispatchReady: false,
    diagnostics: (manifest.validation?.warnings || []).map((warning) => ({
      stage: "discover",
      kind: "warning",
      warning,
    })),
    manifest,
  };
}
