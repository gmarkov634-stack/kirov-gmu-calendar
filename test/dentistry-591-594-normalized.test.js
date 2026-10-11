import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const sourcePath = 'fixtures/2026-2027-semester-1/dentistry-591-594.source.json';
const jobPath = 'fixtures/2026-2027-semester-1/dentistry-591-594.parsing-job.json';
const compactPath = 'fixtures/2026-2027-semester-1/normalized/dentistry-591-594.normalized.compact.json';
const draftPath = 'qa/2026-2027-semester-1/dentistry-591-594.normalized-draft.json';
const parsingPath = 'qa/2026-2027-semester-1/dentistry-591-594.parsing-result.json';
const qaPath = 'qa/2026-2027-semester-1/dentistry-591-594.qa-report.json';

function check(name, checks) {
  return checks.find((item) => item.name === name);
}

test('dentistry 591-594 draft is deterministic, cyclic and fail-closed on Practice', async () => {
  const [source, job, compact, draft, parsing, qa] = await Promise.all([
    readJson(sourcePath), readJson(jobPath), readJson(compactPath), readJson(draftPath), readJson(parsingPath), readJson(qaPath)
  ]);

  assert.equal(source.source.sha256, '0c8b13b7e4dc409eaec551f8d4720d77dee88d76e8e7e89e4efcfe2aeed42109');
  assert.equal(source.parserProfile, 'cyclic');
  assert.equal(source.profileLayer, 'C');
  assert.equal(job.parserProfile, 'cyclic');
  assert.equal(job.profileLayer, 'C');
  assert.equal(job.sourceArtifactId, source.source.sourceArtifactId);
  assert.equal(job.sourceObjectKey, source.source.objectKey);
  assert.equal(source.idempotency.sourceArtifactKey, `sha256:${source.source.sha256}`);
  assert.equal(source.idempotency.reuseIfShaMatches, true);

  assert.equal(compact.eventCount, 492);
  assert.deepEqual(compact.groupEventCounts, { '591': 123, '592': 123, '593': 123, '594': 123 });
  assert.equal(compact.duplicateSignatures, 0);
  assert.equal(compact.sourceBackedOverlapCount, 3);
  assert.equal(compact.events.length, compact.eventCount);

  assert.equal(draft.status, 'REVIEW_REQUIRED');
  assert.equal(draft.coverage, 'safe-resolved-subset');
  assert.equal(draft.candidateDigest, compact.candidateDigest);
  assert.equal(draft.eventCount, compact.eventCount);
  assert.equal(draft.unresolvedEventOccurrenceCount, 48);
  assert.equal(draft.parserProfile, 'cyclic');
  assert.equal(draft.profileLayer, 'C');

  assert.equal(parsing.status, 'REVIEW_REQUIRED');
  assert.equal(parsing.groupLocalCycleBlockCount, 33);
  assert.equal(parsing.independentScheduleBlockCount, 1);
  assert.equal(parsing.serviceBlockCount, 2);
  assert.equal(parsing.unresolvedCommonBlockCount, 1);
  assert.equal(parsing.unresolvedOccurrenceCount, 48);
  assert.equal(parsing.diagnostics.length, 1);
  assert.equal(parsing.diagnostics[0].locator, 'DC15:DN18');
  assert.equal(parsing.diagnostics[0].sourceLabel, 'Практика');
  assert.equal(parsing.diagnostics[0].c22Applicable, false);
  assert.equal(parsing.diagnostics[0].dates.length, 12);

  assert.equal(qa.status, 'REVIEW_REQUIRED');
  assert.equal(qa.publishEligible, false);
  assert.equal(qa.scheduleVersionReady, false);
  assert.equal(qa.publicationPerformed, false);
  assert.equal(check('official-source-hash', qa.checks).status, 'PASS');
  assert.equal(check('parser-profile', qa.checks).status, 'PASS');
  assert.deepEqual(check('group-local-source-coverage', qa.checks).detail.byGroup, { '591': 8, '592': 8, '593': 8, '594': 9 });
  assert.equal(check('combined-discipline-split', qa.checks).detail.sourceBlocks, 4);
  assert.equal(check('physical-culture-independent-schedule', qa.checks).detail.events, 64);
  assert.equal(check('duplicates', qa.checks).detail, 0);
  assert.equal(check('source-backed-overlaps', qa.checks).detail.length, 3);
  assert.equal(check('practice-period-resolution', qa.checks).status, 'REVIEW_REQUIRED');
  assert.equal(check('practice-period-resolution', qa.checks).detail.unresolvedOccurrences, 48);
  assert.equal(check('production-write-boundary', qa.checks).status, 'PASS');
});
