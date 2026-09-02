import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const probePath = 'fixtures/tools/probe_dentistry_591_594_source.py';
const evidencePath = 'fixtures/2026-2027-semester-1/dentistry-591-594.source-probe.json';
const builderPath = 'fixtures/tools/build_dentistry_591_594_candidate.py';
const candidatePath = 'fixtures/2026-2027-semester-1/normalized/dentistry-591-594.normalized.compact.json';

test('temporary source-bound candidate build for dentistry 591-594', () => {
  execFileSync('python3', ['-m', 'pip', 'install', '--disable-pip-version-check', 'openpyxl==3.1.5'], { stdio: 'inherit' });
  execFileSync('python3', [probePath], { stdio: 'inherit' });
  const sourceEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(sourceEvidence.semanticParsingPerformed, false);
  assert.deepEqual(sourceEvidence.source.groups, ['591', '592', '593', '594']);
  assert.equal(sourceEvidence.source.sha256, '0c8b13b7e4dc409eaec551f8d4720d77dee88d76e8e7e89e4efcfe2aeed42109');

  execFileSync('python3', [builderPath, '--write'], { stdio: 'inherit' });
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
  assert.equal(candidate.eventCount, 492);
  assert.deepEqual(candidate.groupEventCounts, { '591': 123, '592': 123, '593': 123, '594': 123 });
  assert.equal(candidate.duplicateSignatures, 0);
  assert.equal(candidate.sourceBackedOverlapCount, 3);
  assert.equal(candidate.constants.teacher, null);
  assert.equal(candidate.sourceSha256, sourceEvidence.source.sha256);
  console.log('DENTISTRY_591_594_CANDIDATE_SUMMARY');
  console.log(JSON.stringify({
    sourceSha256: candidate.sourceSha256,
    eventCount: candidate.eventCount,
    groupEventCounts: candidate.groupEventCounts,
    candidateDigest: candidate.candidateDigest,
    sourceBackedOverlapCount: candidate.sourceBackedOverlapCount,
    duplicateSignatures: candidate.duplicateSignatures,
  }, null, 2));
});
