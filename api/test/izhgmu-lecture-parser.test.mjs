import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';

function cell(ref, row, col, value) {
  return { ref, row, col, value, runs: [] };
}

const weeklyParsed = {
  profile: 'IZH-WEEKLY',
  group: '109',
  groups: ['101', '102'],
  period: {
    start_date: '2026-02-09',
    end_date: '2026-02-28',
    week1_start_date: '2026-02-09',
    reference: 'подробное расписание лекций!E3',
  },
  parity: { odd: 'below_line', even: 'above_line', evidenceCount: 2, references: [] },
  series: [],
  reviewRequired: [],
  deferred: [],
  publishable: false,
};

function baseClassStructure() {
  return { sheets: [{
    name: 'расписание',
    cells: [
      cell('C5', 5, 3, '101'), cell('D5', 5, 4, '102'),
      cell('A6', 6, 1, 'Понедельник'), cell('B6', 6, 2, '8.30-10.05'),
      cell('C6', 6, 3, 'Биоэтика'), cell('C7', 7, 3, 'Биоэтика'),
      cell('A8', 8, 1, 'Суббота'), cell('B8', 8, 2, '8.30-10.05'),
      cell('C8', 8, 3, 'ДВ: Культурология; ДВ Медицинская химия'),
      cell('B9', 9, 2, '10.15-11.55'), cell('C9', 9, 3, 'практические занятия по ДВ'),
    ],
    merges: [
      { ref: 'A6:A7', startRef: 'A6', endRef: 'A7', startRow: 6, endRow: 7, startCol: 1, endCol: 1 },
      { ref: 'B6:B7', startRef: 'B6', endRef: 'B7', startRow: 6, endRow: 7, startCol: 2, endCol: 2 },
      { ref: 'C6:D6', startRef: 'C6', endRef: 'D6', startRow: 6, endRow: 6, startCol: 3, endCol: 4 },
      { ref: 'C7:D7', startRef: 'C7', endRef: 'D7', startRow: 7, endRow: 7, startCol: 3, endCol: 4 },
      { ref: 'A8:A9', startRef: 'A8', endRef: 'A9', startRow: 8, endRow: 9, startCol: 1, endCol: 1 },
      { ref: 'C8:D8', startRef: 'C8', endRef: 'D8', startRow: 8, endRow: 8, startCol: 3, endCol: 4 },
      { ref: 'C9:D9', startRef: 'C9', endRef: 'D9', startRow: 9, endRow: 9, startCol: 3, endCol: 4 },
    ],
  }] };
}

function baseLectureStructure() {
  return { sheets: [{
    name: 'подробное расписание лекций',
    cells: [
      cell('A6', 6, 1, 'Дни недели'), cell('B6', 6, 2, 'Время'), cell('C6', 6, 3, 'Предмет'),
      cell('D6', 6, 4, 'Ауд.'), cell('E6', 6, 5, 'Неделя'), cell('F6', 6, 6, 'Февраль'),
      cell('H6', 6, 8, 'Кол-во лекций'),
      cell('A7', 7, 1, 'Понедельник'), cell('B7', 7, 2, '8.30'), cell('C7', 7, 3, 'Биоэтика'),
      cell('D7', 7, 4, '1 ауд.'), cell('E7', 7, 5, 'над черт.'), cell('F7', 7, 6, '16'),
      cell('B8', 8, 2, '8.30'), cell('C8', 8, 3, 'Биоэтика'), cell('D8', 8, 4, '6 ауд.'),
      cell('E8', 8, 5, 'под черт.'), cell('F8', 8, 6, '23'), cell('H8', 8, 8, '2'),
      cell('A9', 9, 1, 'Суббота'), cell('B9', 9, 2, '8.30'), cell('C9', 9, 3, 'Культурология'),
      cell('D9', 9, 4, 'Каф.'), cell('E9', 9, 5, 'над черт.'), cell('F9', 9, 6, '21'), cell('H9', 9, 8, '1'),
    ],
    merges: [
      { ref: 'F6:G6', startRef: 'F6', endRef: 'G6', startRow: 6, endRow: 6, startCol: 6, endCol: 7 },
      { ref: 'A7:A8', startRef: 'A7', endRef: 'A8', startRow: 7, endRow: 8, startCol: 1, endCol: 1 },
    ],
  }] };
}

