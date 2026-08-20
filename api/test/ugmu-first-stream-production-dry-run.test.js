import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { scheduleStorageKey } from "../src/order-context.js";

const TOOL = new URL("../tools/ugmu-first-stream-production-dry-run.mjs", import.meta.url);

function exampleSchedule(group = "ОЛД 101") {
  return {
    university: "ugmu",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: group,
    groupId: `ugmu:medicine:1:stream-1:${group}`,
    academicYear: "2026/2027",
    semester: 1,
  };
}

test("UGMU dry-run resolves exact production storage namespace", () => {
  const key = scheduleStorageKey(exampleSchedule());
  assert.equal(
    key,
    "schedules/ugmu/medicine/1/2026-2027/semester-1/ugmu%3Amedicine%3A1%3Astream-1%3A%D0%9E%D0%9B%D0%94%20101.json",
  );
});

test("UGMU dry-run tool is evidence-only and cannot write production", async () => {
  const source = await fs.readFile(TOOL, "utf8");
  for (const forbidden of [
    "@aws-sdk/client-s3",
    "S3Client",
    "PutObjectCommand",
    "DeleteObjectCommand",
    "CopyObjectCommand",
    "store.putSchedule",
    "publishScheduleBatch(",
    "containers.api.cloud.ru",
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden production primitive: ${forbidden}`);
  }
  assert.match(source, /productionMutationPerformed:\s*false/);
  assert.match(source, /s3WritePerformed:\s*false/);
  assert.match(source, /stagingWriteAuthority:\s*false/);
  assert.match(source, /salesAuthority:\s*false/);
});

test("UGMU dry-run freezes launch scope to OLD 101-112 and reviewed SHA", async () => {
  const source = await fs.readFile(TOOL, "utf8");
  assert.match(source, /Array\.from\(\{ length: 12 \}/);
  assert.match(source, /34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8/);
  assert.match(source, /EXPECTED_TOTAL_EVENTS = 4286/);
  assert.match(source, /preactivation-production-storage-staging/);
});
