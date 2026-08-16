import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyIzhgmuMedicine6Blocker,
  classifyIzhgmuMedicine6Blockers,
} from '../src/adapters/izhgmu/medicine6-blocker-resolution.mjs';
import { buildIzhgmuMedicine6CompositeCandidate } from '../src/adapters/izhgmu/medicine6-composite.mjs';
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

function compositeInput(group) {
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

test('3N classifies only reviewed component-warning combinations and never resolves them', () => {
  const cases = [
    [{ source_component: 'cycle', warning: 'elective_choice_required' }, 'student_choice_required', false, true],
    [{ source_component: 'lecture', warning: 'elective_choice_required' }, 'student_choice_required', false, true],
    [{ source_component: 'lecture', warning: 'elective_schedule_mapping_required' }, 'official_source_required', true, false],
    [{ source_component: 'lecture', warning: 'stream_group_mapping_required' }, 'official_source_required', true, false],
    [{ source_component: 'postsemester', warning: 'end_time_missing_in_source' }, 'official_source_required', true, false],
    [{ source_component: 'postsemester', warning: 'group_missing_from_reviewed_source' }, 'official_source_required', true, false],
  ];
  for (const [blocker, resolutionClass, watchOfficialSource, requiresStudentChoice] of cases) {
    const resolution = classifyIzhgmuMedicine6Blocker(blocker);
    assert.equal(resolution.resolutionClass, resolutionClass);
    assert.equal(resolution.automaticResolution, false);
    assert.equal(resolution.watchOfficialSource, watchOfficialSource);
    assert.equal(resolution.requiresStudentChoice, requiresStudentChoice);
    assert.equal(resolution.requiresManualReview, false);
    assert.equal(resolution.mayInfer, false);
    assert.ok(resolution.requiredEvidence.length > 20);
  }
});

test('3N unknown blocker combinations stay explicitly unknown and manual-review only', () => {
  const resolution = classifyIzhgmuMedicine6Blocker({ source_component: 'lecture', warning: 'new_unreviewed_semantics' });
  assert.equal(resolution.resolutionClass, 'unknown');
  assert.equal(resolution.automaticResolution, false);
  assert.equal(resolution.watchOfficialSource, false);
  assert.equal(resolution.requiresStudentChoice, false);
  assert.equal(resolution.requiresManualReview, true);
  assert.equal(resolution.mayInfer, false);
});

test('3N classification is diagnostic-only and does not mutate blocker objects', () => {
  const blockers = [{ source_component: 'cycle', warning: 'elective_choice_required', discipline: 'Дисциплина по выбору 4' }];
  const before = structuredClone(blockers);
  const result = classifyIzhgmuMedicine6Blockers(blockers);
  assert.deepEqual(blockers, before);
  assert.equal(result.items.length, blockers.length);
  assert.equal(result.productionSemantics, 'diagnostic_only_blockers_remain_fail_closed');
});

test('3N legacy synthetic composite remains classified while new lecture elective semantics avoid student choice', () => {
  for (const group of IZHGMU_MEDICINE6_EXPECTED_GROUPS) {
    const candidate = buildIzhgmuMedicine6CompositeCandidate(compositeInput(group));
    assert.equal(candidate.blockerResolution.items.length, candidate.blockers.length, group);
    assert.equal(candidate.blockerResolution.unknownCount, 0, group);
    assert.equal(candidate.blockerResolution.counts.student_choice_required, 2, group);
    assert.equal(candidate.blockerResolution.counts.official_source_required, group === '626' ? 5 : 3, group);
    assert.equal(candidate.blockerResolution.requiresStudentChoice, true, group);
    assert.equal(candidate.blockerResolution.watchOfficialSource, true, group);
    assert.equal(candidate.blockers.some((item) => item.warning === 'elective_schedule_mapping_required'), true, group);
    assert.equal(candidate.publishable, false, group);
  }
});
