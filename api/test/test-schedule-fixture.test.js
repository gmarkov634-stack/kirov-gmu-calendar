import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MultiUniversityStore } from "../src/university-store.js";

const request = {
  university: "kgmu",
  program: "pediatrics",
  course: 1,
  groupId: "kgmu:pediatrics:1:132",
  groupCode: "132",
  academicYear: "2026/27",
  semester: 1,
};

test("legacy synthetic-schedule environment flags no longer enable fixtures", async () => {
  const config = loadConfig({
    TEST_SCHEDULE_FIXTURE_ENABLED: "true",
    TEST_SCHEDULE_SPRING_FIXTURE_ENABLED: "true",
    OFFER_ACADEMIC_YEAR: "2026/27",
    OFFER_SEMESTER: "1",
    DATA_DIR: "/tmp/nonexistent-calendar-test-data",
  });

  assert.equal(Object.hasOwn(config, "testScheduleFixtureEnabled"), false);
  assert.equal(Object.hasOwn(config, "testScheduleSpringFixtureEnabled"), false);

  const store = new MultiUniversityStore(config);
  assert.equal(await store.getSchedule(request), null);
});
