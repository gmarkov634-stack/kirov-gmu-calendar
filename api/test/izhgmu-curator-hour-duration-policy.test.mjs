import assert from 'node:assert/strict';
import test from 'node:test';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';

function weekly(reviewRequired) {
  return {
    profile: 'IZH-WEEKLY',
    group: '101',
    groups: ['101'],
    period: { start_date: '2026-02-09', end_date: '2026-06-20' },
    parity: {},
    series: [],
    reviewRequired,
  };
}

const lecture = {
  profile: 'IZH-LECTURE',
  period: { start_date: '2026-02-09', end_date: '2026-06-20' },
  safeSeries: [],
  reviewRequired: [],
  choiceRequired: null,
  classCoverage: { unmapped: [] },
  stats: {},
};

test('curator hour uses exactly 60 minutes and becomes canonical-safe', () => {
  const parsed = composeIzhgmuWeeklyLecture({
    weeklyParsed: weekly([{
      group: '101',
      discipline: 'Кураторский час',
      startTime: '16:30',
      endTime: null,
      dates: ['2026-02-09'],
      status: 'needs_review',
      warning: 'end_time_missing_in_source',
      warnings: ['end_time_missing_in_source'],
      ruleIds: ['IZH-W09'],
      references: [{ role: 'lesson', range: 'расписание!C42' }],
      rawSource: '16.30 Кураторский час',
    }]),
    lectureParsed: lecture,
  });

  assert.equal(parsed.reviewRequired.length, 0);
  assert.equal(parsed.series.length, 1);
  assert.equal(parsed.series[0].discipline, 'Кураторский час');
  assert.equal(parsed.series[0].startTime, '16:30');
  assert.equal(parsed.series[0].endTime, '17:30');
  assert.equal(parsed.series[0].status, 'ok');
  assert.deepEqual(parsed.series[0].warnings, []);
  assert.ok(parsed.series[0].ruleIds.includes('IZH-W11'));
  assert.deepEqual(parsed.series[0].durationPolicy, {
    kind: 'fixed_minutes',
    minutes: 60,
    reason: 'user_policy_curator_hour',
  });
});

test('non-curator start-only lesson remains fail-closed', () => {
  const parsed = composeIzhgmuWeeklyLecture({
    weeklyParsed: weekly([{
      group: '101',
      discipline: 'Биохимия',
      startTime: '16:30',
      endTime: null,
      dates: ['2026-02-09'],
      status: 'needs_review',
      warning: 'end_time_missing_in_source',
      warnings: ['end_time_missing_in_source'],
      ruleIds: ['IZH-W09'],
    }]),
    lectureParsed: lecture,
  });

  assert.equal(parsed.series.length, 0);
  assert.equal(parsed.reviewRequired.length, 1);
  assert.equal(parsed.reviewRequired[0].discipline, 'Биохимия');
  assert.equal(parsed.publishable, false);
});
