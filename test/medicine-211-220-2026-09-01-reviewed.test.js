import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestNormalizedEvents, expandExplicitDecisionManifest } from '../src/explicit-decisions.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

test('current medicine 211-220 source is freshly reviewed and publishable', async () => {
  const [manifest, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-211-220-2026-09-01.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-211-220-2026-09-01.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-211-220-2026-09-01.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-211-220-2026-09-01.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-211-220-2026-09-01.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-211-220-2026-09-01.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, 'aad51a270f56edf79e668f9a84e44bb089fcc4b02450fe7c1e30b8b37f736e38');
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(qa.publicationAllowed, true);
  assert.equal(qa.decision, 'pass');
  assert.equal(semantic.stream.unresolvedAmbiguities, 0);
  assert.equal(manifest.logicalSourceCellCount, 134);
  assert.equal(manifest.decisionCount, 183);

  const context = {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId,
  };
  const events = expandExplicitDecisionManifest(manifest, context);
  assert.equal(events.length, 2646);
  assert.equal(
    digestNormalizedEvents(events),
    'sha256:817790a6f4a3ce8a30823721fb18225284be1c10ca8d368f998fcb8dd99cd9d9',
  );

  const j21 = events.filter((e) => e.sourceRef.locator === '2леч.2!J21#s1');
  assert.equal(j21.length, 5);
  assert.deepEqual(j21.map((e) => e.date), [
    '2026-09-02','2026-09-16','2026-09-30','2026-10-14','2026-10-28',
  ]);
  assert.ok(j21.every((e) =>
    e.groupId === '219'
    && e.discipline === 'Экология'
    && e.startTime === '08:30'
    && e.endTime === '10:00'
    && e.location === '1 корпус, аудитория 419, ул. Владимирская, 137'
  ));

  const j22 = events.filter((e) => e.sourceRef.locator === '2леч.2!J22#s1');
  assert.equal(j22.length, 13);
  assert.ok(j22.every((e) =>
    e.groupId === '219'
    && e.discipline === 'Сестринское дело'
    && e.startTime === '10:45'
    && e.endTime === '13:10'
    && e.location === 'КОГБУЗ «Центр онкологии и медицинской радиобиологии», пр-т Строителей, 23'
  ));

  const j23 = events.filter((e) => e.sourceRef.locator === '2леч.2!J23#s1');
  assert.equal(j23.length, 4);
  assert.deepEqual(j23.map((e) => e.date), [
    '2026-09-09','2026-09-23','2026-10-07','2026-10-21',
  ]);
  assert.ok(j23.every((e) =>
    e.groupId === '219'
    && e.discipline === 'Экология'
    && e.startTime === '14:00'
    && e.endTime === '15:30'
    && e.location === '1 корпус, ул. Владимирская, 137'
  ));

  assert.equal(
    events.some((e) =>
      e.groupId === '217'
      && e.date === '2026-12-16'
      && e.sourceRef.locator === '2леч.2!H23#s1'
    ),
    false,
  );
  assert.equal(
    events.some((e) =>
      e.groupId === '218'
      && e.date === '2026-10-31'
      && e.sourceRef.locator === '2леч.2!H41#s1'
    ),
    false,
  );

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length,
  ]));
  assert.deepEqual(counts, evidence.groupEventCounts);

  const signatures = new Set();
  for (const event of events) {
    const signature = [
      event.groupId,event.date,event.startTime,event.endTime,
      event.discipline,event.lessonType,event.location ?? '',
    ].join('|');
    assert.equal(signatures.has(signature), false);
    signatures.add(signature);
  }

  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let overlapCount = 0;
  for (const dayEvents of byDay.values()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (overlaps(dayEvents[i], dayEvents[j])) overlapCount += 1;
      }
    }
  }
  assert.equal(overlapCount, 0);
});
