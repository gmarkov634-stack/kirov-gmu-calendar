import assert from "node:assert/strict";
import test from "node:test";
import { buildQualityReport, inspectSchedule } from "../src/adapters/omgmu/quality.mjs";

const baseEvent = {
  id: "event-1",
  title: "Анатомия",
  start: "2026-04-06T08:00:00+06:00",
  end: "2026-04-06T10:00:00+06:00",
  location: "",
};

test("accepts a valid normalized schedule", () => {
  const result = inspectSchedule({ group: { code: "1101" }, events: [baseEvent] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test("detects duplicate events and invalid durations", () => {
  const duplicate = { ...baseEvent };
  const invalid = {
    id: "event-2",
    title: "",
    start: "2026-04-06T12:00:00+06:00",
    end: "2026-04-06T11:00:00+06:00",
  };
  const result = inspectSchedule({ group: { code: "1101" }, events: [baseEvent, duplicate, invalid] });
  assert.ok(result.errors.some((item) => item.code === "duplicate-id"));
  assert.ok(result.errors.some((item) => item.code === "duplicate-event"));
  assert.ok(result.errors.some((item) => item.code === "empty-title"));
  assert.ok(result.errors.some((item) => item.code === "invalid-duration"));
});

test("builds an aggregate quality report", () => {
  const report = buildQualityReport([
    { group: { code: "1101" }, events: [baseEvent] },
    { group: { code: "1102" }, events: [] },
  ]);
  assert.equal(report.scheduleCount, 2);
  assert.equal(report.eventCount, 1);
  assert.equal(report.errorCount, 1);
});
