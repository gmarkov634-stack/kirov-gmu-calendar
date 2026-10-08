import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const period = 'fixtures/2026-2027-semester-1';
const qa = 'qa/2026-2027-semester-1';
const expectedSha = 'b0912c1da92106e9f282fdc4657ad45ead8b4f1dfce30a93ba78c4e0d4a510a7';

test('dentistry 191-194 current source is semantic-QA-pass but platform fail-closed', async () => {
  const [source, artifact, job, probe] = await Promise.all([
    readJson(`${period}/dentistry-191-194.source.json`),
    readJson(`${period}/dentistry-191-194.source-artifact.json`),
    readJson(`${period}/dentistry-191-194.parsing-job.json`),
    readJson(`${qa}/dentistry-191-194.source-probe.json`)
  ]);
  assert.equal(source.source.sha256, expectedSha);
  assert.equal(source.source.byteLength, 17803);
  assert.equal(artifact.sha256, expectedSha);
  assert.equal(probe.source.sha256, expectedSha);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-compatible');
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(artifact.lifecycle.publicationAllowed, true);
  assert.match(job.executionMode, /platform-compatible/);
});

test('dentistry 191-194 current normalized draft is complete and duplicate-free', async () => {
  const [draft, report] = await Promise.all([
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.qa-report.json`)
  ]);
  assert.equal(draft.sourceSha256, expectedSha);
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(draft.events.length, 1669);
  assert.equal(draft.events.filter((event) => event.facultativeId != null).length, 340);
  assert.deepEqual(report.eventCountByGroup, { '191': 428, '192': 413, '193': 414, '194': 414 });
  assert.equal(report.decision, 'pass');
  assert.equal(report.unresolvedSemanticItemCount, 0);
  assert.equal(report.readyForScheduleVersion, true);
  assert.equal(report.publicationAllowed, true);
  assert.equal(report.compatibilityGate.status, 'pass');
  assert.equal(report.checks.find((item) => item.code === 'current-source-r89-r66-curator')?.status, 'pass');
});

test('dentistry 191-194 resolves B34 under existing R89 and R66 without a new parser rule', async () => {
  const [decisions, draft, review, evidence] = await Promise.all([
    readJson(`${period}/dentistry-191-194.decisions.json`),
    readJson(`${period}/normalized/dentistry-191-194.normalized.json`),
    readJson(`${qa}/dentistry-191-194.semantic-review.json`),
    readJson(`${qa}/dentistry-191-194.evidence.json`)
  ]);
  assert.equal(decisions.logicalMainTableSourceCellCount, 75);
  assert.equal(decisions.resolvedMainTableSourceCellCount, 75);
  assert.equal(decisions.unresolved.length, 0);
  assert.deepEqual(decisions.decisions.find((item) => item.id === 'B15#s2')?.dates, ['2026-09-28']);
  assert.equal(decisions.decisions.some((item) => item.sourceCell === 'B23'), false);
  assert.equal(decisions.decisions.some((item) => item.sourceCell === 'D23'), false);
  assert.equal(decisions.decisions.some((item) => item.id === 'E23#s2'), false);
  const library = decisions.decisions.find((item) => item.id === 'B34#s1');
  const week1 = decisions.decisions.find((item) => item.id === 'B34#r89-1');
  const week2 = decisions.decisions.find((item) => item.id === 'B34#r89-2');
  assert.deepEqual(library?.dates, ['2026-09-10']);
  assert.equal(week1?.dates.length, 10);
  assert.equal(week2?.dates.length, 7);
  assert.equal(week2?.dates.includes('2026-09-10'), false);
  const curator = draft.events.filter((event) => event.groupId === '191' && event.discipline === 'Час куратора' && event.sourceRef.locator.startsWith('1 стомат.!B34#r89-'));
  assert.equal(curator.length, 17);
  assert.equal(curator.some((event) => event.date === '2026-09-10'), false);
  assert.equal(review.status, 'SEMANTIC_QA_PASS');
  assert.equal(review.parserProfile, 'R');
  assert.deepEqual(review.rules, ['G16', 'R07', 'R08', 'R66', 'R69', 'R83', 'R89', 'R90']);
  assert.equal(review.unresolvedAmbiguities, 0);
  assert.equal(review.platformPublicationGate, 'REVIEW_REQUIRED');
  assert.equal(evidence.candidate.eventCount, 1669);
  assert.equal(evidence.candidate.r89MathFacultativeOverlapCount, 7);
  assert.equal(evidence.platformCompatibility.status, 'review-required');
});
