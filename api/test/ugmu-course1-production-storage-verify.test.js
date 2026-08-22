import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EXPECTED_EVENTS, EXPECTED_GROUPS } from "../tools/ugmu-course1-production-storage-stage.mjs";
import { verifyUgmuCourse1ProductionStorage } from "../tools/ugmu-course1-production-storage-verify.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function missingManifest() {
  const base = Math.floor(EXPECTED_EVENTS / EXPECTED_GROUPS.length);
  const remainder = EXPECTED_EVENTS - base * EXPECTED_GROUPS.length;
  return {
    kind: "ugmu-course1-preactivation-schedule-dry-run",
    passed: true,
    publicationAllowed: false,
    scope: { groups: EXPECTED_GROUPS },
    totals: { groups: 50, events: EXPECTED_EVENTS },
    groups: EXPECTED_GROUPS.map((group, index) => ({
      group,
      stream: index < 12 ? "1" : index < 24 ? "2" : index < 36 ? "3" : "4",
      storageKey: `schedules/ugmu/medicine/1/2026-2027/semester-1/${encodeURIComponent(group)}.json`,
      eventCount: base + (index < remainder ? 1 : 0),
      hashes: { scheduleSha256: "0".repeat(64) },
    })),
  };
}

class ReadOnlyMissingS3 {
  constructor() { this.commands = []; }
  async send(command) {
    this.commands.push(command.constructor.name);
    assert.equal(command.constructor.name, "GetObjectCommand");
    const error = new Error("NoSuchKey");
    error.name = "NoSuchKey";
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  }
}

test("course-1 production readback verifier is read-only", async () => {
  const s3 = new ReadOnlyMissingS3();
  const report = await verifyUgmuCourse1ProductionStorage({ s3, bucket: "test", manifest: missingManifest() });
  assert.equal(report.passed, false);
  assert.equal(report.readOnly, true);
  assert.equal(report.totals.groups, 50);
  assert.equal(report.totals.missing, 50);
  assert.equal(s3.commands.length, 50);
  assert.equal(s3.commands.every((name) => name === "GetObjectCommand"), true);
});

test("course-1 authority pins the reviewed artifact and cannot activate product state", async () => {
  const authorityText = await fs.readFile(path.join(root, "universities/ugmu/course1-production-staging-authority.json"), "utf8");
  const authority = JSON.parse(authorityText);
  assert.equal(sha256(authorityText), "b269e0c3696de89d61c3e9d01e9b1a35ca4ceae4437b2d0118071e59549f9fad");
  assert.equal(authority.manifestId, "ugmu-course1-2026-autumn-c23093970be0");
  assert.equal(authority.manifestSha256, "bb701f0619df8f53eb3943b846be8b8ac5e815225aace15df34de051b4c194eb");
  assert.deepEqual(authority.groups, EXPECTED_GROUPS);
  assert.equal(authority.productionStorageWrite, true);
  for (const key of ["registryMutation", "catalogMutation", "checkoutMutation", "publicEndpointsMutation", "publicIcsMutation", "trialsMutation", "canonicalPublicationWrite", "salesActivation"]) {
    assert.equal(authority[key], false);
  }
  assert.equal(authority.credentialPath, "cloudru-runtime-container-env");
  assert.equal(authority.sourceQa.runId, 32561505590);
  assert.equal(authority.sourceQa.event, "pull_request");
  assert.equal(authority.sourceQa.headSha, "ae0a4a9002c89719f41290d25d8b9d22717d4fbb");
});

test("course-1 staging workflow is a single manual action using pinned evidence", async () => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/ugmu-course1-production-storage-stage.yml"), "utf8");
  assert.match(workflow, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  push:\n|\n  pull_request:\n|\n  schedule:\n/);
  assert.doesNotMatch(workflow, /source_run_id:/);
  assert.match(workflow, /SOURCE_RUN_ID: "32561505590"/);
  assert.match(workflow, /SOURCE_HEAD_SHA: ae0a4a9002c89719f41290d25d8b9d22717d4fbb/);
  assert.match(workflow, /EXPECTED_MANIFEST_SHA256: bb701f0619df8f53eb3943b846be8b8ac5e815225aace15df34de051b4c194eb/);
  assert.match(workflow, /EXPECTED_AUTHORITY_SHA256: b269e0c3696de89d61c3e9d01e9b1a35ca4ceae4437b2d0118071e59549f9fad/);
  assert.match(workflow, /secrets\.EVO_CR_LOGIN/);
  assert.match(workflow, /secrets\.EVO_CR_PWD/);
  assert.match(workflow, /ugmu-course1-production-storage-stage\.mjs/);
  assert.match(workflow, /ugmu-course1-production-storage-verify\.mjs/);
});
