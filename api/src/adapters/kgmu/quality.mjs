import { normalizeKgmuAcademicYear } from "./discover.mjs";

function asCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sourceIndex(downloadReport) {
  return new Map(
    (downloadReport?.files || [])
      .filter((item) => item?.filename)
      .map((item) => [item.filename, item]),
  );
}

function samePeriod(report, academicYear, semester) {
  return normalizeKgmuAcademicYear(report?.academicYear) === normalizeKgmuAcademicYear(academicYear) &&
    Number(report?.semester) === Number(semester);
}

function weeklyGroups(report) {
  if (report?.status !== "parsed" || report?.layout !== "weekly-grid") return [];
  return Object.entries(report.groups || {}).map(([groupCode, data]) => {
    const unresolved = asCount(data?.stats?.unresolvedCount);
    const partial = asCount(data?.stats?.partialCount);
    return {
      groupCode,
      eventCount: asCount(data?.stats?.eventCount),
      blockers: {
        unresolved,
        partial,
        reviewMarkers: 0,
      },
      ready: unresolved === 0 && partial === 0 && asCount(data?.stats?.eventCount) > 0,
    };
  });
}

function calendarGroups(report) {
  if (report?.status !== "parsed" || report?.layout !== "calendar-grid") return [];
  return Object.entries(report.groups || {}).map(([groupCode, data]) => {
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    const unresolved = blocks.filter((item) => item?.status === "unresolved").length;
    const partial = blocks.filter((item) => item?.status === "partial").length;
    const reviewMarkers = blocks.filter((item) => item?.status === "marker" && item?.requiresReview).length;
    const eventLikeBlockCount = blocks.filter((item) => item?.kind === "discipline-cycle").length;
    return {
      groupCode,
      eventCount: eventLikeBlockCount,
      blockers: { unresolved, partial, reviewMarkers },
      ready: unresolved === 0 && partial === 0 && reviewMarkers === 0 && eventLikeBlockCount > 0,
    };
  });
}

function reportEntries(bundle, layout, academicYear, semester, sources) {
  const reports = Array.isArray(bundle?.reports) ? bundle.reports : [];
  return reports
    .filter((report) => report?.status === "parsed" && report?.layout === layout)
    .flatMap((report) => {
      const source = sources.get(report.sourceFile) || null;
      const targetPeriod = samePeriod(report, academicYear, semester);
      const groups = layout === "weekly-grid" ? weeklyGroups(report) : calendarGroups(report);
      return groups.map((group) => ({
        university: "kgmu",
        program: report.program,
        course: Number(report.course),
        groupCode: group.groupCode,
        groupId: `kgmu:${report.program}:${Number(report.course)}:${group.groupCode}`,
        layout,
        academicYear: normalizeKgmuAcademicYear(report.academicYear),
        semester: Number(report.semester),
        targetPeriod,
        archiveReferenceOnly: !targetPeriod,
        sourceFile: report.sourceFile,
        sourceUrl: source?.url || null,
        sourceSha256: source?.sha256 || null,
        sourceBytes: source?.bytes || null,
        eventCount: group.eventCount,
        blockers: group.blockers,
        parserReady: group.ready,
        status: !targetPeriod
          ? "archive-reference"
          : group.ready
            ? "ready-for-publication-plan"
            : "blocked-by-parser-qa",
      }));
    });
}

export function buildKgmuQualityReport({
  weeklyReport,
  calendarReport,
  downloadReport,
  academicYear,
  semester,
} = {}) {
  const expectedAcademicYear = normalizeKgmuAcademicYear(academicYear);
  const expectedSemester = Number(semester);
  if (!expectedAcademicYear) throw new Error("Invalid KGMU quality academic year");
  if (![1, 2].includes(expectedSemester)) throw new Error("Invalid KGMU quality semester");

  const sources = sourceIndex(downloadReport);
  const groups = [
    ...reportEntries(weeklyReport, "weekly-grid", expectedAcademicYear, expectedSemester, sources),
    ...reportEntries(calendarReport, "calendar-grid", expectedAcademicYear, expectedSemester, sources),
  ].sort((left, right) =>
    String(left.program).localeCompare(String(right.program)) ||
    left.course - right.course ||
    left.groupCode.localeCompare(right.groupCode, "ru", { numeric: true }),
  );

  const targetGroups = groups.filter((item) => item.targetPeriod);
  const readyGroups = targetGroups.filter((item) => item.status === "ready-for-publication-plan");
  const blockedGroups = targetGroups.filter((item) => item.status === "blocked-by-parser-qa");
  const archiveGroups = groups.filter((item) => item.archiveReferenceOnly);

  return {
    version: 1,
    university: "kgmu",
    expectedAcademicYear,
    expectedSemester,
    generatedAt: new Date().toISOString(),
    targetGroupCount: targetGroups.length,
    readyGroupCount: readyGroups.length,
    blockedGroupCount: blockedGroups.length,
    archiveReferenceGroupCount: archiveGroups.length,
    readyForPublicationPlan: targetGroups.length > 0 && blockedGroups.length === 0,
    status: targetGroups.length === 0
      ? "waiting-for-target-period"
      : blockedGroups.length > 0
        ? "needs-review"
        : "ready-for-publication-plan",
    groups,
  };
}
