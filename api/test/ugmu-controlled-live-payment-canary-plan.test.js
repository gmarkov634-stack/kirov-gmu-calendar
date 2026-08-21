import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../universities/ugmu/controlled-live-payment-canary-plan.json", import.meta.url));
const plan = JSON.parse(readFileSync(path, "utf8"));

test("UGMU live-payment canary is explicitly deferred and non-blocking", () => {
  assert.equal(plan.version, 2);
  assert.equal(plan.kind, "ugmu-controlled-live-payment-canary-plan");
  assert.equal(plan.boundary, "controlled-live-payment-canary-explicit-decision");
  assert.equal(plan.status, "DEFERRED_BY_USER");
  assert.equal(plan.nonBlocking, true);
  assert.equal(plan.deferral.blocksRepositoryStabilization, false);
  assert.equal(plan.deferral.blocksScopePreservingMaintenance, false);
  assert.equal(plan.deferral.blocksMergePreparation, false);
});

test("generic continuation can never authorize a real live payment", () => {
  assert.equal(plan.authorization.requiresExplicitUserDecision, true);
  assert.equal(plan.authorization.genericContinueIsAuthorization, false);
  assert.equal(plan.authorization.executionAllowed, false);
  assert.equal(plan.authorization.paymentCreationAllowed, false);
  assert.equal(plan.authorization.automaticExecutionAllowed, false);
  assert.equal(plan.authorization.scheduledExecutionAllowed, false);
  assert.equal(plan.authorization.pullRequestExecutionAllowed, false);
  assert.equal(plan.authorization.authorizationMustNameRealLivePayment, true);
  assert.equal(plan.safety.realPaymentBeforeExplicitAuthorizationAllowed, false);
});

test("deferred canary remains limited to the already launched UGMU scope", () => {
  assert.deepEqual(plan.scope.allowedGroups, ["ОЛД 101"]);
  assert.equal(plan.scope.maximumOrders, 1);
  assert.equal(plan.scope.maximumSuccessfulPayments, 1);
  assert.equal(plan.scope.sourceSha256, "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8");
  assert.equal(plan.safety.scopeExpansionAllowed, false);
  assert.equal(plan.safety.globalSalesChangeAllowed, false);
  assert.equal(plan.safety.publicScheduleChangeAllowed, false);
  assert.equal(plan.safety.publicIcsChangeAllowed, false);
  assert.equal(plan.safety.trialsChangeAllowed, false);
  assert.equal(plan.safety.cloudruConfigMutationAllowed, false);
  assert.equal(plan.safety.s3ScheduleMutationAllowed, false);
  assert.equal(plan.safety.priceOverrideAllowed, false);
});

test("repository stabilization is the next boundary while canary stays deferred", () => {
  assert.equal(plan.preconditions.productionMetaPaymentMode, "live");
  assert.equal(plan.preconditions.liveShopId, "1258890");
  assert.equal(plan.preconditions.productionSchedulesRequired, 12);
  assert.equal(plan.preconditions.rollbackSnapshotsRequired, 12);
  assert.equal(plan.nextRequiredBoundary, "post-launch-repository-and-pr-stabilization");
});
