import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scheduleStorageKey } from "../src/order-context.js";
import { MultiUniversityStore } from "../src/university-store.js";

const context = {
  university: "kgmu",
  program: "pediatrics",
  course: 1,
  groupCode: "132",
  groupId: "kgmu:pediatrics:1:132",
  academicYear: "2026/27",
};

function schedule(semester, title) {
  return {
    version: 2,
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    group: { id: context.groupId, code: "132", displayName: "Группа 132" },
    timezone: "Europe/Moscow",
    academicYear: "2026/27",
    semester,
    events: [{
      id: `semester-${semester}`,
      title,
      start: semester === 1 ? "2026-09-01T05:30:00.000Z" : "2027-02-01T05:30:00.000Z",
      end: semester === 1 ? "2026-09-01T07:00:00.000Z" : "2027-02-01T07:00:00.000Z",
    }],
  };
}

async function writeSchedule(dataDir, value) {
  const key = scheduleStorageKey(value);
  const filename = path.join(dataDir, key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(value));
  return key;
}

test("storage key includes academic year and semester", () => {
  assert.equal(
    scheduleStorageKey({ ...context, semester: 1 }),
    "schedules/kgmu/pediatrics/1/2026-2027/semester-1/kgmu%3Apediatrics%3A1%3A132.json",
  );
});

test("semester and year subscriptions can read different semesters simultaneously", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "semester-storage-"));
  try {
    const autumn = schedule(1, "Осеннее занятие");
    const spring = schedule(2, "Весеннее занятие");
    await writeSchedule(dataDir, autumn);
    await writeSchedule(dataDir, spring);

    const store = new MultiUniversityStore({
      dataDir,
      cacheTtlMs: 300000,
      accessKeyId: "",
      secretAccessKey: "",
      offerAcademicYear: "2026/27",
      offerSemester: 1,
    });

    const semesterSchedule = await store.getSchedule({ ...context, semester: 1, plan: "semester" });
    assert.equal(semesterSchedule.semester, 1);
    assert.equal(semesterSchedule.events[0].title, "Осеннее занятие");

    const yearSchedule = await store.getSchedule({ ...context, semester: 1, plan: "year" });
    assert.equal(yearSchedule.semester, 2);
    assert.equal(yearSchedule.events[0].title, "Весеннее занятие");

    const autumnStillAvailable = await store.getSchedule({ ...context, semester: 1, plan: "semester" });
    assert.equal(autumnStillAvailable.semester, 1);
    assert.equal(autumnStillAvailable.events[0].title, "Осеннее занятие");

    const springGroups = await store.listScheduleGroups({
      university: "kgmu",
      program: "pediatrics",
      course: 1,
      academicYear: "2026/27",
      semester: 2,
    });
    assert.deepEqual(springGroups, [{
      groupId: "kgmu:pediatrics:1:132",
      groupCode: "132",
      displayName: "Группа 132",
    }]);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy flat fallback is accepted only when its period matches the request", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "semester-fallback-"));
  try {
    const flatKey = "schedules/kgmu/pediatrics/1/kgmu%3Apediatrics%3A1%3A132.json";
    const filename = path.join(dataDir, flatKey);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(schedule(2, "Старый плоский файл")));

    const store = new MultiUniversityStore({
      dataDir,
      cacheTtlMs: 300000,
      accessKeyId: "",
      secretAccessKey: "",
    });

    assert.equal(
      await store.getSchedule({ ...context, semester: 1, plan: "semester" }),
      null,
    );
    assert.equal(
      (await store.getSchedule({ ...context, semester: 2, plan: "semester" })).semester,
      2,
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
