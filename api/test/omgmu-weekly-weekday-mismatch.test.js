import assert from "node:assert/strict";
import test from "node:test";
import { parseWeeklyGeometry } from "../src/adapters/omgmu/weekly-geometry.mjs";

const geometry = {
  version: 1,
  sourceProfile: "weekly_grid",
  sourceLanguage: "ru",
  pageNumber: 2,
  groups: [
    { code: "389", x0: 10, x1: 20 },
    { code: "393", x0: 20, x1: 30 },
  ],
  rows: [{
    rowIndex: 13,
    weekday: 4,
    cells: [{
      bbox: [10, 100, 30, 120],
      groups: ["389", "393"],
      text: "14.20-16.00 Спортивные игры/Плавание/Атлетическая гимнастика, 1 з.: 24.06",
    }],
  }],
};

test("explicit singleton date is retained but marked needs_review when it contradicts structural weekday", () => {
  const parsed = parseWeeklyGeometry(geometry, { year: 2026 });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.series.length, 1);
  assert.deepEqual(parsed.series[0].dates, ["2026-06-24"]);
  assert.equal(parsed.series[0].sourceWeekday, 4);
  assert.equal(parsed.series[0].status, "needs_review");
  assert.ok(parsed.series[0].warnings.includes("weekday mismatch: 2026-06-24"));
  assert.equal(parsed.series[0].declaredCount, 1);
  assert.deepEqual(parsed.series[0].groups, ["389", "393"]);
});
