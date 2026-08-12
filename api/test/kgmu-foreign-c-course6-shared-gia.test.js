import test from "node:test";
import assert from "node:assert/strict";
import { applySharedGiaRule } from "../src/adapters/kgmu/foreign-c-course6-shared-gia.mjs";

function ref(col, row) {
  let n = col;
  let letters = "";
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return `${letters}${row}`;
}

test("shared merged GIA block creates one multi-day all-day event for every visible group", () => {
  const cells = [
    { row: 10, col: 3, ref: "C10", value: "Июнь" },
  ];
  for (let index = 0; index < 12; index += 1) {
    cells.push({ row: 11, col: 3 + index, ref: ref(3 + index, 11), value: 1 + index });
  }
  for (let index = 0; index < 5; index += 1) {
    cells.push({ row: 14 + index, col: 2, ref: ref(2, 14 + index), value: `${601 + index}и` });
  }
  cells.push({ row: 14, col: 3, ref: "C14", value: "ГИА" });

  const workbook = {
    sheets: [{
      name: "6 курс ФИО",
      cells,
      styledCells: [],
      hiddenRows: [],
      merges: [{
        ref: "C14:E18",
        startRef: "C14",
        endRef: "E18",
        startRow: 14,
        endRow: 18,
        startCol: 3,
        endCol: 5,
      }],
    }],
  };

  const schedules = ["601и", "602и", "603и", "604и", "605и"].map((group) => ({
    academicYear: "2025/26",
    semester: 2,
    group: { code: group },
    events: [],
    parserQa: {},
  }));
  const parsed = {
    schedules,
    qa: {
      status: "PASS",
      passed: true,
      unresolvedConfirmedRules: [],
      eventCount: 0,
      groupCounts: {},
    },
  };

  const result = applySharedGiaRule(workbook, parsed);
  assert.equal(result.qa.status, "PASS");
  assert.equal(result.qa.giaEvents, 5);
  assert.equal(result.qa.sharedGiaBlocks.length, 1);
  assert.deepEqual(result.qa.sharedGiaBlocks[0].groups, ["601и", "602и", "603и", "604и", "605и"]);
  assert.equal(result.qa.sharedGiaBlocks[0].start, "2026-06-01");
  assert.equal(result.qa.sharedGiaBlocks[0].end, "2026-06-04");
  assert.equal(result.qa.eventCount, 5);
  assert.deepEqual(result.qa.groupCounts, { "601и": 1, "602и": 1, "603и": 1, "604и": 1, "605и": 1 });
  for (const schedule of result.schedules) {
    assert.equal(schedule.events.length, 1);
    const event = schedule.events[0];
    assert.equal(event.title, "ГИА");
    assert.equal(event.kind, "state_exam");
    assert.equal(event.allDay, true);
    assert.equal(event.start, "2026-06-01");
    assert.equal(event.end, "2026-06-04");
  }
});
