import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const plan = JSON.parse(fs.readFileSync(new URL("../../universities/ugmu/trial-access-plan.json", import.meta.url), "utf8"));

test("UGMU trial access plan remains fail-closed", () => {
  assert.equal(plan.version, 1);
  assert.equal(plan.kind, "ugmu-trial-access-plan");
  assert.equal(plan.boundary, "ugmu-trial-isolation-design");
  assert.equal(plan.status, "DESIGNED_FAIL_CLOSED");

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

  assert.equal(plan.activation.allowedNow, false);
  assert.equal(plan.activation.productionFlagMutationAllowedByThisPlan, false);
  assert.equal(plan.activation.automaticActivationAllowed, false);
  assert.equal(plan.activation.explicitDecisionRequired, true);
  assert.deepEqual(plan.activation.blockers, [
    "anti-abuse-policy-not-finalized",
    "ugmu-landing-trial-ux-not-wired",
    "ugmu-trial-production-e2e-not-completed",
    "explicit-trial-activation-decision-not-given",
  ]);

  for (const value of Object.values(plan.safety)) assert.equal(value, false);
  assert.equal(plan.nextRequiredBoundary, "ugmu-trial-anti-abuse-and-e2e-design");
});
