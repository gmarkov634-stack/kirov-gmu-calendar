import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('medicine 501-516 QA artifacts are a passed, fully covered candidate', async () => {
  const [source, evidence, qa] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/medicine-501-516.source.json'),
    readJson('../qa/2026-2027-semester-1/medicine-501-516.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-501-516.qa-report.json')
  ]);

  assert.equal(qa.decision, 'pass');
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(evidence.logicalSourceCellCount, 194);
  assert.equal(evidence.coveredSourceCellCount, 194);
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(evidence.duplicateEvents, 0);
  assert.equal(evidence.eventCount, 2400);
  assert.equal(evidence.peEventCount, 512);
  assert.equal(evidence.selectionDependentOverlapCount, 12);
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
});
