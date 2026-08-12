import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyRWorkbookReviewed } from '../src/adapters/kgmu/weekly-r-reviewed.mjs';

function cell(ref, row, col, value) { return { ref, row, col, value }; }
function merge(ref, startRow, endRow, startCol, endCol) { return { ref, startRow, endRow, startCol, endCol }; }

function workbook() {
  return {
    sheets: [{
      name: '3 леч. 2 поток',
      hiddenRows: [],
      styledCells: [],
      merges: [
        merge('A4:A4', 4, 4, 1, 1),
        merge('A5:A5', 5, 5, 1, 1),
        merge('A6:A6', 6, 6, 1, 1),
        merge('A7:J7', 7, 7, 1, 10),
        merge('B8:C8', 8, 8, 2, 3),
      ],
      cells: [
        cell('B1', 1, 2, 'РАСПИСАНИЕ ЗАНЯТИЙ ДЛЯ СТУДЕНТОВ 3 КУРСА ЛЕЧЕБНОГО ФАКУЛЬТЕТА НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года (2 поток)'),
        cell('B2', 2, 2, '02.02.2026 (2 неделя) - 27.05.2026'),
        cell('B3', 3, 2, 'группа 311'),
        cell('C3', 3, 3, 'группа 312'),

        cell('A4', 4, 1, 'ПН'),
        cell('B4', 4, 2, '9.00-10.30 Инклюзивно ориентированная компетентость врача 1 неделя по 18.05 (2 занятия во вт. 10.00-11.30 03.03, 17.03 1-323) 1-319'),
        cell('C4', 4, 3, '8.00-9.30, 9.40-10.25 Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль) 02.02-18.05, 25.05--9.40-10.25'),

        cell('A5', 5, 1, 'ВТ'),
        cell('B5', 5, 2, '8.00-9.30, 9.40-11.10 Пропедевтика внутренних болезней 03.02-12.05, 19.05-9.40-11.10 (с 14.04 8.40-10.10, 10.20-11.50)'),
        cell('C5', 5, 3, '9.15-10.45, 10.55-11.40 Фармакология 03.02-19.05'),

        cell('A6', 6, 1, 'ЧТ'),
        cell('B6', 6, 2, '11.00-12.30-12.40-14.10 Лучевая диагностика и терапия 05.02'),
        cell('C6', 6, 3, '13.30-15.00 Общая хирургия 05.02'),

        cell('A7', 7, 1, '1 неделя-09.02-14.02; 23.02-28.02; 09.03-14.03; 23.03-28.03; 06.04-11.04; 20.04-25.04; 04.05-09.05; 18.05-23.05 2 неделя-02.02-07.02; 16.02-21.02; 02.03-07.03; 16.03-21.03; 30.03-04.04; 13.04-18.04; 27.04-02.05; 11.05-16.05; 25.05-27.05 Праздничные неучебные дни-23.02, 09.03, 01.05, 09.05'),

        cell('B8', 8, 2, 'Дисциплина'),
        cell('D8', 8, 4, 'Кафедра'),
        cell('E8', 8, 5, 'База практической подготовки'),
        cell('F8', 8, 6, 'Форма промежуточной аттестации'),
        cell('G8', 8, 7, 'Дисциплина'),
        cell('H8', 8, 8, 'кафедра'),
        cell('I8', 8, 9, 'База практической подготовки'),
        cell('J8', 8, 10, 'Форма промежуточной аттестации'),

        cell('B9', 9, 2, 'Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль)'),
        cell('D9', 9, 4, 'патологической анатомии (3 корпус, ул. Владимирская, 112)'),
        cell('F9', 9, 6, 'экзамен'),
        cell('G9', 9, 7, 'Пропедевтика внутренних болезней'),
        cell('H9', 9, 8, 'пропедевтики внутренних болезней (Клиника Кировского ГМУ, ул. Щорса, 64)'),
        cell('I9', 9, 9, 'КОГКБУЗ "Больница скорой медицинской помощи", Октябрьский проспект, 47'),
        cell('J9', 9, 10, 'экзамен'),

        cell('B10', 10, 2, 'Лучевая диагностика и терапия'),
        cell('D10', 10, 4, 'онкологии (КОГБУЗ "Центр онкологии и медицинской радиологии", пр. Строителей, 23)'),
        cell('F10', 10, 6, 'зачёт'),
        cell('G10', 10, 7, 'Общая хирургия'),
        cell('H10', 10, 8, 'общей хирургии (Клиника Кировского ГМУ, ул. Щорса, 64)'),
        cell('I10', 10, 9, 'Клиническая больница "РЖД Медицина" города Киров, Октябрьский пр-т., 151'),
        cell('J10', 10, 10, 'экзамен'),

        cell('B11', 11, 2, 'Инклюзивно ориентированная компетентость врача'),
        cell('D11', 11, 4, 'социальной работы (1 корпус, ул. Владимирская, 137)'),
        cell('F11', 11, 6, 'зачет'),
      ],
    }],
  };
}

