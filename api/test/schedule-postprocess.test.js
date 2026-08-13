import test from "node:test";
import assert from "node:assert/strict";
import { postprocessSchedule, buildPromotionEvents, POSTPROCESS_SERVICE_URL } from "../src/schedule/postprocess.js";

function event({ date, start, end, discipline = "Педиатрия", type = "practice", rawType = "практ.", eventId = null, subgroups = [], cycleId = null, jointGroups = [] }) {
  return {
    schema_version: "1.0",
    system: { event_id: eventId, schedule_version_id: null, fingerprint: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
    audience: { group: "401", scope: subgroups.length ? "subgroups" : "whole_group", subgroups, stream: null },
    timing: { date, start_time: start, end_time: end, all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: discipline.toUpperCase(), normalized: discipline },
      type: { raw: rawType, code: type },
      teachers: [], locations: [], source_note: null,
      cycle_id: cycleId,
      joint_groups: jointGroups,
    },
    source: { file_name: "test.xlsx", file_hash: null, sheet: "4 курс", references: [], raw_text: null },
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
      source_files: ["test.xlsx"], generated_at: null, parser: "chatgpt-rules",
    },
    events,
  };
}

test("sequences are grouped by normalized discipline and exact lesson type", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30" }),
    event({ date: "2026-09-08", start: "09:00", end: "10:30" }),
    event({ date: "2026-09-03", start: "11:00", end: "12:30", type: "lecture", rawType: "лекция" }),
  ]));
  assert.deepEqual(result.events[0].derived.sequence, { index: 1, total: 2, bucket: "class" });
  assert.deepEqual(result.events[1].derived.sequence, { index: 2, total: 2, bucket: "class" });
  assert.deepEqual(result.events[2].derived.sequence, { index: 1, total: 1, bucket: "lecture" });
  assert.equal(result.events[0].derived.next_same_event.date, "2026-09-08");
  assert.equal(result.events[1].derived.is_last_same_event, true);
});

test("academic week uses the schedule week-1 anchor", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30" }),
    event({ date: "2026-09-14", start: "09:00", end: "10:30" }),
  ]));
  assert.equal(result.events[0].derived.academic_week, 1);
  assert.equal(result.events[1].derived.academic_week, 3);
});

test("daily position, next lesson and remaining count are computed by start time", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "13:00", end: "14:30", discipline: "Фармакология" }),
    event({ date: "2026-09-01", start: "09:00", end: "10:30", discipline: "Педиатрия" }),
    event({ date: "2026-09-01", start: "11:50", end: "12:30", discipline: "Биохимия" }),
  ]));
  const firstChronological = result.events[1];
  assert.equal(firstChronological.derived.day.index, 1);
  assert.equal(firstChronological.derived.day.total, 3);
  assert.equal(firstChronological.derived.day.remaining, 2);
  assert.equal(firstChronological.derived.day.next_event.discipline, "Биохимия");
  assert.equal(firstChronological.derived.day.gap_minutes, 80);
  assert.match(firstChronological.calendar.description, /Занятие сегодня · 1 из 3/);
  assert.match(firstChronological.calendar.description, /До начала следующего занятия: 1 ч 20 мин/);
  assert.match(firstChronological.calendar.description, /Осталось занятий сегодня: 2/);
  const last = result.events[0];
  assert.equal(last.derived.day.remaining, 0);
  assert.equal(last.derived.day.next_event, null);
  assert.match(last.calendar.description, /Следующее занятие сегодня: нет/);
});

test("gap is measured from current end and overlaps are explicit", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "11:10", discipline: "Патофизиология" }),
    event({ date: "2026-09-01", start: "11:00", end: "12:30", discipline: "Организация сестринской помощи", type: "lecture", rawType: "лекция" }),
  ]));
  assert.equal(result.events[0].derived.day.gap_minutes, -10);
  assert.equal(result.events[0].derived.day.overlaps_next, true);
  assert.match(result.events[0].calendar.description, /Перерыв отсутствует: занятия перекрываются/);
});

test("lecture and subgroup titles follow the agreed calendar naming", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30", discipline: "Педиатрия", type: "lecture", rawType: "лекция", subgroups: ["1"] }),
  ]));
  assert.equal(result.events[0].calendar.title, "ЛЕКЦ. ПЕДИАТРИЯ — подгруппа 1");
});

test("cycle progress is based on unique cycle dates", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30", cycleId: "cycle-1" }),
    event({ date: "2026-09-02", start: "09:00", end: "10:30", cycleId: "cycle-1" }),
    event({ date: "2026-09-02", start: "11:00", end: "12:30", cycleId: "cycle-1", type: "lecture", rawType: "лекция" }),
  ]));
  assert.deepEqual(result.events[0].derived.cycle, { index: 1, total: 2, is_first: true, is_last: false });
  assert.deepEqual(result.events[1].derived.cycle, { index: 2, total: 2, is_first: false, is_last: true });
  assert.deepEqual(result.events[2].derived.cycle, { index: 2, total: 2, is_first: false, is_last: true });
});

test("known assessments are surfaced without inventing dates", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30" }),
    event({ date: "2026-09-08", start: "09:00", end: "10:30" }),
    event({ date: "2026-09-15", start: "09:00", end: "10:30", type: "credit", rawType: "зачёт" }),
  ]));
  assert.equal(result.events[0].derived.assessment.date, "2026-09-15");
  assert.equal(result.events[0].derived.assessment.remaining_lessons, 1);
  assert.match(result.events[0].calendar.description, /Зачёт: 15 сентября, 09:00/);
});

test("service signature uses only the agreed project URL", () => {
  const result = postprocessSchedule(batch([
    event({ date: "2026-09-01", start: "09:00", end: "10:30" }),
  ]));
  assert.equal(POSTPROCESS_SERVICE_URL, "https://gmarkov634-stack.github.io/kirov-gmu-calendar/");
  assert.match(result.events[0].calendar.description, /https:\/\/gmarkov634-stack\.github\.io\/kirov-gmu-calendar\//);
});

test("promotion generator creates one neutral reminder and a second only when next period is published", () => {
  const base = batch([]);
  const firstOnly = buildPromotionEvents(base);
  assert.equal(firstOnly.length, 1);
  assert.equal(firstOnly[0].date, "2026-12-16");
  assert.equal(firstOnly[0].url, POSTPROCESS_SERVICE_URL);

  const ready = buildPromotionEvents(base, { nextPeriodAvailable: true, nextPeriodPublishedDate: "2026-12-22" });
  assert.equal(ready.length, 2);
  assert.equal(ready[1].date, "2026-12-22");
});
