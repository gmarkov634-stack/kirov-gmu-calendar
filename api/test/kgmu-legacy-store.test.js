import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MultiUniversityStore } from "../src/university-store.js";

async function withDataDir(callback) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-legacy-"));
  try {
    await callback(dataDir);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

function config(dataDir) {
  return {
    dataDir,
    cacheTtlMs: 300000,
    accessKeyId: "",
    secretAccessKey: "",
  };
}

const legacySchedule = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  group: "132",
  timezone: "Europe/Moscow",
  academicYear: "2026/2027",
  semester: 1,
  events: [{
    id: "legacy-132-1",
    start: "2026-09-01T08:00:00+03:00",
    end: "2026-09-01T09:30:00+03:00",
    title: "Педиатрия",
  }],
};

test("shared store reads a legacy KGMU schedule when the normalized key is absent", async () => withDataDir(async (dataDir) => {
  const filename = path.join(dataDir, "schedules", "pediatrics", "1", "132.json");
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(legacySchedule));

  const store = new MultiUniversityStore(config(dataDir));
  const schedule = await store.getSchedule({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupCode: "132",
    groupId: "kgmu:pediatrics:1:132",
  });

  assert.equal(schedule.group, "132");
  assert.equal(schedule.events.length, 1);
}));

test("normalized KGMU key takes priority over legacy storage", async () => withDataDir(async (dataDir) => {
  const legacyFilename = path.join(dataDir, "schedules", "pediatrics", "1", "132.json");
  await fs.mkdir(path.dirname(legacyFilename), { recursive: true });
  await fs.writeFile(legacyFilename, JSON.stringify(legacySchedule));

  const normalized = {
    ...legacySchedule,
    group: { id: "kgmu:pediatrics:1:132", code: "132", displayName: "Группа 132" },
    events: [{ ...legacySchedule.events[0], id: "normalized-132-1", title: "Новая схема" }],
  };
  const normalizedFilename = path.join(
    dataDir,
    "schedules",
    "kgmu",
    "pediatrics",
    "1",
    `${encodeURIComponent("kgmu:pediatrics:1:132")}.json`,
  );
  await fs.mkdir(path.dirname(normalizedFilename), { recursive: true });
  await fs.writeFile(normalizedFilename, JSON.stringify(normalized));

  const store = new MultiUniversityStore(config(dataDir));
  const schedule = await store.getSchedule({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupCode: "132",
    groupId: "kgmu:pediatrics:1:132",
  });

  assert.equal(schedule.events[0].title, "Новая схема");
}));

test("legacy KGMU groups are visible to shared group listing", async () => withDataDir(async (dataDir) => {
  const filename = path.join(dataDir, "schedules", "pediatrics", "1", "132.json");
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(legacySchedule));

  const store = new MultiUniversityStore(config(dataDir));
  const groups = await store.listScheduleGroups({ university: "kgmu", program: "pediatrics", course: 1 });

  assert.deepEqual(groups, [{
    groupId: "kgmu:pediatrics:1:132",
    groupCode: "132",
    displayName: "Группа 132",
  }]);
}));
