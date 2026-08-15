import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';
import {
  buildIzhgmuMedicine6CompositeCandidate,
  buildIzhgmuMedicine6CompositeCanonicalBatch,
} from '../src/adapters/izhgmu/medicine6-composite.mjs';
import { IZHGMU_MEDICINE6_EXPECTED_GROUPS } from '../src/adapters/izhgmu/lecture-medicine6.mjs';

function cycleParsed(group) {
  return {
    profile: 'IZH-CYCLE',
    group,
    period: { start_date: '2026-02-02', end_date: '2026-05-30', week1_start_date: '2026-02-02' },
    series: [{
      sourceSheet: 'практич.занятия',
      discipline: 'Эпидемиология',
      lessonType: { raw: 'практические занятия', code: 'practice' },
      dates: ['2026-02-02'],
      startTime: '08:00',
      endTime: '12:05',
      location: 'РКИБ',
      assessment: 'Зачет',
      jointGroups: [],
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-C14'],
      references: [{ role: 'discipline', range: 'практич.занятия!B6' }],
      rawSource: 'Эпидемиолог',
    }],
    reviewRequired: [
      { discipline: 'Дисциплина по выбору 4', warning: 'elective_choice_required', references: [{ range: 'практич.занятия!A1' }] },
      { discipline: 'Дисциплина по выбору 5', warning: 'elective_choice_required', references: [{ range: 'практич.занятия!A2' }] },
    ],
    publishable: false,
  };
}

function lectureParsed() {
  return {
    profile: 'IZH-LECTURE-MEDICINE6',
    period: { start_date: '2026-02-02', end_date: '2026-05-30', week1_start_date: '2026-02-02' },
    courseGroups: [...IZHGMU_MEDICINE6_EXPECTED_GROUPS],
    courseWideCoreSeries: [{
      sourceSheet: 'Лекции',
      discipline: 'Онкология',
      dates: ['2026-02-16'],
      startTime: '13:00',
      endTime: '14:35',
      location: 'ауд. 3',
      groups: [...IZHGMU_MEDICINE6_EXPECTED_GROUPS],
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-L6-01'],
      references: [{ role: 'discipline', range: 'Лекции!C10' }],
      rawSource: 'Онкология',
    }],
    reviewRequired: [],
    blockers: [
      { warning: 'stream_group_mapping_required', streams: [1, 2], occurrences: 6 },
      { warning: 'elective_choice_required', slots: [4, 5], occurrences: 74 },
    ],
    publishable: false,
  };
}

function input(group) {
  return {
    cycle: {
      parsed: cycleParsed(group),
      source: { fileName: '25_medicine_course-6_class_ru.xlsx', fileHash: '3e7049eb' },
    },
    lecture: {
      parsed: lectureParsed(),
      source: { fileName: '26_medicine_course-6_lecture_ru.xlsx', fileHash: 'e5dca93d' },
    },
    metadata: {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 6,
      groupCode: group,
      stream: null,
    },
  };
}

function prepare(group) {
  let eventCounter = 0;
  const candidate = buildIzhgmuMedicine6CompositeCandidate(input(group));
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: '2026-08-16T00:00:00Z',
    eventIdFactory: () => `evt_izh_m6_composite_${group}_${++eventCounter}`,
    versionIdFactory: () => `ver_izh_m6_composite_${group}`,
  });
  return { candidate, prepared };
}

test('medicine-6 composite preserves every component blocker instead of collapsing them', () => {
  const candidate = buildIzhgmuMedicine6CompositeCandidate(input('601'));
  assert.equal(candidate.componentStats.cycleEvents, 1);
  assert.equal(candidate.componentStats.lectureEvents, 1);
  assert.equal(candidate.componentStats.postsemesterEvents, 4);
  assert.equal(candidate.componentStats.totalEvents, 6);
  assert.equal(candidate.componentStats.cycleBlockers, 2);
  assert.equal(candidate.componentStats.lectureBlockers, 2);
  assert.equal(candidate.componentStats.postsemesterBlockers, 1);
  assert.equal(candidate.componentStats.totalBlockers, 5);
  assert.deepEqual(candidate.blockers.map((item) => item.source_component), ['cycle','cycle','lecture','lecture','postsemester']);
  assert.equal(candidate.blockers[4].component, 'Государственный экзамен');
  assert.equal(candidate.publishable, false);
});

