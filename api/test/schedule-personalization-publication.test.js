import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindSchedulePersonalizationCatalog,
  schedulePersonalizationMatchesSchedule,
} from '../src/schedule/personalization-publication.js';

function schedule(version = 'ver_izh_109_1', fingerprint = 'sha256:base-109-v1') {
  return {
    schema_version: '1.0',
    schedule: {
      university_code: 'izhgmu',
      academic_year: '2025/2026',
      semester: 'spring',
      faculty_code: 'medicine',
      course: 1,
      group: '109',
      period: { start_date: '2026-02-09', end_date: '2026-06-20', week1_start_date: '2026-02-09' },
      source_files: ['05.xlsx', '06.xlsx'],
      generated_at: null,
      parser: 'izhgmu-weekly-lecture-v1',
      schedule_version_id: version,
      previous_schedule_version_id: null,
      content_fingerprint: fingerprint,
      version_created_at: '2026-08-16T00:00:00.000Z',
    },
    events: [],
  };
}

function catalog(groupCode = '109') {
  return {
    version: 1,
    university: 'izhgmu',
    academicYear: '2025/2026',
    semester: 'spring',
    facultyCode: 'medicine',
    course: 1,
    groupCode,
    electives: [{ id: 'elective-1', label: 'Дисциплина по выбору 1', options: [] }],
  };
}

test('personalization catalog is bound to exact current schedule version and fingerprint', () => {
  const base = schedule();
  const bound = bindSchedulePersonalizationCatalog(base, catalog());
  assert.equal(bound.baseSchedule.scheduleVersionId, 'ver_izh_109_1');
  assert.equal(bound.baseSchedule.contentFingerprint, 'sha256:base-109-v1');
  assert.equal(bound.baseSchedule.groupId, 'izhgmu:medicine:1:109');
  assert.equal(schedulePersonalizationMatchesSchedule(base, bound), true);
});

test('old sidecar fails closed after base schedule changes', () => {
  const bound = bindSchedulePersonalizationCatalog(schedule(), catalog());
  assert.equal(schedulePersonalizationMatchesSchedule(schedule('ver_izh_109_2', 'sha256:base-109-v2'), bound), false);
});

test('catalog for another group cannot be bound to the schedule', () => {
  assert.throws(
    () => bindSchedulePersonalizationCatalog(schedule(), catalog('110')),
    (error) => error?.code === 'schedule_personalization_context_mismatch',
  );
});

test('unversioned schedule cannot receive a personalization sidecar', () => {
  assert.throws(
    () => bindSchedulePersonalizationCatalog(schedule('', ''), catalog()),
    (error) => error?.code === 'schedule_personalization_schedule_unversioned',
  );
});
