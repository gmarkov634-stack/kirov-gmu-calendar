import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

function expandFixture(fixture) {
  const [eventId, groupId, date, startTime, endTime, discipline, lessonType, location, sourceLocator] = fixture.tupleFields;
  assert.deepEqual(fixture.tupleFields, [
    'eventId', 'groupId', 'date', 'startTime', 'endTime', 'discipline', 'lessonType', 'location', 'sourceLocator'
  ]);
  return fixture.events.map(tuple => ({
    [eventId]: tuple[0],
    universityId: fixture.constants.universityId,
    [groupId]: tuple[1],
    academicPeriodId: fixture.constants.academicPeriodId,
    [date]: tuple[2],
    [startTime]: tuple[3],
    [endTime]: tuple[4],
    timeSemantics: fixture.constants.timeSemantics,
    [discipline]: tuple[5],
    [lessonType]: tuple[6],
    teacher: fixture.constants.teacher,
    [location]: tuple[7],
    sourceRef: { sourceId: fixture.constants.sourceId, locator: tuple[8] }
  }));
}

function minutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function overlaps(a, b) {
  return minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
}

test('golden 101-110 normalized draft is complete and floating-time safe', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/medicine-101-110.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json');
  const qa = await readJson('../qa/2026-2027-semester-1/medicine-101-110.qa-report.json');
  const events = expandFixture(fixture);

  assert.equal(fixture.encoding, 'normalized-event-tuples-v1');
  assert.equal(fixture.eventCount, 3412);
  assert.equal(events.length, 3412);
  assert.equal(evidence.eventCount, 3412);
  assert.equal(evidence.logicalSourceCellCount, 145);
  assert.equal(evidence.coveredSourceCellCount, 145);
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(evidence.duplicateEvents, 0);
  assert.equal(evidence.explicitOverlapWarningCount, 8);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.candidateDigest, fixture.candidateDigest);
  assert.equal(evidence.candidateDigest, fixture.candidateDigest);

  assert.deepEqual(evidence.groupEventCounts, {
    '101': 336, '102': 336, '103': 335, '104': 335, '105': 336,
    '106': 336, '107': 338, '108': 338, '109': 361, '110': 361
  });

  const eventIds = new Set();
  const signatures = new Set();
  const sourceCells = new Set();
  const groupCounts = new Map();
  for (const event of events) {
    assert.match(event.eventId, /^kgmu-[0-9a-f]{24}$/);
    assert.equal(event.universityId, 'kirov-gmu');
    assert.equal(event.academicPeriodId, '2026-2027-semester-1');
    assert.equal(event.timeSemantics, 'floating');
    assert.match(event.date, /^202(?:6|7)-\d{2}-\d{2}$/);
    assert.ok(event.date >= '2026-09-01' && event.date <= '2027-01-16');
    assert.match(event.startTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.match(event.endTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.ok(minutes(event.endTime) > minutes(event.startTime));
    assert.ok(!event.startTime.includes('Z') && !event.endTime.includes('Z'));
    assert.equal(event.sourceRef.sourceId, 'medicine');
    assert.match(event.sourceRef.locator, /^1 леч\.1![B-K]\d+#s\d+$/);

    assert.ok(!eventIds.has(event.eventId), `duplicate eventId ${event.eventId}`);
    eventIds.add(event.eventId);
    const signature = [event.groupId, event.date, event.startTime, event.endTime, event.discipline, event.lessonType, event.location].join('|');
    assert.ok(!signatures.has(signature), `duplicate event ${signature}`);
    signatures.add(signature);
    sourceCells.add(event.sourceRef.locator.match(/!([A-Z]+\d+)#/)[1]);
    groupCounts.set(event.groupId, (groupCounts.get(event.groupId) ?? 0) + 1);
  }
  assert.equal(sourceCells.size, 145);
  assert.deepEqual(Object.fromEntries([...groupCounts.entries()].sort(([a], [b]) => Number(a) - Number(b))), evidence.groupEventCounts);
  assert.ok(evidence.r83Checks.every(check => check.status === 'pass'));
  assert.equal(evidence.r83Checks.length, 26);
});

test('golden QA preserves exactly the eight source-explicit overlaps', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/medicine-101-110.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json');
  const events = expandFixture(fixture);
  const byGroupDate = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byGroupDate.has(key)) byGroupDate.set(key, []);
    byGroupDate.get(key).push(event);
  }
  let overlapCount = 0;
  for (const dayEvents of byGroupDate.values()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (overlaps(dayEvents[i], dayEvents[j])) overlapCount += 1;
      }
    }
  }
  assert.equal(overlapCount, 8);
  assert.equal(evidence.explicitOverlapWarnings.length, 8);
});

test('locks confirmed R87-R89 and explicit exception behavior', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/medicine-101-110.normalized.compact.json');
  const events = expandFixture(fixture);
  const find = criteria => events.filter(event => Object.entries(criteria).every(([key, value]) => event[key] === value));

  const roomOverride = find({ groupId: '101', date: '2026-09-09', discipline: 'Основы российской государственности' });
  assert.equal(roomOverride.length, 1);
  assert.match(roomOverride[0].location, /аудитория 313/);
  const normalRoom = find({ groupId: '101', date: '2026-09-16', discipline: 'Основы российской государственности' });
  assert.equal(normalRoom.length, 1);
  assert.match(normalRoom[0].location, /аудитория 406/);

  const combinedCredit = find({ groupId: '109', date: '2027-01-16', discipline: 'Основы российской государственности', lessonType: 'credit' });
  assert.equal(combinedCredit.length, 1);
  assert.equal(combinedCredit[0].startTime, '16:40');
  assert.equal(combinedCredit[0].endTime, '20:45');
  assert.match(combinedCredit[0].location, /аудитория 320/);

  const curator = events.filter(event => event.groupId === '110' && event.discipline === 'Час куратора' && event.sourceRef.locator.startsWith('1 леч.1!K27#s2'));
  assert.equal(curator.length, 19);
  assert.ok(curator.some(event => event.startTime === '14:30' && event.endTime === '15:30'));
  assert.ok(curator.some(event => event.startTime === '16:30' && event.endTime === '17:30'));

  const explicitBiology = find({ groupId: '108', date: '2026-11-30', discipline: 'Биология' });
  assert.ok(explicitBiology.some(event => event.startTime === '15:30' && event.endTime === '17:55'));

  const economyOverride = find({ groupId: '101', date: '2026-12-12', discipline: 'Экономика', lessonType: 'lecture' });
  assert.equal(economyOverride.length, 1);
  assert.equal(economyOverride[0].startTime, '13:30');
  assert.equal(economyOverride[0].endTime, '15:00');
});

test('locks lecture classification for the 2026-09-02 KGMU 101 phone-smoke events', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/medicine-101-110.normalized.compact.json');
  const events = expandFixture(fixture);
  const findOne = discipline => events.find(event =>
    event.groupId === '101' &&
    event.date === '2026-09-02' &&
    event.discipline === discipline
  );

  const physics = findOne('Физика, математика');
  const biology = findOne('Биология');
  assert.ok(physics);
  assert.ok(biology);
  assert.equal(physics.lessonType, 'lecture');
  assert.equal(biology.lessonType, 'lecture');
});
