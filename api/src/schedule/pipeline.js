import { scheduleContext } from "../order-context.js";
import { buildScheduleIcs } from "./ics.js";
import { bindSchedulePersonalizationCatalog } from "./personalization-publication.js";
import { postprocessSchedule } from "./postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "./validate.js";
import { versionSchedule } from "./versioning.js";

function isCanonicalBatch(value) {
  return value?.schema_version === "1.0" && Boolean(value?.schedule) && Array.isArray(value?.events);
}

function validationError(report, stage) {
  const error = new Error(`Schedule ${stage} validation failed: ${report.errors.length} error(s)`);
  error.code = "SCHEDULE_NOT_PUBLISHABLE";
  error.stage = stage;
  error.report = report;
  return error;
}

function requireContext(batch) {
  const context = scheduleContext(batch);
  if (
    !context.university ||
    !context.program ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !context.groupCode ||
    !context.groupId ||
    !context.academicYear ||
    ![1, 2].includes(context.semester)
  ) {
    const error = new Error("Canonical schedule batch has incomplete publication context");
    error.code = "SCHEDULE_CONTEXT_INVALID";
    throw error;
  }
  return context;
}

export function prepareSchedulePublication(incomingBatch, options = {}) {
  if (!isCanonicalBatch(incomingBatch)) {
    const error = new TypeError("Canonical schedule-batch/v1 is required");
    error.code = "SCHEDULE_BATCH_REQUIRED";
    throw error;
  }

  const context = requireContext(incomingBatch);
  const inputQa = validateScheduleBatch(incomingBatch, options.validationOptions);
  if (!inputQa.publishable) throw validationError(inputQa, "input");

  const previousBatch = isCanonicalBatch(options.previousBatch) ? options.previousBatch : null;
  const { batch: versioned, diff } = versionSchedule(previousBatch, incomingBatch, {
    now: options.now,
    eventIdFactory: options.eventIdFactory,
    versionIdFactory: options.versionIdFactory,
  });
  const processed = postprocessSchedule(versioned, options.postprocessOptions);
  const outputQa = validatePostprocessedSchedule(processed, options.validationOptions);
  if (!outputQa.publishable) throw validationError(outputQa, "postprocessed");

  // ICS generation is part of the pre-publication gate: a batch that cannot be
  // rendered as a standards-compliant feed must never become current.
  const ics = buildScheduleIcs(processed, options.icsOptions);

  return {
    context,
    batch: processed,
    diff,
    inputQa,
    outputQa,
    ics,
  };
}

export async function publishScheduleBatch({ store, incomingBatch, personalizationCatalog = null, ...options }) {
  if (!store || typeof store.getSchedule !== "function" || typeof store.putSchedule !== "function") {
    throw new TypeError("Schedule store with getSchedule() and putSchedule() is required");
  }
  if (personalizationCatalog && typeof store.putSchedulePersonalization !== "function") {
    const error = new TypeError("Personalized publication requires putSchedulePersonalization()");
    error.code = "SCHEDULE_PERSONALIZATION_STORE_REQUIRED";
    throw error;
  }

  const context = requireContext(incomingBatch);
  const current = await store.getSchedule({
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

  const prepared = prepareSchedulePublication(incomingBatch, {
    ...options,
    previousBatch: isCanonicalBatch(current) ? current : null,
  });

  let boundPersonalization = null;
  if (personalizationCatalog) {
    boundPersonalization = bindSchedulePersonalizationCatalog(prepared.batch, personalizationCatalog);
    // Write the version-bound sidecar first. Until the matching schedule batch
    // becomes current, readers reject it by version/fingerprint and expose no
    // elective events. This keeps a partial publication fail-closed.
    await store.putSchedulePersonalization(prepared.batch, boundPersonalization);
  }
  const publication = await store.putSchedule(prepared.batch);

  return {
    context: prepared.context,
    batch: prepared.batch,
    diff: prepared.diff,
    inputQa: prepared.inputQa,
    outputQa: prepared.outputQa,
    publication,
    personalization: boundPersonalization ? {
      published: true,
      electiveBlocks: boundPersonalization.electives.length,
      baseSchedule: boundPersonalization.baseSchedule,
    } : { published: false, electiveBlocks: 0 },
    icsBytes: Buffer.byteLength(prepared.ics, "utf8"),
    eventCount: prepared.batch.events.length,
  };
}

export { isCanonicalBatch };
