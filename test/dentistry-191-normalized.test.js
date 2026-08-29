import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

function expandFixture(fixture) {
  assert.deepEqual(fixture.tupleFields, [
    'eventId', 'groupId', 'date', 'startTime', 'endTime',
    'discipline', 'lessonType', 'location', 'sourceLocator'
  ]);
  return fixture.events.map(tuple => ({
    eventId: tuple[0],
    universityId: fixture.constants.universityId,
    groupId: tuple[1],
    academicPeriodId: fixture.constants.academicPeriodId,
    date: tuple[2],
    startTime: tuple[3],
    endTime: tuple[4],
    timeSemantics: fixture.constants.timeSemantics,
    discipline: tuple[5],
    lessonType: tuple[6],
    teacher: fixture.constants.teacher,
    location: tuple[7],
    sourceRef: { sourceId: fixture.constants.sourceId, locator: tuple[8] }
  }));
}

function minutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function overlaps(left, right) {
  return minutes(left.startTime) < minutes(right.endTime)
    && minutes(right.startTime) < minutes(left.endTime);
}

function find(events, criteria) {
  return events.filter(event => Object.entries(criteria)
    .every(([key, value]) => event[key] === value));
}

test('dentistry 191 normalized draft is structurally valid but B49 remains review-required', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const qa = await readJson('../qa/2026-2027-semester-1/dentistry-191.qa-report.json');
  const events = expandFixture(fixture);

  assert.equal(fixture.eventCount, 340);
  assert.equal(events.length, 340);
  assert.equal(evidence.eventCount, 340);
  assert.deepEqual(evidence.groupEventCounts, { '191': 340 });
  assert.equal(evidence.timetableSourceCellCount, 29);
  assert.equal(evidence.coveredSourceCellCount, 28);
  assert.deepEqual(evidence.excludedSourceCells, []);
  assert.deepEqual(evidence.unresolvedSourceCells.map(item => item.locator), ['1 стомат.!B49']);
  assert.equal(evidence.unresolvedSourceCells[0].rule, 'R39/R78');
  assert.equal(evidence.unresolvedAmbiguities, 1);
  assert.equal(evidence.duplicateEvents, 0);
  assert.equal(evidence.hardCountChecks.length, 7);
  assert.ok(evidence.hardCountChecks.every(check => check.status === 'pass'));
  assert.equal(evidence.candidateDigest, fixture.candidateDigest);
  assert.equal(qa.candidateDigest, fixture.candidateDigest);

  const eventIds = new Set();
  const signatures = new Set();
  const sourceCells = new Set();
  for (const event of events) {
    assert.match(event.eventId, /^kgmu-[0-9a-f]{24}$/);
    assert.equal(event.universityId, 'kirov-gmu');
    assert.equal(event.groupId, '191');
    assert.equal(event.academicPeriodId, '2026-2027-semester-1');
    assert.equal(event.timeSemantics, 'floating');
    assert.ok(event.date >= '2026-09-01' && event.date <= '2027-01-16');
    assert.match(event.startTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.match(event.endTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.ok(minutes(event.endTime) > minutes(event.startTime));
    assert.equal(event.sourceRef.sourceId, 'dentistry');
    assert.match(event.sourceRef.locator, /^1 стомат\.![B]\d+#s\d+$/);

    assert.ok(!eventIds.has(event.eventId), `duplicate eventId ${event.eventId}`);
    eventIds.add(event.eventId);
    const signature = [event.groupId, event.date, event.startTime, event.endTime,
      event.discipline, event.lessonType, event.location].join('|');
    assert.ok(!signatures.has(signature), `duplicate event ${signature}`);
    signatures.add(signature);
    sourceCells.add(event.sourceRef.locator.match(/!([A-Z]+\d+)#/)[1]);
  }
  assert.equal(sourceCells.size, 28);
  assert.ok(!sourceCells.has('B49'));
});

test('dentistry 191 locks source-specific hard-count decisions and explicit controls', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const decisions = await readJson('../qa/2026-2027-semester-1/dentistry-191-194.review-decisions.json');
  const events = expandFixture(fixture);

  const histologyMonday = events.filter(event =>
    event.discipline === 'Гистология, эмбриология, цитология-гистология полости рта'
    && event.lessonType === 'lecture'
    && event.sourceRef.locator === '1 стомат.!B13#s2');
  assert.deepEqual(histologyMonday.map(event => event.date), [
    '2026-11-16', '2026-11-23', '2026-11-30'
  ]);

  const separateHistology = find(events, {
    date: '2026-09-14',
    startTime: '14:10',
    endTime: '15:40',
    discipline: 'Гистология, эмбриология, цитология-гистология полости рта',
    lessonType: 'lecture'
  });
  assert.equal(separateHistology.length, 1);
  assert.equal(separateHistology[0].sourceRef.locator, '1 стомат.!B15#s1');

  const russianMondays = events.filter(event =>
    event.discipline === 'Русский язык и культура речи'
    && event.sourceRef.locator === '1 стомат.!B15#s3');
  assert.deepEqual(russianMondays.map(event => event.date), [
    '2026-11-23', '2026-12-07', '2026-12-21'
  ]);

  const curator = events.filter(event => event.discipline === 'Час куратора');
  assert.deepEqual(curator.map(event => event.date), ['2026-09-01', '2026-09-08']);
  assert.ok(curator.every(event => event.startTime === '16:40' && event.endTime === '17:40'));

  const credit = find(events, {
    date: '2027-01-13',
    discipline: 'Основы российской государственности',
    lessonType: 'credit'
  });
  assert.equal(credit.length, 1);
  assert.equal(credit[0].startTime, '08:00');
  assert.equal(credit[0].endTime, '10:25');
  assert.match(credit[0].location, /аудитория 318/);
  assert.equal(events.filter(event =>
    event.date === '2027-01-13'
    && event.discipline === 'Основы российской государственности').length, 1);

  assert.equal(decisions.decisions.length, 1);
  assert.equal(decisions.decisions[0].id, 'dentistry-191-histology-monday-lectures');
  assert.equal(decisions.decisions[0].status, 'confirmed');
  assert.equal(evidence.confirmedReviewDecisions[0], decisions.decisions[0].id);
});

test('dentistry 191 preserves exactly four source-explicit overlaps', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191.normalized.compact.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const events = expandFixture(fixture);
  const byDate = new Map();
  for (const event of events) {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  let overlapCount = 0;
  for (const dayEvents of byDate.values()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (overlaps(dayEvents[i], dayEvents[j])) overlapCount += 1;
      }
    }
  }
  assert.equal(overlapCount, 4);
  assert.equal(evidence.explicitOverlapWarningCount, 4);
  assert.equal(evidence.explicitOverlapWarnings.length, 4);
});

test('dentistry 191 QA blocks publication on B49 and assessment projection', async () => {
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');
  const qa = await readJson('../qa/2026-2027-semester-1/dentistry-191.qa-report.json');

  assert.deepEqual(Object.keys(qa).sort(), [
    'candidateDigest', 'checks', 'createdAt', 'decision', 'parsingJobId', 'qaReportId'
  ].sort());
  assert.equal(qa.decision, 'fail');
  const failedChecks = qa.checks.filter(check => check.status === 'fail');
  assert.deepEqual(failedChecks.map(check => check.code), [
    'group-content-accounted-for',
    'facultative-group-mapping-resolved',
    'unresolved-ambiguities-zero',
    'assessment-metadata-projection'
  ]);

  assert.equal(evidence.assessmentMetadata.length, 6);
  assert.ok(evidence.assessmentMetadata.some(item =>
    item.discipline === 'Основы российской государственности'
    && item.form === 'зачет с оценкой'));
  assert.equal(evidence.publicationReadiness.status, 'blocked');
});
