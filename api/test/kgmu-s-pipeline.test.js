import test from "node:test";
import assert from "node:assert/strict";
import { publishStagedS } from "../src/adapters/kgmu/s-pipeline.mjs";

function schedule(group) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "dentistry",
    course: 2,
    academicYear: "2025/26",
    semester: 2,
    timezone: "Europe/Moscow",
    group: { id: `kgmu:dentistry:2:${group}`, code: group, displayName: `Группа ${group}` },
    events: [{ id: `event-${group}`, title: "Фармакология", start: "2026-02-02T10:30:00+03:00", end: "2026-02-02T12:00:00+03:00", location: "" }],
  };
}

test("publishes mixed QA PASS as one atomic schedule bundle", async () => {
  const sourceSha256 = "s".repeat(64);
  const normalizedKey = `parser-staging/kgmu/normalized/${sourceSha256}.json`;
  const queue = {
    getNormalized: async (key) => {
      assert.equal(key, normalizedKey);
      return { parserType: "S", sourceSha256, qa: { status: "PASS" }, schedules: [schedule("291"), schedule("292")] };
    },
  };
  let bundle = null;
  const scheduleStore = {
    putScheduleBundle: async (schedules, options) => {
      bundle = { schedules, options };
      return { bundleKey: "bundle", manifestKey: "current", groupCount: schedules.length };
    },
  };
  const published = await publishStagedS({
    queue,
    scheduleStore,
    review: { reviewId: "review-s", sourceSha256, normalizedKey, qa: { status: "PASS" } },
  });
  assert.equal(published.groupCount, 2);
  assert.equal(bundle.options.sourceSha256, sourceSha256);
  assert.ok(bundle.schedules.every((item) => item.parserReviewId === "review-s"));
});

test("rejects mixed normalized result with wrong source hash", async () => {
  const sourceSha256 = "s".repeat(64);
  const normalizedKey = `parser-staging/kgmu/normalized/${sourceSha256}.json`;
  await assert.rejects(
    publishStagedS({
      queue: { getNormalized: async () => ({ parserType: "S", sourceSha256: "x".repeat(64), qa: { status: "PASS" }, schedules: [schedule("291")] }) },
      scheduleStore: { putScheduleBundle: async () => ({}) },
      review: { reviewId: "review-s", sourceSha256, normalizedKey, qa: { status: "PASS" } },
    }),
    (error) => error.code === "NORMALIZED_RESULT_INVALID",
  );
});
