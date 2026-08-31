import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifest = await readJson('fixtures/2026-2027-semester-1/medicine-401-416.decisions.json');
const source = await readJson('fixtures/2026-2027-semester-1/medicine-401-416.source.json');
const review = await readJson('qa/2026-2027-semester-1/medicine-401-416.semantic-review.json');

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

const findEvent = (groupId, date, predicate = () => true) =>
  events.find((event) => event.groupId === groupId && event.date === date && predicate(event));

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const overlapPairs = () => {
  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  const result = [];
  for (const [key, dayEvents] of byDay) {
    for (let left = 0; left < dayEvents.length; left += 1) {
      for (let right = left + 1; right < dayEvents.length; right += 1) {
        const a = dayEvents[left];
        const b = dayEvents[right];
        if (minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) {
          result.push([key, a, b]);
        }
      }
    }
  }
  return result;
};

test('medicine 401-416 manifest is tied to the reviewed official source and has full logical coverage', () => {
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(manifest.sourceSha256, 'fb79b4c7b08b8f85bd2f238f2190404ea5eae01ab2be47339985272b565ead6b');
  assert.equal(manifest.logicalSourceCellCount, 166);
  assert.equal(manifest.decisionCount, 176);
  assert.equal(review.unresolvedSemanticAmbiguities.length, 0);
  assert.equal(review.publicationGate, 'NORMALIZATION_ALLOWED');
});

test('medicine 401-416 candidate has stable counts, digest and no duplicate signatures', () => {
  assert.equal(events.length, 2310);
  assert.equal(digestNormalizedEvents(events), 'sha256:1c82de89df7683c90d0264da846899ba54fdb3af34b2e2d8ffcc2235bed2433b');

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length
  ]));
  for (const groupId of source.expectedGroupIds.slice(0, 10)) assert.equal(counts[groupId], 144);
  for (const groupId of source.expectedGroupIds.slice(10)) assert.equal(counts[groupId], 145);

  const signatures = new Set();
  for (const event of events) {
    const signature = [
      event.groupId,
      event.date,
      event.startTime,
      event.endTime,
      event.discipline,
      event.lessonType,
      event.location ?? ''
    ].join('|');
    assert.equal(signatures.has(signature), false, `duplicate: ${signature}`);
    signatures.add(signature);
  }
});

test('C02 starred first-day shifts are represented exactly', () => {
  const neuroFirst = findEvent('404', '2026-09-17', (event) => event.discipline === 'Неврология, нейрохирургия');
  const neuroNext = findEvent('404', '2026-09-18', (event) => event.discipline === 'Неврология, нейрохирургия');
  assert.deepEqual([neuroFirst.startTime, neuroFirst.endTime], ['10:30', '13:35']);
  assert.deepEqual([neuroNext.startTime, neuroNext.endTime], ['09:00', '12:05']);

  const publicHealthFirst = findEvent('401', '2026-10-23', (event) => event.discipline.startsWith('Общественное здоровье'));
  const publicHealthNext = findEvent('401', '2026-10-26', (event) => event.discipline.startsWith('Общественное здоровье'));
  assert.deepEqual([publicHealthFirst.startTime, publicHealthFirst.endTime], ['11:20', '14:25']);
  assert.deepEqual([publicHealthNext.startTime, publicHealthNext.endTime], ['08:00', '11:05']);

  const surgeryFirst = findEvent('413', '2026-11-09', (event) => event.discipline === 'Факультетская хирургия (раздел)');
  const surgeryNext = findEvent('413', '2026-11-10', (event) => event.discipline === 'Факультетская хирургия (раздел)');
  assert.deepEqual([surgeryFirst.startTime, surgeryFirst.endTime], ['12:00', '15:05']);
  assert.deepEqual([surgeryNext.startTime, surgeryNext.endTime], ['08:30', '11:35']);
});

test('operator-confirmed source-specific decisions are preserved without invented mappings', () => {
  const nirRegular = findEvent('401', '2026-09-05', (event) => event.discipline.startsWith('Учебная практика'));
  const nirShort = findEvent('401', '2026-11-14', (event) => event.discipline.startsWith('Учебная практика'));
  const nirCredit = findEvent('401', '2027-01-16', (event) => event.discipline.startsWith('ЗАЧЁТ'));
  assert.deepEqual([nirRegular.startTime, nirRegular.endTime, nirRegular.location], ['08:30', '13:10', null]);
  assert.deepEqual([nirShort.startTime, nirShort.endTime], ['08:30', '10:00']);
  assert.deepEqual([nirCredit.startTime, nirCredit.endTime], ['08:30', '10:00']);
  assert.equal(nirCredit.assessment.type, 'credit');

  const dentistry = events.find((event) => event.discipline === 'Стоматология');
  assert.match(dentistry.location, /Владимирская, 112/);
  assert.match(dentistry.location, /Никитская, 161/);
  assert.equal(dentistry.assessment.type, 'credit');
});

test('independent stream schedules follow the source and service periods do not create events', () => {
  const stream1Lecture = findEvent('401', '2026-09-03', (event) => event.lessonType === 'lecture');
  const stream2Lecture = findEvent('411', '2026-09-01', (event) => event.lessonType === 'lecture');
  assert.deepEqual([stream1Lecture.startTime, stream1Lecture.endTime], ['14:20', '15:50']);
  assert.deepEqual([stream2Lecture.startTime, stream2Lecture.endTime], ['14:10', '15:40']);

  assert.ok(findEvent('401', '2026-09-01', (event) => event.discipline === 'Дисциплины по физической культуре и спорту'));
  assert.ok(findEvent('411', '2026-09-02', (event) => event.discipline === 'Дисциплины по физической культуре и спорту'));
  assert.equal(findEvent('411', '2026-11-04', (event) => event.discipline === 'Дисциплины по физической культуре и спорту'), undefined);

  assert.equal(events.some((event) => event.date >= '2027-01-18'), false);
});

test('the only source-backed time overlaps are preserved under G16', () => {
  const overlaps = overlapPairs();
  assert.equal(overlaps.length, 2);
  assert.deepEqual(overlaps.map(([key]) => key), ['409|2026-12-24', '410|2026-12-24']);
  for (const [, left, right] of overlaps) {
    assert.ok([left.discipline, right.discipline].includes('Общественное здоровье и здравоохранение, экономика здравоохранения'));
    assert.ok([left.discipline, right.discipline].includes('ЛЕКЦ. Факультетская терапия, профессиональные болезни'));
  }
});
