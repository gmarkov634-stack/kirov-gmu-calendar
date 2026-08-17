import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server wires IzhGMU into shared protected review router", () => {
  assert.match(server, /IzhgmuReviewQueue/);
  assert.match(server, /IzhgmuReviewedService/);
  assert.match(server, /new IzhgmuReviewQueue\(config\)/);
  assert.match(server, /new IzhgmuReviewedService\(\{ queue: izhgmuReviewQueue, scheduleStore: store \}\)/);
  assert.match(server, /ScheduleReviewServiceRouter\(\[kgmuReviewedService, omgmuReviewedService, izhgmuReviewedService\]\)/);
  assert.match(server, /\/api\/v1\/schedule-review\/control/);
});

test("IzhGMU does not gain a separate direct publish endpoint", () => {
  assert.doesNotMatch(server, /\/api\/v1\/admin\/izhgmu\/publish/);
  assert.doesNotMatch(server, /\/api\/v1\/admin\/izhgmu\/parser-reviews/);
});
