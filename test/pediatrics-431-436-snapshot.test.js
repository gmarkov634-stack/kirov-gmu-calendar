import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const [manifest, source, report] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.source.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-431-436.qa-report.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const overlaps = [];
const byDay = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(event);
}
for (const [key, dayEvents] of byDay) {
  for (let left = 0; left < dayEvents.length; left += 1) {
    for (let right = left + 1; right < dayEvents.length; right += 1) {
      const a = dayEvents[left];
      const b = dayEvents[right];
      if (minutes(a.startTime) >= minutes(b.endTime) || minutes(b.startTime) >= minutes(a.endTime)) continue;
      overlaps.push({
        key,
        disciplines: [a.discipline, b.discipline]
      });
    }
  }
}

test('normalized draft digest and counts stay locked to the reviewed QA baseline', () => {
  assert.equal(report.decision, 'pass');
  assert.equal(events.length, 768);
  assert.equal(digestNormalizedEvents(events), 'sha256:56324602152102118f29829f4ceb99247e6d0c48c873a077441db4e615636ecd');
  assert.equal(digestNormalizedEvents(events), report.candidateDigest);
  assert.equal(manifest.decisionCount, 108);
  assert.equal(manifest.logicalSourceCellCount, 98);

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length
  ]));
  assert.deepEqual(counts, {
    '431': 128,
    '432': 128,
    '433': 128,
    '434': 128,
    '435': 128,
    '436': 128
  });
  assert.deepEqual(counts, report.candidate.groupEventCounts);
  assert.equal(report.candidate.eventCount, 768);
  assert.equal(report.candidate.duplicateEventSignatures, 0);
});

test('the four reviewed C13 overlap pairs remain exact and source-backed', () => {
  assert.equal(overlaps.length, 4);
  assert.deepEqual(overlaps.map((value) => value.key).sort(), [
    '431|2026-12-16',
    '431|2026-12-23',
    '432|2026-12-09',
    '435|2026-10-21'
  ]);
  for (const overlap of overlaps) {
    assert.ok(overlap.disciplines.includes('Факультетская терапия, профессиональные болезни'));
    assert.ok(overlap.disciplines.includes('Дисциплины по физической культуре и спорту'));
  }
  assert.equal(report.candidate.overlapPairCount, 4);
});
