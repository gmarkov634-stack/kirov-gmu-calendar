import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { KgmuIngestServiceV2 } from "../src/adapters/kgmu/ingest-service-v2.mjs";
import { xlsxFromStructure } from "./helpers/xlsx-from-structure.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadPediatricsStructure() {
  const parts = [1, 2, 3].map((part) => fs.readFileSync(
    path.join(here, "fixtures", `kgmu-pediatrics-course1-2025-26.structure.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

function loadPediatricsFixture() {
  return xlsxFromStructure(loadPediatricsStructure());
}

function forbiddenDependency(name) {
  return new Proxy({}, {
    get() {
      throw new Error(`${name} must not be used by dryRun`);
    },
  });
}

function service() {
  return new KgmuIngestServiceV2({
    queue: forbiddenDependency("review queue"),
    notifier: forbiddenDependency("notifier"),
    scheduleStore: forbiddenDependency("schedule store"),
    config: { kgmuXlsxMaxBytes: 25 * 1024 * 1024 },
  });
}

test("dry run parses real pediatrics R structure without review, notification, or publication side effects", async () => {
  const result = await service().dryRun(loadPediatricsFixture(), {
    filename: "1_ped-14-01-2026-13.xlsx",
    program: "pediatrics",
    course: 1,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.classification.type, "R");
  assert.equal(result.classification.confidence, "high");
  assert.equal(result.derivedPeriod.academicYear, "2025/26");
  assert.equal(result.derivedPeriod.semester, 2);
  assert.equal(result.parserType, "R");
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.reason, "PARSER_R_QA_FAILED");
  assert.equal(result.publicationBlocked, true);
  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.equal(result.qa.remainingOverlaps.length, 1);
  assert.equal(result.qa.remainingOverlaps[0].group, "132");
  assert.equal(result.contextComplete, true);
  assert.equal(result.scheduleCount, 9);
  assert.ok(result.eventCount > 0);
  assert.deepEqual(result.groups, ["131", "132", "133", "134", "135", "136", "137", "138", "139"]);
});

test("dry run rejects a real old-period XLSX before staging when offered as 2026/27", async () => {
  const result = await service().dryRun(loadPediatricsFixture(), {
    filename: "1_ped-14-01-2026-13.xlsx",
    program: "pediatrics",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.classification.type, "R");
  assert.equal(result.derivedPeriod.academicYear, "2025/26");
  assert.equal(result.derivedPeriod.semester, 2);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.reason, "PERIOD_MISMATCH");
  assert.equal(result.publicationBlocked, true);
  assert.deepEqual(
    result.periodMismatches.map((item) => item.field).sort(),
    ["academicYear", "semester"],
  );
  assert.equal("qa" in result, false);
});
