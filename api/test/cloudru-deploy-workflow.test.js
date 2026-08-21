import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const deployPath = fileURLToPath(new URL('../../.github/workflows/deploy-api-cloudru.yml', import.meta.url));
const publishPath = fileURLToPath(new URL('../../.github/workflows/publish-api.yml', import.meta.url));
const deploy = readFileSync(deployPath, 'utf8');
const publish = readFileSync(publishPath, 'utf8');

test('Cloud.ru production deploy is chained only from successful main image publication', () => {
  assert.match(deploy, /workflow_run:/);
  assert.match(deploy, /Publish API image/);
  assert.match(deploy, /workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /workflow_run\.head_branch == 'main'/);
  assert.match(deploy, /workflow_run\.event == 'push'/);
  assert.match(deploy, /git merge-base --is-ancestor/);
});

test('Cloud.ru deploy is immutable-image-only and requires the observed write role', () => {
  assert.match(deploy, /CONTAINER_NAME: kgmu-calendar-api/);
  assert.match(deploy, /target_image="\$\{IMAGE\}@\$\{digest\}"/);
  assert.match(deploy, /serverless-containers\.admin/);
  assert.match(deploy, /--request PATCH/);
  assert.match(deploy, /container\['image'\]=os\.environ\['TARGET_IMAGE'\]/);
  assert.match(deploy, /protectedTemplateFingerprint/);
  assert.match(deploy, /non-image production template drift detected/);
});

test('Cloud.ru deploy remains fail-closed for global launch gates and smokes new runtime', () => {
  for (const gate of ['FUNNEL_ANALYTICS_ENABLED', 'TRIALS_ENABLED', 'COMMERCIAL_SALES_ENABLED']) {
    assert.match(deploy, new RegExp(gate));
  }
  assert.match(deploy, /api\/v2\/analytics/);
  assert.match(deploy, /analytics_not_open/);
  assert.match(deploy, /api\/v2\/trials/);
  assert.match(deploy, /trials_not_open/);
  assert.match(deploy, /api\/v1\/admin\/funnel/);
  assert.match(deploy, /FUNNEL_V2_SAFE/);
});

test('Cloud.ru deploy preserves the dedicated UGMU trial gate without creating a trial during active smoke', () => {
  assert.match(deploy, /ugmuTrialGateOpen/);
  assert.match(deploy, /UGMU_TRIALS_ENABLED changed during image-only deploy/);
  assert.match(deploy, /expected_ugmu_state/);
  assert.match(deploy, /universityTrials',\{\}\)\.get\('ugmu'\) == expected_ugmu_state/);
  assert.match(deploy, /UGMU_TRIAL_SMOKE_SAFE gate=open mutation=skipped/);
  assert.doesNotMatch(deploy, /for gate in \('FUNNEL_ANALYTICS_ENABLED','TRIALS_ENABLED','UGMU_TRIALS_ENABLED','COMMERCIAL_SALES_ENABLED'\)/);
});

test('API image publication is limited to Docker runtime inputs', () => {
  assert.doesNotMatch(publish, /- "api\/\*\*"/);
  for (const runtimePath of [
    'api/src/**',
    'api/data/**',
    'api/schemas/**',
    'api/package.json',
    'api/package-lock.json',
    'api/Dockerfile',
  ]) {
    assert.match(publish, new RegExp(runtimePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
