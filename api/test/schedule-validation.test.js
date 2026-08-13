import test from "node:test";
import assert from "node:assert/strict";
import { validateJsonSchema } from "../src/schedule/json-schema-validator.js";
import { validateScheduleBatch, validatePostprocessedSchedule, assertSchedulePublishable } from "../src/schedule/validate.js";

function event() {
  return {
    schema_version: "1.0",
    system: { event_id: null, schedule_version_id: null, fingerprint: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date: "2026-09-01", start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: "ПЕДИАТРИЯ", normalized: "Педиатрия" },
      type: { raw: "практ.", code: "practice" },
      teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [],
    },
    source: { file_name: "test.xlsx", file_hash: null, sheet: "4 курс", references: [], raw_text: null },
    parse: { status: "ok", rule_ids: [], warnings: [] },
    derived: {
      academic_week: null,
      sequence: { index: null, total: null, bucket: null },
      next_same_event: null,
      is_last_same_event: false,
      day: { index: null, total: null, remaining: null, next_event: null, gap_minutes: null, overlaps_next: false },
      cycle: null,
      assessment: null,
    },
    calendar: { title: null, description: null, location: null },
  };
}

function batch(events) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu", academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", course: 4, group: "401",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["test.xlsx"], generated_at: null, parser: "chatgpt-rules",
    },
    events,
  };
}

function noSchema(value, options = {}) {
  return validateScheduleBatch(value, { schemaValidation: false, ...options });
}

test("JSON Schema validator covers required, extra properties, refs and dates", () => {
  const child = { $id: "https://example.test/child.json", type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" } } };
  const root = { type: "object", additionalProperties: false, required: ["child"], properties: { child: { $ref: "child.json" } } };
  assert.equal(validateJsonSchema({ child: { date: "2026-09-01" } }, root, { schemas: [child] }).valid, true);
  const invalid = validateJsonSchema({ child: { date: "2026-02-31", extra: 1 } }, root, { schemas: [child] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((item) => item.keyword === "format"));
  assert.ok(invalid.issues.some((item) => item.keyword === "additionalProperties"));
});

test("valid normalized input passes the real schedule schemas", () => {
  const report = validateScheduleBatch(batch([event()]));
  assert.equal(report.publishable, true);
  assert.equal(report.errors.length, 0);
});

test("needs_review blocks publication", () => {
  const item = event();
  item.parse.status = "needs_review";
  const report = noSchema(batch([item]));
  assert.equal(report.publishable, false);
  assert.ok(report.errors.some((entry) => entry.code === "NEEDS_REVIEW"));
});

test("unknown lesson type does not block publication by itself", () => {
  const item = event();
  item.lesson.type = { raw: "неопознанный тип", code: "unknown" };
  item.parse.status = "ok";
  const report = noSchema(batch([item]));
  assert.equal(report.publishable, true);
  assert.equal(report.errors.length, 0);
});

test("batch metadata mismatch is blocking", () => {
  const item = event();
  item.audience.group = "402";
  const report = noSchema(batch([item]));
  assert.ok(report.errors.some((entry) => entry.code === "BATCH_METADATA_MISMATCH"));
});

test("invalid time and out-of-period date are blocking", () => {
  const item = event();
  item.timing.start_time = "11:00";
  item.timing.end_time = "10:30";
  item.timing.date = "2027-01-10";
  const report = noSchema(batch([item]));
  assert.ok(report.errors.some((entry) => entry.code === "INVALID_TIME_RANGE"));
  assert.ok(report.errors.some((entry) => entry.code === "DATE_OUTSIDE_PERIOD"));
});

test("duplicate events are detected", () => {
  const report = noSchema(batch([event(), event()]));
  assert.equal(report.stats.duplicates, 1);
  assert.ok(report.errors.some((entry) => entry.code === "DUPLICATE_EVENT"));
});

test("overlapping events do not block publication or create validator warnings", () => {
  const first = event();
  const second = event();
  second.timing.start_time = "10:00";
  second.timing.end_time = "11:30";
  second.lesson.discipline = { raw: "БИОХИМИЯ", normalized: "Биохимия" };
  const report = noSchema(batch([first, second]));
  assert.equal(report.publishable, true);
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(Object.hasOwn(report.stats, "overlaps"), false);
  assert.equal(Object.hasOwn(report.stats, "confirmed_overlaps"), false);
});

test("postprocessed derived invariants are checked", () => {
  const item = event();
  item.derived.sequence = { index: 2, total: 2, bucket: "class" };
  item.derived.is_last_same_event = false;
  item.derived.day = { index: 2, total: 2, remaining: 1, next_event: { event_id: null, date: "2026-09-01", start_time: "11:00", discipline: "X", type_code: "practice" }, gap_minutes: -5, overlaps_next: false };
  item.calendar = { title: "", description: "", location: null };
  const report = validatePostprocessedSchedule(batch([item]), { schemaValidation: false });
  for (const code of ["LAST_EVENT_FLAG", "DAY_REMAINING", "LAST_DAY_EVENT_STATE", "NEGATIVE_GAP_STATE", "MISSING_CALENDAR_TITLE", "MISSING_CALENDAR_DESCRIPTION"]) {
    assert.ok(report.errors.some((entry) => entry.code === code), code);
  }
});

test("assertSchedulePublishable returns a report or throws with the report", () => {
  const valid = assertSchedulePublishable(batch([event()]), { schemaValidation: false });
  assert.equal(valid.publishable, true);
  const bad = event();
  bad.parse.status = "needs_review";
  assert.throws(
    () => assertSchedulePublishable(batch([bad]), { schemaValidation: false }),
    (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.report.publishable === false,
  );
});
