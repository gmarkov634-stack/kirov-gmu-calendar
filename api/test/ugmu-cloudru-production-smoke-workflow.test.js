import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const smokePath = fileURLToPath(new URL("../../.github/workflows/ugmu-cloudru-production-smoke.yml", import.meta.url));
const deployPath = fileURLToPath(new URL("../../.github/workflows/deploy-api-cloudru.yml", import.meta.url));
const smoke = readFileSync(smokePath, "utf8");
const deploy = readFileSync(deployPath, "utf8");

test("UGMU post-launch production smoke follows Cloud.ru deploy and is also runnable before merge", () => {
  assert.match(smoke, /workflow_run:/);
  assert.match(smoke, /Deploy API to Cloud\.ru/);
  assert.match(smoke, /pull_request:/);
  assert.match(smoke, /workflow_dispatch:/);
  assert.match(smoke, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test("post-launch smoke is read-only and never receives payment or Cloud.ru mutation credentials", () => {
  for (const forbidden of [
    "EVO_CR_LOGIN",
    "EVO_CR_PWD",
    "YOOKASSA_SECRET_KEY",
    "containers.api.cloud.ru/v2/",
    "--request PATCH",
    "https://api.yookassa.ru/v3/payments",
  ]) {
    assert.doesNotMatch(smoke, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(smoke, /productionMutationPerformed': False/);
  assert.match(smoke, /paymentCreated': False/);
  assert.match(smoke, /UGMU_POST_LAUNCH_SMOKE_READ_ONLY/);
});

test("UGMU production smoke verifies the launched commercial boundary without opening public feeds", () => {
  for (const marker of [
    "/health",
    "/api/v2/meta",
    "/api/v2/catalog/kgmu/programs",
    "/api/v2/schedules/ugmu/medicine/1/",
    "calendar.ics",
    "schedule_not_published",
    "metaSalesOpen",
    "metaTrialsClosed",
    "metaPaymentModeLive",
    "ugmuPublicScheduleClosed",
    "ugmuPublicIcsClosed",
    "ongoing-post-launch-monitoring",
  ]) {
    assert.match(smoke, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(smoke, /meta\.get\('sales'\) == 'open'/);
  assert.match(smoke, /meta\.get\('trials'\) == 'closed'/);
  assert.match(smoke, /meta\.get\('paymentMode'\) == 'live'/);
  assert.doesNotMatch(smoke, /sales_not_open/);
});

test("post-launch smoke does not create a checkout payment", () => {
  assert.doesNotMatch(smoke, /--data '\{\"university_id\"/);
  assert.doesNotMatch(smoke, /UGMU_PRODUCTION_CHECKOUT_CLOSED/);
  assert.match(smoke, /Access-Control-Request-Method: POST/);
});

test("actual Cloud.ru deploy remains main-only immutable-image deployment", () => {
  assert.match(deploy, /workflow_run\.head_branch == 'main'/);
  assert.match(deploy, /workflow_run\.event == 'push'/);
  assert.match(deploy, /git merge-base --is-ancestor/);
  assert.match(deploy, /target_image="\$\{IMAGE\}@\$\{digest\}"/);
  assert.match(deploy, /protectedTemplateFingerprint/);
  assert.match(deploy, /non-image production template drift detected/);
});
