import { normalizeKgmuAcademicYear } from "./discover.mjs";

export function buildKgmuSourceWatchReport(manifest, config) {
  if (!manifest || manifest.university !== "kgmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid KGMU manifest");
  }
  if (!config || config.university !== "kgmu" || !Array.isArray(config.targetPrograms)) {
    throw new Error("Invalid KGMU source-watch config");
  }

  const expectedAcademicYear = normalizeKgmuAcademicYear(config.expectedAcademicYear);
  const expectedSemester = Number(config.expectedSemester);
  if (!expectedAcademicYear) throw new Error("Invalid expected KGMU academic year");
  if (![1, 2].includes(expectedSemester)) throw new Error("Invalid expected KGMU semester");

  const targetPrograms = config.targetPrograms.map((target) => {
    const allSources = manifest.sources.filter((source) => source.program === target.program);
    const sources = allSources.filter((source) =>
      normalizeKgmuAcademicYear(source.academicYear) === expectedAcademicYear &&
      Number(source.semester) === expectedSemester
    );
    const groups = [...new Set(sources.flatMap((source) => source.groups || []))]
      .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
    const courses = [...new Set(sources.map((source) => Number(source.course)).filter(Boolean))]
      .sort((a, b) => a - b);

    return {
      program: target.program,
      label: target.label,
      available: sources.length > 0,
      sourceCount: sources.length,
      groupCount: groups.length,
      courses,
      groups,
      sources,
      allPublishedSourceCount: allSources.length,
    };
  });

  const availableTargets = targetPrograms.filter((item) => item.available);
  const targetSources = targetPrograms.flatMap((item) => item.sources);
  const sourceUrls = [...new Set(targetSources.map((source) => source.url))];

  return {
    version: 1,
    university: "kgmu",
    checkedAt: manifest.discoveredAt || new Date().toISOString(),
    expectedAcademicYear,
    expectedSemester,
    targetPrograms,
    availableTargetCount: availableTargets.length,
    availableTargets: availableTargets.map((item) => item.program),
    targetSourceCount: sourceUrls.length,
    targetGroupCount: new Set(targetSources.flatMap((source) => source.groups || [])).size,
    hasTargetPeriodSources: sourceUrls.length > 0,
    readyForIngest: sourceUrls.length > 0 && manifest.validation?.status !== "needs-review",
    status: sourceUrls.length === 0
      ? "waiting"
      : manifest.validation?.status === "needs-review"
        ? "needs-review"
        : "ready-for-ingest",
    manifestValidation: manifest.validation || null,
  };
}
