import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('../ops/publish-medicine-501-516.mjs', import.meta.url), 'utf8');
const sharedRunner = await readFile(new URL('../ops/lib/publish-explicit-medicine-course.mjs', import.meta.url), 'utf8');

test('course 5 publication keeps QA renderer evidence and explicitly permits the production iOS VALARM renderer', () => {
  assert.match(sharedRunner, /coreEvidence\.icsRendererBlob/);
  assert.match(sharedRunner, /coreEvidence\.icsRendererBlob,[\s\S]*\.\.\.compatibleRendererBlobs\.map\(\(\{ blob \}\) => blob\)/);
  assert.match(sharedRunner, /rendererBlob === coreEvidence\.icsRendererBlob/);
  assert.match(sharedRunner, /deployed core ICS renderer blob mismatch/);

  assert.match(runner, /a9b61d6bb5da412e2f6ff0b5b85474af41e6216e/);
  assert.match(runner, /label: 'ios-valarm-hotfix'/);
  assert.match(runner, /reportRendererCompatibility: true/);
  assert.match(runner, /verifyPublishedIcs: verifyMedicine501516IcsPersonalization/);
});
