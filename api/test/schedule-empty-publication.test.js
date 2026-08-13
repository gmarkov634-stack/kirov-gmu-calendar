import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { publishScheduleBatch } from "../src/schedule/pipeline.js";
import { buildCalendar } from "../src/calendar.js";
import { YearAwareStore } from "../src/year-aware-store.js";

function batch(events) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      course: 4,
      group: "401",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["schedule.xlsx"],
      generated_at: null,
      parser: "chatgpt-rules",
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events,
  };
}

function event() {
  return {
    schema_version: "1.0",
    system: { event_id: null, schedule_version_id: null, fingerprint: null, revision: null, created_at: null, updated_at: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date: "2026-09-14", start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: "ПЕДИАТРИЯ", normalized: "Педиатрия" },
      type: { raw: "практ.", code: "practice" },
      teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [],
    },
    source: { file_name: "schedule.xlsx", file_hash: null, sheet: "4 курс", references: [{ role: "lesson", range: "D18:H18" }], raw_text: null },
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

const context = {
  university: "kgmu",
  program: "pediatrics",
  course: 4,
  groupCode: "401",
  groupId: "kgmu:pediatrics:4:401",
  academicYear: "2026/2027",
  semester: 1,
};

test("publishing an empty canonical revision removes the last VEVENT from the subscription snapshot", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty-canonical-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = new YearAwareStore({ dataDir, cacheTtlMs: 60_000, offerAcademicYear: "2026/2027", offerSemester: 1 });
  let eventId = 0;
  let versionId = 0;
  const common = {
    store,
    eventIdFactory: () => `evt_empty_${++eventId}`,
    versionIdFactory: () => `ver_empty_${++versionId}`,
  };

  const first = await publishScheduleBatch({ ...common, incomingBatch: batch([event()]), now: "2026-08-13T09:00:00.000Z" });
  assert.equal(first.eventCount, 1);

  const cleared = await publishScheduleBatch({ ...common, incomingBatch: batch([]), now: "2026-08-13T10:00:00.000Z" });
  assert.equal(cleared.diff.counts.removed, 1);
  assert.equal(cleared.eventCount, 0);
  assert.notEqual(cleared.batch.schedule.schedule_version_id, first.batch.schedule.schedule_version_id);

  const current = await store.getSchedule(context);
  assert.equal(current.events.length, 0);
  const ics = buildCalendar(current);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
});
