import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const toolPath = fileURLToPath(new URL('../tools/ugmu-final-launch-readiness.mjs', import.meta.url));
const workflowPath = fileURLToPath(new URL('../../.github/workflows/ugmu-final-launch-readiness.yml', import.meta.url));
const tool = readFileSync(toolPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

test('final readiness requires all major UGMU launch gates and exact approved source', () => {
  for (const marker of [
    'structuralReadiness',
    'paymentE2E',
    'purchasedCalendarUpdateE2E',
    'subscriptionRevokeE2E',
    'crossUniversityHistoricalRegression',
    'productionIdenticalPagesArtifact',
    'deploymentContracts',
    'productionConfigurationFailClosed',
    'liveCloudRuProductionSmoke',
    '34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8',
  ]) assert.match(tool, new RegExp(marker));
});

test('final readiness can declare controlled eligibility but cannot activate launch', () => {
  assert.match(tool, /READY_FOR_CONTROLLED_LAUNCH_ACTIVATION_FAIL_CLOSED/);
  assert.match(tool, /controlledActivationEligible: launchReady/);
  assert.match(tool, /automaticActivationAllowed: false/);
  assert.match(tool, /activationPerformedByThisGate: false/);
  assert.match(tool, /publicationActivatedByThisGate: false/);
  assert.match(tool, /salesActivatedByThisGate: false/);
  assert.match(tool, /trialsActivatedByThisGate: false/);
  assert.match(tool, /catalogVisibilityActivatedByThisGate: false/);
});

test('final readiness workflow is a retired manual-only prelaunch stub with no production mutation primitive', () => {
  assert.doesNotMatch(workflow, /actions\/deploy-pages/);
  assert.doesNotMatch(workflow, /--request PATCH/);
  assert.doesNotMatch(workflow, /EVO_CR_LOGIN|EVO_CR_PWD|CLOUDRU_KEY_SECRET/);
  assert.doesNotMatch(workflow, /aws s3|PutObject|publish:ugmu/);
  assert.match(workflow, /name: UGMU final launch readiness \(retired\)/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
  assert.match(workflow, /Preserve completed prelaunch boundary/);
  assert.match(workflow, /retired after the controlled production launch/);
  assert.match(workflow, /post-launch production smoke/);
  assert.doesNotMatch(workflow, /ugmu-final-launch-readiness-report\.json/);
});
