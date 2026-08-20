import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAggregate, ugmuFailClosedBoundary } from "../tools/cross-university-historical-regression.mjs";

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
