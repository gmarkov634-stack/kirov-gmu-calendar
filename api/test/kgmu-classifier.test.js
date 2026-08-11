import test from "node:test";
import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";

function cells(rows) {
  return rows.flatMap((values, rowIndex) => values.map((value, colIndex) => ({
    ref: `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`,
    row: rowIndex + 1,
    col: colIndex + 1,
    value,
  })).filter((cell) => cell.value !== "" && cell.value != null));
}

test("classifies weekly KGMU workbook as R", () => {
  const workbook = { sheets: [{ name: "Расписание", merges: [], cells: cells([
    ["Понедельник", "131", "132"],
    ["Вторник", "131", "132"],
    ["Среда", "131", "132"],
    ["Четверг", "131", "132"],
    ["Пятница", "131", "132"],
  ]) }] };
  assert.equal(classifyKgmuWorkbook(workbook).type, "R");
});

test("classifies embedded dentistry cycle as S", () => {
  const workbook = { sheets: [{ name: "Расписание", merges: [], cells: cells([
    ["Понедельник", "291", "292"],
    ["Вторник", "291", "292"],
    ["Среда", "291", "292"],
    ["Четверг", "291", "292"],
    ["Пропедевтическая стоматология", "02.02-25.02"],
  ]) }] };
  assert.equal(classifyKgmuWorkbook(workbook).type, "S");
});

test("classifies group-over-date cycle grid as C", () => {
  const workbook = { sheets: [{
    name: "4 курс",
    cells: cells([
      ["", 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14],
      ["401", "Факультетская терапия"],
      ["402", "Неврология"],
      ["403", "Педиатрия"],
      ["404", "Урология"],
    ]),
    merges: [
      { startRow: 2, endRow: 2, startCol: 2, endCol: 5 },
      { startRow: 3, endRow: 3, startCol: 3, endCol: 6 },
      { startRow: 4, endRow: 4, startCol: 4, endCol: 7 },
      { startRow: 5, endRow: 5, startCol: 5, endCol: 8 },
    ],
  }] };
  assert.equal(classifyKgmuWorkbook(workbook).type, "C");
});

test("unknown workbook fails closed", () => {
  const workbook = { sheets: [{ name: "Лист1", cells: cells([["Свободный текст"]]), merges: [] }] };
  const result = classifyKgmuWorkbook(workbook);
  assert.equal(result.type, "UNKNOWN");
  assert.equal(result.confidence, "low");
});
