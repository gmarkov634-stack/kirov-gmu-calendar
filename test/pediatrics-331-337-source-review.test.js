import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

test('Pediatrics course 3 source review preserves source mismatch and records explicit resolution', async () => {
  const [source, inventory, crossDay, review] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.source-inventory.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.cross-day-audit.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.semantic-review.json')
  ]);

  assert.equal(source.source.sha256, inventory.sourceSha256);
  assert.equal(source.source.sha256, crossDay.sourceSha256);
  assert.equal(source.source.sha256, review.sourceSha256);
  assert.deepEqual(source.expectedGroupIds, ['331', '332', '333', '334', '335', '336', '337']);
  assert.equal(inventory.nonEmptyCellCount, 169);
  assert.equal(inventory.allNonEmptyCellsMechanicallyPartitioned, true);
  assert.equal(inventory.unclassifiedCells.length, 0);

  // Mechanical audit remains an immutable statement about the pinned source.
  assert.equal(crossDay.cueCount, 44);
  assert.equal(crossDay.passCount, 43);
  assert.equal(crossDay.reviewRequiredCount, 1);
  assert.equal(crossDay.unresolved.length, 1);
  assert.deepEqual(crossDay.unresolved[0], {
    sourceLocator: '3пед.!D20',
    expectedCount: 2,
    targetWeekday: 'пн',
    evidenceLocator: '3пед.!D12',
    matchedExplicitDates: ['2026-12-07'],
    matchedCount: 1,
    status: 'review_required'
  });

  // Semantic review resolves the mismatch without inventing a second event.
  assert.equal(review.status, 'PASS');
  assert.equal(review.blocksPublication, false);
  assert.equal(review.unresolvedAmbiguities.length, 0);
  assert.equal(review.resolvedAmbiguities.length, 1);
  const resolution = review.resolvedAmbiguities[0];
  assert.equal(resolution.ambiguityId, 'PED3-D20-D12-MICROBIOLOGY-MISSING-MONDAY');
  assert.equal(resolution.groupId, '333');
  assert.deepEqual(resolution.resolvedEvents, [
    { date: '2026-12-07', sourceLocator: '3пед.!D12' }
  ]);
  assert.equal(resolution.omittedSyntheticEventCount, 1);
  assert.equal(resolution.resolutionBasis, 'user-confirmed-explicit-source-date-only');
  assert.equal(resolution.confirmationId, 'USER-2026-09-02-PED3-KEEP-07-12');
  assert.ok(resolution.rules.includes('G21'));
  assert.ok(resolution.rules.includes('R67'));
  assert.ok(resolution.rules.includes('R83'));
});
