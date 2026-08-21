import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const plan = JSON.parse(fs.readFileSync(new URL("../../universities/ugmu/trial-access-plan.json", import.meta.url), "utf8"));

test("UGMU trial is active and maintenance hardening is prepared without production mutation", () => {
  assert.equal(plan.version, 8);
  assert.equal(plan.kind, "ugmu-trial-access-plan");
  assert.equal(plan.boundary, "ugmu-production-trial-active-maintenance-hardening-prepared");
  assert.equal(plan.status, "PRODUCTION_TRIAL_ACTIVE_MAINTENANCE_HARDENING_PREPARED_NOT_MERGED");

  assert.deepEqual(plan.scope.groups, Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`));
  assert.equal(plan.scope.program, "medicine");
  assert.equal(plan.scope.course, 1);
  assert.equal(plan.scope.stream, "1");
  assert.equal(plan.scope.academicYear, "2026/2027");
  assert.equal(plan.scope.semester, 1);

  assert.equal(plan.runtimeIsolation.legacyGlobalFlag, "TRIALS_ENABLED");
  assert.equal(plan.runtimeIsolation.ugmuFlag, "UGMU_TRIALS_ENABLED");
  assert.equal(plan.runtimeIsolation.productionLegacyGlobalState, "closed");
  assert.equal(plan.runtimeIsolation.productionUgmuState, "open");
  assert.equal(plan.runtimeIsolation.globalFlagAloneCanOpenUgmu, false);
  assert.equal(plan.runtimeIsolation.ugmuFlagCanOpenOtherUniversities, false);

  assert.equal(plan.trialProduct.paymentRequired, false);
  assert.equal(plan.trialProduct.publicScheduleRequired, false);
  assert.equal(plan.trialProduct.publicIcsRequired, false);
  assert.equal(plan.trialProduct.tokenizedSubscriptionIcs, true);
  assert.deepEqual(plan.trialProduct.window, { days: 7, anchor: "first-schedule-event-date", fixed: true });

  assert.equal(plan.landingUx.wired, true);
  assert.equal(plan.landingUx.canonicalSource, "ugmu/");
  assert.equal(plan.landingUx.publishedInProduction, true);
  assert.equal(plan.landingUx.trialPath, "/api/v2/trials");
  assert.equal(plan.landingUx.serverGateAuthoritative, true);
  assert.equal(plan.landingUx.legacyMetaTrialsGateUsed, false);
  assert.equal(plan.landingUx.dedicatedUgmuMetaStateUsedForCta, true);

  assert.equal(plan.deploymentSafety.globalTrialsGateMustRemainClosed, true);
  assert.equal(plan.deploymentSafety.activeUgmuGateMustBePreserved, true);
  assert.equal(plan.deploymentSafety.sourceWorkflowStillAssumesUgmuClosed, false);
  assert.equal(plan.deploymentSafety.activeGatePreservingDeployFixPrepared, true);
  assert.equal(plan.deploymentSafety.activeGatePreservingDeployFixMerged, false);
  assert.equal(plan.deploymentSafety.activeUgmuSmokeCreatesTrial, false);
  assert.equal(plan.deploymentSafety.productionDeployAllowedByThisPlan, false);

  assert.equal(plan.productionOperations.backendDeployment.verifiedInProduction, true);
  assert.equal(plan.productionOperations.backendDeployment.healthVerified, true);
  assert.equal(plan.productionOperations.backendDeployment.legacyTrialsClosed, true);
  assert.equal(plan.productionOperations.backendDeployment.ugmuTrialsOpen, true);
  assert.equal(plan.productionOperations.pagesDeployment.verifiedInProduction, true);
  assert.equal(plan.productionOperations.pagesDeployment.trialEntryPointPresent, true);

  assert.equal(plan.productionOperations.proxyContract.verifiedInProduction, true);
  assert.equal(plan.productionOperations.proxyContract.rawAddressesReturned, false);
  assert.equal(plan.productionOperations.proxyContract.verificationRunId, 32504210989);
  assert.equal(plan.productionOperations.proxyContract.policyResolution, "x-real-ip");

  assert.equal(plan.productionOperations.identitySecret.workflowPrepared, true);
  assert.equal(plan.productionOperations.identitySecret.provisionedInProduction, true);
  assert.equal(plan.productionOperations.identitySecret.provisionRunId, 32505123452);
  assert.equal(plan.productionOperations.identitySecret.valueExposed, false);

  assert.equal(plan.productionOperations.activation.workflowPrepared, true);
  assert.equal(plan.productionOperations.activation.executed, true);
  assert.equal(plan.productionOperations.activation.activationRunId, 32505547867);
  assert.equal(plan.productionOperations.activation.activationConclusion, "success");
  assert.equal(plan.productionOperations.activation.productionTrialE2eCompleted, true);
  assert.equal(plan.productionOperations.activation.enablesOnlyUgmuTrialGate, true);
  assert.equal(plan.productionOperations.activation.preflightFailureHandlingHardeningPrepared, true);
  assert.equal(plan.productionOperations.activation.hardeningMerged, false);

  assert.equal(plan.antiAbuse.policyFinalized, true);
  assert.equal(plan.antiAbuse.identity.method, "HMAC-SHA256");
  assert.equal(plan.antiAbuse.identity.verifiedProductionResolution, "x-real-ip");
  assert.equal(plan.antiAbuse.identity.ambiguousMultiHopForwardedFor, "fail-closed");
  assert.equal(plan.antiAbuse.claim.groupIndependent, true);
  assert.equal(plan.antiAbuse.claim.s3AtomicCreate, "If-None-Match:*");

  assert.equal(plan.verification.productionSecretProvisionRunId, 32505123452);
  assert.equal(plan.verification.productionSecretProvisionConclusion, "success");
  assert.equal(plan.verification.productionActivationRunId, 32505547867);
  assert.equal(plan.verification.productionActivationConclusion, "success");
  assert.equal(plan.verification.productionTrialSubscriptionE2eVerified, true);
  assert.equal(plan.verification.productionTrialContinuationE2eVerified, true);
  assert.deepEqual(plan.verification.productionPublicMetaAfterActivation, {
    legacyTrials: "closed",
    ugmuTrials: "open",
  });
  assert.ok(plan.verification.sourceHardeningPrepared.includes("activation-preflight-nonzero-failure-propagation"));
  assert.ok(plan.verification.sourceHardeningPrepared.includes("api-deploy-preserves-current-ugmu-trial-gate"));
  assert.ok(plan.verification.sourceHardeningPrepared.includes("active-ugmu-post-deploy-smoke-does-not-create-trial"));

  assert.equal(plan.activation.currentlyActiveInProduction, true);
  assert.equal(plan.activation.additionalActivationRequired, false);
  assert.equal(plan.activation.productionFlagMutationAllowedByThisPlan, false);
  assert.deepEqual(plan.activation.blockers, []);

  assert.equal(plan.pendingMaintenance.activationWorkflowFailurePropagationPrepared, true);
  assert.equal(plan.pendingMaintenance.apiDeployActiveGatePreservationPrepared, true);
  assert.equal(plan.pendingMaintenance.trialWindowSemanticsChanged, false);
  assert.equal(plan.pendingMaintenance.changesMerged, false);
  assert.equal(plan.pendingMaintenance.productionMutationPerformed, false);

  assert.equal(plan.safety.trialFlagMutationPerformed, true);
  assert.equal(plan.safety.identitySecretMutationPerformed, true);
  assert.equal(plan.safety.trialSubscriptionCreated, true);
  assert.equal(plan.safety.paymentCreationAllowed, false);
  assert.equal(plan.safety.publicScheduleAllowed, false);
  assert.equal(plan.safety.publicIcsAllowed, false);
  assert.equal(plan.safety.globalTrialsActivationAllowed, false);
  assert.equal(plan.safety.globalSalesMutationAllowed, false);
  assert.equal(plan.safety.sourceBranchChangesDoNotMutateProduction, true);
  assert.equal(plan.nextRequiredBoundary, "merge-maintenance-hardening-before-next-api-runtime-deploy");
});
