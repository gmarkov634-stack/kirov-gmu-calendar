import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../universities/ugmu/post-launch-repository-stabilization.json", import.meta.url));
const boundary = JSON.parse(readFileSync(path, "utf8"));

test("UGMU repository stabilization passed against fresh green CI but still blocks merge without explicit authorization", () => {
  assert.equal(boundary.version, 2);
  assert.equal(boundary.kind, "ugmu-post-launch-repository-stabilization");
  assert.equal(boundary.boundary, "post-launch-repository-and-pr-stabilization");
  assert.equal(boundary.status, "PASS");
  assert.equal(boundary.pullRequest.number, 237);
  assert.equal(boundary.pullRequest.draftRequired, true);
  assert.equal(boundary.pullRequest.mergeAllowed, false);
  assert.equal(boundary.pullRequest.readyForReviewAllowed, false);
  assert.equal(boundary.pullRequest.mergeabilityAtStart, false);
  assert.equal(boundary.pullRequest.mergeabilityNow, true);
  assert.equal(boundary.pullRequest.behindMainAtCiVerification, 0);
  assert.equal(boundary.pullRequest.mergeBaseNow, boundary.pullRequest.mainHead);
  assert.equal(boundary.pullRequest.currentBranchHeadAtCiVerification, "41fb0528835ba7735e9b8ef8683497c807f42a9e");
  assert.equal(boundary.pullRequest.technicalStabilizationPassed, true);
});

test("real payment canary stays deferred and non-blocking", () => {
  assert.equal(boundary.livePaymentCanary.status, "DEFERRED_BY_USER");
  assert.equal(boundary.livePaymentCanary.nonBlocking, true);
  assert.equal(boundary.livePaymentCanary.paymentCreationAllowed, false);
  assert.equal(boundary.safety.realPaymentAllowed, false);
});

test("post-launch main authority is preserved exactly in the feature branch", () => {
  assert.equal(boundary.mainAuthorityPreserved.sharedPagesWorkflowExactMainBlob, "9d7bb53099b838a5a9267800e2985b46f07f2f89");
  assert.equal(boundary.mainAuthorityPreserved.operationalMonitorPreserved, true);
  assert.equal(boundary.mainAuthorityPreserved.durableStorageBaselinePreserved, true);
  assert.equal(boundary.mainAuthorityPreserved.rootUgmuLaunchCopyPreserved, true);
  assert.equal(boundary.mainAuthorityPreserved.mainOnlyPostLaunchAssetsMergedIntoFeature, true);
});

test("launch-era workflow debt is removed and temporary CI diagnostics are gone", () => {
  assert.equal(boundary.cleanupCompleted.closedTestCheckoutRemoved, true);
  assert.equal(boundary.cleanupCompleted.historicalObserversRemoved, 15);
  assert.equal(boundary.cleanupCompleted.oneShotLaunchTestWindowAndDiagnosticsRemoved, 21);
  assert.equal(boundary.cleanupCompleted.totalWorkflowFilesRemovedFromMergeCandidate, 36);
  assert.equal(boundary.cleanupCompleted.retiredStep29ManualOnlyStubsPreserved, true);
  assert.equal(boundary.cleanupCompleted.temporaryApiTestDiagnosticRemoved, true);
  assert.equal(boundary.currentCi.historicalObserverFailuresEliminated, true);
});

test("step 32 final CI evidence is complete and green", () => {
  assert.equal(boundary.currentCi.head, "41fb0528835ba7735e9b8ef8683497c807f42a9e");
  assert.equal(boundary.currentCi.meaningfulWorkflowCount, 17);
  assert.equal(boundary.currentCi.failuresAtFinalRead, 0);
  assert.equal(boundary.currentCi.stateAtFinalRead, "completed-success");
  assert.equal(boundary.currentCi.allMeaningfulWorkflowsPassed, true);
  assert.equal(Object.keys(boundary.currentCi.runs).length, 17);
  assert.equal(boundary.currentCi.runs.apiTests, 32485846660);
  assert.equal(boundary.currentCi.runs.productionStorageReadback, 32485846578);
  assert.equal(boundary.currentCi.runs.postLaunchProductionSmoke, 32485846650);
  assert.equal(boundary.resolvedCiBlockers.storageReadbackPostLaunchGetOnlyCommit, "16cac4e0e32a38b3fec7001b6e056d414a55cd64");
  assert.equal(boundary.resolvedCiBlockers.apiRegressionAlignmentCommit, "41fb0528835ba7735e9b8ef8683497c807f42a9e");
  assert.equal(boundary.resolvedCiBlockers.apiDiagnosticFailedTests, 3);
  assert.equal(boundary.resolvedCiBlockers.apiDiagnosticTotalTests, 694);
  assert.equal(boundary.resolvedCiBlockers.storageReadbackNoLongerPostsPayments, true);
  assert.equal(boundary.nextRequiredSubBoundary, "explicit-merge-decision");
});

test("stabilization cannot expand or mutate production scope", () => {
  assert.equal(boundary.productionScopeChangeAllowed, false);
  assert.equal(boundary.safety.mergeNowAllowed, false);
  assert.equal(boundary.safety.scopeExpansionAllowed, false);
  assert.equal(boundary.safety.publicScheduleChangeAllowed, false);
  assert.equal(boundary.safety.publicIcsChangeAllowed, false);
  assert.equal(boundary.safety.trialsChangeAllowed, false);
  assert.equal(boundary.safety.globalSalesChangeAllowed, false);
  assert.equal(boundary.safety.productionMutationAllowed, false);
});
