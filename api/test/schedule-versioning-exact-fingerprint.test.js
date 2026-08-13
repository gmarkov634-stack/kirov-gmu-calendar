import test from "node:test";
import assert from "node:assert/strict";
import { versionSchedule } from "../src/schedule/versioning.js";

function event({ start, end, sourceRange }) {
  return {
    schema_version: "1.0",
    system: { event_id: null, schedule_version_id: null, fingerprint: null, revision: null, created_at: null, updated_at: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2025/2026", semester: 2, faculty_code: "medicine", faculty_name: "Лечебный факультет", course: 4 },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date: "2026-02-03", start_time: start, end_time: end, all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: "ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ", normalized: "Факультетская терапия, профессиональные болезни" },
      type: { raw: "практ.", code: "practice" },
      teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [],
    },
    source: { file_name: "4_kurs.xlsx", file_hash: null, sheet: null, references: [], raw_text: sourceRange },
    parse: { status: "ok", rule_ids: [], warnings: [] },
    derived: {},
    calendar: {},
  };
}

function batch(events) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu", academic_year: "2025/2026", semester: 2, faculty_code: "medicine", course: 4, group: "401",
      period: { start_date: "2026-02-02", end_date: "2026-06-30", week1_start_date: "2026-02-02" },
      source_files: ["4_kurs.xlsx"], generated_at: null, parser: "chatgpt-rules",
      schedule_version_id: null, previous_schedule_version_id: null, content_fingerprint: null, version_created_at: null,
    },
    events,
  };
}

let eventCounter = 0;
let versionCounter = 0;
const options = (now) => ({
  now,
  eventIdFactory: () => `evt_test_${++eventCounter}`,
  versionIdFactory: () => `ver_test_${++versionCounter}`,
});

function makeA() {
  return batch([
    event({ start: "09:00", end: "12:05", sourceRange: "first" }),
    event({ start: "13:00", end: "14:30", sourceRange: "second" }),
  ]);
}

function makeB() {
  return batch([
    event({ start: "09:00", end: "12:04", sourceRange: "first" }),
    event({ start: "13:00", end: "14:30", sourceRange: "second" }),
  ]);
}

test("unchanged sibling keeps UID while one same-day same-discipline event changes", () => {
  eventCounter = 0;
  versionCounter = 0;
  const a1 = versionSchedule(null, makeA(), options("2026-08-13T10:00:00Z")).batch;
  const siblingId = a1.events[1].system.event_id;
  const b = versionSchedule(a1, makeB(), options("2026-08-13T11:00:00Z"));
  assert.equal(b.diff.counts.changed, 1);
  assert.equal(b.diff.counts.unchanged, 1);
  assert.equal(b.batch.events[1].system.event_id, siblingId);
  assert.equal(b.diff.unchanged[0].matched_by, "exact_fingerprint");
});

test("A B A B does not accumulate a second changed event through identity drift", () => {
  eventCounter = 0;
  versionCounter = 0;
  const a1 = versionSchedule(null, makeA(), options("2026-08-13T10:00:00Z")).batch;
  const originalIds = a1.events.map((item) => item.system.event_id);
  const b1 = versionSchedule(a1, makeB(), options("2026-08-13T11:00:00Z"));
  const a2 = versionSchedule(b1.batch, makeA(), options("2026-08-13T12:00:00Z"));
  const b2 = versionSchedule(a2.batch, makeB(), options("2026-08-13T13:00:00Z"));

  for (const step of [b1, a2, b2]) {
    assert.deepEqual(step.diff.counts, { added: 0, changed: 1, removed: 0, unchanged: 1, total_new: 2 });
    assert.deepEqual(step.batch.events.map((item) => item.system.event_id), originalIds);
  }
});
