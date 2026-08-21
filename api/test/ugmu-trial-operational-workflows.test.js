import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const deploy = fs.readFileSync(new URL("../../.github/workflows/deploy-api-cloudru.yml", import.meta.url), "utf8");
const proxyProbe = fs.readFileSync(new URL("../../.github/workflows/ugmu-proxy-contract-probe.yml", import.meta.url), "utf8");
const secretProvision = fs.readFileSync(new URL("../../.github/workflows/ugmu-trial-secret-provision.yml", import.meta.url), "utf8");
const activate = fs.readFileSync(new URL("../../.github/workflows/ugmu-trial-activate.yml", import.meta.url), "utf8");
const deactivate = fs.readFileSync(new URL("../../.github/workflows/ugmu-trial-deactivate.yml", import.meta.url), "utf8");

test("production deploy asserts the dedicated UGMU trial gate closed", () => {
  const guardMatches = deploy.match(/'UGMU_TRIALS_ENABLED'/g) || [];
  assert.ok(guardMatches.length >= 2);
  assert.match(deploy, /universityTrials',\{\}\)\.get\('ugmu'\) == 'closed'/);
  assert.match(deploy, /ugmu_trial_status/);
});

test("proxy contract probe verifies deployed backend and Pages without production mutation", () => {
  assert.match(proxyProbe, /workflow_dispatch:/);
  assert.match(proxyProbe, /pull_request:/);
  assert.match(proxyProbe, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(proxyProbe, /schedule:/);
  assert.match(proxyProbe, /meta\.get\('universityTrials',\{\}\)\.get\('ugmu'\) == 'closed'/);
  assert.match(proxyProbe, /UGMU_PRODUCTION_BACKEND_READY_SAFE/);
  assert.match(proxyProbe, /id=\"trial-start\"/);
  assert.match(proxyProbe, /Попробовать бесплатно/);
  assert.match(proxyProbe, /meta\.universityTrials\?\.ugmu === \"open\"/);
  assert.match(proxyProbe, /UGMU_PRODUCTION_PAGES_READY_SAFE/);
  assert.match(proxyProbe, /\/api\/v1\/admin\/proxy-contract/);
  assert.match(proxyProbe, /X-Proxy-Probe-Expected-Client/);
  assert.match(proxyProbe, /X-Proxy-Probe-Sentinel/);
  assert.match(proxyProbe, /UGMU_PROXY_CONTRACT_SAFE/);
  assert.doesNotMatch(proxyProbe, /--request\s+PATCH/);
  assert.doesNotMatch(proxyProbe, /UGMU_TRIALS_ENABLED.*true/);
});

test("trial identity secret provisioning is explicit and keeps trial gates closed", () => {
  assert.match(secretProvision, /workflow_dispatch:/);
  assert.match(secretProvision, /PROVISION_UGMU_TRIAL_SECRET/);
  assert.match(secretProvision, /TRIAL_IDENTITY_HMAC_SECRET/);
  assert.match(secretProvision, /TRIALS_ENABLED.*must remain closed/);
  assert.match(secretProvision, /UGMU_TRIALS_ENABLED.*must remain closed/);
  assert.match(secretProvision, /openssl rand -base64 48/);
  assert.match(secretProvision, /UGMU_TRIAL_SECRET_PROVISIONED_SAFE gates=closed/);
});

test("UGMU trial activation is explicit, preflighted and exits nonzero after guarded rollback", () => {
  assert.match(activate, /workflow_dispatch:/);
  assert.doesNotMatch(activate, /schedule:/);
  assert.match(activate, /ACTIVATE_UGMU_TRIAL/);
  assert.match(activate, /TRIAL_IDENTITY_HMAC_SECRET/);
  assert.match(activate, /\/api\/v1\/admin\/proxy-contract/);
  assert.match(activate, /UGMU_TRIAL_ACTIVATION_PROXY_PREFLIGHT_SAFE/);
  assert.match(activate, /trap 'rollback \$\?' ERR/);
  assert.match(activate, /local exit_code="\$\{1:-1\}"/);
  assert.match(activate, /UGMU_TRIAL_ABORT_BEFORE_ACTIVATION_SAFE/);
  assert.match(activate, /UGMU_TRIAL_ROLLBACK_REQUESTED_SAFE/);
  assert.match(activate, /exit "\$exit_code"/);
  assert.match(activate, /preflight_ready='false'/);
  assert.match(activate, /app\.get\('status'\) != 'running'/);
  assert.match(activate, /rows\.append\(\{'name':'UGMU_TRIALS_ENABLED','value':'true'\}\)/);
  assert.match(activate, /body\.get\('trials'\) == 'closed'/);
  assert.match(activate, /body\.get\('universityTrials',\{\}\)\.get\('ugmu'\) == 'open'/);
  assert.match(activate, /groupCode.*ОЛД 101/);
  assert.match(activate, /UGMU_TRIAL_SUBSCRIPTION_E2E_SAFE/);
  assert.match(activate, /UGMU_TRIAL_CONTINUATION_E2E_SAFE/);
  assert.match(activate, /UGMU_TRIAL_ACTIVATION_COMPLETE_SAFE/);
});

test("UGMU trial deactivation is explicit and closes only the dedicated gate", () => {
  assert.match(deactivate, /workflow_dispatch:/);
  assert.doesNotMatch(deactivate, /schedule:/);
  assert.match(deactivate, /DEACTIVATE_UGMU_TRIAL/);
  assert.match(deactivate, /legacy global trials must remain closed/);
  assert.match(deactivate, /rows\.append\(\{'name':'UGMU_TRIALS_ENABLED','value':'false'\}\)/);
  assert.match(deactivate, /body\.get\('trials'\) == 'closed'/);
  assert.match(deactivate, /body\.get\('universityTrials',\{\}\)\.get\('ugmu'\) == 'closed'/);
  assert.match(deactivate, /UGMU_TRIAL_DEACTIVATION_COMPLETE_SAFE/);
});