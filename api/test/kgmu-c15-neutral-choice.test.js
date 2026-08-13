import test from "node:test";
import assert from "node:assert/strict";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

function neutralChoiceBatch() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2025/2026",
      semester: "spring",
      faculty_code: "medicine",
      course: 6,
      group: "601",
      period: {
        start_date: "2026-01-12",
        end_date: "2026-06-30",
        week1_start_date: "2026-01-12",
      },
      source_files: ["6_kurs_lechebnyy_fakultet.xlsx"],
      generated_at: null,
      parser: "chatgpt-rules",
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events: [{
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
        academic_year: "2025/2026",
        semester: "spring",
        faculty_code: "medicine",
        faculty_name: "Лечебный факультет",
        course: 6,
      },
      audience: { group: "601", scope: "whole_group", subgroups: [], stream: null },
      timing: {
        date: "2026-02-02",
        start_time: null,
        end_time: null,
        all_day: true,
        time_mode: "floating",
      },
      lesson: {
        discipline: { raw: "ДВ.4", normalized: "Дисциплина по выбору" },
        type: { raw: "ДВ.4", code: "other" },
        teachers: [],
        locations: [],
        source_note: "Точные время и место зависят от выбранной дисциплины.",
        cycle_id: "c15-601-dv4",
        joint_groups: [],
      },
      source: {
        file_name: "6_kurs_lechebnyy_fakultet.xlsx",
        file_hash: null,
        sheet: "6 курс Лечебный факультет",
        references: [{ role: "lesson", range: "D14:H14" }],
        raw_text: "ДВ.4",
      },
      parse: {
        status: "warning",
        rule_ids: ["C15"],
        warnings: ["Конкретный вариант дисциплины не уточняется."],
      },
      derived: {
        academic_week: null,
        sequence: { index: null, total: null, bucket: null },
        next_same_event: null,
        is_last_same_event: false,
        day: {
          index: null,
          total: null,
          remaining: null,
          next_event: null,
          gap_minutes: null,
          overlaps_next: false,
        },
        cycle: null,
        assessment: null,
      },
      calendar: { title: null, description: null, location: null },
    }],
  };
}

test("C15 neutral elective is publishable without resolving a concrete discipline", () => {
  const prepared = prepareSchedulePublication(neutralChoiceBatch(), {
    now: "2026-08-14T00:00:00Z",
    eventIdFactory: () => "evt_c15_neutral",
    versionIdFactory: () => "ver_c15_neutral",
  });

  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal(prepared.batch.events[0].lesson.discipline.normalized, "Дисциплина по выбору");
  assert.equal(prepared.batch.events[0].parse.status, "warning");
  assert.equal(prepared.batch.events[0].timing.all_day, true);
  assert.equal(prepared.batch.events[0].timing.start_time, null);
  assert.equal(prepared.batch.events[0].timing.end_time, null);
  assert.equal(prepared.batch.events[0].calendar.title, "Дисциплина по выбору");
  assert.equal(prepared.batch.events[0].calendar.location, null);
  assert.match(prepared.ics, /DTSTART;VALUE=DATE:20260202/);
  assert.match(prepared.ics, /DTEND;VALUE=DATE:20260203/);
  assert.match(prepared.ics, /SUMMARY:Дисциплина по выбору/);
});
