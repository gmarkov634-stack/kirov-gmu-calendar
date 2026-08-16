import assert from 'node:assert/strict';
import test from 'node:test';
import {
  izhgmuMedicineStreamRanges,
  resolveIzhgmuMedicineStream,
} from '../src/adapters/izhgmu/medicine-stream-mapping.mjs';

test('course 1 stream mapping follows current official class stream files', () => {
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '101' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '110' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '111' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '120' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '121' })?.stream, '3');
  assert.equal(resolveIzhgmuMedicineStream({ course: 1, group: '130' })?.stream, '3');
});

test('course 2 stream mapping follows current official class stream files', () => {
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '201' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '210' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '211' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '220' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '221' })?.stream, '3');
  assert.equal(resolveIzhgmuMedicineStream({ course: 2, group: '230' })?.stream, '3');
});

test('course 3 mapping is limited to explicit current lecture ranges', () => {
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '301' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '310' })?.stream, '1');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '311' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '318' })?.stream, '2');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '319' })?.stream, '3');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '326' })?.stream, '3');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '327' }), null);
});

test('senior medicine courses remain fail-closed without direct current evidence', () => {
  assert.equal(resolveIzhgmuMedicineStream({ course: 4, group: '401' }), null);
  assert.equal(resolveIzhgmuMedicineStream({ course: 5, group: '501' }), null);
  assert.equal(resolveIzhgmuMedicineStream({ course: 6, group: '601' }), null);
});

test('range metadata preserves evidence source', () => {
  const course1 = izhgmuMedicineStreamRanges(1);
  assert.equal(course1.length, 3);
  assert.equal(course1[0].evidence, 'current_course1_class_stream_files');
  assert.equal(resolveIzhgmuMedicineStream({ course: 3, group: '325' })?.evidence, 'current_course3_lecture_explicit_range');
});
