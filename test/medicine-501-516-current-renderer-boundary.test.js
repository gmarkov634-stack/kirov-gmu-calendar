import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('../ops/publish-medicine-501-516.mjs', import.meta.url), 'utf8');

test('course 5 publication keeps QA renderer evidence and explicitly permits the production iOS VALARM renderer', () => {
  assert.match(runner, /coreEvidence\.icsRendererBlob/);
  assert.match(runner, /a9b61d6bb5da412e2f6ff0b5b85474af41e6216e/);
  assert.match(runner, /rendererCompatibility: rendererBlob === coreEvidence\.icsRendererBlob \? 'qa-evidence' : 'ios-valarm-hotfix'/);
  assert.match(runner, /deployed core ICS renderer blob mismatch/);
});
