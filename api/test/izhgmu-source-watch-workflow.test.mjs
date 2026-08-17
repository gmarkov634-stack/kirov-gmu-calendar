import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW = path.join(ROOT, ".github/workflows/izhgmu-source-watch.yml");

test("IzhGMU source watch is exact-period, review-only and hourly", async () => {
  const text = await fs.readFile(WORKFLOW, "utf8");
  assert.match(text, /cron: "37 \* \* \* \*"/);
  assert.match(text, /izhgmu-current-source-watch\.mjs/);
  assert.match(text, /IZHGMU-SOURCESET-/);
  assert.match(text, /ChatGPT semantic review/);
  assert.match(text, /issues: write/);
  assert.doesNotMatch(text, /\/api\/v1\/schedule-review\/control/);
  assert.doesNotMatch(text, /COMMERCIAL_SALES_ENABLED\s*=/);
  assert.doesNotMatch(text, /TRIALS_ENABLED\s*=/);
  assert.doesNotMatch(text, /catalogEnabled\s*=/);
  assert.doesNotMatch(text, /publishScheduleBatch\s*\(/);
});

test("IzhGMU watcher uploads an observation artifact before issue handoff", async () => {
  const text = await fs.readFile(WORKFLOW, "utf8");
  const artifact = text.indexOf("Upload immutable observation artifact");
  const issue = text.indexOf("Create deduplicated source-bound review issue");
  assert.ok(artifact > 0);
  assert.ok(issue > artifact);
  assert.match(text, /retention-days: 30/);
  assert.match(text, /steps\.target\.outputs\.status == 'candidate'/);
});
