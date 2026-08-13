import test from "node:test";
import assert from "node:assert/strict";
import { versionSchedule, eventFingerprint } from "../src/schedule/versioning.js";

function makeEvent({ date = "2026-09-01", start = "09:00", end = "10:30", discipline = "Педиатрия", type = "practice", room = "305", eventId = null, sourceRange = "D18:H18" } = {}) {
  return {
    schema_version: "1.0",
    system: { event_id: eventId, schedule_version_id: null, fingerprint: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date, start_time: start, end_time: end, all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: discipline.toUpperCase(), normalized: discipline },
      type: { raw: type === "lecture" ? "лекция" : "практ.", code: type },
      teachers: [],
      locations: [{ raw: `каб. ${room}`, building: "1 корпус", room, address: "ул. Владимирская, 137" }],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: { file_name: "schedule.xlsx", file_hash: null, sheet: "4 курс", references: [{ role: "lesson", range: sourceRange }], raw_text: null },
    parse: { status: "ok", rule_ids: [], warnings: [] },
    derived: { academic_week: null, sequence: { index: null, total: null, bucket: null }, next_same_event: null, is_last_same_event: false, day: { index: null, total: null, remaining: null, next_event: null, gap_minutes: null, overlaps_next: false }, cycle: null, assessment: null },
    calendar: { title: null, description: null, location: null },
  };
}

function makeBatch(events) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu", academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", course: 4, group: "401",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["schedule.xlsx"], generated_at: null, parser: "chatgpt-rules",
      schedule_version_id: null, previous_schedule_version_id: null, content_fingerprint: null,
    },
    events,
  };
}

let counter = 0;
const idFactory = () => `evt_test_${++counter}`;
let versionCounter = 0;
const versionFactory = () => `ver_test_${++versionCounter}`;

test("first import assigns event IDs, fingerprints and one version ID", () => {
  counter = 0;
  versionCounter = 0;
  const { batch, diff } = versionSchedule(null, makeBatch([makeEvent(), makeEvent({ date: "2026-09-08" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(batch.events[0].system.event_id, "evt_test_1");
  assert.equal(batch.events[1].system.event_id, "evt_test_2");
  assert.match(batch.events[0].system.fingerprint, /^sha256:/);
  assert.match(batch.schedule.schedule_version_id, /^ver_/);
  assert.equal(batch.events[0].system.schedule_version_id, batch.schedule.schedule_version_id);
  assert.deepEqual(diff.counts, { added: 2, changed: 0, removed: 0, unchanged: 0, total_new: 2 });
});

test("same event with changed time preserves event_id and is changed", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([makeEvent()]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const second = versionSchedule(first, makeBatch([makeEvent({ start: "10:40", end: "12:10" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.batch.events[0].system.event_id, first.events[0].system.event_id);
  assert.equal(second.diff.counts.changed, 1);
  assert.equal(second.diff.changed[0].matched_by, "occurrence_anchor");
  assert.ok(second.diff.changed[0].changes.some((item) => item.path === "/timing/start_time"));
});

test("identical re-import remains on the current revision", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([makeEvent()]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const second = versionSchedule(first, makeBatch([makeEvent()]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.diff.counts.unchanged, 1);
  assert.equal(second.diff.same_content, true);
  assert.equal(second.batch.schedule.schedule_version_id, first.schedule.schedule_version_id);
  assert.equal(second.batch.schedule.previous_schedule_version_id, first.schedule.previous_schedule_version_id);
});

test("source anchor preserves id when date changes", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([makeEvent({ date: "2026-09-01", sourceRange: "D18:H18" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const second = versionSchedule(first, makeBatch([makeEvent({ date: "2026-09-02", sourceRange: "D18:H18" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.batch.events[0].system.event_id, first.events[0].system.event_id);
  assert.equal(second.diff.changed[0].matched_by, "source_anchor");
});

test("added and removed events are classified separately", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([makeEvent({ discipline: "Педиатрия" }), makeEvent({ discipline: "Биохимия", sourceRange: "I18:L18" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const second = versionSchedule(first, makeBatch([makeEvent({ discipline: "Педиатрия" }), makeEvent({ discipline: "Фармакология", sourceRange: "M18:P18" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.diff.counts.added, 1);
  assert.equal(second.diff.counts.removed, 1);
  assert.equal(second.diff.added[0].discipline, "Фармакология");
  assert.equal(second.diff.removed[0].discipline, "Биохимия");
});

test("recurring ambiguous events are not fuzzily cross-matched", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([
    makeEvent({ date: "2026-09-01", sourceRange: "D18" }),
    makeEvent({ date: "2026-09-08", sourceRange: "D19" }),
  ]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const incoming = makeBatch([
    makeEvent({ date: "2026-09-02", sourceRange: "X1" }),
    makeEvent({ date: "2026-09-09", sourceRange: "X2" }),
  ]);
  const second = versionSchedule(first, incoming, { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.diff.counts.added, 2);
  assert.equal(second.diff.counts.removed, 2);
  assert.equal(second.diff.counts.changed, 0);
});

test("event fingerprint ignores source and rendered calendar but reacts to core changes", () => {
  const base = makeEvent();
  const sourceChanged = structuredClone(base);
  sourceChanged.source.raw_text = "другая исходная строка";
  sourceChanged.calendar.title = "Другое отображение";
  assert.equal(eventFingerprint(sourceChanged), eventFingerprint(base));
  const coreChanged = structuredClone(base);
  coreChanged.lesson.locations[0].room = "306";
  assert.notEqual(eventFingerprint(coreChanged), eventFingerprint(base));
});

test("incoming existing event_id has highest matching priority", () => {
  counter = 0;
  versionCounter = 0;
  const first = versionSchedule(null, makeBatch([makeEvent({ eventId: "evt_fixed" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const incoming = makeEvent({ date: "2026-10-01", sourceRange: "Z99", eventId: "evt_fixed" });
  const second = versionSchedule(first, makeBatch([incoming]), { eventIdFactory: idFactory, versionIdFactory: versionFactory });
  assert.equal(second.diff.counts.changed, 1);
  assert.equal(second.diff.changed[0].matched_by, "event_id");
  assert.equal(second.batch.events[0].system.event_id, "evt_fixed");
});

test("A to B to A creates a new revision instead of reusing the old version id", () => {
  counter = 0;
  versionCounter = 0;
  const a1 = versionSchedule(null, makeBatch([makeEvent({ start: "09:00" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const b = versionSchedule(a1, makeBatch([makeEvent({ start: "10:40" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  const a2 = versionSchedule(b, makeBatch([makeEvent({ start: "09:00" })]), { eventIdFactory: idFactory, versionIdFactory: versionFactory }).batch;
  assert.notEqual(a2.schedule.schedule_version_id, a1.schedule.schedule_version_id);
  assert.equal(a2.schedule.previous_schedule_version_id, b.schedule.schedule_version_id);
  assert.equal(a2.schedule.content_fingerprint, a1.schedule.content_fingerprint);
});
