import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const deploy = fs.readFileSync(new URL("../../.github/workflows/deploy-api-cloudru.yml", import.meta.url), "utf8");
const proxyProbe = fs.readFileSync(new URL("../../.github/workflows/ugmu-proxy-contract-probe.yml", import.meta.url), "utf8");
const secretProvision = fs.readFileSync(new URL("../../.github/workflows/ugmu-trial-secret-provision.yml", import.meta.url), "utf8");

test("production deploy asserts the dedicated UGMU trial gate closed", () => {
  const guardMatches = deploy.match(/'UGMU_TRIALS_ENABLED'/g) || [];
  assert.ok(guardMatches.length >= 2);
  assert.match(deploy, /universityTrials',\{\}\)\.get\('ugmu'\) == 'closed'/);
  assert.match(deploy, /ugmu_trial_status/);
});

test("proxy contract probe is manual, read-only and privacy-safe", () => {
  assert.match(proxyProbe, /workflow_dispatch:/);
  assert.doesNotMatch(proxyProbe, /schedule:/);
  assert.match(proxyProbe, /\/api\/v1\/admin\/proxy-contract/);
  assert.match(proxyProbe, /X-Proxy-Probe-Expected-Client/);
  assert.match(proxyProbe, /X-Proxy-Probe-Sentinel/);
  assert.match(proxyProbe, /UGMU_PROXY_CONTRACT_SAFE/);
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
