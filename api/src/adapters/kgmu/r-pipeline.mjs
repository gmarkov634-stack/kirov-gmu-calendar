import { parseWeeklyRWorkbook } from "./weekly-r-parser.mjs";
import { parseForeignRWorkbook } from "./foreign-r-parser.mjs";

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

export async function stageRWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const parse = metadata.program === "foreign" ? parseForeignRWorkbook : parseWeeklyRWorkbook;
  const parsed = parse(workbook, {
    university: "kgmu",
    program: metadata.program || "medicine",
    course: metadata.course || 1,
    academicYear: period.academicYear || metadata.academicYear || null,
    semester: period.semester || metadata.semester || 2,
  });

  const schedules = parsed.schedules.map((schedule) => canonicalizeSourceTrace({
    ...schedule,
    sources: [{
      type: "xlsx",
      fileName: metadata.filename,
      sha256: sourceSha256,
      storageKey: sourceKey,
    }],
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
