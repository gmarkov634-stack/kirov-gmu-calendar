import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { YearAwareStore } from "../src/year-aware-store.js";
import { listOfferProgramAvailability } from "../src/offer-availability.js";

function schedule(groupCode = "131") {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
    timezone: "Europe/Moscow",
    group: {
      id: `kgmu:pediatrics:1:${groupCode}`,
      code: groupCode,
      displayName: `Группа ${groupCode}`,
    },
    sources: [{ type: "xlsx", sha256: "b".repeat(64) }],
    events: [{
      id: `event-${groupCode}`,
      title: "Анатомия",
      start: "2026-09-01T09:00:00+03:00",
      end: "2026-09-01T10:30:00+03:00",
      location: "",
    }],
  };
}

test("published KGMU bundle becomes discoverable and readable through current offer defaults", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-publish-offer-flow-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const store = new YearAwareStore({
    dataDir,
    cacheTtlMs: 60_000,
    accessKeyId: "",
    secretAccessKey: "",
    offerAcademicYear: "2026/27",
    offerSemester: 1,
  });

  assert.deepEqual(await listOfferProgramAvailability({
    store,
    university: "kgmu",
    academicYear: "2026/27",
    semester: 1,
  }), []);

  await store.putScheduleBundle([schedule("131"), schedule("132")], {
    sourceSha256: "b".repeat(64),
  });

  assert.deepEqual(await listOfferProgramAvailability({
    store,
    university: "kgmu",
    academicYear: "2026/27",
    semester: 1,
  }), [{ program: "pediatrics", courses: [1] }]);

  assert.deepEqual(await store.listScheduleGroups({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
  }), [
    { groupId: "kgmu:pediatrics:1:131", groupCode: "131", displayName: "Группа 131" },
    { groupId: "kgmu:pediatrics:1:132", groupCode: "132", displayName: "Группа 132" },
  ]);

  const published = await store.getSchedule({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupId: "kgmu:pediatrics:1:131",
    groupCode: "131",
  });
  assert.equal(published?.academicYear, "2026/27");
  assert.equal(published?.semester, 1);
  assert.equal(published?.group?.code, "131");
  assert.equal(published?.events?.[0]?.title, "Анатомия");
});
