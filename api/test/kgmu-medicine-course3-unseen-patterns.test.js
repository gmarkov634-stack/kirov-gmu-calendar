import test from "node:test";
import assert from "node:assert/strict";
import { parseMedicineCourse3RWorkbookReviewed } from "../src/adapters/kgmu/medicine-course3-r-reviewed.mjs";

function cell(ref, row, col, value) {
  return { ref, row, col, value };
}

function workbookWithRows(scheduleRows, footerRow = 8, extraCells = []) {
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

test("R-MED3 parses exact unseen time overrides, adjacent times and week parity without leaking surrogate subjects", () => {
  const workbook = workbookWithRows([
    cell("A4", 4, 1, "ПН"),
    cell("B4", 4, 2, "8.00-9.30, 9.40-10.25 Патофизиология, клиническая патофизиология. Патофизиология (модуль) 02.02-18.05, 25.05-8.00-11.10"),
    cell("C4", 4, 3, "8.00-9.30, 9.40-10.25 Фармакология 02.02-25.05"),
    cell("A5", 5, 1, "ВТ"),
    cell("B5", 5, 2, "15.20-16.50, 17.00-17.45 Организация сестринской помощи (дисциплина по выбору) (пр. занятие) 10.02-28.04 гр.№5 15.40-18.05 Общая хирургия 05.05, 15.40-17.10-12.05"),
    cell("C5", 5, 3, "14.20-15.50, 16.00-16.45 Фармакология 03.02-19.05"),
    cell("A6", 6, 1, "СР"),
    cell("B6", 6, 2, "10.50-12.20 12.30-14.00 Лучевая диагностика и терапия 1 неделя по 20.05"),
    cell("C6", 6, 3, "12.00-13.30, 13.40-15.30 Общественное здоровье и здравоохранение, экономика здравоохранения 1 неделя по 20.05"),
  ], 8, [
    cell("A7", 7, 1, "1 неделя-11.05-16.05 2 неделя-18.05-23.05 Праздничные неучебные дни-09.05"),
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
    event.title === "Патофизиология, клиническая патофизиология. Патофизиология (модуль)" &&
    event.start === "2026-05-25T08:00:00+03:00" &&
    event.end === "2026-05-25T11:10:00+03:00"
  ));
  assert.ok(group311.some((event) =>
    event.title === "Общая хирургия" &&
    event.start === "2026-05-12T15:40:00+03:00" &&
    event.end === "2026-05-12T17:10:00+03:00"
  ));
  assert.ok(group311.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start === "2026-05-13T10:50:00+03:00" &&
    event.end === "2026-05-13T14:00:00+03:00"
  ));
  assert.ok(group312.some((event) =>
    event.title === "Общественное здоровье и здравоохранение, экономика здравоохранения" &&
    event.start === "2026-05-13T12:00:00+03:00"
  ));

  const titles = [...group311, ...group312].map((event) => event.title);
  assert.ok(!titles.includes("Экономика"));
  assert.ok(!titles.includes("Анатомия"));
  assert.ok(!titles.includes("Медицинская информатика"));
  assert.ok(!titles.includes("Биология"));
});

test("R-MED3 keeps date-time-time attached to the subject that owns the triple", () => {
  const workbook = workbookWithRows([
    cell("A4", 4, 1, "ПН"),
    cell("B4", 4, 2, "13.30-15.55 Общая хирургия 18.05, 25.05-13.30-15.00 13.30-16.40 Лучевая диагностика и терапия 11.05"),
    cell("C4", 4, 3, "10.00-11.30 Фармакология 18.05"),
  ], 5);

  const result = parseMedicineCourse3RWorkbookReviewed(workbook, {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  const group311 = eventsFor(result, "311");
  assert.ok(group311.some((event) =>
    event.title === "Общая хирургия" &&
    event.start === "2026-05-18T13:30:00+03:00" &&
    event.end === "2026-05-18T15:55:00+03:00"
  ));
  assert.ok(group311.some((event) =>
    event.title === "Общая хирургия" &&
    event.start === "2026-05-25T13:30:00+03:00" &&
    event.end === "2026-05-25T15:00:00+03:00"
  ));
  assert.ok(group311.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start === "2026-05-11T13:30:00+03:00" &&
    event.end === "2026-05-11T16:40:00+03:00"
  ));
  assert.ok(!group311.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start.startsWith("2026-05-25T")
  ));
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

test("R-MED3 keeps new unconfirmed explicit overlaps fail-closed", () => {
  const workbook = workbookWithRows([
    cell("A4", 4, 1, "ПН"),
    cell("B4", 4, 2, "8.00-10.00 Фармакология 02.02"),
    cell("C4", 4, 3, "8.00-9.00 Фармакология 02.02"),
    cell("A5", 5, 1, "ПН"),
    cell("B5", 5, 2, "9.00-11.00 Общая хирургия 02.02"),
    cell("C5", 5, 3, "10.00-11.00 Фармакология 02.02"),
  ], 6);

  const result = parseMedicineCourse3RWorkbookReviewed(workbook, {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.ok((result.qa.remainingOverlaps || []).length > 0);
  assert.equal((result.qa.confirmedOverlaps || []).length, 0);
});
