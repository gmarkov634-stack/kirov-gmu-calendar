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

const [catalog, probe, sourceArtifact, job, decisions, parsing, draft, review, qa] = await Promise.all([
  readJson(`catalog/${period}.json`),
  readJson(`qa/${period}/dentistry-494.source-probe.json`),
  readJson(`fixtures/${period}/dentistry-491-494.source-artifact.json`),
  readJson(`fixtures/${period}/dentistry-491-494.parsing-job.json`),
  readJson(`fixtures/${period}/dentistry-491-494.user-decisions.json`),
  readJson(`qa/${period}/dentistry-491-494.parsing-result.json`),
  readJson(`qa/${period}/dentistry-491-494.normalized-draft.json`),
  readJson(`qa/${period}/dentistry-491-494.semantic-review.json`),
  readJson(`qa/${period}/dentistry-491-494.qa-report.json`)
]);

const groups = ['491', '492', '493', '494'];
const counts = { '491': 133, '492': 133, '493': 133, '494': 132 };
const sourceSha = '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265';
const candidateDigest = 'sha256:2a0490e90c89cfb40004b128c8429f896108ff9fc98e98cd1426adae171931a1';
const peConflictDates = {
  '491': '2026-09-25',
  '492': '2026-10-09',
  '493': '2026-09-18',
  '494': '2026-11-27'
};

test('Dentistry course 4 scope is 491-494 and pipeline artifacts stay source-bound', () => {
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
  assert.equal(job.parserRulesVersion, 'kgmu-2026-08-27-v3');
});

test('direct user decisions are persisted as course-local evidence', () => {
  assert.equal(decisions.provenance, 'direct-user-confirmation');
  assert.equal(decisions.confirmedOn, '2026-09-03');
  const byId = Object.fromEntries(decisions.decisions.map((item) => [item.id, item]));
  assert.equal(byId['ent-last-day-long'].exceptionPlacement, 'last-date-of-each-group-cycle');
  assert.deepEqual(byId['pe-friday-series-with-replacements-and-conflict-exclusions'].replacementDates, ['2026-12-18', '2026-12-25']);
  assert.equal(byId['pe-friday-series-with-replacements-and-conflict-exclusions'].conflictResolution, 'omit-physical-culture');
  assert.equal(byId['january-practice-all-day'].timeSemantics, 'date-only');
});

test('resolved draft contains exactly 531 events with deterministic digest', () => {
  assert.equal(draft.status, 'PASS');
  assert.equal(draft.eventCount, 531);
  assert.deepEqual(draft.eventCountsByGroup, counts);
  assert.equal(draft.candidateDigest, candidateDigest);
  assert.equal(draft.candidateDigest, digestNormalizedEvents(draft.events));
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, 531);
});

test('ENT uses the last date of each group cycle for the 12:55 exception', () => {
  const ent = draft.events.filter((event) => event.discipline === 'Оториноларингология');
  assert.equal(ent.length, 32);
  for (const group of groups) {
    const groupEnt = ent.filter((event) => event.groupId === group).sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(groupEnt.length, 8);
    assert.ok(groupEnt.slice(0, -1).every((event) => event.startTime === '09:00' && event.endTime === '12:05'));
    assert.equal(groupEnt.at(-1).startTime, '09:00');
    assert.equal(groupEnt.at(-1).endTime, '12:55');
  }
});

test('Practice is all-day and PE follows confirmed replacements and conflict omissions', () => {
  const practice = draft.events.filter((event) => event.discipline === 'Практика');
  assert.equal(practice.length, 48);
  assert.ok(practice.every((event) => event.timeSemantics === 'date-only' && event.startTime === null && event.endTime === null));

  const pe = draft.events.filter((event) => event.discipline.startsWith('Дисциплины по физической культуре'));
  const peBase = pe.filter((event) => event.startTime === '14:30' && event.endTime === '16:00');
  const peReplacement = pe.filter((event) => event.startTime === '16:10' && event.endTime === '17:40');
  assert.equal(peBase.length, 52);
  assert.equal(peReplacement.length, 8);
  assert.deepEqual([...new Set(peReplacement.map((event) => event.date))].sort(), ['2026-12-18', '2026-12-25']);
  assert.ok(peBase.every((event) => !['2026-12-18', '2026-12-25'].includes(event.date)));
  for (const group of groups) {
    assert.equal(pe.some((event) => event.groupId === group && event.date === peConflictDates[group]), false);
  }
});

test('final resolved draft has no duplicate signatures or timed overlaps', () => {
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

test('QA is pass and ScheduleVersion is ready but publication is not performed', () => {
  assert.equal(parsing.status, 'PASS');
  assert.equal(parsing.resolvedOccurrenceCount, 531);
  assert.equal(parsing.unresolvedOccurrenceCount, 0);
  assert.equal(parsing.excludedByDecisionOccurrenceCount, 12);
  assert.equal(parsing.postprocessing.resolvedEntEvents, 32);
  assert.equal(parsing.postprocessing.retainedPracticeAllDayEvents, 48);
  assert.equal(parsing.postprocessing.retainedPeBaseEvents, 52);
  assert.equal(parsing.postprocessing.supersededPeBaseEvents, 8);
  assert.equal(parsing.postprocessing.omittedPeConflictEvents, 4);
  assert.equal(parsing.postprocessing.retainedExplicitPeReplacementEvents, 8);
  assert.equal(parsing.postprocessing.commonParserChanged, false);

  assert.equal(review.status, 'PASS');
  assert.equal(review.reviewRequiredClassCount, 0);
  assert.equal(review.publishEligible, true);
  assert.deepEqual(review.unresolved, []);

  assert.equal(qa.status, 'PASS');
  assert.equal(qa.candidateDigest, candidateDigest);
  assert.deepEqual(qa.blockers, []);
  assert.equal(qa.scheduleVersionReady, true);
  assert.equal(qa.publishEligible, true);
  assert.equal(qa.publicationPerformed, false);
});
