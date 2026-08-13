import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { publishScheduleBatch } from "../src/schedule/pipeline.js";
import { buildCalendar } from "../src/calendar.js";
import { YearAwareStore } from "../src/year-aware-store.js";

const T1 = "2026-08-13T09:00:00.000Z";
const T2 = "2026-08-13T10:00:00.000Z";

function event({ start = "09:00", end = "10:30", status = "ok" } = {}) {
  return {
    schema_version: "1.0",
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: {
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      faculty_name: "Педиатрический факультет",
      course: 4,
    },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date: "2026-09-14", start_time: start, end_time: end, all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: "ПЕДИАТРИЯ", normalized: "Педиатрия" },
      type: { raw: "практ.", code: "practice" },
      teachers: [],
      locations: [{ raw: "1 корпус, каб. 305", building: "1 корпус", room: "305", address: "ул. Владимирская, 137" }],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: "schedule.xlsx",
      file_hash: null,
      sheet: "4 курс",
      references: [{ role: "lesson", range: "D18:H18" }],
      raw_text: null,
    },
    parse: { status, rule_ids: [], warnings: status === "needs_review" ? ["test"] : [] },
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

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "canonical-pipeline-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return new YearAwareStore({
    dataDir,
    cacheTtlMs: 60_000,
    offerAcademicYear: "2026/2027",
    offerSemester: 1,
  });
}

let eventCounter = 0;
let versionCounter = 0;
const eventIdFactory = () => `evt_pipeline_${++eventCounter}`;
const versionIdFactory = () => `ver_pipeline_${++versionCounter}`;

function options(now) {
  return { now, eventIdFactory, versionIdFactory };
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

test("pipeline atomically publishes current canonical version and updates ICS in place", async (t) => {
  eventCounter = 0;
  versionCounter = 0;
  const store = await fixture(t);

  const first = await publishScheduleBatch({ store, incomingBatch: batch([event()]), ...options(T1) });
  assert.equal(first.diff.counts.added, 1);
  assert.equal(first.publication.unchanged, false);
  assert.equal(first.batch.events[0].system.revision, 1);

  const firstCurrent = await store.getSchedule(context);
  const firstEventId = firstCurrent.events[0].system.event_id;
  const firstVersionId = firstCurrent.schedule.schedule_version_id;
  const firstIcs = buildCalendar(firstCurrent);
  assert.match(firstIcs, new RegExp(`UID:${firstEventId}@kgmu-calendar`));
  assert.match(firstIcs, /DTSTART:20260914T090000/);
  assert.match(firstIcs, /SEQUENCE:0/);

  const manifest = JSON.parse(await fs.readFile(path.join(store.config.dataDir, first.publication.manifestKey), "utf8"));
  assert.equal(manifest.scheduleVersionId, firstVersionId);
  assert.equal(manifest.versionKey, first.publication.versionKey);

  const second = await publishScheduleBatch({
    store,
    incomingBatch: batch([event({ start: "10:40", end: "12:10" })]),
    ...options(T2),
  });
  assert.equal(second.diff.counts.changed, 1);
  assert.equal(second.batch.events[0].system.event_id, firstEventId);
  assert.equal(second.batch.events[0].system.revision, 2);
  assert.notEqual(second.batch.schedule.schedule_version_id, firstVersionId);

  const secondCurrent = await store.getSchedule(context);
  const secondIcs = buildCalendar(secondCurrent);
  assert.match(secondIcs, new RegExp(`UID:${firstEventId}@kgmu-calendar`));
  assert.match(secondIcs, /DTSTART:20260914T104000/);
  assert.match(secondIcs, /SEQUENCE:1/);
});

test("identical re-publication keeps current revision and pointer", async (t) => {
  eventCounter = 0;
  versionCounter = 0;
  const store = await fixture(t);
  const first = await publishScheduleBatch({ store, incomingBatch: batch([event()]), ...options(T1) });
  const second = await publishScheduleBatch({ store, incomingBatch: batch([event()]), ...options(T2) });
  assert.equal(second.diff.same_content, true);
  assert.equal(second.batch.schedule.schedule_version_id, first.batch.schedule.schedule_version_id);
  assert.equal(second.publication.unchanged, true);
});

test("failed validation never moves the published current pointer", async (t) => {
  eventCounter = 0;
  versionCounter = 0;
  const store = await fixture(t);
  const first = await publishScheduleBatch({ store, incomingBatch: batch([event()]), ...options(T1) });
  const before = await store.getSchedule(context);

  await assert.rejects(
    publishScheduleBatch({ store, incomingBatch: batch([event({ status: "needs_review" })]), ...options(T2) }),
    (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.stage === "input",
  );

  const after = await store.getSchedule(context);
  assert.equal(after.schedule.schedule_version_id, before.schedule.schedule_version_id);
  assert.equal(after.schedule.schedule_version_id, first.batch.schedule.schedule_version_id);
});
