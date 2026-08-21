import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../universities/ugmu/post-launch-repository-stabilization.json", import.meta.url));
const boundary = JSON.parse(readFileSync(path, "utf8"));

test("UGMU repository stabilization keeps PR draft and blocks merge", () => {
  assert.equal(boundary.version, 1);
  assert.equal(boundary.kind, "ugmu-post-launch-repository-stabilization");
  assert.equal(boundary.boundary, "post-launch-repository-and-pr-stabilization");
  assert.equal(boundary.status, "ACTIVE");
  assert.equal(boundary.pullRequest.number, 237);
  assert.equal(boundary.pullRequest.draftRequired, true);
  assert.equal(boundary.pullRequest.mergeAllowed, false);
  assert.equal(boundary.pullRequest.readyForReviewAllowed, false);
  assert.equal(boundary.pullRequest.mergeabilityAtStart, false);
});

test("real payment canary stays deferred and non-blocking", () => {
  assert.equal(boundary.livePaymentCanary.status, "DEFERRED_BY_USER");
  assert.equal(boundary.livePaymentCanary.nonBlocking, true);
  assert.equal(boundary.livePaymentCanary.paymentCreationAllowed, false);
  assert.equal(boundary.safety.realPaymentAllowed, false);
});

test("shared Pages workflow is the explicit reconciliation boundary", () => {
  assert.deepEqual(boundary.sharedConflictCandidates, [".github/workflows/omgmu-pages.yml"]);
  assert.equal(boundary.nextRequiredSubBoundary, "synchronize-shared-pages-workflow");
  for (const requirement of [
    "synchronize-shared-pages-workflow-with-main-post-launch-authority",
    "preserve-main-operational-monitor-and-durable-baseline",
    "repeat-main-vs-branch-compare",
    "confirm-github-mergeable-true",
    "run-current-pr-ci-and-classify-any-failures",
  ]) assert.ok(boundary.requiredBeforeMergeCandidate.includes(requirement), requirement);
});

test("stabilization cannot expand or mutate production scope", () => {
  assert.equal(boundary.productionScopeChangeAllowed, false);
  assert.equal(boundary.safety.scopeExpansionAllowed, false);
  assert.equal(boundary.safety.publicScheduleChangeAllowed, false);
  assert.equal(boundary.safety.publicIcsChangeAllowed, false);
  assert.equal(boundary.safety.trialsChangeAllowed, false);
  assert.equal(boundary.safety.globalSalesChangeAllowed, false);
  assert.equal(boundary.safety.productionMutationAllowed, false);
});
