import test from "node:test";
import assert from "node:assert/strict";
import { stageRWorkbook, publishStagedR } from "../src/adapters/kgmu/r-pipeline.mjs";

function schedule(group) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
    timezone: "Europe/Moscow",
    group: { id: `kgmu:medicine:1:${group}`, code: group, displayName: `Группа ${group}` },
    sources: [{ type: "xlsx", sha256: "a".repeat(64) }],
    events: [{ id: `event-${group}`, title: "Анатомия", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:30:00+03:00", location: "" }],
  };
}

function med3OverlapWorkbook() {
  const cells = [
    { ref: "B1", row: 1, col: 2, value: "РАСПИСАНИЕ ЗАНЯТИЙ ДЛЯ СТУДЕНТОВ 3 КУРСА ЛЕЧЕБНОГО ФАКУЛЬТЕТА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года (2 поток)" },
    { ref: "B2", row: 2, col: 2, value: "02.02.2026 (2 неделя) - 27.05.2026" },
    { ref: "B3", row: 3, col: 2, value: "группа 311" },
    { ref: "C3", row: 3, col: 3, value: "группа 312" },
    { ref: "A4", row: 4, col: 1, value: "ПН" },
    { ref: "B4", row: 4, col: 2, value: "8.00-10.00 Фармакология 02.02" },
    { ref: "C4", row: 4, col: 3, value: "8.00-9.00 Фармакология 02.02" },
    { ref: "A5", row: 5, col: 1, value: "ПН" },
    { ref: "B5", row: 5, col: 2, value: "9.00-11.00 Общая хирургия 02.02" },
    { ref: "C5", row: 5, col: 3, value: "10.00-11.00 Фармакология 02.02" },
    { ref: "B6", row: 6, col: 2, value: "Дисциплина" },
    { ref: "D6", row: 6, col: 4, value: "Кафедра" },
  ];
  return { sheets: [{ name: "3 леч. 2 поток", cells, merges: [], styledCells: [], hiddenRows: [] }] };
}

test("R-MED3 stage keeps source overlaps as non-blocking diagnostics under R69", async () => {
  let normalized = null;
  const result = await stageRWorkbook({
    workbook: med3OverlapWorkbook(),
    queue: {
      storeNormalized: async (_sha, value) => {
        normalized = value;
        return "normalized-r-med3";
      },
    },
    sourceSha256: "a".repeat(64),
    sourceKey: "source-r-med3.xlsx",
    metadata: {
      filename: "3_lech._2_potok.xlsx",
      program: "medicine",
      course: 3,
      academicYear: "2025/26",
      semester: 2,
    },
    period: { academicYear: "2025/26", semester: 2 },
    classification: { type: "R", confidence: "high" },
  });

  assert.equal(result.qa.status, "PASS", JSON.stringify(result.qa, null, 2));
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.equal(result.qa.normalizationFailures.length, 0);
  assert.ok(result.qa.remainingOverlaps.length > 0);
  assert.equal(result.schedules.find((item) => item.group.code === "311").events.length, 2);
  assert.equal(normalized.parserProfile, "R-MED3");
  assert.equal(normalized.qa.status, "PASS");
  assert.ok(normalized.qa.remainingOverlaps.length > 0);
});

test("publishes only normalized QA PASS schedules as one atomic bundle", async () => {
  const normalizedKey = `parser-staging/kgmu/normalized/${"a".repeat(64)}.json`;
  const queue = {
    getNormalized: async (key) => {
      assert.equal(key, normalizedKey);
      return { sourceSha256: "a".repeat(64), qa: { status: "PASS" }, schedules: [schedule("101"), schedule("102")] };
    },
  };
  let written = null;
  const scheduleStore = {
    putScheduleBundle: async (schedules, options) => {
      written = { schedules, options };
      return { bundleKey: "bundle-v1", manifestKey: "current.json", groupCount: schedules.length };
    },
  };
  const published = await publishStagedR({
    queue,
    scheduleStore,
    review: { reviewId: "review-1", sourceSha256: "a".repeat(64), normalizedKey, qa: { status: "PASS" } },
  });
  assert.equal(written.schedules.length, 2);
  assert.equal(written.options.sourceSha256, "a".repeat(64));
  assert.ok(written.schedules.every((item) => item.parserReviewId === "review-1"));
  assert.deepEqual(published.groups, ["101", "102"]);
  assert.equal(published.groupCount, 2);
});

test("rejects review without QA PASS", async () => {
  await assert.rejects(
    publishStagedR({ queue: {}, scheduleStore: {}, review: { normalizedKey: "x", qa: { status: "REVIEW_REQUIRED" } } }),
    (error) => error.code === "REVIEW_NOT_PUBLISHABLE",
  );
});

test("rejects normalized result from another source hash", async () => {
  const normalizedKey = `parser-staging/kgmu/normalized/${"a".repeat(64)}.json`;
  await assert.rejects(
    publishStagedR({
      queue: { getNormalized: async () => ({ sourceSha256: "b".repeat(64), qa: { status: "PASS" }, schedules: [schedule("101")] }) },
      scheduleStore: { putScheduleBundle: async () => ({}) },
      review: { reviewId: "review-2", sourceSha256: "a".repeat(64), normalizedKey, qa: { status: "PASS" } },
    }),
    (error) => error.code === "NORMALIZED_RESULT_INVALID",
  );
});

test("fails closed when atomic bundle publication is unavailable", async () => {
  const normalizedKey = `parser-staging/kgmu/normalized/${"a".repeat(64)}.json`;
  await assert.rejects(
    publishStagedR({
      queue: { getNormalized: async () => ({ sourceSha256: "a".repeat(64), qa: { status: "PASS" }, schedules: [schedule("101")] }) },
      scheduleStore: {},
      review: { reviewId: "review-3", sourceSha256: "a".repeat(64), normalizedKey, qa: { status: "PASS" } },
    }),
    (error) => error.code === "ATOMIC_PUBLICATION_UNAVAILABLE",
  );
});
