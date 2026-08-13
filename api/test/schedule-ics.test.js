import test from "node:test";
import assert from "node:assert/strict";
import { versionSchedule } from "../src/schedule/versioning.js";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { buildScheduleIcs } from "../src/schedule/ics.js";
import { buildCalendar } from "../src/calendar.js";

const T1 = "2026-08-13T09:00:00.000Z";
const T2 = "2026-08-13T10:00:00.000Z";

function event({ date = "2026-09-01", start = "09:00", end = "10:30", discipline = "Педиатрия", allDay = false } = {}) {
  return {
    schema_version: "1.0",
    system: { event_id: null, schedule_version_id: null, fingerprint: null, revision: null, created_at: null, updated_at: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
    audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
    timing: { date, start_time: allDay ? null : start, end_time: allDay ? null : end, all_day: allDay, time_mode: "floating" },
    lesson: {
      discipline: { raw: discipline.toUpperCase(), normalized: discipline },
      type: { raw: "практ.", code: "practice" },
      teachers: [],
      locations: [{ raw: "1 корпус, ауд. 305", building: "1 корпус", room: "305", address: "ул. Владимирская, 137" }],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: { file_name: "schedule.xlsx", file_hash: null, sheet: "4 курс", references: [{ role: "lesson", range: "D18:H18" }], raw_text: null },
    parse: { status: "ok", rule_ids: [], warnings: [] },
    derived: { academic_week: null, sequence: { index: null, total: null, bucket: null }, next_same_event: null, is_last_same_event: false, day: { index: null, total: null, remaining: null, next_event: null, gap_minutes: null, overlaps_next: false }, cycle: null, assessment: null },
    calendar: { title: null, description: null, location: null },
  };
}

function batch(events) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu", academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", course: 4, group: "401",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["schedule.xlsx"], generated_at: null, parser: "chatgpt-rules",
      schedule_version_id: null, previous_schedule_version_id: null, content_fingerprint: null, version_created_at: null,
    },
    events,
  };
}

let eventCounter = 0;
let versionCounter = 0;
const eventIdFactory = () => `evt_ics_${++eventCounter}`;
const versionIdFactory = () => `ver_ics_${++versionCounter}`;

function ready(previous, incoming, now) {
  const versioned = versionSchedule(previous, incoming, { eventIdFactory, versionIdFactory, now }).batch;
  return postprocessSchedule(versioned, { includeServiceSignature: false });
}

test("canonical ICS uses stable UID, floating clock time and version timestamps", () => {
  eventCounter = 0;
  versionCounter = 0;
  const current = ready(null, batch([event()]), T1);
  const ics = buildScheduleIcs(current);
  assert.match(ics, /UID:evt_ics_1@kgmu-calendar/);
  assert.match(ics, /DTSTART:20260901T090000/);
  assert.match(ics, /DTEND:20260901T103000/);
  assert.match(ics, /DTSTAMP:20260813T090000Z/);
  assert.match(ics, /CREATED:20260813T090000Z/);
  assert.match(ics, /LAST-MODIFIED:20260813T090000Z/);
  assert.match(ics, /SEQUENCE:0/);
  assert.doesNotMatch(ics, /TZID=/);
  assert.doesNotMatch(ics, /BEGIN:VTIMEZONE/);
  assert.doesNotMatch(ics, /DTSTART[^\r\n]*Z/);
});

test("changed time keeps UID and increments SEQUENCE", () => {
  eventCounter = 0;
  versionCounter = 0;
  const first = ready(null, batch([event()]), T1);
  const second = ready(first, batch([event({ start: "10:40", end: "12:10" })]), T2);
  const firstIcs = buildScheduleIcs(first);
  const secondIcs = buildScheduleIcs(second);
  assert.match(firstIcs, /UID:evt_ics_1@kgmu-calendar/);
  assert.match(secondIcs, /UID:evt_ics_1@kgmu-calendar/);
  assert.match(secondIcs, /DTSTART:20260901T104000/);
  assert.match(secondIcs, /SEQUENCE:1/);
  assert.match(secondIcs, /LAST-MODIFIED:20260813T100000Z/);
});

test("identical version produces byte-identical ICS on repeated reads", () => {
  eventCounter = 0;
  versionCounter = 0;
  const current = ready(null, batch([event()]), T1);
  assert.equal(buildScheduleIcs(current), buildScheduleIcs(current));
});

test("TEXT escaping and UTF-8 folding comply with physical line limit", () => {
  eventCounter = 0;
  versionCounter = 0;
  const longName = "Очень длинное название дисциплины, раздел; с символами и продолжением для проверки корректного UTF-8 folding календарной строки";
  const current = ready(null, batch([event({ discipline: longName })]), T1);
  const ics = buildScheduleIcs(current);
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  assert.match(unfolded, /SUMMARY:Очень длинное название дисциплины\\, раздел\\; с символами/);
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line exceeds 75 bytes: ${line}`);
  }
  assert.match(ics, /\r\n /);
});

test("all-day event uses exclusive next-day DTEND", () => {
  eventCounter = 0;
  versionCounter = 0;
  const versioned = versionSchedule(null, batch([event({ date: "2026-12-16", allDay: true, discipline: "Информационное событие" })]), { eventIdFactory, versionIdFactory, now: T1 }).batch;
  const prepared = structuredClone(versioned);
  prepared.events[0].calendar = { title: "Календарь КГМУ · календарь скоро завершится", description: "Информация", location: null };
  const ics = buildScheduleIcs(prepared);
  assert.match(ics, /DTSTART;VALUE=DATE:20261216/);
  assert.match(ics, /DTEND;VALUE=DATE:20261217/);
});

test("unversioned schedule is rejected instead of generating unstable UIDs", () => {
  assert.throws(() => buildScheduleIcs(batch([event()])), /schedule_version_id/);
});

test("legacy buildCalendar routes canonical schedule-batch to the new generator", () => {
  eventCounter = 0;
  versionCounter = 0;
  const current = ready(null, batch([event()]), T1);
  assert.equal(buildCalendar(current), buildScheduleIcs(current));
});
