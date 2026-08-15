import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuMedicine5LectureStructure } from '../src/adapters/izhgmu/lecture-medicine5.mjs';

function cell(ref, row, col, value) {
  return { ref, row, col, value, runs: [], styleId: null };
}

function structure({ start = '13.00', discipline = 'Госпитальная терапия 1 п' } = {}) {
  return {
    styles: [],
    sheets: [{
      name: 'Лекции 1п',
      merges: [{ ref: 'A3:A4', startRef: 'A3', endRef: 'A4', startRow: 3, endRow: 4, startCol: 1, endCol: 1 }],
      styledCells: [],
      cells: [
        cell('A1', 1, 1, 'Начало весеннего семестра - 16 февраля 2026 г., окончание - 20 июня 2026 г.'),
        cell('A2', 2, 1, 'Дни недели'),
        cell('B2', 2, 2, 'Время'),
        cell('C2', 2, 3, 'Предмет'),
        cell('D2', 2, 4, 'Ауд.'),
        cell('E2', 2, 5, 'Неделя'),
        cell('F2', 2, 6, 'Февраль'),
        cell('G2', 2, 7, 'Кол-во лекций'),
        cell('A3', 3, 1, 'Понедельник'),
        cell('B3', 3, 2, start),
        cell('C3', 3, 3, discipline),
        cell('D3', 3, 4, '1 ауд.'),
        cell('E3', 3, 5, 'над черт.'),
        cell('F3', 3, 6, '16'),
        cell('G3', 3, 7, '14'),
        cell('B4', 4, 2, '13.00'),
        cell('C4', 4, 3, 'ДВ 4Физиологические основы комплементарной медицины'),
        cell('D4', 4, 4, '9 ауд.'),
        cell('E4', 4, 5, 'над черт.'),
        cell('F4', 4, 6, '16'),
        cell('G4', 4, 7, '7'),
        cell('B5', 5, 2, 'ДВ4'),
        cell('E5', 5, 5, 'чел'),
        cell('C6', 6, 3, 'Фитотерапия в практике врача'),
        cell('E6', 6, 5, '40'),
      ],
    }],
  };
}

test('medicine-5 lecture source parses exact stream evidence but never guesses groups', () => {
  const parsed = parseIzhgmuMedicine5LectureStructure(structure(), { expectedStream: 1 });
  assert.equal(parsed.profile, 'IZH-LECTURE-MEDICINE5');
  assert.equal(parsed.stream, 1);
  assert.equal(parsed.sourceLevelReady, true);
  assert.equal(parsed.publishable, false);
  assert.equal(parsed.groupMappingRequired.warning, 'stream_group_mapping_required');
  assert.equal(parsed.safeCoreSeries.length, 1);
  assert.equal(parsed.safeCoreSeries[0].discipline, 'Госпитальная терапия');
  assert.equal(parsed.safeCoreSeries[0].startTime, '13:00');
  assert.equal(parsed.safeCoreSeries[0].endTime, '14:35');
  assert.deepEqual(parsed.safeCoreSeries[0].dates, ['2026-02-16']);
  assert.equal(parsed.safeCoreSeries[0].declaredCount, 14);
  assert.equal(parsed.safeCoreSeries[0].declaredCountSemantics, 'source_metadata_only');
  assert.deepEqual(parsed.safeCoreSeries[0].groups, []);
  assert.equal(parsed.choiceRequired.warning, 'elective_choice_required');
  assert.equal(parsed.electiveOptions[0].discipline, 'Фитотерапия в практике врача');
  assert.equal(parsed.electiveOptions[0].studentCount, 40);
});

test('medicine-5 lecture source fails closed when a new lecture slot appears', () => {
  const parsed = parseIzhgmuMedicine5LectureStructure(structure({ start: '12.00' }), { expectedStream: 1 });
  assert.equal(parsed.sourceLevelReady, false);
  assert.equal(parsed.reviewRequired.length, 1);
  assert.equal(parsed.reviewRequired[0].warning, 'medicine5_lecture_slot_unreviewed');
  assert.equal(parsed.publishable, false);
});

test('medicine-5 lecture source fails closed on an unreviewed core discipline', () => {
  const parsed = parseIzhgmuMedicine5LectureStructure(structure({ discipline: 'Новая дисциплина 1 п' }), { expectedStream: 1 });
  assert.equal(parsed.sourceLevelReady, false);
  assert.equal(parsed.reviewRequired.length, 1);
  assert.equal(parsed.reviewRequired[0].warning, 'medicine5_lecture_discipline_unknown');
});
