import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('medicine publication lifecycle is shared without changing explicit plan adapters', async () => {
  const [runtime, explicitRunner, medicine111120] = await Promise.all([
    source('ops/lib/publish-medicine-plan.mjs'),
    source('ops/lib/publish-explicit-medicine-course.mjs'),
    source('ops/publish-medicine-111-120.mjs')
  ]);

  assert.match(runtime, /export async function applyMedicinePublicationPlan/);
  assert.match(runtime, /createSqliteScheduleRepository/);
  assert.match(runtime, /createReadyScheduleVersion/);
  assert.match(runtime, /saveReadySnapshot/);
  assert.match(runtime, /publishVersion/);
  assert.match(runtime, /must have exactly one published version/);
  assert.match(runtime, /verifyPublishedIcs/);
  assert.match(runtime, /verifyForeignKeys/);

  assert.match(explicitRunner, /applyMedicinePublicationPlan/);
  assert.match(explicitRunner, /expandExplicitDecisionManifest/);
  assert.match(explicitRunner, /digestNormalizedEvents/);
  assert.match(explicitRunner, /verifyForeignKeys: true/);
  assert.match(explicitRunner, /compatibleRendererBlobs/);
  assert.match(explicitRunner, /reportRendererCompatibility/);
  assert.match(explicitRunner, /verifyPublishedIcs/);
  assert.match(explicitRunner, /formatIcsVerificationLog/);

  assert.match(medicine111120, /buildMedicinePublicationPlan/);
  assert.match(medicine111120, /applyMedicinePublicationPlan/);
  assert.match(medicine111120, /verifyMedicine111120Ics/);
  assert.match(medicine111120, /default-off ICS VEVENT count verification failed/);
  assert.match(medicine111120, /all-facultatives ICS VEVENT count verification failed/);
  assert.match(medicine111120, /assessment metadata is missing from default rendered ICS/);
  assert.match(medicine111120, /ЗАЧЕТ С ОЦЕНКОЙ/);
  assert.doesNotMatch(medicine111120, /verifyForeignKeys: true/);
});

test('medicine replacement publication keeps production safety in an adapter over the shared lifecycle', async () => {
  const [runtime, medicine101110] = await Promise.all([
    source('ops/lib/publish-medicine-plan.mjs'),
    source('ops/publish-medicine-101-110-2026-08-31.mjs')
  ]);

  for (const hook of [
    'verifyCoreEvidence',
    'prepareDatabase',
    'beforePublication',
    'verifyConflictingPublishedVersion',
    'afterPublish',
    'onPublicationError',
    'standardResultFields'
  ]) {
    assert.match(runtime, new RegExp(hook));
    assert.match(medicine101110, new RegExp(hook));
  }

  assert.match(medicine101110, /applyMedicinePublicationPlan/);
  assert.match(medicine101110, /--apply requires --replace-existing/);
  assert.match(medicine101110, /\.deployed-commit/);
  assert.match(medicine101110, /CREATE TEMP TRIGGER/);
  assert.match(medicine101110, /calendar_subscriptions/);
  assert.match(medicine101110, /entitlements/);
  assert.match(medicine101110, /subscription_tokens/);
  assert.match(medicine101110, /calendar_preferences/);
  assert.match(medicine101110, /verifyCurrentProduction/);
  assert.match(medicine101110, /changed after production preflight/);
  assert.match(medicine101110, /previous production version is not preserved as superseded/);
  assert.match(medicine101110, /rollbackToVersion/);
  assert.match(medicine101110, /ROLLBACK_TO_PREVIOUS_MEDICINE_101_110_COMPLETED/);

  assert.doesNotMatch(medicine101110, /openSqliteRuntimeDatabase/);
  assert.doesNotMatch(medicine101110, /createReadyScheduleVersion/);
  assert.doesNotMatch(medicine101110, /saveReadySnapshot/);
  assert.doesNotMatch(medicine101110, /publishVersion\(/);
});
