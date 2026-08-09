import assert from "node:assert/strict";
import test from "node:test";
import { accessObservation } from "../src/access-monitor.js";

test("access observation stores only a stable irreversible fingerprint", () => {
  const request = {
    headers: {
      "x-forwarded-for": "192.0.2.41, 10.0.0.1",
      "user-agent": "CalendarAgent/1.0 Apple",
    },
    socket: {},
  };
  const observation = accessObservation(request, "a-long-test-signing-secret-32-bytes-minimum", new Date("2026-08-09T12:00:00Z"));
  assert.match(observation.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(observation.client, "apple");
  assert.equal(observation.seenAt, "2026-08-09T12:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(observation), /192\.0\.2|CalendarAgent/);
});
