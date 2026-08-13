import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyRWorkbook } from '../src/adapters/kgmu/weekly-r-parser.mjs';

function overlapWorkbook() {
  return {
    sheets: [{
      name: 'generic-r',
      cells: [
        { ref: 'B1', row: 1, col: 2, value: 'РАСПИСАНИЕ ЗАНЯТИЙ НА ПЕРВОЕ ПОЛУГОДИЕ 2026-2027 учебного года' },
        { ref: 'B2', row: 2, col: 2, value: '01.09.2026 - 31.12.2026' },
        { ref: 'B3', row: 3, col: 2, value: 'группа 101' },
        { ref: 'C3', row: 3, col: 3, value: 'группа 102' },
        { ref: 'A4', row: 4, col: 1, value: 'ВТ' },
        { ref: 'B4', row: 4, col: 2, value: '09.00-11.00 Анатомия 01.09' },
        { ref: 'C4', row: 4, col: 3, value: '09.00-10.00 Анатомия 01.09' },
        { ref: 'A5', row: 5, col: 1, value: 'ВТ' },
        { ref: 'B5', row: 5, col: 2, value: '10.00-12.00 Биология 01.09' },
        { ref: 'C5', row: 5, col: 3, value: '10.00-11.00 Биология 01.09' },
      ],
      merges: [],
      styledCells: [],
      hiddenRows: [],
    }],
  };
}

test('base weekly R parser keeps temporal overlaps diagnostic-only under R69', () => {
  const result = parseWeeklyRWorkbook(overlapWorkbook(), {
    university: 'kgmu',
    program: 'medicine',
    course: 1,
    academicYear: '2026/27',
    semester: 1,
    scheduleEndRow: 5,
  });

  assert.equal(result.qa.uncovered.length, 0, JSON.stringify(result.qa, null, 2));
  assert.equal(result.qa.extraLessonFailures.length, 0, JSON.stringify(result.qa, null, 2));
  assert.ok(result.qa.remainingOverlaps.length > 0, JSON.stringify(result.qa, null, 2));
  assert.equal(result.qa.status, 'PASS', JSON.stringify(result.qa, null, 2));
  assert.equal(result.schedules.find((item) => item.group.code === '101').events.length, 2);
});
