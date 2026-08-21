import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const authority = JSON.parse(readFileSync(`${root}universities/ugmu/post-launch-ci-mode.json`, "utf8"));
const currentSmoke = readFileSync(`${root}.github/workflows/ugmu-cloudru-production-smoke.yml`, "utf8");

function workflow(path) {
  return readFileSync(`${root}${path}`, "utf8");
}

test("UGMU post-launch CI authority captures the launched production invariants", () => {
  assert.equal(authority.version, 1);
  assert.equal(authority.kind, "ugmu-post-launch-ci-mode");
  assert.equal(authority.boundary, "post-launch-ci-mode-transition");
  assert.equal(authority.status, "ACTIVE");
  assert.deepEqual(authority.productionInvariants, {
    globalSalesEnabled: false,
    ugmuSalesEnabled: true,
    ugmuActive: true,
    trialsEnabled: false,
    yookassaTestMode: false,
    paymentMode: "live",
    publicScheduleEnabled: false,
    publicIcsEnabled: false,
  });
  assert.equal(authority.nextRequiredBoundary, "post-launch-operational-monitoring");
});

test("current UGMU production signal is read-only post-launch smoke", () => {
  assert.equal(authority.currentProductionSignal.workflow, ".github/workflows/ugmu-cloudru-production-smoke.yml");
  assert.equal(authority.currentProductionSignal.productionMutationAllowed, false);
  assert.equal(authority.currentProductionSignal.paymentCreationAllowed, false);
  assert.match(currentSmoke, /meta\.get\('sales'\) == 'open'/);
  assert.match(currentSmoke, /meta\.get\('trials'\) == 'closed'/);
  assert.match(currentSmoke, /meta\.get\('paymentMode'\) == 'live'/);
  assert.match(currentSmoke, /schedule_not_published/);
  assert.match(currentSmoke, /paymentCreated': False/);
  assert.match(currentSmoke, /productionMutationPerformed': False/);
  assert.doesNotMatch(currentSmoke, /sales_not_open/);
});

test("retired prelaunch workflows are manual-only and cannot act as PR production regression gates", () => {
  assert.ok(authority.retiredPrelaunchWorkflows.length >= 8);
  for (const path of authority.retiredPrelaunchWorkflows) {
    const text = workflow(path);
    assert.match(text, /\(retired\)/i, path);
    assert.match(text, /workflow_dispatch:/, path);
    assert.doesNotMatch(text, /pull_request:/, path);
    assert.doesNotMatch(text, /workflow_run:/, path);
    assert.doesNotMatch(text, /\bpush:/, path);
  }
});

test("post-launch CI transition did not widen UGMU launch scope", () => {
  assert.equal(authority.scopeGuards.globalCommercialSalesRemainClosed, true);
  assert.equal(authority.scopeGuards.publicUgmuScheduleRemainsClosed, true);
  assert.equal(authority.scopeGuards.publicUgmuIcsRemainsClosed, true);
  assert.equal(authority.scopeGuards.trialsRemainClosed, true);
  assert.equal(authority.scopeGuards.scopeExpansionPerformed, false);
  assert.equal(authority.evidence.productionMutationPerformedByTransition, false);
  assert.equal(authority.evidence.paymentCreatedByTransition, false);
  assert.equal(authority.evidence.temporaryTestWindowClosed, true);
  assert.equal(authority.evidence.firstPassingPostLaunchSmokeRun, 32468965673);
});
