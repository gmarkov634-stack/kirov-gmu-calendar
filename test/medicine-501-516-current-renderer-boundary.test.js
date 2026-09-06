import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('../ops/publish-medicine-501-516.mjs', import.meta.url), 'utf8');
const explicitRunner = await readFile(new URL('../ops/lib/publish-explicit-medicine-course.mjs', import.meta.url), 'utf8');
const sharedRuntime = await readFile(new URL('../ops/lib/publish-medicine-plan.mjs', import.meta.url), 'utf8');

test('course 5 publication keeps QA renderer evidence and explicitly permits the production iOS VALARM renderer', () => {
  assert.match(sharedRuntime, /coreEvidence\.icsRendererBlob/);
  assert.match(sharedRuntime, /coreEvidence\.icsRendererBlob,[\s\S]*\.\.\.compatibleRendererBlobs\.map\(\(\{ blob \}\) => blob\)/);
  assert.match(sharedRuntime, /rendererBlob === coreEvidence\.icsRendererBlob/);
  assert.match(sharedRuntime, /deployed core ICS renderer blob mismatch/);

  assert.match(explicitRunner, /coreEvidence: qa\.sharedContractEvidence/);
  assert.match(explicitRunner, /compatibleRendererBlobs,/);
  assert.match(explicitRunner, /reportRendererCompatibility,/);
  assert.match(explicitRunner, /verifyPublishedIcs,/);
  assert.match(explicitRunner, /formatIcsVerificationLog,/);

  assert.match(runner, /a9b61d6bb5da412e2f6ff0b5b85474af41e6216e/);
  assert.match(runner, /label: 'ios-valarm-hotfix'/);
  assert.match(runner, /reportRendererCompatibility: true/);
  assert.match(runner, /verifyPublishedIcs: verifyMedicine501516IcsPersonalization/);
});
