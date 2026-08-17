import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

test("server wires IzhGMU only into shared protected review control", async () => {
  const server = await fs.readFile(path.join(ROOT, "src/server.js"), "utf8");
  assert.match(server, /IzhgmuReviewQueue/);
  assert.match(server, /IzhgmuReviewedService/);
  assert.match(server, /new ScheduleReviewServiceRouter\(\[kgmuReviewedService, omgmuReviewedService, izhgmuReviewedService\]\)/);
  assert.match(server, /\/api\/v1\/schedule-review\/control/);
  assert.doesNotMatch(server, /\/api\/v1\/admin\/izhgmu\/[^"']*publish/);
  assert.doesNotMatch(server, /IzhgmuSourceWatcher/);
});

test("IzhGMU source watch cannot mutate schedule or commercial state", async () => {
  const workflow = await fs.readFile(path.resolve(ROOT, "../.github/workflows/izhgmu-source-watch.yml"), "utf8");
  assert.doesNotMatch(workflow, /publishScheduleBatch/);
  assert.doesNotMatch(workflow, /schedule-review\/control/);
  assert.doesNotMatch(workflow, /COMMERCIAL_SALES_ENABLED\s*=/);
  assert.doesNotMatch(workflow, /TRIALS_ENABLED\s*=/);
  assert.doesNotMatch(workflow, /catalogEnabled\s*=/);
});
