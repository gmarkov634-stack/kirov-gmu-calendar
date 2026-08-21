import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const plan = JSON.parse(fs.readFileSync(new URL("../../universities/ugmu/trial-access-plan.json", import.meta.url), "utf8"));

test("UGMU trial production readiness is verified while activation remains closed", () => {
  assert.equal(plan.version, 7);
  assert.equal(plan.kind, "ugmu-trial-access-plan");
  assert.equal(plan.boundary, "ugmu-production-readiness-verified");
  assert.equal(plan.status, "PRODUCTION_DEPLOYED_TRIAL_CLOSED_NOT_ACTIVATION_READY");

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
  assert.equal(plan.landingUx.canonicalSource, "ugmu/");
  assert.equal(plan.landingUx.publishedInProduction, true);
  assert.equal(plan.landingUx.trialPath, "/api/v2/trials");
  assert.equal(plan.landingUx.emailRequired, false);
  assert.equal(plan.landingUx.paymentRequired, false);
  assert.equal(plan.landingUx.serverGateAuthoritative, true);
  assert.equal(plan.landingUx.legacyMetaTrialsGateUsed, false);
  assert.equal(plan.landingUx.dedicatedUgmuMetaStateUsedForCta, true);
  assert.equal(plan.landingUx.ctaFailClosedWhenDedicatedGateClosed, true);

  assert.equal(plan.deploymentSafety.reviewed, true);
  assert.equal(plan.deploymentSafety.globalTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.ugmuTrialsGateAssertedClosed, true);
  assert.equal(plan.deploymentSafety.productionMetaCanProveUgmuGateClosed, true);
  assert.equal(plan.deploymentSafety.ugmuSpecificClosedGateSmoke, true);

  assert.equal(plan.productionOperations.backendDeployment.verifiedInProduction, true);
  assert.equal(plan.productionOperations.backendDeployment.healthVerified, true);
  assert.equal(plan.productionOperations.backendDeployment.legacyTrialsClosed, true);
  assert.equal(plan.productionOperations.backendDeployment.ugmuTrialsClosed, true);
  assert.equal(plan.productionOperations.pagesDeployment.verifiedInProduction, true);
  assert.equal(plan.productionOperations.pagesDeployment.canonicalSource, "ugmu/");
  assert.equal(plan.productionOperations.pagesDeployment.trialEntryPointPresent, true);
  assert.equal(plan.productionOperations.pagesDeployment.dedicatedMetaGatePresent, true);
  assert.equal(plan.productionOperations.pagesDeployment.legacyMetaGateAbsent, true);

  assert.equal(plan.productionOperations.proxyContract.workflowPrepared, true);
  assert.equal(plan.productionOperations.proxyContract.verifiedInProduction, true);
  assert.equal(plan.productionOperations.proxyContract.rawAddressesReturned, false);
  assert.equal(plan.productionOperations.proxyContract.verificationRunId, 32504210989);
  assert.equal(plan.productionOperations.proxyContract.policyResolution, "x-real-ip");
  assert.equal(plan.productionOperations.proxyContract.xRealIpPresent, true);
  assert.equal(plan.productionOperations.proxyContract.xForwardedForHopCount, 0);
  assert.equal(plan.productionOperations.proxyContract.injectedSentinelAccepted, false);

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

  assert.equal(plan.antiAbuse.policyFinalized, true);
  assert.equal(plan.antiAbuse.identity.method, "HMAC-SHA256");
  assert.equal(plan.antiAbuse.identity.verifiedProductionResolution, "x-real-ip");
  assert.equal(plan.antiAbuse.identity.ambiguousMultiHopForwardedFor, "fail-closed");
  assert.equal(plan.antiAbuse.identity.socketAddressFallback, false);
  assert.equal(plan.antiAbuse.claim.groupIndependent, true);
  assert.equal(plan.antiAbuse.claim.s3AtomicCreate, "If-None-Match:*");
  assert.ok(!plan.antiAbuse.limitations.includes("cloudru-container-apps-forwarded-client-address-contract-not-verified"));

  assert.equal(plan.verification.productionReadinessProbeRunId, 32504210989);
  assert.equal(plan.verification.productionReadinessProbeConclusion, "success");
  assert.equal(plan.verification.productionBackendVerified, true);
  assert.equal(plan.verification.productionPagesVerified, true);
  assert.equal(plan.verification.productionProxyContractVerified, true);
  assert.equal(plan.verification.productionProxyPolicyResolution, "x-real-ip");
  assert.ok(plan.verification.coverage.includes("canonical-ugmu-pages-source"));
  assert.ok(plan.verification.coverage.includes("production-backend-readiness-probe"));
  assert.ok(plan.verification.coverage.includes("production-pages-trial-ui-probe"));
  assert.ok(plan.verification.coverage.includes("production-cloudru-x-real-ip-contract-verification"));
  assert.ok(plan.verification.coverage.includes("guarded-identity-secret-provisioning"));
  assert.ok(plan.verification.coverage.includes("production-trial-e2e-on-activation"));

  assert.equal(plan.activation.allowedNow, false);
  assert.equal(plan.activation.productionFlagMutationAllowedByThisPlan, false);
  assert.equal(plan.activation.automaticActivationAllowed, false);
  assert.equal(plan.activation.explicitDecisionRequired, true);
  assert.deepEqual(plan.activation.blockers, [
    "trial-identity-hmac-secret-not-provisioned-in-production",
    "ugmu-trial-production-e2e-not-completed",
    "explicit-trial-activation-decision-not-given",
  ]);

  assert.equal(plan.safety.productionCodeDeploymentPerformed, true);
  assert.equal(plan.safety.productionPagesDeploymentPerformed, true);
  assert.equal(plan.safety.trialFlagMutationPerformed, false);
  assert.equal(plan.safety.identitySecretMutationPerformed, false);
  assert.equal(plan.safety.trialSubscriptionCreated, false);
  assert.equal(plan.safety.paymentCreationAllowed, false);
  assert.equal(plan.safety.publicScheduleAllowed, false);
  assert.equal(plan.safety.publicIcsAllowed, false);
  assert.equal(plan.safety.scopeExpansionAllowed, false);
  assert.equal(plan.safety.globalTrialsActivationAllowed, false);
  assert.equal(plan.safety.globalSalesMutationAllowed, false);
  assert.equal(plan.nextRequiredBoundary, "provision-trial-identity-hmac-secret-with-gates-closed");
});
