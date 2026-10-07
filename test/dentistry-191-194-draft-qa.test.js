import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const period = 'fixtures/2026-2027-semester-1';
const qa = 'qa/2026-2027-semester-1';
const expectedSha = 'b0912c1da92106e9f282fdc4657ad45ead8b4f1dfce30a93ba78c4e0d4a510a7';

test('dentistry 191-194 current source revision is pinned and fail-closed', async () => {
  const [source, artifact, job, probe] = await Promise.all([
    readJson(`${period}/dentistry-191-194.source.json`),
    readJson(`${period}/dentistry-191-194.source-artifact.json`),
    readJson(`${period}/dentistry-191-194.parsing-job.json`),
    readJson(`${qa}/dentistry-191-194.source-probe.json`)
  ]);

  assert.equal(source.source.sha256, expectedSha);
  assert.equal(source.source.url, 'https://kirovgma.ru/sites/default/files/files/2026/09/14/1097/1_stomat-14-09-2026-14.xlsx');
  assert.equal(source.source.byteLength, 17803);
  assert.equal(artifact.sha256, expectedSha);
  assert.equal(probe.source.sha256, expectedSha);
  assert.match(artifact.sourceArtifactId, /b0912c1d/);
  assert.match(job.jobId, /b0912c1d/);
  assert.equal(job.sourceObjectKey, artifact.sourceObjectKey);
  assert.deepEqual(job.expectedGroupIds, ['191', '192', '193', '194']);
  assert.equal(source.lifecycle.status, 'semantic-review-required');
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(artifact.lifecycle.publicationAllowed, false);
  assert.equal(artifact.productionObjectStorageWritePerformed, false);
  assert.equal(artifact.publicationPerformed, false);
  assert.equal(job.productionPersistencePerformed, false);
  assert.equal(job.publicationPerformed, false);
});

test('dentistry 191-194 review draft preserves all resolved current-source content without becoming publishable', async () => {
  const [draft, report] = await Promise.all([
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(draft.sourceSha256, expectedSha);
  assert.equal(draft.status, 'REVIEW_REQUIRED');
  assert.equal(draft.events.length, 1651);
  assert.equal(draft.events.filter((event) => event.facultativeId != null).length, 340);
  assert.equal(report.eventCount, 1651);
  assert.deepEqual(report.eventCountByGroup, { '191': 410, '192': 413, '193': 414, '194': 414 });
  assert.equal(report.decision, 'review-required');
  assert.equal(report.unresolvedSemanticItemCount, 1);
  assert.equal(report.readyForScheduleVersion, false);
  assert.equal(report.checks.find((item) => item.code === 'duplicate-events-resolved')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'hard-count-cross-checks')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'unresolved-ambiguities-zero-before-pass')?.status, 'fail');
});

test('dentistry 191-194 keeps R90 facultatives but blocks the new B34 week-parity curator fragment', async () => {
  const [confirmation, decisions, review, report] = await Promise.all([
    readJson(`${period}/dentistry-191-194.r90-confirmation.json`),
    readJson(`${period}/dentistry-191-194.decisions.json`),
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(confirmation.id, 'dentistry-191-194-facultatives-weekly-periodicity');
  assert.equal(confirmation.periodicityConfirmed, true);
  assert.equal(confirmation.provenance, 'direct-user-confirmation');

  assert.equal(decisions.logicalMainTableSourceCellCount, 75);
  assert.equal(decisions.resolvedMainTableSourceCellCount, 74);
  assert.equal(decisions.unresolved.length, 1);
  assert.equal(decisions.unresolved[0].id, 'dentistry-191-194-b34-curator-week-parity');
  assert.equal(decisions.unresolved[0].requiresOperatorConfirmation, true);
  assert.equal(decisions.decisions.some((item) => item.sourceCell === 'B34'), false);
  assert.deepEqual(decisions.decisions.find((item) => item.id === 'B15#s2')?.dates, ['2026-09-28']);
  assert.equal(decisions.decisions.some((item) => item.sourceCell === 'B23'), false);
  assert.equal(decisions.decisions.some((item) => item.sourceCell === 'D23'), false);
  assert.equal(decisions.decisions.some((item) => item.id === 'E23#s2'), false);
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').length, 4);
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').every((item) => Boolean(item.facultativeId)), true);

  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].sourceCell, 'B34');
  assert.equal(review.manualConfirmations.length, 1);
  assert.equal(review.manualConfirmations[0].rule, 'R90');
  assert.equal(report.readyForScheduleVersion, false);
  assert.equal(report.publicationPerformed, false);
});
