import test from "node:test";
import assert from "node:assert/strict";
import { applyR69ToMixedQa } from "../src/adapters/kgmu/s-pipeline.mjs";

test("mixed-S R69 keeps temporal overlaps diagnostic-only", () => {
  const overlap = {
    group: "201",
    date: "2026-03-10",
    event1: "a",
    event2: "b",
  };
  const qa = applyR69ToMixedQa({
    passed: false,
    status: "REVIEW_REQUIRED",
    uncovered: [],
    extraLessonFailures: [],
    duplicateCount: 0,
    unexpectedOverlaps: [overlap],
    overlapCount: 1,
  });

  assert.equal(qa.status, "PASS");
  assert.equal(qa.passed, true);
  assert.deepEqual(qa.unexpectedOverlaps, [overlap]);
  assert.equal(qa.overlapCount, 1);
});

test("mixed-S R69 preserves real fail-closed blockers", () => {
  for (const blocker of [
    { uncovered: [{ source: "B8", reason: "segments-not-found" }], extraLessonFailures: [], duplicateCount: 0 },
    { uncovered: [], extraLessonFailures: [{ group: "201", count: 2, actual: 1 }], duplicateCount: 0 },
    { uncovered: [], extraLessonFailures: [], duplicateCount: 1 },
  ]) {
    const qa = applyR69ToMixedQa({
      passed: false,
      status: "REVIEW_REQUIRED",
      unexpectedOverlaps: [{ event1: "a", event2: "b" }],
      ...blocker,
    });
    assert.equal(qa.status, "REVIEW_REQUIRED");
    assert.equal(qa.passed, false);
  }
});
