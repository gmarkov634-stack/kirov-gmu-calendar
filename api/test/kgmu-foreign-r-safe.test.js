import test from "node:test";
import assert from "node:assert/strict";
import { parseForeignRWorkbookSafe } from "../src/adapters/kgmu/foreign-r-safe.mjs";

function cell(ref, row, col, value) {
  return { ref, row, col, value };
}

function fixture() {
  return {
    sheets: [{
      name: "1 ФИО",
      merges: [],
      cells: [
        cell("A1", 1, 1, "РАСПИСАНИЕ 1 КУРСА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 уч.г."),
        cell("A2", 2, 1, "30.03.2026-25.06.2026; 04.09.2026-17.10-2026"),
        cell("B3", 3, 2, "группа 101 и"),
        cell("C3", 3, 3, "группа 102i"),
        cell("A4", 4, 1, "ПН"),
        cell("B4", 4, 2, "15.00-16.00 Час куратора (30.03, 13.04, 27.04, 11.05-16.40-17.40)"),
        cell("C4", 4, 3, "8.30-10.00 Медицинская информатика 07.09-26.10 3-414"),
        // Row 5 intentionally has no weekday label; dates identify it as Monday.
        cell("B5", 5, 2, "10.00-11.30 Медицинская биология 06.04"),
        cell("C5", 5, 3, "10.00-11.30 Медицинская биология 06.04"),
        cell("A6", 6, 1, "ВТ"),
        cell("B6", 6, 2, "9.00-10.30 Иностранный язык (русский язык) 31.03"),
        cell("C6", 6, 3, "9.00-10.30 Иностранный язык (русский язык) 31.03"),
        cell("A8", 8, 1, "Дисциплина (101и-110и)"),
        cell("C8", 8, 3, "Кафедра/База практической подготовки"),
        cell("D8", 8, 4, "Форма промежуточной аттестации"),
        cell("E8", 8, 5, "Дисциплина (101и-110и)"),
        cell("H8", 8, 8, "Кафедра"),
        cell("I8", 8, 9, "База практической подготовки"),
        cell("K8", 8, 11, "Форма промежуточной аттестации"),
        cell("A9", 9, 1, "Медицинская биология"),
        cell("C9", 9, 3, "биологии (3 корпус, ул. Владимирская, 112)"),
        cell("D9", 9, 4, "экзамен"),
        cell("E9", 9, 5, "Медицинская информатика"),
        cell("H9", 9, 8, "физики, медицинской информатики и математики"),
        cell("I9", 9, 9, "3 корпус, ул. Владимирская, 112, аудитория 414"),
        cell("K9", 9, 11, "зачет"),
        cell("A10", 10, 1, "Иностранный язык (русский)"),
        cell("C10", 10, 3, "русского языка и МК, ул. Красноармейская, 35"),
        cell("D10", 10, 4, "экзамен"),
      ],
    }],
  };
}

test("FIO safety layer normalizes curator list time and keeps boundary QA fail-closed", () => {
  const result = parseForeignRWorkbookSafe(fixture(), { program: "foreign", course: 1 });
  assert.deepEqual(result.schedules.map((schedule) => schedule.group.code), ["101и", "102и"]);
  assert.equal(result.schedules[0].academicYear, "2025/26");
  assert.equal(result.schedules[0].semester, 2);

  const group101 = result.schedules.find((schedule) => schedule.group.code === "101и");
  const curator = group101.events.filter((event) => event.title === "Час куратора");
  assert.equal(curator.length, 4);
  assert.ok(curator.every((event) => event.start.endsWith("T16:40:00+03:00")));
  assert.ok(curator.every((event) => event.end.endsWith("T17:40:00+03:00")));
  assert.ok(group101.events.some((event) => event.title === "Медицинская биология" && event.start === "2026-04-06T10:00:00+03:00"));

  assert.deepEqual(result.qa.outOfPeriodSources, [{
    group: "102и",
    title: "Медицинская информатика",
    source: "C4",
    dates: ["2026-10-26"],
  }]);
  assert.equal(result.qa.safetyFixups.curatorListTimeEvents, 3);
  assert.equal(result.qa.status, "REVIEW_REQUIRED");
});
