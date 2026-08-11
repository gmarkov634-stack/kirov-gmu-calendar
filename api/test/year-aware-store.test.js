import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { mergeYearSchedules, YearAwareStore } from "../src/year-aware-store.js";

function schedule(semester, events, sources = [], group = "101", course = 1) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course,
    academicYear: "2026/27",
    semester,
    timezone: "Europe/Moscow",
    group: { id: `kgmu:medicine:${course}:${group}`, code: group, displayName: `Группа ${group}` },
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

test("bundle publication switches all groups through one current pointer", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-bundle-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = new YearAwareStore({
    dataDir,
    cacheTtlMs: 60_000,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
  });
  const event = (id, title) => ({ id, title, start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:00:00+03:00", location: "" });
  const firstBundle = [
    schedule(1, [event("101-a", "Версия A")], [], "101"),
    schedule(1, [event("102-a", "Версия A")], [], "102"),
  ];
  const first = await store.putScheduleBundle(firstBundle, { sourceSha256: "a".repeat(64) });
  assert.match(first.manifestKey, /current\.json$/);
  assert.equal((await store.getSchedule({
    university: "kgmu", program: "medicine", course: 1, groupCode: "101", groupId: "kgmu:medicine:1:101", academicYear: "2026/27", semester: 1,
  })).events[0].title, "Версия A");

  const secondBundle = [
    schedule(1, [event("101-b", "Версия B")], [], "101"),
    schedule(1, [event("102-b", "Версия B")], [], "102"),
  ];
  await store.putScheduleBundle(secondBundle, { sourceSha256: "b".repeat(64) });
  assert.equal((await store.getSchedule({
    university: "kgmu", program: "medicine", course: 1, groupCode: "101", groupId: "kgmu:medicine:1:101", academicYear: "2026/27", semester: 1,
  })).events[0].title, "Версия B");
  assert.equal((await store.getSchedule({
    university: "kgmu", program: "medicine", course: 1, groupCode: "102", groupId: "kgmu:medicine:1:102", academicYear: "2026/27", semester: 1,
  })).events[0].title, "Версия B");
});
