import test from "node:test";
import assert from "node:assert/strict";
import { stageRWorkbook } from "../src/adapters/kgmu/r-pipeline.mjs";

function workbook() {
  return {
    sheets: [{
      name: "weekly",
      hiddenRows: [],
      styledCells: [],
      merges: [],
      cells: [
        { ref: "B1", row: 1, col: 2, value: "РАСПИСАНИЕ НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года" },
        { ref: "B2", row: 2, col: 2, value: "группа 311" },
        { ref: "C2", row: 2, col: 3, value: "группа 312" },
        { ref: "A3", row: 3, col: 1, value: "ПН" },
        { ref: "B3", row: 3, col: 2, value: "9.00-10.30 Фармакология 02.02" },
        { ref: "C3", row: 3, col: 3, value: "9.00-10.30 Фармакология 02.02" },
        { ref: "A4", row: 4, col: 1, value: "ВТ" },
        { ref: "B4", row: 4, col: 2, value: "9.00-10.30 Фармакология 03.02" },
        { ref: "C4", row: 4, col: 3, value: "9.00-10.30 Фармакология 03.02" },
        { ref: "A5", row: 5, col: 1, value: "СР" },
        { ref: "B5", row: 5, col: 2, value: "9.00-10.30 Фармакология 04.02" },
        { ref: "C5", row: 5, col: 3, value: "9.00-10.30 Фармакология 04.02" },
        { ref: "A6", row: 6, col: 1, value: "ЧТ" },
        { ref: "B6", row: 6, col: 2, value: "9.00-10.30 Фармакология 05.02" },
        { ref: "C6", row: 6, col: 3, value: "9.00-10.30 Фармакология 05.02" },
      ],
    }],
  };
}

async function stage(course) {
  let normalized = null;
  const queue = {
    storeNormalized: async (_sha, payload) => {
      normalized = payload;
      return `normalized-${course}`;
    },
  };
  const result = await stageRWorkbook({
    workbook: workbook(),
    queue,
    sourceSha256: "a".repeat(64),
    sourceKey: "source.xlsx",
    metadata: {
      filename: "schedule.xlsx",
      program: "medicine",
      course,
      academicYear: "2025/26",
      semester: 2,
    },
    period: { academicYear: "2025/26", semester: 2 },
    classification: { type: "R", confidence: "high" },
  });
  return { result, normalized };
}

test("medicine course 3 uses reviewed R-MED3 profile while other medicine courses keep legacy R", async () => {
  const course3 = await stage(3);
  assert.equal(course3.normalized.parserProfile, "R-MED3");
  assert.ok(course3.result.schedules.every((schedule) => schedule.parser.profile === "R-MED3"));
  assert.equal(course3.result.qa.reviewedProfile, "R-MED-REVIEWED");

  const course1 = await stage(1);
  assert.equal(course1.normalized.parserProfile, "R");
  assert.ok(course1.result.schedules.every((schedule) => schedule.parser.profile === "R"));
  assert.equal(course1.result.qa.reviewedProfile, undefined);
});
