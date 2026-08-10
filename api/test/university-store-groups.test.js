import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MultiUniversityStore } from "../src/university-store.js";

function localStore(dataDir) {
  return new MultiUniversityStore({
    dataDir,
    cacheTtlMs: 60_000,
    accessKeyId: "",
    secretAccessKey: "",
  });
}

test("listScheduleGroups reads and naturally sorts published group files", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-groups-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const directory = path.join(dataDir, "schedules", "kgmu", "pediatrics", "1");
  await fs.mkdir(directory, { recursive: true });

  const groupIds = [
    "kgmu:pediatrics:1:139",
    "kgmu:pediatrics:1:131",
    "kgmu:pediatrics:1:132",
  ];
  for (const groupId of groupIds) {
    await fs.writeFile(
      path.join(directory, `${encodeURIComponent(groupId)}.json`),
      JSON.stringify({ groupId }),
    );
  }
  await fs.writeFile(path.join(directory, "ignore.txt"), "ignore");

  const groups = await localStore(dataDir).listScheduleGroups({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
  });

  assert.deepEqual(groups, [
    { groupId: "kgmu:pediatrics:1:131", groupCode: "131", displayName: "Группа 131" },
    { groupId: "kgmu:pediatrics:1:132", groupCode: "132", displayName: "Группа 132" },
    { groupId: "kgmu:pediatrics:1:139", groupCode: "139", displayName: "Группа 139" },
  ]);
});

test("listScheduleGroups returns empty list when course directory is not published", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-groups-empty-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const groups = await localStore(dataDir).listScheduleGroups({
    university: "kgmu",
    program: "medicine",
    course: 4,
  });

  assert.deepEqual(groups, []);
});
