import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIzhgmuCycleComplete,
  buildIzhgmuCycleCanonicalBatch,
  buildIzhgmuCycleQaCandidate,
} from '../src/adapters/izhgmu/cycle-canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function parsedResult({ complete = true } = {}) {
  const series = {
    sourceRole: 'cycle',
    sourceSheet: 'практич.занятия',
    group: '401',
    sourceGroupSpan: '401-402',
    jointGroups: ['402'],
    discipline: 'Гинекология',
    department: 'Акушерства и гинекологии',
    startTime: '08:00',
    endTime: '11:15',
    sourceSlots: [{ start: '08:00', end: '09:30' }, { start: '09:40', end: '11:15' }],
    location: '1 Республиканская клиническая больница; ул. Воткинское шоссе, 57',
    assessment: 'Зачет оценкой',
    lessonType: { raw: 'практические занятия', code: 'practice' },
    dates: ['2026-02-02', '2026-02-03'],
    status: complete ? 'ok' : 'needs_review',
    warning: complete ? null : 'cycle_metadata_unresolved',
    warnings: complete ? [] : ['cycle_metadata_unresolved'],
    ruleIds: ['IZH-C01', 'IZH-C02', 'IZH-C03', 'IZH-C04', 'IZH-C05', 'IZH-C07', 'IZH-C08'],
    references: [
      { role: 'discipline', range: 'практич.занятия!B11:N11' },
      { role: 'date', range: 'практич.занятия!B9:CR10' },
      { role: 'time', range: 'практич.занятия!P29' },
      { role: 'location', range: 'практич.занятия!P31' },
      { role: 'note', range: 'практич.занятия!P28' },
    ],
    rawSource: 'Гинекология; Акушерства и гинекологии; 08:00-11:15',
  };
  return {
    profile: 'IZH-CYCLE',
    parserVersion: 'izhgmu-cycle-v1',
    group: '401',
    sourceGroupSpan: '401-402',
    period: {
      start_date: '2026-02-02',
      end_date: '2026-05-27',
      week1_start_date: '2026-02-02',
      reference: 'практич.занятия!AG4',
    },
    series: [series],
    reviewRequired: complete ? [] : [series],
    deferred: [],
    warnings: [],
    publishable: complete,
  };
}

function input(parsed) {
  return {
    parsed,
    metadata: {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 4,
      groupCode: '401',
      stream: null,
    },
    source: { fileName: 'medicine4.xlsx', fileHash: 'a'.repeat(64) },
  };
}

test('IZH-CYCLE candidate preserves practice type, location and joint groups through shared QA', () => {
  const candidate = buildIzhgmuCycleQaCandidate(input(parsedResult()));
  assert.equal(candidate.events.length, 2);
  assert.equal(candidate.events[0].lesson.type.code, 'practice');
  assert.deepEqual(candidate.events[0].lesson.joint_groups, ['402']);
  assert.equal(candidate.events[0].lesson.locations[0].raw, '1 Республиканская клиническая больница; ул. Воткинское шоссе, 57');
  assert.equal(candidate.events[0].lesson.source_note, 'Форма контроля: Зачет оценкой');
  const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T19:45:00.000Z' });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
});

test('IZH-CYCLE production boundary fails closed on unresolved source series', () => {
  const parsed = parsedResult({ complete: false });
  assert.throws(() => assertIzhgmuCycleComplete(parsed), (error) => (
    error.code === 'IZH_CYCLE_INCOMPLETE' && error.blockers.length === 1
  ));
  assert.throws(() => buildIzhgmuCycleCanonicalBatch(input(parsed)), { code: 'IZH_CYCLE_INCOMPLETE' });
});

test('IZH-CYCLE production batch is allowed only for a complete structurally resolved source', () => {
  const batch = buildIzhgmuCycleCanonicalBatch(input(parsedResult()));
  assert.equal(batch.schedule.parser, 'izhgmu-cycle-v1');
  assert.equal(batch.events.length, 2);
  assert.deepEqual(batch.events[0].lesson.joint_groups, ['402']);
});
