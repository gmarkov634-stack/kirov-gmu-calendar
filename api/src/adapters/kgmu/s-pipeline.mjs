import { parseKgmuMixedWorkbookSafe } from "./mixed-s-safe.mjs";

function contextComplete(metadata, period) {
  return Boolean(
    metadata?.program &&
    Number.isInteger(metadata?.course) && metadata.course > 0 &&
    (period?.academicYear || metadata?.academicYear) &&
    [1, 2].includes(period?.semester || metadata?.semester)
  );
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

export function applyR69ToMixedQa(input) {
  const qa = { ...(input || {}) };
  const blocked = hasItems(qa.uncovered)
    || hasItems(qa.extraLessonFailures)
    || Number(qa.duplicateCount || 0) > 0;

  return {
    ...qa,
    status: blocked ? "REVIEW_REQUIRED" : "PASS",
    passed: !blocked,
  };
}

export async function stageSWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const parsed = parseKgmuMixedWorkbookSafe(workbook, {
    program: metadata.program || "dentistry",
    course: metadata.course || 2,
    academicYear: period.academicYear || metadata.academicYear || "2025/26",
    semester: period.semester || metadata.semester || 2,
  });
  const rawQa = {
    status: parsed.qa?.passed ? "PASS" : "REVIEW_REQUIRED",
    ...parsed.qa,
  };
  const qa = applyR69ToMixedQa(rawQa);
  const schedules = parsed.schedules.map((schedule) => ({
    ...schedule,
    sources: [{ type: "xlsx", filename: metadata.filename, sha256: sourceSha256 }],
    parser: { type: "S", sourceSha256, qaStatus: qa.status },
  }));
  const normalizedKey = await queue.storeNormalized(sourceSha256, {
    version: 1,
    university: "kgmu",
    parserType: "S",
    sourceSha256,
    sourceKey,
    metadata,
    derivedPeriod: period,
    classification,
    qa,
    schedules,
  });
  return { qa, schedules, normalizedKey, contextComplete: contextComplete(metadata, period) };
}

export async function publishStagedS({ queue, scheduleStore, review }) {
  if (!review?.normalizedKey || review?.qa?.status !== "PASS") {
    const error = new Error("Parser review is not publishable");
    error.code = "REVIEW_NOT_PUBLISHABLE";
    throw error;
  }
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (
    !normalized ||
    normalized.parserType !== "S" ||
    normalized.sourceSha256 !== review.sourceSha256 ||
    normalized.qa?.status !== "PASS"
  ) {
    const error = new Error("Normalized mixed result does not match parser review");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }
  if (!Array.isArray(normalized.schedules) || normalized.schedules.length === 0) {
    const error = new Error("Normalized mixed result has no schedules");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }
  return scheduleStore.putScheduleBundle(normalized.schedules.map((schedule) => ({
    ...schedule,
    parserReviewId: review.reviewId,
    publishedAt: new Date().toISOString(),
  })), { sourceSha256: review.sourceSha256 });
}
