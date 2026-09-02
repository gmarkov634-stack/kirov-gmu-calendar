import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const EXPECTED_DIGEST = 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f';
const CORE_COMMIT = 'e5414c1d8b8754f8e47397f24d7aeb5d413431ec';

function runPreflight() {
  return execFileSync(process.execPath, ['ops/publish-pediatrics-631-637.mjs', '--preflight'], {
    encoding: 'utf8'
  });
}

test('Pediatrics course 6 publication preflight is pinned and side-effect free', () => {
  const output = runPreflight();
  assert.match(output, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
  assert.match(output, /"programId": "pediatrics"/);
  assert.match(output, /"eventCount": 679/);
  assert.match(output, /"floatingEventCount": 637/);
  assert.match(output, /"dateOnlyEventCount": 42/);
  assert.ok(output.includes(EXPECTED_DIGEST));
  for (const group of ['631', '632', '633', '634', '635', '636', '637']) {
    assert.match(output, new RegExp(`"groupId": "${group}"[\\s\\S]*?"eventCount": 97[\\s\\S]*?"dateOnlyCount": 6`));
  }
});

test('Pediatrics course 6 publication evidence pins merged date-only core boundary', () => {
  const evidence = JSON.parse(readFileSync('qa/2026-2027-semester-1/pediatrics-631-637.publication-evidence.json', 'utf8'));
  assert.equal(evidence.candidateDigest, EXPECTED_DIGEST);
  assert.equal(evidence.sharedContractEvidence.commit, CORE_COMMIT);
  assert.equal(evidence.sharedContractEvidence.productionRuntimeCommit, CORE_COMMIT);
  assert.equal(evidence.sharedContractEvidence.normalizedEventSchemaBlob, '027699254f920e30822ca26214ddc0746c258c3c');
  assert.equal(evidence.sharedContractEvidence.icsRendererBlob, 'b75aea9bd6b54fab9ae454c1f7fedcf233d8ea96');
  assert.deepEqual(evidence.timeSemanticsCounts, { floating: 637, 'date-only': 42 });
});

test('Pediatrics course 6 apply remains fail-closed without explicit production DB path', () => {
  assert.throws(() => execFileSync(process.execPath, ['ops/publish-pediatrics-631-637.mjs', '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, MEDICAL_CALENDAR_DB_PATH: '' },
    stdio: 'pipe'
  }));
});
