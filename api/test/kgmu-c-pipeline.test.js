import test from "node:test";
import assert from "node:assert/strict";
import { publishStagedC } from "../src/adapters/kgmu/c-pipeline.mjs";

function schedule(group) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course: 4,
    academicYear: "2025/26",
    semester: 2,
    timezone: "Europe/Moscow",
    group: { id: `kgmu:medicine:4:${group}`, code: group, displayName: `Группа ${group}` },
    events: [{ id: `event-${group}`, title: "Педиатрия", start: "2026-02-02T08:30:00+03:00", end: "2026-02-02T11:35:00+03:00", location: "" }],
  };
}

test("publishes cyclic QA PASS as one atomic schedule bundle", async () => {
  const sourceSha256 = "c".repeat(64);
  const normalizedKey = `parser-staging/kgmu/normalized/${sourceSha256}.json`;
  const queue = {
    getNormalized: async (key) => {
      assert.equal(key, normalizedKey);
      return {
        parserType: "C",
        sourceSha256,
        qa: { status: "PASS" },
        schedules: [schedule("401"), schedule("402")],
      };
    },
  };
  let bundle = null;
  const scheduleStore = {
    putScheduleBundle: async (schedules, options) => {
      bundle = { schedules, options };
      return { bundleKey: "bundle", manifestKey: "current", groupCount: schedules.length };
    },
  };
  const published = await publishStagedC({
    queue,
    scheduleStore,
    review: { reviewId: "review-c", sourceSha256, normalizedKey, qa: { status: "PASS" } },
  });
  assert.equal(published.groupCount, 2);
  assert.equal(bundle.options.sourceSha256, sourceSha256);
  assert.ok(bundle.schedules.every((item) => item.parserReviewId === "review-c"));
});

test("rejects cyclic normalized result with wrong parser type", async () => {
  const sourceSha256 = "c".repeat(64);
  const normalizedKey = `parser-staging/kgmu/normalized/${sourceSha256}.json`;
  await assert.rejects(
    publishStagedC({
      queue: { getNormalized: async () => ({ parserType: "R", sourceSha256, qa: { status: "PASS" }, schedules: [schedule("401")] }) },
      scheduleStore: { putScheduleBundle: async () => ({}) },
      review: { reviewId: "review-c", sourceSha256, normalizedKey, qa: { status: "PASS" } },
    }),
    (error) => error.code === "NORMALIZED_RESULT_INVALID",
  );
});
