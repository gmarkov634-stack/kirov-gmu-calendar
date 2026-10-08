import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const reviewPath = new URL('../qa/2026-2027-semester-1/dentistry-591-594.current-source-review.json', import.meta.url);
const fixturePath = new URL('../fixtures/2026-2027-semester-1/dentistry-591-594.source.json', import.meta.url);
const draftPath = new URL('../fixtures/2026-2027-semester-1/normalized/dentistry-591-594.normalized.json', import.meta.url);
const publisherPath = new URL('../ops/publish-dentistry-591-594.mjs', import.meta.url);

test('current official Dentistry 591-594 source is pinned mechanically and fails closed', async () => {
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  assert.equal(review.schema, 'kgmu-dentistry-current-source-review-v1');
  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.publicationAllowed, false);
  assert.equal(review.readyForScheduleVersion, false);
  assert.equal(review.semanticParsingPerformed, false);
  assert.equal(review.publicationPerformed, false);
  assert.equal(review.source.sha256, '55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff');
  assert.equal(review.source.byteLength, 23903);
  assert.equal(review.source.course, 5);
  assert.deepEqual(review.source.expectedGroupIds, ['591', '592', '593', '594']);
  assert.match(review.source.url, /2026\/10\/08\/1097\/5_stomat-08-10-2026-08\.xlsx$/);
  assert.deepEqual(review.workbook.sheetNames, ['2026-2027 осень 5 курс Стом']);
  assert.equal(review.workbook.xmlDimension, 'A1:DT36');
  assert.equal(review.workbook.mergedRangeCount, 127);
  assert.deepEqual(review.workbook.groupRows, {'591': 15, '592': 16, '593': 17, '594': 18});
  assert.deepEqual(review.workbook.dateHeaderCells.months, ['C12', 'AC12', 'BD12', 'CB12', 'DB12']);

  const anchorSet = new Set(review.mechanicalAnchors.map(item => item.cell));
  for (const cell of ['AY15','C17','AY18','BI18','CE28','CI28','CE29','CE30','CE31','CW15:CW18','DC15:DC18','DO15:DO18']) {
    assert.ok(anchorSet.has(cell), `missing explicit source anchor ${cell}`);
  }
  assert.ok(review.reviewItems.length >= 4);
  assert.equal(new Set(review.reviewItems.map(item => item.id)).size, review.reviewItems.length);
  assert.ok(review.reviewItems.every(item => item.status === 'REVIEW_REQUIRED' && item.sourceCells.length > 0));
  assert.match(review.nextGate, /exact-SHA/);
});

test('Dentistry 591-594 current source has no authorized parser fixture, normalized draft or publisher', async () => {
  for (const path of [fixturePath, draftPath, publisherPath]) {
    await assert.rejects(access(path), error => error?.code === 'ENOENT');
  }
});
