import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAggregate,
  runWithRetry,
  ugmuFailClosedBoundary,
} from "../tools/cross-university-historical-regression.mjs";

function pass(university) {
  return { university, passed: true };
}

test("cross-university gate passes only when all incumbents pass and UGMU remains fail-closed", () => {
  const ugmuBoundary = ugmuFailClosedBoundary();
  assert.equal(ugmuBoundary.passed, true);
  assert.deepEqual(ugmuBoundary.checks, {
    registryInactive: true,
    apiRoutingEnabled: true,
    publicEndpointsClosed: true,
    checkoutClosed: true,
    trialsClosed: true,
    paidRedirectBlank: true,
  });

  const result = evaluateAggregate({
    kgmu: pass("kgmu"),
    omgmu: pass("omgmu"),
    izhgmu: pass("izhgmu"),
    ugmuBoundary,
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.allPassed, true);
  assert.equal(result.nextRequiredBoundary, "pages-build-deploy-gate");
  assert.deepEqual(result.incumbentChecks, { kgmu: true, omgmu: true, izhgmu: true });
  assert.deepEqual(result.launchAuthority, {
    productionPublicationAllowedByThisGate: false,
    productionSalesAllowedByThisGate: false,
    productionActivationAllowedByThisGate: false,
  });
});

test("cross-university gate fails closed when any incumbent regression fails", () => {
  const result = evaluateAggregate({
    kgmu: pass("kgmu"),
    omgmu: { university: "omgmu", passed: false },
    izhgmu: pass("izhgmu"),
    ugmuBoundary: { passed: true },
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.allPassed, false);
  assert.equal(result.nextRequiredBoundary, "cross-university-historical-regression");
  assert.equal(result.incumbentChecks.omgmu, false);
});

test("cross-university gate fails closed if UGMU commercial boundary opens", () => {
  const result = evaluateAggregate({
    kgmu: pass("kgmu"),
    omgmu: pass("omgmu"),
    izhgmu: pass("izhgmu"),
    ugmuBoundary: { passed: false },
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.allPassed, false);
  assert.equal(result.nextRequiredBoundary, "cross-university-historical-regression");
});

test("bounded retry returns the first successful KGMU-style attempt", () => {
  let calls = 0;
  const result = runWithRetry(() => {
    calls += 1;
    return { status: calls < 3 ? 1 : 0, stdout: "", stderr: "", error: null };
  }, 3);
  assert.equal(calls, 3);
  assert.equal(result.status, 0);
  assert.equal(result.attempts, 3);
});

test("bounded retry remains fail-closed after every attempt fails", () => {
  let calls = 0;
  const result = runWithRetry(() => {
    calls += 1;
    return { status: 1, stdout: "", stderr: "fetch failed", error: null };
  }, 3);
  assert.equal(calls, 3);
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 3);
});
