import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

test('medicine 101-110 source change stays quarantined until fresh QA', async () => {
  const intake = await readJson('qa/2026-2027-semester-1/medicine-101-110.source-change-intake.json');
  const approvedSource = await readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const approvedQa = await readJson('qa/2026-2027-semester-1/medicine-101-110.qa-report.json');

  assert.equal(intake.schemaVersion, 'source-change-intake-v1');
  assert.equal(intake.status, 'review-required');
  assert.equal(intake.reviewRequired, true);
  assert.equal(intake.publicationBlocked, true);
  assert.equal(intake.structuralReview.semanticDecisionReuseAllowed, false);

  assert.equal(intake.approvedBaseline.sha256, approvedSource.source.sha256);
  assert.notEqual(intake.currentOfficialWorkbook.sha256, approvedSource.source.sha256);
  assert.notEqual(intake.currentOfficialWorkbook.url, approvedSource.source.url);

  assert.deepEqual(intake.structuralReview.missingApprovedSourceCells, ['J26', 'J37']);
  assert.deepEqual(intake.structuralReview.newUnreviewedSourceCells, ['J35']);
  assert.deepEqual(intake.structuralReview.reasonCodes, [
    'SOURCE_FINGERPRINT_CHANGED',
    'APPROVED_SOURCE_CELL_REMOVED',
    'UNREVIEWED_SOURCE_CELL_ADDED',
  ]);

  assert.equal(intake.approvedBaseline.logicalSourceCellCount, 145);
  assert.equal(intake.structuralReview.currentLogicalSourceCellCount, 144);

  assert.equal(approvedQa.decision, 'pass');
  assert.ok(approvedQa.candidateDigest);
  assert.equal(Object.hasOwn(intake, 'candidateDigest'), false);
  assert.equal(Object.hasOwn(intake, 'qaDecision'), false);
});
