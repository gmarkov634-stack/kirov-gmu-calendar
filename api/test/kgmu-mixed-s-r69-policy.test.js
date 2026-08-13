import test from "node:test";
import assert from "node:assert/strict";
import { applyR69ToMixedQa } from "../src/adapters/kgmu/mixed-s-safe.mjs";

test("R69 keeps mixed-S unexpected overlaps diagnostic-only", () => {
  const qa = applyR69ToMixedQa({
    passed: false,
    uncovered: [],
    expectationFailures: [],
    duplicateCount: 0,
    allowedOverlaps: [],
    unexpectedOverlaps: [{ group: "201", date: "2026-02-02" }],
  });
  assert.equal(qa.passed, true);
  assert.equal(qa.unexpectedOverlaps.length, 1);
});

test("R69 mixed-S policy preserves real fail-closed blockers", () => {
  assert.equal(applyR69ToMixedQa({
    uncovered: [{ source: "B4", reason: "unknown-pattern" }],
    expectationFailures: [],
    duplicateCount: 0,
    unexpectedOverlaps: [],
  }).passed, false);

  assert.equal(applyR69ToMixedQa({
    uncovered: [],
    expectationFailures: [{ source: "C7", reason: "missing-extra" }],
    duplicateCount: 0,
    unexpectedOverlaps: [],
  }).passed, false);

  assert.equal(applyR69ToMixedQa({
    uncovered: [],
    expectationFailures: [],
    duplicateCount: 1,
    unexpectedOverlaps: [],
  }).passed, false);
});
