import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';
import {
  buildIzhgmuMedicine6PostsemesterCandidate,
  buildIzhgmuMedicine6PostsemesterQaBatch,
  buildIzhgmuMedicine6PostsemesterCanonicalBatch,
} from '../src/adapters/izhgmu/postsemester-canonical.mjs';

function prepare(group) {
  return prepareSchedulePublication(buildIzhgmuMedicine6PostsemesterQaBatch({ group }), {
    now: '2026-08-16T00:00:00Z',
    eventIdFactory: ({ event }) => `evt_izh_ps_${group}_${event.timing.date}_${event.lesson.type.code}_${Math.random().toString(36).slice(2, 8)}`,
    versionIdFactory: () => `ver_izh_ps_${group}`,
  });
}

test('group 601 gets only source-safe post-semester events and GIA exam stays deferred', () => {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate({ group: '601' });
  assert.equal(candidate.events.length, 4);
  assert.equal(candidate.deferredFacts.length, 1);
  assert.equal(candidate.publishable, false);

  const byDiscipline = new Map(candidate.events.map((event) => [event.lesson.discipline.normalized, event]));
  const hospital = byDiscipline.get('Промежуточная аттестация: Госпитальная терапия');
  const polyclinic = byDiscipline.get('Промежуточная аттестация: Поликлиническая терапия');
  const phthisiology = byDiscipline.get('Промежуточная аттестация: Фтизиатрия');
  const consultation = byDiscipline.get('Предэкзаменационная консультация ГИА');

  assert.equal(hospital.timing.date, '2026-06-02');
  assert.equal(polyclinic.timing.date, '2026-06-06');
  assert.equal(phthisiology.timing.date, '2026-03-02');
  for (const event of [hospital, polyclinic, phthisiology]) {
    assert.equal(event.timing.all_day, true);
    assert.equal(event.timing.start_time, null);
    assert.equal(event.timing.end_time, null);
    assert.equal(event.lesson.type.code, 'other');
    assert.equal(event.parse.status, 'warning');
    assert.deepEqual(event.parse.warnings, ['time_not_specified_in_source']);
  }

  assert.equal(consultation.timing.date, '2026-06-10');
  assert.equal(consultation.timing.start_time, '13:00');
  assert.equal(consultation.timing.end_time, '14:00');
  assert.equal(consultation.timing.all_day, false);
  assert.equal(consultation.lesson.type.code, 'consultation');
  assert.equal(consultation.lesson.locations[0].raw, 'актовый зал теоретического корпуса');
  assert.match(consultation.lesson.source_note, /13:00–13:15 Поликлиническая терапия/);
  assert.match(consultation.lesson.source_note, /13:45–14:00 Госпитальная хирургия/);

  const exam = candidate.deferredFacts[0];
  assert.equal(exam.kind, 'gia_state_exam');
  assert.equal(exam.date, '2026-06-17');
  assert.equal(exam.startTime, '08:00');
  assert.equal(exam.endTime, null);
  assert.equal(exam.location, 'аудитория № 3 морфологического корпуса');
  assert.equal(exam.warning, 'end_time_missing_in_source');
  assert.equal(candidate.events.some((event) => event.timing.date === '2026-06-17' && event.timing.start_time === '08:00'), false);
});

test('group 626 remains fail-closed on both missing therapy dates without inventing them', () => {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate({ group: '626' });
  assert.equal(candidate.events.length, 2);
  assert.deepEqual(
    candidate.events.map((event) => [event.lesson.discipline.normalized, event.timing.date]),
    [
      ['Промежуточная аттестация: Фтизиатрия', '2026-03-07'],
      ['Предэкзаменационная консультация ГИА', '2026-06-10'],
    ],
  );
  assert.deepEqual(
    candidate.blockers.map((item) => [item.component, item.warning, item.date || null]),
    [
      ['Госпитальная терапия', 'group_missing_from_reviewed_source', null],
      ['Поликлиническая терапия', 'group_missing_from_reviewed_source', null],
      ['Государственный экзамен', 'end_time_missing_in_source', '2026-06-15'],
    ],
  );
  assert.equal(candidate.deferredFacts[0].date, '2026-06-15');
  assert.equal(candidate.events.some((event) => /Госпитальная терапия/.test(event.lesson.discipline.normalized)), false);
  assert.equal(candidate.events.some((event) => /Поликлиническая терапия/.test(event.lesson.discipline.normalized)), false);
});

test('safe post-semester candidate events pass the shared canonical pipeline', () => {
  for (const group of ['601', '626']) {
    const prepared = prepare(group);
    assert.equal(prepared.inputQa.publishable, true);
    assert.equal(prepared.outputQa.publishable, true);
    assert.equal(prepared.batch.schedule.group, group);
    assert.match(prepared.ics, /DTSTART;VALUE=DATE:2026/);
    assert.match(prepared.ics, /SUMMARY:Промежуточная аттестация/);
    assert.match(prepared.ics, /DTSTART:20260610T130000/);
    assert.match(prepared.ics, /DTEND:20260610T140000/);
    assert.doesNotMatch(prepared.ics, /2026061[5-9]T080000/);
  }
});

test('production post-semester batch refuses every reviewed group while GIA end time is absent', () => {
  for (const group of ['601', '626', '630']) {
    assert.throws(
      () => buildIzhgmuMedicine6PostsemesterCanonicalBatch({ group }),
      (error) => {
        assert.equal(error.code, 'IZH_POSTSEMESTER_INCOMPLETE');
        assert.equal(error.group, group);
        assert.equal(error.blockers.some((item) => item.warning === 'end_time_missing_in_source'), true);
        return true;
      },
    );
  }
});

test('resit dates are preserved in reviewed source but never materialized without group attribution', () => {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate({ group: '601' });
  const eventDates = candidate.events.map((event) => event.timing.date);
  for (const date of ['2026-05-21', '2026-05-28', '2026-06-11', '2026-06-13']) {
    assert.equal(eventDates.includes(date), false);
  }
});

test('canonical candidate provenance is pinned to reviewed PDF hashes', () => {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate({ group: '601' });
  const attestation = candidate.events.find((event) => event.source.file_name === 'medicine6-intermediate-attestation-2026.pdf');
  const consultation = candidate.events.find((event) => event.source.file_name === 'medicine6-gia-2026.pdf');
  assert.equal(attestation.source.file_hash, '1b25c60001dfeb40378134c483203ff2c9e1cf6bbdaef033a99c3195b701b8d5');
  assert.equal(consultation.source.file_hash, 'a21b5264687a64979183c6bc248f7b7336b8a78bb189847dc19eb16474df61f3');
  assert.equal(candidate.deferredFacts[0].sourceHash, 'a21b5264687a64979183c6bc248f7b7336b8a78bb189847dc19eb16474df61f3');
});
