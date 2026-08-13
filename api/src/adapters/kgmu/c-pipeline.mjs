import { parseKgmuCycleWorkbook } from "./cycle-parser.mjs";
import { parseKgmuForeignCycleWorkbook } from "./foreign-c-parser.mjs";
import { parseKgmuForeignCourse5Workbook } from "./foreign-c-course5-reviewed.mjs";
import { parseKgmuForeignCourse6Workbook } from "./foreign-c-course6-reviewed.mjs";

function contextComplete(metadata, period) {
  return Boolean(
    metadata?.program &&
    Number.isInteger(metadata?.course) && metadata.course > 0 &&
    (period?.academicYear || metadata?.academicYear) &&
    [1, 2].includes(period?.semester || metadata?.semester)
  );
}

function foreignCycleCourse(metadata, classification) {
  if (metadata?.program !== "foreign") return null;
  const course = Number(metadata?.course);
  if (![4, 5, 6].includes(course)) return null;
  const groups = classification?.features?.groupCodes || [];
  const expected = new RegExp(`^${course}\\d{2}и$`, "i");
  return groups.length >= 4 && groups.every((code) => expected.test(String(code))) ? course : null;
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

export function applyR69ToForeignCycleQa(input, course) {
  const qa = { ...(input || {}) };
  if (![4, 5, 6].includes(Number(course))) return qa;

  let blocked = false;
  if (Number(course) === 4) {
    blocked = hasItems(qa.unhandledBlocks)
      || hasItems(qa.missingTimes)
      || hasItems(qa.duplicates)
      || !qa.mainGridSubjectDays;
  } else if (Number(course) === 5) {
    blocked = hasItems(qa.unhandledBlocks)
      || hasItems(qa.missingTimes)
      || hasItems(qa.mirrorSemanticRisks)
      || hasItems(qa.duplicates)
      || !qa.mainGridSubjectDays;
  } else {
    blocked = hasItems(qa.unhandledBlocks)
      || hasItems(qa.missingTimes)
      || hasItems(qa.mirrorSemanticRisks)
      || hasItems(qa.unresolvedConfirmedRules)
      || hasItems(qa.duplicates);
  }

  return {
    ...qa,
    status: blocked ? "REVIEW_REQUIRED" : "PASS",
    passed: !blocked,
  };
}

export async function stageCWorkbook({ workbook, queue, sourceSha256, sourceKey, metadata, period, classification }) {
  const foreignCourse = foreignCycleCourse(metadata, classification);
  const parse = foreignCourse === 6
    ? parseKgmuForeignCourse6Workbook
    : foreignCourse === 5
      ? parseKgmuForeignCourse5Workbook
      : foreignCourse === 4
        ? parseKgmuForeignCycleWorkbook
        : parseKgmuCycleWorkbook;
  const parsed = parse(workbook, {
    program: metadata.program || (foreignCourse ? "foreign" : "medicine"),
    course: metadata.course || 4,
    academicYear: period.academicYear || metadata.academicYear || null,
    semester: period.semester || metadata.semester || 2,
    sourceSha256,
  });

  const rawQa = {
    status: parsed.qa?.status || (parsed.qa?.passed ? "PASS" : "REVIEW_REQUIRED"),
    ...parsed.qa,
  };
  const qa = foreignCourse ? applyR69ToForeignCycleQa(rawQa, foreignCourse) : rawQa;
  const parserProfile = parsed.profile || (foreignCourse ? "C-FIO" : "C");
  const schedules = parsed.schedules.map((schedule) => ({
    ...schedule,
    sources: [{ type: "xlsx", filename: metadata.filename, sha256: sourceSha256 }],
    parser: { type: "C", profile: parserProfile, sourceSha256, qaStatus: qa.status },
  }));

  const normalizedKey = await queue.storeNormalized(sourceSha256, {
    version: 1,
    university: "kgmu",
    parserType: "C",
    parserProfile,
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
    parserProfile,
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
