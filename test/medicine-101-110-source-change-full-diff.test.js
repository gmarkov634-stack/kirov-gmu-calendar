import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

test('medicine 101-110 full source diff is exact and remains review-required', async () => {
  const diff = await readJson('qa/2026-2027-semester-1/medicine-101-110.source-change-full-diff.json');
  const intake = await readJson('qa/2026-2027-semester-1/medicine-101-110.source-change-intake.json');
  const approvedSource = await readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json');

  assert.equal(diff.schemaVersion, 'source-change-full-diff-v1');
  assert.equal(diff.status, 'review-required');
  assert.equal(diff.reviewRequired, true);
  assert.equal(diff.publicationBlocked, true);
  assert.equal(diff.semanticDecisionReuseAllowed, false);

  assert.equal(diff.approvedWorkbook.sha256, approvedSource.source.sha256);
  assert.equal(diff.approvedWorkbook.sha256, intake.approvedBaseline.sha256);
  assert.equal(diff.currentWorkbook.sha256, intake.currentOfficialWorkbook.sha256);
  assert.equal(diff.currentWorkbook.byteLength, 21079);

  assert.deepEqual(diff.cellDiff.removed.map(({ coord }) => coord), ['J26', 'J37']);
  assert.deepEqual(diff.cellDiff.added.map(({ coord }) => coord), ['J35']);
  assert.deepEqual(diff.cellDiff.changed.map(({ coord }) => coord), ['K26', 'J34', 'K37']);
  assert.deepEqual(diff.cellDiff.counts, {
    removed: 2,
    added: 1,
    changed: 3,
    totalChangedCoordinates: 6,
  });

  assert.deepEqual(diff.mergedRangeDiff.removed, ['J34:K35']);
  assert.deepEqual(diff.mergedRangeDiff.added, []);
  assert.deepEqual(diff.mechanicallyAffectedColumns, ['J', 'K']);
  assert.deepEqual(diff.mechanicallyAffectedGroupIds, ['109', '110']);

  const k26 = diff.cellDiff.changed.find(({ coord }) => coord === 'K26');
  assert.match(k26.oldValue, /Правоведение/);
  assert.doesNotMatch(k26.newValue, /Правоведение/);
  assert.match(k26.newValue, /Библиотечный час/);

  const j34 = diff.cellDiff.changed.find(({ coord }) => coord === 'J34');
  assert.match(j34.oldValue, /Экономика/);
  assert.match(j34.newValue, /Анатомия/);

  const k37 = diff.cellDiff.changed.find(({ coord }) => coord === 'K37');
  assert.match(k37.oldValue, /14\.20-15\.50/);
  assert.match(k37.newValue, /14\.15-15\.45/);

  assert.equal(diff.decision.approvedBaselineMutationAllowed, false);
  assert.equal(diff.decision.publicationAllowed, false);
  assert.equal(diff.decision.nextRequiredStep, 'fresh-normalization-and-semantic-review');
});
