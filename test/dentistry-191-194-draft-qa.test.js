import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const period = 'fixtures/2026-2027-semester-1';
const qa = 'qa/2026-2027-semester-1';
const expectedSha = 'b0912c1da92106e9f282fdc4657ad45ead8b4f1dfce30a93ba78c4e0d4a510a7';

test('dentistry 191-194 evidence is pinned to the current official 14.09 source', async () => {
  const [source, artifact, job] = await Promise.all([
    readJson(`${period}/dentistry-191-194.source.json`),
    readJson(`${period}/dentistry-191-194.source-artifact.json`),
    readJson(`${period}/dentistry-191-194.parsing-job.json`)
  ]);

  assert.equal(source.source.sha256, expectedSha);
  assert.equal(source.source.byteLength, 17803);
  assert.match(source.source.url, /1_stomat-14-09-2026-14\.xlsx$/);
  assert.equal(source.workbookExpectations.mergedRangeCount, 93);
  assert.equal(source.workbookExpectations.nonEmptyCellCount, 143);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-review-required');
  assert.equal(source.lifecycle.publicationAllowed, false);

  assert.equal(artifact.sha256, expectedSha);
  assert.match(artifact.sourceArtifactId, /b0912c1d/);
  assert.match(job.jobId, /b0912c1d/);
  assert.equal(job.sourceObjectKey, artifact.sourceObjectKey);
  assert.deepEqual(job.expectedGroupIds, ['191', '192', '193', '194']);
  assert.equal(artifact.productionObjectStorageWritePerformed, false);
  assert.equal(artifact.publicationPerformed, false);
  assert.equal(job.productionPersistencePerformed, false);
  assert.equal(job.publicationPerformed, false);
});

test('dentistry 191-194 current normalized draft is complete and duplicate-free', async () => {
  const [draft, report] = await Promise.all([
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(draft.sourceSha256, expectedSha);
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(draft.events.length, 1669);
  assert.equal(report.eventCount, 1669);
  assert.deepEqual(report.eventCountByGroup, { '191': 428, '192': 413, '193': 414, '194': 414 });
  assert.equal(report.overlapPairCount, 183);
  assert.equal(report.checks.find((item) => item.code === 'duplicate-events-resolved')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'hard-count-cross-checks')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'current-source-r89-r66-curator')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'facultative-visibility-contract')?.status, 'pass');
});

test('dentistry 191-194 locks the five semantic source changes under existing R rules', async () => {
  const [decisions, draft, review, report] = await Promise.all([
    readJson(`${period}/dentistry-191-194.decisions.json`),
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(decisions.logicalMainTableSourceCellCount, 75);
  assert.equal(decisions.resolvedMainTableSourceCellCount, 75);
  assert.equal(decisions.unresolved.length, 0);

  assert.deepEqual(decisions.decisions.find((item) => item.id === 'B15#s2')?.dates, ['2026-09-28']);
  for (const removed of ['B23#s1', 'D23#s1', 'E23#s2']) {
    assert.equal(decisions.decisions.some((item) => item.id === removed), false);
  }

  const week1 = decisions.decisions.find((item) => item.id === 'B34#r89-1');
  const week2 = decisions.decisions.find((item) => item.id === 'B34#r89-2');
  assert.equal(week1?.dates.length, 10);
  assert.equal(week2?.dates.length, 7);
  assert.equal(week2?.dates.includes('2026-09-10'), false);

  const curator = draft.events.filter((event) =>
    event.groupId === '191' &&
    event.discipline === 'Час куратора' &&
    event.sourceRef.locator.startsWith('1 стомат.!B34#r89-')
  );
  assert.equal(curator.length, 17);
  assert.equal(curator.some((event) => event.date === '2026-09-10'), false);

  assert.equal(review.status, 'RESOLVED');
  assert.deepEqual(review.revisionReview.changedSemanticCells, ['B15', 'B23', 'D23', 'E23', 'B34']);
  assert.deepEqual(review.revisionReview.rulesApplied, ['R66', 'R69', 'R89', 'R90']);
  assert.equal(report.decision, 'pass');
  assert.equal(report.unresolvedSemanticItemCount, 0);
});

test('R90 facultatives stay normalized but publication remains platform-gated', async () => {
  const [confirmation, decisions, review, report, evidence] = await Promise.all([
    readJson(`${period}/dentistry-191-194.r90-confirmation.json`),
    readJson(`${period}/dentistry-191-194.decisions.json`),
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`),
    readJson(`${qa}/dentistry-191-194.evidence.json`)
  ]);

  assert.equal(confirmation.id, 'dentistry-191-194-facultatives-weekly-periodicity');
  assert.equal(confirmation.periodicityConfirmed, true);
  assert.equal(confirmation.provenance, 'direct-user-confirmation');
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').length, 4);
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').every((item) => Boolean(item.facultativeId)), true);

  assert.equal(review.platformPublicationGate, 'REVIEW_REQUIRED');
  assert.equal(review.publicationEligible, false);
  assert.equal(report.publicationAllowed, false);
  assert.equal(report.compatibilityGate.status, 'review-required');
  assert.equal(evidence.publicationAllowed, false);
  assert.equal(evidence.platformCompatibility.status, 'review-required');
});