test('IZH-LECTURE expands exact dates, resolves end time and reconciles aggregate count', () => {
  const parsed = parseIzhgmuLectureStructures({
    classStructure: baseClassStructure(),
    lectureStructure: baseLectureStructure(),
    weeklyParsed,
  });

  assert.equal(parsed.stats.lectureRows, 3);
  assert.equal(parsed.stats.exactOccurrences, 3);
  assert.equal(parsed.stats.safeOccurrences, 2);
  assert.equal(parsed.stats.electiveOccurrences, 1);
  assert.equal(parsed.reviewRequired.length, 0);
  assert.equal(parsed.choiceRequired.warning, 'elective_choice_required');
  assert.equal(parsed.choiceRequired.options.length, 1);
  assert.equal(parsed.classCoverage.totalWideBlocks, 4);
  assert.equal(parsed.classCoverage.resolvedByLecture.length, 2);
  assert.equal(parsed.classCoverage.choiceRequired.length, 2);
  assert.equal(parsed.classCoverage.unmapped.length, 0);

  const bioethics = parsed.series.filter((item) => item.discipline === 'Биоэтика');
  assert.deepEqual(bioethics.map((item) => item.endTime), ['10:05', '10:05']);
  assert.equal(bioethics.find((item) => item.declaredCount === 2).declaredCountScope, 'discipline_total');
  assert.deepEqual(bioethics.flatMap((item) => item.dates), ['2026-02-16', '2026-02-23']);

  const combined = composeIzhgmuWeeklyLecture({ weeklyParsed, lectureParsed: parsed });
  assert.equal(combined.profile, 'IZH-WEEKLY+LECTURE');
  assert.equal(combined.unresolvedChoices.length, 1);
  assert.equal(combined.publishable, false);
});

test('IZH-LECTURE recovers a missing class day only through one shared merged time slot', () => {
  const classStructure = baseClassStructure();
  const sheet = classStructure.sheets[0];
  sheet.cells.push(
    cell('B10', 10, 2, '8.30-10.05'), cell('C10', 10, 3, 'Гистология'),
    cell('A11', 11, 1, 'Пятница'), cell('C11', 11, 3, 'Физика'),
  );
  sheet.merges.push(
    { ref: 'B10:B11', startRef: 'B10', endRef: 'B11', startRow: 10, endRow: 11, startCol: 2, endCol: 2 },
    { ref: 'C10:D10', startRef: 'C10', endRef: 'D10', startRow: 10, endRow: 10, startCol: 3, endCol: 4 },
    { ref: 'C11:D11', startRef: 'C11', endRef: 'D11', startRow: 11, endRow: 11, startCol: 3, endCol: 4 },
  );

  const lectureStructure = baseLectureStructure();
  const lsheet = lectureStructure.sheets[0];
  lsheet.cells.push(
    cell('A10', 10, 1, 'Пятница'), cell('B10', 10, 2, '8.30'), cell('C10', 10, 3, 'Гистология'),
    cell('D10', 10, 4, '9 ауд.'), cell('F10', 10, 6, '20'), cell('H10', 10, 8, '1'),
  );

  const parsed = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed });
  const recovered = parsed.classCoverage.blocks.find((item) => item.ref === 'C10');
  assert.equal(recovered.weekday, 5);
  assert.equal(recovered.dayRecoveredFromTimeSlot, true);
  assert.equal(recovered.coverage, 'resolved_by_lecture');
});

test('IZH-LECTURE fails closed when declared count cannot be reconciled', () => {
  const lectureStructure = baseLectureStructure();
  const sheet = lectureStructure.sheets[0];
  sheet.cells.find((item) => item.ref === 'H8').value = '3';
  const parsed = parseIzhgmuLectureStructures({
    classStructure: baseClassStructure(),
    lectureStructure,
    weeklyParsed,
  });
  assert.ok(parsed.reviewRequired.some((item) => item.warning === 'declared_lecture_count_mismatch'));
});
