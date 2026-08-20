import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const apiDir = path.resolve(process.cwd());
const repoRoot = path.resolve(apiDir, "..");
const plan = JSON.parse(fs.readFileSync(path.resolve(repoRoot, "universities/ugmu/controlled-activation-plan.json"), "utf8"));
const tool = fs.readFileSync(path.resolve(apiDir, "tools/ugmu-controlled-activation-plan.mjs"), "utf8");
const expectedGroups = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);

function blocker(id) {
  return plan.mandatoryPreactivationBlocks.find((item) => item.id === id);
}

test("controlled activation plan freezes the approved first-stream scope and cannot activate production", () => {
  assert.equal(plan.university, "ugmu");
  assert.equal(plan.scope.sourceSha256, "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8");
  assert.deepEqual(plan.scope.groups, expectedGroups);
  assert.equal(plan.authority.automaticActivationAllowed, false);
  assert.equal(plan.authority.activationPerformedByPlan, false);
  assert.equal(plan.authority.productionMutationAllowedByPlan, false);
  assert.equal(plan.authority.requiresExplicitLaunchAuthorization, true);
});

test("launch target opens only paid UGMU checkout while public ICS and trials stay closed", () => {
  assert.equal(plan.launchTarget.registryActive, true);
  assert.equal(plan.launchTarget.apiRoutingEnabled, true);
  assert.equal(plan.launchTarget.checkoutEnabled, true);
  assert.equal(plan.launchTarget.publicEndpointsEnabled, false);
  assert.equal(plan.launchTarget.publicIcsEnabled, false);
  assert.equal(plan.launchTarget.trialsEnabled, false);
  assert.equal(plan.launchTarget.productionSchedulesRequired, 12);
  assert.equal(plan.launchTarget.paymentMode, "live");
});

test("plan records staging, commercial isolation and live checkout UI as complete", () => {
  for (const id of [
    "stage-first-stream-production-schedules",
    "isolate-global-sales-gate",
    "wire-live-ugmu-landing",
  ]) assert.equal(blocker(id)?.state, "completed", `${id} must be completed`);
  assert.match(blocker("stage-first-stream-production-schedules")?.completion || "", /32421951498/);
  assert.match(blocker("isolate-global-sales-gate")?.completion || "", /32424944030/);
  assert.equal(blocker("validate-live-yookassa-mode")?.state, "required");
  assert.equal(plan.nextRequiredBoundary, "validate-live-yookassa-mode");
});

test("backend activation uses the dedicated UGMU gate rather than opening the legacy global gate", () => {
  const phase = plan.phases.find((item) => item.id === "activate-backend-ugmu-checkout");
  assert.ok(phase.mutations.some((item) => item.includes("UGMU_SALES_ENABLED false -> true")));
  assert.ok(phase.mustRemainClosed.some((item) => item.includes("legacy global sales gate")));
});

test("prepared landing stays noindex/unpublished until explicit activation", () => {
  const phase = plan.phases.find((item) => item.id === "prepare-user-facing-landing");
  assert.equal(phase.state, "completed-not-deployed");
  assert.ok(phase.mustRemainClosed.includes("production Pages deployment"));
  assert.ok(phase.successChecks.some((item) => item.includes("sales=open and paymentMode=live")));
});

test("rollback closes access first and keeps staged schedules inert instead of deleting data", () => {
  assert.equal(plan.rollback.strategy, "close-access-first-keep-data-inert");
  assert.equal(plan.rollback.dataDeletionRequired, false);
  assert.ok(plan.rollback.order[0].includes("UGMU_SALES_ENABLED=false"));
  assert.ok(plan.rollback.order.some((step) => step.includes("Keep already staged schedule objects")));
  assert.ok(plan.rollback.subscriptionSafety.includes("must not be deleted"));
});

test("activation-plan validator is evidence-only and contains no cloud or payment mutation primitive", () => {
  for (const forbidden of [
    "PutObjectCommand",
    "DeleteObjectCommand",
    "publishScheduleBatch(",
    "containers.api.cloud.ru",
    "fetch(\"https://api.yookassa.ru",
  ]) {
    assert.equal(tool.includes(forbidden), false, `validator must not contain mutation primitive: ${forbidden}`);
  }
  assert.ok(tool.includes("productionMutationPerformed: false"));
  assert.ok(tool.includes("activationPerformed: false"));
});
