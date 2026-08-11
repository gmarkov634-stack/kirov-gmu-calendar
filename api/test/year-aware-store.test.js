import test from "node:test";
import assert from "node:assert/strict";
import { mergeYearSchedules } from "../src/year-aware-store.js";

function schedule(semester, events, sources = []) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course: 1,
    academicYear: "2026/27",
    semester,
    timezone: "Europe/Moscow",
    group: { id: "kgmu:medicine:1:101", code: "101", displayName: "Группа 101" },
    sources,
    events,
  };
}

test("annual schedule contains both semesters in chronological order", () => {
  const first = schedule(1, [{ id: "a", title: "Осень", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:00:00+03:00" }], [{ url: "fall" }]);
  const second = schedule(2, [{ id: "b", title: "Весна", start: "2027-02-01T09:00:00+03:00", end: "2027-02-01T10:00:00+03:00" }], [{ url: "spring" }]);
  const result = mergeYearSchedules(first, second);
  assert.deepEqual(result.includedSemesters, [1, 2]);
  assert.deepEqual(result.events.map((event) => event.id), ["a", "b"]);
  assert.equal(result.sources.length, 2);
});

test("annual schedule works while only one semester is published", () => {
  const first = schedule(1, [{ id: "a", title: "Осень", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:00:00+03:00" }]);
  assert.equal(mergeYearSchedules(first, null), first);
});

test("annual merge removes event duplicates", () => {
  const event = { id: "same", title: "Лекция", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:00:00+03:00" };
  const result = mergeYearSchedules(schedule(1, [event]), schedule(2, [event]));
  assert.equal(result.events.length, 1);
});
