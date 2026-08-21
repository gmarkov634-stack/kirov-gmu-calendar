import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const plan = JSON.parse(fs.readFileSync(new URL("../../universities/ugmu/trial-access-plan.json", import.meta.url), "utf8"));

test("UGMU trial deploy safety remains branch-only and fail-closed", () => {
  assert.equal(plan.version, 5);
  assert.equal(plan.kind, "ugmu-trial-access-plan");
  assert.equal(plan.boundary, "ugmu-trial-deploy-safety-complete");
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
  assert.equal(plan.deploymentSafety.workflow, ".github/workflows/deploy-api-cloudru.yml");
  assert.equal(plan.deploymentSafety.globalTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.ugmuTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.productionMetaCanProveUgmuGateClosed, true);
  assert.equal(plan.deploymentSafety.ugmuSpecificClosedGateSmoke, true);
  assert.equal(plan.deploymentSafety.requiredFix, null);

  assert.equal(plan.antiAbuse.policyFinalized, false);
  assert.equal(plan.antiAbuse.identity.method, "HMAC-SHA256");
  assert.equal(plan.antiAbuse.identity.ambiguousMultiHopForwardedFor, "fail-closed");
  assert.equal(plan.antiAbuse.identity.socketAddressFallback, false);
  assert.equal(plan.antiAbuse.claim.groupIndependent, true);
  assert.equal(plan.antiAbuse.claim.s3AtomicCreate, "If-None-Match:*");
  assert.ok(plan.antiAbuse.limitations.includes("cloudru-container-apps-forwarded-client-address-contract-not-verified"));

  assert.equal(plan.verification.deploySafetyApiTestsRunId, 32501035002);
  assert.equal(plan.verification.deploySafetyApiTestsConclusion, "success");
  assert.equal(plan.verification.deploySafetyProductionSmokeRunId, 32501035001);
  assert.equal(plan.verification.deploySafetyProductionSmokeConclusion, "success");
  assert.equal(plan.verification.deploySafetyAllPrChecksConclusion, "success");
  assert.ok(plan.verification.coverage.includes("ugmu-deploy-pre-post-closed-gate-assertions"));
  assert.ok(plan.verification.coverage.includes("ugmu-meta-dedicated-trial-state"));
  assert.ok(plan.verification.coverage.includes("ugmu-specific-closed-gate-production-smoke"));

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
  assert.equal(plan.nextRequiredBoundary, "ugmu-trial-proxy-contract-secret-and-production-e2e");
});
