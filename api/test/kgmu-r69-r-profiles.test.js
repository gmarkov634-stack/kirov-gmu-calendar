import test from "node:test";
import assert from "node:assert/strict";
import { applyProfileQaPolicy, stageRWorkbook } from "../src/adapters/kgmu/r-pipeline.mjs";

function ordinaryOverlapWorkbook() {
  return {
    sheets: [{
      name: "1 леч.",
      merges: [],
      styledCells: [],
      hiddenRows: [],
      cells: [
        { ref: "B1", row: 1, col: 2, value: "РАСПИСАНИЕ ЗАНЯТИЙ ДЛЯ СТУДЕНТОВ 1 КУРСА ЛЕЧЕБНОГО ФАКУЛЬТЕТА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года" },
        { ref: "B2", row: 2, col: 2, value: "02.02.2026 (2 неделя) - 27.05.2026" },
        { ref: "B3", row: 3, col: 2, value: "группа 111" },
        { ref: "C3", row: 3, col: 3, value: "группа 112" },
        { ref: "A4", row: 4, col: 1, value: "ПН" },
        { ref: "B4", row: 4, col: 2, value: "8.00-10.00 Анатомия 02.02" },
        { ref: "C4", row: 4, col: 3, value: "8.00-9.00 Анатомия 02.02" },
        { ref: "A5", row: 5, col: 1, value: "ПН" },
        { ref: "B5", row: 5, col: 2, value: "9.00-11.00 Биология 02.02" },
        { ref: "C5", row: 5, col: 3, value: "10.00-11.00 Биология 02.02" },
        { ref: "B6", row: 6, col: 2, value: "Дисциплина" },
        { ref: "D6", row: 6, col: 4, value: "Кафедра" },
      ],
    }],
  };
}

test("ordinary R stage preserves overlapping source events without review under R69", async () => {
  let normalized;
  const result = await stageRWorkbook({
    workbook: ordinaryOverlapWorkbook(),
    queue: {
      storeNormalized: async (_sha, value) => {
        normalized = value;
        return "normalized-r69-r";
      },
    },
    sourceSha256: "a".repeat(64),
    sourceKey: "source-r69-r.xlsx",
    metadata: {
      filename: "1_lech.xlsx",
      program: "medicine",
      course: 1,
      academicYear: "2025/26",
      semester: 2,
    },
    period: { academicYear: "2025/26", semester: 2 },
    classification: { type: "R", confidence: "high" },
  });

  assert.equal(result.qa.status, "PASS", JSON.stringify(result.qa, null, 2));
  assert.deepEqual(result.qa.uncovered, []);
  assert.deepEqual(result.qa.extraLessonFailures, []);
  assert.ok(result.qa.remainingOverlaps.length > 0);
  assert.equal(result.schedules.find((item) => item.group.code === "111").events.length, 2);
  assert.equal(normalized.parserProfile, "R");
  assert.equal(normalized.qa.status, "PASS");
  assert.ok(normalized.qa.remainingOverlaps.length > 0);
});

test("R-FIO overlap diagnostics never erase real ambiguity blockers", () => {
  const overlapOnly = applyProfileQaPolicy("R-FIO", {
    status: "REVIEW_REQUIRED",
    uncovered: [],
    extraLessonFailures: [],
    normalizationFailures: [],
    remainingOverlaps: [{ group: "101и", date: "2026-04-06" }],
    ambiguousLectureTimeCounts: [],
    choiceDisciplineAmbiguities: [],
    safetyFixups: { alternateTimeDateRanges: { skipped: [] } },
  });
  assert.equal(overlapOnly.status, "PASS");
  assert.equal(overlapOnly.remainingOverlaps.length, 1);

  const sourceAmbiguity = applyProfileQaPolicy("R-FIO", {
    ...overlapOnly,
    choiceDisciplineAmbiguities: [{ source: "B15:G15" }],
  });
  assert.equal(sourceAmbiguity.status, "REVIEW_REQUIRED");
  assert.equal(sourceAmbiguity.remainingOverlaps.length, 1);

  const missingDates = applyProfileQaPolicy("R-FIO", {
    ...overlapOnly,
    uncovered: [{ source: "B5", reason: "no-dates" }],
  });
  assert.equal(missingDates.status, "REVIEW_REQUIRED");
});
