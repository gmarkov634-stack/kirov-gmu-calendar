import { createHash } from "node:crypto";

export const IZHGMU_LAUNCH_TARGET = Object.freeze({
  faculty: "medicine",
  courses: Object.freeze([1, 2, 3]),
  academicYear: "2026-2027",
  term: "autumn",
});

function sourceKey(source) {
  return [
    source.faculty,
    source.course,
    source.stream || "",
    source.sourceKind,
    source.language || "ru",
    source.url,
  ].join("|");
}

export function selectIzhgmuLaunchTargetSources(sources, target = IZHGMU_LAUNCH_TARGET) {
  const allowedCourses = new Set(target.courses);
  return (sources || [])
    .filter((source) =>
      source?.faculty === target.faculty &&
      allowedCourses.has(Number(source.course)) &&
      source.academicYear === target.academicYear &&
      source.term === target.term,
    )
    .sort((a, b) => sourceKey(a).localeCompare(sourceKey(b), "en"));
}

function sourceIdentity(source, downloaded) {
  return {
    label: source.label,
    url: source.url,
    faculty: source.faculty,
    course: source.course,
    stream: source.stream || null,
    sourceKind: source.sourceKind,
    language: source.language || "ru",
    academicYear: source.academicYear,
    term: source.term,
    rawWarnings: source.warnings || [],
    status: downloaded?.status || "not-downloaded",
    filename: downloaded?.filename || null,
    spreadsheetKind: downloaded?.spreadsheetKind || null,
    bytes: downloaded?.bytes || null,
    sha256: downloaded?.sha256 || null,
    finalUrl: downloaded?.finalUrl || null,
    error: downloaded?.error || null,
  };
}

function digestIdentities(identities) {
  if (!identities.length || identities.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256 || ""))) return null;
  const canonical = identities
    .map((item) => `${item.url}\0${item.sha256}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function summarizeIzhgmuLaunchTarget({ manifest, downloadReport = null, target = IZHGMU_LAUNCH_TARGET } = {}) {
  if (!manifest || manifest.university !== "izhgmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid IzhGMU discovery manifest");
  }

  const selected = selectIzhgmuLaunchTargetSources(manifest.sources, target);
  const downloadsByUrl = new Map((downloadReport?.files || []).map((item) => [item.url, item]));
  const identities = selected.map((source) => sourceIdentity(source, downloadsByUrl.get(source.url)));
  const failures = identities.filter((item) => item.status === "failed");
  const downloadedCount = identities.filter((item) => item.status === "downloaded").length;
  const allDownloaded = selected.length > 0 && downloadedCount === selected.length;
  const digest = allDownloaded ? digestIdentities(identities) : null;

  let status = "waiting";
  if (selected.length && allDownloaded && digest) status = "candidate";
  else if (selected.length) status = "review-required";

  const coverage = {};
  for (const course of target.courses) {
    const courseSources = selected.filter((item) => Number(item.course) === Number(course));
    coverage[String(course)] = {
      sourceCount: courseSources.length,
      classCount: courseSources.filter((item) => item.sourceKind === "class").length,
      lectureCount: courseSources.filter((item) => item.sourceKind === "lecture").length,
      streams: [...new Set(courseSources.map((item) => item.stream).filter(Boolean))].sort(),
    };
  }

  return {
    version: 1,
    university: "izhgmu",
    observedAt: new Date().toISOString(),
    sourcePage: manifest.sourcePage,
    target: {
      faculty: target.faculty,
      courses: [...target.courses],
      academicYear: target.academicYear,
      term: target.term,
    },
    status,
    candidateSourceCount: selected.length,
    downloadedCount,
    failedCount: failures.length,
    sourceSetDigest: digest,
    pageScheduleContext: manifest.scheduleContext || null,
    discoveryValidation: manifest.validation || null,
    coverage,
    sources: identities,
    safety: {
      parsesSchedules: false,
      publishesSchedules: false,
      opensCatalog: false,
      opensTrials: false,
      opensSales: false,
    },
  };
}
