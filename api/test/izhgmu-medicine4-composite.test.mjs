import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIzhgmuMedicine4CompositeCandidate,
  buildIzhgmuMedicine4CompositeCanonicalBatch,
  validateIzhgmuMedicine4StreamGroupMap,
} from '../src/adapters/izhgmu/medicine4-composite.mjs';

const PERIOD = { start_date: '2026-02-02', end_date: '2026-05-27', week1_start_date: '2026-02-02' };
const COURSE_GROUPS = ['401', '402', '403', '404'];

function cycleParsed(group = '401') {
  return {
    profile: 'IZH-CYCLE',
    group,
    period: PERIOD,
    series: [{
      sourceRole: 'cycle',
      sourceSheet: 'Циклы',
      discipline: 'Педиатрия',
      startTime: '08:00',
      endTime: '11:10',
      location: 'База',
      dates: ['2026-02-02'],
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-C4-TEST'],
      references: [{ role: 'discipline', range: 'Циклы!B10' }],
      rawSource: 'Педиатрия',
      jointGroups: [],
    }],
    reviewRequired: [],
    deferred: [],
    warnings: [],
    publishable: true,
  };
}

function lectureParsed(stream) {
  return {
    profile: 'IZH-LECTURE-MEDICINE4-STREAM',
    stream,
    period: PERIOD,
    series: [{
      sourceRole: 'lecture',
      sourceSheet: `Лекции ${stream}`,
      stream,
      discipline: stream === 1 ? 'Факультетская терапия' : 'Факультетская хирургия',
      startTime: '13:00',
      endTime: '14:35',
      location: 'Акт. зал',
      dates: ['2026-02-02'],
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-L4-01'],
      references: [{ role: 'discipline', range: `Лекции ${stream}!C7` }],
      rawSource: `Лекция потока ${stream}`,
    }],
    safeSeries: [],
    reviewRequired: [],
    blockers: [{ warning: 'stream_group_mapping_required', streams: [1, 2], sourceStream: stream, occurrences: 1 }],
    publishable: false,
  };
}

function input(overrides = {}) {
  const l1 = lectureParsed(1);
  const l2 = lectureParsed(2);
  l1.safeSeries = l1.series;
  l2.safeSeries = l2.series;
  return {
    cycle: { parsed: cycleParsed(), source: { fileName: 'class.xlsx', fileHash: 'class-hash' } },
    lectures: {
      '1': { parsed: l1, source: { fileName: 'lecture-1.xlsx', fileHash: 'l1-hash' } },
      '2': { parsed: l2, source: { fileName: 'lecture-2.xlsx', fileHash: 'l2-hash' } },
    },
    metadata: { academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 4, groupCode: '401' },
    courseGroups: COURSE_GROUPS,
    ...overrides,
  };
}

test('medicine-4 mapping accepts an exact non-contiguous partition without inferring order', () => {
  const status = validateIzhgmuMedicine4StreamGroupMap({
    courseGroups: COURSE_GROUPS,
    streamGroupMap: { '1': ['403', '401'], '2': ['404', '402'] },
  });
  assert.equal(status.valid, true);
  assert.equal(status.streamForGroup['401'], 1);
  assert.equal(status.streamForGroup['402'], 2);
  assert.deepEqual(status.missingGroups, []);
  assert.deepEqual(status.unknownGroups, []);
  assert.deepEqual(status.duplicateGroups, []);
});

test('medicine-4 mapping rejects duplicate, missing and unknown audience assignments', () => {
  for (const map of [
    { '1': ['401', '402'], '2': ['402', '403', '404'] },
    { '1': ['401'], '2': ['402', '403'] },
    { '1': ['401', '499'], '2': ['402', '403', '404'] },
  ]) {
    assert.throws(
      () => validateIzhgmuMedicine4StreamGroupMap({ courseGroups: COURSE_GROUPS, streamGroupMap: map }),
      (error) => error?.code === 'IZH_M4_STREAM_GROUP_MAP_INVALID',
    );
  }
});

test('medicine-4 QA remains class-only and production fails closed when mapping is absent', () => {
  const candidate = buildIzhgmuMedicine4CompositeCandidate(input());
  assert.equal(candidate.selectedStream, null);
  assert.equal(candidate.batch.events.length, 1);
  assert.equal(candidate.componentStats.cycleEvents, 1);
  assert.equal(candidate.componentStats.lectureEvents, 0);
  assert.equal(candidate.blockers.some((item) => item.warning === 'stream_group_mapping_required'), true);
  assert.throws(
    () => buildIzhgmuMedicine4CompositeCanonicalBatch(input()),
    (error) => error?.code === 'IZH_M4_STREAM_GROUP_MAPPING_REQUIRED',
  );
});

test('medicine-4 map without reviewed official evidence still cannot authorize lecture attribution', () => {
  const mapped = input({
    streamGroupMap: { '1': ['401', '403'], '2': ['402', '404'] },
    streamGroupEvidence: { reviewed: false, kind: 'official', reference: 'fixture' },
  });
  const candidate = buildIzhgmuMedicine4CompositeCandidate(mapped);
  assert.equal(candidate.mappingStatus.valid, true);
  assert.equal(candidate.selectedStream, null);
  assert.equal(candidate.batch.events.length, 1);
  assert.equal(candidate.blockers.some((item) => item.warning === 'stream_group_mapping_evidence_required'), true);
  assert.throws(
    () => buildIzhgmuMedicine4CompositeCanonicalBatch(mapped),
    (error) => error?.code === 'IZH_M4_STREAM_GROUP_MAPPING_EVIDENCE_REQUIRED',
  );
});

test('reviewed exact map attributes only the selected lecture stream and unlocks hard canonical batch', () => {
  const mapped = input({
    streamGroupMap: { '1': ['401', '403'], '2': ['402', '404'] },
    streamGroupEvidence: { reviewed: true, kind: 'official', reference: 'official-fixture-reference' },
  });
  const candidate = buildIzhgmuMedicine4CompositeCandidate(mapped);
  assert.equal(candidate.publishable, true);
  assert.equal(candidate.selectedStream, 1);
  assert.equal(candidate.componentStats.cycleEvents, 1);
  assert.equal(candidate.componentStats.lectureEvents, 1);
  assert.equal(candidate.batch.events.length, 2);
  assert.deepEqual(candidate.batch.schedule.source_files, ['class.xlsx', 'lecture-1.xlsx']);
  const lecture = candidate.batch.events.find((event) => event.lesson.type.code === 'lecture');
  assert.equal(lecture.audience.group, '401');
  assert.equal(lecture.audience.stream, '1');
  assert.equal(lecture.source.file_name, 'lecture-1.xlsx');

  const production = buildIzhgmuMedicine4CompositeCanonicalBatch(mapped);
  assert.equal(production.schedule.parser, 'izhgmu-medicine4-composite-v1');
  assert.equal(production.events.length, 2);
});
