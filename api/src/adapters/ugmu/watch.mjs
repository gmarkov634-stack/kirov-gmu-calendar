import { ugmuSourceKey } from "./download.mjs";

function assertManifest(manifest) {
  if (!manifest || manifest.university !== "ugmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid UGMU manifest");
  }
}

function assertDownloadReport(report) {
  if (!report || report.university !== "ugmu" || !Array.isArray(report.files)) {
    throw new Error("Invalid UGMU download report");
  }
}

function normalizeKnownVersions(value) {
  if (!value) return new Map();
  if (Array.isArray(value)) {
    return new Map(value
      .filter((item) => item?.sourceKey && item?.sha256)
      .map((item) => [item.sourceKey, item.sha256]));
  }
  if (typeof value === "object") return new Map(Object.entries(value));
  return new Map();
}

export function diffUgmuSourceVersions(previous, current) {
  const previousMap = normalizeKnownVersions(previous);
  const currentFiles = Array.isArray(current) ? current : [];
  const changes = [];

  for (const file of currentFiles) {
    if (file.status !== "downloaded" || !file.sha256) continue;
    const sourceKey = file.sourceKey || ugmuSourceKey(file);
    const previousSha = previousMap.get(sourceKey) || null;
    let changeType = "unchanged";
    if (!previousSha) changeType = "new";
    else if (previousSha !== file.sha256) changeType = "changed";

    changes.push({
      sourceKey,
      changeType,
      previousSha256: previousSha,
      sha256: file.sha256,
      program: file.program,
      semester: file.semester,
      course: file.course,
      stream: file.stream,
      part: file.part,
      label: file.label,
      url: file.url,
      filename: file.filename,
    });
  }

  return changes;
}

export function buildUgmuSourceWatchReport(manifest, downloadReport, config = {}, previousVersions = null) {
  assertManifest(manifest);
  assertDownloadReport(downloadReport);
  if (config.university && config.university !== "ugmu") throw new Error("Invalid UGMU source-watch config");

  const expectedProgram = config.program || manifest.program || "medicine";
  const expectedSemester = config.expectedSemester || "autumn";
  const targetCourses = Array.isArray(config.targetCourses) && config.targetCourses.length
    ? new Set(config.targetCourses.map(Number))
    : new Set([1, 2, 3, 4, 5, 6]);

  const candidates = downloadReport.files.filter((file) => (
    file.status === "downloaded" &&
    file.program === expectedProgram &&
    file.semester === expectedSemester &&
    targetCourses.has(Number(file.course))
  ));

  const availableCourses = [...new Set(candidates.map((item) => Number(item.course)).filter(Number.isInteger))]
    .sort((a, b) => a - b);
  const missingCourses = [...targetCourses]
    .filter((course) => !availableCourses.includes(course))
    .sort((a, b) => a - b);
  const failures = downloadReport.files.filter((file) => file.status === "failed");
  const unresolved = manifest.sources.filter((source) => (
    source.program === expectedProgram &&
    source.semester === expectedSemester &&
    (!Number.isInteger(source.course) || !source.part)
  ));
  const changes = diffUgmuSourceVersions(previousVersions, candidates);
  const newOrChanged = changes.filter((item) => item.changeType !== "unchanged");
  const baselineAvailable = previousVersions !== null && previousVersions !== undefined;

  let status = "ok";
  if (failures.length || unresolved.length) status = "needs-review";
  else if (!candidates.length) status = "waiting";
  else if (!baselineAvailable) status = missingCourses.length
    ? "partial-captured-needs-semantic-review"
    : "captured-needs-semantic-review";
  else if (newOrChanged.length) status = missingCourses.length
    ? "partial-changed-needs-semantic-review"
    : "changed-needs-semantic-review";
  else if (missingCourses.length) status = "partial-waiting";

  return {
    version: 1,
    university: "ugmu",
    checkedAt: downloadReport.downloadedAt || manifest.discoveredAt || new Date().toISOString(),
    sourcePage: manifest.sourcePage,
    program: expectedProgram,
    expectedAcademicYear: config.expectedAcademicYear || null,
    expectedSemester,
    targetCourses: [...targetCourses].sort((a, b) => a - b),
    availableCourses,
    missingCourses,
    semanticReviewRequired: config.semanticReviewRequired !== false,
    autoPublish: false,
    baselineAvailable,
    sourceCount: manifest.sources.length,
    candidateCount: candidates.length,
    failedCount: failures.length,
    unresolvedCount: unresolved.length,
    changeCount: newOrChanged.length,
    candidates,
    failures,
    unresolved,
    changes,
    newOrChanged,
    status,
    publicationAllowed: false,
  };
}
