import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../universities/ugmu/controlled-live-payment-canary-plan.json", import.meta.url));
const plan = JSON.parse(readFileSync(path, "utf8"));

test("UGMU live-payment canary is blocked until an explicit real-payment decision", () => {
  assert.equal(plan.version, 1);
  assert.equal(plan.kind, "ugmu-controlled-live-payment-canary-plan");
  assert.equal(plan.boundary, "controlled-live-payment-canary-explicit-decision");
  assert.equal(plan.status, "AWAITING_EXPLICIT_AUTHORIZATION");
  assert.equal(plan.authorization.requiresExplicitUserDecision, true);
  assert.equal(plan.authorization.genericContinueIsAuthorization, false);
  assert.equal(plan.authorization.executionAllowed, false);
  assert.equal(plan.authorization.paymentCreationAllowed, false);
  assert.equal(plan.authorization.automaticExecutionAllowed, false);
  assert.equal(plan.authorization.scheduledExecutionAllowed, false);
  assert.equal(plan.authorization.pullRequestExecutionAllowed, false);
  assert.equal(plan.authorization.authorizationMustNameRealLivePayment, true);
});

test("canary cannot expand the launched UGMU scope", () => {
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
  assert.equal(plan.safety.realPaymentBeforeExplicitAuthorizationAllowed, false);
});

test("canary preflight is pinned to the restored live production state", () => {
  assert.equal(plan.preconditions.productionMetaSales, "open");
  assert.equal(plan.preconditions.productionMetaTrials, "closed");
  assert.equal(plan.preconditions.productionMetaPaymentMode, "live");
  assert.equal(plan.preconditions.globalCommercialSalesEnabled, false);
  assert.equal(plan.preconditions.ugmuSalesEnabled, true);
  assert.equal(plan.preconditions.ugmuActive, true);
  assert.equal(plan.preconditions.yookassaTestMode, false);
  assert.equal(plan.preconditions.liveShopId, "1258890");
  assert.equal(plan.preconditions.liveSecretPath, "yookassa-secret-key");
  assert.equal(plan.preconditions.productionSchedulesRequired, 12);
  assert.equal(plan.preconditions.rollbackSnapshotsRequired, 12);
});

test("PASS evidence requires exactly one live payment and post-canary recovery proof", () => {
  for (const required of [
    "fresh-preflight-pass",
    "single-live-payment-test-false",
    "order-succeeded",
    "single-paid-subscription",
    "tokenized-ics-http-200",
    "public-schedule-http-404",
    "public-ics-http-404",
    "post-canary-operational-monitor-pass",
  ]) assert.ok(plan.evidenceRequiredForPass.includes(required), required);
  assert.equal(plan.nextStateBeforeAuthorization, "WAIT");
});
