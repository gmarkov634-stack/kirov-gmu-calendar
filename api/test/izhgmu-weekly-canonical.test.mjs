import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIzhgmuWeeklyComplete,
  buildIzhgmuWeeklyCanonicalBatch,
  buildIzhgmuWeeklyQaCandidate,
} from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function parsedResult({ complete = false } = {}) {
  const safe = {
    group: '109',
    discipline: 'Химия',
    startTime: '14:45',
    endTime: '16:20',
    dates: ['2026-02-16', '2026-03-02'],
    parity: 'above_line',
    status: 'ok',
    warnings: [],
    ruleIds: ['IZH-W04', 'IZH-W06', 'IZH-W07', 'IZH-W08'],
    references: [{ role: 'lesson', range: 'расписание!K10' }],
    rawSource: '14.45-16.20 Химия Физика',
  };
  return {
    profile: 'IZH-WEEKLY',
    group: '109',
    period: {
      start_date: '2026-02-09',
      end_date: '2026-06-20',
      week1_start_date: '2026-02-09',
      reference: 'подробное расписание лекций!E3',
    },
    parity: { odd: 'below_line', even: 'above_line', references: ['подробное расписание лекций!G8'] },
    series: [safe],
    reviewRequired: complete ? [] : [{ discipline: 'Кураторский час', warning: 'end_time_missing_in_source', references: [{ range: 'расписание!K11' }] }],
    deferred: complete ? [] : [{ value: 'Биоэтика', reason: 'stream_wide_companion_owned', ref: 'C6' }],
    publishable: complete,
  };
}

const input = (parsed) => ({
  parsed,
  metadata: {
    academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 1, groupCode: '109', stream: '1',
  },
  source: {
    classFileName: 'class.xlsx', classFileHash: 'a'.repeat(64),
    companionFileName: 'companion.xlsx', companionFileHash: 'b'.repeat(64),
  },
});

test('safe IZH-WEEKLY QA candidate passes the shared canonical pipeline', () => {
  const candidate = buildIzhgmuWeeklyQaCandidate(input(parsedResult()));
  assert.equal(candidate.schedule.university_code, 'izhgmu');
  assert.equal(candidate.events.length, 2);
  assert.equal(candidate.events[0].lesson.type.code, 'unknown');
  const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T18:30:00.000Z' });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.match(prepared.ics, /BEGIN:VCALENDAR/);
});

test('production IZH-WEEKLY boundary fails closed while source parts are unresolved', () => {
  const parsed = parsedResult();
  assert.throws(() => assertIzhgmuWeeklyComplete(parsed), (error) => (
    error.code === 'IZH_WEEKLY_INCOMPLETE' && error.blockers.length === 2
  ));
  assert.throws(() => buildIzhgmuWeeklyCanonicalBatch(input(parsed)), { code: 'IZH_WEEKLY_INCOMPLETE' });
});

test('production IZH-WEEKLY batch is allowed only after all blockers are resolved', () => {
  const parsed = parsedResult({ complete: true });
  const batch = buildIzhgmuWeeklyCanonicalBatch(input(parsed));
  assert.equal(batch.schedule.parser, 'izhgmu-weekly-v1');
  assert.equal(batch.events.length, 2);
});
