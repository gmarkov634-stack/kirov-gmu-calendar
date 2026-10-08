import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const reviewPath = new URL('../qa/2026-2027-semester-1/dentistry-591-594.current-source-review.json', import.meta.url);
const fixturePath = new URL('../fixtures/2026-2027-semester-1/dentistry-591-594.source.json', import.meta.url);
const draftPath = new URL('../fixtures/2026-2027-semester-1/normalized/dentistry-591-594.normalized.json', import.meta.url);
const publisherPath = new URL('../ops/publish-dentistry-591-594.mjs', import.meta.url);

test('current official Dentistry 591-594 source is pinned mechanically and fails closed', async () => {
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  assert.equal(review.schema, 'kgmu-dentistry-current-source-review-v1');
  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.publicationAllowed, false);
  assert.equal(review.readyForScheduleVersion, false);
  assert.equal(review.semanticParsingPerformed, false);
  assert.equal(review.publicationPerformed, false);
  assert.equal(review.source.sha256, '55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff');
  assert.equal(review.source.byteLength, 23903);
  assert.equal(review.source.course, 5);
  assert.deepEqual(review.source.expectedGroupIds, ['591', '592', '593', '594']);
  assert.match(review.source.url, /2026\/10\/08\/1097\/5_stomat-08-10-2026-08\.xlsx$/);
  assert.deepEqual(review.workbook.sheetNames, ['2026-2027 осень 5 курс Стом']);
  assert.equal(review.workbook.xmlDimension, 'A1:DT36');
  assert.equal(review.workbook.mergedRangeCount, 127);
  assert.deepEqual(review.workbook.groupRows, {'591': 15, '592': 16, '593': 17, '594': 18});
  assert.deepEqual(review.workbook.dateHeaderCells.months, ['C12', 'AC12', 'BD12', 'CB12', 'DB12']);

  const anchorSet = new Set(review.mechanicalAnchors.map(item => item.cell));
  for (const cell of ['AY15','C17','AY18','BI18','CE28','CI28','CE29','CE30','CE31','CW15:CW18','DC15:DC18','DO15:DO18']) {
    assert.ok(anchorSet.has(cell), `missing explicit source anchor ${cell}`);
  }
  assert.ok(review.reviewItems.length >= 4);
  assert.equal(new Set(review.reviewItems.map(item => item.id)).size, review.reviewItems.length);
  assert.equal(review.parserProfile, 'C');
  assert.equal(review.sourceSpecificRule, 'C24');
  assert.ok(review.confirmedRules.includes('C24'));
  assert.equal(review.manualConfirmation.count, 4);
  assert.deepEqual(review.reviewItems.map(item => item.status),
    ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'REVIEW_REQUIRED']);
  assert.ok(review.reviewItems.every(item => item.sourceCells.length > 0));
  assert.equal(review.reviewItems[0].confirmation.subjects.length, 2);
  assert.deepEqual(review.reviewItems[0].confirmation.subjects.map(s => [s.title, s.startTime, s.endTime]), [
    ['Медицина катастроф', '08:30', '11:35'],
    ['Физическая подготовка', '13:00', '14:30'],
  ]);
  assert.equal(review.reviewItems[1].confirmation.title, 'Комплексное зубопротезирование и имплантология');
  assert.equal(review.reviewItems[1].confirmation.retainDisjointSourceRanges, true);
  assert.deepEqual(review.reviewItems[2].confirmation.groups, ['591', '592', '593', '594']);
  assert.equal(review.reviewItems[2].confirmation.eventKind, 'MANDATORY');
  assert.equal(review.reviewItems[2].confirmation.choiceGroup, null);
  assert.deepEqual([review.reviewItems[2].confirmation.startDate,
    review.reviewItems[2].confirmation.endDate], ['2026-09-04', '2026-12-18']);
  assert.deepEqual([review.reviewItems[2].confirmation.startTime,
    review.reviewItems[2].confirmation.endTime], ['14:30', '16:00']);
  assert.deepEqual(review.reviewItems[3].confirmation.titles, ['Экзамены', 'Практика', 'Каникулы']);
  assert.equal(review.reviewItems[3].confirmation.eventKind, 'INFO');
  assert.equal(review.reviewItems[3].confirmation.isAllDay, true);
  assert.equal(review.reviewItems[3].confirmation.lessonReminders, false);
  assert.equal(review.reviewItems[3].confirmation.nextLesson, false);
  assert.ok(review.pendingQa.some(item => item.id === 'dent5-info-consumer-gate'));
  assert.match(review.nextGate, /exact-SHA/);
});

test('Dentistry 591-594 current source has no authorized parser fixture, normalized draft or publisher', async () => {
  for (const path of [fixturePath, draftPath, publisherPath]) {
    await assert.rejects(access(path), error => error?.code === 'ENOENT');
  }
});

test('Dentistry 591–594 C24 source calendar projects 588 events with exactly three documented conflicts', async () => {
  const audit = JSON.parse(await readFile(new URL('../qa/2026-2027-semester-1/dentistry-591-594.grid-audit.json', import.meta.url), 'utf8'));
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  assert.equal(audit.sourceSha256, review.source.sha256);
  assert.equal(audit.sourceSpecificRule, 'C24');
  assert.equal(audit.parserProfile, 'C');
  assert.equal(audit.status, 'REVIEW_REQUIRED');
  assert.equal(audit.publicationAllowed, false);
  assert.equal(audit.mergedRangeCount, 127);
  assert.equal(audit.dateHeaderCount, 122);
  assert.deepEqual(audit.groupCycleDateCoverage, {'591':98,'592':98,'593':98,'594':98});
  assert.deepEqual(audit.groupCycleAnchors, {'591':8,'592':8,'593':8,'594':9});
  assert.deepEqual(audit.mandatoryTimedOccurrencesByGroup, {'591':123,'592':123,'593':123,'594':123});
  assert.deepEqual(audit.allDayInfoOccurrencesByGroup, {'591':24,'592':24,'593':24,'594':24});
  assert.deepEqual(audit.projectedEventCountByGroup, {'591':147,'592':147,'593':147,'594':147});
  assert.equal(audit.projectedTotal, 588);
  assert.equal(audit.independentFridayPeDateCount, 16);
  assert.equal(audit.sourceBackedOverlaps.length, 3);
  assert.deepEqual(audit.sourceBackedOverlaps.map(({group,date}) => [group,date]), [
    ['592','2026-09-04'],['594','2026-10-30'],['594','2026-11-06']
  ]);
  assert.equal(audit.dateWeekdayMismatches.length, 0);
  assert.equal(audit.unknownCycleBlocks.length, 0);
});
