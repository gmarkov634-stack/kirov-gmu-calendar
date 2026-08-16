import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';

const weeklyParsed = {
  profile: 'IZH-WEEKLY',
  group: '109',
  groups: ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'],
  period: {
    start_date: '2026-02-09',
    end_date: '2026-06-20',
    week1_start_date: '2026-02-09',
    reference: 'подробное расписание лекций!C3',
  },
  parity: { odd: 'above_line', even: 'below_line', references: ['подробное расписание лекций!F7'] },
};

function option(discipline, dates, ref) {
  return {
    sourceRole: 'lecture',
    sourceSheet: 'подробное расписание лекций',
    discipline,
    weekday: 6,
    weekdayLabel: 'Суббота',
    startTime: '08:30',
    endTime: '10:05',
    location: 'ауд. 1',
    parity: null,
    dates,
    lessonType: { raw: 'лекция', code: 'lecture' },
    slotKey: '6|08:30',
    choiceRequired: true,
    status: 'deferred',
    warning: 'elective_choice_required',
    warnings: ['elective_choice_required'],
    ruleIds: ['IZH-L07'],
    references: [
      { role: 'discipline', range: `подробное расписание лекций!${ref}` },
      { role: 'start_time', range: 'подробное расписание лекций!B24' },
      { role: 'end_time', range: 'расписание!B31' },
      ...dates.map((date, index) => ({ role: 'date', range: `подробное расписание лекций!F${24 + index}` })),
    ],
    rawSource: discipline,
  };
}

const lectureParsed = {
  profile: 'IZH-LECTURE',
  series: [
    option('Культурология', ['2026-02-21', '2026-03-07'], 'C27'),
    option('Культурология', ['2026-03-21'], 'C28'),
    option('Медицинская химия', ['2026-02-14'], 'C29'),
  ],
  choiceRequired: {
    blocks: [
      {
        row: 31,
        ref: 'C31',
        value: 'ДВ: Культурология; Медицинская химия',
        slotKey: '6|08:30',
        weekday: 6,
        weekdayLabel: 'Суббота',
        startTime: '08:30',
        endTime: '10:05',
        timeReference: 'B31',
      },
      {
        row: 32,
        ref: 'C32',
        value: 'ДВ: продолжение списка',
        slotKey: '6|08:30',
        weekday: 6,
        weekdayLabel: 'Суббота',
        startTime: '08:30',
        endTime: '10:05',
        timeReference: 'B31',
      },
      {
        row: 33,
        ref: 'C33',
        value: 'практические занятия по ДВ',
        slotKey: '6|10:15',
        weekday: 6,
        weekdayLabel: 'Суббота',
        startTime: '10:15',
        endTime: '11:55',
        timeReference: 'B33',
      },
    ],
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

test('catalog merges split option rows and practice row into one logical elective', () => {
  const catalog = buildIzhgmuWeeklyLectureElectiveCatalog({ weeklyParsed, lectureParsed, metadata, source });
  assert.equal(catalog.electives.length, 1);
  assert.equal(catalog.electives[0].options.length, 2);
  assert.deepEqual(catalog.electives[0].sourceBlockRefs, ['C31', 'C32']);
  assert.deepEqual(catalog.electives[0].practiceBlockRefs, ['C33']);

  const culture = catalog.electives[0].options.find((item) => item.officialDiscipline === 'Культурология');
  const chemistry = catalog.electives[0].options.find((item) => item.officialDiscipline === 'Медицинская химия');
  assert.equal(culture.events.filter((event) => event.lesson.type.code === 'lecture').length, 3);
  assert.equal(culture.events.filter((event) => event.lesson.type.code === 'practice').length, 19);
  assert.equal(chemistry.events.filter((event) => event.lesson.type.code === 'lecture').length, 1);
  assert.equal(chemistry.events.filter((event) => event.lesson.type.code === 'practice').length, 19);
  assert.ok(culture.events.every((event) => event.lesson.discipline.normalized === 'Культурология'));
  assert.ok(culture.events.every((event) => event.system.event_id?.startsWith('evt_izh_el_')));
  assert.ok(culture.events.some((event) => event.calendar.title === 'ЛЕКЦ. КУЛЬТУРОЛОГИЯ'));
  assert.ok(culture.events.some((event) => event.calendar.title === 'Культурология'));
  assert.ok(culture.events.filter((event) => event.lesson.type.code === 'lecture')
    .every((event) => event.source.file_name === source.companionFileName));
  assert.ok(culture.events.filter((event) => event.lesson.type.code === 'practice')
    .every((event) => event.source.file_name === source.classFileName));
});

test('catalog fails closed when a choice block has no source-matched alternatives', () => {
  const broken = structuredClone(lectureParsed);
  broken.series = [];
  assert.throws(
    () => buildIzhgmuWeeklyLectureElectiveCatalog({ weeklyParsed, lectureParsed: broken, metadata, source }),
    (error) => error?.code === 'IZH_ELECTIVE_BLOCK_OPTIONS_MISSING',
  );
});

test('catalog fails closed when a practical elective row maps to more than one logical elective', () => {
  const broken = structuredClone(lectureParsed);
  broken.series.push({
    ...option('Право', ['2026-02-20'], 'C35'),
    weekday: 6,
    slotKey: '6|13:00',
    startTime: '13:00',
    endTime: '14:35',
  });
  broken.choiceRequired.blocks.push({
    row: 35,
    ref: 'C35',
    value: 'ДВ 2',
    slotKey: '6|13:00',
    weekday: 6,
    weekdayLabel: 'Суббота',
    startTime: '13:00',
    endTime: '14:35',
    timeReference: 'B35',
  });
  assert.throws(
    () => buildIzhgmuWeeklyLectureElectiveCatalog({ weeklyParsed, lectureParsed: broken, metadata, source }),
    (error) => error?.code === 'IZH_ELECTIVE_PRACTICE_MAPPING_AMBIGUOUS',
  );
});
