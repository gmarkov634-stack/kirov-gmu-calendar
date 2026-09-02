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

test('dentistry 191-194 normalized draft is complete and duplicate-free after R90 confirmation', async () => {
  const [draft, report] = await Promise.all([
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(draft.sourceSha256, expectedSha);
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(draft.events.length, 1656);
  assert.equal(report.eventCount, 1656);
  assert.deepEqual(report.eventCountByGroup, { '191': 413, '192': 413, '193': 415, '194': 415 });
  assert.equal(report.checks.find((item) => item.code === 'duplicate-events-resolved')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'hard-count-cross-checks')?.status, 'pass');
});

test('dentistry 191-194 records explicit R90 confirmation and becomes ScheduleVersion-ready without publishing', async () => {
  const [confirmation, decisions, review, report] = await Promise.all([
    readJson(`${period}/dentistry-191-194.r90-confirmation.json`),
    readJson(`${period}/dentistry-191-194.decisions.json`),
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);

  assert.equal(confirmation.id, 'dentistry-191-194-facultatives-weekly-periodicity');
  assert.equal(confirmation.sourceCell, 'B49');
  assert.equal(confirmation.weekGridCell, 'B50');
  assert.deepEqual(confirmation.groupIds, ['191', '192', '193', '194']);
  assert.equal(confirmation.periodicityConfirmed, true);
  assert.equal(confirmation.recurrence, 'every-service-week');
  assert.equal(confirmation.provenance, 'direct-user-confirmation');

  assert.equal(decisions.logicalMainTableSourceCellCount, 77);
  assert.equal(decisions.resolvedMainTableSourceCellCount, 77);
  assert.equal(decisions.unresolved.length, 0);
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').length, 4);
  assert.equal(decisions.decisions.filter((item) => item.sourceCell === 'B49').every((item) => Boolean(item.facultativeId)), true);

  assert.equal(review.status, 'RESOLVED');
  assert.equal(review.items.length, 0);
  assert.equal(review.manualConfirmations.length, 1);
  assert.equal(review.manualConfirmations[0].periodicityConfirmed, true);
  assert.equal(review.manualConfirmations[0].rule, 'R90');

  assert.equal(report.decision, 'pass');
  assert.equal(report.unresolvedSemanticItemCount, 0);
  assert.equal(report.readyForScheduleVersion, true);
  assert.equal(report.publicationPerformed, false);
  assert.equal(report.checks.find((item) => item.code === 'unresolved-ambiguities-zero-before-pass')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'publication-not-performed')?.status, 'pass');
});
