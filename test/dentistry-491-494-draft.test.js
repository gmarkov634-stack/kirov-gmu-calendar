import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digestNormalizedEvents } from '../src/explicit-decisions.js';

const period = '2026-2027-semester-1';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const script of [
  'fixtures/tools/run_dentistry_491_494_prepost_candidate.py',
  'fixtures/tools/postprocess_dentistry_491_494_candidate.py'
]) {
  execFileSync('python3', [script], { cwd: root, stdio: 'pipe' });
}
const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const [catalog, probe, sourceArtifact, job, parsing, draft, review, qa] = await Promise.all([
  readJson(`catalog/${period}.json`),
  readJson(`qa/${period}/dentistry-494.source-probe.json`),
  readJson(`fixtures/${period}/dentistry-491-494.source-artifact.json`),
  readJson(`fixtures/${period}/dentistry-491-494.parsing-job.json`),
  readJson(`qa/${period}/dentistry-491-494.parsing-result.json`),
  readJson(`qa/${period}/dentistry-491-494.normalized-draft.json`),
  readJson(`qa/${period}/dentistry-491-494.semantic-review.json`),
  readJson(`qa/${period}/dentistry-491-494.qa-report.json`)
]);

const groups = ['491', '492', '493', '494'];
const counts = { '491': 100, '492': 100, '493': 100, '494': 99 };
const sourceSha = '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265';

test('Dentistry course 4 scope is 491-494 and all pipeline artifacts stay source-bound', () => {
  const dentistry = catalog.programs.find((program) => program.programId === 'dentistry');
  assert.deepEqual(dentistry.courses.find((course) => course.course === 4).groupIds, groups);
  assert.deepEqual(probe.source.groups, groups);
  assert.deepEqual(sourceArtifact.expectedGroupIds, groups);
  assert.deepEqual(job.expectedGroupIds, groups);
  assert.equal(probe.source.sha256, sourceSha);
  assert.equal(sourceArtifact.sha256, sourceSha);
  assert.equal(job.sourceSha256, sourceSha);
  assert.equal(parsing.sourceSha256, sourceSha);
  assert.equal(draft.sourceSha256, sourceSha);
  assert.equal(sourceArtifact.productionObjectStorageWritePerformed, false);
  assert.equal(sourceArtifact.publicationPerformed, false);
  assert.equal(job.publicationRequested, false);
  assert.match(job.idempotencyKey, new RegExp(sourceSha));
});

test('source geometry and existing cyclic profile stay unchanged', () => {
  assert.equal(probe.source.sheets.length, 1);
  const sheet = probe.source.sheets[0];
  assert.equal(sheet.title, '4 курс осень 2026 Стом');
  assert.equal(sheet.maxRow, 40);
  assert.equal(sheet.maxColumn, 126);
  assert.equal(sheet.mergedRanges.length, 159);
  assert.equal(sheet.nonEmptyCellCount, 425);
  assert.equal(job.parserProfile, 'cyclic');
  assert.equal(job.parserRulesVersion, 'kgmu-2026-08-30-v4');
});

test('fail-closed postprocessing leaves exactly 399 deterministic normalized events', () => {
  assert.equal(draft.status, 'REVIEW_REQUIRED');
  assert.equal(draft.eventCount, 399);
  assert.deepEqual(draft.eventCountsByGroup, counts);
  assert.equal(draft.candidateDigest, digestNormalizedEvents(draft.events));
  const actual = Object.fromEntries(groups.map((group) => [group, draft.events.filter((event) => event.groupId === group).length]));
  assert.deepEqual(actual, counts);
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, 399);

  assert.equal(draft.events.filter((event) => event.discipline === 'Оториноларингология').length, 0);
  assert.equal(draft.events.filter((event) => event.discipline === 'Практика').length, 0);

  const pe = draft.events.filter((event) => event.discipline.startsWith('Дисциплины по физической культуре'));
  assert.equal(pe.length, 8);
  assert.deepEqual([...new Set(pe.map((event) => event.date))].sort(), ['2026-12-18', '2026-12-25']);
  assert.ok(pe.every((event) => event.startTime === '16:10' && event.endTime === '17:40'));

  const management = draft.events.filter((event) => event.date === '2027-01-12' && event.discipline === 'Менеджмент в здравоохранении');
  assert.equal(management.length, 4);
  assert.deepEqual(management.map((event) => event.groupId), groups);
});

test('postprocessed deterministic draft contains no duplicate signatures or timed overlaps', () => {
  const signatures = new Set();
  const byDay = new Map();
  for (const event of draft.events) {
    const signature = [event.groupId, event.date, event.startTime, event.endTime, event.discipline, event.lessonType, event.location ?? ''].join('|');
    assert.equal(signatures.has(signature), false, `duplicate signature ${signature}`);
    signatures.add(signature);
    const key = `${event.groupId}|${event.date}`;
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  let overlaps = 0;
  for (const events of byDay.values()) {
    const timed = events.filter((event) => event.timeSemantics === 'floating').sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < timed.length; index += 1) {
      if (minutes(timed[index - 1].endTime) > minutes(timed[index].startTime)) overlaps += 1;
    }
  }
  assert.equal(overlaps, 0);
});

test('three REVIEW_REQUIRED classes explicitly block ScheduleVersion readiness', () => {
  assert.equal(parsing.status, 'REVIEW_REQUIRED');
  assert.equal(parsing.resolvedOccurrenceCount, 399);
  assert.equal(parsing.unresolvedOccurrenceCount, 144);
  assert.equal(parsing.postprocessing.removedInferredPracticeEvents, 48);
  assert.equal(parsing.postprocessing.removedInferredPeBaseEvents, 64);
  assert.equal(parsing.postprocessing.retainedExplicitPeExtraEvents, 8);
  assert.equal(parsing.postprocessing.commonParserChanged, false);
  assert.equal(parsing.warnings.length, 3);
  assert.ok(parsing.warnings.every((warning) => warning.startsWith('REVIEW_REQUIRED ')));

  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.reviewRequiredClassCount, 3);
  assert.equal(review.publishEligible, false);
  assert.ok(review.ruleApplications.some((item) => item.rule === 'C20' && item.result === 'REVIEW_REQUIRED'));
  assert.ok(review.ruleApplications.some((item) => item.rule === 'G04/G21/C12' && item.result === 'REVIEW_REQUIRED'));
  assert.ok(review.ruleApplications.some((item) => item.rule === 'G21' && item.result === 'REVIEW_REQUIRED'));

  assert.equal(qa.status, 'REVIEW_REQUIRED');
  assert.equal(qa.candidateDigest, draft.candidateDigest);
  assert.equal(qa.blockers.length, 3);
  assert.equal(qa.scheduleVersionReady, false);
  assert.equal(qa.publishEligible, false);
  assert.equal(qa.publicationPerformed, false);
});