test('group 626 composite preserves missing therapy blockers and never synthesizes their events', () => {
  const candidate = buildIzhgmuMedicine6CompositeCandidate(input('626'));
  assert.equal(candidate.componentStats.postsemesterEvents, 2);
  assert.equal(candidate.componentStats.totalEvents, 4);
  assert.equal(candidate.componentStats.postsemesterBlockers, 3);
  assert.equal(candidate.componentStats.totalBlockers, 7);
  assert.equal(candidate.batch.events.some((event) => /Промежуточная аттестация: Госпитальная терапия/.test(event.lesson.discipline.normalized)), false);
  assert.equal(candidate.batch.events.some((event) => /Промежуточная аттестация: Поликлиническая терапия/.test(event.lesson.discipline.normalized)), false);
  assert.deepEqual(
    candidate.blockers.filter((item) => item.source_component === 'postsemester').map((item) => [item.component, item.warning, item.date || null]),
    [
      ['Госпитальная терапия', 'group_missing_from_reviewed_source', null],
      ['Поликлиническая терапия', 'group_missing_from_reviewed_source', null],
      ['Государственный экзамен', 'end_time_missing_in_source', '2026-06-15'],
    ],
  );
});

test('composite safe subset passes the shared canonical pipeline for 601 and 626', () => {
  for (const group of ['601', '626']) {
    const { candidate, prepared } = prepare(group);
    assert.equal(prepared.inputQa.publishable, true);
    assert.equal(prepared.outputQa.publishable, true);
    assert.equal(prepared.batch.schedule.period.start_date, '2026-02-02');
    assert.equal(prepared.batch.schedule.period.end_date, '2026-06-22');
    assert.deepEqual(candidate.batch.schedule.source_files, [
      '25_medicine_course-6_class_ru.xlsx',
      '26_medicine_course-6_lecture_ru.xlsx',
      'medicine6-intermediate-attestation-2026.pdf',
      'medicine6-gia-2026.pdf',
    ]);
    assert.doesNotMatch(prepared.ics, /2026061[5-9]T080000/);
  }
});

test('production composite remains fail-closed while any component blocker exists', () => {
  for (const group of ['601', '626']) {
    assert.throws(
      () => buildIzhgmuMedicine6CompositeCanonicalBatch(input(group)),
      (error) => {
        assert.equal(error.code, 'IZH_M6_COMPOSITE_INCOMPLETE');
        assert.equal(error.group, group);
        assert.equal(error.blockers.length, group === '626' ? 7 : 5);
        return true;
      },
    );
  }
});

test('all medicine-6 groups 601-630 keep safe composite QA and reviewed blocker boundaries', () => {
  const expectedGroups = Array.from({ length: 30 }, (_, index) => String(601 + index));
  assert.deepEqual(IZHGMU_MEDICINE6_EXPECTED_GROUPS, expectedGroups);
  for (const group of expectedGroups) {
    const { candidate, prepared } = prepare(group);
    assert.equal(prepared.inputQa.publishable, true, group);
    assert.equal(prepared.outputQa.publishable, true, group);
    assert.equal(candidate.componentStats.postsemesterEvents, group === '626' ? 2 : 4, group);
    assert.equal(candidate.componentStats.totalBlockers, group === '626' ? 7 : 5, group);
    assert.equal(candidate.publishable, false, group);
    assert.equal(candidate.batch.events.some((event) => /^2026-06-(15|16|17|18|19)$/.test(event.timing.date) && event.timing.start_time === '08:00'), false, group);
    assert.throws(
      () => buildIzhgmuMedicine6CompositeCanonicalBatch(input(group)),
      (error) => error.code === 'IZH_M6_COMPOSITE_INCOMPLETE' && error.group === group,
      group,
    );
  }
});
