import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { expandExplicitDecisionManifest } from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const [manifest, source, semantic, review, evidence] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.source.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.semantic-source.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-431-436.semantic-review.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-431-436.normalization-evidence.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const SOURCE_SHA = '2a06f31b31e59e2c8408a6c20876e62869ce9ce8b98a4ea5dc2004fa2a486c86';
const SHEET = '4 курс осень 2026 Пед';
const groups = ['431', '432', '433', '434', '435', '436'];

const eventsForLocator = (locator) => events
  .filter((event) => event.sourceRef.locator === `${SHEET}!${locator}`)
  .sort((a, b) => a.date.localeCompare(b.date));

const minute = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

test('manifest is bound to the verified Pediatrics course-4 source and resolved G21 review', () => {
  assert.equal(source.source.sha256, SOURCE_SHA);
  assert.equal(semantic.sourceSha256, SOURCE_SHA);
  assert.equal(review.sourceSha256, SOURCE_SHA);
  assert.equal(manifest.sourceSha256, SOURCE_SHA);
  assert.equal(source.parserProfile, 'cyclic');
  assert.equal(source.parserRulesVersion, 'kgmu-2026-08-30-v4');
  assert.equal(manifest.parserRulesVersion, source.parserRulesVersion);
  assert.deepEqual(manifest.groupTable, groups);
  assert.deepEqual(review.unresolvedAmbiguities, []);
  assert.equal(review.qaGate.semanticAmbiguitiesResolved, true);
  const byId = Object.fromEntries(review.resolvedAmbiguities.map((item) => [item.ambiguityId, item]));
  assert.equal(byId['PED4-C20-MANAGEMENT-EXTENDED-DAYS'].exceptionDatePolicy, 'last-2-calendar-dates');
  assert.equal(byId['PED4-C20-IOK-EXTENDED-DAY'].exceptionDatePolicy, 'last-1-calendar-date');
});

test('every extracted upper-grid block is classified and every generating block expands', () => {
  assert.equal(semantic.cycleBlocks.length, 97);
  assert.equal(evidence.semanticSourceCycleBlockCount, semantic.cycleBlocks.length);
  assert.equal(evidence.classifiedCycleBlockCount, semantic.cycleBlocks.length);
  assert.equal(evidence.generatingCycleBlockCount, 90);
  assert.equal(evidence.serviceNoEventBlockCount, 7);
  assert.equal(evidence.managementG21BlockCount, 6);
  assert.equal(evidence.iokG21BlockCount, 6);
  assert.equal(evidence.managementDefenseBlockCount, 6);
  assert.equal(evidence.starredC02BlockCount, 5);
  assert.equal(evidence.classifications.length, semantic.cycleBlocks.length);

  for (const classification of evidence.classifications) {
    const expanded = eventsForLocator(classification.locator);
    if (classification.classification === 'service-no-event') {
      assert.equal(expanded.length, 0, `service block unexpectedly expanded: ${classification.locator}`);
    } else {
      assert.ok(expanded.length > 0, `generating block did not expand: ${classification.locator}`);
    }
  }
});

test('C20/G21 puts Management extended time on the last two dates of every cycle', () => {
  const blocks = semantic.cycleBlocks.filter((block) => block.value.replace(/\s+/g, ' ').includes('Менеджмент в'));
  assert.equal(blocks.length, 6);
  for (const block of blocks) {
    const actual = eventsForLocator(block.locator).filter((event) => event.discipline === 'Менеджмент в здравоохранении');
    assert.equal(actual.length, block.dates.length, `${block.group} ${block.locator}`);
    const lastTwo = new Set(block.dates.slice(-2));
    for (const event of actual) {
      assert.equal(event.startTime, '08:30');
      assert.equal(event.endTime, lastTwo.has(event.date) ? '13:10' : '11:35', `${block.group} ${event.date}`);
    }
  }
});

test('C20/G21 puts IOK extended time on the last date of every cycle', () => {
  const blocks = semantic.cycleBlocks.filter((block) => block.value.replace(/\s+/g, ' ').startsWith('ИОК врача-'));
  assert.equal(blocks.length, 6);
  for (const block of blocks) {
    const actual = eventsForLocator(block.locator).filter((event) => event.discipline === 'Инклюзивно ориентированная компетентность врача-педиатра');
    assert.equal(actual.length, block.dates.length, `${block.group} ${block.locator}`);
    const last = block.dates.at(-1);
    for (const event of actual) {
      assert.equal(event.startTime, '09:00');
      assert.equal(event.endTime, event.date === last ? '13:40' : '12:05', `${block.group} ${event.date}`);
    }
  }
});

