import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const probePath = 'fixtures/tools/probe_dentistry_591_594_source.py';
const evidencePath = 'fixtures/2026-2027-semester-1/dentistry-591-594.source-probe.json';

test('temporary mechanical source probe for dentistry 591-594', () => {
  execFileSync('python3', ['-m', 'pip', 'install', '--disable-pip-version-check', 'openpyxl==3.1.5'], { stdio: 'inherit' });
  execFileSync('python3', [probePath], { stdio: 'inherit' });
  const payload = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(payload.semanticParsingPerformed, false);
  assert.deepEqual(payload.source.groups, ['591', '592', '593', '594']);
  assert.equal(payload.source.course, 5);
  console.log('DENTISTRY_591_594_SOURCE_PROBE_BEGIN');
  console.log(JSON.stringify(payload, null, 2));
  console.log('DENTISTRY_591_594_SOURCE_PROBE_END');
});
