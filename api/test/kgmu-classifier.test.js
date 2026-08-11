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

test("classifies weekly KGMU workbook as R using real abbreviated headers", () => {
  const workbook = { sheets: [{ name: "1 леч1", merges: [], cells: cells([
    ["", " группа 101 ", " группа 102"],
    ["ПН", "занятие", "занятие"],
    ["ВТ", "занятие", "занятие"],
    ["СР", "занятие", "занятие"],
    ["ЧТ", "занятие", "занятие"],
    ["ПТ", "занятие", "занятие"],
    ["СБ", "занятие", "занятие"],
  ]) }] };
  const result = classifyKgmuWorkbook(workbook);
  assert.equal(result.type, "R");
  assert.deepEqual(result.features.groupCodes, ["101", "102"]);
  assert.equal(result.features.weekdays.length, 6);
});

test("recognizes foreign-student group suffixes including source whitespace and normalizes Latin i", () => {
  const workbook = { sheets: [{ name: "1 ФИО", merges: [], cells: cells([
    ["", "Группа 101 и", "Группа 102 i"],
    ["ПН", "занятие", "занятие"],
    ["ВТ", "занятие", "занятие"],
    ["СР", "занятие", "занятие"],
    ["ЧТ", "занятие", "занятие"],
    ["ПТ", "занятие", "занятие"],
  ]) }] };
  const result = classifyKgmuWorkbook(workbook);
  assert.equal(result.type, "R");
  assert.deepEqual(result.features.groupCodes, ["101и", "102и"]);
});

test("classifies embedded dentistry cycle as S using real KGMU headers", () => {
  const workbook = { sheets: [{ name: "2 стомат", merges: [], cells: cells([
    ["", "Группа 291", "Группа 292"],
    ["ПН", "занятие", "занятие"],
    ["ВТ", "занятие", "занятие"],
    ["СР", "занятие", "занятие"],
    ["ЧТ", "занятие", "занятие"],
    ["ПТ", "занятие", "занятие"],
    ["СБ", "занятие", "занятие"],
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
