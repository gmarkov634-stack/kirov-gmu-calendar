import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { YearAwareStore } from "../src/year-aware-store.js";
import { scheduleFlatStorageKey, scheduleStorageKey } from "../src/order-context.js";

function schedule() {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
    timezone: "Europe/Moscow",
    group: { id: "kgmu:medicine:1:101", code: "101", displayName: "Группа 101" },
    sources: [{ type: "xlsx", sha256: "a".repeat(64) }],
    events: [{ id: "e1", title: "Анатомия", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:30:00+03:00", location: "" }],
  };
}

test("putSchedule writes versioned and flat objects used by subscriptions", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-publish-"));
  try {
    const store = new YearAwareStore({ dataDir, cacheTtlMs: 1000, accessKeyId: "", secretAccessKey: "", offerAcademicYear: "2026/27", offerSemester: 1 });
    const value = schedule();
    const result = await store.putSchedule(value);
    assert.equal(result.versionedKey, scheduleStorageKey(value));
    assert.equal(result.flatKey, scheduleFlatStorageKey(value));

    const versioned = JSON.parse(await fs.readFile(path.join(dataDir, result.versionedKey), "utf8"));
    const flat = JSON.parse(await fs.readFile(path.join(dataDir, result.flatKey), "utf8"));
    assert.equal(versioned.group.code, "101");
    assert.deepEqual(flat.events, versioned.events);

    const readBack = await store.getSchedule({
      university: "kgmu",
      program: "medicine",
      course: 1,
      groupId: "kgmu:medicine:1:101",
      groupCode: "101",
      academicYear: "2026/27",
      semester: 1,
    });
    assert.equal(readBack.events[0].title, "Анатомия");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
