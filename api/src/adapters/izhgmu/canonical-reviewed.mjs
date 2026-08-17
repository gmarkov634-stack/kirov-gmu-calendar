import { normalizeAcademicYear, scheduleContext } from "../../order-context.js";
import { prepareSchedulePublication } from "../../schedule/pipeline.js";
import { validateScheduleBatch } from "../../schedule/validate.js";

const FORMAT = "canonical-reviewed/v1";
const PARSER_TYPE = "IZHGMU_CANONICAL_REVIEWED_JSON";
const SHA_RE = /^[a-f0-9]{64}$/;
const ACTIVE_COURSES = new Set([1, 2, 3]);

function fail(message, code = "IZHGMU_CANONICAL_REVIEW_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceHash(value) {
  const text = clean(value, 80).toLowerCase();
  return text.startsWith("sha256:") ? text.slice(7) : text;
}

function semesterNumber(value) {
  if (value === "autumn") return 1;
  if (value === "spring") return 2;
  const number = Number(value);
  return [1, 2].includes(number) ? number : null;
}

function sourceMembers(review) {
  const digest = clean(review?.sourceSet?.digest, 64).toLowerCase();
  if (!SHA_RE.test(digest)) fail("Review has no valid source-set digest", "IZHGMU_SOURCE_SET_INVALID");
  const members = review?.sourceSet?.members;
  if (!Array.isArray(members) || !members.length) fail("Review has no source-set members", "IZHGMU_SOURCE_SET_INVALID");
  const map = new Map();
  for (const member of members) {
    const filename = clean(member.filename, 200);
    const sha = sourceHash(member.sha256);
    if (!filename || !SHA_RE.test(sha)) fail("Invalid source-set member", "IZHGMU_SOURCE_SET_INVALID", { filename: filename || null });
    const previous = map.get(filename);
    if (previous && previous !== sha) fail("Source-set filename maps to multiple hashes", "IZHGMU_SOURCE_SET_INVALID", { filename });
    map.set(filename, sha);
  }
  return { digest, map };
}

