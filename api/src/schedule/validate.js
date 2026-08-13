import { readFileSync } from "node:fs";
import { validateJsonSchema } from "./json-schema-validator.js";

const DEFAULT_CONFIRMED_OVERLAP_RULE_IDS = new Set(["R69"]);

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

let cachedSchemas = null;
function loadSchemas() {
  if (!cachedSchemas) {
    cachedSchemas = {
      batch: readJson(new URL("../../../schemas/schedule-batch.schema.json", import.meta.url)),
      event: readJson(new URL("../../../schemas/schedule-event.schema.json", import.meta.url)),
    };
  }
  return cachedSchemas;
}

function issue(code, message, path = "/", extra = {}) {
  return { code, message, path, ...extra };
}

function eventMeta(event, index) {
  return {
    event_index: index,
    event_id: event?.system?.event_id ?? null,
  };
}

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalized(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function sameValue(a, b) {
  return (a ?? null) === (b ?? null);
}

function hasConfirmedOverlap(event, ruleIds) {
  const applied = new Set(event?.parse?.rule_ids || []);
  return [...ruleIds].some((ruleId) => applied.has(ruleId));
}

function subgroupsDisjoint(a, b) {
  if (a?.audience?.scope !== "subgroups" || b?.audience?.scope !== "subgroups") return false;
  const left = new Set(a.audience.subgroups || []);
  const right = new Set(b.audience.subgroups || []);
  if (!left.size || !right.size) return false;
  return [...left].every((value) => !right.has(value));
}

function locationKey(event) {
  return (event?.lesson?.locations || []).map((location) => [
    normalized(location?.building),
    normalized(location?.room),
    normalized(location?.address),
    normalized(location?.raw),
  ].join("|")).sort().join("||");
}

function duplicateKey(event) {
  return [
    event?.audience?.group,
    event?.timing?.date,
    event?.timing?.start_time,
    event?.timing?.end_time,
    normalized(event?.lesson?.discipline?.normalized),
    event?.lesson?.type?.code,
    locationKey(event),
    (event?.audience?.subgroups || []).slice().sort().join(","),
  ].join("\u0001");
}

function validateMetadata(batch, errors) {
  const schedule = batch?.schedule || {};
  for (const [index, event] of (batch?.events || []).entries()) {
    const checks = [
      [event?.university?.code, schedule.university_code, "university.code", "university_code"],
      [event?.academic?.academic_year, schedule.academic_year, "academic.academic_year", "academic_year"],
      [event?.academic?.semester, schedule.semester, "academic.semester", "semester"],
      [event?.academic?.faculty_code, schedule.faculty_code, "academic.faculty_code", "faculty_code"],
      [event?.academic?.course, schedule.course, "academic.course", "course"],
      [event?.audience?.group, schedule.group, "audience.group", "group"],
    ];
    for (const [eventValue, scheduleValue, eventField, scheduleField] of checks) {
      if (!sameValue(eventValue, scheduleValue)) {
        errors.push(issue(
          "BATCH_METADATA_MISMATCH",
          `${eventField} must match schedule.${scheduleField}`,
          `/events/${index}/${eventField.replaceAll(".", "/")}`,
          eventMeta(event, index),
        ));
      }
    }
  }
}

function validateCoreEvent(event, index, batch, errors) {
  const meta = eventMeta(event, index);
  const timing = event?.timing || {};
  if (timing.all_day === false) {
    const start = timeMinutes(timing.start_time);
    const end = timeMinutes(timing.end_time);
    if (start === null || end === null) {
      errors.push(issue("MISSING_TIME", "Timed event must have start_time and end_time", `/events/${index}/timing`, meta));
    } else if (start >= end) {
      errors.push(issue("INVALID_TIME_RANGE", "start_time must be earlier than end_time", `/events/${index}/timing`, meta));
    }
  }

  const audience = event?.audience || {};
  if (audience.scope === "whole_group" && (audience.subgroups || []).length) {
    errors.push(issue("WHOLE_GROUP_WITH_SUBGROUPS", "whole_group event must not contain subgroups", `/events/${index}/audience/subgroups`, meta));
  }
  if (audience.scope === "subgroups" && !(audience.subgroups || []).length) {
    errors.push(issue("SUBGROUP_SCOPE_EMPTY", "subgroups scope requires at least one subgroup", `/events/${index}/audience/subgroups`, meta));
  }

  if (event?.lesson?.type?.code === "unknown" && event?.parse?.status !== "needs_review") {
    errors.push(issue("UNKNOWN_TYPE_NOT_REVIEWED", "unknown lesson type requires parse.status = needs_review", `/events/${index}/parse/status`, meta));
  }
  if (event?.parse?.status === "needs_review") {
    errors.push(issue("NEEDS_REVIEW", "Event requires manual review and blocks publication", `/events/${index}/parse/status`, meta));
  }

  const date = timing.date;
  const period = batch?.schedule?.period;
  if (date && period?.start_date && period?.end_date && (date < period.start_date || date > period.end_date)) {
    errors.push(issue("DATE_OUTSIDE_PERIOD", "Event date is outside schedule.period", `/events/${index}/timing/date`, meta));
  }
}

function validateDerived(event, index, stage, errors) {
  const meta = eventMeta(event, index);
  const derived = event?.derived || {};
  const sequence = derived.sequence || {};
  if (sequence.index !== null && sequence.total !== null && sequence.index > sequence.total) {
    errors.push(issue("SEQUENCE_RANGE", "sequence.index must not exceed sequence.total", `/events/${index}/derived/sequence`, meta));
  }
  if (derived.is_last_same_event === true && derived.next_same_event !== null) {
    errors.push(issue("LAST_EVENT_HAS_NEXT", "Last same-type event must not have next_same_event", `/events/${index}/derived/next_same_event`, meta));
  }
  if (stage === "postprocessed" && sequence.index !== null && sequence.total !== null) {
    const expectedLast = sequence.index === sequence.total;
    if (derived.is_last_same_event !== expectedLast) {
      errors.push(issue("LAST_EVENT_FLAG", "is_last_same_event does not match sequence position", `/events/${index}/derived/is_last_same_event`, meta));
    }
    if (!expectedLast && derived.next_same_event === null) {
      errors.push(issue("MISSING_NEXT_SAME_EVENT", "Non-last sequence event must have next_same_event", `/events/${index}/derived/next_same_event`, meta));
    }
  }

  const day = derived.day || {};
  if (day.index !== null && day.total !== null) {
    if (day.index > day.total) {
      errors.push(issue("DAY_RANGE", "day.index must not exceed day.total", `/events/${index}/derived/day`, meta));
    }
    if (day.remaining !== null && day.remaining !== day.total - day.index) {
      errors.push(issue("DAY_REMAINING", "day.remaining must equal day.total - day.index", `/events/${index}/derived/day/remaining`, meta));
    }
    if (day.index === day.total && (day.next_event !== null || day.remaining !== 0)) {
      errors.push(issue("LAST_DAY_EVENT_STATE", "Last event of day must have next_event = null and remaining = 0", `/events/${index}/derived/day`, meta));
    }
  }
  if (day.overlaps_next === true && !(Number.isInteger(day.gap_minutes) && day.gap_minutes < 0)) {
    errors.push(issue("OVERLAP_GAP_STATE", "overlaps_next requires negative gap_minutes", `/events/${index}/derived/day`, meta));
  }
  if (day.overlaps_next === false && Number.isInteger(day.gap_minutes) && day.gap_minutes < 0) {
    errors.push(issue("NEGATIVE_GAP_STATE", "Negative gap_minutes requires overlaps_next = true", `/events/${index}/derived/day`, meta));
  }

  const cycle = derived.cycle;
  if (cycle) {
    if (cycle.index > cycle.total) {
      errors.push(issue("CYCLE_RANGE", "cycle.index must not exceed cycle.total", `/events/${index}/derived/cycle`, meta));
    }
    if (cycle.is_first !== (cycle.index === 1)) {
      errors.push(issue("CYCLE_FIRST_FLAG", "cycle.is_first does not match cycle.index", `/events/${index}/derived/cycle/is_first`, meta));
    }
    if (cycle.is_last !== (cycle.index === cycle.total)) {
      errors.push(issue("CYCLE_LAST_FLAG", "cycle.is_last does not match cycle position", `/events/${index}/derived/cycle/is_last`, meta));
    }
  }

  if (stage === "postprocessed") {
    if (!String(event?.calendar?.title || "").trim()) {
      errors.push(issue("MISSING_CALENDAR_TITLE", "Postprocessed event requires calendar.title", `/events/${index}/calendar/title`, meta));
    }
    if (!String(event?.calendar?.description || "").trim()) {
      errors.push(issue("MISSING_CALENDAR_DESCRIPTION", "Postprocessed event requires calendar.description", `/events/${index}/calendar/description`, meta));
    }
  }
}

function validateDuplicates(events, errors, stats) {
  const seen = new Map();
  for (const [index, event] of events.entries()) {
    const key = duplicateKey(event);
    if (!seen.has(key)) {
      seen.set(key, index);
      continue;
    }
    const firstIndex = seen.get(key);
    stats.duplicates += 1;
    errors.push(issue(
      "DUPLICATE_EVENT",
      `Suspicious duplicate of events[${firstIndex}]`,
      `/events/${index}`,
      { ...eventMeta(event, index), duplicate_of_index: firstIndex },
    ));
  }
}

function validateOverlaps(events, errors, warnings, stats, confirmedRuleIds) {
  const byDate = new Map();
  for (const [index, event] of events.entries()) {
    if (event?.timing?.all_day === true) continue;
    const start = timeMinutes(event?.timing?.start_time);
    const end = timeMinutes(event?.timing?.end_time);
    if (start === null || end === null || start >= end) continue;
    const date = event?.timing?.date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ index, event, start, end });
  }

  for (const items of byDate.values()) {
    items.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        const a = items[left];
        const b = items[right];
        if (b.start >= a.end) break;
        if (subgroupsDisjoint(a.event, b.event)) continue;
        if (duplicateKey(a.event) === duplicateKey(b.event)) continue;

        stats.overlaps += 1;
        const confirmed = hasConfirmedOverlap(a.event, confirmedRuleIds) && hasConfirmedOverlap(b.event, confirmedRuleIds);
        const details = {
          event_indexes: [a.index, b.index],
          event_ids: [a.event?.system?.event_id ?? null, b.event?.system?.event_id ?? null],
          date: a.event?.timing?.date,
        };
        if (confirmed) {
          stats.confirmed_overlaps += 1;
          warnings.push(issue("CONFIRMED_OVERLAP", "Confirmed source overlap preserved", `/events/${a.index}`, details));
        } else {
          errors.push(issue("UNCONFIRMED_OVERLAP", "Overlapping events require explicit source confirmation", `/events/${a.index}`, details));
        }
      }
    }
  }
}

