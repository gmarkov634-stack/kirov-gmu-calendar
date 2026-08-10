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

function config(enabled, spring = false) {
  return {
    testScheduleFixtureEnabled: enabled,
    testScheduleSpringFixtureEnabled: spring,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
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
  assert.equal(schedule.events.length, 13);
  assert.equal(semesterEndFromSchedule(schedule), "2026-12-30T10:30:00.000Z");

  const disabledStore = new MultiUniversityStore(config(false));
  assert.equal(await disabledStore.getSchedule(request), null);
});

test("published spring fixture moves year plan forward while semester plan stays on autumn", async () => {
  const store = new MultiUniversityStore(config(true, true));

  const semesterSchedule = await store.getSchedule({
    ...request,
    academicYear: "2026/27",
    semester: 1,
    plan: "semester",
  });
  assert.equal(semesterSchedule.semester, 1);
  assert.match(semesterSchedule.events[0].title, /^\[ТЕСТ\]/);

  const yearSchedule = await store.getSchedule({
    ...request,
    academicYear: "2026/27",
    semester: 1,
    plan: "year",
  });
  assert.equal(yearSchedule.semester, 2);
  assert.match(yearSchedule.events[0].title, /^\[ТЕСТ ВЕСНА\]/);
  assert.equal(yearSchedule.events.length, 8);

  const springGroups = await store.listScheduleGroups({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    academicYear: "2026/27",
    semester: 2,
  });
  assert.equal(springGroups.some((group) => group.groupCode === "132"), true);
});
