import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../universities/ugmu/post-launch-repository-stabilization.json", import.meta.url));
const boundary = JSON.parse(readFileSync(path, "utf8"));

test("UGMU repository stabilization is synchronized with main but still blocks merge pending CI", () => {
  assert.equal(boundary.version, 2);
  assert.equal(boundary.kind, "ugmu-post-launch-repository-stabilization");
  assert.equal(boundary.boundary, "post-launch-repository-and-pr-stabilization");
  assert.equal(boundary.status, "ACTIVE");
  assert.equal(boundary.pullRequest.number, 237);
  assert.equal(boundary.pullRequest.draftRequired, true);
  assert.equal(boundary.pullRequest.mergeAllowed, false);
  assert.equal(boundary.pullRequest.readyForReviewAllowed, false);
  assert.equal(boundary.pullRequest.mergeabilityAtStart, false);
  assert.equal(boundary.pullRequest.mergeabilityNow, true);
  assert.equal(boundary.pullRequest.behindMainNow, 0);
  assert.equal(boundary.pullRequest.mergeBaseNow, boundary.pullRequest.mainHead);
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

test("launch-era workflow debt is removed from the merge candidate", () => {
  assert.equal(boundary.cleanupCompleted.closedTestCheckoutRemoved, true);
  assert.equal(boundary.cleanupCompleted.historicalObserversRemoved, 15);
  assert.equal(boundary.cleanupCompleted.oneShotLaunchTestWindowAndDiagnosticsRemoved, 21);
  assert.equal(boundary.cleanupCompleted.totalWorkflowFilesRemovedFromMergeCandidate, 36);
  assert.equal(boundary.cleanupCompleted.retiredStep29ManualOnlyStubsPreserved, true);
  assert.equal(boundary.currentCi.historicalObserverFailuresEliminated, true);
  assert.equal(boundary.currentCi.failuresAtLastRead, 0);
  assert.equal(boundary.nextRequiredSubBoundary, "current-pr-ci-green");
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
