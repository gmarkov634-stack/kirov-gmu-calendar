import { createHash } from "node:crypto";

export function buildIzhgmuSourceIdentity({ sourcePage, url, sha256 }) {
  if (!sourcePage || !url || !sha256) throw new Error("sourcePage, url and sha256 are required");
  return `${sourcePage}\n${url}\n${sha256}`;
}

export function buildIzhgmuSourceKey(input) {
  return createHash("sha256").update(buildIzhgmuSourceIdentity(input)).digest("hex");
}

function downloadedFiles(report) {
  if (!report || report.university !== "izhgmu" || !Array.isArray(report.files)) {
    throw new Error("Invalid Ижевский ГМУ download report");
  }
  return report.files.filter((item) => item.status === "downloaded" && item.url && item.sha256);
}

export function buildIzhgmuSourceSnapshot({ sourcePage, downloadReport }) {
  if (!sourcePage) throw new Error("sourcePage is required");
  const sources = downloadedFiles(downloadReport)
    .map((item) => ({
      sourcePage,
      url: item.url,
      sha256: item.sha256,
      sourceKey: buildIzhgmuSourceKey({ sourcePage, url: item.url, sha256: item.sha256 }),
      program: item.program || null,
      language: item.language || null,
      course: item.course || null,
      stream: item.stream || null,
      sourceRole: item.sourceRole || null,
      sourceFormat: item.sourceFormat || null,
      filename: item.filename || null,
      bytes: item.bytes || null,
      periodEvidence: item.periodEvidence || [],
    }))
    .sort((a, b) => a.url.localeCompare(b.url));

  return {
    version: 1,
    university: "izhgmu",
    sourcePage,
    capturedAt: downloadReport.downloadedAt || new Date().toISOString(),
    sourceCount: sources.length,
    sources,
  };
}

export function compareIzhgmuSourceSnapshots(previousSnapshot, currentSnapshot) {
  if (!currentSnapshot || currentSnapshot.university !== "izhgmu" || !Array.isArray(currentSnapshot.sources)) {
    throw new Error("Invalid current Ижевский ГМУ source snapshot");
  }
  const previousSources = Array.isArray(previousSnapshot?.sources) ? previousSnapshot.sources : [];
  const previousByUrl = new Map(previousSources.map((item) => [item.url, item]));
  const currentByUrl = new Map(currentSnapshot.sources.map((item) => [item.url, item]));

  const added = [];
  const changed = [];
  const unchanged = [];
  const missing = [];

  for (const current of currentSnapshot.sources) {
    const previous = previousByUrl.get(current.url);
    if (!previous) added.push(current);
    else if (previous.sha256 !== current.sha256) changed.push({ before: previous, after: current });
    else unchanged.push(current);
  }

  for (const previous of previousSources) {
    if (!currentByUrl.has(previous.url)) missing.push(previous);
  }

  const candidateCount = added.length + changed.length;
  return {
    version: 1,
    university: "izhgmu",
    comparedAt: currentSnapshot.capturedAt || new Date().toISOString(),
    added,
    changed,
    unchanged,
    missing,
    candidateCount,
    hasCandidates: candidateCount > 0,
    hasMissingSources: missing.length > 0,
    publicationAction: candidateCount > 0 ? "review-required" : "none",
  };
}
