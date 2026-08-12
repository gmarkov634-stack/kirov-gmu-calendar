import test from "node:test";
import assert from "node:assert/strict";
import { parseMedicineCourse3RWorkbookReviewed } from "../src/adapters/kgmu/medicine-course3-r-reviewed.mjs";

function cell(ref, row, col, value) {
  return { ref, row, col, value };
}

function workbookWithRows(scheduleRows, footerRow = 7, extraCells = []) {
  const cells = [
    cell("B1", 1, 2, "РАСПИСАНИЕ ЗАНЯТИЙ ДЛЯ СТУДЕНТОВ 3 КУРСА ЛЕЧЕБНОГО ФАКУЛЬТЕТА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года (2 поток)"),
    cell("B2", 2, 2, "02.02.2026 (2 неделя) - 27.05.2026"),
    cell("B3", 3, 2, "группа 311"),
    cell("C3", 3, 3, "группа 312"),
    ...scheduleRows,
    ...extraCells,
    cell(`B${footerRow}`, footerRow, 2, "Дисциплина"),
    cell(`D${footerRow}`, footerRow, 4, "Кафедра"),
  ];
  return { sheets: [{ name: "3 леч. 2 поток", cells, merges: [], styledCells: [], hiddenRows: [] }] };
}

function eventsFor(result, group) {
  return result.schedules.find((schedule) => schedule.group.code === group)?.events || [];
}

test("R-MED3 normalizes reversed date/time, double hyphen, adjacent times and week parity without leaking surrogate subjects", () => {
  const workbook = workbookWithRows([
    cell("A4", 4, 1, "ПН"),
    cell("B4", 4, 2, "15.40-17.10-11.05 Лучевая диагностика и терапия"),
    cell("C4", 4, 3, "18.05--9.40-10.25 Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль)"),
    cell("A5", 5, 1, "ВТ"),
    cell("B5", 5, 2, "8.00-9.30 Общественное здоровье и здравоохранение, экономика здравоохранения 1 неделя по 16.05"),
    cell("C5", 5, 3, "10.50-12.20 12.30-14.00 Общая хирургия 12.05"),
  ], 7, [
    cell("A6", 6, 1, "1 неделя - 11.05-16.05 2 неделя - 18.05-23.05 Праздничные неучебные дни:"),
  ]);

  const result = parseMedicineCourse3RWorkbookReviewed(workbook, {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.qa.status, "PASS");
  assert.deepEqual(result.qa.normalizationFailures, []);

  const group311 = eventsFor(result, "311");
  const group312 = eventsFor(result, "312");

  assert.ok(group311.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start === "2026-05-11T15:40:00+03:00" &&
    event.end === "2026-05-11T17:10:00+03:00"
  ));
  assert.ok(group312.some((event) =>
    event.title === "Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль)" &&
    event.start === "2026-05-18T09:40:00+03:00" &&
    event.end === "2026-05-18T10:25:00+03:00"
  ));
  assert.ok(group311.some((event) =>
    event.title === "Общественное здоровье и здравоохранение, экономика здравоохранения" &&
    event.start === "2026-05-12T08:00:00+03:00"
  ));
  assert.ok(group312.some((event) =>
    event.title === "Общая хирургия" &&
    event.start === "2026-05-12T10:50:00+03:00" &&
    event.end === "2026-05-12T14:00:00+03:00"
  ));

  const titles = [...group311, ...group312].map((event) => event.title);
  assert.ok(!titles.includes("Экономика"));
  assert.ok(!titles.includes("Анатомия"));
  assert.ok(!titles.includes("Медицинская информатика"));
  assert.ok(!titles.includes("Биология"));
});

test("R-MED3 keeps count-only extra lessons fail-closed when their dates are absent", () => {
  const workbook = workbookWithRows([
    cell("A4", 4, 1, "ПН"),
    cell("B4", 4, 2, "8.00-9.30 Общая хирургия 02.02-25.05 (2 занятия в пт.)"),
    cell("C4", 4, 3, "10.00-11.30 Фармакология 02.02"),
  ], 5);

  const result = parseMedicineCourse3RWorkbookReviewed(workbook, {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.ok(result.qa.extraLessonFailures.some((failure) =>
    failure.group === "311" && Number(failure.count) === 2 && failure.actual === 0
  ));
});
