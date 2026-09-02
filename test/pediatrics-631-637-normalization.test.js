import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const decisions = await readJson('../fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json');
const source = await readJson('../fixtures/2026-2027-semester-1/pediatrics-631-637.source.json');

const events = expandExplicitDecisionManifest(decisions, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

const EXPECTED_DIGEST = 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f';
const GROUPS = ['631', '632', '633', '634', '635', '636', '637'];

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

function floatingOverlapPairs(items) {
  const byDay = new Map();
  for (const event of items.filter((item) => item.timeSemantics === 'floating')) {
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

test('pediatrics 631-637 normalized draft is complete and deterministic', () => {
  assert.equal(source.parserProfile, 'cycle');
  assert.equal(source.source.sha256, 'c450e454b23ba83cb273571c09fe2a1b283bec6eaa23f10e08dbf0c88ce41d60');
  assert.equal(decisions.schema, 'kgmu-explicit-semantic-decisions-v4');
  assert.equal(decisions.logicalSourceCellCount, 77);
  assert.equal(decisions.decisionCount, 86);
  assert.equal(events.length, 679);
  assert.equal(digestNormalizedEvents(events), EXPECTED_DIGEST);

  for (const groupId of GROUPS) {
    assert.equal(events.filter((event) => event.groupId === groupId).length, 97, `group ${groupId}`);
  }
  assert.equal(events[0].date, '2026-09-01');
  assert.equal(events.map((event) => event.date).sort().at(-1), '2026-12-29');
});

test('C15 produces 42 neutral date-only elective events without invented time/location', () => {
  const elective = events.filter((event) => event.timeSemantics === 'date-only');
  assert.equal(elective.length, 42);
  assert.equal(elective.every((event) => event.discipline === 'Дисциплина по выбору'), true);
  assert.equal(elective.every((event) => event.lessonType === 'other'), true);
  assert.equal(elective.every((event) => event.location === null), true);
  assert.equal(elective.every((event) => !Object.hasOwn(event, 'startTime')), true);
  assert.equal(elective.every((event) => !Object.hasOwn(event, 'endTime')), true);
  for (const groupId of GROUPS) {
    assert.equal(elective.filter((event) => event.groupId === groupId).length, 6, `elective ${groupId}`);
  }
});

test('637 timed occurrences remain source-bound floating events', () => {
  const floating = events.filter((event) => event.timeSemantics === 'floating');
  assert.equal(floating.length, 637);
  assert.equal(floating.every((event) => /^\d{2}:\d{2}$/.test(event.startTime)), true);
  assert.equal(floating.every((event) => /^\d{2}:\d{2}$/.test(event.endTime)), true);
  assert.equal(floatingOverlapPairs(events), 0);
});

test('C02 second shift applies only to the first date of nine starred cycles', () => {
  const first = events.filter((event) => event.sourceRef.locator.includes('#c02-first'));
  const rest = events.filter((event) => event.sourceRef.locator.includes('#c02-rest'));
  assert.equal(first.length, 9);
  assert.ok(rest.length > 9);
  assert.equal(first.every((event) => event.timeSemantics === 'floating'), true);

  const allowedSecondShift = new Set([
    '13:00|17:40|Физическая культура и спорт',
    '13:00|17:40|Госпитальная педиатрия',
    '13:00|17:40|Поликлиническая и неотложная педиатрия',
    '13:10|17:50|Госпитальная педиатрия раздел " Гематология"'
  ]);
  for (const event of first) {
    assert.equal(allowedSecondShift.has(`${event.startTime}|${event.endTime}|${event.discipline}`), true, event.sourceRef.locator);
  }
});

test('service periods never become normalized events and duplicate signatures are zero', () => {
  assert.equal(events.some((event) => event.discipline === 'Экзамены'), false);
  assert.equal(events.some((event) => event.discipline === 'Каникулы'), false);
  assert.equal(events.some((event) => event.date > '2026-12-29'), false);

  const signatures = new Set();
  for (const event of events) {
    const signature = [
      event.groupId,
      event.date,
      event.timeSemantics,
      event.startTime ?? '',
      event.endTime ?? '',
      event.discipline,
      event.lessonType,
      event.location ?? ''
    ].join('|');
    assert.equal(signatures.has(signature), false, `duplicate: ${signature}`);
    signatures.add(signature);
  }
});

test('source assessment metadata is preserved for applicable disciplines', () => {
  const childSurgery = events.find((event) => event.discipline === 'Детская хирургия');
  assert.deepEqual(childSurgery.assessment, {
    type: 'exam',
    label: 'Экзамен',
    sourceRef: {
      sourceId: 'pediatrics',
      locator: '6 курс осень 2026-2027 Пед!S28'
    }
  });

  const pharmacology = events.find((event) => event.discipline === 'Клиническая фармакология');
  assert.equal(pharmacology.assessment.type, 'credit');
  assert.equal(pharmacology.assessment.label, 'Зачёт');
});
