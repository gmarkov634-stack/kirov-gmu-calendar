import { parseWeeklyRWorkbook } from "./weekly-r-parser.mjs";
import { parseMedicineCourse3RWorkbookReviewed } from "./medicine-course3-r-reviewed.mjs";
import { parseForeignRWorkbookReviewed } from "./foreign-r-reviewed.mjs";
import { parsePediatricsRWorkbookReviewed } from "./pediatrics-r-reviewed.mjs";

function contextComplete(metadata, period) {
  return Boolean(
    metadata?.program &&
    Number.isInteger(metadata?.course) && metadata.course > 0 &&
    (period?.academicYear || metadata?.academicYear) &&
    [1, 2].includes(period?.semester || metadata?.semester)
  );
}

function canonicalizeSourceTrace(schedule) {
  return {
    ...schedule,
    events: (schedule.events || []).map((event) => ({
      ...event,
      // Vertical merges are layout only (R46). sourceCell is the canonical
      // trace anchor; sourceRange remains useful diagnostics for true
      // horizontal group-sharing merges.
      source: event.sourceCell || event.source || null,
    })),
  };
}

function parserForContext(program, course) {
  if (program === "foreign") return parseForeignRWorkbookReviewed;
  if (program === "pediatrics") return parsePediatricsRWorkbookReviewed;
  if (program === "medicine" && Number(course) === 3) return parseMedicineCourse3RWorkbookReviewed;
  return parseWeeklyRWorkbook;
}

function parserProfile(program, course) {
  if (program === "foreign") return "R-FIO";
  if (program === "pediatrics") return "R-PED";
  if (program === "medicine" && Number(course) === 3) return "R-MED3";
  return "R";
}

function applyProfileQaPolicy(profile, qa) {
  if (profile !== "R-MED3") return qa;
  const normalized = { ...qa };
  // R69: temporal overlaps stay in remainingOverlaps for diagnostics but do
  // not affect review/publishability. Genuine unresolved parsing issues do.
  normalized.status = Boolean(
    (normalized.uncovered || []).length
    || (normalized.extraLessonFailures || []).length
    || (normalized.normalizationFailures || []).length
  ) ? "REVIEW_REQUIRED" : "PASS";
  return normalized;
}

export async function stageRWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const parse = parserForContext(metadata.program, metadata.course);
  const profile = parserProfile(metadata.program, metadata.course);
  const parsedResult = parse(workbook, {
    university: "kgmu",
    program: metadata.program || "medicine",
    course: metadata.course || 1,
    academicYear: period.academicYear || metadata.academicYear || null,
    semester: period.semester || metadata.semester || 2,
  });
  const parsed = {
    ...parsedResult,
    qa: applyProfileQaPolicy(profile, parsedResult.qa),
  };

  const schedules = parsed.schedules.map((schedule) => canonicalizeSourceTrace({
    ...schedule,
    sources: [{
      type: "xlsx",
      fileName: metadata.filename,
      sha256: sourceSha256,
      storageKey: sourceKey,
    }],
    parser: {
      type: "R",
      profile,
      sourceSha256,
      qaStatus: parsed.qa.status,
    },
  }));

  const normalizedKey = await queue.storeNormalized(sourceSha256, {
    version: 1,
    university: "kgmu",
    parserType: "R",
    parserProfile: profile,
    sourceSha256,
    sourceKey,
    metadata,
    derivedPeriod: period,
    classification,
    qa: parsed.qa,
    schedules,
  });

  return {
    qa: parsed.qa,
    schedules,
    normalizedKey,
    contextComplete: contextComplete(metadata, period),
  };
}

export async function publishStagedR({ queue, scheduleStore, review }) {
  if (!review?.normalizedKey || review?.qa?.status !== "PASS") {
    const error = new Error("Parser review is not publishable");
    error.code = "REVIEW_NOT_PUBLISHABLE";
    throw error;
  }
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (!normalized || normalized.sourceSha256 !== review.sourceSha256 || normalized.qa?.status !== "PASS") {
    const error = new Error("Normalized result does not match parser review");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }
  if (!Array.isArray(normalized.schedules) || normalized.schedules.length === 0) {
    const error = new Error("Normalized result has no schedules");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }
  if (typeof scheduleStore?.putScheduleBundle !== "function") {
    const error = new Error("Atomic schedule bundle publication is unavailable");
    error.code = "ATOMIC_PUBLICATION_UNAVAILABLE";
    throw error;
  }

  const publishedAt = new Date().toISOString();
  const schedules = normalized.schedules.map((schedule) => ({
    ...schedule,
    parserReviewId: review.reviewId,
    publishedAt,
  }));
  const result = await scheduleStore.putScheduleBundle(schedules, {
    sourceSha256: review.sourceSha256,
  });
  return {
    groups: schedules.map((schedule) => schedule.group?.code).filter(Boolean),
    ...result,
  };
}
