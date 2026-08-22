import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_EVENTS,
  EXPECTED_GROUPS,
} from "../tools/ugmu-course1-production-storage-stage.mjs";
import { verifyUgmuCourse1ProductionStorage } from "../tools/ugmu-course1-production-storage-verify.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function eventCounts() {
  const base = Math.floor(EXPECTED_EVENTS / EXPECTED_GROUPS.length);
  const remainder = EXPECTED_EVENTS - base * EXPECTED_GROUPS.length;
  return EXPECTED_GROUPS.map((_group, index) => base + (index < remainder ? 1 : 0));
}

function missingManifest() {
  const counts = eventCounts();
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
      eventCount: counts[index],
      hashes: { scheduleSha256: "0".repeat(64) },
    })),
  };
}

class ReadOnlyMissingS3 {
  constructor() {
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command.constructor.name);
    assert.equal(command.constructor.name, "GetObjectCommand", "readback verifier must never mutate S3");
    const error = new Error("NoSuchKey");
    error.name = "NoSuchKey";
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  }
}

test("course-1 production readback verifier is read-only and reports all missing objects", async () => {
  const s3 = new ReadOnlyMissingS3();
  const report = await verifyUgmuCourse1ProductionStorage({
    s3,
    bucket: "test",
    manifest: missingManifest(),
  });
  assert.equal(report.passed, false);
  assert.equal(report.readOnly, true);
  assert.equal(report.totals.groups, 50);
  assert.equal(report.totals.events, EXPECTED_EVENTS);
  assert.equal(report.totals.verified, 0);
  assert.equal(report.totals.missing, 50);
  assert.equal(report.totals.failed, 50);
  assert.equal(s3.commands.length, 50);
  assert.equal(s3.commands.every((name) => name === "GetObjectCommand"), true);
});

test("pinned course-1 authority cannot activate commerce or public product state", async () => {
  const authorityPath = path.join(root, "universities/ugmu/course1-production-staging-authority.json");
  const authorityText = await fs.readFile(authorityPath, "utf8");
  const authority = JSON.parse(authorityText);
  assert.equal(sha256(authorityText), "820e0f3537905872a136532142aaf31117396cd0cb3411f3e700466e68fb63e6");
  assert.equal(authority.manifestId, "ugmu-course1-2026-autumn-c23093970be0");
  assert.equal(authority.manifestSha256, "bb701f0619df8f53eb3943b846be8b8ac5e815225aace15df34de051b4c194eb");
  assert.deepEqual(authority.groups, EXPECTED_GROUPS);
  assert.equal(authority.productionStorageWrite, true);
  for (const key of [
    "registryMutation",
    "catalogMutation",
    "checkoutMutation",
    "publicEndpointsMutation",
    "publicIcsMutation",
    "trialsMutation",
    "canonicalPublicationWrite",
    "salesActivation",
  ]) assert.equal(authority[key], false, `${key} must remain false`);
  assert.equal(authority.commerceState, "preserve-current-production-state");
  assert.equal(authority.sourceQa.requiredEvent, "workflow_dispatch");
  assert.equal(authority.sourceQa.requiredBranch, "main");
  assert.equal(authority.sourceQa.requireSameHeadSha, true);
});

test("course-1 production staging workflow is manual-only and source-run pinned", async () => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/ugmu-course1-production-storage-stage.yml"), "utf8");
  assert.match(workflow, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  push:\n/);
  assert.doesNotMatch(workflow, /\n  pull_request:\n/);
  assert.match(workflow, /source_run_id:/);
  assert.match(workflow, /\.event == "workflow_dispatch"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /EXPECTED_MANIFEST_SHA256: bb701f0619df8f53eb3943b846be8b8ac5e815225aace15df34de051b4c194eb/);
  assert.match(workflow, /EXPECTED_AUTHORITY_SHA256: 820e0f3537905872a136532142aaf31117396cd0cb3411f3e700466e68fb63e6/);
  assert.match(workflow, /secrets\.S3_ACCESS_KEY_ID/);
  assert.match(workflow, /secrets\.S3_SECRET_ACCESS_KEY/);
  assert.match(workflow, /ugmu-course1-production-storage-verify\.mjs/);
  assert.doesNotMatch(workflow, /EVO_CR_LOGIN|EVO_CR_PWD|containers\.api\.cloud\.ru/);
});
