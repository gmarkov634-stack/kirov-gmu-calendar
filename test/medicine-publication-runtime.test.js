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
