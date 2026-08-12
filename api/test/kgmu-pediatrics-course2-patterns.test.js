import test from "node:test";
import assert from "node:assert/strict";
import { parsePediatricsRWorkbookReviewed } from "../src/adapters/kgmu/pediatrics-r-reviewed.mjs";

function cell(ref, row, col, value) {
  return { ref, row, col, value };
}

function eventsFor(result, group) {
  return result.schedules.find((schedule) => schedule.group.code === group)?.events || [];
}

test("R-PED recognizes course 2 subjects, preserves multiple subjects in one cell, and stops before the footer", () => {
  const workbook = {
    sheets: [{
      name: "2пед",
      cells: [
        cell("A1", 1, 1, "РАСПИСАНИЕ ЗАНЯТИЙ ДЛЯ СТУДЕНТОВ 2 КУРСА ПЕДИАТРИЧЕСКОГО ФАКУЛЬТЕТА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года"),
        cell("A2", 2, 1, "02.02.2026 (2 неделя) - 05.06.2026"),
        cell("B3", 3, 2, "группа 231"),
        cell("C3", 3, 3, "группа 232"),
        cell("A4", 4, 1, "ПН"),
        cell("B4", 4, 2, "8.30-10.00 ЛЕКЦИЯ ГИГИЕНА 02.02 10.30-12.00 ЛЕКЦИЯ ОСНОВЫ ФОРМИРОВАНИЯ ЗДОРОВЬЯ ДЕТЕЙ 02.02"),
        cell("C4", 4, 3, "10.30-12.00, 12.10-12.55 Нормальная физиология 02.02-01.06"),
        cell("A5", 5, 1, "ВТ"),
        cell("B5", 5, 2, "10.30-12.00, 12.10-12.55 Основы формирования здоровья детей 03.02-19.05 (1 занятие во чт. )"),
        cell("A6", 6, 1, "Дисциплина"),
        cell("B6", 6, 2, "служебная ячейка нижней таблицы"),
        cell("C6", 6, 3, "Кафедра/База практической подготовки"),
        cell("B7", 7, 2, "Нормальная физиология"),
        cell("C7", 7, 3, "нормальной физиологии (3 корпус, ул. Владимирская, 112)"),
      ],
      merges: [],
      styledCells: [],
      hiddenRows: [],
    }],
  };

  const result = parsePediatricsRWorkbookReviewed(workbook, {
    program: "pediatrics",
    course: 2,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.deepEqual(result.qa.uncovered, []);
  assert.equal(result.qa.reviewedProfile, "R-PED-REVIEWED");
  assert.equal(result.qa.extraLessonFailures.length, 1);
  assert.equal(result.qa.extraLessonFailures[0].group, "231");
  assert.equal(result.qa.extraLessonFailures[0].subject, "Основы формирования здоровья детей");
  assert.equal(result.qa.extraLessonFailures[0].count, 1);
  assert.equal(result.qa.extraLessonFailures[0].actual, 0);

  const group231 = eventsFor(result, "231");
  assert.ok(group231.some((event) => (
    event.title === "ЛЕКЦ. ГИГИЕНА" &&
    event.start === "2026-02-02T08:30:00+03:00" &&
    event.end === "2026-02-02T10:00:00+03:00"
  )));
  assert.ok(group231.some((event) => (
    event.title === "ЛЕКЦ. ОСНОВЫ ФОРМИРОВАНИЯ ЗДОРОВЬЯ ДЕТЕЙ" &&
    event.start === "2026-02-02T10:30:00+03:00" &&
    event.end === "2026-02-02T12:00:00+03:00"
  )));

  const group232 = eventsFor(result, "232");
  assert.ok(group232.some((event) => (
    event.title === "Нормальная физиология" &&
    event.start === "2026-02-02T10:30:00+03:00" &&
    event.end === "2026-02-02T12:55:00+03:00"
  )));

  assert.ok(!result.qa.uncovered.some((item) => /^B6|^B7|^C6|^C7/.test(item.source)));
});
