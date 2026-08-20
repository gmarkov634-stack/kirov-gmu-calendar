import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const smokePath = fileURLToPath(new URL("../../.github/workflows/ugmu-cloudru-production-smoke.yml", import.meta.url));
const deployPath = fileURLToPath(new URL("../../.github/workflows/deploy-api-cloudru.yml", import.meta.url));
const smoke = readFileSync(smokePath, "utf8");
const deploy = readFileSync(deployPath, "utf8");

test("UGMU production smoke follows Cloud.ru deploy and is also runnable before merge", () => {
  assert.match(smoke, /workflow_run:/);
  assert.match(smoke, /Deploy API to Cloud\.ru/);
  assert.match(smoke, /pull_request:/);
  assert.match(smoke, /workflow_dispatch:/);
  assert.match(smoke, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test("PR smoke never receives Cloud.ru write credentials or mutates the container", () => {
  for (const forbidden of ["EVO_CR_LOGIN", "EVO_CR_PWD", "containers.api.cloud.ru", "--request PATCH", "serverless-containers.admin"]) {
    assert.doesNotMatch(smoke, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(smoke, /noCloudRuWriteCredentialsUsed/);
  assert.match(smoke, /productionMutationPerformed': False/);
});

test("UGMU production smoke verifies shared production and fail-closed UGMU boundaries", () => {
  for (const marker of [
    "/health",
    "/api/v2/meta",
    "/api/v2/catalog/kgmu/programs",
    "/api/v2/schedules/ugmu/medicine/1/",
    "/api/v2/payments",
    "schedule_not_published",
    "sales_not_open",
    "access-control-allow-origin",
    "final-launch-readiness-gate",
  ]) {
    assert.match(smoke, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("post-deploy UGMU feed check is stricter than pre-merge production baseline", () => {
  assert.match(smoke, /STRICT_AFTER_DEPLOY/);
  assert.match(smoke, /if os\.environ\['STRICT_AFTER_DEPLOY'\] == 'true'/);
  assert.match(smoke, /assert error == 'schedule_not_published'/);
  assert.match(smoke, /assert error in \{'schedule_not_published','not_found'\}/);
});

test("actual Cloud.ru deploy remains main-only immutable-image deployment", () => {
  assert.match(deploy, /workflow_run\.head_branch == 'main'/);
  assert.match(deploy, /workflow_run\.event == 'push'/);
  assert.match(deploy, /git merge-base --is-ancestor/);
  assert.match(deploy, /target_image="\$\{IMAGE\}@\$\{digest\}"/);
  assert.match(deploy, /protectedTemplateFingerprint/);
  assert.match(deploy, /non-image production template drift detected/);
});
