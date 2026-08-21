import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const authorityPath = fileURLToPath(new URL("../../universities/ugmu/post-launch-operational-monitoring.json", import.meta.url));
const authority = JSON.parse(readFileSync(authorityPath, "utf8"));

test("UGMU post-launch operational monitoring boundary passed and remains active", () => {
  assert.equal(authority.version, 2);
  assert.equal(authority.kind, "ugmu-post-launch-operational-monitoring");
  assert.equal(authority.boundary, "post-launch-operational-monitoring");
  assert.equal(authority.boundaryStatus, "PASS");
  assert.equal(authority.status, "ACTIVE");
  assert.deepEqual(authority.productionInvariants, {
    globalSalesEnabled: false,
    ugmuSalesEnabled: true,
    ugmuActive: true,
    trialsEnabled: false,
    yookassaTestMode: false,
    paymentMode: "live",
    liveShopId: "1258890",
    liveSecretPath: "yookassa-secret-key",
    publicScheduleEnabled: false,
    publicIcsEnabled: false,
  });
});

test("monitor is scheduled from main with fast public and daily deep checks", () => {
  assert.equal(authority.monitoring.mainWorkflow, ".github/workflows/ugmu-post-launch-operational-monitor.yml");
  assert.equal(authority.monitoring.mainWorkflowCommit, "77189c67c0c62d224043c55117a93336709ec468");
  assert.equal(authority.monitoring.hourlyPublicCron, "17 * * * *");
  assert.equal(authority.monitoring.dailyDeepCron, "43 1 * * *");
  for (const check of [
    "health",
    "meta-sales-open",
    "meta-payment-mode-live",
    "ugmu-launch-landing",
    "public-schedule-closed",
    "public-ics-closed",
  ]) assert.ok(authority.monitoring.publicChecks.includes(check), check);
  for (const check of [
    "cloudru-container-running",
    "live-yookassa-shop-and-secret-reference",
    "yookassa-get-payments-live-only",
    "twelve-production-schedules-present",
    "twelve-production-schedule-hashes-match",
    "twelve-rollback-snapshots-present",
  ]) assert.ok(authority.monitoring.deepChecks.includes(check), check);
});

test("operational monitor has a durable exact-scope storage baseline", () => {
  assert.equal(authority.storageBaseline.path, "universities/ugmu/baselines/post-launch-first-stream-manifest.json");
  assert.equal(authority.storageBaseline.sourceEvidenceManifestSha256, "2d8103b1c0a873c8cd52cc569426338342f2671ce0d740db6f3f0482590262e5");
  assert.equal(authority.storageBaseline.sourceSha256, "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8");
  assert.equal(authority.storageBaseline.groups, 12);
  assert.equal(authority.storageBaseline.events, 4286);
});

test("step 30 evidence proves recovered public and deep production boundaries", () => {
  assert.equal(authority.evidence.monitorRunId, 32470331508);
  assert.equal(authority.evidence.monitorRunAttempt, 2);
  assert.equal(authority.evidence.monitorConclusion, "success");
  assert.equal(authority.evidence.publicJobConclusion, "success");
  assert.equal(authority.evidence.deepJobConclusion, "success");
  assert.equal(authority.evidence.publicIncidentIssueClosed, true);
  assert.equal(authority.evidence.pagesCompatibility.pagesBuildTypeObserved, "legacy");
  assert.equal(authority.evidence.pagesCompatibility.settingsMigrationApplied, false);
  assert.equal(authority.evidence.pagesCompatibility.durableMainRootBridge, true);
  assert.equal(authority.evidence.pagesCompatibility.bridgeCommit, "c6aaf1913ad4cd5a2d105967af3977335c4620b8");
  assert.equal(authority.evidence.pagesCompatibility.recoveryProvenByMonitorAttempt2, true);
  assert.equal(authority.evidence.paymentCreated, false);
  assert.equal(authority.evidence.backendMutationPerformed, false);
  assert.equal(authority.evidence.s3MutationPerformed, false);
  assert.equal(authority.evidence.pagesRecoveryMutationPerformed, true);
});

test("operational monitoring stays read-only and live-payment canary requires an explicit decision", () => {
  assert.deepEqual(authority.safety, {
    productionMutationAllowed: false,
    paymentCreationAllowed: false,
    s3WriteAllowed: false,
    cloudruMutationAllowed: false,
    publicScopeExpansionAllowed: false,
    globalSalesChangeAllowed: false,
  });
  assert.equal(authority.nextRequiredBoundary, "controlled-live-payment-canary-explicit-decision");
});
