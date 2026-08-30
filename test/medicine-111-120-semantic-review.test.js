import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

test('medicine 111-120 source is pinned and the three operator confirmations clear the semantic review gate', async () => {
  const source = await readJson('../fixtures/2026-2027-semester-1/medicine-111-120.source.json');
  const facultatives = await readJson('../fixtures/2026-2027-semester-1/medicine-111-120.facultatives.json');
  const review = await readJson('../qa/2026-2027-semester-1/medicine-111-120.semantic-review.json');

  assert.equal(source.source.sha256, '781acc69637de634c25738d455cf0f8226212f8eeb1ef016a68c659ec20e358e');
  assert.deepEqual(source.expectedGroupIds, ['111','112','113','114','115','116','117','118','119','120']);
  assert.deepEqual(source.workbookExpectations, {
    sheetNames: ['1 леч. 2  '],
    maxRow: 58,
    maxColumn: 11,
    mergedRangeCount: 153,
    nonEmptyCellCount: 225
  });

  assert.equal(facultatives.sourceSha256, source.source.sha256);
  assert.deepEqual(facultatives.groupIds, source.expectedGroupIds);
  assert.equal(facultatives.sourceLocator, 'A45');
  assert.equal(facultatives.weekGridLocator, 'A46');
  assert.equal(facultatives.items.length, 5);
  assert.equal(facultatives.defaultSelected, false);
  assert.equal(facultatives.items.find((item) => item.discipline === 'Русский язык и культура речи').location, null);

  assert.equal(review.schema, 'kgmu-semantic-source-review-v1');
  assert.equal(review.reviewId, 'kgmu-2026-2027-s1-medicine-111-120-review-v2');
  assert.equal(review.sourceProbe.workflowRunId, 33335127147);
  assert.equal(review.sourceProbe.artifactId, 9738789059);
  assert.equal(review.stream.sourceSha256, source.source.sha256);
  assert.equal(review.stream.mainTableLogicalSourceCells, 147);
  assert.equal(review.stream.unresolvedAmbiguities, 0);
  assert.equal(review.stream.status, 'SEMANTIC_QA_PASS');
  assert.deepEqual(review.unresolved, []);
  assert.deepEqual(review.operatorConfirmations.map((item) => item.id), [
    'G21-111-120-01',
    'G21-111-120-02',
    'G21-111-120-03'
  ]);
  assert.ok(review.operatorConfirmations.every((item) => item.confirmed === true));

  const biology = review.operatorConfirmations[0];
  assert.match(biology.decision, /29\.12 and 12\.01 at 14:10-16:35/);
  assert.match(biology.decision, /03\.12 at 09:00-10:30/);

  const curator111112 = review.operatorConfirmations[1];
  assert.match(curator111112.decision, /03\.06 16:40-17:40 fragment as stale\/out-of-period/);
  assert.match(curator111112.decision, /first two possible in-period occurrences/);

  const curator119 = review.operatorConfirmations[2];
  assert.match(curator119.decision, /13:30-14:30 before 03\.11/);
  assert.match(curator119.decision, /17:30-18:30 from 03\.11 onward/);
  assert.match(curator119.decision, /Preserve the separate UPO schedule fragments/);

  assert.equal(review.semanticPublicationGate, 'PASS');
  assert.equal(review.publicationPerformed, false);
});
