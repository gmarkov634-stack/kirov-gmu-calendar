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

test('dentistry 191 normalized draft is complete and QA-linked', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const qa = await readJson('../qa/2026-2027-semester-1/dentistry-191.qa-report.json');
  const events = expandFixture(fixture);

  assert.equal(fixture.fixtureId, 'dentistry-191-2026-2027-semester-1');
  assert.equal(fixture.sourceFixtureId, 'dentistry-191-194-2026-2027-semester-1');
  assert.equal(fixture.encoding, 'normalized-event-tuples-v1');
  assert.equal(fixture.eventCount, 340);
  assert.equal(events.length, 340);
  assert.equal(evidence.eventCount, 340);
  assert.deepEqual(evidence.groupEventCounts, { '191': 340 });
  assert.equal(evidence.timetableSourceCellCount, 29);
  assert.equal(evidence.coveredSourceCellCount, 28);
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(evidence.duplicateEvents, 0);
  assert.equal(evidence.explicitOverlapWarningCount, 4);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.candidateDigest, fixture.candidateDigest);
  assert.equal(evidence.candidateDigest, fixture.candidateDigest);
  assert.equal(qa.candidateArtifact, evidence.candidateArtifact.path);

  const expectedSourceCells = [
    'B10', 'B13', 'B14', 'B15', 'B17', 'B19', 'B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27',
    'B29', 'B31', 'B32', 'B33', 'B34', 'B36', 'B39', 'B40', 'B41', 'B42', 'B43', 'B45', 'B46', 'B47'
  ];
  assert.deepEqual(evidence.coveredSourceCells, expectedSourceCells);
  assert.equal(evidence.excludedSourceCells.length, 1);
  assert.equal(evidence.excludedSourceCells[0].locator, '1 стомат.!B49');
  assert.equal(evidence.excludedSourceCells[0].rule, 'R39');

  const eventIds = new Set();
  const signatures = new Set();
  const sourceCells = new Set();
  for (const event of events) {
    assert.match(event.eventId, /^kgmu-[0-9a-f]{24}$/);
    assert.equal(event.universityId, 'kirov-gmu');
    assert.equal(event.groupId, '191');
    assert.equal(event.academicPeriodId, '2026-2027-semester-1');
    assert.equal(event.timeSemantics, 'floating');
    assert.equal(event.sourceRef.sourceId, 'dentistry');
    assert.match(event.sourceRef.locator, /^1 стомат\.![B]\d+#s\d+$/);
    assert.ok(event.date >= '2026-09-01' && event.date <= '2027-01-16');
    assert.match(event.startTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.match(event.endTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.ok(minutes(event.endTime) > minutes(event.startTime));

    assert.ok(!eventIds.has(event.eventId), `duplicate eventId ${event.eventId}`);
    eventIds.add(event.eventId);
    const signature = [event.groupId, event.date, event.startTime, event.endTime, event.discipline, event.lessonType, event.location].join('|');
    assert.ok(!signatures.has(signature), `duplicate event ${signature}`);
    signatures.add(signature);
    sourceCells.add(event.sourceRef.locator.match(/!([A-Z]+\d+)#/)[1]);
  }
  assert.deepEqual([...sourceCells].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))), expectedSourceCells);
  assert.ok(!sourceCells.has('B49'));
  assert.equal(evidence.hardCountChecks.length, 7);
  assert.ok(evidence.hardCountChecks.every(check => check.status === 'pass'));
  assert.deepEqual(evidence.confirmedReviewDecisions, ['dentistry-191-histology-monday-lectures']);
});

test('dentistry 191 locks R17, R59 and confirmed companion-event decisions', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const events = expandFixture(fixture);
  const find = criteria => events.filter(event => Object.entries(criteria).every(([key, value]) => event[key] === value));

  const curator = find({ discipline: 'Час куратора', startTime: '16:40', endTime: '17:40' });
  assert.deepEqual(curator.map(event => event.date), ['2026-09-01', '2026-09-08']);

  const orgControl = find({ date: '2027-01-13', discipline: 'Основы российской государственности' });
  assert.equal(orgControl.length, 1);
  assert.equal(orgControl[0].lessonType, 'credit');
  assert.equal(orgControl[0].startTime, '08:00');
  assert.equal(orgControl[0].endTime, '10:25');
  assert.equal(find({ date: '2027-01-13', discipline: 'Основы российской государственности', lessonType: 'practice' }).length, 0);

  const histologyMonday = events.filter(event =>
    event.discipline === 'Гистология, эмбриология, цитология-гистология полости рта' &&
    event.sourceRef.locator === '1 стомат.!B13#s2'
  );
  assert.deepEqual(histologyMonday.map(event => [event.date, event.startTime, event.endTime]), [
    ['2026-11-16', '12:40', '14:10'],
    ['2026-11-23', '12:40', '14:10'],
    ['2026-11-30', '12:40', '14:10']
  ]);
  const separateHistology = find({ date: '2026-09-14', discipline: 'Гистология, эмбриология, цитология-гистология полости рта', startTime: '14:10', endTime: '15:40' });
  assert.equal(separateHistology.length, 1);
  assert.equal(separateHistology[0].sourceRef.locator, '1 стомат.!B15#s1');

  const russianMonday = events.filter(event => event.sourceRef.locator === '1 стомат.!B15#s3');
  assert.deepEqual(russianMonday.map(event => event.date), ['2026-11-23', '2026-12-07', '2026-12-21']);
  assert.ok(russianMonday.every(event => event.discipline === 'Русский язык и культура речи'));

  const chemistryMonday = events.filter(event => event.sourceRef.locator === '1 стомат.!B15#s2');
  assert.deepEqual(chemistryMonday.map(event => [event.date, event.startTime, event.endTime]), [['2026-09-21', '14:40', '16:10']]);

  const peMonday = events.filter(event => event.sourceRef.locator === '1 стомат.!B13#s3');
  assert.deepEqual(peMonday.map(event => event.date), ['2026-12-28']);

  const chemistrySaturday = events.filter(event => event.sourceRef.locator === '1 стомат.!B43#s1');
  assert.deepEqual(chemistrySaturday.map(event => event.date), ['2026-12-05', '2026-12-12']);

  const orgSaturday = events.filter(event => event.sourceRef.locator === '1 стомат.!B43#s2');
  assert.deepEqual(orgSaturday.map(event => event.date), ['2027-01-16']);

  const historyThursday = events.filter(event => event.sourceRef.locator === '1 стомат.!B31#s2');
  assert.deepEqual(historyThursday.map(event => event.date), ['2026-12-03', '2026-12-10', '2026-12-17', '2026-12-24']);
});

test('dentistry 191 QA preserves exactly the four source-explicit overlaps', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const events = expandFixture(fixture);
  const byDate = new Map();
  for (const event of events) {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  const overlapPairs = [];
  for (const [date, dayEvents] of byDate.entries()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (overlaps(dayEvents[i], dayEvents[j])) {
          overlapPairs.push([date, dayEvents[i].discipline, dayEvents[j].discipline]);
        }
      }
    }
  }
  assert.equal(overlapPairs.length, 4);
  assert.deepEqual(overlapPairs.map(row => row[0]), ['2026-09-21', '2026-12-05', '2026-12-12', '2027-01-16']);
  assert.equal(evidence.explicitOverlapWarnings.length, 4);
});
