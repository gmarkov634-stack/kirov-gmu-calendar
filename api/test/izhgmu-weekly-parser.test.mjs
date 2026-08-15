import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';

function syntheticStructures() {
  const groups = Array.from({ length: 10 }, (_, index) => ({
    ref: `${String.fromCharCode(67 + index)}5`, row: 5, col: 3 + index, value: String(101 + index), runs: [],
  }));
  return {
    classStructure: {
      sheets: [{
        name: 'расписание',
        cells: [
          ...groups,
          { ref: 'A6', row: 6, col: 1, value: 'Понедельник', runs: [] },
          { ref: 'C6', row: 6, col: 3, value: 'Химия; Биоэтика (смотреть страницу Лекции)', runs: [] },
          {
            ref: 'K7', row: 7, col: 11,
            value: '14.45-16.20 Химия   Физика',
            runs: [
              { text: '14.45-16.20 ', underline: false },
              { text: 'Химия', underline: true },
              { text: '   Физика', underline: false },
            ],
          },
          { ref: 'K8', row: 8, col: 11, value: '16.30 Кураторский час', runs: [] },
        ],
        merges: [
          { ref: 'A6:A8', startRef: 'A6', endRef: 'A8', startRow: 6, endRow: 8, startCol: 1, endCol: 1 },
          { ref: 'C6:L6', startRef: 'C6', endRef: 'L6', startRow: 6, endRow: 6, startCol: 3, endCol: 12 },
        ],
      }],
    },
    companionStructure: {
      sheets: [{
        name: 'подробное расписание лекций',
        cells: [
          { ref: 'E3', row: 3, col: 5, value: 'Семестр: 09.02.26 – 20.06.26', runs: [] },
          { ref: 'F6', row: 6, col: 6, value: 'Февраль', runs: [] },
          { ref: 'E7', row: 7, col: 5, value: 'под черт.', runs: [] },
          { ref: 'F7', row: 7, col: 6, value: '9', runs: [] },
          { ref: 'E8', row: 8, col: 5, value: 'над черт.', runs: [] },
          { ref: 'G8', row: 8, col: 7, value: '16', runs: [] },
        ],
        merges: [
          { ref: 'F6:I6', startRef: 'F6', endRef: 'I6', startRow: 6, endRow: 6, startCol: 6, endCol: 9 },
        ],
      }],
    },
  };
}

test('IZH-WEEKLY resolves parity but defers stream-wide rows and missing end time', () => {
  const result = parseIzhgmuWeeklyStructures({ ...syntheticStructures(), groupCode: '109' });
  assert.equal(result.profile, 'IZH-WEEKLY');
  assert.equal(result.period.start_date, '2026-02-09');
  assert.equal(result.period.end_date, '2026-06-20');
  assert.equal(result.parity.odd, 'below_line');
  assert.equal(result.parity.even, 'above_line');
  assert.equal(result.deferred.length, 1);
  assert.equal(result.deferred[0].reason, 'stream_wide_companion_owned');
  const pair = result.series.filter((series) => series.references?.[0]?.range === 'расписание!K7');
  assert.deepEqual(pair.map((series) => [series.discipline, series.parity]), [
    ['Химия', 'above_line'],
    ['Физика', 'below_line'],
  ]);
  assert.ok(pair[0].dates.includes('2026-02-16'));
  assert.ok(pair[1].dates.includes('2026-02-09'));
  assert.equal(result.reviewRequired.length, 1);
  assert.equal(result.reviewRequired[0].warning, 'end_time_missing_in_source');
  assert.equal(result.publishable, false);
});
