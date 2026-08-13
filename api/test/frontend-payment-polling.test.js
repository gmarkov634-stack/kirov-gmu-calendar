import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const appSource = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");

function numericMatch(pattern, label) {
  const match = appSource.match(pattern);
  assert.ok(match, `${label} not found in app.js`);
  return Number(match[1]);
}

test("payment result fallback cannot preempt the polling loop", () => {
  const attempts = numericMatch(/for \(let attempt = 0; attempt < (\d+); attempt \+= 1\)/, "polling attempts");
  const delayMs = numericMatch(/setTimeout\(resolve, (\d+)\)/, "polling delay");
  const fallbackMs = numericMatch(/setTimeout\(showIncompletePayment, (\d+)\)/, "fallback timer");
  const fullPollingWindowMs = attempts * delayMs;

  assert.equal(attempts, 15);
  assert.equal(delayMs, 2000);
  assert.ok(
    fallbackMs > fullPollingWindowMs,
    `fallback ${fallbackMs}ms must be later than polling window ${fullPollingWindowMs}ms`,
  );
});
