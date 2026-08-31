import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const decisions = await readJson('../fixtures/2026-2027-semester-1/medicine-601-616.decisions.json');
const source = await readJson('../fixtures/2026-2027-semester-1/medicine-601-616.source.json');
const semantic = await readJson('../qa/2026-2027-semester-1/medicine-601-616.semantic-review.json');
const evidence = await readJson('../qa/2026-2027-semester-1/medicine-601-616.evidence.json');
const qa = await readJson('../qa/2026-2027-semester-1/medicine-601-616.qa-report.json');

const events = expandExplicitDecisionManifest(decisions, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

function overlapPairs(items) {
  const byDay = new Map();
  for (const event of items) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let count = 0;
  for (const dayEvents of byDay.values()) {
    for (let left = 0; left < dayEvents.length; left += 1) {
      for (let right = left + 1; right < dayEvents.length; right += 1) {
        if (
          minutes(dayEvents[left].startTime) < minutes(dayEvents[right].endTime) &&
          minutes(dayEvents[right].startTime) < minutes(dayEvents[left].endTime)
        ) count += 1;
      }
    }
  }
  return count;
}

test('medicine 601-616 candidate is deterministic and QA-passed', () => {
  assert.equal(source.parserProfile, 'cycle');
  assert.equal(source.source.sha256, '0b5c4a06fd45e50bdaf28586fcb3f4bddade4efe514bc54dd84c359aa04fcb23');
  assert.equal(decisions.logicalSourceCellCount, 192);
  assert.equal(decisions.decisionCount, 210);
  assert.equal(events.length, 1456);
  assert.equal(digestNormalizedEvents(events), 'sha256:4126d3adfeb289ee5e47b27a55960d748ee4aa596b227ba4922f40bf1b5b069c');
  assert.equal(qa.candidateDigest, digestNormalizedEvents(events));
  assert.equal(qa.decision, 'pass');
  assert.equal(semantic.status, 'SEMANTIC_QA_PASS');
  assert.equal(semantic.unresolvedAmbiguities, 0);
  assert.equal(evidence.ambiguities.unresolved, 0);

  const counts = new Map(source.expectedGroupIds.map((groupId) => [groupId, 0]));
  for (const event of events) counts.set(event.groupId, counts.get(event.groupId) + 1);
  assert.deepEqual(Object.fromEntries(counts), Object.fromEntries(source.expectedGroupIds.map((groupId) => [groupId, 91])));

  const signatures = new Set();
  for (const event of events) {
    const signature = [
      event.groupId, event.date, event.startTime, event.endTime,
      event.discipline, event.lessonType, event.location ?? ''
    ].join('|');
    assert.equal(signatures.has(signature), false, `duplicate: ${signature}`);
    signatures.add(signature);
  }
  assert.equal(overlapPairs(events), 0);
  assert.equal(events[0].date, '2026-09-01');
  assert.equal(events.map((event) => event.date).sort().at(-1), '2026-12-24');
});

test('G21 BV44 resolution uses the last day of every traumatology cycle', () => {
  const resolution = decisions.sourceSpecificResolutions.find((item) => item.id === 'G21-MED6-TRAUMA-LAST-DAY');
  assert.ok(resolution);
  assert.equal(resolution.sourceCell, '6 курс осень 2026-2027 Леч!BV44');
  assert.match(resolution.resolution, /последнему календарному дню/);

  const trauma = events.filter((event) => event.discipline === 'Травматология, ортопедия');
  assert.equal(trauma.length, 128);
  for (const groupId of source.expectedGroupIds) {
    const groupEvents = trauma.filter((event) => event.groupId === groupId).sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(groupEvents.length, 8);
    assert.equal(groupEvents.at(-1).startTime, '08:00');
    assert.equal(groupEvents.at(-1).endTime, '09:30');
    for (const event of groupEvents.slice(0, -1)) {
      assert.equal(event.startTime, '08:00');
      assert.equal(event.endTime, '12:40');
    }
  }
  assert.equal(evidence.specialRules.traumatologyLastDay.applied, 16);
});

test('C02 applies second shift only to the first day of the two starred pharmacology cycles', () => {
  const starredGroups = ['606', '614'];
  for (const groupId of starredGroups) {
    const pharmacology = events
      .filter((event) => event.groupId === groupId && event.discipline === 'Клиническая фармакология')
      .sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(pharmacology.length, 9);
    assert.equal(pharmacology[0].startTime, '13:20');
    assert.equal(pharmacology[0].endTime, '18:00');
    for (const event of pharmacology.slice(1)) {
      assert.equal(event.startTime, '08:30');
      assert.equal(event.endTime, '13:10');
    }
  }
  assert.equal(evidence.specialRules.clinicalPharmacologyStar.applied, 2);
});

test('service periods and blank/self-study dates do not synthesize events', () => {
  assert.equal(events.some((event) => event.date >= '2026-12-25'), false);
  for (const date of evidence.candidate.independentWorkNoteDates) {
    assert.equal(events.some((event) => event.date === date), false, `self-study date should not have an event: ${date}`);
  }
  for (const { groups, date } of evidence.candidate.uncoveredBlankGridCells) {
    for (const groupId of groups) {
      assert.equal(events.some((event) => event.groupId === groupId && event.date === date), false);
    }
  }
});

test('lower-reference metadata remains source-bound and lossless', () => {
  const polyclinic = events.find((event) => event.discipline === 'Поликлиническая терапия');
  assert.ok(polyclinic);
  assert.match(polyclinic.location, /поликлиника № 3/);
  assert.match(polyclinic.location, /поликлиника № 1/);
  assert.match(polyclinic.location, /поликлиника № 6/);
  assert.match(polyclinic.location, /поликлиника № 7/);

  const trauma = events.find((event) => event.discipline === 'Травматология, ортопедия');
  assert.deepEqual(trauma.assessment, {
    type: 'exam',
    label: 'Экзамен',
    sourceRef: {
      sourceId: 'medicine',
      locator: '6 курс осень 2026-2027 Леч!S44'
    }
  });
  assert.equal(events.every((event) => event.lessonType === 'practice'), true);
  assert.equal(events.every((event) => event.timeSemantics === 'floating'), true);
});
