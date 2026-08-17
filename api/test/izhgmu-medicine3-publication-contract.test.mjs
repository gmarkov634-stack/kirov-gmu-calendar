import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIzhgmuMedicine3PublicationCandidate } from '../src/adapters/izhgmu/medicine3-publication.mjs';

function item({ date, discipline = 'Стоматология', type = 'practice', index = 0 }) {
  return {
    date,
    startTime: type === 'practice' ? '08:00' : '11:20',
    endTime: type === 'practice' ? '13:05' : '12:50',
    discipline,
    sourceRole: type === 'lecture' ? 'lecture' : 'practice',
    sourceRanges: [`Лист1!A${index + 1}`],
    sourceReference: `Лекции!B${index + 1}`,
    timeReference: `Лист1!B${index + 1}`,
    ruleIds: ['IZH-C3-TEST'],
    jointGroups: [],
  };
}

test('medicine-3 publication plane excludes only the exact guarded Stomatology contradiction', () => {
  const practiceEvents = Array.from({ length: 8 }, (_, index) => item({
    date: `2026-03-${String(index + 1).padStart(2, '0')}`,
    index,
  }));
  const lectureEvents = [
    ...Array.from({ length: 7 }, (_, index) => item({
      date: `2026-03-${String(index + 1).padStart(2, '0')}`,
      type: 'lecture',
      index: index + 20,
    })),
    item({ date: '2026-04-01', discipline: 'Патофизиология', type: 'lecture', index: 40 }),
  ];
  const blockers = Array.from({ length: 7 }, (_, index) => ({
    kind: 'medicine3_stomatology_practice_lecture_overlap_unresolved',
    discipline: 'Стоматология',
    date: `2026-03-${String(index + 1).padStart(2, '0')}`,
  }));

  const candidate = buildIzhgmuMedicine3PublicationCandidate({
    resolution: {
      profile: 'IZH-MEDICINE3-TIME-RESOLUTION',
      version: 1,
      inputs: {
        cycleSource: { filename: 'medicine3-class.xls', sha256: 'a'.repeat(64), sheet: 'Лист1' },
        lectureSource: { filename: 'medicine3-lecture.xlsx', sha256: 'b'.repeat(64), sheet: 'Лекции' },
      },
      groups: {
        '301': { group: '301', practiceEvents, lectureEvents, blockers },
      },
    },
    metadata: {
      groupCode: '301',
      course: 3,
      facultyCode: 'medicine',
      academicYear: '2025/2026',
      semester: 'spring',
      period: { start_date: '2026-02-01', end_date: '2026-06-30', week1_start_date: '2026-02-02' },
    },
  });

  assert.equal(candidate.publishable, true);
  assert.equal(candidate.blockers.length, 0);
  assert.deepEqual(candidate.exclusion.removed, {
    practiceEvents: 8,
    lectureEvents: 7,
    totalEvents: 15,
    blockers: 7,
  });
  assert.equal(candidate.batch.events.length, 1);
  assert.equal(candidate.batch.events[0].lesson.discipline.normalized, 'Патофизиология');
  assert.equal(candidate.exclusion.ruleId, 'IZH-C3-18');
  assert.equal(candidate.exclusion.failClosedOnContractChange, true);
});

test('medicine-3 publication plane fails closed when the guarded cardinality changes', () => {
  assert.throws(() => buildIzhgmuMedicine3PublicationCandidate({
    resolution: {
      profile: 'IZH-MEDICINE3-TIME-RESOLUTION',
      version: 1,
      inputs: {
        cycleSource: { filename: 'medicine3-class.xls', sha256: 'a'.repeat(64), sheet: 'Лист1' },
        lectureSource: { filename: 'medicine3-lecture.xlsx', sha256: 'b'.repeat(64), sheet: 'Лекции' },
      },
      groups: {
        '301': {
          group: '301',
          practiceEvents: Array.from({ length: 7 }, (_, index) => item({ date: `2026-03-0${index + 1}`, index })),
          lectureEvents: Array.from({ length: 7 }, (_, index) => item({ date: `2026-03-0${index + 1}`, type: 'lecture', index: index + 20 })),
          blockers: Array.from({ length: 7 }, () => ({ kind: 'medicine3_stomatology_practice_lecture_overlap_unresolved', discipline: 'Стоматология' })),
        },
      },
    },
    metadata: {
      groupCode: '301', course: 3, facultyCode: 'medicine', academicYear: '2025/2026', semester: 'spring',
      period: { start_date: '2026-02-01', end_date: '2026-06-30', week1_start_date: '2026-02-02' },
    },
  }), (error) => error?.code === 'IZH_M3_STOMATOLOGY_EXCLUSION_CONTRACT_CHANGED');
});
