import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { stageRWorkbook } from "../src/adapters/kgmu/r-pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  const parts = [1, 2, 3].map((part) => fs.readFileSync(
    path.join(here, "fixtures", `kgmu-pediatrics-course1-2025-26.structure.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

test("R pipeline routes pediatrics through R-PED and treats source overlaps as non-blocking diagnostics under R69", async () => {
  const workbook = loadFixture();
  const classification = classifyKgmuWorkbook(workbook);
  let staged = null;
  const queue = {
    storeNormalized: async (sourceSha256, normalized) => {
      staged = { sourceSha256, normalized };
      return `parser-staging/kgmu/normalized/${sourceSha256}.json`;
    },
  };

  const result = await stageRWorkbook({
    workbook,
    queue,
    sourceSha256: "a".repeat(64),
    sourceKey: "parser-staging/kgmu/sources/pediatrics-course1.xlsx",
    metadata: {
      filename: "1_ped-14-01-2026-13.xlsx",
      program: "pediatrics",
      course: 1,
      academicYear: "2025/26",
      semester: 2,
    },
    period: { academicYear: "2025/26", semester: 2 },
    classification,
  });

  assert.equal(result.contextComplete, true);
  assert.equal(result.schedules.length, 9);
  assert.equal(result.qa.status, "PASS");
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.equal(result.qa.remainingOverlaps.length, 1);
  assert.equal(result.qa.remainingOverlaps[0].group, "132");

  assert.equal(staged.sourceSha256, "a".repeat(64));
  assert.equal(staged.normalized.parserType, "R");
  assert.equal(staged.normalized.parserProfile, "R-PED");
  assert.equal(staged.normalized.qa.status, "PASS");
  assert.equal(staged.normalized.schedules.length, 9);
  assert.ok(staged.normalized.schedules.every((schedule) => schedule.parser?.profile === "R-PED"));
});