import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const plan = JSON.parse(fs.readFileSync(new URL("../../universities/ugmu/trial-access-plan.json", import.meta.url), "utf8"));

test("UGMU trial production operations remain prepared but not activation-ready", () => {
  assert.equal(plan.version, 6);
  assert.equal(plan.kind, "ugmu-trial-access-plan");
  assert.equal(plan.boundary, "ugmu-trial-production-operations-prepared");
  assert.equal(plan.status, "IMPLEMENTED_BRANCH_ONLY_NOT_ACTIVATION_READY");

  assert.deepEqual(plan.scope.groups, Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`));
  assert.equal(plan.scope.program, "medicine");
  assert.equal(plan.scope.course, 1);
  assert.equal(plan.scope.stream, "1");
  assert.equal(plan.scope.academicYear, "2026/2027");
  assert.equal(plan.scope.semester, 1);

  assert.equal(plan.runtimeIsolation.legacyGlobalFlag, "TRIALS_ENABLED");
  assert.equal(plan.runtimeIsolation.ugmuFlag, "UGMU_TRIALS_ENABLED");
  assert.equal(plan.runtimeIsolation.ugmuFlagDefault, false);
  assert.equal(plan.runtimeIsolation.globalFlagAloneCanOpenUgmu, false);
  assert.equal(plan.runtimeIsolation.ugmuFlagCanOpenOtherUniversities, false);
  assert.equal(plan.runtimeIsolation.exactScopeRequired, true);

  assert.equal(plan.trialProduct.paymentRequired, false);
  assert.equal(plan.trialProduct.publicScheduleRequired, false);
  assert.equal(plan.trialProduct.publicIcsRequired, false);
  assert.equal(plan.trialProduct.tokenizedSubscriptionIcs, true);
  assert.equal(plan.trialProduct.window.days, 7);
  assert.equal(plan.trialProduct.window.anchor, "first-schedule-event-date");
  assert.equal(plan.trialProduct.window.fixed, true);

  assert.equal(plan.landingUx.wired, true);
  assert.equal(plan.landingUx.trialPath, "/api/v2/trials");
  assert.equal(plan.landingUx.emailRequired, false);
  assert.equal(plan.landingUx.paymentRequired, false);
  assert.equal(plan.landingUx.serverGateAuthoritative, true);
  assert.equal(plan.landingUx.legacyMetaTrialsGateUsed, false);
  assert.equal(plan.landingUx.approvedScopeOnly, true);
  assert.equal(plan.landingUx.subscriptionUrlRenderedOnlyAfterSuccessfulCreate, true);
  assert.equal(plan.landingUx.continuationContextRestoredByConversionId, true);
  assert.equal(plan.landingUx.conversionIdPassedToPayment, true);

  assert.equal(plan.deploymentSafety.reviewed, true);
  assert.equal(plan.deploymentSafety.globalTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.ugmuTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.productionMetaCanProveUgmuGateClosed, true);
  assert.equal(plan.deploymentSafety.ugmuSpecificClosedGateSmoke, true);

  assert.equal(plan.productionOperations.proxyContract.workflowPrepared, true);
  assert.equal(plan.productionOperations.proxyContract.verifiedInProduction, false);
  assert.equal(plan.productionOperations.proxyContract.rawAddressesReturned, false);
  assert.equal(plan.productionOperations.identitySecret.workflowPrepared, true);
  assert.equal(plan.productionOperations.identitySecret.provisionedInProduction, false);
  assert.equal(plan.productionOperations.identitySecret.keepsTrialGatesClosed, true);
  assert.equal(plan.productionOperations.activation.workflowPrepared, true);
  assert.equal(plan.productionOperations.activation.executed, false);
  assert.equal(plan.productionOperations.activation.requiresProxyPreflight, true);
  assert.equal(plan.productionOperations.activation.requiresIdentitySecret, true);
  assert.equal(plan.productionOperations.activation.requiresLegacyGlobalTrialsClosed, true);
  assert.equal(plan.productionOperations.activation.enablesOnlyUgmuTrialGate, true);
  assert.equal(plan.productionOperations.activation.runsProductionTrialE2e, true);
  assert.equal(plan.productionOperations.activation.automaticGateRollbackOnFailure, true);
  assert.equal(plan.productionOperations.deactivation.workflowPrepared, true);
  assert.equal(plan.productionOperations.deactivation.executed, false);
  assert.equal(plan.productionOperations.deactivation.closesOnlyUgmuTrialGate, true);

  assert.equal(plan.antiAbuse.policyFinalized, false);
  assert.equal(plan.antiAbuse.identity.method, "HMAC-SHA256");
  assert.equal(plan.antiAbuse.identity.ambiguousMultiHopForwardedFor, "fail-closed");
  assert.equal(plan.antiAbuse.identity.socketAddressFallback, false);
  assert.equal(plan.antiAbuse.claim.groupIndependent, true);
  assert.equal(plan.antiAbuse.claim.s3AtomicCreate, "If-None-Match:*");
  assert.ok(plan.antiAbuse.limitations.includes("cloudru-container-apps-forwarded-client-address-contract-not-verified"));

  assert.equal(plan.verification.operationsPreparationApiTestsRunId, 32501924764);
  assert.equal(plan.verification.operationsPreparationApiTestsConclusion, "success");
  assert.equal(plan.verification.operationsPreparationStructuralRunId, 32501924832);
  assert.equal(plan.verification.operationsPreparationStructuralConclusion, "success");
  assert.equal(plan.verification.operationsPreparationObservedAllChecksConclusion, "success");
  assert.ok(plan.verification.coverage.includes("privacy-safe-admin-proxy-contract-observation"));
  assert.ok(plan.verification.coverage.includes("manual-proxy-contract-probe"));
  assert.ok(plan.verification.coverage.includes("guarded-identity-secret-provisioning"));
  assert.ok(plan.verification.coverage.includes("explicit-activation-with-proxy-and-secret-preflight"));
  assert.ok(plan.verification.coverage.includes("production-trial-e2e-on-activation"));
  assert.ok(plan.verification.coverage.includes("automatic-ugmu-gate-rollback-on-activation-failure"));
  assert.ok(plan.verification.coverage.includes("explicit-ugmu-trial-deactivation"));

  assert.equal(plan.activation.allowedNow, false);
  assert.equal(plan.activation.productionFlagMutationAllowedByThisPlan, false);
  assert.equal(plan.activation.automaticActivationAllowed, false);
  assert.equal(plan.activation.explicitDecisionRequired, true);
  assert.deepEqual(plan.activation.blockers, [
    "anti-abuse-proxy-contract-not-verified",
    "trial-identity-hmac-secret-not-provisioned-in-production",
    "ugmu-trial-production-e2e-not-completed",
    "explicit-trial-activation-decision-not-given",
  ]);

  for (const value of Object.values(plan.safety)) assert.equal(value, false);
  assert.equal(plan.nextRequiredBoundary, "deploy-branch-then-proxy-probe-secret-provision-and-explicit-activation");
});
