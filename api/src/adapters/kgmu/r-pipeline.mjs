import { parseWeeklyRWorkbook } from "./weekly-r-parser.mjs";

function contextComplete(metadata, period) {
  return Boolean(
    metadata?.program &&
    Number.isInteger(metadata?.course) && metadata.course > 0 &&
    (period?.academicYear || metadata?.academicYear) &&
    [1, 2].includes(period?.semester || metadata?.semester)
  );
}

export async function stageRWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const parsed = parseWeeklyRWorkbook(workbook, {
    university: "kgmu",
    program: metadata.program || "medicine",
    course: metadata.course || 1,
    academicYear: period.academicYear || metadata.academicYear || null,
    semester: period.semester || metadata.semester || 2,
  });

  const schedules = parsed.schedules.map((schedule) => ({
    ...schedule,
    sources: [{ type: "xlsx", filename: metadata.filename, sha256: sourceSha256 }],
    parser: { type: "R", sourceSha256, qaStatus: parsed.qa.status },
  }));

  const normalizedKey = await queue.storeNormalized(sourceSha256, {
    version: 1,
    university: "kgmu",
    parserType: "R",
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

  const published = [];
  for (const schedule of normalized.schedules) {
    const result = await scheduleStore.putSchedule({
      ...schedule,
      parserReviewId: review.reviewId,
      publishedAt: new Date().toISOString(),
    });
    published.push({ group: schedule.group?.code, ...result });
  }
  return published;
}
