import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const publisher = fileURLToPath(new URL("../tools/omgmu-publish-s3.mjs", import.meta.url));

async function createPackage({ includeBlockedKey = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omgmu-publish-s3-"));
  await fs.mkdir(path.join(directory, "objects"), { recursive: true });
  const objectKey = "schedules/omgmu/medicine-international/2/omgmu%3Amedicine-international%3A2%3A2101.json";
  const blockedKey = "schedules/omgmu/medicine-international/2/omgmu%3Amedicine-international%3A2%3Astream-2%3A2113.json";
  const schedule = {
    version: 1,
    university: "omgmu",
    program: "medicine-international",
    course: 2,
    group: { id: "omgmu:medicine-international:2:2101", code: "2101" },
    events: [{
      id: "event-1",
      title: "Анатомия",
      start: "2026-04-06T08:00:00+06:00",
      end: "2026-04-06T10:00:00+06:00",
    }],
  };
  await fs.writeFile(path.join(directory, "objects", "2101.json"), `${JSON.stringify(schedule)}\n`, "utf8");
  const blocked = {
    group: "2113",
    reason: "manual-review-pending",
    ...(includeBlockedKey ? { key: blockedKey } : {}),
  };
  const manifest = {
    version: 1,
    university: "omgmu",
    publishableCount: 1,
    blockedCount: 1,
    objects: [{ group: "2101", key: objectKey, file: "objects/2101.json" }],
    blocked: [blocked],
  };
  await fs.writeFile(path.join(directory, "publication-manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  return { directory, blockedKey };
}

function publisherArgs(directory, reportPath) {
  return [
    publisher,
    `--package=${directory}`,
    `--report=${reportPath}`,
    "--expected-publishable=1",
    "--expected-blocked=1",
  ];
}

test("dry-run plans deletion of every blocked ОмГМУ schedule", async (context) => {
  const fixture = await createPackage();
  context.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const reportPath = path.join(fixture.directory, "report.json");

  await execFile(process.execPath, publisherArgs(fixture.directory, reportPath));
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  assert.equal(report.mode, "dry-run");
  assert.equal(report.planned.length, 1);
  assert.deepEqual(report.plannedDeletes, [{
    group: "2113",
    reason: "manual-review-pending",
    key: fixture.blockedKey,
  }]);
});

test("publisher rejects a blocked schedule without a storage key", async (context) => {
  const fixture = await createPackage({ includeBlockedKey: false });
  context.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const reportPath = path.join(fixture.directory, "report.json");

  await assert.rejects(
    execFile(process.execPath, publisherArgs(fixture.directory, reportPath)),
    (error) => {
      assert.match(String(error.stderr), /Invalid blocked publication entry/);
      return true;
    },
  );
});
