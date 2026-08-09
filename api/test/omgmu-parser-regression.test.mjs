import test from "node:test";
import assert from "node:assert/strict";
import { weeklyParserInternals } from "../src/adapters/omgmu/weekly-parser-blocks.mjs";
import { inspectSchedule } from "../src/adapters/omgmu/quality.mjs";

const { eventDates, cleanTitle } = weeklyParserInternals;

test("weekly parser does not interpret lesson times as calendar dates", () => {
  const source = "С 08.00-10.00 Ин. язык (рус.) 11.04 11.30-13.10";
  assert.deepEqual(eventDates(source, 6), ["2026-04-11"]);
  assert.deepEqual(eventDates(source, 1), []);
});

test("weekly parser removes source dates and stray time fragments from titles", () => {
  const source = "С 08.00-10.00 Ин. язык (рус.) 11.04 11.30-13.10";
  assert.equal(cleanTitle(source, "11.30-13.10", null), "Ин. язык (рус.)");
});

test("quality gate rejects events outside the semester window", () => {
  const result = inspectSchedule({
    academicYear: "2025-2026",
    semester: 2,
    group: { code: "1101" },
    events: [{
      id: "bad-october-event",
      title: "Иностранный язык",
      start: "2026-10-13T11:30:00+06:00",
      end: "2026-10-13T13:10:00+06:00",
    }],
  });
  assert.ok(result.errors.some((item) => item.code === "outside-semester-window"));
});

test("quality gate rejects PDF notes and date fragments in event titles", () => {
  const result = inspectSchedule({
    academicYear: "2025-2026",
    semester: 2,
    group: { code: "1101" },
    events: [{
      id: "bad-title-event",
      title: "ФК и спорт 11.04, занятий предусмотрены сокращения: длинное примечание из PDF",
      start: "2026-04-11T11:30:00+06:00",
      end: "2026-04-11T13:10:00+06:00",
    }],
  });
  const codes = new Set(result.errors.map((item) => item.code));
  assert.ok(codes.has("date-or-time-in-title"));
  assert.ok(codes.has("source-note-in-title"));
});
