import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklySchedules, detectGroupColumns, parseWeeklyTable } from "../src/adapters/omgmu/weekly-parser.mjs";

const fixture = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
                           1101                   1102
понедельник
                           08.00-10.25            10.40-13.05
                           Гистология,            История России,
                           18 зан.: 06.04-03.08   15 зан.: 06.04-13.07
вторник
                           14.30-16.55            10.40-13.05
                           Русский язык,          БОПЗ,
                           15 зан.: 07.04-14.07   4 зан.: 23.06-14.07
`;

test("detects group columns from weekly table header", () => {
  assert.deepEqual(detectGroupColumns(fixture).map((item) => item.code), ["1101", "1102"]);
});

test("parses group-specific weekly events", () => {
  const result = parseWeeklyTable(fixture, { course: 1, stream: "1" });
  assert.ok(result["1101"].length > 0);
  assert.ok(result["1102"].length > 0);
  assert.ok(result["1101"].some((event) => event.title.includes("Гистология")));
  assert.ok(result["1102"].some((event) => event.title.includes("История России")));
  assert.ok(result["1101"].every((event) => event.start.endsWith("+06:00")));
});

test("builds normalized schedules for early-course groups", () => {
  const schedules = buildWeeklySchedules(fixture, { course: 1, stream: "1" });
  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].program, "medicine-international");
  assert.equal(schedules[0].timezone, "Asia/Omsk");
  assert.equal(schedules[0].group.code, "1101");
});
