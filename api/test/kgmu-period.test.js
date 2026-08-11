import test from "node:test";
import assert from "node:assert/strict";
import { deriveKgmuPeriod, periodMismatches } from "../src/adapters/kgmu/period.mjs";

function workbook(text) {
  return { sheets: [{ name: "Расписание", cells: [{ ref: "A1", row: 1, col: 1, value: text }], merges: [] }] };
}

test("derives academic year and second semester from KGMU source text", () => {
  const result = deriveKgmuPeriod(workbook("НА ВТОРОЕ ПОЛУГОДИЕ 2025/26 уч. года"));
  assert.deepEqual(result, { academicYear: "2025/26", semester: 2 });
});

test("derives first semester wording", () => {
  const result = deriveKgmuPeriod(workbook("2026-2027 учебный год, первое полугодие"));
  assert.deepEqual(result, { academicYear: "2026/27", semester: 1 });
});

test("blocks ingest metadata that disagrees with source period", () => {
  const mismatches = periodMismatches(
    { academicYear: "2026/27", semester: 1 },
    { academicYear: "2025/26", semester: 2 },
  );
  assert.deepEqual(mismatches.map((item) => item.field).sort(), ["academicYear", "semester"]);
});

test("accepts equivalent slash/full-year formats", () => {
  assert.deepEqual(
    periodMismatches(
      { academicYear: "2025-2026", semester: 2 },
      { academicYear: "2025/26", semester: 2 },
    ),
    [],
  );
});
