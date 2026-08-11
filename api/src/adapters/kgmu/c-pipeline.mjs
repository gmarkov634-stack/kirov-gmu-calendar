import { parseKgmuCycleWorkbook } from "./cycle-parser.mjs";

function contextComplete(metadata, period) {
  return Boolean(
    metadata?.program &&
    Number.isInteger(metadata?.course) && metadata.course > 0 &&
    (period?.academicYear || metadata?.academicYear) &&
    [1, 2].includes(period?.semester || metadata?.semester)
  );
}

export async function stageCWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const parsed = parseKgmuCycleWorkbook(workbook, {
    program: metadata.program || "medicine",
    course: metadata.course || 4,
    academicYear: period.academicYear || metadata.academicYear || null,
    semester: period.semester || metadata.semester || 2,
    sourceSha256,
  });

  const qa = {
    status: parsed.qa?.passed ? "PASS" : "REVIEW_REQUIRED",
    ...parsed.qa,
  };
  const schedules = parsed.schedules.map((schedule) => ({
    ...schedule,
    sources: [{ type: "xlsx", filename: metadata.filename, sha256: sourceSha256 }],
    parser: { type: "C", sourceSha256, qaStatus: qa.status },
  }));

  const normalizedKey = await queue.storeNormalized(sourceSha256, {
    version: 1,
    university: "kgmu",
    parserType: "C",
    sourceSha256,
    sourceKey,
    metadata,
    derivedPeriod: period,
    classification,
    qa,
    schedules,
  });

  return {
    qa,
    schedules,
    normalizedKey,
    contextComplete: contextComplete(metadata, period),
  };
}

export async function publishStagedC({ queue, scheduleStore, review }) {
  if (!review?.normalizedKey || review?.qa?.status !== "PASS") {
    const error = new Error("Parser review is not publishable");
    error.code = "REVIEW_NOT_PUBLISHABLE";
    throw error;
  }
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (
    !normalized ||
    normalized.parserType !== "C" ||
    normalized.sourceSha256 !== review.sourceSha256 ||
    normalized.qa?.status !== "PASS"
  ) {
    const error = new Error("Normalized cyclic result does not match parser review");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }
  if (!Array.isArray(normalized.schedules) || normalized.schedules.length === 0) {
    const error = new Error("Normalized cyclic result has no schedules");
    error.code = "NORMALIZED_RESULT_INVALID";
    throw error;
  }

  const published = await scheduleStore.putScheduleBundle(normalized.schedules.map((schedule) => ({
    ...schedule,
    parserReviewId: review.reviewId,
    publishedAt: new Date().toISOString(),
  })), { sourceSha256: review.sourceSha256 });
  return published;
}
