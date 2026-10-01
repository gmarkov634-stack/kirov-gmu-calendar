import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestNormalizedEvents, expandExplicitDecisionManifest } from '../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../src/medicine-publication-plan.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);
const compareEvents = (a, b) => [
  Number(a.groupId) - Number(b.groupId),
  a.date.localeCompare(b.date),
  a.startTime.localeCompare(b.startTime),
  a.endTime.localeCompare(b.endTime),
  a.discipline.localeCompare(b.discipline),
  a.lessonType.localeCompare(b.lessonType),
  a.sourceRef.locator.localeCompare(b.sourceRef.locator),
].find((value) => value !== 0) ?? 0;

test('current medicine 101-110 source is freshly reviewed and platform-compatible', async () => {
  const [previous, current, facultatives, source, review, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-09-04.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-09-04.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-09-04.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-09-04.normalization-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-09-04.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-09-04.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-09-04.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-09-04.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, 'f83baaf4cf924a2e38e8e74455b4b6f2207e18d0bb66dd917785b0a5bb2946cb');
  assert.equal(current.sourceSha256, source.source.sha256);
  assert.equal(facultatives.sourceSha256, source.source.sha256);
  assert.equal(semantic.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, true);
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(review.qaState.compatibilityGate, 'pass');
  assert.equal(review.qaState.scheduleVersionAllowed, true);
  assert.equal(semantic.platformPublicationGate, 'PASS');
  assert.equal(evidence.platformCompatibility.status, 'pass');
  assert.equal(
    evidence.platformCompatibility.commit,
    'eba644505fe3541c023bf45c5d5ef7f0ec92eefc',
  );

  const oldJ35 = previous.decisions.filter((t) => t[0] === 'J35#s1');
  const newJ35 = current.decisions.filter((t) => t[0] === 'J35#s1');
  assert.deepEqual(oldJ35, [['J35#s1','100','4104104104104104104104104','10:35','12:05',15,3,11]]);
  assert.deepEqual(newJ35, [['J35#s1','300','4104104104104104104104104','10:35','12:05',15,3,11]]);

  const context = { universityId: source.universityId, academicPeriodId: source.academicPeriodId, sourceId: source.source.sourceId };
  const baseEvents = expandExplicitDecisionManifest(current, context);
  const facultativeEvents = expandMedicineFacultativeFixture(facultatives, context);
  const events = [...baseEvents, ...facultativeEvents].sort(compareEvents);

  assert.equal(baseEvents.length, 3411);
  assert.equal(facultativeEvents.length, 920);
  assert.equal(events.length, 4331);
  assert.equal(digestNormalizedEvents(events), 'sha256:ab39f5ccf8d4678222f6c27b668581197c00d083cedf463ee8750cf1cadddf79');
  assert.equal(events.filter((e) => e.groupId === '110' && e.sourceRef.locator === '1 леч.1!J35#s1').length, 17);
  assert.equal(events.filter((e) => e.groupId === '109' && e.sourceRef.locator === '1 леч.1!J35#s1').length, 17);

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId, events.filter((event) => event.groupId === groupId).length,
  ]));
  assert.deepEqual(counts, evidence.groupEventCounts);

  const signatures = new Set();
  let duplicates = 0;
  for (const event of events) {
    const signature = [event.groupId,event.date,event.startTime,event.endTime,event.discipline,event.lessonType,event.location ?? ''].join('|');
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
        if (dayEvents[i].facultativeId || dayEvents[j].facultativeId) facultativeOverlapCount += 1;
      }
    }
  }
  assert.equal(overlapCount, 134);
  assert.equal(facultativeOverlapCount, 126);
  assert.equal(overlapCount - facultativeOverlapCount, 8);
});
