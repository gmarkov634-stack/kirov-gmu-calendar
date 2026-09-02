import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const period = 'fixtures/2026-2027-semester-1';
const qa = 'qa/2026-2027-semester-1';
const expectedSha = '719d80814c1b5335f311b5b81a978b9c49f499ef38bbbcea32a4fc1bbf93247a';

test('dentistry 191-194 ingestion evidence is idempotently pinned to the current official source', async () => {
  const [source, artifact, job] = await Promise.all([
    readJson(`${period}/dentistry-191-194.source.json`),
    readJson(`${period}/dentistry-191-194.source-artifact.json`),
    readJson(`${period}/dentistry-191-194.parsing-job.json`)
  ]);

  assert.equal(source.source.sha256, expectedSha);
  assert.equal(artifact.sha256, expectedSha);
  assert.match(artifact.sourceArtifactId, /719d8081/);
  assert.match(job.jobId, /719d8081/);
  assert.equal(job.sourceObjectKey, artifact.sourceObjectKey);
  assert.deepEqual(job.expectedGroupIds, ['191', '192', '193', '194']);
  assert.equal(artifact.productionObjectStorageWritePerformed, false);
  assert.equal(artifact.publicationPerformed, false);
  assert.equal(job.productionPersistencePerformed, false);
  assert.equal(job.publicationPerformed, false);
});

test('dentistry 191-194 normalized base draft remains complete and duplicate-free', async () => {
  const [draft, report] = await Promise.all([
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(draft.sourceSha256, expectedSha);
  assert.equal(draft.status, 'REVIEW_REQUIRED');
  assert.equal(draft.events.length, 1364);
  assert.equal(report.eventCount, 1364);
  assert.deepEqual(report.eventCountByGroup, { '191': 340, '192': 340, '193': 342, '194': 342 });
  assert.equal(report.checks.find((item) => item.code === 'duplicate-events-resolved')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'hard-count-cross-checks')?.status, 'pass');
});

test('dentistry 191-194 stays fail-closed until R90 facultative periodicity is confirmed', async () => {
  const [review, report] = await Promise.all([
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].id, 'dentistry-191-194-facultatives-weekly-periodicity');
  assert.equal(review.items[0].sourceCell, 'B49');
  assert.equal(review.items[0].weekGridCell, 'B50');
  assert.equal(review.items[0].groupScopeResolved, true);
  assert.equal(review.items[0].serviceWeekGridResolved, true);
  assert.equal(review.items[0].periodicityConfirmed, false);
  assert.equal(review.items[0].rule, 'R90');

  assert.equal(report.decision, 'review-required');
  assert.equal(report.unresolvedSemanticItemCount, 1);
  assert.equal(report.readyForScheduleVersion, false);
  assert.equal(report.publicationPerformed, false);
  assert.equal(report.checks.find((item) => item.code === 'unresolved-ambiguities-zero-before-pass')?.status, 'fail');
  assert.equal(report.checks.find((item) => item.code === 'publication-not-performed')?.status, 'pass');
});
