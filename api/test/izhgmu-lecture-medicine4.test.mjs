import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuMedicine4LectureStructure } from '../src/adapters/izhgmu/lecture-medicine4.mjs';

function cell(row, col, value) { return { ref: `${String.fromCharCode(64 + col)}${row}`, row, col, value, runs: [], styleId: null }; }
function structure(stream) {
  const suffix = stream === 1 ? '1 п' : '2 п';
  return {
    styles: [],
    sheets: [{
      name: 'Лекции',
      styledCells: [],
      merges: [
        { startRef: 'F7', endRef: 'I7', startRow: 7, endRow: 7, startCol: 6, endCol: 9, ref: 'F7:I7' },
        { startRef: 'A8', endRef: 'A9', startRow: 8, endRow: 9, startCol: 1, endCol: 1, ref: 'A8:A9' },
      ],
      cells: [
        cell(2, 5, 'ЛЕКЦИЙ ДЛЯ СТУДЕНТОВ 4 курса ЛЕЧЕБНОГО факультета на ВЕСЕННИЙ СЕМЕСТР 2025-2026 учебного года'),
        cell(4, 7, 'Пр. аттестация 28.05.2026 –10.06.2026'),
        cell(5, 7, 'Практика 11.06.2026-18.07.2026'),
        cell(7, 1, 'Дни недели'), cell(7, 2, 'Время'), cell(7, 3, 'Предмет'), cell(7, 4, 'Ауд.'), cell(7, 5, 'Неделя'), cell(7, 6, 'Февраль'), cell(7, 28, 'Кол-во лекций'),
        cell(8, 1, 'Понедельник'), cell(8, 2, '13.00'), cell(8, 3, `Медицинская реабилитация${suffix}`), cell(8, 4, '8 ауд.'), cell(8, 5, 'над черт.'), cell(8, stream === 1 ? 6 : 7, stream === 1 ? 2 : 9), cell(8, 28, '1'),
        cell(9, 2, '14.45'), cell(9, 3, `Психиатрия ${suffix}`), cell(9, 4, '8 ауд.'), cell(9, 5, 'над черт.'), cell(9, stream === 1 ? 6 : 7, stream === 1 ? 2 : 9), cell(9, 28, '1'),
      ],
    }],
  };
}
const period = { start_date: '2026-02-02', end_date: '2026-05-27', week1_start_date: '2026-02-02' };

test('medicine-4 lecture streams preserve exact stream events but require group mapping', () => {
  for (const stream of [1, 2]) {
    const parsed = parseIzhgmuMedicine4LectureStructure(structure(stream), { stream, period });
    assert.equal(parsed.profile, 'IZH-LECTURE-MEDICINE4-STREAM');
    assert.equal(parsed.series.length, 2);
    assert.equal(parsed.stats.exactOccurrences, 2);
    assert.equal(parsed.stats.structuralReviewCount, 0);
    assert.deepEqual(parsed.series.map((item) => item.discipline), ['Медицинская реабилитация', 'Психиатрия']);
    assert.deepEqual(parsed.series.map((item) => [item.startTime, item.endTime]), [['13:00', '14:35'], ['14:45', '16:20']]);
    assert.equal(parsed.series.every((item) => item.stream === stream && item.groups.length === 0 && item.audienceScope === 'stream'), true);
    assert.equal(parsed.blockers.length, 1);
    assert.equal(parsed.blockers[0].warning, 'stream_group_mapping_required');
    assert.equal(parsed.publishable, false);
    assert.deepEqual(parsed.periodMarkers.map((item) => item.kind), ['intermediate_attestation', 'practice']);
  }
});

test('medicine-4 lecture parser fails closed when a row belongs to the other stream', () => {
  assert.throws(
    () => parseIzhgmuMedicine4LectureStructure(structure(1), { stream: 2, period }),
    (error) => error.code === 'IZH_L4_STREAM_SUFFIX_MISMATCH',
  );
});
