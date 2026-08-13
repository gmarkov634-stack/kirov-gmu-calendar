import { normalizeAcademicYear, scheduleContext } from "../../order-context.js";
import { prepareSchedulePublication } from "../../schedule/pipeline.js";
import { validateScheduleBatch } from "../../schedule/validate.js";
import { expandGroupRange } from "./reviewed-bundle.mjs";

const SHA_RE = /^[a-f0-9]{64}$/;
const FORMAT = "canonical-reviewed/v1";
const PARSER_TYPE = "CANONICAL_REVIEWED_JSON";

function fail(message, code = "CANONICAL_REVIEW_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function semesterNumber(value) {
  if (value === "autumn") return 1;
  if (value === "spring") return 2;
  const number = Number(value);
  return [1, 2].includes(number) ? number : null;
}

function sameText(left, right) {
  if (!left || !right) return true;
  return clean(left, 100).toLowerCase() === clean(right, 100).toLowerCase();
}

function sourceHash(value) {
  const text = clean(value, 80).toLowerCase();
  return text.startsWith("sha256:") ? text.slice(7) : text;
}

function clone(value) {
  return structuredClone(value);
}

function bindSource(batch, review) {
  const result = clone(batch);
  const sha = clean(review.sourceSha256, 64).toLowerCase();
  const filename = clean(review.metadata?.filename, 200);
  if (!SHA_RE.test(sha)) fail("Parser review has no valid source SHA-256", "CANONICAL_REVIEW_SOURCE_INVALID");
  if (!filename) fail("Parser review has no source filename", "CANONICAL_REVIEW_SOURCE_INVALID");

  if (!Array.isArray(result.schedule?.source_files) || !result.schedule.source_files.includes(filename)) {
    fail(`schedule.source_files must include reviewed source ${filename}`, "CANONICAL_REVIEW_SOURCE_MISMATCH");
  }
  for (const event of result.events || []) {
    if (clean(event?.source?.file_name, 200) !== filename) {
      fail(`Event source.file_name must equal reviewed source ${filename}`, "CANONICAL_REVIEW_SOURCE_MISMATCH", {
        group: result.schedule?.group ?? null,
        eventSource: event?.source?.file_name ?? null,
      });
    }
    const declared = sourceHash(event?.source?.file_hash);
    if (declared && declared !== sha) {
      fail("Event source.file_hash does not match reviewed XLSX", "CANONICAL_REVIEW_SOURCE_MISMATCH", {
        group: result.schedule?.group ?? null,
        expected: sha,
        actual: declared,
      });
    }
    event.source.file_hash = `sha256:${sha}`;
  }
  return result;
}