function validateContext(batch, review) {
  const context = scheduleContext(batch);
  const metadata = review.metadata || {};
  if (context.university !== "izhgmu" || context.program !== "medicine" || !ACTIVE_COURSES.has(Number(context.course))) {
    fail("Batch is outside active IzhGMU medicine 1-3 scope", "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
  }
  if (metadata.academicYear && normalizeAcademicYear(context.academicYear) !== normalizeAcademicYear(metadata.academicYear)) {
    fail("Batch academic year does not match source review", "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
  }
  if (metadata.semester && semesterNumber(context.semester) !== semesterNumber(metadata.semester)) {
    fail("Batch semester does not match source review", "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
  }
  if (normalizeAcademicYear(context.academicYear) !== "2026/2027" || semesterNumber(context.semester) !== 1) {
    fail("IzhGMU current publication boundary requires 2026/2027 autumn", "IZHGMU_CURRENT_PERIOD_REQUIRED");
  }
  if (!context.groupCode) fail("Batch has no group code", "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
  return context;
}

function bindSourceSet(rawBatch, review) {
  const batch = structuredClone(rawBatch);
  const { map } = sourceMembers(review);
  const sourceFiles = Array.isArray(batch.schedule?.source_files) ? batch.schedule.source_files.map((item) => clean(item, 200)) : [];
  if (!sourceFiles.length) fail("schedule.source_files is required", "IZHGMU_CANONICAL_SOURCE_MISMATCH");
  for (const filename of sourceFiles) if (!map.has(filename)) fail("Batch references file outside reviewed source set", "IZHGMU_CANONICAL_SOURCE_MISMATCH", { filename });

  let boundEventCount = 0;
  for (const event of batch.events || []) {
    const filename = clean(event?.source?.file_name, 200);
    const expected = map.get(filename);
    const declared = sourceHash(event?.source?.file_hash);
    if (!expected) fail("Event source is outside reviewed source set", "IZHGMU_CANONICAL_SOURCE_MISMATCH", { filename: filename || null, group: batch.schedule?.group || null });
    if (declared && declared !== expected) fail("Event source hash does not match reviewed source set", "IZHGMU_CANONICAL_SOURCE_MISMATCH", { filename, expected, actual: declared });
    event.source.file_hash = `sha256:${expected}`;
    boundEventCount += 1;
  }
  if (!boundEventCount) fail("Canonical batch contains no source-bound events", "IZHGMU_CANONICAL_SOURCE_MISMATCH");
  return { batch, boundEventCount };
}

export function validateIzhgmuCanonicalReviewPackage(input, review) {
  if (!review) fail("Parser review not found", "PARSER_REVIEW_NOT_FOUND");
  if (review.university !== "izhgmu") fail("Review is not an IzhGMU review", "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
  if (review.status === "PUBLISHED") fail("Published review cannot be replaced", "REVIEW_ALREADY_PUBLISHED");
  if (!input || typeof input !== "object" || Array.isArray(input) || input.format !== FORMAT) fail(`format must be ${FORMAT}`);
  const sourceSetDigest = clean(input.source_set_digest, 64).toLowerCase();
  if (sourceSetDigest !== clean(review.sourceSet?.digest, 64).toLowerCase()) fail("Package source-set digest does not match review", "IZHGMU_CANONICAL_SOURCE_MISMATCH");
  const rulesRevision = clean(input.rules_revision, 120);
  if (!rulesRevision) fail("rules_revision is required");
  if (!Array.isArray(input.batches) || input.batches.length < 1 || input.batches.length > 100) fail("batches must contain 1 to 100 schedule-batch objects");

  const batches = [];
  const identities = new Set();
  const qaReports = [];
  let sourceBoundEventCount = 0;
  for (const rawBatch of input.batches) {
    const bound = bindSourceSet(rawBatch, review);
    const context = validateContext(bound.batch, review);
    const identity = `${context.course}:${context.stream || ""}:${context.groupId || context.groupCode}`;
    if (identities.has(identity)) fail(`Duplicate group batch: ${identity}`, "IZHGMU_CANONICAL_GROUPS_INVALID");
    identities.add(identity);
    const qa = validateScheduleBatch(bound.batch);
    if (!qa.publishable) fail(`Group ${context.groupCode} canonical batch failed QA`, "IZHGMU_CANONICAL_QA_FAILED", { group: context.groupCode, errors: qa.errors, warnings: qa.warnings });
    sourceBoundEventCount += bound.boundEventCount;
    batches.push(bound.batch);
    qaReports.push({ group: context.groupCode, course: context.course, ...qa });
  }

  return {
    format: FORMAT,
    parserType: PARSER_TYPE,
    rulesRevision,
    sourceSetDigest,
    batches,
    qa: {
      status: "PASS",
      validator: "canonical-schedule-batch-v1+izhgmu-source-set/v1",
      groupCount: batches.length,
      eventCount: batches.reduce((sum, batch) => sum + batch.events.length, 0),
      sourceBoundEventCount,
      groups: batches.map((batch) => batch.schedule.group),
      reports: qaReports,
    },
  };
}

export async function stageIzhgmuCanonicalReviewPackage({ input, review, queue }) {
  const normalized = validateIzhgmuCanonicalReviewPackage(input, review);
  if (typeof queue?.storeNormalized !== "function") fail("Normalized staging is unavailable", "IZHGMU_CANONICAL_STAGING_UNAVAILABLE");
  const normalizedKey = await queue.storeNormalized(normalized.sourceSetDigest, normalized);
  return { ...normalized, normalizedKey };
}

async function previousFor(scheduleStore, batch) {
  const context = scheduleContext(batch);
  return scheduleStore.getSchedule({ university: context.university, program: context.program, course: context.course, stream: context.stream, groupCode: context.groupCode, groupId: context.groupId, academicYear: context.academicYear, semester: context.semester, plan: "semester" });
}

export async function publishStagedIzhgmuCanonicalReview({ queue, scheduleStore, review, now }) {
  if (!review?.normalizedKey || review?.qa?.status !== "PASS" || review?.parserType !== PARSER_TYPE || review?.normalizer?.format !== FORMAT) fail("IzhGMU canonical review is not publishable", "REVIEW_NOT_PUBLISHABLE");
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (!normalized || normalized.parserType !== PARSER_TYPE || normalized.sourceSetDigest !== review.sourceSet?.digest || normalized.qa?.status !== "PASS") fail("Canonical normalized result does not match source-set review", "NORMALIZED_RESULT_INVALID");
  if (typeof scheduleStore?.getSchedule !== "function" || typeof scheduleStore?.putSchedule !== "function") fail("Schedule store unavailable", "CANONICAL_PUBLICATION_UNAVAILABLE");

  const prepared = [];
  for (const batch of normalized.batches || []) {
    const previous = await previousFor(scheduleStore, batch);
    prepared.push(prepareSchedulePublication(batch, { previousBatch: previous?.schema_version === "1.0" && previous?.schedule && Array.isArray(previous?.events) ? previous : null, now }));
  }

  const publications = [];
  try {
    for (const item of prepared) {
      const publication = await scheduleStore.putSchedule(item.batch);
      publications.push({ group: item.context.groupCode, course: item.context.course, scheduleVersionId: item.batch.schedule.schedule_version_id, previousScheduleVersionId: item.batch.schedule.previous_schedule_version_id, contentFingerprint: item.batch.schedule.content_fingerprint, diff: item.diff, publication });
    }
  } catch (error) {
    const wrapped = new Error(`IzhGMU canonical publication stopped after ${publications.length} group(s): ${error?.message || error}`);
    wrapped.code = "CANONICAL_PUBLICATION_PARTIAL";
    wrapped.cause = error;
    wrapped.details = { publishedGroups: publications.map((item) => item.group) };
    throw wrapped;
  }
  return { groupCount: publications.length, eventCount: prepared.reduce((sum, item) => sum + item.batch.events.length, 0), groups: publications.map((item) => item.group), publications };
}

export { FORMAT as IZHGMU_CANONICAL_REVIEW_FORMAT, PARSER_TYPE as IZHGMU_CANONICAL_REVIEW_PARSER_TYPE };
