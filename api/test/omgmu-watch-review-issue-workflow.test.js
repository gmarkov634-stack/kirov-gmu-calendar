import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../../.github/workflows/omgmu-source-watch.yml", import.meta.url), "utf8");
const config = JSON.parse(fs.readFileSync(new URL("../../universities/omgmu/source-watch.json", import.meta.url), "utf8"));

test("scheduled OmGMU watcher checks hourly and requires the exact autumn offer period", () => {
  assert.match(workflow, /cron:\s*"23 \* \* \* \*"/);
  assert.equal(config.expectedAcademicYear, "2026/2027");
  assert.equal(config.expectedSemester, "autumn");
  assert.match(workflow, /Capture exact current-period official PDFs[\s\S]*if: steps\.watch\.outputs\.ready == 'true'/);
  assert.match(workflow, /Upload newly active PDFs[\s\S]*if: steps\.watch\.outputs\.ready == 'true'/);
  assert.doesNotMatch(workflow, /Capture exact current-period official PDFs[\s\S]{0,160}has_target/);
});

test("current-period PDFs create deduplicated source-bound review issues", () => {
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /Create deduplicated source-bound review issues/);
  assert.match(workflow, /OMGMU-SOURCE-\$short in:title/);
  assert.match(workflow, /gh issue create --title "\$title" --body "\$body"/);
  assert.match(workflow, /\.sha256/);
  assert.match(workflow, /omgmu-new-program-pdfs/);
  assert.match(workflow, /availableTargets/);
});

test("GitHub source watch remains observation/review-only", () => {
  assert.doesNotMatch(workflow, /publishScheduleBatch\s*\(/);
  assert.doesNotMatch(workflow, /\/api\/v1\/schedule-review\/control/);
  assert.doesNotMatch(workflow, /PutObjectCommand|DeleteObjectCommand|S3Client/);
  assert.doesNotMatch(workflow, /COMMERCIAL_SALES_ENABLED\s*=\s*true/);
  assert.doesNotMatch(workflow, /TRIALS_ENABLED\s*=\s*true/);
  assert.doesNotMatch(workflow, /FUNNEL_ANALYTICS_ENABLED\s*=\s*true/);
});
