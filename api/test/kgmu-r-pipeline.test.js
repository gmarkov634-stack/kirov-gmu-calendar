import test from "node:test";
import assert from "node:assert/strict";
import { publishStagedR } from "../src/adapters/kgmu/r-pipeline.mjs";

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
