import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['131', '132', '133', '134', '135', '136', '137', '138', '139', '140'];
const SOURCE_SHA = 'bdfeb2e127c5fe596a995fe553b1487bf3948771e7848368e69747c34035ad27';

test('pins the server-verified official pediatrics course 1 source', async () => {
  const source = await readJson('../fixtures/2026-2027-semester-1/pediatrics-131-140.source.json');
  const sourceUrl = new URL(source.source.url);

  assert.equal(source.programId, 'pediatrics');
  assert.equal(source.course, 1);
  assert.deepEqual(source.expectedGroupIds, EXPECTED_GROUPS);
  assert.equal(sourceUrl.protocol, 'https:');
  assert.equal(sourceUrl.hostname, 'kirovgma.ru');
  assert.equal(source.source.sha256, SOURCE_SHA);
  assert.equal(source.source.byteLength, 20899);
  assert.deepEqual(source.workbookExpectations.sheetNames, ['1 пед. 10 гр.']);
  assert.equal(source.workbookExpectations.maxRow, 65);
  assert.equal(source.workbookExpectations.maxColumn, 11);
  assert.equal(source.workbookExpectations.mergedRangeCount, 159);
  assert.equal(source.workbookExpectations.nonEmptyCellCount, 197);
  assert.equal(source.storagePolicy.repositoryStoresBinarySource, false);
  assert.equal(source.storagePolicy.productionSourceIsServerFetched, true);
});

test('records the operator-confirmed KODKB resolution and opens the publication gate', async () => {
  const review = await readJson('../qa/2026-2027-semester-1/pediatrics-131-140.semantic-review.json');

  assert.equal(review.sourceSha256, SOURCE_SHA);
  assert.equal(review.status, 'PASS');
  assert.equal(review.blocksPublication, false);
  assert.equal(review.sourceChecks.logicalTimetableCellsClassified, 127);
  assert.equal(review.sourceChecks.logicalTimetableCellsUnclassified, 0);
  assert.deepEqual(review.unresolvedAmbiguities, []);
  assert.equal(review.resolvedAmbiguities.length, 1);

  const [resolution] = review.resolvedAmbiguities;
  assert.equal(resolution.ambiguityId, 'PED1-K16-2026-12-15-PRACTICE-LOCATION');
  assert.equal(resolution.sourceLocator, '1 пед. 10 гр.!K16');
  assert.equal(resolution.groupId, '140');
  assert.equal(resolution.date, '2026-12-15');
  assert.equal(resolution.decision, 'KODKB');
  assert.match(resolution.location, /КОДКБ/);
  assert.match(review.nextGate, /QA-approved candidate/);
});