test('C02 starred blocks use second shift only on the first cycle date', () => {
  const blocks = semantic.cycleBlocks.filter((block) => block.value.trim().endsWith('*'));
  assert.equal(blocks.length, 5);
  for (const block of blocks) {
    const actual = eventsForLocator(block.locator);
    assert.equal(actual.length, block.dates.length);
    const first = actual.find((event) => event.date === block.dates[0]);
    assert.ok(first);
    if (first.discipline === 'Офтальмология') {
      assert.equal(`${first.startTime}-${first.endTime}`, '12:30-15:35');
      for (const event of actual.filter((item) => item.date !== first.date)) {
        assert.equal(`${event.startTime}-${event.endTime}`, '09:00-12:05');
      }
    } else {
      assert.equal(block.group, '433');
      assert.equal(first.discipline, 'Неврология, детская неврология');
      assert.equal(`${first.startTime}-${first.endTime}`, '10:30-13:35');
      for (const event of actual.filter((item) => item.date !== first.date)) {
        assert.equal(`${event.startTime}-${event.endTime}`, '09:00-12:05');
      }
    }
  }
});

test('C03/C04 creates exactly one management-project defense per group', () => {
  const defense = events.filter((event) => event.discipline === 'ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ');
  assert.equal(defense.length, 6);
  assert.deepEqual([...new Set(defense.map((event) => event.groupId))].sort(), groups);
  for (const event of defense) {
    assert.equal(`${event.startTime}-${event.endTime}`, '08:30-11:35');
    assert.equal(event.lessonType, 'other');
    assert.equal(event.assessment?.type, 'credit');
  }
});

test('C12 creates Physical Education for all groups on explicit Wednesdays only', () => {
  const expectedDates = semantic.dateAxis
    .filter((item) => item.date >= '2026-09-02' && item.date <= '2026-12-23' && item.weekday === 'ср')
    .map((item) => item.date);
  assert.equal(expectedDates.length, 16);
  const phys = events.filter((event) => event.discipline === 'Дисциплины по физической культуре и спорту');
  assert.equal(phys.length, expectedDates.length * groups.length);
  for (const groupId of groups) {
    const groupDates = phys.filter((event) => event.groupId === groupId).map((event) => event.date).sort();
    assert.deepEqual(groupDates, expectedDates);
  }
  for (const event of phys) {
    assert.equal(`${event.startTime}-${event.endTime}`, '15:10-16:40');
  }
});

test('group-specific source times and Management rooms are preserved', () => {
  for (const event of events.filter((item) => item.discipline === 'Факультетская терапия, профессиональные болезни')) {
    const expected = ['433', '434', '436'].includes(event.groupId) ? '08:30-11:35' : '13:00-16:05';
    assert.equal(`${event.startTime}-${event.endTime}`, expected);
  }
  for (const event of events.filter((item) => item.discipline === 'Менеджмент в здравоохранении' || item.discipline.startsWith('ЗАЩИТА ПРОЕКТА'))) {
    const room = ['433', '435', '436'].includes(event.groupId) ? '413' : ['431', '432'].includes(event.groupId) ? '415' : '419';
    assert.match(event.location, new RegExp(`каб\\. ${room}`));
  }
});

test('generic exam/vacation service blocks do not become fake events', () => {
  assert.equal(events.some((event) => /^экзамен/i.test(event.discipline)), false);
  assert.equal(events.some((event) => /каникул/i.test(event.discipline)), false);
});

test('normalized candidate has valid group/date/time/source fields and no duplicate signatures', () => {
  const signatureSet = new Set();
  for (const event of events) {
    assert.ok(groups.includes(event.groupId));
    assert.match(event.date, /^202[67]-\d{2}-\d{2}$/);
    assert.match(event.startTime, /^\d{2}:\d{2}$/);
    assert.match(event.endTime, /^\d{2}:\d{2}$/);
    assert.ok(minute(event.startTime) < minute(event.endTime));
    assert.equal(event.universityId, 'kirov-gmu');
    assert.equal(event.academicPeriodId, '2026-2027-semester-1');
    assert.equal(event.sourceRef.sourceId, 'pediatrics');
    assert.ok(event.sourceRef.locator.startsWith(`${SHEET}!`));
    const signature = [event.groupId, event.date, event.startTime, event.endTime, event.discipline, event.lessonType, event.location ?? ''].join('|');
    assert.equal(signatureSet.has(signature), false, `duplicate signature: ${signature}`);
    signatureSet.add(signature);
  }
});

test('all time overlaps are source-backed C12 overlaps rather than generated duplicates', () => {
  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  for (const dayEvents of byDay.values()) {
    for (let left = 0; left < dayEvents.length; left += 1) {
      for (let right = left + 1; right < dayEvents.length; right += 1) {
        const a = dayEvents[left];
        const b = dayEvents[right];
        const overlaps = minute(a.startTime) < minute(b.endTime) && minute(b.startTime) < minute(a.endTime);
        if (!overlaps) continue;
        assert.ok(
          a.discipline === 'Дисциплины по физической культуре и спорту' || b.discipline === 'Дисциплины по физической культуре и спорту',
          `unexpected overlap: ${a.groupId} ${a.date} ${a.discipline} / ${b.discipline}`
        );
      }
    }
  }
});