export function validateScheduleBatch(batch, options = {}) {
  const stage = options.stage === "postprocessed" ? "postprocessed" : "input";
  const errors = [];
  const warnings = [];
  const stats = {
    events: Array.isArray(batch?.events) ? batch.events.length : 0,
    needs_review: 0,
    duplicates: 0,
    overlaps: 0,
    confirmed_overlaps: 0,
  };

  if (options.schemaValidation !== false) {
    const schemas = options.schemas || loadSchemas();
    const schemaResult = validateJsonSchema(batch, schemas.batch, { schemas: [schemas.event] });
    for (const schemaIssue of schemaResult.issues) {
      errors.push(issue("SCHEMA_VALIDATION", schemaIssue.message, schemaIssue.path, { keyword: schemaIssue.keyword }));
    }
  }

  if (!batch || !Array.isArray(batch.events) || !batch.schedule) {
    return {
      stage,
      valid: false,
      publishable: false,
      errors,
      warnings,
      stats,
    };
  }

  stats.needs_review = batch.events.filter((event) => event?.parse?.status === "needs_review").length;

  validateMetadata(batch, errors);
  for (const [index, event] of batch.events.entries()) {
    validateCoreEvent(event, index, batch, errors);
    validateDerived(event, index, stage, errors);
  }
  validateDuplicates(batch.events, errors, stats);

  const confirmedRuleIds = new Set(options.confirmedOverlapRuleIds || DEFAULT_CONFIRMED_OVERLAP_RULE_IDS);
  validateOverlaps(batch.events, errors, warnings, stats, confirmedRuleIds);

  return {
    stage,
    valid: errors.length === 0,
    publishable: errors.length === 0,
    errors,
    warnings,
    stats: {
      ...stats,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function validatePostprocessedSchedule(batch, options = {}) {
  return validateScheduleBatch(batch, { ...options, stage: "postprocessed" });
}

export function assertSchedulePublishable(batch, options = {}) {
  const report = validateScheduleBatch(batch, options);
  if (!report.publishable) {
    const error = new Error(`Schedule batch is not publishable: ${report.errors.length} validation error(s)`);
    error.code = "SCHEDULE_NOT_PUBLISHABLE";
    error.report = report;
    throw error;
  }
  return report;
}