function validateContext(batch, review) {
  const context = scheduleContext(batch);
  if (context.university !== "kgmu") fail("Canonical review accepts only KGMU batches", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  if (review.metadata?.program && !sameText(context.program, review.metadata.program)) {
    fail("Batch faculty/program does not match parser review", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  }
  if (review.metadata?.course && Number(context.course) !== Number(review.metadata.course)) {
    fail("Batch course does not match parser review", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  }
  if (review.metadata?.academicYear && normalizeAcademicYear(context.academicYear) !== normalizeAcademicYear(review.metadata.academicYear)) {
    fail("Batch academic year does not match parser review", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  }
  if (review.metadata?.semester && semesterNumber(context.semester) !== semesterNumber(review.metadata.semester)) {
    fail("Batch semester does not match parser review", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  }
  if (!context.groupCode) fail("Batch has no group code", "CANONICAL_REVIEW_CONTEXT_MISMATCH");
  return context;
}

export function validateCanonicalReviewPackage(input, review) {
  if (!review) fail("Parser review not found", "PARSER_REVIEW_NOT_FOUND");
  if (review.status === "PUBLISHED") fail("Published parser review cannot be replaced", "REVIEW_ALREADY_PUBLISHED");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Canonical review package must be an object");
  if (input.format !== FORMAT) fail(`format must be ${FORMAT}`);
  const rulesRevision = clean(input.rules_revision, 120);
  if (!rulesRevision) fail("rules_revision is required");
  if (!Array.isArray(input.batches) || input.batches.length === 0 || input.batches.length > 50) {
    fail("batches must contain 1 to 50 schedule-batch objects");
  }

  const batches = [];
  const groups = new Set();
  const qaReports = [];
  for (const rawBatch of input.batches) {
    const batch = bindSource(rawBatch, review);
    const context = validateContext(batch, review);
    if (groups.has(context.groupCode)) fail(`Duplicate group batch: ${context.groupCode}`, "CANONICAL_REVIEW_GROUPS_INVALID");
    groups.add(context.groupCode);
    const qa = validateScheduleBatch(batch);
    if (!qa.publishable) {
      fail(`Group ${context.groupCode} canonical batch failed QA`, "CANONICAL_REVIEW_QA_FAILED", {
        group: context.groupCode,
        errors: qa.errors,
        warnings: qa.warnings,
      });
    }
    batches.push(batch);
    qaReports.push({ group: context.groupCode, ...qa });
  }

  const expected = review.metadata?.groupRange ? expandGroupRange(review.metadata.groupRange) : null;
  if (expected) {
    const actual = [...groups].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
    const sortedExpected = [...expected].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
    if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
      fail("Canonical batches must exactly match parser review group range", "CANONICAL_REVIEW_GROUPS_INVALID", {
        expected: sortedExpected,
        actual,
      });
    }
  }

  return {
    format: FORMAT,
    parserType: PARSER_TYPE,
    rulesRevision,
    sourceSha256: clean(review.sourceSha256, 64).toLowerCase(),
    batches,
    qa: {
      status: "PASS",
      validator: "canonical-schedule-batch-v1",
      groupCount: batches.length,
      eventCount: batches.reduce((sum, batch) => sum + batch.events.length, 0),
      groups: [...groups],
      reports: qaReports,
    },
  };
}

export async function stageCanonicalReviewPackage({ input, review, queue }) {
  if (typeof queue?.storeNormalized !== "function") fail("Normalized staging is unavailable", "CANONICAL_REVIEW_STAGING_UNAVAILABLE");
  const normalized = validateCanonicalReviewPackage(input, review);
  const normalizedKey = await queue.storeNormalized(review.sourceSha256, normalized);
  return { ...normalized, normalizedKey };
}

async function previousFor(scheduleStore, batch) {
  const context = scheduleContext(batch);
  if (typeof scheduleStore?.getSchedule !== "function") fail("Schedule store read is unavailable", "CANONICAL_PUBLICATION_UNAVAILABLE");
  return scheduleStore.getSchedule({
    university: context.university,
    program: context.program,
    course: context.course,
    stream: context.stream,
    groupCode: context.groupCode,
    groupId: context.groupId,
    academicYear: context.academicYear,
    semester: context.semester,
    plan: "semester",
  });
}

export async function publishStagedCanonicalReview({ queue, scheduleStore, review, now }) {
  const canonicalReview = review?.normalizer?.format === FORMAT || review?.parserType === PARSER_TYPE;
  if (!review?.normalizedKey || review?.qa?.status !== "PASS" || !canonicalReview) {
    fail("Canonical parser review is not publishable", "REVIEW_NOT_PUBLISHABLE");
  }
  if (typeof queue?.getNormalized !== "function") fail("Normalized staging read is unavailable", "CANONICAL_PUBLICATION_UNAVAILABLE");
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (
    !normalized ||
    normalized.parserType !== PARSER_TYPE ||
    normalized.sourceSha256 !== review.sourceSha256 ||
    normalized.qa?.status !== "PASS" ||
    !Array.isArray(normalized.batches)
  ) {
    fail("Canonical normalized result does not match parser review", "NORMALIZED_RESULT_INVALID");
  }
  if (typeof scheduleStore?.putSchedule !== "function") fail("Canonical schedule publication is unavailable", "CANONICAL_PUBLICATION_UNAVAILABLE");

  const prepared = [];
  for (const batch of normalized.batches) {
    const previous = await previousFor(scheduleStore, batch);
    const result = prepareSchedulePublication(batch, {
      previousBatch: previous?.schema_version === "1.0" && previous?.schedule && Array.isArray(previous?.events) ? previous : null,
      now,
    });
    prepared.push(result);
  }

  const published = [];
  try {
    for (const item of prepared) {
      const publication = await scheduleStore.putSchedule(item.batch);
      published.push({
        group: item.context.groupCode,
        scheduleVersionId: item.batch.schedule.schedule_version_id,
        previousScheduleVersionId: item.batch.schedule.previous_schedule_version_id,
        contentFingerprint: item.batch.schedule.content_fingerprint,
        diff: item.diff,
        publication,
      });
    }
  } catch (error) {
    const wrapped = new Error(`Canonical review publication stopped after ${published.length} group(s): ${error?.message || error}`);
    wrapped.code = "CANONICAL_PUBLICATION_PARTIAL";
    wrapped.cause = error;
    wrapped.details = { publishedGroups: published.map((item) => item.group) };
    throw wrapped;
  }

  return {
    groupCount: published.length,
    eventCount: prepared.reduce((sum, item) => sum + item.batch.events.length, 0),
    groups: published.map((item) => item.group),
    publications: published,
  };
}

export { FORMAT as CANONICAL_REVIEW_FORMAT, PARSER_TYPE as CANONICAL_REVIEW_PARSER_TYPE };
