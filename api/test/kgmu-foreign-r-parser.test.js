import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseForeignRWorkbookSafe } from "../src/adapters/kgmu/foreign-r-safe.mjs";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  const encoded = [1, 2, 3, 4]
    .map((index) => fs.readFileSync(path.join(here, "fixtures", `kgmu-foreign-course1-2025-26.part${index}.b64`), "utf8").trim())
    .join("");
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

test("official foreign-student course 1 XLSX structure is classified as R", () => {
  const result = classifyKgmuWorkbook(loadFixture());
  assert.equal(result.type, "R");
  assert.deepEqual(result.features.groupCodes, ["101и", "102и", "103и", "104и", "105и", "106и", "107и", "108и", "109и", "110и"]);
});

test("foreign R production counters match verified source", () => {
  const result = parseForeignRWorkbookSafe(loadFixture(), { program: "foreign", course: 1 });
  assert.equal(result.qa.sourceAnchorCount, 184);
  assert.equal(result.qa.coveredSourceAnchors, 184);
  assert.equal(result.qa.eventCount, 2579);
  assert.equal(result.qa.sourceConflicts.length, 3);
});
