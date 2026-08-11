import test from "node:test";
import assert from "node:assert/strict";
import { parseKgmuCycleWorkbook } from "../src/adapters/kgmu/cycle-parser.mjs";

function letters(col) {
  let n = col;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + n % 26) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function cell(col, row, value) {
  return { ref: `${letters(col)}${row}`, col, row, value };
}

function merge(startCol, startRow, endCol, endRow) {
  return {
    ref: `${letters(startCol)}${startRow}:${letters(endCol)}${endRow}`,
    startRef: `${letters(startCol)}${startRow}`,
    endRef: `${letters(endCol)}${endRow}`,
    startCol, startRow, endCol, endRow,
  };
}

function fixture() {
  const cells = [
    cell(1, 1, "ВТОРОЕ ПОЛУГОДИЕ 2025/26"),
    cell(3, 10, "Февраль 23 дня"),
    ...[2,3,4,5,6,7,9,10,11,12].map((day, index) => cell(3 + index, 11, day)),
    ...["пн","вт","ср","чт","пт","сб","пн","вт","ср","чт"].map((day, index) => cell(3 + index, 12, day)),
    cell(2, 13, 401), cell(3, 13, "Менеджмент в * здравоохранении"), cell(8, 13, "М"),
    cell(2, 14, 411), cell(3, 14, "Менеджмент в здравоохранении"), cell(8, 14, "М"),
    cell(3, 38, "Дисциплина"), cell(21, 38, "Форма промежуточной аттестации"),
    cell(42, 38, "База практической подготовки"), cell(68, 38, "Адрес"), cell(76, 38, "Время проведения занятий"),
    cell(76, 39, "1 смена"), cell(82, 39, "2 смена"),
    cell(3, 41, "Факультетская терапия, профессиональные болезни. Лекции"), cell(21, 41, "Экзамен"),
    cell(42, 41, "Учебный корпус № 3"), cell(68, 41, "ул. Владимирская, 112"),
    cell(76, 41, "1 поток\nпн с 02.02-06.04\n14.45-16.15\nауд. 3-803"),
    cell(82, 41, "2 поток\nср с 04.02-25.03\n14.30-16.00\nауд. 3-819"),
    cell(3, 47, "Менеджмент в здравоохранении (М - день зачета)"), cell(21, 47, "Зачёт"),
    cell(42, 47, "Кировский ГМУ, учебный корпус № 1"), cell(68, 47, "ул. Владимирская, 137"),
    cell(76, 47, "8.30-11.35"), cell(82, 47, "12.00-15.05"),
    cell(3, 51, "Элективные дисциплины по физической культуре и спорту"), cell(21, 51, "Зачёт"),
    cell(42, 51, "Кировский ГМУ, учебный корпус № 3 Физкультурно-оздоровительный комплекс"), cell(68, 51, "ул. Владимирская, 112"),
    cell(76, 51, "1 поток\nпонедельник с 02.02-18.05\n16.45-18.15\nвторник 07.04, 14.04\n14.30-16.00"),
    cell(82, 51, "2 поток\nсреда с 04.02-20.05\n16.30-18.00"),
  ];
  return { sheets: [{
    name: "4 курс",
    cells,
    merges: [merge(3, 13, 7, 13), merge(3, 14, 7, 14)],
  }] };
}

test("C parser expands blocks, starred first shift exception, M, lectures and PE", () => {
  const result = parseKgmuCycleWorkbook(fixture(), { program: "medicine", course: 4, academicYear: "2025/26", semester: 2 });
  assert.equal(result.type, "C");
  assert.equal(result.qa.passed, true);
  assert.equal(result.qa.sourceBlocks, 4);
  assert.equal(result.qa.duplicateCount, 0);

  const group401 = result.schedules.find((schedule) => schedule.group.code === "401");
  const group411 = result.schedules.find((schedule) => schedule.group.code === "411");
  assert.ok(group401);
  assert.ok(group411);

  const firstManagement = group401.events.find((event) => event.discipline === "Менеджмент в здравоохранении" && event.kind === "practice");
  assert.equal(firstManagement.start, "2026-02-02T12:00:00+03:00");
  assert.equal(firstManagement.end, "2026-02-02T15:05:00+03:00");
  const laterManagement = group401.events.find((event) => event.start.startsWith("2026-02-03") && event.kind === "practice");
  assert.equal(laterManagement.start, "2026-02-03T08:30:00+03:00");

  assert.ok(group401.events.some((event) => event.title.startsWith("ЗАЩИТА ПРОЕКТА")));
  assert.ok(group401.events.some((event) => event.kind === "lecture" && event.start === "2026-02-02T14:45:00+03:00"));
  assert.ok(group401.events.some((event) => event.kind === "physical_education" && event.start === "2026-02-02T16:45:00+03:00"));
  assert.ok(group411.events.some((event) => event.kind === "lecture" && event.start === "2026-02-04T14:30:00+03:00"));
  assert.ok(group411.events.some((event) => event.kind === "physical_education" && event.start === "2026-02-04T16:30:00+03:00"));
});
