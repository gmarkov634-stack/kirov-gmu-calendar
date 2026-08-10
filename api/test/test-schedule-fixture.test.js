import assert from "node:assert/strict";
import test from "node:test";
import { MultiUniversityStore } from "../src/university-store.js";
import { semesterEndFromSchedule } from "../src/subscription-period.js";

const request = {
  university: "kgmu",
  program: "pediatrics",
  course: 1,
  groupId: "kgmu:pediatrics:1:132",
  groupCode: "132",
};

function config(enabled) {
  return {
    testScheduleFixtureEnabled: enabled,
    cacheTtlMs: 1000,
    dataDir: "/tmp/nonexistent-calendar-test-data",
    accessKeyId: "",
    secretAccessKey: "",
  };
}

test("synthetic KGMU autumn fixture is served only when explicitly enabled", async () => {
  const enabledStore = new MultiUniversityStore(config(true));
  const schedule = await enabledStore.getSchedule(request);
  assert.equal(schedule.testFixture, true);
  assert.equal(schedule.academicYear, "2026/27");
  assert.equal(schedule.semester, 1);
  assert.equal(schedule.group.code, "132");
  assert.equal(schedule.events.length, 12);
  assert.equal(semesterEndFromSchedule(schedule), "2026-12-29T14:30:00.000Z");

  const disabledStore = new MultiUniversityStore(config(false));
  assert.equal(await disabledStore.getSchedule(request), null);
});
