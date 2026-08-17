import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

test('IZH-WEEKLY+LECTURE maps source-specific lecture evidence to schedule-event/v1', () => {
  const parsed = {
    profile: 'IZH-WEEKLY+LECTURE',
    group: '109',
    period: {
      start_date: '2026-02-09',
      end_date: '2026-06-20',
      week1_start_date: '2026-02-09',
      reference: 'подробное расписание лекций!E3',
    },
    parity: { references: ['подробное расписание лекций!G8'] },
    reviewRequired: [],
    deferred: [],
    unresolvedChoices: [],
    publishable: true,
    series: [{
      sourceRole: 'lecture',
      sourceSheet: 'подробное расписание лекций',
      group: '109',
      discipline: 'Хирургический уход',
      startTime: '08:30',
      endTime: '10:05',
      dates: ['2026-02-16'],
      parity: 'above_line',
      location: '1 ауд.',
      lessonType: { raw: 'лекция', code: 'lecture' },
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-L01', 'IZH-L03', 'IZH-L06'],
      references: [
        { role: 'discipline', range: 'подробное расписание лекций!C7' },
        { role: 'start_time', range: 'подробное расписание лекций!B7' },
        { role: 'end_time', range: 'расписание!B6' },
        { role: 'location', range: 'подробное расписание лекций!D7' },
        { role: 'week_label', range: 'подробное расписание лекций!E7' },
        { role: 'date', range: 'подробное расписание лекций!F7' },
        { role: 'declared_count', range: 'подробное расписание лекций!AE7' },
      ],
      rawSource: 'Понедельник | 8.30 | Хирургический уход | 1 ауд. | над черт.',
    }],
  };

  const batch = buildIzhgmuWeeklyLectureQaCandidate({
    parsed,
    metadata: {
      academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 1, groupCode: '109', stream: '1',
    },
    source: {
      classFileName: 'class.xlsx', classFileHash: 'a'.repeat(64),
      companionFileName: 'lecture.xlsx', companionFileHash: 'b'.repeat(64),
    },
  });

  const event = batch.events[0];
  assert.deepEqual(event.lesson.locations, [{ raw: '1 ауд.', building: null, room: null, address: null }]);
  assert.deepEqual(event.source.references.map((ref) => ref.role).slice(0, 7), [
    'lesson', 'time', 'time', 'location', 'week', 'date', 'note',
  ]);
  assert.match(event.source.references[2].range, /^class\.xlsx::/);
  assert.match(event.source.references[0].range, /^lecture\.xlsx::/);

  const prepared = prepareSchedulePublication(batch, { now: '2026-08-15T19:30:00.000Z' });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
});
