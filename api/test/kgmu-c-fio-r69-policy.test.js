import test from "node:test";
import assert from "node:assert/strict";
import { applyR69ToForeignCycleQa } from "../src/adapters/kgmu/c-pipeline.mjs";

const overlap = { remainingOverlaps: [{ group: "401и", date: "2026-02-02" }] };

test("R69 keeps C-FIO temporal overlaps diagnostic-only for courses 4-6", () => {
  const course4 = applyR69ToForeignCycleQa({
    ...overlap, status: "REVIEW_REQUIRED", passed: false,
    unhandledBlocks: [], missingTimes: [], duplicates: [], mainGridSubjectDays: 4,
  }, 4);
  assert.equal(course4.status, "PASS");
  assert.equal(course4.remainingOverlaps.length, 1);

  const course5 = applyR69ToForeignCycleQa({
    ...overlap, status: "REVIEW_REQUIRED", passed: false,
    unhandledBlocks: [], missingTimes: [], mirrorSemanticRisks: [], duplicates: [], mainGridSubjectDays: 5,
  }, 5);
  assert.equal(course5.status, "PASS");
  assert.equal(course5.remainingOverlaps.length, 1);

  const course6 = applyR69ToForeignCycleQa({
    ...overlap, status: "REVIEW_REQUIRED", passed: false,
    unhandledBlocks: [], missingTimes: [], mirrorSemanticRisks: [], unresolvedConfirmedRules: [], duplicates: [],
  }, 6);
  assert.equal(course6.status, "PASS");
  assert.equal(course6.remainingOverlaps.length, 1);
});

test("R69 C-FIO policy preserves real fail-closed blockers", () => {
  assert.equal(applyR69ToForeignCycleQa({
    unhandledBlocks: [{ reason: "unknown-block" }], missingTimes: [], duplicates: [], mainGridSubjectDays: 4,
  }, 4).status, "REVIEW_REQUIRED");

  assert.equal(applyR69ToForeignCycleQa({
    unhandledBlocks: [], missingTimes: [], mirrorSemanticRisks: [{ subject: "unknown-mirror" }], duplicates: [], mainGridSubjectDays: 5,
  }, 5).status, "REVIEW_REQUIRED");

  assert.equal(applyR69ToForeignCycleQa({
    unhandledBlocks: [], missingTimes: [], mirrorSemanticRisks: [], unresolvedConfirmedRules: [{ reason: "gia-unresolved" }], duplicates: [],
  }, 6).status, "REVIEW_REQUIRED");
});
