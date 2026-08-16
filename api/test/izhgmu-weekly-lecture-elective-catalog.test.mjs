import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';

const weeklyParsed = {
  profile: 'IZH-WEEKLY',
  group: '109',
  groups: ['109'],
  period: {
    start_date: '2026-02-02',
    end_date: '2026-05-30',
    week1_start_date: '2026-02-02',
    reference: 'Периоды!A1',
  },
  parity: { odd: 'above_line', even: 'below_line', references: ['Периоды!B1'] },
};

function option(discipline, dates, ref) {
  return {
    sourceRole: 'lecture',
    sourceSheet: 'Лекции',
    discipline,
    startTime: '13:00',
    endTime: '14:35',
    location: 'ауд. 1',
    parity: null,
    dates,
    lessonType: { raw: 'лекция', code: 'lecture' },
    slotKey: '2|13:00',
    choiceRequired: true,
    status: 'deferred',
    warning: 'elective_choice_required',
    warnings: ['elective_choice_required'],
    ruleIds: ['IZH-L07'],
    references: [
      { role: 'discipline', range: `Лекции!${ref}` },
      { role: 'start_time', range: 'Лекции!B8' },
      { role: 'end_time', range: 'Расписание!B20' },
      ...dates.map((date, index) => ({ role: 'date', range: `Лекции!F${8 + index}` })),
    ],
    rawSource: discipline,
  };
}

const lectureParsed = {
  profile: 'IZH-LECTURE',
  series: [
    option('Культурология', ['2026-02-03', '2026-02-17'], 'C8'),
    option('Культурология', ['2026-03-03'], 'C9'),
    option('Медицинская химия', ['2026-02-10'], 'C10'),
  ],
  choiceRequired: {
    blocks: [{ row: 20, ref: 'C20', value: 'ДВ', slotKey: '2|13:00' }],
  },
};

const metadata = {
  academicYear: '2025/2026',
  semester: 'spring',
  facultyCode: 'medicine',
  course: 1,
  groupCode: '109',
  stream: '1',
};
const source = {
  classFileName: '05_medicine_course-1_stream-1_class_ru.xlsx',
  classFileHash: 'a'.repeat(64),
  companionFileName: '06_medicine_course-1_stream-1_lecture_ru.xlsx',
  companionFileHash: 'b'.repeat(64),
};

test('catalog groups source rows by official discipline within one elective block', () => {
  const catalog = buildIzhgmuWeeklyLectureElectiveCatalog({ weeklyParsed, lectureParsed, metadata, source });
  assert.equal(catalog.electives.length, 1);
  assert.equal(catalog.electives[0].options.length, 2);
  const culture = catalog.electives[0].options.find((item) => item.officialDiscipline === 'Культурология');
  const chemistry = catalog.electives[0].options.find((item) => item.officialDiscipline === 'Медицинская химия');
  assert.equal(culture.events.length, 3);
  assert.equal(chemistry.events.length, 1);
  assert.ok(culture.events.every((event) => event.calendar.title === 'ЛЕКЦ. КУЛЬТУРОЛОГИЯ'));
  assert.ok(culture.events.every((event) => event.system.event_id?.startsWith('evt_izh_el_')));
  assert.ok(culture.events.every((event) => event.source.file_name === source.companionFileName));
});

test('catalog fails closed when a choice block has no source-matched alternatives', () => {
  const broken = structuredClone(lectureParsed);
  broken.choiceRequired.blocks[0].slotKey = '5|18:00';
  assert.throws(
    () => buildIzhgmuWeeklyLectureElectiveCatalog({ weeklyParsed, lectureParsed: broken, metadata, source }),
    (error) => error?.code === 'IZH_ELECTIVE_BLOCK_OPTIONS_MISSING',
  );
});
