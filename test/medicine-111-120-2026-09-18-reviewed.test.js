import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestNormalizedEvents, expandExplicitDecisionManifest } from '../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../src/medicine-publication-plan.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
};
const overlaps = (a, b) =>
  minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);

test('current medicine 111-120 source has a fully reviewed candidate', async () => {
  const [manifest, facultatives, source, review, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-111-120-2026-09-18.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-111-120-2026-09-18.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-111-120-2026-09-18.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120-2026-09-18.normalization-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120-2026-09-18.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120-2026-09-18.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120-2026-09-18.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120-2026-09-18.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, 'bcfe7e65bd548c4a6acbed8c09e0e9086964dbc73e0fc6911ce63521d29cec7e');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(facultatives.sourceSha256, source.source.sha256);
  assert.equal(semantic.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(semantic.stream.unresolvedAmbiguities, 0);
  assert.equal(review.qaState.unresolvedAmbiguityCount, 0);
  assert.equal(source.parserRulesVersion, 'kgmu-2026-10-01-v5');
  assert.equal(manifest.parserRulesVersion, 'kgmu-2026-10-01-v5');
  assert.equal(semantic.parserRulesVersion, 'kgmu-2026-10-01-v5');
  assert.ok(semantic.rules.includes('R91'));
  assert.ok(semantic.operatorConfirmations[0].rules.includes('R91'));
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(review.publicationAllowed, true);
  assert.equal(review.qaState.scheduleVersionAllowed, true);
  assert.equal(semantic.platformPublicationGate, 'PASS');
  assert.equal(evidence.platformCompatibility.status, 'pass');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, true);
  assert.equal(qa.compatibilityGate.status, 'pass');
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(review.publicationAllowed, true);
  assert.equal(review.qaState.compatibilityGate, 'pass');
  assert.equal(review.qaState.scheduleVersionAllowed, true);
  assert.equal(manifest.candidateDigest, evidence.candidateDigest);
  assert.equal(evidence.platformCompatibility.status, 'pass');
  assert.equal(
    evidence.platformCompatibility.mergedCommit,
    '1c7d4d4f492384ee77ebf52a12ef81b51dee0da4',
  );

  const context = {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId,
  };
  const baseEvents = expandExplicitDecisionManifest(manifest, context);
  const facultativeEvents = expandMedicineFacultativeFixture(facultatives, context);
  const events = [...baseEvents, ...facultativeEvents].sort((a, b) => [
    Number(a.groupId) - Number(b.groupId),
    a.date.localeCompare(b.date),
    (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    (a.endTime ?? '').localeCompare(b.endTime ?? ''),
    a.discipline.localeCompare(b.discipline),
    a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator),
  ].find((value) => value !== 0) ?? 0);

  assert.equal(baseEvents.length, 3374);
  assert.equal(facultativeEvents.length, 920);
  assert.equal(events.length, 4294);
  assert.equal(
    digestNormalizedEvents(events),
    'sha256:aa0bfea32c191e71da8d13c9728f2b4ad56b8fd0c9edf08ae169b4d2af97411b',
  );

  const biology1209 = events.filter((event) =>
    event.sourceRef.locator === '1 леч. 2!B40#s2'
  );
  assert.equal(biology1209.length, 10);
  assert.ok(biology1209.every((event) => event.date === '2026-09-12'));
  assert.ok(biology1209.every((event) => event.startTime === '11:00' && event.endTime === '12:30'));
  assert.ok(biology1209.every((event) => event.location === null));
  assert.ok(biology1209.every((event) => event.note === 'размещена на образовательном сайте'));

  const safety = events.filter((event) =>
    event.sourceRef.locator === '1 леч. 2!K12#s2'
  );
  assert.deepEqual(
    safety.map((event) => event.date),
    ['2026-09-21', '2026-10-05', '2026-10-19', '2026-11-02'],
  );
  assert.ok(safety.every((event) => event.groupId === '120'));
  assert.ok(safety.every((event) => event.startTime === '16:20' && event.endTime === '17:50'));

  const economicsShort = events.filter((event) =>
    event.sourceRef.locator === '1 леч. 2!B42#s3'
  );
  assert.equal(economicsShort.length, 20);
  assert.deepEqual([...new Set(economicsShort.map((event) => event.date))], ['2026-10-24', '2026-11-07']);

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length,
  ]));
  assert.deepEqual(counts, evidence.groupEventCounts);

  const signatures = new Set();
  let duplicates = 0;
  for (const event of events) {
    const signature = [
      event.groupId,
      event.date,
      event.startTime,
      event.endTime,
      event.discipline,
      event.lessonType,
      event.location ?? '',
      event.facultativeId ?? '',
      event.note ?? '',
    ].join('|');
    if (signatures.has(signature)) duplicates += 1;
    signatures.add(signature);
  }
  assert.equal(duplicates, 0);

  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let overlapCount = 0;
  let facultativeOverlapCount = 0;
  for (const dayEvents of byDay.values()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (!overlaps(dayEvents[i], dayEvents[j])) continue;
        overlapCount += 1;
        if (dayEvents[i].facultativeId || dayEvents[j].facultativeId) {
          facultativeOverlapCount += 1;
        }
      }
    }
  }
  assert.equal(overlapCount, 363);
  assert.equal(facultativeOverlapCount, 362);
  assert.equal(overlapCount - facultativeOverlapCount, 1);
});