function eventsFor(result, group) {
  return result.schedules.find((schedule) => schedule.group.code === group).events;
}

test('reviewed R parser handles medicine course 3 stream grammar fail-closed and without generic-subject collisions', () => {
  const parsed = parseWeeklyRWorkbookReviewed(workbook(), {
    university: 'kgmu',
    program: 'medicine',
    course: 3,
    academicYear: '2025/26',
    semester: 2,
  });

  assert.equal(parsed.qa.status, 'PASS', JSON.stringify(parsed.qa, null, 2));
  assert.equal(parsed.qa.normalizationFailures.length, 0);

  const g311 = eventsFor(parsed, '311');
  const g312 = eventsFor(parsed, '312');

  const inclusive = g311.filter((event) => event.title === 'Инклюзивно ориентированная компетентность врача');
  assert.deepEqual(inclusive.map((event) => event.start.slice(0, 10)), [
    '2026-02-09', '2026-03-03', '2026-03-17', '2026-03-23',
    '2026-04-06', '2026-04-20', '2026-05-04', '2026-05-18',
  ]);
  assert.ok(inclusive.some((event) => event.start === '2026-03-03T10:00:00+03:00' && /аудитория 323/.test(event.location)));

  const pathAnatomy = g312.filter((event) => event.title.startsWith('Патологическая анатомия'));
  assert.ok(pathAnatomy.length > 10);
  assert.equal(g312.some((event) => event.title === 'Анатомия'), false);
  assert.ok(pathAnatomy.some((event) => event.start === '2026-05-25T09:40:00+03:00' && event.end === '2026-05-25T10:25:00+03:00'));
  assert.ok(pathAnatomy.every((event) => event.assessment === 'экзамен'));

  const propedeutics = g311.filter((event) => event.title === 'Пропедевтика внутренних болезней');
  assert.ok(propedeutics.some((event) => event.start === '2026-04-14T08:40:00+03:00' && event.end === '2026-04-14T11:50:00+03:00'));
  assert.ok(propedeutics.some((event) => event.start === '2026-05-19T09:40:00+03:00' && event.end === '2026-05-19T11:10:00+03:00'));
  assert.ok(propedeutics.every((event) => event.assessment === 'экзамен'));
  assert.ok(propedeutics.every((event) => event.location === 'КОГКБУЗ «Больница скорой медицинской помощи», Октябрьский проспект, 47'));

  const radiology = g311.find((event) => event.title === 'Лучевая диагностика и терапия');
  assert.equal(radiology.start, '2026-02-05T11:00:00+03:00');
  assert.equal(radiology.end, '2026-02-05T14:10:00+03:00');
  assert.equal(radiology.assessment, 'зачёт');

  const surgery = g312.find((event) => event.title === 'Общая хирургия');
  assert.equal(surgery.location, 'Клиническая больница «РЖД-Медицина» г. Киров, Октябрьский проспект, 151');
  assert.equal(surgery.assessment, 'экзамен');
});
