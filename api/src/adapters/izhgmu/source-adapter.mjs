import { discoverIzhgmuSources, IZHGMU_SOURCE } from "./discover.mjs";
import { downloadIzhgmuSources } from "./download.mjs";
import { buildIzhgmuSourceSnapshot, compareIzhgmuSourceSnapshots } from "./source-version.mjs";

function structuralReviewCandidates(snapshot) {
  return snapshot.sources.map((source) => ({
    sourceKey: source.sourceKey,
    sourceUrl: source.url,
    sourceFormat: source.sourceFormat,
    sourceRole: source.sourceRole,
    program: source.program,
    course: source.course,
    stream: source.stream,
    routing: {
      status: "needs_source_review",
      reason: "workbook_structural_signature_required",
      structuralSignature: null,
      parserProfile: null,
    },
  }));
}

export async function runIzhgmuSourceAdapter({
  sourceUrl = IZHGMU_SOURCE,
  outputDir,
  previousSnapshot = null,
  fetchFn = fetch,
} = {}) {
  if (!outputDir) throw new Error("outputDir is required");

  let manifest;
  try {
    manifest = await discoverIzhgmuSources({ sourceUrl, fetchFn });
  } catch (error) {
    return {
      version: 1,
      university: "izhgmu",
      status: "source-error",
      sourcePage: sourceUrl,
      publishable: false,
      publicationAction: "none",
      diagnostics: [{ stage: "discover", error: error.message }],
      manifest: null,
      downloadReport: null,
      snapshot: null,
      diff: null,
      routingCandidates: [],
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
      publishable: false,
      publicationAction: "none",
      diagnostics: errors.map((error) => ({ stage: "discover", error })),
      manifest,
      downloadReport: null,
      snapshot: null,
      diff: null,
      routingCandidates: [],
    };
  }

  let downloadReport;
  try {
    downloadReport = await downloadIzhgmuSources({ manifest, outputDir, fetchFn });
  } catch (error) {
    return {
      version: 1,
      university: "izhgmu",
      status: "source-error",
      sourcePage: sourceUrl,
      publishable: false,
      publicationAction: "none",
      diagnostics: [{ stage: "download", error: error.message }],
      manifest,
      downloadReport: null,
      snapshot: null,
      diff: null,
      routingCandidates: [],
    };
  }

  const failedDownloads = downloadReport.files.filter((item) => item.status === "failed");
  if (failedDownloads.length) {
    return {
      version: 1,
      university: "izhgmu",
      status: "source-error",
      sourcePage: sourceUrl,
      publishable: false,
      publicationAction: "none",
      diagnostics: failedDownloads.map((item) => ({ stage: "download", url: item.url, error: item.error })),
      manifest,
      downloadReport,
      snapshot: null,
      diff: null,
      routingCandidates: [],
    };
  }

  const snapshot = buildIzhgmuSourceSnapshot({ sourcePage: sourceUrl, downloadReport });
  const diff = compareIzhgmuSourceSnapshots(previousSnapshot, snapshot);
  const routingCandidates = structuralReviewCandidates(snapshot);

  return {
    version: 1,
    university: "izhgmu",
    status: diff.hasCandidates ? "review-required" : "unchanged",
    sourcePage: sourceUrl,
    publishable: false,
    publicationAction: diff.publicationAction,
    diagnostics: diff.missing.map((item) => ({
      stage: "compare",
      kind: "missing-source",
      url: item.url,
      note: "Diagnostic only; published schedule must remain unchanged.",
    })),
    manifest,
    downloadReport,
    snapshot,
    diff,
    routingCandidates,
  };
}
